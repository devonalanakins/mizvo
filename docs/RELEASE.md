# Release and recovery procedure

**Current production decision: RELEASE_NO_GO.** Public source publication under AGPL-3.0-only is founder-approved. Local verification is not a production release.

## Preconditions

1. **Satisfied:** founder approved source publication and AGPL-3.0 on November 4, 2026. New Mizvo source is AGPL-3.0-only; private V0.4 source and concept boards remain excluded.
2. Review the exact implementation commit and evidence in the private package. Obtain meaningful human review for identity, permissions and operational exposure.
3. Approve a deployment topology and domain; configure actual TLS/proxy, secret management, backup storage, retention/privacy terms, account verification and incident response. Complete any applicable name/brand/legal review before offering services or collecting public data.
4. For Cloudflare Workers/D1, implement/test the runtime/storage adapter first. This Node build is not a Worker artifact.
5. Publish the authorized branch as a draft implementation PR; run CI at that exact head, inspect the diff, and retain existing repository controls. Existing branches were observed unprotected; no protection settings were changed. Agree the required human review/branch protection before release.
6. Verify real private GitHub credentials separately if needed. No paid integrations are a prerequisite for local operation.

## Build and deployment

Run clean `npm ci`, lint, typecheck, integration tests, build and browser checks. Record runtime, lockfile SHA, implementation SHA, static artifact SHA and commands/results. Build artifacts and font notices must travel together.

Create a database backup before upgrading. Deploy into a versioned release directory with a process manager and a durable database path outside it. Set production environment variables described in SELF-HOSTING. Keep the prior reviewed release available. No automatic schema downgrade is attempted.

Post-release checks must use the intended HTTPS endpoint and two independently authenticated authorized accounts: create/read/edit/reload, invitation acceptance, wrong-project/client denies, revocation of an active grant, public inquiry visibility, client feedback and version review, source evidence and relevant notifications. Confirm `/api/health`, build mapping, secure cookies, logs and storage after process restart. Only then label that exact version LIVE.

## V0.17 task migration safety

Migration 010 adds optional task assignees and ISO calendar due dates. Existing rows retain their task IDs, versions, evidence and visibility; their new columns default to null. Assignees must be active internal project members at mutation time; client projections omit assignee identities and dates. An expired assignment is hidden from current Studio output and cleared on a later task edit. Downgrading a migration-010 database in place is not supported: take an integrity-checked backup before upgrading, and if rollback is required, restore the matching earlier source and pre-upgrade snapshot to a separate protected volume. This source is a draft, not a production upgrade approval.

## Backup

```sh
MIZVO_DATABASE=/var/lib/mizvo/mizvo.sqlite \
node dist/scripts/backup.js /approved-backups/mizvo-before-upgrade.sqlite
```

The destination must not already exist, including an existing dangling symlink. The online backup helper creates and verifies the SQLite snapshot inside an owner-only (0700) temporary directory beside the destination, detaches WAL, integrity-checks it, sets its permissions to 0600, and then uses an exclusive same-filesystem hard link to publish the verified file without overwriting any existing path. On failure it removes temporary snapshot bytes and does not publish a partial destination. The operator must use a trusted local filesystem supporting atomic hard links, with a private/encrypted parent location and appropriate ACLs; this does not substitute for an off-host encrypted, tested backup and retention process. No off-host backup job or external storage has been activated.

## V0.19 optional sealed backup archives

The [sealed backup operator procedure](SEALED-BACKUPS.md) adds AES-256-GCM authenticated encryption **after** the existing validated plaintext SQLite backup, with a separate owner-private 32-byte key file, exclusive archive publication, and an isolated authenticated verification/restore drill. Neither an encrypted file on the same host nor a passing local verification receipt is evidence of an independent off-host backup or usable recovery-key custody. The source plaintext backup remains after sealing, and abrupt interruption can leave transient plaintext in the encrypted recovery filesystem. No key service, off-host transport, retention, or production restore is activated.

## Isolated offline recovery rehearsal

After making a snapshot through the online backup command, perform an operator-only recovery rehearsal in an **approved encrypted private directory**. This does not expose the snapshot or restore any production database.

```sh
mkdir -m 700 /approved-private-drill
npm run recovery:drill -- /approved-backups/mizvo-before-upgrade.sqlite /approved-private-drill
```

The drill refuses a nonregular snapshot, snapshot with sidecars, an accessible-to-others POSIX drill directory or incompatible migration checksums. It SHA-256 checks the source and isolated copy, performs `PRAGMA integrity_check` and `PRAGMA foreign_key_check`, verifies the *current* set of migration checksums, tests recovered-session invalidation **only in the private isolated copy**, rechecks the copy, writes a JSON receipt with counts and hashes but no application record content, and immediately deletes its temporary database. Failed drills do not create a passing receipt.

Use the same reviewed code and migrations that will run the restored database. If the database was created by a later release, use the matching release instead. The receipt is local operator evidence, **not** a remotely trusted signed attestation, not a verification of client cloud ownership or exported client data, and not a disaster recovery SLAs. Backups remain sensitive and must be protected, independently retained, and periodically restored against real operational objectives. Actual production recovery still requires explicit role approvals, post-snapshot permission reconciliation, and live service verification.

## Rollback / restore

1. Stop the application and verify the process is stopped. Preserve the failed database plus WAL/SHM sidecars as a protected incident set.
2. Restore the prior verified release directory. If the database schema changed, restore the pre-upgrade snapshot to a fresh database path; do not pair an old binary with an unsupported newer schema.
3. Run `PRAGMA integrity_check` on the restored snapshot and start the matching application with that new path. Never overwrite or raw-copy an actively used WAL database.
4. Verify project counts, notes/history, membership/revocation and release attribution; repeat authenticated negative-access checks. Record the restored release/snapshot and the recovery interval.

Restoring an older snapshot also restores its session and grant state. Before exposing the recovered installation, revoke restored sessions (`DELETE FROM sessions` under controlled administration), reapply any known post-snapshot access revocations, and require users to sign in again. The test suite proves snapshot consistency and preserved records, not an actual production recovery or an RPO/RTO commitment.
