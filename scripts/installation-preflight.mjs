import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { lstat, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HASH = /^[a-f0-9]{64}$/;
const GIT_SHA = /^[a-f0-9]{40}$/;
const REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const FORMAT = "mizvo.artifact-integrity.v1";
const MAX_MANIFEST = 5 * 1024 * 1024;

function check(value, message) {
  if (!value) throw new Error(message);
}

function hash(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * Local byte-level preflight. Trusted anchors MUST be obtained independently
 * of the downloaded distribution/manifest. Does not attest a running process.
 * The verifier is loaded from this reviewed tooling checkout, not dist/.
 */
export async function verifyInstallation({
  distribution,
  manifest,
  trustedManifestSha256,
  expectedCommit,
  expectedTree,
  expectedRepository,
}) {
  check(
    HASH.test(trustedManifestSha256),
    "Expected a trusted 64-character manifest digest.",
  );
  check(
    GIT_SHA.test(expectedCommit) && GIT_SHA.test(expectedTree),
    "Expected exact Git commit and tree identifiers.",
  );
  check(
    REPOSITORY.test(expectedRepository),
    "Expected an exact trusted repository identifier.",
  );
  const directory = resolve(distribution);
  const manifestPath = resolve(manifest);
  const [directoryStat, manifestStat] = await Promise.all([
    lstat(directory),
    lstat(manifestPath),
  ]);
  check(
    directoryStat.isDirectory() && !directoryStat.isSymbolicLink(),
    "Candidate root must be a real directory.",
  );
  check(
    manifestStat.isFile() && !manifestStat.isSymbolicLink(),
    "Manifest must be a regular file.",
  );
  check(
    manifestStat.size > 0 && manifestStat.size <= MAX_MANIFEST,
    "Manifest size is invalid.",
  );
  const raw = await readFile(manifestPath);
  check(raw.length === manifestStat.size, "Manifest changed while being read.");
  check(
    hash(raw) === trustedManifestSha256,
    "Candidate manifest does not match the independently trusted digest.",
  );
  let parsed;
  try {
    parsed = JSON.parse(raw.toString("utf8"));
  } catch {
    throw new Error("Manifest is not valid JSON.");
  }
  check(parsed && parsed.schema === FORMAT, "Unsupported manifest schema.");
  check(
    parsed.source?.repository === expectedRepository,
    "Manifest repository does not match the approved repository.",
  );
  check(
    parsed.source?.checkout_commit === expectedCommit,
    "Manifest commit does not match the approved checkout.",
  );
  check(
    parsed.source?.checkout_tree === expectedTree,
    "Manifest tree does not match the approved source tree.",
  );
  const trustedVerifier = fileURLToPath(
    new URL("./artifact-proof.mjs", import.meta.url),
  );
  const result = spawnSync(
    process.execPath,
    [trustedVerifier, "verify", directory, manifestPath],
    { encoding: "utf8", timeout: 60000, maxBuffer: 32 * 1024 },
  );
  check(
    result.status === 0,
    "Installed files or manifest failed exact-byte verification.",
  );
  return {
    schema: "mizvo.installation-preflight.v1",
    checkout_commit: expectedCommit,
    checkout_tree: expectedTree,
    repository: expectedRepository,
    manifest_sha256: trustedManifestSha256,
    files_verified: parsed.files.length,
    passed: true,
    production_deployment_verified: false,
  };
}

const invocation = process.argv[1] ? resolve(process.argv[1]) : "";
if (invocation === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.length !== 6) {
    console.error(
      "Usage: node scripts/installation-preflight.mjs <dist> <proof.json> <trusted-manifest-sha256> <expected-checkout-sha> <expected-tree-sha> <repository>",
    );
    process.exitCode = 2;
  } else {
    try {
      const receipt = await verifyInstallation({
        distribution: args[0],
        manifest: args[1],
        trustedManifestSha256: args[2],
        expectedCommit: args[3],
        expectedTree: args[4],
        expectedRepository: args[5],
      });
      console.log(
        "PASS: " +
          receipt.files_verified +
          " installed candidate files matched trusted manifest and exact Git identity.",
      );
      console.log(
        "Not a signature, live-process attestation, or deployment approval.",
      );
    } catch (error) {
      console.error("Installation preflight failed: " + error.message);
      process.exitCode = 1;
    }
  }
}
