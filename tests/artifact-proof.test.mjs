import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { cp, mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const script = "scripts/artifact-proof.mjs";
const run = (mode, directory, manifest) =>
  spawnSync(process.execPath, [script, mode, directory, manifest], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
const sha = (value) => createHash("sha256").update(value).digest("hex");

test("compiled artifact manifest binds checkout and detects tampering, omission, additions and unsafe paths", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "mizvo-artifact-proof-"));
  const root = join(workspace, "dist");
  const detached = join(workspace, "independent-copy");
  const manifest = join(workspace, "build-proof.json");
  const app = join(root, "apps/api/server.js");
  try {
    await mkdir(join(root, "apps/api"), { recursive: true });
    await writeFile(join(root, "LICENSE"), "Synthetic license fixture\n");
    await writeFile(app, "console.log('safe');\n");

    let result = run("create", root, manifest);
    assert.equal(result.status, 0, result.stderr);
    const proof = JSON.parse(await readFile(manifest, "utf8"));
    assert.equal(proof.schema, "mizvo.artifact-integrity.v1");
    assert.equal(
      proof.source.checkout_commit,
      execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
    );
    assert.equal(proof.source.lockfile_sha256, sha(await readFile("package-lock.json")));
    assert.equal(proof.files.length, 2);
    assert.equal(run("verify", root, manifest).status, 0);

    await cp(root, detached, { recursive: true });
    assert.equal(run("verify", detached, manifest).status, 0);

    await writeFile(app, "console.log('evil');\n");
    result = run("verify", root, manifest);
    assert.notEqual(result.status, 0, "Changed bytes must fail even with the same file length");
    await writeFile(app, "console.log('safe');\n");

    await writeFile(join(root, "unexpected.js"), "unreviewed");
    assert.notEqual(run("verify", root, manifest).status, 0, "Unlisted file must fail");
    await rm(join(root, "unexpected.js"));
    await rm(app);
    assert.notEqual(run("verify", root, manifest).status, 0, "Missing file must fail");
    await writeFile(app, "console.log('safe');\n");

    const poisoned = structuredClone(proof);
    poisoned.files[0].path = "../outside";
    poisoned.file_set_sha256 = sha(JSON.stringify(poisoned.files));
    await writeFile(manifest, JSON.stringify(poisoned));
    assert.notEqual(run("verify", root, manifest).status, 0, "Traversal must fail even with recomputed inventory hash");

    await writeFile(manifest, JSON.stringify(proof));
    await symlink(app, join(root, "unsafe-link"));
    assert.notEqual(run("verify", root, manifest).status, 0, "Symbolic links must be rejected");
    assert.notEqual(run("create", root, manifest).status, 0, "Creator must also reject links");
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test("malformed or unsupported proof cannot be treated as release evidence", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "mizvo-artifact-invalid-"));
  const root = join(workspace, "dist");
  const manifest = join(workspace, "build-proof.json");
  try {
    await mkdir(root);
    await writeFile(join(root, "index.js"), "test");
    await writeFile(manifest, '{"schema":"unknown","files":[]}');
    assert.notEqual(run("verify", root, manifest).status, 0);
    await writeFile(manifest, "{ invalid json");
    assert.notEqual(run("verify", root, manifest).status, 0);
    await writeFile(manifest, "x".repeat(5 * 1024 * 1024 + 1));
    assert.notEqual(run("verify", root, manifest).status, 0);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});
