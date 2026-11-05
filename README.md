# Mizvo

An independent, founder-led custom software engineering practice. **Make the improbable useful.**

This branch contains the **V0.5 implementation review build**, released under **GNU AGPL-3.0-only**; see [LICENSE](LICENSE). The founder approved public source publication and selected AGPL as the standing default on November 4, 2026. This is implemented software with local verification, not a production deployment. The original design PR #1 remains separate and unmerged.

Three related web surfaces share one maintainable TypeScript application and one server authorization boundary:

- **Discover** (`/`): capabilities, process, truthful portfolio empty state, company information, consented inquiry and private intake.
- **Studio** (`/studio`): persistent projects, Rooms, notes/discussion/design records, proposed decisions and history, tasks/dependencies/evidence, project invitations, People, search, notifications, Pipeline and delivery records.
- **Client Space** (`/space`): an explicit client-only projection of shared project context, Living Brief, a single next client decision pinned to a shared brief revision and optionally a recorded demonstration version, milestones, feedback, support and attributable version reviews.

The Workbench reads allowlisted GitHub repositories. It never executes code or writes to GitHub. A version record is not a deployment, and an approval is not a claim that a build passed tests.

Compiled candidate files can be checked against an [artifact integrity manifest](docs/ARTIFACT-INTEGRITY.md). This is a checksum receipt tied to the CI checkout, **not** a signed supply-chain attestation or a production release.

An [installation preflight](docs/INSTALLATION-PREFLIGHT.md) checks copied compiled files against an independently supplied manifest digest, repository, Git checkout commit and source tree. CI also runs a synthetic tampering test. This verifies disk bytes at a point in time; it does not sign a build or establish what is running remotely.

A [preview reachability check](docs/PREVIEW-PROOF.md) uses an installation-administrator-configured exact HTTPS URL allowlist and records a bounded, no-credentials HEAD observation for an immutable release. A reachable page or untrusted response header is **not** a verified staging or production deployment. The client-facing Proofline reports these distinctions in plain language.

## Run the actual application

Requirements: Node **24.22.1** (the verified runtime), npm, and a local writable disk. No paid service, external identity provider, AI provider, or database account is required for local operation.

```sh
npm ci
npm run build
read -rsp 'Founder password (14+ characters): ' MIZVO_ACCOUNT_PASSWORD
export MIZVO_ACCOUNT_PASSWORD
npm run account -- founder@example.test 'Your Name' founder
unset MIZVO_ACCOUNT_PASSWORD
npm run dev
```

Open `http://localhost:4173/studio`. Use an address you actually control for a real installation. No default password or preseeded user exists. The bootstrap command is an administrator operation, not public registration. Client accounts use the same command with the `client` argument; contributors use `member`. Actual access still requires a project-specific invitation, acceptance, and an unexpired, unrevoked membership.

See [self-hosting](docs/SELF-HOSTING.md), [security boundaries](docs/SECURITY.md), [verification](docs/VERIFICATION.md), [capability status](docs/STATUS.md), and [release/rollback](docs/RELEASE.md).

## Review Mizvo privately with fictional data

For an ephemeral, localhost-only Studio and Client Space session with a fictional founder, engineer and client, use `npm ci && npm run build && npm run review:local` in a **trusted interactive terminal**. All accounts and records are synthetic and discarded when the session ends. No mail, public hosting or customer data is involved. See [Local Review](docs/LOCAL-REVIEW.md). This is not a remotely accessible preview or a release approval.

## Verify

```sh
npm run lint
npm run typecheck
npm test
npm run build
npx playwright install --with-deps chromium
npm run test:browser
npm audit
```

Optional live public GitHub verification:

```sh
npm run verify:github
MIZVO_VERIFY_GITHUB=1 npm run test:browser
```

The normal browser suite uses independently authenticated synthetic founder, engineer, and client accounts against a temporary SQLite database. It exercises real HTTP and DOM behavior. The unit/integration suite separately marks mock-provider contract tests. Temporary accounts and databases are removed; no actual acquaintance is invited.

## Source organization

- `apps/api`: HTTP/session boundary and read-only GitHub adapter.
- `apps/web`: semantic DOM rendering, routing and application interactions across the three surfaces.
- `packages/authz`: credentials, sessions, input validation and project roles.
- `packages/domain`: connected project, decision, invitation, task and release services.
- `packages/storage`: SQLite adapter, atomic migrations and transactions.
- `packages/ui`: shared tokens, responsive layouts, self-hosted font declarations and original architectural SVG.
- `tests`: actual HTTP integration, adversarial isolation, migration/recovery and browser workflows.

This is a single-organization installation with explicit organization IDs and project-scoped grants. It is not a deployed multi-organization SaaS. Node’s synchronous SQLite adapter is portable to another Node host, **not a Cloudflare D1/Workers adapter**. Cloudflare hosting needs a deliberately implemented/tested runtime adapter or an approved Node origin behind Cloudflare; neither is claimed here.

## Rights

The V0.4 archive was inspected and preserved separately. Its 55-file source manifest and 16 prototype tests were reproduced, but none of its unlicensed executable source, screenshots, or private operating documents was imported into this branch. The new interface follows the approved visual contract through normal DOM, CSS, and an original SVG illustration; it does not embed a concept board. Downloaded Fontsource fonts carry their original SIL Open Font License notices in the build. See [provenance](docs/PROVENANCE.md).

No clients, staff, contracts, certifications, legal entity status, live presence, test results, or deployments are invented. Sam and other prospective collaborators have not been invited.


### V0.16 integration review

The preserved V0.15 stack is consolidated on `integration/verified-platform-v0-16` for a single draft review against main. [Inventory, demonstrated defects, additive migration, verification boundaries and private staging gates](docs/V0.16-INTEGRATION.md). Source implementation and synthetic verification do not establish a deployed service. Production remains **RELEASE_NO_GO**.
