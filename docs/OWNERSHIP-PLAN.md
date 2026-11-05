# Ownership & Hosting Plan — client-first planning slice

**Status:** Source implemented on a draft review branch, not merged or deployed. No external accounts, DNS, cloud resources, billing identities, legal contract, production support services, SLA, backup restoration or client data export has been independently verified by this feature.

## Problem and value

A client should understand whether they or Mizvo will own the domain, cloud account, bill and operations before an application is commissioned or launched. In a conventional engineering dashboard this information is often buried in emails or never written down. Mizvo provides a readable, versioned plan inside each authorized project, with no requirement for the client to learn GitHub, Cloudflare or deployment tools.

The record is **an intentional proposal**, not proof of control. It cannot be used to certify legal ownership, provider access, live service, compliance or successful data recovery.

## Three proposals supported

- **Client-owned, Mizvo-operated:** Customer controls provider account, domain and billing. Mizvo operates through independently authorized least-privilege access under a separately signed service agreement.
- **Mizvo-hosted:** Concept only; not a verified currently available service. Requires real support, tenant isolation, infrastructure billing, incident response, backups, export and exit terms.
- **Client self-hosted:** Customer owns and operates software with separately specified engineering and handoff support.
- **Undecided:** Default, no choice presumed.

This menu is a planning model. It does not bind a customer or create infrastructure.

## Data and versioning

Migration `007-ownership-plan.sql` creates `project_ownership_revisions` with an immutable, project-scoped revision number, selected model, **planned** domain, named infrastructure and billing owners (descriptive labels only, not identifiers or credentials), planned technical operator, export/handoff plan, support boundary, internal or client visibility, author and timestamp.

Only the project owner can create a new revision, and must specify the exact latest version as `base_revision`; stale writes are rejected with 409. The previous record is never overwritten. A project-specific, server-side membership check is enforced before reading or changing the plan. Clients receive **only the latest explicitly shared revision** and never receive internal drafts, actor IDs, revision history or other projects' plans. New internal drafts do not retract an older shared plan.

The server always supplies `verification_status = "not_verified"` for client-facing plans. An incoming JSON field claiming verification has no effect; the system does not trust customer or owner text as infrastructure evidence.

## API and interfaces

- Studio `POST /api/projects/:id/ownership-plan` — project-owner-only, creates an immutable revision.
- Studio `GET /api/projects/:id` — project-scoped plan and history under normal internal membership.
- Client Space `GET /api/space/projects/:id` — safe last-shared projection only.
- There is **no** client plan mutation endpoint, cloud-creation endpoint, approval signature or payment operation.

Studio Handoff and Client Space Ownership tabs show the same agreed planning topics at appropriate audience visibility. Text is escaped before HTML insertion and layouts are intended to work from narrow phones to desktop.

## Acceptance and verification requirements

1. Owner creates a private draft and confirms its contents never appear in Client Space's JSON, page or DOM.
2. Owner creates a shared revision and sees the complete history; client sees only the latest shared projection and the immutable version.
3. A later private revision does not expose its content or falsely imply the shared version changed.
4. Invalid model, stale version, unassigned user, contributor edit, cross-project read, and revoked customer access are denied.
5. SQLite reopen preserves the records and migration checksum without harming the existing migrations 001–006.
6. Browser checks at 390px and 1440px, accessibility and XSS-escaping tests must pass.
7. Any later upgrade to a **verified Ownership Passport** requires trusted provider ownership evidence, real restore/export observations, explicit client approval, true support responsibility and appropriate contractual privacy/data terms. Never mark those complete based on this proposal alone.

See [Mizvo flagship redesign proposal](https://github.com/devonalanakins/mizvo/pull/3) and [Mizvo implementation baseline](https://github.com/devonalanakins/mizvo/pull/2).
