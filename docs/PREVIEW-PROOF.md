# Preview reachability and Proofline (implementation review)

## Behavior and scope

This is a **read-only observation** of a recorded demonstration URL. The project owner may click **Check preview reachability** on a release whose `demo_url` exactly matches one URL provisioned by the Mizvo installation administrator. The server sends a bounded HEAD request, **without cookies, credentials, redirects or response-body ingestion**, and persists an attributed, immutable receipt with the release/project binding, result, status, observation time, exact expected release commit and any optional *untrusted* `X-Mizvo-Source-Commit` response header.

Results are `reachable` (2xx), `redirect_denied` (3xx, never followed), `http_error` (non-2xx/3xx) or `network_error`. A 200 or matching response header proves only what the endpoint reported when contacted, **not** that the current application is correct, public, deployed from the expected source, or safe. There is no promotion to “staging verified,” “production verified” or “artifact attested.” A failed response is still recorded as failed, not silently hidden.

The Proofline shows six independently understood moments: Need, Decision, Preview, Source, Operate and Care. Internal source/CI checks are never exposed to clients as raw engineering receipts. Client projections show only a small, client-visible reachability summary and no actor IDs, expected commit hashes, repository identifiers, request transport internals or private releases.

## Configuration

No external calls are possible by default. The installation operator must supply the comma-separated `MIZVO_PREVIEW_URLS` in server configuration. Each entry must be an exact, canonical public HTTPS URL without embedded credentials, port overrides, query tokens, fragments, IP literals or internal-only hostname suffixes. `https://preview.example.org/check` is a **synthetic unit/browser test target only**; no real preview environment is provisioned here.

The server calls the configured endpoint directly: do not place secrets, private data, internal operations endpoints, authentication tokens or user-controlled URL parameters in this allowlist. URLs configured by trusted administrators are an operational privilege; DNS-controlled targets remain a security concern. Prior to enabling this in an internet-connected production installation, use a network policy or egress proxy that independently denies private/link-local/reserved destination IP ranges (including DNS rebinding and IPv4-mapped IPv6) and restricts outbound connections. **Hostname checks alone are not an SSRF guarantee.**

Read-only project members and clients cannot trigger checks. Owners are rate-limited to six attempts per minute. Project membership, release identity, URL and commit binding are revalidated after the asynchronous network call, before saving the receipt. No outcome can approve a release or client decision. Existing release versions and prior evidence remain immutable.

## Verification

The automated suite uses an **injected mock fetch transport**, not a real staging server. It verifies exact allowlist matching, no request on forbidden targets, HTTP errors, refused redirects, network failures, reported-commit mismatch, route/role/project isolation, client-safe projections, persistent receipts across database reopen, changed release URL after the await, and revoked owner during the await. Chromium uses synthetic authenticated founder/client accounts and verifies the Proofline interface at desktop and phone widths with Axe WCAG tags.

Unverified gates: actual external preview availability, DNS / egress network-policy testing, TLS termination and origin identity, post-deployment artifact-byte check, external accessibility/usability testing, backup restore, incident process, independent security review, and release authorization. Nothing is deployed by this change.
