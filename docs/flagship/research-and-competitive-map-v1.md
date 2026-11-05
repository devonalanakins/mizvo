# MIZVO Flagship 001 — Research and Product Opportunity
Date: 2026-11-05 | Status: RESEARCH SYNTHESIS / PROPOSED DESIGN, not a launched product or confirmed customer requirement

## Research question

If a buyer approaches a founder-led software studio with a complicated problem, what makes the entire experience — from first inquiry through user-validated custom software and client-owned operations — more useful, trustworthy and compelling than conventional agency project tracking?

The reference scenario is SIMULATED: Jim approaches Mizvo to improve first-90-day employee conversations and the surrounding theatrical briefing materials. Cristy is the intended facilitator and content authority. This is not a verified software commission, signed project, or permission to use real employee information.

## Established constraints from Mizvo and The Current

- Mizvo's main work is bespoke, high-quality engineering; its active draft PR #2 has an authenticated TypeScript/Node/SQLite project workspace, project decisions, milestones, client projections, source/CI verification and related tests, but is NOT merged, deployed, or equipped for commercial production.
- The Current draft PR #1 is four DESIGN FILES only. It specifies a participant invitation, mobile facilitator, evidence desk and producer view; no executable application exists.
- Cristy's actual production request is three mobile-friendly separate review emails, scripts and media. Three private masters were sent; their client playback/approval and real-world use remain unverified. A client platform must not displace this obligation.
- Default proposed hosting: customer-owned account/domain/data, Mizvo-operated through least privilege; fully self-hosted or Mizvo-hosted are alternates with independent support/compliance gates.
- AGPL-3.0-only is the standing default for Devon-owned application source; third-party media and customer-specific rights are not silently acquired or published.
- Existing founder-approved Mizvo graphite/ivory/copper architectural editorial visual direction remains governing UNTIL a replacement visual proposal receives explicit founder approval. New studies may refine but should not erase it.

## Benchmark research, as verified against original publishers' public descriptions

| Primary source | What the product already does | Useful lesson for Mizvo | What not to clone |
| --- | --- | --- | --- |
| Design Council Double Diamond (https://www.designcouncil.org.uk/resources/framework-for-innovation/) | Discover, Define, Develop, Deliver; investigate the challenge before assuming the solution | Discovery must present a service option as legitimately as a software option; show user evidence and decision rationale | An endless workshop without a shippable useful result |
| Basecamp client agency projects (https://basecamp.com/projects/design-agency-client-work) | Client-selective project access with discussion, files and approvals next to work | Keep client-ready and private engineer material separate; organize communications around the actual project | Rebuild a generic list/chat/calendar productivity suite |
| Linear Customer Requests (https://linear.app/docs/customer-requests) | Connects customer demand to specific engineering issues and projects | Trace a need to a planned result and make changes accountable | Expose engineers' ticket vocabulary to the client |
| Figma Dev Mode version comparison (https://help.figma.com/hc/en-us/articles/15023193382935-Compare-changes-in-Dev-Mode) | Visual changes are comparable by version with handoff context | Every design approval should be tied to the exact screen/demo version being reviewed | Treat a static screenshot as accepted functional software |
| Vercel previews and protection (https://vercel.com/docs/deployment-protection), (https://vercel.com/products/previews) | Shareable previews with access controls; per-change environments | Client sees authentic working previews linked to source/CI and privacy protections | Publicly expose preview deployments or promise a deployment is ready because it has a URL |
| Articulate Rise (https://www.articulate.com/360/rise/) | Media-rich, responsive interactive learning blocks and scenarios | Short mobile chapters, meaningful interactions, captions and excellent authoring ergonomics can make The Current delightful | Build a full LMS or staff assessment tool into the first campaign |
| Mentimeter (https://www.mentimeter.com/) | Host-led interactive presentations and audience participation without login | Story and conversation can be memorable on the participant's phone; entry friction matters | Collect real workplace culture data in an entertainment platform by default |
| NIST SSDF 1.1 (https://csrc.nist.gov/pubs/sp/800/218/final) | Secure software delivery practices for organizations and suppliers | Embed provenance, verifiable test/release evidence and response procedures in standard delivery | Claim certification from an adopted checklist |
| OWASP ASVS 5.0.0 (https://asvs.owasp.org/) | Published security requirements for web apps/services | Explicit project/role/object/field authorization and adversarial testing are core release contracts | Confuse passing static checks with safe client deployment |
| W3C WCAG 2.2 (https://www.w3.org/TR/wcag/) | Normative criteria for accessible digital interactions | Keyboard, captions, focus and touch affordances are design inputs from day one; target AA, use 44px tap comfort where practical | Decorative film effects that conceal actions or undermine readability |
| Cloudflare Workers/D1/R2 (https://developers.cloudflare.com/workers/static-assets/), (https://developers.cloudflare.com/d1/), (https://developers.cloudflare.com/r2/pricing/) | Edge delivery, relational storage and private object assets with measurable charges and portability paths | Dedicated customer-owned resources can host small projects while preserving operator/customer separation | Make every client depend on a single Mizvo account/database; claim D1 is a universal enterprise database |
| GNU AGPL FAQ (https://www.gnu.org/licenses/gpl-faq.html.en) | Network-interaction source-availability obligations explained by license authors | Provide clear source access and never promise exclusive closed-source deliverables that violate actual licensing | Use “open source” as a substitute for identifying commissioned IP and media rights |

The comparisons identify **capabilities already in the market**. They do not prove a market gap, customer demand, defensible differentiation, performance or sales potential. The innovation thesis below remains a testable hypothesis, not a verified invention.

## Core insight: The client sees a broken chain of trust

Typical service work divides into isolated conversations, proposals, specs, ticket backlogs, design comments, QA and deployment reports. Users may know something is “on track” without knowing whether the original problem was solved. Mizvo's opportunity is to maintain an understandable relationship between the client's starting problem and the final verified result.

### Product hypothesis — “Promise → Proof”

A single project story follows:
1. **Need:** A short, plain-language recorded customer problem and desired outcome.
2. **Decision:** Chosen solution and alternatives, with explicit owner/approval.
3. **Preview:** True scoped, versioned experience anyone authorized can try.
4. **Evidence:** What functionality and tests actually passed, in human-readable language with source links behind it.
5. **Ownership:** Where it lives, who controls costs/data, how the system is maintained, and how to move or stop it.
6. **Care:** One route for support, fixes, improvements, and an evidence-based service history.

One *traceable client experience*, not one giant application that executes every enterprise service internally. GitHub, third-party cloud services, and existing design tools can remain replaceable behind adapters.

## Product differentiators — proposed and falsifiable

**1. Living Brief.** A coherent evolving statement of problem, people, success criteria, excluded scope and decisions. Readable in 60 seconds; versioned. Test: a new stakeholder explains the problem and what “done” means without a meeting.

**2. One Decision Now.** The client home screen highlights the one consequential review/approval blocking progress, with a preview and explicit alternatives; no meaningless progress bars. Test: nontechnical reviewer completes correct choice without calling the engineer.

**3. Proofline.** Source-linked timeline from requested outcome to implementation, tests, delivery and observed production. Distinguish claimed, verified, staging, and live. Test: after a change, the client correctly says what has shipped and what has not.

**4. Ownership Passport.** Client-facing operational handoff including domain/account, source rights, backups, restore drill, monitoring, support terms, data export and offboarding. Test: an independent maintainer can restore the sandbox without private Mizvo knowledge.

**5. Experience layer.** Render previews and guided interactions as polished, client-appropriate experiences, not engineering consoles. For The Current, role-separated invitation, facilitation, narrative and investigator surface. Test: Cristy conducts a session from her phone without developer instruction.

**6. Portable-by-contract, not portable-by-claim.** Pluggable auth/storage/deployment interfaces where justified; demonstrate at least one independent self-hosted deployment before promising the capability. Test: predictable self-host setup and complete export recovery.

## What would fail this strategy?

- Buyers actually prefer a light email update and do not want a separate account; client portal becomes optional and useful only at relevant gates.
- The platform increases founder workload through duplicate record entry; require one source-of-truth with GitHub and project services rather than manual syncing everywhere.
- “Proofline” cannot distinguish code from running production; need independently verified environment receipts, not just PR/CI statuses.
- Scary security/privacy implementation or incorrectly shared preview; design access-first and validate every object/media route.
- Too much glossy visual motion on small phones; run actual comprehension and accessibility tests.
- A detailed software scope consumes Cristy's immediate briefing-production needs or mistakes Jim's interest for a contract; keep those business boundaries explicit.
- Solo founder cannot credibly provide 24/7 support or handle unlimited enterprise scale; sell realistic scope and support hours.

## Measurable pilot success, not fabricated KPI

Propose a no-coaching research session with one nontechnical buyer-role tester and a facilitator-role tester using synthetic data. Record time to identify the next decision, approval error rate, how accurately participants understand release status, task completion and mobile accessibility barriers. Targets should be set after baseline observation; do not invent conversion or satisfaction numbers.

## Research confidence and limitations

Primary vendor and standards documents establish published capabilities and constraints as of November 5, 2026, not independent evaluation of those services, cost estimates or software reliability. No external customer interviews, price quotes, competitive usability experiments, legal opinions, visual fidelity assessments or live deployment tests occurred in this research pass. Product-market fit, paid client demand and unique proprietary technology remain unproven.

Next: approve the design hypothesis for a bounded prototype, not a total code reset.
