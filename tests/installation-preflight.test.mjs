import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  symlink,
  writeFile,
  cp,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { verifyInstallation } from "../scripts/installation-preflight.mjs";

const repository = "devonalanakins/mizvo";
const commit = execFileSync("git", ["rev-parse", "HEAD"], {
  encoding: "utf8",
}).trim();
const tree = execFileSync("git", ["rev-parse", "HEAD^{tree}"], {
  encoding: "utf8",
}).trim();
const digest = (data) => createHash("sha256").update(data).digest("hex");

test("installation preflight rejects substitution, tampering and untrusted Git identities", async () => {
  const work = await mkdtemp(join(tmpdir(), "mizvo-install-preflight-"));
  const dist = join(work, "dist");
  const copy = join(work, "independent-copy");
  const manifest = join(work, "build-proof.json");
  const file = join(dist, "apps", "server.js");
  try {
    await mkdir(join(dist, "apps"), { recursive: true });
    await writeFile(file, "console.log('reviewed');\n");
    await writeFile(join(dist, "LICENSE"), "Synthetic license bytes\n");
    const created = spawnSync(
      process.execPath,
      ["scripts/artifact-proof.mjs", "create", dist, manifest],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          GITHUB_REPOSITORY: repository,
          GITHUB_SHA: commit,
        },
        encoding: "utf8",
        timeout: 30000,
      },
    );
    assert.equal(created.status, 0, created.stderr);
    const raw = await readFile(manifest);
    const trustedManifestSha256 = digest(raw);
    const args = {
      distribution: dist,
      manifest,
      trustedManifestSha256,
      expectedCommit: commit,
      expectedTree: tree,
      expectedRepository: repository,
    };
    let proof = await verifyInstallation(args);
    assert.equal(proof.passed, true);
    assert.equal(proof.files_verified, 2);
    assert.equal(proof.production_deployment_verified, false);

    await cp(dist, copy, { recursive: true });
    proof = await verifyInstallation({ ...args, distribution: copy });
    assert.equal(proof.files_verified, 2);

    await assert.rejects(
      () =>
        verifyInstallation({ ...args, trustedManifestSha256: "f".repeat(64) }),
      /independently trusted digest/,
    );
    await assert.rejects(
      () => verifyInstallation({ ...args, expectedCommit: "a".repeat(40) }),
      /commit does not match/,
    );
    await assert.rejects(
      () => verifyInstallation({ ...args, expectedTree: "b".repeat(40) }),
      /tree does not match/,
    );
    await assert.rejects(
      () =>
        verifyInstallation({ ...args, expectedRepository: "attacker/example" }),
      /repository does not match/,
    );

    await writeFile(file, "console.log('tampered');\n");
    await assert.rejects(
      () => verifyInstallation(args),
      /exact-byte verification/,
    );
    await writeFile(file, "console.log('reviewed');\n");
    await writeFile(join(dist, "unexpected.txt"), "not in manifest");
    await assert.rejects(
      () => verifyInstallation(args),
      /exact-byte verification/,
    );
    await rm(join(dist, "unexpected.txt"));
    await rm(file);
    await assert.rejects(
      () => verifyInstallation(args),
      /exact-byte verification/,
    );
    await writeFile(file, "console.log('reviewed');\n");
    await symlink(file, join(dist, "unsafe-link"));
    await assert.rejects(
      () => verifyInstallation(args),
      /exact-byte verification/,
    );
    await rm(join(dist, "unsafe-link"));

    const altered = JSON.parse(raw.toString("utf8"));
    altered.source.checkout_commit = "c".repeat(40);
    await writeFile(manifest, JSON.stringify(altered));
    await assert.rejects(
      () => verifyInstallation(args),
      /independently trusted digest/,
    );
    const poisonedManifestSha256 = digest(await readFile(manifest));
    await assert.rejects(
      () =>
        verifyInstallation({
          ...args,
          trustedManifestSha256: poisonedManifestSha256,
        }),
      /commit does not match/,
    );
    await rm(manifest);
    await symlink(file, manifest);
    await assert.rejects(
      () => verifyInstallation(args),
      /Manifest must be a regular file/,
    );
  } finally {
    await rm(work, { recursive: true, force: true });
  }
});

test("installation preflight CLI requires all independent trust anchors", async () => {
  const bad = spawnSync(
    process.execPath,
    ["scripts/installation-preflight.mjs", "dist", "build-proof.json"],
    { encoding: "utf8", timeout: 10000 },
  );
  assert.equal(bad.status, 2);
  assert.match(bad.stderr, /trusted-manifest-sha256/);
});
