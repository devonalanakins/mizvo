# Preview reachability and Proofline (implementation review)

## Behavior and scope

This is a **read-only observation** of a recorded demonstration URL. The project owner may click **Check preview reachability** on a release whose `demo_url` exactly matches one URL provisioned by the Mizvo installation administrator. The server sends a bounded HEAD request, **without cookies, credentials, redirects or response-body ingestion**, and persists an attributed, immutable receipt with the release/project binding, result, status, observation time, exact expected release commit and any optional *untrusted* `X-Mizvo-Source-Commit` response header.

Results are `reachable` (2xx), `redirect_denied` (3xx, never followed), `http_error` (non-2xx/3xx) or `network_error`. A 200 or matching response header proves only what the endpoint reported when contacted, **not** that the current application is correct, public, deployed from the expected source, or safe. There is no promotion to “staging verified,” “production verified” or “artifact attested.” A failed response is still recorded as failed, not silently hidden.

The Proofline shows six independently understood moments: Need, Decision, Preview, Source, Operate and Care. Internal source/CI checks are never exposed to clients as raw engineering receipts. Client projections show only a small, client-visible reachability summary and no actor IDs, expected commit hashes, repository identifiers, request transport internals or private releases.

## Configuration

No external calls are possible by default. The installation operator must supply the comma-separated `MIZVO_PREVIEW_URLS` in server configuration. Each entry must be an exact, canonical public HTTPS URL without embedded credentials, port overrides, query tokens, fragments, IP literals or internal-only hostname suffixes. `https://preview.example.org/check` is a **synthetic unit/browser test target only**; no real preview environment is provisioned here.

The server's default transport resolves all DNS A/AAAA answers before connecting. It refuses empty/mixed public-and-private/reserved answers, IPv4-mapped private IPv6 addresses, excessive or malformed results, and nonpublic IPv4/IPv6 ranges. The request then connects to the **selected numeric public IP only**, while preserving the original hostname for HTTPS Host/SNI and certificate verification; redirects are never followed and response bodies are never consumed. Tests inject a fake resolver and socket dialer to challenge these invariants without external traffic. Administrator allowlists remain exact and disabled by default.

**This is application-level defense, not a guarantee of safe routing.** DNS, routing, NAT, egress proxies and host networking can still undermine application rules. Before enabling real checks in an internet-connected production installation, enforce an independent outbound network policy that denies private/link-local/reserved destinations, prevents DNS rebinding or destination rewriting, and restricts access to metadata/internal services. No production egress firewall or real DNS/TLS verification has been tested or deployed by this change. Never place secrets, internal operations endpoints, tokens, confidential records or user-controlled query parameters in the allowlist.

Read-only project members and clients cannot trigger checks. Owners are rate-limited to six attempts per minute. Project membership, release identity, URL and commit binding are revalidated after the asynchronous network call, before saving the receipt. No outcome can approve a release or client decision. Existing release versions and prior evidence remain immutable.

## Verification

The automated suite uses an **injected mock fetch transport**, not a real staging server. It verifies exact allowlist matching, nonpublic IP rejection, mixed DNS rebinding, selected-IP pinning, hostname-based TLS policy, forbidden methods, no request on rejected targets, HTTP errors, refused redirects, network failures, reported-commit mismatch, route/role/project isolation, client-safe projections, persistent receipts across database reopen, changed release URL after the await, and revoked owner during the await. Chromium uses synthetic authenticated founder/client accounts and verifies the Proofline interface at desktop and phone widths with Axe WCAG tags.

Unverified gates: actual external preview availability, DNS / egress network-policy testing, TLS termination and origin identity, post-deployment artifact-byte check, external accessibility/usability testing, backup restore, incident process, independent security review, and release authorization. Nothing is deployed by this change.
