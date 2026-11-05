# OCI image provenance: immutable base and embedded application bytes

**Status:** Implementation and CI-only verification. No image has been pushed to a registry, independently signed, installed on a customer host, or deployed publicly.

## Why this gate exists

A passing TypeScript build and SHA-256 inventory does not prove that a *Docker image* contains the same application files. Nor does a floating `node:24-bookworm-slim` tag prove which upstream runtime was used. Mizvo now requires two independent checks before treating a local OCI image as a candidate.

1. Both build and runtime `FROM` statements use the **same fixed multi-architecture Node image index digest**. The current digest, observed from `docker buildx imagetools inspect docker.io/library/node:24-bookworm-slim` in [GitHub Actions run 42058879792](https://github.com/devonalanakins/mizvo/actions/runs/42058879792) on November 5, 2026, is `sha256:01d566e8d94d8c619591d78652babfccd3c6992a3dffa9ed5ab39e11cf6c70e9`. That observation is public registry metadata, not an independent security signature or a guarantee about runtime safety.
2. The image records the **actual Git checkout commit/tree** in OCI labels. The test creates a stopped container, copies its complete `/app/dist` into a private temporary directory, then calls the **reviewed installation verifier** against the existing `build-proof.json`. Every compiled file name and SHA-256 must match. Invalid source labels, missing or extra files, tampering, and mismatched build/manifest identity fail the gate.

The CI container smoke test calls `node scripts/oci-image-proof.mjs <ephemeral-ci-image>` after building with the exact checkout revision/tree. It still tests the runtime's non-root privileges, loopback bind, fake account persistence and unsafe-network startup rejection. The independent preview security, TLS, staging, and Node/browser checks remain mandatory.

A sanitized `docs/evidence/oci-image-proof.json` receipt is included in the GitHub verification artifact. It names the pinned base **index digest**, local image configuration **ID**, actual Git checkout/tree, lockfile and manifest hashes, and count of verified embedded files. It explicitly reports that no independently trusted manifest digest, external registry digest, signature or deployment was observed. The local image ID is **not** an immutable registry pull reference.

## Manual review and upgrades

A reviewer should compare the Dockerfile's pinned index digest to a trusted registry inspection and check security advisories and the Node version inside the running image, before approving a version upgrade. Updating Node/security fixes requires **deliberately replacing both pinned digest references**, rerunning the entire pipeline, and reviewing the new binary and image evidence. A pin prevents silent drift; it does **not** automatically deliver security patches.

To inspect the upstream multi-architecture digest manually:

```sh
docker buildx imagetools inspect docker.io/library/node:24-bookworm-slim
```

Do not copy a per-platform image config ID or layer digest into the `FROM` reference. Use the top-level `Digest` index reference, confirm it is published by the intended upstream publisher, and evaluate the Node patch level. This check requires Internet access and is separate from the image's local config ID.

A real release still needs approved image registry access and a separately trusted signature/provenance channel, an approved customer-owned host, independently verified provider controls, a reviewed HTTPS reverse proxy/domain, encrypted and restorable off-host backups, an incident playbook, and an authenticated end-to-end deployment smoke test.

**RELEASE_NO_GO** continues. CI compares artifacts produced within one GitHub workflow and can only establish internal source/build congruence, not supply-chain independence or actual customer-host execution.

See [installation preflight](INSTALLATION-PREFLIGHT.md), [container staging](CONTAINER-STAGING.md) and [release](RELEASE.md).
