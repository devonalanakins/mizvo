import { writeFile } from "node:fs/promises";
import { GitHub } from "../apps/api/github.ts";
const repository = "devonalanakins/mizvo",
  github = new GitHub([repository]);
const evidence = await github.evidence(repository);
const branch = evidence.branches.find(
  (b: any) => b.name === "design/solo-online-studio-v0-4",
);
if (!branch) throw new Error("Expected design branch not returned.");
const source = await github.source(repository, "README.md", branch.sha);
const checks = await github.read(
  repository,
  `commits/${branch.sha}/check-runs`,
);
const comparison = await github.read(
  repository,
  `compare/${evidence.commits[0].sha}...${branch.sha}`,
);
const receipt = {
  ...evidence,
  source: { path: source.path, sha: source.sha, type: source.type },
  check_runs: checks.check_runs.map((r: any) => ({
    name: r.name,
    status: r.status,
    conclusion: r.conclusion,
    url: r.html_url,
  })),
  comparison: {
    status: comparison.status,
    total_commits: comparison.total_commits,
    files: comparison.files.map((f: any) => f.filename),
  },
  limitations:
    "Read-only public repository integration; no private GitHub App credentials, write, runner execution, deployment or CI pass is claimed.",
};
await writeFile(
  "docs/evidence/github-observed.json",
  JSON.stringify(receipt, null, 2),
);
console.log(
  "Verified live public GitHub branches, commits, PRs, source, compare and check-runs endpoints.",
);
