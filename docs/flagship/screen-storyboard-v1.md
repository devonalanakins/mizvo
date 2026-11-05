# MIZVO Flagship — Screen & Interaction Storyboard V1

**Status:** Proposed original premium editorial design, synthetic client content only. Distinguishes faithful preservation of the previously approved Mizvo architecture/copper visual language from new proposed interaction patterns. Review with actual working app before claiming acceptance.

## Global foundation

**Identity:** Mizvo is a high-end engineering practice. Brand mark must feel designed, not just system text. Use an architecturally precise custom emblem/wordmark system with responsive micro-mark and clear logotype. The primary previously approved moodboard (private checksum documented in existing Mizvo docs) remains the authority for comparison. Before rollout, draft vector directions and validate against trademark/licensing constraints.

**Layout:** Semantic dark canvas with offset warm paper surfaces. Main shell: 64–76px left vertical navigation for Studio; context-driven central 960–1280px max width with optional 300px inspector; keyboard-accessible decision/command navigation. Client mode intentionally simpler (no code/CI exposed by default). Public mode uses large, dramatic, high-contrast message and restrained copper architectural illustration. Mobile collapses into a single reading column with native labeled navigation (not hover-only rail).

**Visual components:** Living Brief folio, Decision Card, Proofline, Preview Stage, Environment Receipt, Ownership Passport, Client Contact Rail, Release Comparison. All status text sourced from actual server data only in the implementation; sample content must carry persistent visible DEMO label.

**Tokens:** charcoal #0B0D11, panel #13161B, raised #1D2026, paper #F1ECE5, copper #D3A379, muted #AAADB5; contrast verification required. No amber text on small warm-white backgrounds. Display serif (rights-cleared), geometric sans for control hierarchy, self-hosted and licensed. Accessible button hit area >=44px, focus visible, reduced-motion. Original SVG architectural linework rather than unlicensed photographs or rasterized text.

## Screen 01 — Discover / the promise

At 1440px: split 52/48 hero. Left: wordmark, eyebrow “Engineering, considered from every angle”, dramatic display headline “Make the improbable useful.” 18-word explanation: “Custom software that makes difficult ideas understandable, dependable, and a pleasure to use.” Main CTA **Tell us the problem**, secondary **See how a project works**. Right: original copper line-art architectural spatial form with 3 depth layers, restrained light shafts and soft responsive motion. Below: three principles — Human-first, Tested in reality, Yours to operate. Avoid false client logos, fake reviews, fictitious performance claims.

Mobile: art moves below primary CTA or behind noncritical content, readable display type, no tiny horizontal grid. CTA visible before first fold when practical.

## Screen 02 — Inquiry / 60-second useful request

Three input prompts: (A) “What is difficult right now?” (B) “Who needs this to work?” (C) “What would success look like?” Optional follow-up “By when?”, “Do you already have software?”, contact + consent. No demand for technical stack. Avoid accepting passwords, employee records, patient data or arbitrary huge attachments through an unreviewed intake. Confirmation uses an actual recorded request ID only after persistence and successful receipt.

## Screen 03 — My Commission / client home

Hero header reads **The Current** (synthetic scenario); below goal in plain language. Right top corner: **Synthetic demo** mark. The page prioritizes **One decision needs your input** and **Experience ready to try**. A single primary large card: “Review the 30-minute facilitator flow” + precise version + what changes if approved, and preview action. Under that: short “How we'll know it works” + plain-language checklist. Secondary vertical mini-rail lists real milestones, actual cost owner, Mizvo support. Client does not need to read backlogs.

If project lacks decision: one accurate next action (“We are testing the mobile session runner”) and explanation, not an invented blocker.

## Screen 04 — Experience stage

Full responsive preview with audience device switcher, version, environment, read-only provenance and explicit content class (synthetic / client-approved / not shared). A phone-shaped stage previews The Current invitation, then a facilitator runner. Reviewer may annotate/comment a specific moment; request change or approve exact preview with explicit result. No approval on stale or unverified demo, no silent workflow or license acceptance. Any change increments version and reopens review.

## Screen 05 — Internal Studio

Use current verified 3-region Studio structure. Center is a 'Living Commission' with actual customer problem, chosen outcome, current important work, client-review-ready source and release blockers. Right rail anchors customer need to issue, source commit, test and preview receipt. Lower tabs: Project Room, Plan, Workbench, Release. Team communication is async-first. No live call infrastructure or invisible employee telemetry. UI must explain who needs to act and what they can decide.

## Screen 06 — Proofline

Six segments: Need → Decision → Preview → Verify → Operate → Care. Each item is independently scoped and labeled: Proposed, Approved, Implemented, CI verified, Staging observed, Production observed. Never infer Live from green CI. Missing data is gray with a useful explanation. Selecting a segment expands an evidentiary drawer (date/actor/source/ref/validation/limits), not a vague circular progress KPI. Immutable revision history retained.

## Screen 07 — Hosting / customer choice

Compare:
- Customer-owned hosting + Mizvo-managed (recommended default; customer billing/admin).
- Mizvo-managed account (conditional future offering).
- Customer/self-hosted (client IT handles operations).
Explain who controls data and billing, and what operations is actually included. Client may indicate preference in a nonbinding design proposal; actual hosting selection requires signed scope and procurement approval. Default architecture should demonstrate portable origin and export.

## Screen 08 — Ownership Passport & Support

Calm warm-light screen: Where it runs; Who owns the account and domain; Latest real release; Backup/restore status; Data export; Source license and deployed artifact; Support agreement window; Exit/handoff checklist. All unverified fields display Not configured / Not tested. No bright green checkmarks for unverified infrastructure.

## Interaction validation

- Real user can correctly explain what Mizvo builds and start inquiry without knowing software terms.
- Client user can identify what is waiting on them, preview an actual build, and state exactly what approval means.
- Engineer sees explicit source and test evidence linked to requirements without leaking internal details to client.
- Unauthorized client cannot view internal Room notes or other client projects (direct endpoints included).
- Client ownership description matches actual cloud resources and written agreement.
- Keyboard, screen reader and mobile viewport 320/390/768/1440/1920; no horizontal overflow; accessible states and error paths.
- Reduced motion and audio off preserve all tasks.
- For The Current, client preview shows only original synthetic demonstration unless IP/privacy/content signoff exists.

## Archive and continuation plan

Do not archive the live repository or destroy PR #2. Its exact snapshots, migrations, tests and approved visual references are historical evidence. Mark V0.3/V0.4 design artifacts **HISTORICAL REFERENCE**, not implemented canonical behavior. Create a design branch, keep existing main and active PR #2 untouched, then open a future code PR stacked on or reconciled with the verified current head after visual acceptance and regression tests. No rewrite merely because prototype front-end differs visually.

The prior visual reference is not made obsolete until user specifically approves a replacement. Maintain one product owner, one source repository and explicit migration/merge decision.
