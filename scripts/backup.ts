import { DatabaseSync, backup } from "node:sqlite";
import { resolve, dirname, join } from "node:path";
import {
  chmodSync,
  closeSync,
  existsSync,
  fsyncSync,
  linkSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  rmSync,
} from "node:fs";

const [destination, ...extra] = process.argv.slice(2);
const source = process.env.MIZVO_DATABASE ?? "var/mizvo.sqlite";
const usage =
  "Provide an existing regular source database and one new backup destination.";

if (!destination || extra.length || resolve(source) === resolve(destination)) {
  console.error(usage);
  process.exit(1);
}
try {
  const sourceInfo = lstatSync(source);
  if (!sourceInfo.isFile() || sourceInfo.isSymbolicLink()) throw new Error();
} catch {
  console.error(usage);
  process.exit(1);
}

const target = resolve(destination);
const parent = dirname(target);
mkdirSync(parent, { recursive: true, mode: 0o700 });

// Never write a partially validated snapshot at its public destination.
// A private directory protects SQLite's intermediate file and WAL sidecars
// even when the operator's destination parent is accessible to others.
const privateDirectory = mkdtempSync(join(parent, ".mizvo-backup-"));
chmodSync(privateDirectory, 0o700);
const candidate = join(privateDirectory, "snapshot.sqlite");
try {
  const db = new DatabaseSync(source, { readOnly: true });
  try {
    if (db.prepare("PRAGMA integrity_check").get()?.integrity_check !== "ok")
      throw new Error("Source integrity check failed.");
    await backup(db, candidate);

    // Validate only the private snapshot; do not modify the live source.
    const check = new DatabaseSync(candidate);
    try {
      const journal = check.prepare("PRAGMA journal_mode=DELETE").get();
      if (journal?.journal_mode !== "delete")
        throw new Error("Backup could not be detached from WAL journal mode.");
      if (
        check.prepare("PRAGMA integrity_check").get()?.integrity_check !== "ok"
      )
        throw new Error("Backup integrity check failed.");
      if (check.prepare("PRAGMA foreign_key_check").all().length !== 0)
        throw new Error("Backup foreign key verification failed.");
    } finally {
      check.close();
    }
    chmodSync(candidate, 0o600);
    if (existsSync(candidate + "-wal") || existsSync(candidate + "-shm"))
      throw new Error("Backup must not leave SQLite sidecar files.");

    // Flush the verified snapshot before publishing it. Never use rename:
    // rename could replace an existing file or a dangling symlink.
    const fd = openSync(candidate, "r");
    try {
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    // This is an atomic, exclusive same-filesystem publication. EEXIST
    // refuses both ordinary files and dangling symlinks at the destination.
    linkSync(candidate, target);
    console.log("Verified private SQLite backup published without overwrite.");
  } finally {
    db.close();
  }
} finally {
  // Also remove unvalidated bytes if backup, integrity, or publication fails.
  rmSync(privateDirectory, { recursive: true, force: true });
}
