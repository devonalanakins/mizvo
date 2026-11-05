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

## Backup

```sh
MIZVO_DATABASE=/var/lib/mizvo/mizvo.sqlite \
node dist/scripts/backup.js /approved-backups/mizvo-before-upgrade.sqlite
```

The destination must not already exist. The helper uses the online backup API and integrity-checks the snapshot. Copy the verified snapshot to an approved encrypted independent location and record retention. No off-host backup job or external storage has been activated.

## Rollback / restore

1. Stop the application and verify the process is stopped. Preserve the failed database plus WAL/SHM sidecars as a protected incident set.
2. Restore the prior verified release directory. If the database schema changed, restore the pre-upgrade snapshot to a fresh database path; do not pair an old binary with an unsupported newer schema.
3. Run `PRAGMA integrity_check` on the restored snapshot and start the matching application with that new path. Never overwrite or raw-copy an actively used WAL database.
4. Verify project counts, notes/history, membership/revocation and release attribution; repeat authenticated negative-access checks. Record the restored release/snapshot and the recovery interval.

Restoring an older snapshot also restores its session and grant state. Before exposing the recovered installation, revoke restored sessions (`DELETE FROM sessions` under controlled administration), reapply any known post-snapshot access revocations, and require users to sign in again. The test suite proves snapshot consistency and preserved records, not an actual production recovery or an RPO/RTO commitment.
