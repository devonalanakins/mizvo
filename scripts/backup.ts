import { DatabaseSync, backup } from "node:sqlite";
import { resolve } from "node:path";
import { existsSync, chmodSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
const [destination] = process.argv.slice(2),
  source = process.env.MIZVO_DATABASE ?? "var/mizvo.sqlite";
if (
  !destination ||
  !existsSync(source) ||
  existsSync(destination) ||
  resolve(source) === resolve(destination)
) {
  console.error(
    "Provide an existing source database and a new backup destination.",
  );
  process.exit(1);
}
mkdirSync(dirname(destination), { recursive: true, mode: 0o700 });
const db = new DatabaseSync(source, { readOnly: true });
try {
  if (db.prepare("PRAGMA integrity_check").get()?.integrity_check !== "ok")
    throw new Error("Source integrity check failed.");
  await backup(db, destination);
  // A snapshot inherits its source's WAL journal mode. Convert the *copy*
  // to a detached DELETE-journal file so no uncheckpointed -wal/-shm sidecars
  // are necessary when the snapshot is moved to recovery storage.
  const check = new DatabaseSync(destination);
  try {
    const journal = check.prepare("PRAGMA journal_mode=DELETE").get();
    if (journal?.journal_mode !== "delete")
      throw new Error("Backup could not be detached from WAL journal mode.");
    if (check.prepare("PRAGMA integrity_check").get()?.integrity_check !== "ok")
      throw new Error("Backup integrity check failed.");
    if (check.prepare("PRAGMA foreign_key_check").all().length !== 0)
      throw new Error("Backup foreign key verification failed.");
  } finally {
    check.close();
  }
  chmodSync(destination, 0o600);
  if (existsSync(destination + "-wal") || existsSync(destination + "-shm"))
    throw new Error("Backup must not leave SQLite sidecar files.");
  console.log("Verified self-contained SQLite backup created.");
} finally {
  db.close();
}
