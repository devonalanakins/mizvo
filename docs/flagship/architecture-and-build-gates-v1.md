# MIZVO Flagship V1 — Architecture, Migration and Evidence Gates

Date: 2026-11-05. Proposed design work; do not mistake for implemented/deployed features. The actual V0.5 review build lives on draft PR #2, is Node/SQLite and has independently recorded test/CI evidence. It is not production and has no Cloudflare D1 adapter.

## Architectural decision

**Preserve and evolve a proven modular monolith first.** Maintain the existing app/API/domain/auth/storage structure and continuous testing. Create small new domain capabilities for the client lifecycle instead of migrating to a large new microservice, multitenant platform or speculative Workers for Platforms deployment. One self-hosted organization installation is the current scope; an enterprise multi-organization system needs distinct design and tests.

Mizvo Studio and Client Space remain two projections of the same Mizvo domain data; they do not have unrestricted shared access. Client project deployments (such as The Current) have **separate** hosting accounts, secrets, domains, storage and authorization. A future approved scoped integration may link status/evidence references without a cross-client database join.

## Existing implementation to retain

As documented in [PR #2](https://github.com/devonalanakins/mizvo/pull/2) and source STATUS.md:
- Authenticated founder/contributor/client sessions; server-side project membership and revocation.
- Persistent Room records and exact-version decisions; notes/discussions, authorization-safe pagination and deep links.
- Projects, milestones, tasks and source references; scoped client decision requests and immutable responses.
- GitHub read-only Workbench; explicit exact SHA and CI observation receipt; version and client review.
- Inquiry-to-project flow, activity notifications, support requests and in-app feedback.
- Node/SQLite migrations + backup; AGPL-3.0-only source; verified responsive tests in current draft PR.

No destructive reset of database migrations, account identity, project IDs, historical approval records, source receipts, original visual contract or previous design PR. A new client-first interface should sit on these real capabilities, not reimplement them with dummy fetch calls.

## Proposed domain additions (only where not already implemented)

| Domain concept | Minimum fields | Authority / invariant |
| --- | --- | --- |
| LivingBrief | projectId, problem, intendedUsers, outcomeCriteria, excludedScope, assumptions, version, createdBy, createdAt | Owner-authored draft; client review of exact version; modifications create new version |
| SolutionOption | projectId, kind(service/lightweight/full/custom), outcome, assumptions, tradeoffs, estimateStatus, order | No fake price or legal acceptance; selection separate from contractor signoff |
| DecisionLink | client request ID, relevant brief version, demo version, source object ref, reason and reviewer | A response cannot approve an unrelated or updated artifact |
| PreviewReceipt | projectId, environmentId, URL, sourceCommit, buildArtifactHash, preparedBy, observedAt, result, expiry | URL != verified working app; artifact match and auth tests separately recorded |
| Environment | projectId, environment, owner/accountRef, operatorGrantRef, dataClass, domainRef, status | No client credentials/logins stored in plaintext in Mizvo |
| ReleasePassport | versionId, commit, artifact hash, real deployment probe, license manifest, rollbackRef, backupRestoreRef | CI verification cannot automatically set deployment/restore as passed |
| OwnershipPassport | projectId, actual customerDomain, cloudAccountOwner, billingOwner, sourceRightsRef, dataExportRef, revocationProof, supportRef | Client ownership must be contract- and resource-backed |
| SupportAgreement | projectId, scope, hours, window, limits, escalation, expiry, evidence, approval | No SLA implied by app UI; actual contract external unless compliant records approved |
| ReviewAnnotation | project, version, audience-safe preview location, author, classification, resolution | Never mutate immutable released review version; enforce scope on attachments |

Avoid a duplicate `milestones`, `client decision requests`, `release versions` or audit table just for aesthetics. Build selectors and readable projections over existing state. New SQL migrations must be checksummed, additive and recovery-tested.

## Proposed API boundaries

Public:
- `POST /api/inquiries` stores validated, consented request and returns real receipt; existing endpoint preferred, enhance its UX.
- No public work history, actual client data or file uploads by default.

Authenticated Studio:
- `GET /api/projects/:id/commission` returns one readable Living Brief, next actionable state and source refs after current membership check.
- `POST /api/projects/:id/brief-revisions` writes versioned brief with optimistic concurrency.
- `POST /api/projects/:id/options` and `POST .../preview-receipts` operate only with project-owner/engineer grants as applicable.
- `GET .../proofline` computes evidence categories as separate facts, never a single “success percent.”
- Existing project Room, decisions, milestones and GitHub source verification stay authoritative.

Client Space:
- `GET /api/client/projects/:id/home` projects safe summary, scoped preview, next decision, support and ownership only.
- `GET /api/client/projects/:id/reviews/:id` includes exact-version approved content and approved audience-safe preview; never raw source secrets/internal notes.
- `POST /api/client/projects/:id/reviews/:id/response` refuses stale versions, expired grants, revised scope and duplicate tokens.
- `GET /api/client/projects/:id/ownership` has only client-approved operational data.

These are proposed route shapes, NOT existing endpoints. Adopt existing route vocabulary where it avoids churn. Callbacks must not send external email, charge a card, publish a release or provision cloud resources in the first vertical slice.

## User-specific permissions

Prospect: public inquiry only.
Mizvo founder: scoped business and technical operations, not unrestricted authorization to inspect employees' professional discussions.
Approved contributor: project-scoped technical work, no billing or unrelated project access.
Authorized client: only specifically client-visible items and exact-version decision action, no engineering receipts or private project notes.
Client account owner: chosen cloud/admin identity in client-owned hosting; this is not the same role as a Mizvo client-portal reader.

Negative cases: guessable project ID, direct support-file ID, deleted membership, expired invite, concurrent stale approval, audience-switching UI injection, cached previews with sensitive content, cross-client search/pagination, revoked session still accessing API, replayed release request, changing repo binding during asynchronous source checks.

## Cloud and self-hosting decisions

**Present:** Existing portable Node 24 + SQLite app. Keep real self-host proof and tests before selecting hosting.
**Candidate customer app deployment:** Cloudflare Workers/Static Assets for client web+API, D1 for metadata, private R2 or another S3-compatible store for media. Never assume this runs current Node/SQLite code unchanged; requires runtime interface and independent authorization/storage tests.
**Service-hosting alternative:** Client-controlled Node host/VM with TLS proxy, backed-up SQLite or PostgreSQL adapter depending on validated needs.
**Do not adopt early:** Cloudflare for SaaS and Workers for Platforms. Their tenant-code routing/custom-domain systems are relevant only if Mizvo later operates a genuine managed multi-client hosting platform; bespoke client-owned accounts do not need them.

**Specific verified Cloudflare media caveat:** Static Assets range requests can return HTTP 200 instead of 206 partial content. Cloudflare documents that some Safari video players require range responses; request handling must explicitly support byte-range 206, or deliver video via a properly configured private media service. This is a critical risk for Cristy's iPhone workflow. Validate MP4 seeking/replay, audio, captions/transcripts in actual Safari/iOS devices before accepting client delivery.
Sources: https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/ ; https://developers.cloudflare.com/workers/static-assets/ ; https://developers.cloudflare.com/d1/platform/limits/ ; https://developers.cloudflare.com/cloudflare-for-platforms/workers-for-platforms/ .

D1 currently has a per-database size limit (official Cloudflare docs list 10GB for Paid), and point-in-time recovery limits. Such details must be reconciled with real customer workload, retention and compliance. Do not promise unlimited scalable enterprise data.

## Security controls and software-supply-chain

- Trust boundary 1: public inquiry vs private operations; rate-limit and validate consent.
- Trust boundary 2: member role vs owner; dual server checks and audit.
- Trust boundary 3: customer projection vs internal project notes; visibility rules apply at every query and object retrieval.
- Trust boundary 4: Mizvo portal vs customer-deployed app; no shared private databases and no automatic ambient credential reuse.
- Trust boundary 5: development review content vs production/regulated data; synthetic fixtures and private staging.
- Trust boundary 6: authorized design review vs release approval vs legal signoff vs customer payment; distinct events.
- Secure development follows NIST SP 800-218 SSDF and OWASP ASVS 5.0 as reference requirements; actual certification is not claimed.
- MFA/passkeys for privileged production actors, logging redaction, minimal API grants, encrypted secrets, retention/export/delete program subject to actual legal review.
- No training AI on private customer data by default; no cross-customer model memory or assistant tool access.

## Release proof categories — never conflate

1. `SOURCE_LINKED`: exact repository revision.
2. `CI_OBSERVED`: named checks (with result/time) independently retrieved.
3. `ARTIFACT_ATTESTED`: deployed/releasable bytes cryptographically linked to source/build.
4. `STAGING_OBSERVED`: actual environment accessible and expected version confirmed.
5. `CUSTOMER_ACCEPTED`: authorized client approved specified outcome at version.
6. `PRODUCTION_OBSERVED`: real intended endpoint behavior verified, without leaking data.
7. `RESTORE_VERIFIED`: separate backup restore tested.
8. `HANDOFF_VERIFIED`: authorized client can operate/export/transfer with documented resources.

PR #2 currently supplies the source/CI part of this model, not all eight receipts.

## Engineering sequence and stop conditions

**G0 Source preservation / baseline:** Pin current PR #2 commit, check clean tests, pull request diff and reviewed assets; capture screenshots of actual app. If check cannot run, document it. Leave main and PR #2 unchanged until reconciliation is verified.

**G1 Accessible visual foundation:** Introduce redesigned layout/tokens on a feature branch without breaking real project/auth flows. All critical buttons have purposeful action; no fake client data outside clearly labeled fixtures. Verify 320/390/768/1024/1440/1920 and reduced motion.

**G2 Living Brief / client next decision:** Existing project has versioned purpose/outcome and a client action tied to exact reviewed preview; persist, reload, revoke, stale-version reject, cross-project denial. Keep conversation and client support working.

**G3 Proofline / source-to-preview:** Actual source and CI receipts, honest missing/failed status, verified staging read when available. Functional tests across failure and provider timeout. Add source-to-artifact only with real attestation.

**G4 Ownership Passport / hosting:** Customer account/domain evidence, operator access, required backup+restore demonstration in sandbox. Need a second deployment environment before claiming portability.

**G5 First commission proof:** A synthetic, original The Current microcase with participant, facilitator and investigator permission boundary; link evidence in Mizvo Studio without sharing storage. Real customers/users only after contracts and privacy/rights gates.

**G6 Release:** Security review, complete support contract, threat exercise, manual accessibility/VoiceOver run and verified deployed client environment with rollback. Explicit separate signoff. Not part of design approval.

## Quality target

“AAA” is operational: attractive first impression, fast interaction, no dead ends, intuitive no-coaching client decisions, no data loss across interruption, genuine authorization tests, accessible fallback, predictable running costs and independently recoverable client data. Document objective acceptance results; aesthetic approval alone is insufficient.

## Preservation / archive policy

Avoid archiving `mizvo` or `the-current` repository while active. Capture immutable source commit/PR refs, save existing visual concept hashes and mark superseded design drafts as **historical references** rather than removing them. If later founder explicitly chooses a new implementation, prove recovery and content parity before retiring prior source. The first redesign PR should contain design documents only, and then a separately testable engineering PR.

## First executable increment recommended

After design review: take the current verified Mizvo implementation PR #2 and implement **a single persisted Living Brief + client-safe exact-version “Next Decision”**. This directly exercises the Mizvo-as-a-company model and is more valuable than extending the fictitious The Current application without a working client collaboration pathway.

Retain all legal/client authorizations and the separate urgent Cristy production workstream as independent gates.
