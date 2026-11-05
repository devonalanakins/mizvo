import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { readFileSync, mkdirSync, readdirSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
export type Row = Record<string, any>;
export class Store {
  db: DatabaseSync;
  private depth = 0;
  constructor(
    path: string,
    migrationsDirectory = fileURLToPath(new URL(".", import.meta.url)),
  ) {
    if (path !== ":memory:")
      mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(path);
    this.db.exec(
      "PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;",
    );
    this.db.exec(
      "CREATE TABLE IF NOT EXISTS migration_checksums (version INTEGER PRIMARY KEY, checksum TEXT NOT NULL); CREATE TABLE IF NOT EXISTS migrations(version INTEGER PRIMARY KEY,applied_at TEXT NOT NULL);",
    );
    try {
      const files = readdirSync(migrationsDirectory)
        .filter((f) => /^\d{3}-.+\.sql$/.test(f))
        .sort();
      const versions = files.map((f) => Number(f.slice(0, 3)));
      if (
        this.all("SELECT version FROM migrations").some(
          (r) => !versions.includes(r.version),
        )
      )
        throw new Error(
          "Database has a migration this release does not support. Restore a compatible snapshot.",
        );
      for (const file of files) {
        const migration = Number(file.slice(0, 3)),
          schema = readFileSync(`${migrationsDirectory}/${file}`, "utf8"),
          checksum = createHash("sha256").update(schema).digest("hex");
        const existing = this.get(
          "SELECT checksum FROM migration_checksums WHERE version=?",
          migration,
        );
        if (existing && existing.checksum !== checksum)
          throw new Error(
            "Migration checksum mismatch. Restore the reviewed schema before startup.",
          );
        if (!existing)
          this.transaction(() => {
            this.db.exec(schema);
            this.run(
              "INSERT INTO migrations VALUES (?,?)",
              migration,
              new Date().toISOString(),
            );
            this.run(
              "INSERT INTO migration_checksums VALUES (?,?)",
              migration,
              checksum,
            );
          });
      }
    } catch (error) {
      this.db.close();
      throw error;
    }
  }

  get(sql: string, ...args: any[]): Row | undefined {
    return this.db.prepare(sql).get(...args);
  }
  all(sql: string, ...args: any[]): Row[] {
    return this.db.prepare(sql).all(...args);
  }
  run(sql: string, ...args: any[]) {
    return this.db.prepare(sql).run(...args);
  }
  transaction<T>(fn: () => T): T {
    const level = this.depth++,
      savepoint = `mizvo_${level}`;
    try {
      this.db.exec(level === 0 ? "BEGIN IMMEDIATE" : `SAVEPOINT ${savepoint}`);
      try {
        const value = fn();
        this.db.exec(level === 0 ? "COMMIT" : `RELEASE ${savepoint}`);
        return value;
      } catch (e) {
        if (level === 0) this.db.exec("ROLLBACK");
        else this.db.exec(`ROLLBACK TO ${savepoint}; RELEASE ${savepoint}`);
        throw e;
      }
    } finally {
      this.depth--;
    }
  }
  close() {
    this.db.close();
  }
}
