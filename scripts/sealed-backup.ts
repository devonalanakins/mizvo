// Operator-only encrypted SQLite backup archive. No network or key generation.
// A sealed archive is NOT proof of off-host storage, key escrow or disaster recovery.
import { DatabaseSync } from "node:sqlite";
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  randomUUID,
} from "node:crypto";
import {
  chmodSync,
  closeSync,
  constants,
  fstatSync,
  fsyncSync,
  linkSync,
  lstatSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeSync,
} from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const MAGIC = Buffer.from("MIZVOSEAL1\n");
const NONCE_SIZE = 12;
const TAG_SIZE = 16;
const HEADER_SIZE = MAGIC.length + NONCE_SIZE;
const CHUNK_SIZE = 64 * 1024;
// Conservative per-nonce AES-GCM cap, well below the cipher's maximum.
const MAX_ARCHIVE = 16 * 1024 * 1024 * 1024;
const MAX_SNAPSHOT = MAX_ARCHIVE - HEADER_SIZE - TAG_SIZE;

function requireAbsolute(value: string, name: string): string {
  if (!isAbsolute(value)) throw new Error(name + " must use an absolute path.");
  return resolve(value);
}

function regularFile(path: string, name: string) {
  const entry = lstatSync(path);
  if (!entry.isFile() || entry.isSymbolicLink())
    throw new Error(name + " must be a regular file, not a symlink.");
  const limit = name === "Snapshot" ? MAX_SNAPSHOT : MAX_ARCHIVE;
  if (entry.size < 100 || entry.size > limit)
    throw new Error(name + " size is outside allowed limits.");
  return entry;
}

function privateDirectory(path: string, name: string) {
  const entry = lstatSync(path);
  if (!entry.isDirectory() || entry.isSymbolicLink())
    throw new Error(name + " must be an existing real directory.");
  if (process.platform === "win32")
    throw new Error(
      "The encrypted archive CLI requires POSIX file permissions.",
    );
  if ((entry.mode & 0o077) !== 0)
    throw new Error(name + " must be owner-only (mode 0700).");
  if (process.getuid && entry.uid !== process.getuid())
    throw new Error(name + " must be owned by the current user.");
  if (realpathSync(path) !== path)
    throw new Error(name + " must not traverse directory symlinks.");
}

// lstat sees dangling symlinks that existsSync misses. Never allow a stale
// SQLite sidecar name to redirect later database writes outside recovery.
function occupiedPath(path: string): boolean {
  try {
    lstatSync(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

function readKey(path: string): Buffer {
  const entry = lstatSync(path);
  if (!entry.isFile() || entry.isSymbolicLink() || entry.size !== 32)
    throw new Error("Key must be a 32-byte regular file, not a symlink.");
  if ((entry.mode & 0o077) !== 0)
    throw new Error("Key must be owner-only (mode 0600).");
  if (process.getuid && entry.uid !== process.getuid())
    throw new Error("Key must be owned by the current user.");
  const fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const opened = fstatSync(fd);
    if (
      !opened.isFile() ||
      opened.dev !== entry.dev ||
      opened.ino !== entry.ino ||
      opened.size !== 32 ||
      (opened.mode & 0o077) !== 0 ||
      (process.getuid && opened.uid !== process.getuid())
    )
      throw new Error("Key changed or became accessible during opening.");
    const key = Buffer.alloc(32);
    if (readSync(fd, key, 0, key.length, 0) !== key.length)
      throw new Error("Key contents are incomplete.");
    if (key.every((value) => value === key[0]))
      throw new Error("Refusing a trivially predictable encryption key.");
    return key;
  } finally {
    closeSync(fd);
  }
}

function writeAll(fd: number, bytes: Buffer) {
  let offset = 0;
  while (offset < bytes.length) {
    const written = writeSync(fd, bytes, offset, bytes.length - offset);
    if (written <= 0) throw new Error("Could not complete archive write.");
    offset += written;
  }
}

function openRegular(path: string, name: string) {
  const before = regularFile(path, name);
  const fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  const after = fstatSync(fd);
  if (!after.isFile() || before.dev !== after.dev || before.ino !== after.ino) {
    closeSync(fd);
    throw new Error(name + " changed while being opened.");
  }
  return { fd, size: after.size };
}

function fileSha256(path: string): string {
  const source = openRegular(path, "File");
  const digest = createHash("sha256");
  const chunk = Buffer.allocUnsafe(CHUNK_SIZE);
  try {
    for (;;) {
      const length = readSync(source.fd, chunk, 0, chunk.length, null);
      if (!length) break;
      digest.update(chunk.subarray(0, length));
    }
  } finally {
    closeSync(source.fd);
  }
  return digest.digest("hex");
}

function validateSnapshot(path: string) {
  const before = regularFile(path, "Snapshot");
  if (occupiedPath(path + "-wal") || occupiedPath(path + "-shm"))
    throw new Error(
      "Snapshot has active SQLite sidecars; use the online backup tool.",
    );
  if ((before.mode & 0o077) !== 0)
    throw new Error("Snapshot must be owner-only (mode 0600).");
  const database = new DatabaseSync(path, { readOnly: true });
  try {
    if (
      database.prepare("PRAGMA integrity_check").get()?.integrity_check !== "ok"
    )
      throw new Error("SQLite integrity check failed.");
    if (database.prepare("PRAGMA foreign_key_check").all().length)
      throw new Error("SQLite foreign key check failed.");
    if (
      database.prepare("PRAGMA journal_mode").get()?.journal_mode !== "delete"
    )
      throw new Error("Backup must have a detached DELETE journal mode.");
    const folder = fileURLToPath(
      new URL("../packages/storage/", import.meta.url),
    );
    const names = readdirSync(folder)
      .filter((name) => /^\d{3}-.+\.sql$/.test(name))
      .sort();
    const migrations = database
      .prepare(
        "SELECT version,checksum FROM migration_checksums ORDER BY version",
      )
      .all() as Array<{ version: number; checksum: string }>;
    const applied = database
      .prepare("SELECT version FROM migrations ORDER BY version")
      .all() as Array<{ version: number }>;
    if (names.length !== migrations.length || names.length !== applied.length)
      throw new Error("Snapshot migrations do not match this release.");
    for (let i = 0; i < names.length; i++) {
      const name = names[i]!;
      const version = Number(name.slice(0, 3));
      const checksum = createHash("sha256")
        .update(readFileSync(join(folder, name)))
        .digest("hex");
      if (
        migrations[i]?.version !== version ||
        applied[i]?.version !== version ||
        migrations[i]?.checksum !== checksum
      )
        throw new Error(
          "Snapshot migration checksum does not match this release.",
        );
    }
    return { migrations: names.length };
  } finally {
    database.close();
  }
}

function encrypt(snapshot: string, target: string, key: Buffer) {
  const source = openRegular(snapshot, "Snapshot");
  const output = openSync(target, "wx", 0o600);
  const nonce = randomBytes(NONCE_SIZE);
  const header = Buffer.concat([MAGIC, nonce]);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  cipher.setAAD(header);
  const chunk = Buffer.allocUnsafe(CHUNK_SIZE);
  try {
    writeAll(output, header);
    for (;;) {
      const length = readSync(source.fd, chunk, 0, chunk.length, null);
      if (!length) break;
      writeAll(output, cipher.update(chunk.subarray(0, length)));
    }
    writeAll(output, cipher.final());
    writeAll(output, cipher.getAuthTag());
    fsyncSync(output);
  } finally {
    closeSync(source.fd);
    closeSync(output);
  }
}

function decrypt(archive: string, target: string, key: Buffer) {
  const encrypted = openRegular(archive, "Archive");
  if (encrypted.size <= HEADER_SIZE + TAG_SIZE + 100) {
    closeSync(encrypted.fd);
    throw new Error("Sealed archive is too short.");
  }
  const output = openSync(target, "wx", 0o600);
  const header = Buffer.alloc(HEADER_SIZE);
  const tag = Buffer.alloc(TAG_SIZE);
  const chunk = Buffer.allocUnsafe(CHUNK_SIZE);
  try {
    if (
      readSync(encrypted.fd, header, 0, header.length, 0) !== header.length ||
      !header.subarray(0, MAGIC.length).equals(MAGIC)
    )
      throw new Error("Unrecognized sealed archive format.");
    if (
      readSync(encrypted.fd, tag, 0, tag.length, encrypted.size - TAG_SIZE) !==
      TAG_SIZE
    )
      throw new Error("Incomplete archive authentication tag.");
    const nonce = header.subarray(MAGIC.length);
    const decipher = createDecipheriv("aes-256-gcm", key, nonce);
    decipher.setAAD(header);
    decipher.setAuthTag(tag);
    let offset = HEADER_SIZE;
    const end = encrypted.size - TAG_SIZE;
    while (offset < end) {
      const size = Math.min(chunk.length, end - offset);
      const length = readSync(encrypted.fd, chunk, 0, size, offset);
      if (!length) throw new Error("Truncated sealed archive.");
      writeAll(output, decipher.update(chunk.subarray(0, length)));
      offset += length;
    }
    // Authentication is not accepted until final() succeeds; the temporary
    // plaintext is never returned or published before this point.
    writeAll(output, decipher.final());
    fsyncSync(output);
  } finally {
    closeSync(encrypted.fd);
    closeSync(output);
  }
}

type ArchiveCheck = {
  snapshot_sha256: string;
  snapshot_size_bytes: number;
  migration_count: number;
  isolated_sessions_invalidated: boolean;
  offline_database_published?: boolean;
  restored_sha256?: string;
};

function checkArchive(
  archive: string,
  key: Buffer,
  directory: string,
  publishPath?: string,
): ArchiveCheck {
  privateDirectory(directory, "Recovery directory");
  const work = mkdtempSync(join(directory, ".mizvo-unseal-"));
  chmodSync(work, 0o700);
  const restored = join(work, "isolated.sqlite");
  try {
    decrypt(archive, restored, key);
    const snapshot = validateSnapshot(restored);
    const sha = fileSha256(restored);
    // No application sessions from a restored snapshot may become trusted.
    const database = new DatabaseSync(restored);
    try {
      database.exec("PRAGMA foreign_keys=ON; BEGIN IMMEDIATE;");
      try {
        database.exec("DELETE FROM sessions; COMMIT;");
      } catch (e) {
        database.exec("ROLLBACK");
        throw e;
      }
      if (
        (database.prepare("SELECT COUNT(*) AS count FROM sessions").get()
          ?.count ?? -1) !== 0
      )
        throw new Error("Recovery session invalidation failed.");
    } finally {
      database.close();
    }
    // Offline restore is opt-in and may publish only after authentication,
    // schema validation, and session invalidation have succeeded.
    // The temporary plaintext always stays inside the owner-only directory.
    if (publishPath) {
      validateSnapshot(restored);
      if (
        occupiedPath(publishPath + "-wal") ||
        occupiedPath(publishPath + "-shm")
      )
        throw new Error("Restored database destination has SQLite sidecars.");
      const restoredSha256 = fileSha256(restored);
      const fd = openSync(restored, constants.O_RDONLY);
      try {
        fsyncSync(fd);
      } finally {
        closeSync(fd);
      }
      // An exclusive hard link is atomic on the same filesystem and rejects
      // pre-existing files, directories, and even dangling symlinks.
      linkSync(restored, publishPath);
      return {
        snapshot_sha256: sha,
        restored_sha256: restoredSha256,
        snapshot_size_bytes: lstatSync(restored).size,
        migration_count: snapshot.migrations,
        isolated_sessions_invalidated: true,
        offline_database_published: true,
      };
    }
    return {
      snapshot_sha256: sha,
      snapshot_size_bytes: lstatSync(restored).size,
      migration_count: snapshot.migrations,
      isolated_sessions_invalidated: true,
    };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

function seal(snapshot: string, archive: string, key: Buffer) {
  privateDirectory(dirname(snapshot), "Snapshot directory");
  privateDirectory(dirname(archive), "Archive directory");
  const before = fileSha256(snapshot);
  validateSnapshot(snapshot);
  const work = mkdtempSync(join(dirname(archive), ".mizvo-seal-"));
  chmodSync(work, 0o700);
  const candidate = join(work, "encrypted.mzseal");
  try {
    encrypt(snapshot, candidate, key);
    const check = checkArchive(candidate, key, work);
    if (before !== check.snapshot_sha256 || fileSha256(snapshot) !== before)
      throw new Error("Snapshot changed while being sealed.");
    linkSync(candidate, archive); // atomic, exclusive, refuses dangling symlinks
    return { archive_sha256: fileSha256(archive), ...check };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

const [command, input, second, third, ...extra] = process.argv.slice(2);
const usage =
  "Usage: seal <absolute-snapshot.sqlite> <absolute-new-archive.mzseal> <absolute-32-byte-key> | verify <absolute-archive.mzseal> <absolute-key> <absolute-private-recovery-directory> | restore <absolute-archive.mzseal> <absolute-key> <absolute-new-offline.sqlite>";

if (
  !["seal", "verify", "restore"].includes(command ?? "") ||
  !input ||
  !second ||
  !third ||
  extra.length
) {
  console.error(usage);
  process.exitCode = 2;
} else {
  let key: Buffer | undefined;
  try {
    const source = requireAbsolute(input, "Input");
    const destination = requireAbsolute(second, "Destination/key");
    const thirdPath = requireAbsolute(third, "Key/recovery directory");
    const keyPath = command === "seal" ? thirdPath : destination;
    const unique = new Set([source, destination, thirdPath]);
    if (unique.size !== 3)
      throw new Error("Snapshot, archive, key and recovery paths must differ.");
    key = readKey(keyPath);
    if (command === "restore") {
      if (!thirdPath.endsWith(".sqlite"))
        throw new Error("Offline restore requires a new .sqlite destination.");
      privateDirectory(dirname(thirdPath), "Offline restore directory");
      if (occupiedPath(thirdPath + "-wal") || occupiedPath(thirdPath + "-shm"))
        throw new Error("Restored database destination has SQLite sidecars.");
      const result = checkArchive(source, key, dirname(thirdPath), thirdPath);
      if (!result.offline_database_published || !result.restored_sha256)
        throw new Error("Offline restore publication was not verified.");
      console.log(
        JSON.stringify({
          schema: "mizvo.sealed-offline-restore.v1",
          archive_sha256: fileSha256(source),
          snapshot_sha256: result.snapshot_sha256,
          restored_sha256: result.restored_sha256,
          migration_count: result.migration_count,
          isolated_sessions_invalidated: result.isolated_sessions_invalidated,
          offline_database_published: true,
          actual_production_recovery_verified: false,
          external_off_host_transport_verified: false,
          release_approved: false,
        }),
      );
    } else if (command === "seal") {
      const result = seal(source, destination, key);
      console.log(
        JSON.stringify({
          schema: "mizvo.sealed-backup.v1",
          archive_sha256: result.archive_sha256,
          snapshot_sha256: result.snapshot_sha256,
          migration_count: result.migration_count,
          authentication: "aes-256-gcm",
          encrypted_archive_published_exclusively: true,
          independently_off_host_verified: false,
          key_escrow_verified: false,
          disaster_recovery_approved: false,
        }),
      );
    } else {
      const result = checkArchive(source, key, thirdPath);
      const privatePath = join(
        thirdPath,
        "mizvo-sealed-verify-" + randomUUID() + ".json",
      );
      const receipt = {
        schema: "mizvo.sealed-backup-check.v1",
        observed_at: new Date().toISOString(),
        archive_sha256: fileSha256(source),
        ...result,
        authentication: "aes-256-gcm",
        isolated_restore_only: true,
        off_host_verified: false,
        real_service_restored: false,
        approval_to_deploy: false,
      };
      const fd = openSync(privatePath, "wx", 0o600);
      try {
        writeAll(fd, Buffer.from(JSON.stringify(receipt, null, 2) + "\n"));
        fsyncSync(fd);
      } finally {
        closeSync(fd);
      }
      console.log(
        "PASS: encrypted archive authenticated, private SQLite recovery checked and temporary plaintext deleted.",
      );
    }
  } catch (error) {
    console.error("Sealed-backup operation failed:", (error as Error).message);
    process.exitCode = 1;
  } finally {
    key?.fill(0);
  }
}
