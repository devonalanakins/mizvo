# Portable OCI staging — rootless app and persistent SQLite

**Status:** This is a self-hostable, private staging package and CI test. It is **not** a live hosting service, a customer installation, a purchased resource, or an approved production release.

## What is packaged

`Dockerfile` builds the same licensed AGPL-3.0-only Node/SQLite distribution as the repository's normal build. The final runtime image contains `dist/`, its license/notices, and Node 24; it includes **no** installed npm dependencies, repository source secrets, CI evidence, or customer files. A deliberately restricted `.dockerignore` makes the input explicit. Both stages use the maintained Node 24 Debian slim image line. Before a real customer deployment, independently review the resolved immutable image digest and runtime patch level.

The runtime executes as the unprivileged `node` user (UID 1000). SQLite lives at `/var/lib/mizvo/mizvo.sqlite`, with that directory prepared as owner-private mode 0700. The image never includes a database or bootstrap credentials.

The application's original `127.0.0.1` default binding **remains unchanged**. A new explicit `MIZVO_BIND_HOST=0.0.0.0` option allows the application to accept container bridge traffic only when `NODE_ENV=production` and `MIZVO_ORIGIN` is an HTTPS URL. This is not a substitute for real TLS termination: container networking is HTTP inside the private host.

## Private compose configuration

`compose.staging.yaml` illustrates a single-host SQLite installation that is **not published to the internet**:

- Host port is constrained to `127.0.0.1:4173` only. A separately reviewed reverse proxy and approved TLS origin would be necessary for browser access.
- Container uses UID 1000, `read_only: true`, all Linux capabilities dropped, `no-new-privileges`, PID and memory/CPU limits, and a restricted ephemeral `/tmp`.
- A Docker named volume persists SQLite across container replacement. The volume requires external encryption, access control, backups and off-host retention before real customer use.
- An explicit HTTPS `MIZVO_ORIGIN` must be supplied: missing or HTTP origins fail closed in production.
- A single installation represents one Mizvo organization; the sample is **not** a verified multi-tenant hosting control. Never mix distinct customers in one database.

An authorized operator with Docker and a **real approved** hostname can locally inspect the configuration without starting anything:

```sh
MIZVO_ORIGIN=https://approved.example.invalid docker compose -f compose.staging.yaml config
```

The hostname above is deliberately fictional. **Do not start a real customer instance with that address**. The compose file is not the full production topology: it does not create a TLS proxy, DNS, trusted certificate, customer ownership evidence, monitoring, independent backups, or a support contract.

## Synthetic acceptance test

```sh
npm run test:container
```

This uses a local Docker daemon and must run only in an isolated engineering/CI environment. It builds the image without using existing application databases, validates the compose manifest, starts a private container on a Docker-assigned **loopback-only** port, probes real HTTP health and checks runtime UID, read-only root, capability reduction, memory limit and writable database directory. It provisions **one synthetic founder** using a fictional email and test-only password, stops/removes the first instance, replaces it with a second instance using the same private Docker volume, and verifies that the SQLite user count persists. The test removes its containers, image, and volume even on failure.

The Docker rehearsal also checks the **built image's actual compiled file set**, not just the source checkout. CI supplies the checked-out full Git commit and tree as explicit build-argument labels, creates a stopped inspection container, copies `/app/dist` into a private temporary directory and uses the reviewed [installation preflight](INSTALLATION-PREFLIGHT.md) with the CI manifest SHA to verify every compiled file. It then injects an unreviewed file into that extracted copy and requires verification to fail. It records a sanitized `docs/evidence/oci-candidate-check.json` receipt containing the local content-addressed Docker image ID, checkout and manifest digests, and explicit missing gates. The temporary inspection container and copied files are deleted. This requires `npm run build` and `npm run artifact:create` when invoked independently of CI.

A **local Docker image ID is not a remotely published registry digest**. Labels can be forged and a manifest checksum computed within a CI job is not a separately authenticated signature. This test cannot establish a deployed process or immutable remote provenance; real hosting still requires independent release approval, image/digest verification and provider-observed identity.

The existing `npm run test:staging` and `npm run test:tls` gates remain responsible for user-path rollback and actual TLS/CSRF/client permission checks. The new container test does not replace them.

**Combined integration:** This source branch also includes the previously reviewed V0.9 synthetic staging and V0.10 HTTPS gates, and targets the latest flagship integration PR #7 directly. The required final CI must run against the merged PR #7 + OCI/HTTPS/recovery candidate, including the preview-network security checks. The earlier CI run against only the staging branch is retained as historical evidence, not the combined release gate.

**Evidence and limitations:** a passing CI log proves this source and current Docker engine can build and exercise a private container. It is not proof of a real provider's secure DNS, production TLS, application availability, off-host recovery, cloud account ownership, encryption or commercial compliance. The test checks **volume persistence**, not customer-data export or a production disaster recovery objective.

## Release and ownership controls

- The prepared OCI container is a self-hostable option, not a commitment that Mizvo will host customer deployments.
- Before any real deployment: obtain deployment/customer authorization, record which entity owns the domain, host, bill, database, backups, export and incident response; approve the host and TLS proxy; verify least-privilege secrets and persistent encrypted storage; independently restore a protected off-host backup; review update/rollback and patching; and test the intended external HTTPS endpoint with authorized synthetic accounts.
- Production provider launch, real customer identity grants, purchases, service guarantees, and data migration remain **RELEASE_NO_GO**.
- The Node/SQLite container does not add a Cloudflare Workers/D1 adapter. A Worker must not be assumed to support `node:sqlite`.

See [Self-hosting](SELF-HOSTING.md), [Release procedure](RELEASE.md), and [Synthetic staging](STAGING-REHEARSAL.md).
