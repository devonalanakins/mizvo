# Capability status

All implementation below is locally runnable review source, with public publication approved under AGPL-3.0-only. No application deployment is LIVE. Test evidence is recorded separately in VERIFICATION; these labels do not imply public release or legal/business status.

| Area | Implemented | Boundaries / incomplete |
| --- | --- | --- |
| Discover | Home, capabilities, process, work empty state, founder identity, contact path, consented inquiry and private intake | Portfolio empty; approved production contact/privacy/retention still required |
| Identity | Provisioned accounts, password login/change, expiring sessions, CSRF/Origin checks, logout and other-session revocation | No public registration, MFA/passkeys/OIDC or self-service recovery |
| Project Room | Persistent projects, purpose/scope/status/owner, notes, discussions, design context, proposed decisions, exact-version approval/rejection, history, inspector, search | Record history is paginated with older-record retrieval; no real-time coediting, calls or media |
| Plan | Versioned milestone checkpoints with dates/status/visibility and task linkage; legacy task labels, priorities, dependencies with cycle checks, blockers/review states, completion evidence and owner review | No multi-dependency graph, task assignees/dates, timeline or board; preexisting task labels remain unlinked until assigned |
| People | Real provisioned identities, hashed one-time invitations, acceptance, 7/30/90-day project access, role changes, expiry and immediate revocation | No actual acquaintances invited; invitation transport is manual and sends no email |
| Pipeline | Validated inquiry, qualification/scoping/approval stages and atomic conversion to a project | No contractual proposals, signatures, payments or finance adapters |
| Home / search / notifications | Real project overview, pending decisions, blockers/reviews, actual audit activity, authorized search, generic in-app notifications and opt-out | No outbound notifications or cross-provider sync |
| Workbench | Allowlisted GitHub association, branches/commits/PRs, source browsing, compare diffs, exact-commit check runs and evidence/log links | Public read integration verified; private credential setup, inline logs, syntax highlighting, review-policy enforcement and preview provisioning remain |
| Delivery | Immutable version with exact SHA, links, rollback, independent review and GitHub source/CI checks; CI-produced byte-inventory for the compiled candidate with independent SHA-256 recheck | No signed provenance, verified artifact-to-release binding, production artifact hosting, deployment/preview or release execution |
| Client Space | Isolated shared overview/tasks/milestones/versions; recipient-specific client decision requests and immutable exact-version responses; feedback/support and exact-version reviews | No legal/contractual acceptance, client uploads or support SLA workflow; responses do not approve releases |
| Operations | Founder-restricted installation information and modular integration boundaries | No accounting, contracts, payments, staffing or invented business resources |
| Responsive design | Shared graphite/ivory/copper system, original copper architecture SVG, licensed fonts, desktop/tablet/mobile shells, drawers and bottom navigation | Visual language is preserved; original vector art differs from concept’s photorealistic architecture; no human visual/comprehension sign-off |
| Runtime / recovery | Node/SQLite adapter, ordered checksummed migrations, atomic updates, online backup/integrity checks, CI definition | No D1/Workers adapter, cloud deployment, distributed load test, external log/backup pipeline or production drill |
| Advanced | Permission boundaries and documented seams | Live media, project AI, SMS, financial integrations remain FUTURE and inactive |

The full requested production platform is not complete. This build completes the operational Room and collaboration foundation and connected initial Studio/Discover/Client workflows. The rows above explicitly retain deeper module and release work rather than presenting screens as complete services.
