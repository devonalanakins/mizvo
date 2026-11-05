import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { lstat, readdir, readFile, writeFile } from "node:fs/promises";
import { join, posix, resolve } from "node:path";

const FORMAT = "mizvo.artifact-integrity.v1";
const MAX_FILES = 10000;
const MAX_FILE_BYTES = 32 * 1024 * 1024;
const MAX_TOTAL_BYTES = 256 * 1024 * 1024;
const HASH = /^[a-f0-9]{64}$/;
const GIT_SHA = /^[a-f0-9]{40}$/;

function digest(data) {
  return createHash("sha256").update(data).digest("hex");
}

function requireValid(condition, message) {
  if (!condition) throw new Error(message);
}

function validPath(path) {
  return (
    typeof path === "string" &&
    path.length > 0 &&
    path.length <= 1000 &&
    !path.includes("\\") &&
    !path.includes("\0") &&
    !path.startsWith("/") &&
    !path.split("/").includes("..") &&
    !path.split("/").includes(".") &&
    posix.normalize(path) === path
  );
}

async function scan(root) {
  const base = resolve(root);
  requireValid((await lstat(base)).isDirectory(), "Artifact root must be a real directory.");
  const files = [];
  let total = 0;

  async function visit(folder, prefix) {
    const entries = (await readdir(folder, { withFileTypes: true })).sort((a, b) =>
      a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
    );
    for (const entry of entries) {
      const path = prefix ? prefix + "/" + entry.name : entry.name;
      requireValid(validPath(path), "Unsafe artifact path.");
      const absolute = join(folder, entry.name);
      const stat = await lstat(absolute);
      requireValid(!stat.isSymbolicLink(), "Artifact contains a symbolic link.");
      if (stat.isDirectory()) {
        await visit(absolute, path);
      } else {
        requireValid(stat.isFile(), "Artifact contains a non-regular file.");
        requireValid(stat.size <= MAX_FILE_BYTES, "Artifact file exceeds byte limit.");
        total += stat.size;
        requireValid(total <= MAX_TOTAL_BYTES, "Artifact exceeds byte limit.");
        requireValid(files.length < MAX_FILES, "Artifact has too many files.");
        const bytes = await readFile(absolute);
        requireValid(bytes.byteLength === stat.size, "Artifact changed while reading.");
        files.push({ path, bytes: bytes.byteLength, sha256: digest(bytes) });
      }
    }
  }
  await visit(base, "");
  files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  requireValid(files.length > 0, "Artifact has no files.");
  return files;
}

function commitIdentity() {
  const git = (...args) =>
    execFileSync("git", ["rev-parse", ...args], { encoding: "utf8" }).trim();
  const checkout_commit = git("HEAD");
  const checkout_tree = git("HEAD^{tree}");
  requireValid(GIT_SHA.test(checkout_commit) && GIT_SHA.test(checkout_tree), "Invalid Git identity.");
  const reported = process.env.GITHUB_SHA;
  requireValid(!reported || reported === checkout_commit, "CI checkout does not match GITHUB_SHA.");
  return { checkout_commit, checkout_tree };
}

function validateProof(proof) {
  requireValid(proof && typeof proof === "object" && !Array.isArray(proof), "Invalid artifact proof.");
  requireValid(proof.schema === FORMAT, "Unknown artifact proof schema.");
  requireValid(
    proof.source &&
      GIT_SHA.test(proof.source.checkout_commit) &&
      GIT_SHA.test(proof.source.checkout_tree) &&
      HASH.test(proof.source.lockfile_sha256) &&
      (proof.source.repository === null ||
        /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(proof.source.repository)),
    "Invalid source identity.",
  );
  requireValid(
    Array.isArray(proof.files) &&
      proof.files.length > 0 &&
      proof.files.length <= MAX_FILES &&
      HASH.test(proof.file_set_sha256),
    "Invalid artifact inventory.",
  );
  let previous = "";
  let total = 0;
  for (const item of proof.files) {
    requireValid(
      item && validPath(item.path) && item.path > previous &&
        Number.isSafeInteger(item.bytes) && item.bytes >= 0 &&
        item.bytes <= MAX_FILE_BYTES && HASH.test(item.sha256),
      "Invalid, repeated or unsafe artifact entry.",
    );
    total += item.bytes;
    requireValid(total <= MAX_TOTAL_BYTES, "Artifact exceeds byte limit.");
    previous = item.path;
  }
  requireValid(
    digest(JSON.stringify(proof.files)) === proof.file_set_sha256,
    "Artifact manifest fingerprint mismatch.",
  );
}

async function create(root, location) {
  const files = await scan(root);
  const source = {
    ...commitIdentity(),
    lockfile_sha256: digest(await readFile("package-lock.json")),
    repository: process.env.GITHUB_REPOSITORY || null,
  };
  const proof = {
    schema: FORMAT,
    source,
    ci: {
      run_id: process.env.GITHUB_RUN_ID || null,
      run_attempt: process.env.GITHUB_RUN_ATTEMPT || null,
      event: process.env.GITHUB_EVENT_NAME || null,
    },
    files,
    file_set_sha256: digest(JSON.stringify(files)),
  };
  validateProof(proof);
  await writeFile(location, JSON.stringify(proof, null, 2) + "\n", { flag: "w" });
  console.log("Created artifact manifest for " + files.length + " files; checkout " + source.checkout_commit);
}

async function verify(root, location) {
  const raw = await readFile(location);
  requireValid(raw.byteLength <= 5 * 1024 * 1024, "Manifest is too large.");
  const proof = JSON.parse(raw.toString("utf8"));
  validateProof(proof);
  const actual = await scan(root);
  requireValid(JSON.stringify(actual) === JSON.stringify(proof.files), "Artifact bytes or file set do not match manifest.");
  console.log("PASS: " + actual.length + " compiled files match the recorded SHA-256 inventory.");
  console.log("Checkout: " + proof.source.checkout_commit + " (" + proof.source.checkout_tree + ").");
  console.log("Integrity only: no signature, deployment, or release approval is implied.");
}

const [mode, root = "dist", location = "build-proof.json", extra] = process.argv.slice(2);
if (!["create", "verify"].includes(mode) || extra !== undefined) {
  console.error("Usage: node scripts/artifact-proof.mjs create|verify [dist-directory] [manifest-path]");
  process.exitCode = 2;
} else {
  try {
    if (mode === "create") await create(root, location);
    else await verify(root, location);
  } catch (error) {
    console.error("Artifact integrity check failed: " + error.message);
    process.exitCode = 1;
  }
}
