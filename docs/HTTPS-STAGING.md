# Production-mode HTTPS rehearsal — synthetic localhost TLS

**Status:** Reproducible CI acceptance test. The TLS proxy and certificate exist only in an ephemeral isolated CI workspace. **No public site, customer account, real domain, real client data, cloud provider or deployment is involved.**

## Why we added this gate

The standalone Node server is intentionally bound to loopback. A public customer installation would require a reviewed reverse proxy with a real certificate and secure production environment, but existing localhost tests used HTTP. This separate test verifies the application behaves correctly through a real HTTPS socket, without claiming a real deployment has happened.

## Execute

From the repository root, with Node 24.22.1+ within Node 24 and OpenSSL available:

```sh
npm ci
npm run build
npm run test:tls
```

CI executes it after the synthetic backup/restore staging exercise and before Chromium/Axe. The test accepts **no user-provided paths**. It copies the compiled distribution to private temporary storage, generates a throwaway self-signed certificate with localhost SAN, starts Node with `NODE_ENV=production` and `MIZVO_ORIGIN=https://localhost:<random-port>`, and puts a local-only HTTPS reverse proxy in front of the loopback service.

The harness provisions only two synthetic identities and runs real HTTP/TLS requests against the compiled service.

## Verified behaviors and negative cases

- Reject an untrusted TLS certificate, and reject the trusted test certificate when presented for the wrong hostname.
- Validate a trusted localhost certificate, TLS version and HTTP 200 health result through the proxy.
- Verify HSTS, content security policy, anti-framing header and static HTML.
- Verify the production session cookie has `Secure; HttpOnly; SameSite=Strict`.
- Authenticate a founder and client, create a project, deny the uninvited client, explicitly accept an invitation, allow the assigned client into Client Space and deny internal project APIs.
- Reject mutation without CSRF token, with wrong Origin and with requests exceeding the proxy's 32 KiB body cap.
- Keep the proxy listening on `127.0.0.1`, keep credentials out of logs and receipts, stop all processes and remove the temporary certificate and database after the test.

The test outputs `docs/evidence/tls-staging.json`, a sanitized technical receipt with runtime/version digest and boolean checks. The artifact is unsigned and is not a cloud or production attestation.

## Explicit limitations

This **does not validate** a production reverse proxy configuration, publicly trusted certificate, DNS, Cloudflare resources, organization-specific secure hosting, user identity verification, provider billing ownership, independent backup retention, client consent, legal/commercial acceptance or actual on-call service. The test certificate's private key is temporary and must never be used outside this harness.

A production deployment needs an authorized domain and provider, certificate provisioning and renewal, a dedicated non-root runtime, persistent encrypted storage, provider-specific rate limits, external monitoring, real restoration and operational incident/rollback coverage. The actual intended HTTPS endpoint must be independently tested after deployment before labeling it **LIVE**.

This gate adds no Cloudflare D1/Workers adapter; the Node/SQLite runtime remains a self-hostable application and should not be described as running in Workers.

**Integration boundary:** This change includes the synthetic startup/rollback exercise originally reviewed in draft PR #8, plus this separate HTTPS gate, and now targets Mizvo's current flagship integration PR #7. The final acceptance run must include PR #7's newer DNS-pinned preview observation tests as well as both staging exercises. HTTPS localhost success is independent from whether an external preview endpoint is safe or actually belongs to a client.

See [Self-hosting](SELF-HOSTING.md), [Release and recovery](RELEASE.md), and [Synthetic staging](STAGING-REHEARSAL.md).
