# MIZVO Flagship V1 — Client Commission Operating Playbook

Date: 2026-11-05. **PROPOSED business/process specification**. A fictionalized first commission (Jim / The Current) exercises the workflow; no legal Mizvo entity, client contract, customer payment, approved employee data processing, or production SLA is established.

## Client promise and service posture

The result is not “we write whatever code you tell us to.” Mizvo sells careful problem diagnosis, original human-first engineering, verifiable delivery and enduring control. An external buyer may request a simple document/content service or an enterprise-grade system; engineering scope follows need, feasibility, ethical/privacy boundaries and the available qualified capacity. A beautiful project portal is not a substitute for doing the actual work.

## Start-to-finish state model

`INQUIRY_RECEIVED` → `FIT_TRIAGED` → `DISCOVERY_OFFERED` → `DISCOVERY_COMPLETE` → `PROPOSAL_DRAFT` → `PROPOSAL_APPROVED` → `CONTRACT_ACTIVE` → `KICKOFF` → `DESIGN_REVIEW` → `BUILD_IN_PROGRESS` → `VERIFICATION` → `CLIENT_ACCEPTANCE` → `DEPLOYMENT_APPROVED` → `LIVE_VERIFIED` → `CARE_ACTIVE` → `HANDOFF_COMPLETE` / `CLOSED`.

Branches: `NO_FIT`, `DECLINED`, `ON_HOLD`, `RE_SCOPE`, `CANCELLED`, `PRODUCTION_BLOCKED`. No status may imply contract payment or live deployment without a corresponding verifiable event. Independent gates: content approval, technical QA, legal acceptance, payment status, and production deployment.

## Detailed service workflow: artifact, owner, next decision

| Phase | What Mizvo actually does | Client view / approval | Internal source of truth | Exit gate |
| --- | --- | --- | --- | --- |
| 01. Inquiry | Capture real problem, audience, time horizon, contact consent and risk classification | Clear receipt if actually stored | Inquiry record | Data minimization and explicit acknowledgement |
| 02. Triage | Decide if fit, lawful/ethical, realistic workload, and simpler alternative | “We recommend X because Y” | Intake rationale | Next step or respectful decline |
| 03. Discovery | Observe workflow and speak to authorized users; define current friction | Living Brief (problem, people, outcomes, non-goals) | Brief revision / research evidence | Mutual agreement on problem |
| 04. Feasibility | Build short list: service only, lightweight system, full app | Compare consequences, rough scope and unknowns | Options / risks / cost assumptions | Client selects direction, not implementation |
| 05. Proposal | Write scope, deliverables, stages, success tests, budget, support, hosting/IP options | Decision-ready proposal with exclusions | Versioned scope | Explicit authorized sign-off |
| 06. Commercial gate | Confirm party/capacity, contract terms, invoices/payment and processing agreement | Actual agreement and payment obligations only through legal approved workflow | Contract reference; no storage of signed private contract in public GitHub | Contract and required consent truly effective |
| 07. Kickoff | Set up isolated project, authorized identities, separate technical and client workspaces | How to reach us, what's next, one first preview | Project/roles/audit | Approved access and plan |
| 08. Design | Propose creative direction, interaction model, content rights and accessibility | Test clickable prototype, request revisions | Version-bound design review | Explicit design approval |
| 09. Engineering | Implement smallest useful slices, secure/authz/QA gates and exact evidence | Honest milestone updates, limited demos | PR, tests, build refs | Independent engineering acceptance |
| 10. Deployment | Customer account onboarding; staged release, monitoring, backup/restore, rollback | Hosting selection, admin owner, release approval | Deployment/ownership passport | Real app verifiably running at intended version |
| 11. Acceptance | Test outcome with intended users and record deviations | Clear acceptance of contracted deliverables, not generalized waiver | Versioned client acceptance | Client acceptance is exact-scope and attributable |
| 12. Care | Support, security patches, actual usage health, feature requests under agreement | One contact point and defined service hours | Service record/issue ledger | Measured ongoing service, clear renewal |
| 13. Exit | Export portable data, transfer ownership/keys/source, run restore, revoke vendor access | Reassuring handoff and transparent final bill | Export/restore/revocation evidence | Customer control independently demonstrated |

The order can overlap in realistic projects; the gates remain distinct and explicit. If no paid project is agreed, all operational artifacts remain hypothetical draft.

## Jim / The Current — complete synthetic rehearsal

**Problem statement (illustrative):** “Managers need to hear meaningful first-90-day employee experiences, while the optional mystery-themed creative production and file distribution are difficult on mobile.”

**Primary outcome:** Cristy can deliver one excellent 30-minute session from an iPhone without assembling packets; participant can open approved invitation/media; Jim receives only intentionally released fictional evidence; professional culture observations remain in an authorized process separate from The Current. In a discovery project, test whether simple tailored emails plus a small page would solve the problem before building a full platform.

**Clarify authority:** Jim as potential buyer/organizational sponsor, not automatic contract signer; Cristy as independent professional/creative approver and facilitator, not automatically a Mizvo employee. Who contracts, pays, owns the campaign IP and controls distribution requires a documented real agreement.

**Demo data:** Use fictitious `Example Organization`, `Sample Sponsor`, `Sample Facilitator`, not copies of private staff identifiers. The public code should use original Quiet Buoy theme, not licensed third-party franchise characters.

**First design review task:** A fictional buyer can watch Cristy's synthetic phone-based runner, understand what's in vs out, and approve/request revision with one decision. Engineers see source and tests; buyer sees plain English, version and expected outcome.

**Acceptance:** Participant and facilitator role denial tests; manual evidence gate; graceful audio failure; readable mobile layout; separate right-to-operate handoff.

## Hosting policy: default proposed, needs founder acceptance

**Customer-owned / Mizvo-operated:** customer opens and owns Cloudflare account or equivalent, domain, billing method, production resources and administrator authority. Mizvo uses member grant or appropriately scoped service token. Customer may revoke access and export data. Mizvo charges separately for initial implementation and realistic operations; provider charges client directly.

**Mizvo-hosted:** not currently a service the organization has proven able to offer. Requires tenant isolation, support staffing, abuse protection, cost allocation, incident response and retention terms, backup and export. Dedicated per-client environments are safer for bespoke early work than a universal shared client database.

**Self-host:** customer IT is operator; Mizvo must demonstrate documented install/upgrade/rollback, data export/import and support boundary. Requires independent portability testing, not merely “uses SQLite.”

**Cloudflare candidate:** Workers with Static Assets, D1, private R2, account-separated staging and production; alternate self-hostable Node/SQL/object adapter. Do not claim a D1 adapter exists for current Mizvo; its present draft PR #2 is Node/SQLite only. Hosting must satisfy client's data classification and signed obligations; PHI/highly sensitive regulated data require specialist/legal compliance and provider contracts.

## Billing and financial control without invented prices

- **Fit conversation:** free brief consultation optionally offered, no guarantee of unlimited advice or free design.
- **Discovery package:** fixed-fee design/research deliverable with exact scope, acceptance and cancellation terms.
- **Implementation:** milestone-fixed price when predictable; time/materials with cap and approved change control where uncertain.
- **Operations:** cloud provider billed directly to customer by default; Mizvo support agreement separately defines service hours, incident notification, patch cadence, backups and restores, monitoring, maintenance window and exclusions.
- **Creative content/clinical facilitation:** independent work and contract scope; do not silently bundle Cristy's professional work into software engineering.
- Every actual proposal separates one-time engineering, one-time hardware, ongoing hosting, media/AI variable usage, third-party licenses and ongoing human support. State whether sales tax, fees, insurance and incident liability are included. Require official legal/accounting review before selling.

## Decision rights and role ownership

| Decision | Who must authorize it? |
| --- | --- |
| Organizational goal / contract and budget | Authorized buyer and contracting entity |
| Professional employee conversation protocol and client content | Cristy/authorized professional owner |
| Real employee privacy/processing | Organization's legally authorized privacy/security owners and involved professional(s) |
| Engineering design, technical feasibility and QA | Mizvo responsible engineers, independent reviewer when risk warrants |
| Client-visible design/content version | Named authorized customer reviewer; professional approval separate where relevant |
| Production release | Documented owner/operator and customer release approval per contract |
| Provisioning cloud account/payment | Client account owner with express action/authority |
| Legal rights/asset redistribution | Actual IP rights holders and professional legal review |
| Support exit/data deletion and retention | Contracting parties under privacy/retention obligations |

## Client portal UX language

Use “Your outcome,” “Experience to review,” “Decision required,” “What's verified,” “Where it runs,” “Who owns it,” “Get support.” Hide “migration 004,” “keyset cursor,” “commit tree” unless advanced technical details are requested. Maintain direct access to original evidence for technical clients.

### “Next meaningful decision” contract

Every decision card has: purpose, exact version, visual/working preview, proposed choice, alternatives, effects of approval, named approver, expiry/currentness, and clear revised-scope implications. Never present legal/financial acceptance as identical to design approval. Invalidate stale versions and race conditions.

### “Ownership Passport” contract

Names the actual customer cloud account(s) and operator grants, registered domain ownership, data/controller boundaries, deployed source/license/branch ref, artifact/build hash, last real observed production state, backup retention + actual restoration evidence, on-call support scope, contract exit terms and revocation proof. Blank/untested fields must read NOT YET VERIFIED.

## Security baseline

- Server-side customer/organization/project scope on every action, full direct ID/asset fetch and generated URL.
- Least-privilege operator grants, MFA/passkeys for privileged accounts where applicable, audit logging, secret rotation and revocation.
- Separate preview/staging/prod; private uploaded data never copied to synthetic demos.
- Dependency and supply-chain evaluation, NIST SSDF practices, ASVS requirements, accessible interfaces and an independent security review proportionate to data/complexity.
- Backups and disaster recovery tested with real restore, not only presence of a file.
- Incident communication defines roles, severity, notification timing and traceable evidence.
- Do not send external email/SMS, file legal documents, accept payments, hire contractors or provision paid client systems without authorized gates.

## Solo-founder service reality

The founder cannot provide true 24/7 security response on a one-person basis; initial SLAs must be restricted to supported business hours and workload. Support coverage and subcontractor involvement require an explicit client-approved policy. Every client engagement reserves capacity for maintaining existing systems, not only creating new ones.

## First build order

1. Archive by reference: preserve old approved visual board, prior design PR and active PR #2 source, and label old proposals historical; do not close/replace tested source.
2. Interactive concept with **synthetic** Jim commission; usability tests before assigning a contract.
3. Implement one genuine intake → living brief → versioned client decision → verified preview → ownership passport vertical slice inside current Mizvo codebase.
4. The Current in its independent repository remains a separate development project; only a read-scoped linkage for milestone/release status may connect it to Mizvo Studio later.
5. No production launch until operational/legal/customer rights are established and test evidence is independently verified.

External standards/resources: https://www.designcouncil.org.uk/resources/framework-for-innovation/ ; https://asvs.owasp.org/ ; https://csrc.nist.gov/pubs/sp/800/218/final .
