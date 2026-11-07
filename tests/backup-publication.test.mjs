import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
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
import { DatabaseSync } from "node:sqlite";

const execute = promisify(execFile);

async function backup(source, destination) {
  return execute(process.execPath, ["scripts/backup.ts", destination], {
    env: { ...process.env, MIZVO_DATABASE: source },
    timeout: 30000,
  });
}

test("backup is privately staged, integrity-checked, exclusively published and never overwritten", async () => {
  const root = mkdtempSync(join(tmpdir(), "mizvo-backup-safe-"));
  const source = join(root, "live.sqlite");
  const output = join(root, "operator-backups");
  mkdirSync(output, { mode: 0o755 });
  chmodSync(output, 0o755);
  const db = new DatabaseSync(source);
  try {
    db.exec("PRAGMA journal_mode=WAL");
    db.exec("CREATE TABLE notes (value TEXT NOT NULL)");
    db.prepare("INSERT INTO notes (value) VALUES (?)").run(
      "Sensitive synthetic record",
    );
    const destination = join(output, "safe.sqlite");
    await backup(source, destination);

    assert.equal(lstatSync(destination).mode & 0o777, 0o600);
    assert.deepEqual(readdirSync(output), ["safe.sqlite"]);
    const check = new DatabaseSync(destination, { readOnly: true });
    try {
      assert.equal(
        check.prepare("SELECT value FROM notes").get()?.value,
        "Sensitive synthetic record",
      );
      assert.equal(
        check.prepare("PRAGMA integrity_check").get()?.integrity_check,
        "ok",
      );
    } finally {
      check.close();
    }
    assert(!existsSync(destination + "-wal"));
    assert(!existsSync(destination + "-shm"));

    // A preexisting destination must remain byte-identical, even when a
    // valid new backup is available to publish.
    const unchanged = readFileSync(destination);
    await assert.rejects(() => backup(source, destination));
    assert.deepEqual(readFileSync(destination), unchanged);
    assert.deepEqual(readdirSync(output), ["safe.sqlite"]);

    // existsSync() alone cannot detect a dangling symlink, so test the
    // atomic publication step against this hostile destination shape.
    const missingTarget = join(root, "should-never-be-created.sqlite");
    const symlinkPath = join(output, "dangling.sqlite");
    symlinkSync(missingTarget, symlinkPath);
    await assert.rejects(() => backup(source, symlinkPath));
    assert(lstatSync(symlinkPath).isSymbolicLink());
    assert(!existsSync(missingTarget));
    assert.deepEqual(readdirSync(output).sort(), [
      "dangling.sqlite",
      "safe.sqlite",
    ]);
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("failed backup never exposes partial destination or retains private staging bytes", async () => {
  const root = mkdtempSync(join(tmpdir(), "mizvo-backup-failure-"));
  try {
    const invalidSource = join(root, "invalid.sqlite");
    const destination = join(root, "new-backups", "rejected.sqlite");
    writeFileSync(invalidSource, "not a database");
    await assert.rejects(() => backup(invalidSource, destination));
    assert(!existsSync(destination));
    assert.deepEqual(readdirSync(join(root, "new-backups")), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
