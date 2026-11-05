# Synthetic Staging and Handoff Rehearsal

**Status:** This is a local, CI-executed **synthetic loopback rehearsal**. It does not deploy a public endpoint, create a customer account, grant operational access, transmit files, verify Cloudflare hosting, or constitute a production disaster recovery exercise. Do not call the result LIVE.

## Purpose

Make Mizvo's first bespoke software delivery testable beyond unit tests: can a copied **compiled release**, with no runtime npm dependencies, start with persistent SQLite, provide client-scoped access, back itself up while running, shut down, restore a same-version snapshot into a distinct storage location, invalidate restored sessions, and recover the exact pre-snapshot user-visible state?

## Execute

Run using Node 24.22.1 or later within Node 24, from the repository root after a verified build:

```sh
npm ci
npm run build
npm run artifact:create
npm run artifact:verify
npm run test:staging
```

CI executes `npm run test:staging` after independent distribution and candidate-byte verification, before the normal Chromium/Axe suite.

The harness accepts **no user-supplied database paths**. It generates a cryptographically random synthetic password, creates private temporary directories and two independent copies of the same compiled release, and runs subprocesses on a local-only random port. It does **not** read personal or business databases, any `MIZVO_DATABASE` value from the parent environment, repository access tokens, third-party credentials, cloud resources, or a live domain.

## Scenarios exercised

1. Provision synthetic founder and client identities in an ephemeral storage directory.
2. Start compiled server from the first copied release; verify loopback health and public static HTML.
3. Create a real persisted project, a private note, a client-visible note and a versioned client-visible hosting plan. Invite the synthetic client and accept using the actual authorization flow.
4. From the client session, verify the ownership-plan status remains `not_verified`, the shared note is visible, the private note is absent, and internal project APIs deny direct client access.
5. Generate a consistent SQLite online backup while the server is running; run the independent recovery drill against that backup.
6. Add a later note after the backup to demonstrate rollback semantics; verify it exists before shutdown.
7. Terminate the original server, copy the backup to a **separate database path**, validate integrity/foreign keys, invalidate recovered sessions **in the restored copy**, then launch the second copied release on the same loopback port.
8. Confirm old cookies are rejected, require new logins, check original records/ownership scope still exist and that the later note has been discarded by the deliberate rollback.
9. Confirm the snapshot byte hash remains unchanged, stop the restored server and erase the entire synthetic temporary environment.

The two releases contain *identical compiled bytes*: this deliberately tests **same-version data recovery**, not schema downgrade or deployment of a previous code version.

## Evidence and limitations

A passing run writes `docs/evidence/staging-rehearsal.json`, which is uploaded in the regular CI evidence artifact. It contains a test schema, observation timestamp, runtime, binary and snapshot digests, boolean assertions, and explicit limits; it contains no account passwords, cookies, private record values or raw customer data. A partial failure must not create a passing receipt. The test logs a high-level failure rather than secrets.

A local loopback exercise cannot establish compliance, trusted cloud provider ownership, external network TLS, off-host backups, cross-release migration compatibility, business continuity objectives, client approval or a real customer handoff. All remain separate documented release gates, as do manual VoiceOver checks and operational incident recovery.

## Safety criteria

- Source, backup, and final recovered database are always contained in temporary private storage. No real personal/clinical data in tests or CI.
- No HTTP bind on public interfaces: subprocess binds to `127.0.0.1`.
- No permanent external spending, site exposure, DNS changes, external email or mutation of `main`.
- Preserve the original PR #2 preview observation feature, PR #7 integrated ownership migration `008`, and their tests.
- Keep this exercise in an isolated draft PR until CI is verified and a human staging/deployment boundary is explicitly approved.

See [Mizvo platform release gates](RELEASE.md) and [Ownership Plan](OWNERSHIP-PLAN.md).
