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

## GitHub

The server administrator first allowlists an exact repository. The project owner/founder then explicitly associates it with a project. Internal members may read branches, commits, pull requests, source, exact-commit check runs and comparisons. Clients cannot use these endpoints. No shell, runner, arbitrary server fetch URL, write token, deployment token or automatic code execution is provided.

For private repositories, use a supported GitHub App installation credential or fine-grained read-only credential, scoped to the necessary repositories and read-only Contents, Pull Requests, Checks and Metadata permissions. Installation/token acquisition, rotation and permission verification remain deployment prerequisites. Public no-token access was actually tested; private credentials were not.

## Cloudflare boundary

The connected account had no Mizvo Worker or D1 database at inspection. No resources were created. This build’s `node:sqlite` adapter cannot run as D1. Select and verify a D1/Workers storage/runtime adapter before an edge release, or approve a dedicated Node origin with an appropriate Cloudflare configuration. Do not label this repository as Cloudflare-deployed.
