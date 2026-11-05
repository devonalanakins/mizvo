import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { createHash, randomUUID } from "node:crypto";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../packages/storage/database.ts";
import { account, now } from "../packages/authz/security.ts";

const run = (args: string[], env: NodeJS.ProcessEnv = process.env) =>
  spawnSync(process.execPath, args, {
    env,
    cwd: process.cwd(),
    encoding: "utf8",
    timeout: 30000,
  });

test("isolated recovery drill verifies live-WAL snapshot and never alters or exposes original records", async () => {
  const root = mkdtempSync(join(tmpdir(), "mizvo-recovery-test-"));
  const source = join(root, "live.sqlite");
  const snapshot = join(root, "backup.sqlite");
  const privateRoot = join(root, "private");
  mkdirSync(privateRoot, { mode: 0o700 });
  const store = new Store(source);
  try {
    store.run(
      "INSERT INTO organizations VALUES (?,?)",
      "synthetic-org",
      "Synthetic Organization",
    );
    const user = account(
      store,
      "Private Test User",
      "private@example.test",
      "Synthetic-test-password-strong-2026",
      "synthetic-org",
      "founder",
    );
    const project = randomUUID();
    const stamp = now();
    store.run(
      "INSERT INTO projects(id,organization_id,name,purpose,scope,owner_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)",
      project,
      "synthetic-org",
      "Synthetic Recovery Project",
      "Check offline recovery only",
      "",
      user.id,
      stamp,
      stamp,
    );
    store.run(
      "INSERT INTO memberships VALUES (?,?,?,NULL,NULL)",
      project,
      user.id,
      "owner",
    );
    store.run(
      "INSERT INTO sessions VALUES (?,?,?,?,?)",
      createHash("sha256").update("test-only-cookie").digest("hex"),
      user.id,
      "test-only-csrf",
      stamp,
      "2099-01-01T00:00:00Z",
    );
    store.run(
      "INSERT INTO records VALUES (?,?,?,?,?,?,?,?,1,?,?)",
      randomUUID(),
      project,
      "note",
      "PRIVATE_RECOVERY_CONTEXT",
      "Never print this real record's contents.",
      "internal",
      "open",
      user.id,
      stamp,
      stamp,
    );

    const backup = run(["scripts/backup.ts", snapshot], {
      ...process.env,
      MIZVO_DATABASE: source,
    });
    assert.equal(backup.status, 0, backup.stderr);
    assert(
      existsSync(snapshot),
      "The online backup CLI should create a consistent snapshot.",
    );
    const before = createHash("sha256")
      .update(readFileSync(snapshot))
      .digest("hex");

    const result = run(["scripts/recovery-drill.ts", snapshot, privateRoot]);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Offline recovery rehearsal passed/);
    const receipts = readdirSync(privateRoot).filter((name) =>
      name.endsWith(".json"),
    );
    assert.equal(receipts.length, 1);
    const receiptPath = join(privateRoot, receipts[0]!);
    const receipt = JSON.parse(readFileSync(receiptPath, "utf8"));
    assert.equal(receipt.schema, "mizvo.isolated-recovery-drill.v1");
    assert.equal(receipt.snapshot_sha256, before);
    assert.equal(receipt.copied_snapshot_sha256, before);
    assert.equal(receipt.sqlite_integrity, "ok");
    assert.equal(receipt.foreign_key_check, "ok");
    assert.equal(receipt.row_counts_before_session_invalidation.sessions, 1);
    assert.equal(receipt.row_counts_before_session_invalidation.records, 1);
    assert.equal(receipt.isolated_restore_sessions_invalidated, true);
    assert.equal(receipt.source_snapshot_unchanged, true);
    assert.equal(receipt.schema_migrations.at(-1), 7);
    assert(!JSON.stringify(receipt).includes("PRIVATE_RECOVERY_CONTEXT"));
    assert(!JSON.stringify(receipt).includes("private@example.test"));
    assert(!JSON.stringify(receipt).includes("test-only-cookie"));
    assert.equal(
      statSync(receiptPath).mode & 0o077,
      0,
      "The receipt must not be public.",
    );
    assert.equal(
      createHash("sha256").update(readFileSync(snapshot)).digest("hex"),
      before,
    );
    assert.equal(store.get("SELECT COUNT(*) AS count FROM sessions")?.count, 1);
    assert.equal(
      store.get("SELECT title FROM records WHERE project_id=?", project)?.title,
      "PRIVATE_RECOVERY_CONTEXT",
    );
    assert(
      readdirSync(privateRoot).every((name) => name.endsWith(".json")),
      "The recovery drill must delete temporary database copies.",
    );

    const orphan = join(root, "orphan.sqlite");
    copyFileSync(snapshot, orphan);
    const broken = new DatabaseSync(orphan);
    try {
      broken.exec("PRAGMA foreign_keys=OFF");
      broken
        .prepare("INSERT INTO memberships VALUES (?,?,?,NULL,NULL)")
        .run(project, randomUUID(), "client");
    } finally {
      broken.close();
    }
    const badFk = run(["scripts/recovery-drill.ts", orphan, privateRoot]);
    assert.notEqual(badFk.status, 0);
    assert.match(badFk.stderr, /foreign key/i);

    const wrongSchema = join(root, "bad-schema.sqlite");
    copyFileSync(snapshot, wrongSchema);
    const incompatible = new DatabaseSync(wrongSchema);
    try {
      incompatible
        .prepare(
          "UPDATE migration_checksums SET checksum='bad' WHERE version=1",
        )
        .run();
    } finally {
      incompatible.close();
    }
    const rejected = run([
      "scripts/recovery-drill.ts",
      wrongSchema,
      privateRoot,
    ]);
    assert.notEqual(rejected.status, 0);
    assert.match(rejected.stderr, /migration checksum/i);

    const badCopy = join(root, "damaged.sqlite");
    copyFileSync(snapshot, badCopy);
    const bytes = readFileSync(badCopy);
    bytes.fill(0, 0, 16);
    writeFileSync(badCopy, bytes);
    assert.notEqual(
      run(["scripts/recovery-drill.ts", badCopy, privateRoot]).status,
      0,
    );

    const symlink = join(root, "link.sqlite");
    symlinkSync(snapshot, symlink);
    const badLink = run(["scripts/recovery-drill.ts", symlink, privateRoot]);
    assert.notEqual(badLink.status, 0);
    assert.match(badLink.stderr, /regular file/i);

    if (process.platform !== "win32") {
      chmodSync(privateRoot, 0o755);
      const publicDirectory = run([
        "scripts/recovery-drill.ts",
        snapshot,
        privateRoot,
      ]);
      assert.notEqual(publicDirectory.status, 0);
      assert.match(publicDirectory.stderr, /mode 0700/i);
      chmodSync(privateRoot, 0o700);
    }
    assert.equal(
      readdirSync(privateRoot).filter((name) => name.endsWith(".json")).length,
      1,
      "Failed drills must not emit a verified receipt.",
    );
  } finally {
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
});
