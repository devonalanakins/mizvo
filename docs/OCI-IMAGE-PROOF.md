# OCI base-image pin and image-byte review

**Status:** CI verification of a private candidate. No registry publication, signed supply-chain attestation, deployed host or client account.

Both stages in the `Dockerfile` use `node:24-bookworm-slim@sha256:01d566e8d94d8c619591d78652babfccd3c6992a3dffa9ed5ab39e11cf6c70e9`. This is the multi-platform **index** digest observed by `docker buildx imagetools inspect docker.io/library/node:24-bookworm-slim` in [GitHub Actions run 42058879792](https://github.com/devonalanakins/mizvo/actions/runs/42058879792) on November 5, 2026. It is not an image-layer/config digest, vulnerability certification or cryptographic signature from the publisher.

The existing `npm run test:container` gate records the pinned base index reference, exact Git checkout commit/tree, lockfile-related manifest fingerprint and local Docker image ID in `docs/evidence/oci-candidate-check.json`. It builds with source-identifying OCI labels, extracts **every compiled file** from the stopped image, independently checks it against `build-proof.json` with the reviewed installation-preflight verifier, and confirms injected unreviewed bytes are rejected. A unit test rejects unpinned, mismatched and extra Docker stages.

The local Docker image ID is **not** a published registry manifest digest; neither the image label nor the manifest digest derived within the same CI job establishes independently trusted provenance. No remote runtime process is attested. Operators must verify independently signed provenance, registry identity, deployed bytes and customer controls before release.

**Maintenance:** Review the official Node publisher, security advisories and exact runtime patch; update **both** pinned `FROM` digests together when approving an upstream update; run all CI checks and re-review the new evidence. Pinning stops automatic base updates and therefore does not automatically patch security vulnerabilities.

For an approved deployment, also require a trusted external registry pull digest, reviewed image signature, owned host/domain, private network and real TLS, off-host encrypted/restorable backups, and an authorized external synthetic client test. These are **not satisfied** by CI.

See [container staging](CONTAINER-STAGING.md) and [installation preflight](INSTALLATION-PREFLIGHT.md). **RELEASE_NO_GO** remains active.
