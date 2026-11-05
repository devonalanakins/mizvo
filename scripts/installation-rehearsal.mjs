// CI-only synthetic installation gate; no real customer directories or accounts.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { verifyInstallation } from "./installation-preflight.mjs";

const evidence = resolve("docs/evidence/installation-preflight.json");
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

async function main() {
  assert.equal(
    process.argv.length,
    2,
    "Synthetic installation test accepts no arguments.",
  );
  const expectedRepository = process.env.GITHUB_REPOSITORY;
  assert.equal(
    expectedRepository,
    "devonalanakins/mizvo",
    "Run in Mizvo's verified CI checkout with repository identity.",
  );
  const expectedCommit = execFileSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim();
  const expectedTree = execFileSync("git", ["rev-parse", "HEAD^{tree}"], {
    encoding: "utf8",
  }).trim();
  assert(
    !process.env.GITHUB_SHA || process.env.GITHUB_SHA === expectedCommit,
    "GitHub run identity differs from checked-out source.",
  );
  const original = resolve("build-proof.json");
  const trustedManifestSha256 = sha256(await readFile(original));
  const work = await mkdtemp(join(tmpdir(), "mizvo-install-candidate-"));
  try {
    const distribution = join(work, "candidate");
    const manifest = join(work, "candidate-proof.json");
    await cp(resolve("dist"), distribution, { recursive: true });
    await cp(original, manifest, { force: false });
    const args = {
      distribution,
      manifest,
      trustedManifestSha256,
      expectedCommit,
      expectedTree,
      expectedRepository,
    };
    const passed = await verifyInstallation(args);
    assert(passed.passed && passed.files_verified > 0);
    await writeFile(join(distribution, "extra-unreviewed.txt"), "unexpected");
    await assert.rejects(
      () => verifyInstallation(args),
      /exact-byte verification/,
      "Unreviewed file injection must invalidate the candidate.",
    );

    await mkdir(resolve("docs/evidence"), { recursive: true });
    await writeFile(
      evidence,
      JSON.stringify(
        {
          ...passed,
          observed_at: new Date().toISOString(),
          scope: "Synthetic copied installation, using the exact CI checkout.",
          externally_trusted_digest_obtained: false,
          live_process_identity_verified: false,
          release_approval: false,
          tampering_negative_case_rejected: true,
          limitations: [
            "The expected manifest digest was computed within the same CI job; it is not an independent signature.",
            "An operator must obtain manifest digest and Git source identity from a trusted review channel, not from the downloaded artifact.",
            "This preflight checks installed bytes before startup and cannot prevent later modification or prove remote deployed bytes.",
          ],
        },
        null,
        2,
      ) + "\n",
    );
    console.log(
      "PASS: copied compiled installation matched manifest and exact source; injected file rejected.",
    );
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

try {
  await main();
} catch {
  console.error(
    "FAIL: synthetic installation preflight. No candidate is approved.",
  );
  process.exitCode = 1;
}
