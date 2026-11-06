# Self-hosting and configuration

## Verified local topology

Node 24.22.1 serves all three web surfaces and the HTTP API on loopback, with SQLite on local disk. The browser uses a host-only session cookie. SQLite migrations, project membership and client projections are enforced on the server. The production build contains ordinary JavaScript, SQL, CSS, SVG and licensed WOFF2 files. No npm production dependency is required after building.

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` | `4173` | Loopback listener port |
| `MIZVO_ORIGIN` | `http://localhost:4173` | Exact browser origin, including port; HTTPS required in production |
| `MIZVO_DATABASE` | `var/mizvo.sqlite` | Persistent local database path |
| `MIZVO_ORGANIZATION` | `mizvo` | One installation’s organization ID; do not change on an existing database |
| `NODE_ENV` | unset | Set `production` behind a verified TLS reverse proxy |
| `MIZVO_GITHUB_REPOSITORIES` | empty | Comma-separated exact owner/repository allowlist |
| `MIZVO_GITHUB_TOKEN` | unset | Optional externally managed, read-only GitHub credential |
| `MIZVO_ACCOUNT_PASSWORD` | required only by account CLI | Provisioning password; unset immediately afterward |

There is no automatic `.env` loader. Inject environment values through the process manager or your local shell. Secret values must not enter Git, application logs, public files or documentation.

## Build and run independently

Run `npm ci && npm run build` on a builder using the committed lockfile. Copy the `dist` directory to the approved Node host with the reviewed source license and notices. From the installation root:

```sh
NODE_ENV=production \
MIZVO_ORIGIN=https://your-approved-host.example \
MIZVO_DATABASE=/var/lib/mizvo/mizvo.sqlite \
node dist/apps/api/server.js
```

The sample hostname is a configuration example, not an owned or deployed Mizvo domain. The application binds `127.0.0.1`; terminate TLS at a reverse proxy on that host. Limit request bodies at the proxy to 32 KiB, set a connection/request limit, forward the configured origin unchanged, and do not cache `/api/*`. The application does not trust `X-Forwarded-For`: its durable per-IP rate limit sees the proxy address, so configure complementary trusted-edge limits rather than spoofable forwarding headers.

Use a dedicated non-root OS account. Keep the database directory mode 0700; backup snapshots are mode 0600. Protect the volume and backups with host encryption and administrator access controls. Provision real accounts only after approved identity verification and authorized access grants.

## Liveness versus readiness

`GET /api/health` is an unauthenticated liveness signal indicating the process is serving HTTP; its `status: ok` is **not proof** the SQLite database or any application workflow is operational. Use unauthenticated `GET /api/ready` for host startup/readiness gates. It performs bounded read-only checks for the configured organization, migration/checksum correspondence, and essential user, session and record tables. It returns `200 {"status":"ready"}` on success or `503 {"status":"unavailable"}` if checks fail, without returning record content, SQL errors or schema details. The probe does not write data and cannot prove disk writeability, external integrations, recovery objectives, security approvals or deployed release identity. Do not use the public result as an authorization or production-acceptance signal; confirm authenticated journeys and independent backup restoration separately.

The local synthetic staging, HTTPS proxy and container health-check rehearsals require this readiness result before exercising accounts. Operations should treat repeated 503 results as a private investigation/rollback trigger and retain the existing process liveness signal for diagnosis; never clear or replace a production database merely because readiness fails.

## GitHub

The server administrator first allowlists an exact repository. The project owner/founder then explicitly associates it with a project. Internal members may read branches, commits, pull requests, source, exact-commit check runs and comparisons. Clients cannot use these endpoints. No shell, runner, arbitrary server fetch URL, write token, deployment token or automatic code execution is provided.

For private repositories, use a supported GitHub App installation credential or fine-grained read-only credential, scoped to the necessary repositories and read-only Contents, Pull Requests, Checks and Metadata permissions. Installation/token acquisition, rotation and permission verification remain deployment prerequisites. Public no-token access was actually tested; private credentials were not.

## Private OCI staging option

The repository also provides a rootless multi-stage `Dockerfile` and a
`compose.staging.yaml` manifest. Its host port is **loopback-only**; there
is no bundled public reverse proxy or automatic cloud deployment. The application
still binds `127.0.0.1` by default for direct Node hosts; only explicitly
configured production-mode containers with HTTPS origins may bind `0.0.0.0`
inside their network namespace. CI now exercises the container's non-root
identity, restricted filesystem, private port, fail-closed network binding
and named-volume SQLite persistence across replacement.

See [Container Staging](CONTAINER-STAGING.md) for its isolated setup,
verification and operational limitations. This does not establish an approved
public domain, externally trusted TLS, encrypted off-host backup, or client
hosting arrangement.

## Cloudflare boundary

The connected account had no Mizvo Worker or D1 database at inspection. No resources were created. This build’s `node:sqlite` adapter cannot run as D1. Select and verify a D1/Workers storage/runtime adapter before an edge release, or approve a dedicated Node origin with an appropriate Cloudflare configuration. Do not label this repository as Cloudflare-deployed.
