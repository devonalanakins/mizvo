import { execFileSync, spawnSync } from "node:child_process";
import { readFile, writeFile, readdir, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
const started = new Date().toISOString(),
  live = process.env.MIZVO_VERIFY_GITHUB === "1";
const commands = [
  ["npm", ["ci", "--ignore-scripts"]],
  ["npm", ["run", "lint"]],
  ["npm", ["run", "typecheck"]],
  ["npm", ["test"]],
  ["npm", ["run", "build"]],
  ["npm", ["run", "test:distribution"]],
  ["npm", ["run", "artifact:create"]],
  ["npm", ["run", "artifact:verify"]],
  ["npm", ["run", "test:installation"]],
  ["npm", ["run", "test:staging"]],
  ["npm", ["run", "test:tls"]],
  ["npm", ["run", "test:container"]],
  ["npm", ["run", "test:browser"]],
  ["npm", ["run", "test:browser"], { MIZVO_BROWSER: "webkit" }],
  ...(live ? [["npm", ["run", "verify:github"]]] : []),
  ["npm", ["audit", "--json"]],
];
const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim();
const sourceIdentity = {
  checkout_commit: git("rev-parse", "HEAD"),
  checkout_tree: git("rev-parse", "HEAD^{tree}"),
  source_worktree_dirty: !!git(
    "status",
    "--porcelain",
    "--",
    "apps",
    "packages",
    "scripts",
    "tests",
    ".github",
    "package.json",
    "package-lock.json",
    "tsconfig.json",
  ),
};
const results = [];
let transcript = "";
for (const [command, args, environment] of commands) {
  const before = Date.now();
  const result = spawnSync(command, args, {
    encoding: "utf8",
    env: { ...process.env, ...environment },
    timeout: 180000,
    maxBuffer: 8 * 1024 * 1024,
  });
  const output = (result.stdout ?? "") + (result.stderr ?? "");
  const label =
    (environment ? "MIZVO_BROWSER=webkit " : "") + [command, ...args].join(" ");
  results.push({
    command: label,
    exit_code: result.status,
    duration_ms: Date.now() - before,
  });
  transcript += `$ ${label}\n${output}\nEXIT ${result.status}\n\n`;
  console.log(`${result.status === 0 ? "PASS" : "FAIL"} ${label}`);
  if (result.status !== 0) break;
}
const manifest = {};
async function walk(path) {
  for (const ent of await readdir(path, { withFileTypes: true })) {
    const next = path + "/" + ent.name;
    if (ent.isDirectory()) await walk(next);
    else
      manifest[next] = createHash("sha256")
        .update(await readFile(next))
        .digest("hex");
  }
}
for (const path of ["apps", "packages", "scripts", "tests", ".github"])
  await walk(path);
for (const path of ["package.json", "package-lock.json", "tsconfig.json"])
  manifest[path] = createHash("sha256")
    .update(await readFile(path))
    .digest("hex");
await mkdir("docs/evidence", { recursive: true });
await writeFile("docs/evidence/checks.log", transcript);
await writeFile(
  "docs/evidence/verification.json",
  JSON.stringify(
    {
      started_at: started,
      finished_at: new Date().toISOString(),
      source: sourceIdentity,
      runtime: process.version,
      platform: process.platform,
      architecture: process.arch,
      scope:
        "local review build; no remote CI or production deployment claimed",
      live_public_github: live,
      results,
      source_files_sha256: manifest,
    },
    null,
    2,
  ),
);
if (
  results.length !== commands.length ||
  results.some((r) => r.exit_code !== 0)
)
  process.exitCode = 1;
