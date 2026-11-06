import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import {
  chmodSync,
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
