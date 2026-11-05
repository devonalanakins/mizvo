# Mizvo Studio — solo-first, integrated online work

**STATUS: DESIGN DIRECTION / NOT IMPLEMENTED OR APPROVED FOR PRODUCTION.**

## Origin and experience

Start with a useful one-person workspace; grow into an independently operating online team only when contributors accept invitations and appropriate agreements. Each authorized person can work on their own schedule and see a project's scope, decisions, source and evidence in one place. The project is durable; the room is its shared context.

This is **not** a Slack clone, online office attendance system or generic project dashboard. A member must be able to leave the room and return later without losing relevant decisions, source state and accountability.

## Proposed experience

1. **Home:** focus, next genuine decision, active obligations.
2. **Projects:** customer problem, scope, people, Git references, milestones, security and rights.
3. **Rooms:** persistent project-scoped asynchronous notes and decisions; optional consented calls and screen sharing when they are useful.
4. **Workbench:** authorized source view, proposed edits, reviewable diffs, isolated tests and attributed changes.
5. **Delivery:** repeatable evidence, human approval, release/rollback and customer handoff.
6. **People:** self-authored profiles, explicit scoped invites, revocation and permissions.
7. **Pipeline:** future inquiries and feasibility, connecting work to projects only after approval.

The public Discover site and permission-separated Client Space connect to this model but must not share private employee details or another client's data.

## Security and portability invariants

- No browser-selected role is trusted; authenticated server-side organization/project/room authorization is required for every read/write and live connection.
- Accepting an invitation does not grant access beyond named projects, duration and capabilities. Revocations must terminate active grants and connections.
- No implicit rights transfer from other projects, contributors or clients; publication needs explicit permission and license.
- Source control remains Git. Protect the main branch and make tests, review decisions and precise commit IDs traceable.
- Real-time editor, WebRTC and AI agents are later independent gates, not prerequisites for the first useful solo workflow.
- Prefer portable storage/auth/media interfaces and verify self-hostability with an actual alternate installation rather than a promise.
- Do not force staff into online attendance tracking, ambient monitoring or unconsented transcripts.

## First accepted engineering slice

Prove one authenticated founder project can store a task or decision safely. Then prove **two separately authenticated humans** can enter exactly one permitted project room, independently contribute, reconnect, see consistent history, propose a reviewed Git change, and lose access immediately upon revocation. Test wrong-organization reads, replay/out-of-order events, stale approvals and recovery.

**Nothing in this document claims the above acceptance has been implemented.** Existing demo screens are local simulations, not secure access controls.
