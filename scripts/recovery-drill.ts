import { DatabaseSync } from "node:sqlite";
import { createHash, randomUUID } from "node:crypto";
import {
  chmodSync,
  closeSync,
  copyFileSync,
  createReadStream,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { resolve, join, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";

const usage =
  "Usage: node scripts/recovery-drill.ts /absolute/path/to/backup.sqlite /absolute/private/directory";

function requireRegularFile(path: string) {
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error("The snapshot must be a regular file, not a symlink.");
  }
  if (stat.size < 100)
    throw new Error("The snapshot is not a valid SQLite backup.");
  return stat.size;
}

function assertPrivateDirectory(path: string) {
  const stat = lstatSync(path);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error("The drill location must be a private real directory.");
  }
  // The operator explicitly provides an encrypted/restricted work location.
  // For POSIX, never accept group/world-accessible drill directories.
  if (process.platform !== "win32" && (stat.mode & 0o077) !== 0) {
    throw new Error(
      "The drill directory must be accessible only to its owner (mode 0700).",
    );
  }
  if (realpathSync(path) !== resolve(path)) {
    throw new Error("The drill directory must not resolve through symlinks.");
  }
}

async function sha256File(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

function schemaVersions(db: DatabaseSync): number[] {
  const directory = fileURLToPath(
    new URL("../packages/storage/", import.meta.url),
  );
  const files = readdirSync(directory)
    .filter((name) => /^\d{3}-.+\.sql$/.test(name))
    .sort();
  const rows = db
    .prepare(
      "SELECT version,checksum FROM migration_checksums ORDER BY version",
    )
    .all() as { version: number; checksum: string }[];
  const applied = db
    .prepare("SELECT version FROM migrations ORDER BY version")
    .all() as { version: number }[];
  if (rows.length !== files.length || applied.length !== files.length) {
    throw new Error("Snapshot and application have different migration sets.");
  }
  for (let i = 0; i < files.length; i++) {
    const filename = files[i]!;
    const version = Number(filename.slice(0, 3));
    const hash = createHash("sha256")
      .update(readFileSync(join(directory, filename)))
      .digest("hex");
    if (
      rows[i]?.version !== version ||
      applied[i]?.version !== version ||
      rows[i]?.checksum !== hash
    ) {
      throw new Error(
        "Snapshot migration checksum/version does not match this build.",
      );
    }
  }
  return rows.map((row) => row.version);
}

const countedTables = [
  "organizations",
  "projects",
  "memberships",
  "records",
  "record_history",
  "releases",
  "project_brief_revisions",
  "project_ownership_revisions",
  "audit",
  "sessions",
] as const;

function examine(db: DatabaseSync) {
  const integrity = db.prepare("PRAGMA integrity_check").get() as
    | { integrity_check: string }
    | undefined;
  if (integrity?.integrity_check !== "ok") {
    throw new Error("SQLite integrity check failed.");
  }
  if (db.prepare("PRAGMA foreign_key_check").all().length !== 0) {
    throw new Error("SQLite foreign key verification failed.");
  }
  const migrations = schemaVersions(db);
  const counts: Record<string, number> = {};
  for (const table of countedTables) {
    // Table names are fixed literals in this file, never user input.
    const row = db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as
      | { count: number }
      | undefined;
    counts[table] = row?.count ?? 0;
  }
  return { migrations, counts };
}

async function drill(snapshotInput: string, privateInput: string) {
  if (!isAbsolute(snapshotInput) || !isAbsolute(privateInput)) {
    throw new Error(
      "Use absolute paths for the snapshot and private drill location.",
    );
  }
  const snapshot = resolve(snapshotInput);
  const privateRoot = resolve(privateInput);
  requireRegularFile(snapshot);
  assertPrivateDirectory(privateRoot);
  if (existsSync(snapshot + "-wal") || existsSync(snapshot + "-shm")) {
    throw new Error(
      "Snapshot has SQLite sidecars; use the online backup command first.",
    );
  }
  const snapshotShaBefore = await sha256File(snapshot);
  const bytes = requireRegularFile(snapshot);
  const work = mkdtempSync(join(privateRoot, ".mizvo-restore-test-"));
  chmodSync(work, 0o700);
  const isolated = join(work, "restored.sqlite");
  try {
    copyFileSync(snapshot, isolated);
    chmodSync(isolated, 0o600);
    const [sourceShaAfter, isolatedSha] = await Promise.all([
      sha256File(snapshot),
      sha256File(isolated),
    ]);
    if (
      snapshotShaBefore !== sourceShaAfter ||
      snapshotShaBefore !== isolatedSha
    ) {
      throw new Error(
        "Snapshot changed during copying or isolated copy differs.",
      );
    }

    // This is an isolated copy, never the source. No schema migration runs here.
    const restored = new DatabaseSync(isolated);
    let findings: ReturnType<typeof examine>;
    try {
      restored.exec("PRAGMA foreign_keys=ON");
      findings = examine(restored);
      // Recovered production sessions MUST NOT be trusted. Exercise session
      // invalidation only in this isolated copy and verify after commit.
      restored.exec("BEGIN IMMEDIATE");
      try {
        restored.exec("DELETE FROM sessions");
        restored.exec("COMMIT");
      } catch (err) {
        restored.exec("ROLLBACK");
        throw err;
      }
      const count = restored
        .prepare("SELECT COUNT(*) AS count FROM sessions")
        .get() as { count: number } | undefined;
      if (count?.count !== 0) {
        throw new Error(
          "Recovered sessions were not invalidated in the drill.",
        );
      }
      examine(restored);
    } finally {
      restored.close();
    }

    const receipt = {
      schema: "mizvo.isolated-recovery-drill.v1",
      observed_at: new Date().toISOString(),
      scope:
        "Single local SQLite installation snapshot; independent rehearsal only.",
      snapshot_sha256: snapshotShaBefore,
      copied_snapshot_sha256: isolatedSha,
      snapshot_size_bytes: bytes,
      schema_migrations: findings.migrations,
      row_counts_before_session_invalidation: findings.counts,
      sqlite_integrity: "ok",
      foreign_key_check: "ok",
      isolated_restore_sessions_invalidated: true,
      source_snapshot_unchanged: true,
      limitations: [
        "This receipt is unsigned local operator evidence, not a trusted provider attestation.",
        "No application login, client-specific data export, cloud account, off-host backup or production restore was verified.",
        "Real recovery must reapply post-snapshot access revocations and rotate/revoke restored credentials before network access.",
        "The source snapshot still contains its original sessions and personal data; store it in approved encrypted storage.",
      ],
    };
    const path = join(privateRoot, `mizvo-recovery-${randomUUID()}.json`);
    const fd = openSync(path, "wx", 0o600);
    try {
      writeFileSync(fd, JSON.stringify(receipt, null, 2) + "\n");
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    console.log(`Offline recovery rehearsal passed. Private receipt: ${path}`);
  } finally {
    // Isolated copies hold entire sensitive databases. Never retain in /tmp
    // or commit them to git; the operator keeps only the private receipt.
    rmSync(work, { recursive: true, force: true });
  }
}

const [snapshot, privateDirectory, extra] = process.argv.slice(2);
if (!snapshot || !privateDirectory || extra) {
  console.error(usage);
  process.exitCode = 1;
} else {
  try {
    await drill(snapshot, privateDirectory);
  } catch (error) {
    console.error("Recovery rehearsal FAILED:", (error as Error).message);
    process.exitCode = 1;
  }
}
