# Code-integrity audit — V0.5 private review

**CLAIM:** Operational local Room/collaboration foundation plus connected initial Discover, Studio and Client Space workflows. No full-platform completion, independent human review, production deployment or security certification.

**OBSERVED:** The code path is browser JSON input → session/Origin/CSRF boundary → current organization/project membership → validated domain operation → atomic SQLite record/history/audit update → explicitly scoped response. The client response is constructed as a whitelist projection. The GitHub adapter reads an allowlisted host/repository and never accepts a shell command or arbitrary fetch URL.

This report is a separate adversarial review pass by the same implementation agent. It is not an independent person’s approval, and AI review cannot provide a qualified human signature.

## Findings resolved and retested

| Finding | Correction | Evidence |
| --- | --- | --- |
| A contributor could attempt to waive task review on completion | Only the owner may disable required review; completion checks dependency/evidence/reviewer permissions | Negative HTTP test |
| Decision edits or stale requests could carry misleading approval | Edit creates a version and resets proposed; approval compares exact still-proposed version | History and stale-approval tests |
| Revoked membership could regain access through an old outstanding invitation | Revocation also cancels pending invitations for that project/user address; each request rechecks the grant | Invitation/revocation tests |
| A client projection could expose task evidence or engineering fields if raw rows were returned | Explicit shared fields; internal task evidence, source, history and rollback excluded | Cross-client/object/history/engineering negative tests |
| Notification content might disclose internal text | Only generic activity text is stored; active membership is required to retrieve it | Notification privacy/expiry tests |
| Password normalization could change leading/trailing whitespace | Password-specific validation preserves bytes; explicit stronger scrypt parameters are recorded | Whitespace/work-factor tests |
| A migration failure or partial inquiry conversion could leave inconsistent data | Checksummed ordered migrations, transactions/savepoints and atomic inquiry conversion | Upgrade/rollback-refusal and lifecycle tests |
| Live WAL files could be backed up inconsistently | SQLite online backup API plus integrity checks and an independent restored connection | Recovery test |
| Icon-only tablet links had no accessible names | Stable aria labels across responsive collapse | Axe at 768px and all requested widths |
| Mobile inspector covered its own toggle | Internal close control, focus restoration and Escape behavior; desktop collapse works separately | Browser drawer/keyboard checks |

## Remaining release findings

- **High / release gate:** No approved production host, identity provisioning policy, real-user authorization acceptance, TLS/proxy configuration or production restore evidence. No deployment should be inferred from local test passes.
- **Publication gate — subsequently resolved:** Founder approved public publication and AGPL-3.0. Source is AGPL-3.0-only; the old unlicensed prototype and concept images remain excluded. Production gates remain open.
- **Medium / engineering evidence:** A manually recorded release contains a user-supplied exact-format SHA and links. It is an immutable attributed record, not automatic verification that the SHA exists in the associated repository, artifacts match it, tests passed, or a deployment occurred. Workbench reads genuine GitHub evidence separately. Require source-to-artifact verification before production release approval.
- **Medium / scale and maintainability:** Room lists are currently unpaginated; synchronous SQLite and the single frontend entry point need measured scaling/refactoring as project volume grows. No distributed/large-data claim is made.
- **Medium / identity operations:** No MFA/OIDC/passkeys, self-service recovery or email ownership verification flow. Administration must provision identities deliberately; private-provider credentials and incident procedures remain untested.
- **Medium / operational durability:** Local audit records and snapshots work; independent encrypted retention, external security-log collection, data deletion policy and actual recovery drills are not activated.
- **Low / design acceptance:** Automated accessibility and responsive evidence pass for captured states; human screen-reader, usability/comprehension and final visual acceptance remain outstanding. Vector imagery differs from the locked board’s photorealistic atmosphere.

## NOT CHECKED

Private GitHub App permissions and rotation, GitHub write/reviewer-policy automation, hosted previews, real CI failures/log retrieval, malicious uploaded files (uploads not implemented), load/availability, legal/business claims, actual communications, external AI data handling and production data. No absence-of-bugs assertion follows from this audit.

## DECISION

**VERIFIED for the named local checks; RELEASE_NO_GO for public/production release.** No unresolved demonstrated critical authorization defect was found in this pass, but that does not certify completeness or security. Preserve the private build and evidence for review.

## Human comprehension and next action

The meaningful user outcome is durable project context with explicit decisions and project-bounded collaboration. The worst immediate failure would be an authorization/projection error exposing another project or internal client data, which is why independent identities, object IDs, history paths, revocation, search and notification boundaries are challenged.

Before releasing, the human reviewer should trace one client read and one decision write through the actual server and explain why the negative tests would fail if the corresponding guard were removed. Source publication/license approval enables a real implementation PR; production approval requires the separate runtime, identity and operational evidence in RELEASE.md.
