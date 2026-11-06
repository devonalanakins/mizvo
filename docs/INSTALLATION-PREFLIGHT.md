# Installation preflight — exact candidate bytes and trusted source identity

**Status:** Implemented as a local, offline, operator-controlled gate. Passing this gate does **not** authorize or establish a production deployment.

## The missing trust boundary

Mizvo's build manifest inventories every regular file in `dist/` with SHA-256 checksums. Those hashes detect accidental or adversarial changes **only if the manifest itself is trusted**. Anyone who controls both the compiled files and manifest can rewrite the hashes.

The reviewed `scripts/installation-preflight.mjs` verifies six caller-supplied values:

- The installed `dist/` directory (read-only input).
- Its separately stored `build-proof.json` manifest.
- The **expected SHA-256 of that manifest**, obtained independently of the package being installed.
- The **exact Git checkout commit and Git tree** that were approved for the build (full 40-character identifiers).
- The **exact trusted GitHub repository** (`devonalanakins/mizvo` for the current project).

It first compares the entire manifest against the trusted manifest digest; then it checks the manifest's source commit, tree and repository. Only then does the **reviewed verifier from the operator's source checkout** inspect every file, byte length and SHA-256 under the candidate directory. It rejects missing/extra files, changed bytes, symlinks and invalid/unsafe file entries. No manifest or downloaded build may supply its **own** trusted digest.

## Approved staging operator command (example; never substitute guessed values)

```sh
node scripts/installation-preflight.mjs \
  /approved/staging/release/dist \
  /approved/staging/release/build-proof.json \
  <independently-verified-manifest-sha256> \
  <approved-CI-checkout-commit> \
  <approved-checkout-tree-sha> \
  devonalanakins/mizvo
```

**Trust-source warning:** The GitHub artifact ZIP digest is **not** the SHA-256 of `build-proof.json`. Retrieve and independently check the manifest digest, reviewed Git checkout/tree, GitHub workflow and artifact identity from a trusted release record or independently reviewed CI evidence. A PR build may use a synthetic **merge commit**, not the PR branch head. Never claim they are equivalent. This preflight intentionally refuses to substitute the branch head for the actual build checkout.

CI runs `npm run test:installation` after compilation and manifest verification. The existing `npm run test:container` also extracts the complete compiled filesystem from the locally built Docker image and checks it against that same checkout's manifest, then proves that injecting an extra file causes rejection. OCI inspection does not add a signed origin claim or prove the image used by a remote process.

CI runs `npm run test:installation` after compilation and manifest verification. The synthetic command copies the full `dist/` tree and manifest to private temporary storage, passes trusted values from the checked-out GitHub job, verifies the candidate, deliberately adds an unreviewed file, and asserts rejection. It deletes the temporary installation and records only a sanitized `docs/evidence/installation-preflight.json` receipt. Dedicated negative tests also reject altered manifest digests, mismatched source IDs, modified/missing/extra files and symlinks.

## Live entrypoint fingerprint cross-check

The optional standalone `MIZVO_EXPECTED_SERVER_SHA256` can be set to the SHA-256 listed for `apps/api/server.js` inside an **independently approved and fully verified** build manifest. The application then aborts startup if the bytes of its loaded entrypoint file differ. Its unauthenticated `GET /api/health` reports the same `server_sha256`, allowing a release operator to compare the response from the intended TLS endpoint with the approved entrypoint digest. Synthetic CI separately validates this path for copied installations, restored staging, TLS and OCI, and rejects an intentional mismatched boot.

The check is byte-level evidence for one server file and does not authenticate the host, bind the response to an immutable image/entire distribution, identify the Node process remotely, or prevent a malicious server from fabricating a response. The independently trusted manifest, verified complete file set, TLS identity, protected process-manager environment, and human release decision remain essential.

## Release gates this does not satisfy

The CI exercise derives the expected manifest SHA within the same CI job, so that check **does not establish an independent cryptographic root of trust**. A release operator must compare against trusted out-of-band evidence or an independently validated signed provenance attestation.

Verification is a **point-in-time disk inspection**. A malicious or mistaken actor could change files after inspection, run an older process from another directory, or replace the manifest alongside a compromised trust channel. The check does not attest which bytes a remote host executed, verify process isolation, TLS ownership, provider control, encrypted off-host backups, credentials, client approval or support terms. Production requires a protected, immutable release directory, controlled service identity, provider-observed runtime verification, independent network controls, data protection and an approved rollback plan.

Neither the synthetic tests nor this script reads a real client database, provisions infrastructure, exports customer content, signs a release, sends messages or changes live environments.
