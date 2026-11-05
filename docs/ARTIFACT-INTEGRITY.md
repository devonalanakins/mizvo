# Candidate build integrity — source and compiled bytes

## What is implemented

GitHub CI compiles the standalone Node/SQLite application, checks that an independently copied distribution actually runs, and creates a manifest of **every byte of every regular file in dist/**. The manifest contains a sorted file-path, byte-count and SHA-256 inventory; a separate SHA-256 fingerprints the inventory. CI then verifies the files against that manifest before its browser and dependency checks and uploads the compiled `dist/` folder plus `build-proof.json` only after all checks pass.

The manifest also names the **actual checked-out Git commit and tree** (`git rev-parse HEAD`), the exact package-lock SHA-256, and the GitHub run metadata when available. If the workflow checks out a synthetic pull-request merge commit, the recorded source is **that merge commit**, not necessarily the PR branch head. It must never be silently treated as proof that a release associated with the PR head SHA was built. A release/preview binding must compare exact commit identities before approval.

This mechanism proves byte integrity relative to a particular manifest and CI evidence. **It is not a cryptographic signature**: anyone who can replace both the files and manifest can recompute all hashes. Source-to-binary reproducibility is not guaranteed, an artifact download URL alone is not authorization, and the workflow has not deployed anything or signed an attestation.

## Local verification

With Node 24 and a repository checkout:

```sh
npm ci
npm run build
npm run test:distribution
npm run artifact:create
npm run artifact:verify
```

To check downloaded CI bytes, extract the GitHub Actions artifact to a new directory and use the **trusted verifier from the repository**, not a modified verifier bundled with an untrusted download:

```sh
node scripts/artifact-proof.mjs verify /path/to/extracted/dist /path/to/extracted/build-proof.json
```

The verifier rejects changed bytes (including same-size changes), missing or extra files, unsupported manifest versions, duplicate/traversal paths, symlinks, nonregular files and unreasonable file sizes. All entries must match exactly. Client data, session keys, repository tokens and runtime databases must never be placed in the public distribution.

## Release decision still required

1. Independently inspect the trusted GitHub workflow run, commit/tree and the provider-reported artifact digest. Do not rely on user-submitted or copy/pasted manifests.
2. Confirm that the **actual** checkout commit recorded in the manifest equals the specific candidate commit approved for a release. A PR merge-check artifact often will not satisfy this requirement.
3. Confirm independent review/approval, production secrets and access controls, verified backups/rollback, and deployed byte identity. Do not equate an accepted client decision, source check, or passing build with a production rollout.

**Not implemented:** a signed OIDC/Sigstore or SLSA provenance attestation, a verified association with a Mizvo release record, immutable hosted delivery, separate trusted build execution, reproducible cross-run output, or post-deployment byte inspection. These remain separate release gates. No new privileged CI permissions, third-party dependencies, paid services, live accounts or deployments are introduced.
