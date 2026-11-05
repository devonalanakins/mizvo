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
  chmodSync(destination, 0o600);
  const check = new DatabaseSync(destination, { readOnly: true });
  try {
    if (check.prepare("PRAGMA integrity_check").get()?.integrity_check !== "ok")
      throw new Error("Backup integrity check failed.");
  } finally {
    check.close();
  }
  console.log("Verified SQLite backup created.");
} finally {
  db.close();
}
