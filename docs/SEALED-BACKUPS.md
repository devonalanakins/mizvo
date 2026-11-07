# V0.19 / V0.24 — authenticated encrypted snapshots and offline recovery

**Review-source capability only.** No backup destination, key-management service, hosting provider, cloud account or scheduled job has been connected or approved. The CLI can encrypt an **already verified SQLite backup**, verify it without retaining plaintext, or (V0.24) explicitly publish a new **offline-only** SQLite recovery copy in an operator-controlled private directory. It does not create an online backup, upload any bytes, replace the existing database, publish a site, or promise a recovery time.

## Separation of responsibilities

1. The existing `npm run backup -- <destination>` uses SQLite's online backup API and creates an atomically published, owner-private, integrity-checked **plaintext** snapshot. Run it only for an authorized installation, on a trusted private encrypted host filesystem.
2. The new `npm run backup:sealed -- seal <snapshot> <new-archive> <key-file>` validates the snapshot against the exact installed migration files and writes an authenticated AES-256-GCM archive. It requires **absolute POSIX paths**, a 32-byte raw key file accessible only to its OS owner (0600), and separately owner-private source/archive directories (0700). It will not overwrite an existing archive or a dangling symlink.
3. `npm run backup:sealed -- verify <archive> <key-file> <private-recovery-directory>` performs authenticated decryption into a protected temporary directory; validates SQLite integrity, foreign keys, and migration checksums; invalidates restored sessions **inside the isolated copy only**; deletes the temporary SQLite copy; and writes one private JSON verification receipt with hashes and counts but no application records. The receipt never means the original installation is recovered or externally backed up.
4. V0.24 adds `npm run backup:sealed -- restore <retrieved-archive> <key-file> <new-offline.sqlite>` to authenticate, validate and publish a **new** session-invalidated recovery database atomically in an existing 0700 private directory; it refuses existing targets, symlinks, sidecars, insecure locations and tampered ciphertext. The new file is plaintext and **must never be placed inside a publicly accessible or ordinary unencrypted directory**. This is a separate operator-only recovery action, not a live-data replacement or deployment.
5. Only an approved independent storage process can transport and retain the sealed archive off-host. Verification must be repeated from a separately retrieved copy using the same release's migration files. Keep recovery keys separately protected and recoverable; loss of the key makes archives unrecoverable. Define and test retention, recovery objectives, account ownership, and access controls before any real deployment.

## Operator-only example

These are illustrative filesystem paths, not configured resources. Do **not** run with real client data until the deployment and encryption policies are approved. Use a trusted terminal with Node 24 and a restricted OS account.

```sh
umask 077
mkdir -m 700 /protected/mizvo-keys /protected/mizvo-snapshots /protected/mizvo-archives /protected/mizvo-recovery
node -e 'const fs=require("node:fs");const crypto=require("node:crypto");fs.writeFileSync(process.argv[1],crypto.randomBytes(32),{flag:"wx",mode:0o600})' /protected/mizvo-keys/archive.key

# Source-only example, after a real installation has been approved:
MIZVO_DATABASE=/var/lib/mizvo/mizvo.sqlite \
  npm run backup -- /protected/mizvo-snapshots/pre-upgrade.sqlite
npm run backup:sealed -- seal \
  /protected/mizvo-snapshots/pre-upgrade.sqlite \
  /protected/mizvo-archives/pre-upgrade.mzseal \
  /protected/mizvo-keys/archive.key
npm run backup:sealed -- verify \
  /protected/mizvo-archives/pre-upgrade.mzseal \
  /protected/mizvo-keys/archive.key \
  /protected/mizvo-recovery
```

The 32-byte key must be generated securely, held outside the repository, and backed up through an approved independent secret-recovery process. Do not put key bytes in environment variables, logs, tickets, GitHub Actions secrets used by public PR builds, or next to a transferred archive. Never commit or publish a real snapshot or archive. The operator must ensure the target filesystem is private and encrypted independently; the helper can inspect POSIX permissions but **cannot prove underlying disk encryption**.

## V0.24 — isolated offline recovery from an independently retrieved archive

This capability prepares for a real off-host restore drill without presuming a configured provider, key manager, retention schedule or live host. Use only on a **trusted, encrypted, restricted POSIX filesystem** with an existing owner-private (0700) destination directory and an independently protected owner-private (0600), 32-byte key file. The **encrypted archive is safe to transfer only through an approved channel**; this code does not transfer or upload it.

Example *after* independent approval and retrieval (paths are illustrative, not current resources):

```sh
# The archive was independently retrieved, and the recovery volume is encrypted.
npm run backup:sealed -- restore \
  /private/retrieved/backup.mzseal \
  /private/keys/recovery.key \
  /private/offline-recovery/recovered.sqlite
```

The command verifies AES-256-GCM authentication, SQLite integrity, foreign keys and exact migration checksums; deletes **sessions in the isolated decrypted copy**, re-verifies the resulting database, flushes the file, and publishes it with an exclusive same-filesystem hard link that cannot replace existing paths or dangling symlinks. Success prints a minimal JSON receipt with archive, snapshot and restored-file SHA-256s plus explicitly false flags for off-host transfer, production recovery and release approval. It leaves original ciphertext, key and source database unchanged. Only the operator's **separately reviewed** recovery process may start a service against the new database. Before any service exposure, revalidate all membership grants and apply post-snapshot access revocations (restored member data is historic), then separately verify TLS, service identity and functional authorization.

A decrypted SQLite recovery copy is **sensitive plaintext** and persists until the operator handles it under the approved retention/deletion policy. The CLI cannot prove at-rest encryption, secure deletion or crash durability of parent directory metadata, and an unexpected process crash can leave temporary decrypted files. The included tests only **simulate** moving an archive between private local directories, not actual off-host transfer, remote retention or key recovery.

## Security behavior and limitations

- The archive includes a versioned fixed header, a random 96-bit nonce, AES-256-GCM encrypted SQLite bytes and a 128-bit authentication tag. The header is authenticated as additional data; modified ciphertext, header, truncated files and wrong keys fail authentication. A conservative 16 GiB maximum encrypted archive size applies to each independently randomized nonce; this is a staging-sized workflow, not a bulk archival system.
- The archive is written inside a newly created 0700 temporary directory and published by a no-overwrite hard link only after an isolated readback verifies SQLite integrity and migration compatibility. The published archive is mode 0600. The source snapshot must not change during sealing.
- The `verify` command **never outputs or publishes** a decrypted SQLite file. The separate explicit `restore` command publishes a new plaintext SQLite copy **only in an approved private offline recovery directory**. It does write plaintext into a protected *temporary* directory until the authentication and SQLite checks complete, and deletes it under normal success/failure handling. A forced process kill, filesystem failure or machine crash can leave temporary plaintext. Therefore only use a trusted encrypted recovery filesystem with restricted permissions, and apply host-level crash cleanup policies.
- The source plaintext backup is **not deleted** by sealing. Destroy it only under the approved retention and secure-erasure policy; do not confuse unlinking a file with guaranteed erasure from snapshots or solid-state storage.
- This is authenticated encryption, not an independently signed provenance receipt. Archive ciphertext checksums do not prove a separately trusted release, a remote provider's retention, or an authorized recovery. Existing installation manifest checks, application permissions, restored-member reconciliation and session revocation remain separate gates.
- There is no key rotation, automatic cloud upload, disaster-recovery schedule, user interface, provider trust verification, or unattended key escrow in V0.19/V0.24. Key rotation requires new snapshots encrypted under a separately controlled key and an observed restore drill. Reused keys must never reuse a nonce.
- A restored copy belongs to the exact migration set and source version. An older binary must not be pointed at a later schema. The original `npm run recovery:drill` remains available for unencrypted offline snapshots.

## Synthetic verification

The `tests/sealed-backup.test.ts` suite creates a fictional user and session in a disposable SQLite database, exercises online backup → seal → decrypt → session-safe isolated verification, checks that source bytes and sessions are unchanged, and rejects wrong keys, tampering, truncated ciphertext, insecure permissions, symlink destinations and duplicate output names. CI must also run the normal lint/typecheck, integration, installation, recovery, TLS and OCI/browser gates.

**Release remains NO_GO** until the approved real staging host, private TLS access, independently encrypted off-host storage, a restored off-host copy, key custody, human security review, and nontechnical acceptance are evidenced.
