# Verification receipt — private review build V0.5

The machine-readable exact command exits, runtime, durations and source-file SHA-256 manifest are in `docs/evidence/verification.json`; raw output is in `checks.log`. Browser receipts are in `browser-results.json`, live public GitHub responses in `github-observed.json`, and the registry audit in `dependency-audit.json`. The private review package additionally includes the actual 22 PNG screenshots; they are kept out of source history and uploaded by CI as artifacts when CI is eventually authorized and run.

## Evidence scope

| Check | Observed result / scope |
| --- | --- |
| Source recovery | Existing main and PR #1 read; PRIMARY hash matched; V0.4 manifest 55/55 and prototype tests 16/16 reproduced; old archive not imported |
| Clean lockfile installation | `npm ci --ignore-scripts`; pinned direct versions and lockfile |
| Formatting | `npm run lint`; Prettier check across applications, packages, scripts, tests, configuration and workflow |
| Type checks | `npm run typecheck`; strict TypeScript, no unchecked indexed access, unused locals/parameters rejected |
| HTTP/integration | `npm test`; 14 grouped tests, with normal, negative, adversarial, concurrent-write and recovery assertions |
| Build | `npm run build`; normal JavaScript/SQL/static assets, bundled self-hosted font files and SIL license notices |
| Independent installation | `npm run test:distribution`; copied compiled artifact in a fresh directory, Node alone, migrations, local fonts, login, project creation and Room read |
| Browser workflows | `MIZVO_VERIFY_GITHUB=1 npm run test:browser`; real local HTTP/DOM flows with separate browser contexts for founder, engineer and client; 22 captures and checks |
| Responsive widths | Discover, Room and Client Space at 320/390/768/1024/1440/1920; Workbench at 390/1440; People and Plan at 1440 |
| Automated accessibility | Axe WCAG A/AA tags over those 22 captured states; zero reported violations; no document-width overflow, JavaScript exceptions or CSP errors |
| Live public GitHub | Branches, commits, PR #1, source, commit comparison and check-runs endpoints; Workbench also loaded real data through the running application |
| Dependency audit | `npm audit`; registry returned zero reported vulnerabilities across installed dependencies at observation time |
| Source review | Distinct adversarial code-integrity pass and findings in CODE-INTEGRITY-AUDIT.md; no independent human signature or certification implied |

## Tested user flows

A founder signs in, creates a real persisted project, creates/edits a note, proposes a decision, inspects version history, reloads and retrieves records. The HTTP suite additionally stops/restarts the server against the same database and session. Wrong-account and wrong-project access, client engineering/history access, missing/incorrect CSRF, wrong Origin, stale writes and stale decision approvals are rejected.

Invitations are created, accepted by a separately authenticated account, restricted to one project, protected against replay/wrong email/expiry, role-changed and revoked. Existing sessions immediately lose project access after revocation or grant expiry. Notifications do not copy private text and disappear from the accessible feed when the grant is no longer valid.

Client Space receives a whitelist projection; private notes, tasks, task evidence, membership data, source and rollback internals remain excluded. The client submits feedback, reviews an immutable synthetic version, and can submit/reopen support requests while only the project team resolves them. Two separate client identities cannot cross project boundaries.

Task completion requires evidence, owner review when required, completed dependencies and non-cyclic dependencies. A contributor cannot waive the review requirement. A release author cannot approve their own immutable version, and a second review cannot overwrite the first.

A live WAL database is backed up through the SQLite API, restored independently and integrity-checked with project attribution retained. A second migration preserves data; edited migration content and unsupported downgrade attempts fail closed.

## Visual comparison to the PRIMARY board

The actual DOM screenshots were inspected alongside the locked third board. Preserved: graphite/ivory/copper palette, serif/display and interface/code hierarchy, copper architectural identity, warm fine borders, 14px card/9px control radii, desktop 220px navigation and 295px inspector, contextual Room header, conversation/decision distinction, calmer client projection and touch navigation.

Corrected during browser review: accessible names for the collapsed tablet navigation, a mobile inspector close control and keyboard focus behavior, default dialog input focus, strict CSP-compatible styles, and the notification button surface.

Remaining fidelity limits: the original vector architectural illustration is deliberately distinct from the concept’s photorealistic building/landscape; no fictional people, progress percentages, test passes, live presence or client projects were copied. The Room is more spacious and the composer more explicit than the concept. Screenshot captures are responsive evidence and a manual visual comparison, not an automated pixel match to the composite concept board or a human-approved final design.

## Unverified and blocked

No production environment, TLS/reverse proxy, actual founder account, real client account, private GitHub App credential, email/SMS/AI/finance integration, production restore, off-host backup, scale test, manual screen-reader session or human Monica Test is claimed. At the original private checkpoint, CI configuration existed but had not run remotely because source publication was gated. That gate is now resolved; the implementation PR supplies current remote CI status. Public repository branches were observed unprotected; no settings were changed.

The implementation does not complete every deep module in the full brief. STATUS.md records exact omissions. Source publication under AGPL-3.0-only is now approved. The next delivery gates are the implementation PR, human review, remote CI and completion of the selected production/runtime prerequisites. Production remains RELEASE_NO_GO.

## Subsequent source-publication approval

The founder approved publishing the reviewed implementation and locked AGPL as the standing source-license default. Package metadata and LICENSE now use AGPL-3.0-only. The previous private-build verification remains historical evidence; current-branch verification is rerun before publishing. Production deployment remains blocked by the documented independent gates.
