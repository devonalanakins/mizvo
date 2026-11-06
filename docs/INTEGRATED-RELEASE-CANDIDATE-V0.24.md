# Mizvo integrated release candidate V0.24 — mainline review

**Status: DRAFT REVIEW ONLY / RELEASE_NO_GO / UNMERGED / NOT DEPLOYED.**

This branch gives reviewers **one complete diff against `main`**. It does not replace the existing Mizvo application, change its design direction, create infrastructure, authorize external access, or grant permission to merge. Source license remains AGPL-3.0-only.

## Immutable review baseline

- Origin repository: `devonalanakins/mizvo`.
- Current `main` at preparation: `b247d4e1c78af0057992ec2be9f68c13b755aaca`.
- Integrated tested source: `feature/sealed-offline-restore-v0-24` at `618ba2320296cf0463c4b249f7354a4d82f768f0`.
- Verified source comparison: 276 commits **ahead**, 0 commits **behind** `main`, 87 changed files. The extra commit on this consolidated PR adds **only this review guide**; re-check ancestry and complete CI before accepting any newer version.
- Established incremental review chain remains intact: [#15](https://github.com/devonalanakins/mizvo/pull/15) → [#16](https://github.com/devonalanakins/mizvo/pull/16) → [#17](https://github.com/devonalanakins/mizvo/pull/17) → [#18](https://github.com/devonalanakins/mizvo/pull/18) → [#19](https://github.com/devonalanakins/mizvo/pull/19) → [#20](https://github.com/devonalanakins/mizvo/pull/20) → [#21](https://github.com/devonalanakins/mizvo/pull/21) → [#22](https://github.com/devonalanakins/mizvo/pull/22) → [#23](https://github.com/devonalanakins/mizvo/pull/23). Do not close or merge these automatically.

This consolidated mainline PR is a **review alternative** to merging the stack sequentially. Never merge it *and* the same stacked PR chain without an explicit reconciliation; that would duplicate integration paths and obscure source history.

## What actually works in the review source

- Discover: public-facing product presentation and consented inquiry intake.
- Studio: provisioned identity, role-scoped project rooms, versioned briefs and decisions, tasks and milestones, manually accepted project invitations, in-app notifications, read-only GitHub workbench and delivery evidence.
- Client Space: privacy-filtered shared project context, client decisions, private feedback/support and recorded version reviews.
- Local ops: Node 24 + private SQLite, checked migrations, atomic backups, encrypted sealed archives, isolated offline restore with recovery-session invalidation, synthetic staging and TLS checks, artifact identity and runtime readiness.
- Existing graphite/ivory/copper responsive interface, licensed local fonts and AGPL-3.0-only code.

**Not present or not proven:** paid staffing/contract tools, outbound mail, real-time code rooms/video calls, independent private hosting, Cloudflare Workers/D1 compatibility, externally verified deployment identity, independent off-host backup storage, real user/client acceptance, or production service status. See [capability matrix](STATUS.md) and [release gates](RELEASE.md).

## Evidence

- Exact tested upstream source `618ba2320296cf0463c4b249f7354a4d82f768f0`: [successful GitHub Actions run #42282603854](https://github.com/devonalanakins/mizvo/actions/runs/42282603854): **62/62 Node tests**, formatting, TypeScript, build/distribution/installation evidence, synthetic offline recovery and privacy-negative cases, local HTTPS, rootless OCI SQLite persistence, production dependency audit reporting zero vulnerabilities. Chromium and WebKit each completed **38 responsive/accessibility captures** with zero recorded application CSP, Axe and page errors.
- **The consolidated PR needs its own exact-head CI**. A green upstream workflow cannot substitute for the integrated PR's check.
- All verification above is on synthetic localhost/CI, not real staging. A server's self-reported checksum is not a trusted independently signed deployment attestation.

## Human release-review checklist

- [ ] Review authorization paths for every account role, revocation, cross-client privacy and request-size limits; verify unrelated projects and clients cannot read each other's records.
- [ ] Reconcile license/source provenance, dependency advisories, synthetic artefact inventory and whether stale evidence files are being mistaken for current results.
- [ ] Inspect SQLite migration/checksum assumptions, isolated restore, session revocation, post-snapshot membership reconciliation and rollback behavior.
- [ ] Verify source-to-artifact identity and network trust on an **approved** separately hosted, persistent Node/SQLite private staging environment; a Worker deployment would require a separately tested adapter.
- [ ] Validate an independently transferred encrypted off-host archive and separately protected key by restoring onto an isolated trusted encrypted disk; report observed RPO/RTO rather than inventing a target.
- [ ] Conduct real iPhone, keyboard/accessibility and nontechnical-user acceptance on a controlled private staging deployment.
- [ ] Obtain independent human security approval, production access rules, incident response plan and explicit founder authorization for merge and external deployment.

## Review and merge policy

Keep this PR in **draft** while any checklist item above is unverified. Reviewers may inspect source/CI now; **do not merge to `main`**, deploy, grant clients access, create provider resources, configure DNS, or commit real credentials as part of this consolidation.

If a merge is separately approved after review, first recompare `main` and every stacked head, identify any overlapping PRs, choose **one** integration route, and preserve all Git history. Any real rollout requires provider-observed HTTPS checks, durable storage, backup/rollback proof and separately recorded sign-off.

**Next release-critical action:** finish this integrated PR's CI and get human review; then decide on a real private Node host and off-host backup custody. Feature expansion is not a substitute for these missing gates.
