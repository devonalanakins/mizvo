import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../packages/storage/database.ts";
import { account, now } from "../packages/authz/security.ts";

const hash = (path: string) =>
  createHash("sha256").update(readFileSync(path)).digest("hex");
const run = (script: string, args: string[], database?: string) =>
  spawnSync(process.execPath, [script, ...args], {
    cwd: process.cwd(),
    env: { ...process.env, ...(database ? { MIZVO_DATABASE: database } : {}) },
    encoding: "utf8",
    timeout: 30000,
    maxBuffer: 16000,
  });

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "mizvo-sealed-backup-"));
  const backupDir = join(root, "snapshots");
  const archiveDir = join(root, "archives");
  const recoveryDir = join(root, "recovery");
  for (const folder of [backupDir, archiveDir, recoveryDir])
    mkdirSync(folder, { mode: 0o700 });
  const source = join(root, "live.sqlite");
  const snapshot = join(backupDir, "snapshot.sqlite");
  const archive = join(archiveDir, "snapshot.mzseal");
  const key = join(root, "encryption.key");
  const wrongKey = join(root, "wrong.key");
  writeFileSync(key, randomBytes(32), { flag: "wx", mode: 0o600 });
  writeFileSync(wrongKey, randomBytes(32), { flag: "wx", mode: 0o600 });
  const store = new Store(source);
  store.run(
    "INSERT INTO organizations VALUES (?,?)",
    "fictional-org",
    "Fictional Organization",
  );
  const user = account(
    store,
    "Fictional Backup User",
    "sealed-backup@example.test",
    "Fictional-secret-only-password-2026",
    "fictional-org",
    "founder",
  );
  store.run(
    "INSERT INTO projects(id,organization_id,name,purpose,scope,owner_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)",
    "synthetic-recovered-project",
    "fictional-org",
    "Restorable synthetic project",
    "Recovery integrity test",
    "Synthetic records only",
    user.id,
    now(),
    now(),
  );
  store.run(
    "INSERT INTO memberships VALUES (?,?,?,NULL,NULL)",
    "synthetic-recovered-project",
    user.id,
    "owner",
  );
  store.run(
    "INSERT INTO sessions VALUES (?,?,?,?,?)",
    createHash("sha256").update("fictional-session-cookie").digest("hex"),
    user.id,
    "fictional-csrf",
    now(),
    "2099-01-01T00:00:00Z",
  );
  const saved = run("scripts/backup.ts", [snapshot], source);
  assert.equal(saved.status, 0, saved.stderr);
  return {
    root,
    backupDir,
    archiveDir,
    recoveryDir,
    source,
    snapshot,
    archive,
    key,
    wrongKey,
    store,
    dispose() {
      store.close();
      rmSync(root, { recursive: true, force: true });
    },
  };
}

test("V0.19 sealed backup authenticates a snapshot and verifies an isolated session-safe restore", () => {
  const f = fixture();
  try {
    const before = hash(f.snapshot);
    const originalSessions = f.store.get(
      "SELECT COUNT(*) AS count FROM sessions",
    )!.count;
    const sealed = run("scripts/sealed-backup.ts", [
      "seal",
      f.snapshot,
      f.archive,
      f.key,
    ]);
    assert.equal(sealed.status, 0, sealed.stderr);
    const sealReceipt = JSON.parse(sealed.stdout);
    assert.equal(sealReceipt.schema, "mizvo.sealed-backup.v1");
    assert.equal(sealReceipt.snapshot_sha256, before);
    assert.equal(sealReceipt.archive_sha256, hash(f.archive));
    assert.equal(sealReceipt.authentication, "aes-256-gcm");
    assert.equal(sealReceipt.independently_off_host_verified, false);
    assert.equal(sealReceipt.disaster_recovery_approved, false);
    assert.equal(lstatSync(f.archive).mode & 0o077, 0);
    assert.equal(
      readFileSync(f.archive).includes(Buffer.from("SQLite format 3")),
      false,
    );
    const checked = run("scripts/sealed-backup.ts", [
      "verify",
      f.archive,
      f.key,
      f.recoveryDir,
    ]);
    assert.equal(checked.status, 0, checked.stderr);
    assert.match(checked.stdout, /authenticated/);
    const receiptFiles = readdirSync(f.recoveryDir).filter((name) =>
      name.endsWith(".json"),
    );
    assert.equal(receiptFiles.length, 1);
    const receiptPath = join(f.recoveryDir, receiptFiles[0]!);
    const receipt = JSON.parse(readFileSync(receiptPath, "utf8"));
    assert.equal(receipt.schema, "mizvo.sealed-backup-check.v1");
    assert.equal(receipt.archive_sha256, hash(f.archive));
    assert.equal(receipt.snapshot_sha256, before);
    assert.equal(receipt.migration_count, 10);
    assert.equal(receipt.isolated_sessions_invalidated, true);
    assert.equal(receipt.real_service_restored, false);
    assert.equal(lstatSync(receiptPath).mode & 0o077, 0);
    assert.deepEqual(readdirSync(f.recoveryDir), receiptFiles);
    assert.equal(hash(f.snapshot), before);
    assert.equal(
      f.store.get("SELECT COUNT(*) AS count FROM sessions")!.count,
      originalSessions,
    );
    assert.equal(readdirSync(f.archiveDir).length, 1);
  } finally {
    f.dispose();
  }
});

test("V0.19 wrong keys, ciphertext tampering and truncation never produce a passing receipt or retained plaintext", () => {
  const f = fixture();
  try {
    assert.equal(
      run("scripts/sealed-backup.ts", ["seal", f.snapshot, f.archive, f.key])
        .status,
      0,
    );
    const original = readFileSync(f.archive);
    const wrong = run("scripts/sealed-backup.ts", [
      "verify",
      f.archive,
      f.wrongKey,
      f.recoveryDir,
    ]);
    assert.notEqual(wrong.status, 0);
    assert.equal(readdirSync(f.recoveryDir).length, 0);

    const tamperedPath = join(f.archiveDir, "tampered.mzseal");
    const tampered = Buffer.from(original);
    tampered[Math.floor(tampered.length / 2)]! ^= 1;
    writeFileSync(tamperedPath, tampered, { mode: 0o600 });
    const rejected = run("scripts/sealed-backup.ts", [
      "verify",
      tamperedPath,
      f.key,
      f.recoveryDir,
    ]);
    assert.notEqual(rejected.status, 0);
    assert.equal(readdirSync(f.recoveryDir).length, 0);
    const truncatedPath = join(f.archiveDir, "truncated.mzseal");
    writeFileSync(truncatedPath, original.subarray(0, original.length - 20), {
      mode: 0o600,
    });
    assert.notEqual(
      run("scripts/sealed-backup.ts", [
        "verify",
        truncatedPath,
        f.key,
        f.recoveryDir,
      ]).status,
      0,
    );
    assert.equal(readdirSync(f.recoveryDir).length, 0);
    assert.deepEqual(readdirSync(f.archiveDir).sort(), [
      "snapshot.mzseal",
      "tampered.mzseal",
      "truncated.mzseal",
    ]);
  } finally {
    f.dispose();
  }
});

test("V0.19 sealing refuses overwrites, symlinks, weak key permissions and exposed snapshot directories", () => {
  const f = fixture();
  try {
    const first = run("scripts/sealed-backup.ts", [
      "seal",
      f.snapshot,
      f.archive,
      f.key,
    ]);
    assert.equal(first.status, 0, first.stderr);
    const archiveHash = hash(f.archive);
    const second = run("scripts/sealed-backup.ts", [
      "seal",
      f.snapshot,
      f.archive,
      f.key,
    ]);
    assert.notEqual(second.status, 0);
    assert.equal(hash(f.archive), archiveHash);
    assert.deepEqual(readdirSync(f.archiveDir), ["snapshot.mzseal"]);

    const missing = join(f.root, "missing-never-created.mzseal");
    const symlinkArchive = join(f.archiveDir, "dangling.mzseal");
    symlinkSync(missing, symlinkArchive);
    assert.notEqual(
      run("scripts/sealed-backup.ts", [
        "seal",
        f.snapshot,
        symlinkArchive,
        f.key,
      ]).status,
      0,
    );
    assert.equal(existsSync(missing), false);
    assert(lstatSync(symlinkArchive).isSymbolicLink());

    chmodSync(f.key, 0o644);
    assert.notEqual(
      run("scripts/sealed-backup.ts", [
        "verify",
        f.archive,
        f.key,
        f.recoveryDir,
      ]).status,
      0,
    );
    chmodSync(f.key, 0o600);

    const keySymlink = join(f.root, "key-link");
    symlinkSync(f.key, keySymlink);
    assert.notEqual(
      run("scripts/sealed-backup.ts", [
        "verify",
        f.archive,
        keySymlink,
        f.recoveryDir,
      ]).status,
      0,
    );
    chmodSync(f.backupDir, 0o755);
    assert.notEqual(
      run("scripts/sealed-backup.ts", [
        "seal",
        f.snapshot,
        join(f.archiveDir, "exposed.mzseal"),
        f.key,
      ]).status,
      0,
    );
    assert.equal(existsSync(join(f.archiveDir, "exposed.mzseal")), false);
    assert.equal(readdirSync(f.recoveryDir).length, 0);
  } finally {
    f.dispose();
  }
});

test("V0.24 offline restore recovers a copied encrypted archive without reactivating sessions", () => {
  const f = fixture();
  try {
    const snapshotHash = hash(f.snapshot);
    const sourceSessions = f.store.get(
      "SELECT COUNT(*) AS count FROM sessions",
    )!.count;
    assert(sourceSessions > 0);
    const sealed = run("scripts/sealed-backup.ts", [
      "seal",
      f.snapshot,
      f.archive,
      f.key,
    ]);
    assert.equal(sealed.status, 0, sealed.stderr);

    // The archive arrives in a separate owner-private recovery workspace.
    // This is a local transfer simulation, not an actual off-host operation.
    const transported = join(f.recoveryDir, "retrieved.mzseal");
    copyFileSync(f.archive, transported);
    chmodSync(transported, 0o600);
    assert.equal(hash(transported), hash(f.archive));

    const restoredPath = join(f.recoveryDir, "restored.sqlite");
    const result = run("scripts/sealed-backup.ts", [
      "restore",
      transported,
      f.key,
      restoredPath,
    ]);
    assert.equal(result.status, 0, result.stderr);
    const receipt = JSON.parse(result.stdout);
    assert.equal(receipt.schema, "mizvo.sealed-offline-restore.v1");
    assert.equal(receipt.archive_sha256, hash(transported));
    assert.equal(receipt.snapshot_sha256, snapshotHash);
    assert.equal(receipt.restored_sha256, hash(restoredPath));
    assert.equal(receipt.offline_database_published, true);
    assert.equal(receipt.isolated_sessions_invalidated, true);
    assert.equal(receipt.external_off_host_transport_verified, false);
    assert.equal(receipt.actual_production_recovery_verified, false);
    assert.equal(receipt.release_approved, false);
    assert.equal(lstatSync(restoredPath).mode & 0o077, 0);
    assert.deepEqual(readdirSync(f.recoveryDir).sort(), [
      "restored.sqlite",
      "retrieved.mzseal",
    ]);
    assert.equal(existsSync(restoredPath + "-wal"), false);
    assert.equal(existsSync(restoredPath + "-shm"), false);

    const recovered = new DatabaseSync(restoredPath, { readOnly: true });
    try {
      assert.equal(
        recovered.prepare("PRAGMA integrity_check").get()?.integrity_check,
        "ok",
      );
      assert.equal(recovered.prepare("PRAGMA foreign_key_check").all().length, 0);
      assert.equal(
        recovered.prepare("SELECT COUNT(*) AS count FROM users").get()?.count,
        1,
      );
      assert.equal(
        recovered.prepare("SELECT COUNT(*) AS count FROM sessions").get()?.count,
        0,
      );
      assert.equal(
        recovered.prepare("SELECT COUNT(*) AS count FROM projects").get()?.count,
        1,
      );
      assert.equal(
        recovered
          .prepare("SELECT COUNT(*) AS count FROM memberships")
          .get()?.count,
        1,
      );
      assert.equal(
        recovered.prepare(
          "SELECT name FROM organizations WHERE id=?",
        ).get("fictional-org")?.name,
        "Fictional Organization",
      );
    } finally {
      recovered.close();
    }
    assert.equal(hash(f.snapshot), snapshotHash);
    assert.equal(
      f.store.get("SELECT COUNT(*) AS count FROM sessions")!.count,
      sourceSessions,
    );
  } finally {
    f.dispose();
  }
});

test("V0.24 offline restore rejects bad keys, corruption, existing targets and sidecars", () => {
  const f = fixture();
  try {
    const sealed = run("scripts/sealed-backup.ts", [
      "seal",
      f.snapshot,
      f.archive,
      f.key,
    ]);
    assert.equal(sealed.status, 0, sealed.stderr);
    const sourceHash = hash(f.archive);
    const target = join(f.recoveryDir, "restored.sqlite");

    const wrongKey = run("scripts/sealed-backup.ts", [
      "restore",
      f.archive,
      f.wrongKey,
      target,
    ]);
    assert.notEqual(wrongKey.status, 0);
    assert.equal(existsSync(target), false);
    assert.deepEqual(readdirSync(f.recoveryDir), []);

    const corrupt = join(f.archiveDir, "corrupted.mzseal");
    const altered = readFileSync(f.archive);
    altered[Math.floor(altered.length / 2)]! ^= 1;
    writeFileSync(corrupt, altered, { mode: 0o600 });
    const tampered = run("scripts/sealed-backup.ts", [
      "restore",
      corrupt,
      f.key,
      target,
    ]);
    assert.notEqual(tampered.status, 0);
    assert.equal(existsSync(target), false);
    assert.deepEqual(readdirSync(f.recoveryDir), []);

    writeFileSync(target, "existing protected destination", { mode: 0o600 });
    const existingHash = hash(target);
    const existing = run("scripts/sealed-backup.ts", [
      "restore",
      f.archive,
      f.key,
      target,
    ]);
    assert.notEqual(existing.status, 0);
    assert.equal(hash(target), existingHash);
    assert.deepEqual(readdirSync(f.recoveryDir), ["restored.sqlite"]);
    rmSync(target);

    const unreachable = join(f.root, "must-not-create.sqlite");
    symlinkSync(unreachable, target);
    const linked = run("scripts/sealed-backup.ts", [
      "restore",
      f.archive,
      f.key,
      target,
    ]);
    assert.notEqual(linked.status, 0);
    assert.equal(existsSync(unreachable), false);
    assert(lstatSync(target).isSymbolicLink());
    assert.deepEqual(readdirSync(f.recoveryDir), ["restored.sqlite"]);
    rmSync(target);

    writeFileSync(target + "-wal", "preexisting sidecar", { mode: 0o600 });
    const sidecar = run("scripts/sealed-backup.ts", [
      "restore",
      f.archive,
      f.key,
      target,
    ]);
    assert.notEqual(sidecar.status, 0);
    assert.equal(existsSync(target), false);
    assert.equal(
      readFileSync(target + "-wal", "utf8"),
      "preexisting sidecar",
    );
    assert.deepEqual(readdirSync(f.recoveryDir), ["restored.sqlite-wal"]);
    assert.equal(hash(f.archive), sourceHash);
  } finally {
    f.dispose();
  }
});
