# Studio Rooms — visual and product quality direction (V0.4)

**Status:** design concept with a locally tested, browser-only prototype. No deployed employee platform, real users, client work, auth, GitHub integration, code execution or live sessions are implied.

## A recognizable Mizvo experience

Mizvo's identity must communicate original engineering, spatial depth and precise craftsmanship without becoming hard to use. The proposed visual system uses graphite, ivory, restrained copper accents and original CSS orbital geometry to explain one useful idea: the project connects its people, code, decisions, evidence and delivery.

The project room is the signature experience, not an office-presence dashboard or copy of Slack. A founder should be able to work alone productively. Future collaborators may operate independently on their own schedules, with explicit invited access and a shared durable project context. Calls, screen sharing and co-editing must be optional and consented.

## Local V0.4 concept

- Distinctive project-room visual and in-context diagram: source, design, decisions, delivery.
- Interactive **local journal** for fictional sample notes and visibly unapproved decision proposals. All typed text stays in tab memory; refresh clears it.
- Filters, reset, responsive navigation and a keyboard command palette (Ctrl/Cmd+K).
- A future collaborator-role explanation that **does not** grant permission or invite anyone.
- Readable phone and desktop layouts, semantic controls, focus affordances and reduced-motion behavior.
- Conspicuous disclosure that the preview is not operational.

The public website, Studio and separately permissioned Client Space remain three related experiences. The company should pass a simple human-value test before adding complexity.

## Evidence and outstanding gates

The local, unlicensed prototype package was tested with 16/16 Node unit checks, browser interaction tests including HTML-as-text safety and reset behavior, and no horizontal overflow at 320, 390, 768, 1024 and 1440 pixels. This is not a security or accessibility certification. Local prototype source and private planning artifacts **are not included** in this public repository.

**Next development gate:** resolve source release/licensing and repository-visibility decisions, then import the appropriate source onto a reviewed branch and implement a server-enforced identity/project boundary before any real collaboration invitation.
