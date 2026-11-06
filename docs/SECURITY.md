# Security boundary and threat review

## Protected assets and identities

Real records belong to the configured Mizvo organization and a specific project. Founder authorization comes from `organization_members`, never a browser-selected role. Project owners, contributors and clients come from live membership rows. Membership expiry/revocation is checked on every request, including already-authenticated sessions, search and notifications. An owner cannot be replaced or revoked through project invitation endpoints.

No open registration, collaborator email, automatic invitation delivery, AI processing, SMS, payments, background recording, presence tracking or remote shell is active.

## Controls implemented

- Scrypt password hashes with per-user random 128-bit salt and explicit work factors `N=65536,r=8,p=2` (64 MiB), timing-safe comparison, 14-character minimum and 200-character maximum. Password whitespace is preserved. Parameters follow one of OWASP’s published scrypt configurations: <https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html>.
- 256-bit random session tokens; only SHA-256 digests stored. HttpOnly, SameSite=Strict, host-only cookies; Secure and HSTS in production. Eight-hour expiry, explicit logout, other-session revocation and password-change invalidation.
- Exact configured Origin required for unsafe requests; authenticated changes additionally require the session’s random CSRF token. No permissive CORS.
- Parameterized SQL, a strict 32 KiB **raw-byte** JSON request cap (including streamed/chunked UTF-8), early Content-Length denial, fatal invalid UTF-8 rejection, validated media types/encodings and bounded fields; validated HTTPS links, output escaping and text-only source rendering. Strict CSP without inline script/style or external font services.
- Client record response minimization: Room, paginated record lists and direct record reads return only `id,kind,title,body,state,version,actor,created_at,updated_at,can_edit` to client members. `can_edit` is computed from the authenticated viewer; internal `actor_id`, `project_id`, `visibility` and any future model fields remain server-side. Client record history returns only `version,title,body,state,actor,created_at`. The record-level visibility and author-only checks still run before either projection. Internal Studio responses retain their existing detail.
- Fail-closed client projections: the client project list uses a fixed allowlist of `id`, `name`, `purpose`, `scope`, `status`, `updated_at` and the caller's project `role`, excluding owner and organization IDs. Internal records/history, code, internal task evidence, rollback notes, finances and unrestricted member data are excluded. Client feedback/support is forced client-visible **to its author and the project team**, not other clients who happen to share a project. Per-client restrictions apply to room pages, individual record/history endpoints, search, editing and support-status changes. Clients cannot propose or approve internal decisions.
- Version-based compare-and-swap for notes, decisions, tasks and lifecycle updates. Editing a decision creates a history version and resets it to proposed. Approval requires the exact still-proposed version.
- One-time, email-bound, hashed invitation tokens; 72-hour acceptance window; 7/30/90-day project grants. Owner-only role changes and revocation. Revoking a member also revokes their pending invitations.
- Atomic project/audit/history changes, monotonic audit sequence, immutable release records and one attributable review per actor/version. Release authors cannot approve their own release.
- Persistent per-IP and account-specific rate limits, input caps and honeypot/consent validation for public inquiry. Notifications contain generic activity, not confidential text. A generic timestamp still reveals activity, so client alerts now default to internal-team visibility unless the underlying record or task is explicitly shared; feedback/support activity reaches only its author and the team, and directed client decisions reach only their recipient and the team. Revoked members cannot retrieve prior notifications.
- Exact GitHub repository allowlist, project access, read-only API calls, deadlines and bounded upstream response streams. No arbitrary host URLs or process execution.
- Preview checks are owner-only, rate-limited and disabled without an administrator exact-URL allowlist. The guarded default transport validates all DNS answers against public-address ranges and pins the selected IP into an HTTPS HEAD socket with hostname SNI/certificate verification, redirects disabled, and no response-body ingestion. Operational outbound network restrictions and an independent production SSRF review are still required.
- Checksummed, transactional, ordered SQL migrations; incompatible schema downgrades and edited migrations are refused. Backups use SQLite's online backup API, private temporary snapshot directories, integrity checks, and exclusive no-overwrite publication with restrictive permissions, never a raw copy of a live WAL file.
- Generic internal errors and request IDs without request-body or credential logging.

## V0.19 sealed backup threat boundary

The optional operator CLI can authenticate/encrypt a verified detached SQLite snapshot with an externally managed owner-private 32-byte key, random nonce, AES-256-GCM, integrity/migration checks and exclusive publication; it never automatically uploads archives or alters the active database. Isolated restore checks delete temporary plaintext on normal completion/failure, but cannot guarantee crash-resistant cleanup or underlying filesystem encryption. Key custody/rotation, real off-host retention, restore tests, independent cryptographic review and provider controls remain unverified; use only approved encrypted private storage and separate key custody. See [Sealed backups](SEALED-BACKUPS.md).

## Readiness probe boundary

The unauthenticated `GET /api/ready` is a minimal operational readiness indicator. It checks the configured organization, migration/checksum correspondence and representative account, project authorization, invitation, record, and rate-limit table reads without exposing SQL errors, data or internal model details. It returns 503 if those reads fail. It cannot guarantee disk writeability, transaction success, restored permissions, externally verified release identity or business-level health. `GET /api/health` deliberately remains a lightweight process-liveness response. Operators must not mistake either for independent security certification.

## Limits that still govern release

This is an engineering review build. No qualified human security signature, penetration test, real-user usability study, assistive-technology screen-reader session, production TLS/proxy test, private GitHub credential test, load test, or production recovery drill is claimed. The code-integrity review is a distinct adversarial pass by the implementation agent, not an independent human reviewer.

Account identity verification/provisioning is administrative. Self-service password recovery, MFA/passkeys/OIDC, breached-password checking, durable external security-log export, retention/deletion workflows, file uploads/malware scanning, and multi-organization account management are not implemented. Before production: approve the identity policy, host/security controls, data retention and response process. User-provided deliverable/demo links are stored and validated as HTTPS, not fetched or certified as safe/authorized by the server. Clients must use approved links, never a public link to confidential files.

One process with local SQLite is suitable for the verified small-installation topology. Room record reads are bounded to 50 by default and 100 maximum per page, with scoped keyset cursors and direct-record authorization. Tasks/releases and loaded DOM accumulation still need larger-data performance work; distributed-operation testing remains incomplete. There is no offline record cache: the application keeps unsaved text in the current page and reports network errors; it does not claim offline synchronization or background retries.

Node’s documented SQLite API is a release candidate in the verified Node 24.22.1 runtime, rather than a claim of cross-runtime support. Pin and review runtime updates. Official reference: <https://nodejs.org/download/release/v24.22.1/docs/api/sqlite.html>.


## V0.16 asynchronous authorization and review audiences

Authenticated JSON bodies recheck the current session after the stream completes. Project-scoped writes also recheck current project/surface access, and owner/founder operations retain their stricter gates. GitHub reads recheck the session, current grant and repository binding before sending provider results. Source/preview observations recheck the session before persisting their receipt. Password verification cannot create a session from a hash replaced during scrypt; password changes recheck session validity after verification.

Release-review audience is stored at write by migration 009. Clients see only their own client-audience feedback; internal comments and other client responses remain internal. Earlier reviews default internal because historical role provenance is unavailable. Current role changes never reclassify earlier comments. A private own-review boolean prevents offering a duplicate review without disclosing its text. These controls have synthetic negative HTTP regressions, not human security certification. See [V0.16 audit](V0.16-INTEGRATION.md).
