# Living Brief + Next Decision — implemented review slice

## Purpose and boundary

The project's **Living Brief** answers six questions in ordinary language: problem, affected people, desired outcome, observable success criterion, exclusions and assumptions. Studio project owners save immutable revisions; every revision has an actor, time, project ID, monotonic version and independent `internal` or `client` visibility. No historical revision is overwritten.

Client Space receives **only the latest explicitly shared revision**. An internal-only newer revision does not change what the client is currently asked to review. If no shared revision exists, Client Space shows a truthful blank state rather than the private draft. A complete internal revision history is visible only to authorized Studio members.

## Client action

An owner can address one client with a decision request linked to the *currently shared* Living Brief revision and, optionally, an existing client-visible immutable release/version record. The release's recorded demo URL is not evidence that a preview is accessible, staged, tested, or deployed. In Client Space a single outstanding current decision receives primary placement. Historical or independently addressed requests remain in the Decisions tab.

If a newer shared brief revision is published, pending requests linked to an older shared revision are shown as **outdated** and cease to be actionable. The owner must issue a new request tied to the new shared revision. A concurrent or replayed response is rejected in the same database transaction. Legacy unlinked requests remain compatible. A response stores attributable, immutable `accepted` or `changes_requested` feedback; it is neither contractual acceptance nor engineering release authorization.

## API and data

- Additive SQL migration `006-living-brief.sql`: `project_brief_revisions` with project-version uniqueness; optional `brief_revision_id` and `release_id` on existing `client_decision_requests`.
- Authenticated `POST /api/projects/:id/brief-revisions`: only the project owner, exact `base_revision` required; stale writes return 409.
- Existing Studio and Client Space project GET routes return different projections. Client reads never include internal drafts, actor IDs, private development notes, GitHub evidence, or other clients' requests.
- Existing `POST /api/projects/:id/client-decisions` accepts two optional version IDs and rejects internal/cross-project releases or stale/private brief revisions. Client response checks the current shared version and request's optimistic lock before inserting a unique response.

No new external services, credentials, cloud resources, contracts or production migrations are introduced. This is a local/self-hostable reviewed **source implementation**, not LIVE.

## Verification

Tests cover revision persistence across SQLite reopen, project/role separation, hidden drafts, client-safe projections, stale version conflicts, shared-version invalidation, exact release binding, wrong-recipient responses and replay protection. Playwright covers owner creation, shared client view, literal escaping of unsafe HTML, recorded demo association, one next-decision action, client response, mobile widths and Axe.

The “Promise to Proof” storyboard from draft design PR #3 is **proposed design**, not an approved replacement of Mizvo's existing visual identity. This change retains current layout/theme and only adds the proven human-readable workflow. Future release stages still require authenticated real preview, source-to-artifact binding, actual deployment observation, ownership/restore proof and human usability/accessibility review.
