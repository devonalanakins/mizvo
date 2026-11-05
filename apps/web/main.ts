type Data = Record<string, any>;
const root = document.querySelector<HTMLDivElement>("#app")!,
  dialog = document.querySelector<HTMLDialogElement>("#dialog")!;
let me: Data | null = null,
  csrf = "",
  projects: Data[] = [],
  room: Data | null = null,
  dirty = false,
  inspector = false,
  inspectorCollapsed = false;
let route = { surface: "site", page: "home", project: "", tab: "room" };
const escape = (v: unknown) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
const e = escape;
const icons: Record<string, string> = {
  home: "M3 10 12 3l9 7M5 9v12h14V9M9 21v-7h6v7",
  projects: "M3 6h6l2 2h10v12H3zM3 6V4h6l2 2",
  rooms: "M4 4h16v12H9l-5 4z",
  workbench: "m8 6-6 6 6 6m8-12 6 6-6 6M14 3l-4 18",
  pipeline: "M4 4h16v4H4zM6 12h12M8 17h8M10 22h4",
  delivery: "M12 3v12m-4-4 4 4 4-4M4 15v6h16v-6",
  people:
    "M8 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M2 21v-3a6 6 0 0 1 12 0v3M17 4a4 4 0 0 1 0 7m0 3a5 5 0 0 1 5 5v2",
  operations: "M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z",
  settings:
    "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8M12 2v3m0 14v3M2 12h3m14 0h3M5 5l2 2m10 10 2 2M5 19l2-2M17 7l2-2",
  search: "M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16m6-2 5 5",
  notifications: "M5 17h14l-2-4V8a5 5 0 0 0-10 0v5zM10 21h4",
  menu: "M3 6h18M3 12h18M3 18h18",
  close: "m6 6 12 12M6 18 18 6",
  arrow: "M4 12h16m-6-6 6 6-6 6",
  plus: "M12 4v16M4 12h16",
  plan: "M4 4h16v16H4zM8 9h8M8 14h5",
  note: "M5 3h10l4 4v14H5zM14 3v5h5M8 12h8M8 16h6",
  check: "m5 12 4 4L20 5",
};
const icon = (name: string) =>
  `<svg class="icon" aria-hidden="true" viewBox="0 0 24 24"><path d="${icons[name] ?? icons.projects}"/></svg>`;
const mark = `<svg class="mark" aria-hidden="true" viewBox="0 0 40 34"><path d="M3 29V5l17 18L37 5v24M8 29V16l12 13 12-13v13" fill="none" stroke="currentColor" stroke-width="2.5"/></svg>`;
const date = (v: string) =>
  new Date(v).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
const badge = (value: string) =>
  `<span class="tag ${e(value)}">${e(value.replaceAll("_", " "))}</span>`;
const avatar = (name: string) =>
  `<span class="avatar" aria-hidden="true">${e(
    name
      .split(" ")
      .map((n) => n[0])
      .slice(0, 2)
      .join(""),
  )}</span>`;
const button = (text: string, action: string, classes = "secondary") =>
  `<button class="${classes}" data-action="${action}">${text}</button>`;
function toast(message: string) {
  const n = document.querySelector("#notice")!;
  n.textContent = message;
  setTimeout(() => {
    n.textContent = "";
  }, 6000);
}
async function api(path: string, method = "GET", body?: unknown): Promise<any> {
  const response = await fetch("/api" + path, {
    method,
    credentials: "same-origin",
    headers: {
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(csrf ? { "X-CSRF-Token": csrf } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const value = await response.json();
  if (!response.ok)
    throw new Error(value.error ?? `Request failed (${response.status}).`);
  return value;
}
function parseRoute() {
  const u = new URL(location.href),
    segments = u.pathname.split("/").filter(Boolean);
  route = {
    surface: segments[0] ?? "site",
    page: segments[1] ?? "home",
    project: segments[1] === "projects" ? (segments[2] ?? "") : "",
    tab: u.searchParams.get("tab") ?? "room",
  };
  if (!["studio", "space", "login"].includes(route.surface)) {
    route.page = segments[0] ?? "home";
    route.surface = "site";
  }
}
function projectPath(id: string, tab = "room") {
  return `/${route.surface === "space" ? "space" : "studio"}/projects/${encodeURIComponent(id)}?tab=${tab}`;
}
function publicHeader() {
  return `<header class="public-header"><a class="wordmark" href="/" aria-label="Mizvo home">MIZVO</a><nav aria-label="Discover"><a href="/capabilities">Capabilities</a><a href="/process">Process</a><a href="/work">Work</a><a href="/about">Company</a><a href="/studio">Studio</a></nav><a class="button secondary" href="/inquiry">Start a project ${icon("arrow")}</a></header>`;
}
function footer() {
  return `<footer class="public-footer"><a class="wordmark" href="/">MIZVO</a><small>Independent engineering. Considered from every angle.</small><div class="row"><a href="/contact">Contact</a><a href="/privacy">Privacy</a><a href="/source">Source & license</a><a href="/space">Client Space</a></div></footer>`;
}
function empty(title: string, body: string, action = "") {
  return `<div class="empty"><h2>${e(title)}</h2><p>${e(body)}</p>${action}</div>`;
}
function field(
  label: string,
  name: string,
  value = "",
  type = "text",
  required = true,
) {
  return `<label class="field">${e(label)}<input type="${type}" name="${name}" value="${e(value)}" ${required ? "required" : ""} maxlength="${type === "password" ? 200 : 2000}" ${type === "password" ? 'minlength="14" autocomplete="current-password"' : ""}></label>`;
}
function textarea(label: string, name: string, value = "", required = true) {
  return `<label class="field">${e(label)}<textarea aria-label="${e(label)}" name="${name}" ${required ? "required" : ""} maxlength="12000">${e(value)}</textarea></label>`;
}
function select(label: string, name: string, values: string[], value: string) {
  return `<label class="field">${e(label)}<select name="${name}">${values.map((x) => `<option value="${e(x)}" ${x === value ? "selected" : ""}>${e(x.replaceAll("_", " "))}</option>`).join("")}</select></label>`;
}
function form(name: string, content: string, submit = "Save", extra = "") {
  return `<form data-form="${name}" ${extra}>${content}<p class="form-error" role="alert"></p><button type="submit">${e(submit)} ${icon("arrow")}</button></form>`;
}
function modal(title: string, content: string) {
  dialog.innerHTML = `<div class="dialog-head"><h2 id="dialog-title">${e(title)}</h2><button data-action="close" class="quiet" aria-label="Close dialog">${icon("close")}</button></div>${content}`;
  dialog.showModal();
  dialog
    .querySelector<HTMLElement>(
      "input:not([type=hidden]),textarea:not([readonly]),select",
    )
    ?.focus();
}
function close() {
  dirty = false;
  dialog.close();
}
function discover() {
  const caps = [
    "Custom applications",
    "Systems & platforms",
    "AI & automation",
    "Research & prototyping",
  ];
  if (route.page === "home")
    return `${publicHeader()}<main id="main"><section class="hero"><div class="hero-copy"><p class="eyebrow">Independent software engineering</p><h1 class="display">Make the<br>improbable<br><em>useful.</em></h1><p>Custom software for people with ambitious ideas. From a single application to a complete business platform, carefully built around you.</p><div class="row"><a class="button" href="/inquiry">Work with Mizvo ${icon("arrow")}</a><a class="button secondary" href="/capabilities">Explore our capabilities</a></div></div></section><section class="public-section public-intro"><div><p class="eyebrow">Complexity, made considered.</p><h2>Good engineering starts with what matters to you.</h2><p class="muted">Mizvo is a founder-led software engineering practice. We turn difficult questions into clear, useful systems through thoughtful design, careful implementation, and evidence you can inspect.</p><a class="button secondary" href="/process">How we work ${icon("arrow")}</a></div><div>${caps.map((x, i) => `<div class="capability"><span class="number">0${i + 1}</span><div><h3>${x}</h3><p class="muted">${["Web and mobile experiences tailored to real people.", "Connected business operations, internal tools, and integrations.", "Purposeful assistance, with human control and clear boundaries.", "Technical discovery for problems without an obvious answer."][i]}</p></div></div>`).join("")}</div></section><section class="public-section"><p class="eyebrow">A shared understanding</p><h2>Your project. A clear path forward.</h2><p class="muted">Independent in execution. Connected through decisions, demonstrations, and verified results.</p><div class="process">${["Discover", "Scope", "Design", "Engineer", "Verify", "Deliver", "Support"].map((x) => `<span>${x}</span>`).join("")}</div></section></main>${footer()}`;
  const content: Record<string, [string, string]> = {
    source: [
      "Open source, by design.",
      `<p>This Mizvo application is available under the GNU Affero General Public License, version 3 (AGPL-3.0-only). You can obtain the corresponding source, setup instructions, and license from the project repository.</p><div class="row"><a class="button" href="https://github.com/devonalanakins/mizvo/tree/build/secure-platform-v0-5" target="_blank" rel="noopener noreferrer">Get the application source ${icon("arrow")}</a><a class="button secondary" href="https://github.com/devonalanakins/mizvo/blob/build/secure-platform-v0-5/LICENSE" target="_blank" rel="noopener noreferrer">Read the license</a></div><p class="muted">Third-party fonts retain their SIL Open Font License notices. Project data, confidential client work, and separately owned software are not part of this source release.</p>`,
    ],
    capabilities: [
      "Software built around your world.",
      `<div class="grid">${[
        [
          "Applications",
          "Responsive web and mobile applications, creative tools, and interactive experiences.",
        ],
        [
          "Business platforms",
          "Internal tools, operations platforms, customer journeys, and enterprise integrations.",
        ],
        [
          "Engineering infrastructure",
          "Developer tooling, security-conscious data systems, APIs, and maintainable foundations.",
        ],
        [
          "AI & automation",
          "Human-directed workflows with scoped access, explicit approvals, and provider-independent architecture.",
        ],
        [
          "Research & prototypes",
          "Feasibility studies, experiments, and research-intensive engineering.",
        ],
        [
          "Long-term care",
          "Documentation, reliable releases, maintenance, and technical support.",
        ],
      ]
        .map(
          ([a, b]) =>
            `<article class="card"><h2>${a}</h2><p class="muted">${b}</p></article>`,
        )
        .join(
          "",
        )}</div><p class="muted">Each engagement begins with a feasibility and capability review. Scope follows the problem, available expertise, and credible constraints.</p>`,
    ],
    process: [
      "A clear path from question to useful software.",
      `<div class="stack">${[
        [
          "Discover",
          "Understand the person, the problem, and the constraints.",
        ],
        [
          "Scope",
          "Define a feasible outcome, responsibilities, and acceptance criteria.",
        ],
        [
          "Design",
          "Make the experience understandable before making it elaborate.",
        ],
        [
          "Engineer",
          "Build maintainable systems in small, reviewable increments.",
        ],
        [
          "Verify",
          "Test real workflows, challenge assumptions, and record evidence.",
        ],
        [
          "Deliver",
          "Review the agreed version with clear handover and rollback instructions.",
        ],
        ["Support", "Keep the system useful through deliberate maintenance."],
      ]
        .map(
          ([a, b], i) =>
            `<article class="capability"><span class="number">0${i + 1}</span><div><h2>${a}</h2><p class="muted">${b}</p></div></article>`,
        )
        .join("")}</div>`,
    ],
    work: [
      "Work, shown with permission.",
      empty(
        "Our public portfolio is being prepared.",
        "Only real projects approved for publication will appear here. Your confidential work stays confidential.",
      ),
    ],
    about: [
      "A small practice. A serious approach.",
      `<p>Mizvo is an independent software engineering practice led by Devon Alan Akins. It begins with one founder and a commitment to sophisticated software that ordinary people can understand and use.</p><p>Work happens asynchronously by default. Progress means verifiable results, shared context, and thoughtful decisions. Collaborators join through deliberate, project-scoped invitations.</p><div class="grid"><article class="card"><h2>Useful to people</h2><p class="muted">Clear purpose, approachable interaction, and real benefit.</p></article><article class="card"><h2>Built with care</h2><p class="muted">Security, accessibility, maintainability, and inspectable evidence.</p></article><article class="card"><h2>Independent by design</h2><p class="muted">Open and self-hostable foundations where rights permit.</p></article></div>`,
    ],
    contact: [
      "Let’s understand what you need.",
      `<p>The project inquiry is the verified contact path available here. Tell us what you want to make possible, and the founder can review it privately.</p><a href="/inquiry" class="button">Start a project ${icon("arrow")}</a>`,
    ],
    privacy: [
      "Your information, treated deliberately.",
      `<p>The inquiry form stores your name, email address, project goal, optional details, and consent timestamp in this Mizvo installation for private founder review. Do not submit passwords, health records, or confidential third-party data.</p><p>The workspace uses an essential session cookie when you sign in. Inquiry and sign-in attempts are rate limited for abuse prevention. This build has no analytics trackers, external fonts, AI data processing, or automatic outbound messages.</p><p>Production hosting, a verified business contact, retention policy, and jurisdiction-specific privacy terms must be configured before this installation collects public inquiries.</p>`,
    ],
    inquiry: [
      "What would you like to make possible?",
      `<p class="muted">A clear problem is a great place to begin. Share enough to start a conversation; keep sensitive files and credentials out of this form.</p><div class="card" data-layout="layout-0">${form("inquiry", field("Your name", "name") + field("Email address", "email", "", "email") + textarea("What should the software help you do?", "goal") + textarea("Useful context, requirements, or constraints (optional)", "details", "", false) + `<label class="honeypot" aria-hidden="true">Website<input name="website" tabindex="-1" autocomplete="off"></label><label class="check field"><input type="checkbox" name="consent" required><span>I agree to Mizvo storing these details to review my inquiry. <a href="/privacy">Read the privacy information.</a></span></label>`, "Send inquiry")}</div>`,
    ],
  };
  const entry = content[route.page];
  if (!entry)
    return `${publicHeader()}<main id="main" class="public-section">${empty("Page not found", "Choose a destination from the navigation.", '<a class="button" href="/">Discover Mizvo</a>')}</main>${footer()}`;
  return `${publicHeader()}<main id="main" class="public-page"><div class="page-head"><p class="eyebrow">Mizvo / ${e(route.page)}</p><h1>${entry[0]}</h1></div><div class="page-body">${entry[1]}</div></main>${footer()}`;
}
function login() {
  return `${publicHeader()}<main id="main" class="login"><p class="eyebrow">Your workspace, considered.</p><h1>Welcome to Mizvo.</h1><p class="muted">Sign in to your Studio or Client Space.</p>${form("login", field("Email", "email", "", "email") + field("Password", "password", "", "password"), "Sign in")}<div class="divider"></div><p class="muted">Access is provisioned by the installation administrator. There is no public account registration.</p><a href="/">Return to Discover ${icon("arrow")}</a></main>`;
}
function navItem(page: string, label: string, ico = page) {
  return `<a aria-label="${e(label)}" href="/${route.surface}/${page === "home" ? "" : page}" class="${(route.page === page && !route.project) || (route.project && page === "projects") ? "active" : ""}">${icon(ico)}<span>${label}</span></a>`;
}
function shell(content: string) {
  const client = route.surface === "space";
  return `<header class="topbar"><button class="mobile-menu quiet" data-action="menu" aria-label="Toggle workspace navigation" aria-expanded="false">${icon("menu")}</button><a class="brand" href="/${route.surface}">${mark}<span>MIZVO / ${client ? "CLIENT SPACE" : "STUDIO"}</span></a><button class="search quiet" data-action="search">${icon("search")}<span>Search or press ⌘K</span></button><a class="button quiet" href="/${route.surface}/notifications" aria-label="Notifications">${icon("notifications")}</a><div class="account">${avatar(me!.user.name)}<span class="account-name">${e(me!.user.name)}</span></div></header><div class="app-shell ${client ? "space-shell" : ""}"><nav class="sidebar" aria-label="${client ? "Client" : "Studio"} navigation">${navItem("home", "Home")}${navItem("projects", "Projects")}${client ? "" : navItem("rooms", "Rooms") + navItem("workbench", "Workbench") + (me!.founder ? navItem("pipeline", "Pipeline") : "") + navItem("delivery", "Delivery") + `<div class="group"></div>` + navItem("people", "People") + (me!.founder ? navItem("operations", "Operations") : "")}${navItem("settings", "Settings & security", "settings")}<div class="sidebar-footer"><p class="eyebrow">Independent. Integrated.</p><a href="/${client ? "studio" : "space"}">${client ? "Studio" : "Client Space"} ${icon("arrow")}</a><a href="/">Discover Mizvo ${icon("arrow")}</a><a href="/source">Source & license</a></div></nav><main id="main" class="workspace">${content}</main></div><nav class="bottom-nav" aria-label="Quick navigation">${navItem("home", "Home")}${navItem("projects", "Projects")}${navItem("notifications", "Updates", "notifications")}${navItem("settings", "Account", "settings")}</nav>`;
}
function head(title: string, description: string, action = "") {
  return `<header class="page-head"><p class="eyebrow">Mizvo / ${e(route.surface)}</p><div class="row between"><div><h1>${e(title)}</h1><p class="muted">${e(description)}</p></div>${action}</div></header>`;
}
function projectCards() {
  return projects.length
    ? `<div class="grid">${projects.map((p) => `<a class="card link-card" href="${projectPath(p.id)}"><div class="row between"><span class="eyebrow">${e(p.role)}</span>${badge(p.status)}</div><div class="focus-art" data-layout="layout-1"></div><h2>${e(p.name)}</h2><p class="muted">${e(p.purpose)}</p><small>Updated ${date(p.updated_at)} ${icon("arrow")}</small></a>`).join("")}</div>`
    : empty(
        "Your next project starts here.",
        route.surface === "space"
          ? "Projects will appear when you accept a client invitation."
          : "Create a project to keep its purpose, decisions, and engineering context together.",
        me!.founder
          ? button("Create a project", "new-project", "")
          : button("Accept an invitation", "accept-invite"),
      );
}
function composer(client = false, kind = "discussion") {
  const options = client
    ? ["feedback", "support"]
    : ["discussion", "note", "decision", "design"];
  return `<section class="composer" aria-label="Add a project record">${form("record", `<div class="row"><label class="sr-only" for="record-kind">Record type</label><select id="record-kind" name="kind">${options.map((x) => `<option ${kind === x ? "selected" : ""}>${x}</option>`).join("")}</select>${client ? "" : `<label class="sr-only" for="record-visibility">Visibility</label><select id="record-visibility" name="visibility"><option value="internal">Internal only</option><option value="client">Visible to clients</option></select>`}</div><label class="sr-only" for="record-title">Title</label><input id="record-title" name="title" maxlength="200" placeholder="A clear title…" required><label class="sr-only" for="record-body">Content</label><textarea id="record-body" name="body" maxlength="12000" placeholder="${client ? "Share your feedback or ask for help…" : "Share context, a note, or a proposed decision…"}" required></textarea><div class="submit-row row"><small>${client ? "Shared with your project team." : "Decisions start as proposals."}</small></div>`, "Save to project")}</section>`;
}
function recordCard(r: Data, client = false) {
  const canEdit = r.actor_id === me!.user.id || room?.role === "owner";
  return `<article class="record ${e(r.kind)}" id="record-${e(r.id)}">${avatar(r.actor)}<div class="record-meta"><strong>${e(r.actor)}</strong><time datetime="${e(r.created_at)}">${date(r.created_at)}</time><span>${e(r.kind)}</span>${!client ? `<span>· ${r.visibility === "client" ? "Client visible" : "Internal"}</span>` : ""}${badge(r.state)}</div><h3>${e(r.title)}</h3><div class="prose">${e(r.body)}</div><div class="actions">${canEdit ? button("Edit", `edit-record:${r.id}`) : ""}${button("History", `history:${r.id}`, "quiet")}${r.kind === "support" && (!client || (r.actor_id === me!.user.id && r.state === "resolved")) ? button(r.state === "resolved" ? "Reopen request" : "Resolve request", `support-status:${r.id}:${r.state === "resolved" ? "open" : "resolved"}`) : ""}${!client && room?.role === "owner" && r.kind === "decision" && r.state === "proposed" ? button(`${icon("check")} Approve`, `decision:${r.id}:approved`, "") + button("Request changes", `decision:${r.id}:rejected`) : ""}</div></article>`;
}
function projectHeader() {
  const p = room!.project,
    client = route.surface === "space";
  const tabs = client
    ? [
        ["room", "Overview"],
        ["brief", "Purpose"],
        ["plan", "Progress"],
        ["decisions", "Decisions"],
        ["releases", "Reviews & files"],
        ["feedback", "Feedback"],
        ["support", "Support"],
      ]
    : [
        ["room", "Room"],
        ["brief", "Living Brief"],
        ["plan", "Plan"],
        ["decisions", "Client decisions"],
        ["code", "Code"],
        ["design", "Design"],
        ["tests", "Tests"],
        ["releases", "Releases"],
        ["notes", "Notes"],
      ];
  return `<header class="project-head"><div class="breadcrumb"><a href="/${route.surface}/projects">Projects</a> / ${e(p.name)}</div><div class="project-title"><img class="project-thumb" src="/assets/architecture.svg" alt=""><div><h1>${e(p.name)}</h1><p>${e(p.purpose)}</p></div>${badge(p.status)}</div><nav class="tabs" aria-label="Project sections">${tabs.map(([key, label]) => `<a href="${projectPath(p.id, key)}" class="${route.tab === key ? "active" : ""}" ${route.tab === key ? 'aria-current="page"' : ""}>${label}</a>`).join("")}</nav></header>`;
}
function inspectorPanel() {
  const p = room!.project;
  const pending = room!.pending_decisions ?? 0,
    blockers = room!.tasks.filter((t: Data) => t.status === "blocked");
  return `<aside id="context" class="inspector ${inspector ? "open" : ""}" ${inspectorCollapsed ? "hidden" : ""} aria-label="Project context"><div class="row between"><h2>Project context</h2><button class="quiet" data-action="close-inspector" aria-label="Close project context">${icon("close")}</button></div><section class="card"><h2>Project overview</h2><dl class="detail-list"><dt>Status</dt><dd>${e(p.status)}</dd><dt>Your role</dt><dd>${e(room!.role)}</dd><dt>Updated</dt><dd>${date(p.updated_at)}</dd><dt>Owner</dt><dd>${e(room!.members.find((m: Data) => m.role === "owner")?.name ?? "Project owner")}</dd></dl>${room!.role === "owner" ? `<div class="divider"></div>${form("status", select("Project stage", "status", ["discovery", "scoping", "design", "engineering", "review", "delivered", "support"], p.status), "Update stage")}` : ""}</section><section class="card"><div class="focus-art"></div><h2>Current focus</h2><p class="scope">${e(p.scope || "Add shared context through a project note. Keep the next useful outcome clear.")}</p></section><section class="card"><h2>Next up</h2>${pending ? `<p>${pending} decision proposal${pending > 1 ? "s" : ""} awaiting explicit review.</p>` : blockers.length ? `<p>${blockers.length} task${blockers.length > 1 ? "s are" : " is"} blocked.</p>` : '<p class="muted">Capture the next useful step as a task or project note.</p>'}${room!.next_decision ? `<a class="button secondary" href="${projectPath(p.id)}#record-${e(room!.next_decision.id)}">Review decision ${icon("arrow")}</a>` : `<a class="button secondary" href="${projectPath(p.id, "plan")}">Open plan ${icon("arrow")}</a>`}</section><section class="card"><h2>Project history</h2>${room!.activity
    .slice(0, 5)
    .map(
      (a: Data) =>
        `<div class="activity"><strong>${e(a.actor ?? "System")}</strong><br>${e(a.action.replaceAll(".", " "))}<br><small>${date(a.created_at)}</small></div>`,
    )
    .join("")}</section></aside>`;
}
function tasks() {
  const list = room!.tasks,
    milestones = room!.milestones ?? [],
    studio = route.surface === "studio",
    canEdit = studio && room!.role === "owner";
  const cards = milestones.map((m: Data) => {
    const linked = studio
      ? list.filter((t: Data) => t.milestone_id === m.id)
      : [];
    return `<article class="card"><div class="row between"><h3>${e(m.title)}</h3>${badge(m.status)}</div>${m.summary ? `<p class="prose muted">${e(m.summary)}</p>` : ""}${m.target_date ? `<p class="muted">Target: ${e(m.target_date)}</p>` : ""}${studio ? `<p class="muted">${linked.filter((t: Data) => t.status === "done").length} of ${linked.length} linked tasks complete · ${e(m.visibility)}</p>` : ""}${canEdit ? button("Update milestone", `edit-milestone:${m.id}`) : ""}</article>`;
  });
  return `<div class="row between" data-layout="layout-2"><div><h2>Plan / Milestones</h2><p class="muted">Concrete checkpoints, linked work, and explicit review.</p></div><div class="row">${canEdit ? button(`${icon("plus")} Add milestone`, "new-milestone", "") : ""}${studio ? button(`${icon("plus")} Add task`, "new-task", "") : ""}</div></div>${milestones.length ? `<div class="grid">${cards.join("")}</div>` : empty("No milestone checkpoints yet.", "The project owner can create a dated checkpoint and choose what to share with clients.")}<div class="divider"></div><h2>Tasks</h2>${list.length ? list.map((t: Data) => `<article class="task"><span>${icon(t.status === "done" ? "check" : "plan")}</span><div class="task-copy"><h3>${e(t.title)}</h3><small>${e(t.milestone)} ${t.depends_on ? "· Has a dependency" : ""}</small><div class="row" data-layout="layout-3">${badge(t.status)}${t.priority === "high" ? badge("high") : ""}</div>${t.evidence ? `<p class="prose muted" data-layout="layout-4">${e(t.evidence)}</p>` : ""}</div>${studio ? button("Update", `edit-task:${t.id}`) : ""}</article>`).join("") : empty("A clear plan starts with one step.", "Tasks and evidence remain available throughout this project.")}`;
}

function livingBrief(client = false) {
  const b = room!.brief;
  const canEdit = !client && room!.role === "owner";
  if (!b)
    return `<section class="card living-brief" aria-label="Living Brief"><p class="eyebrow">Living Brief</p><h2>Start with the problem, not the software.</h2><p class="muted">The project owner can capture the people, desired outcome, boundaries and next useful action here.</p>${canEdit ? button("Create Living Brief", "revise-brief", "") : ""}</section>`;
  const visible = client || b.visibility === "client";
  return `<section class="card living-brief" aria-label="Living Brief"><div class="row between"><div><p class="eyebrow">Living Brief · Version ${e(b.version)}</p><h2>What this project needs to make possible</h2></div>${canEdit ? button("Revise Living Brief", "revise-brief", "") : ""}</div>${!client ? `<p class="muted">${visible ? "This exact revision is shared with clients." : "Internal draft only. Clients see the last shared version."}</p>` : ""}<dl class="detail-list"><dt>The challenge</dt><dd>${e(b.problem)}</dd><dt>Who this is for</dt><dd>${e(b.audience)}</dd><dt>Successful outcome</dt><dd>${e(b.outcome)}</dd>${b.exclusions ? `<dt>Not part of this work</dt><dd>${e(b.exclusions)}</dd>` : ""}${b.next_step ? `<dt>Next useful action</dt><dd>${e(b.next_step)}</dd>` : ""}</dl><small class="muted">Recorded ${date(b.created_at)} · Revisions preserve earlier versions.</small></section>`;
}
function briefForm() {
  const b = room!.brief;
  return form(
    "brief",
    textarea("What problem needs solving?", "problem", b?.problem ?? room!.project.purpose) +
      textarea("Who needs this to work?", "audience", b?.audience ?? "") +
      textarea("What would success look like?", "outcome", b?.outcome ?? "") +
      textarea("Boundaries and exclusions (optional)", "exclusions", b?.exclusions ?? "", false) +
      textarea("Next meaningful action (optional)", "next_step", b?.next_step ?? "", false) +
      select("Brief visibility", "visibility", ["internal", "client"], b?.visibility ?? "internal") +
      `<input type="hidden" name="version" value="${b?.version ?? 0}"><p class="notice">Each save creates an immutable revision. Publishing a new shared revision makes pending client decisions linked to an older shared version stale. It does not approve releases or send messages.</p>`,
    "Save Living Brief",
  );
}
function clientDecisionView() {
  const client = route.surface === "space",
    list = room!.client_decisions ?? [],
    eligible = client
      ? []
      : room!.members.filter(
          (m: Data) =>
            m.role === "client" &&
            !m.revoked_at &&
            (!m.expires_at || new Date(m.expires_at) > new Date()),
        ),
    canRequest = !client && room!.role === "owner" && eligible.length > 0;
  const cards = list
    .map((d: Data) => {
      const preview = room!.releases.find((r: Data) => r.id === d.preview_release_id);
      const stale = client && d.brief_version != null && d.brief_version !== room!.brief?.version;
      return `<article class="card"><div class="row between"><h3>${e(d.title)}</h3>${badge(d.status)}</div>${client ? "" : `<p class="muted">For ${e(d.recipient)}</p>`}<p class="prose">${e(d.body)}</p>${d.brief_version != null ? `<p class="muted">Bound to shared Living Brief v${e(d.brief_version)}. <a href="${projectPath(route.project, "brief")}">Read the brief</a></p>` : ""}${preview?.demo_url ? `<p><a class="button secondary" target="_blank" rel="noopener noreferrer" href="${e(preview.demo_url)}">Preview ${e(preview.label)} ${icon("arrow")}</a></p>` : ""}<small>Requested ${date(d.created_at)}</small>${d.outcome ? `<div class="review"><strong>${e(d.outcome.replaceAll("_", " "))}</strong><p class="prose">${e(d.comment)}</p><small>${date(d.answered_at)}</small></div>` : ""}${stale ? '<p class="notice">The shared brief has been revised. Request an updated decision before responding.</p>' : ""}${client && d.status === "pending" && !stale ? button("Respond to request", `respond-client-decision:${d.id}`, "") : ""}${!client && room!.role === "owner" && d.status === "pending" ? button("Cancel pending request", `cancel-client-decision:${d.id}`) : ""}</article>`;
    })
    .join("");
  return `<div class="row between" data-layout="layout-2"><div><h2>${client ? "Your decisions" : "Client decision requests"}</h2><p class="muted">Responses belong to a named client and an exact request. They never approve engineering releases or create contracts.</p></div>${canRequest ? button("Request client decision", "new-client-decision", "") : ""}</div>${!client && room!.role === "owner" && !eligible.length ? `<p class="muted">Invite a client and confirm their project access before requesting a decision.</p>` : ""}<div class="stack">${list.length ? cards : empty("No client decisions yet.", client ? "A requested decision will appear here when Mizvo asks for your response." : "A decision request creates a durable record for a specific client.")}</div>`;
}
function releases() {
  return `<div class="row between" data-layout="layout-2"><div><h2>${route.surface === "space" ? "Your project versions" : "Delivery / Version records"}</h2><p class="muted">Each review belongs to one immutable version.</p></div>${room!.role === "owner" ? button(`${icon("plus")} Record version`, "new-release", "") : ""}</div>${room!.releases.length ? room!.releases.map((r: Data) => `<article class="card release" data-layout="layout-5"><div class="row between"><h2>${e(r.label)}</h2><small>${date(r.created_at)}</small></div><p class="prose">${e(r.summary)}</p>${route.surface === "studio" ? `<p class="version">Commit ${e(r.commit_sha)}</p><p class="muted">${r.source_evidence?.length ? "Source checked against GitHub. Artifacts and deployment are not verified." : "Source SHA is recorded but not verified against GitHub."}</p>${room!.role === "owner" ? button("Verify GitHub source", `verify-source:${r.id}`) : ""}${(r.source_evidence ?? []).map((v: Data) => `<section class="review"><strong>GitHub source verified</strong><p class="version">${e(v.repository)}<br>Commit ${e(v.commit_sha)}<br>Tree ${e(v.tree_sha)}</p><p>CI observed: ${e(v.ci_state.replaceAll("_", " "))}</p><small>${date(v.observed_at)} · ${e(room!.members.find((m: Data) => m.user_id === v.actor_id)?.name ?? "Project owner")}</small></section>`).join("")}<h3>Rollback</h3><p class="prose muted">${e(r.rollback)}</p>` : ""}<div class="row">${r.demo_url ? `<a class="button secondary" href="${e(r.demo_url)}" target="_blank" rel="noopener noreferrer">Open demonstration ${icon("arrow")}</a>` : ""}${r.artifact_url ? `<a class="button secondary" href="${e(r.artifact_url)}" target="_blank" rel="noopener noreferrer">Open deliverable ${icon("arrow")}</a>` : ""}${r.actor_id !== me!.user.id && !r.reviews.some((v: Data) => v.actor_id === me!.user.id) ? button("Review this version", `review-release:${r.id}`) : ""}</div>${r.reviews.map((v: Data) => `<div class="review"><div class="row"><strong>${e(v.actor)}</strong>${badge(v.outcome)}<small>${date(v.created_at)}</small></div><p class="prose">${e(v.comment)}</p></div>`).join("")}</article>`).join("") : empty("No version has been shared yet.", "Demonstrations and deliverables appear here when the project owner records a version.")}`;
}
function workbench() {
  return `<div class="row between"><div><h2>Engineering workbench</h2><p class="muted">Read-only source and evidence from GitHub.</p></div>${room!.role === "owner" ? button("Connect repository", "connect-repo") : ""}</div>${room!.repository ? `<section class="card"><p class="version">${e(room!.repository.full_name)}</p><div class="row">${button("Load branches, commits & pull requests", "load-github", "")}${button("Browse source", "browse-source")}${button("Inspect a diff", "diff")}</div><div id="github-evidence" class="stack" data-layout="layout-6"><p class="muted">Evidence is loaded on request. No test outcome is assumed.</p></div></section>` : empty("Connect an authorized repository.", "The installation administrator must allow the repository before the project owner connects it. Source access is limited to internal project members.")}`;
}
function recordFilter() {
  return route.surface === "space"
    ? route.tab === "room"
      ? "shared"
      : route.tab === "support"
        ? "support"
        : route.tab === "feedback"
          ? "feedback"
          : ""
    : route.tab === "notes"
      ? "note"
      : route.tab === "design"
        ? "design"
        : "";
}
function recordFeed(list: Data[], client = false, emptyHtml = "") {
  return `<div id="record-feed">${room!.record_page?.has_more ? button("Load older records", "older-records") : ""}<div id="record-timeline">${list.length ? list.map((r) => recordCard(r, client)).join("") : emptyHtml}</div></div>`;
}
function projectView() {
  const client = route.surface === "space",
    tab = route.tab;
  let main = "";
  if (tab === "brief") main = livingBrief(client);
  else if (tab === "plan") main = tasks();
  else if (tab === "decisions") main = clientDecisionView();
  else if (tab === "releases") main = releases();
  else if (["code", "tests"].includes(tab) && !client) main = workbench();
  else if (client) {
    if (tab === "room")
      main = `<section class="card"><p class="eyebrow">Your project with Mizvo</p><h2 class="space-intro">One clear step at a time.</h2><p class="muted">${e(room!.brief?.outcome || room!.project.purpose)}</p>${(() => { const d = (room!.client_decisions ?? []).find((x: Data) => x.status === "pending" && (x.brief_version == null || x.brief_version === room!.brief?.version)); return d ? `<p class="notice">Your next decision: ${e(d.title)}. Review the exact request and version before responding.</p><a class="button" href="${projectPath(route.project, "decisions")}">Review requested decision ${icon("arrow")}</a>` : `<a class="button secondary" href="${projectPath(route.project, "releases")}">Review shared versions ${icon("arrow")}</a>`; })()}</section>${livingBrief(true)}<div data-layout="layout-7"></div>${recordFeed(room!.records, true)}`;
    else {
      const kind = tab === "support" ? "support" : "feedback";
      main = composer(true, kind) + recordFeed(room!.records, true);
    }
  } else {
    const filter = tab === "notes" ? "note" : tab === "design" ? "design" : "";
    const records = room!.records.filter(
      (r: Data) => !filter || r.kind === filter,
    );
    main = (tab === "room" ? livingBrief(false) : "") + `<div class="room-toolbar"><h2>${filter ? (filter === "note" ? "Project notes" : "Design context") : "Project conversation"}</h2><button class="quiet" data-action="inspector" aria-controls="context" aria-expanded="${innerWidth > 1200 ? !inspectorCollapsed : inspector}">Project context ${icon("menu")}</button></div>${recordFeed(records, false, empty(filter ? "Capture lasting project context." : "Welcome to your project Room.", "Write a note, share an update, or propose a decision. Saved records stay with this project."))}<div data-layout="layout-8"></div>${composer(false, filter || "discussion")}`;
  }
  return (
    projectHeader() +
    `<div class="room-layout ${client || inspectorCollapsed || ["plan", "decisions", "code", "tests", "releases"].includes(tab) ? "inspector-hidden" : ""}"><section class="room-main">${main}</section>${client || ["plan", "decisions", "code", "tests", "releases"].includes(tab) ? "" : inspectorPanel()}</div>`
  );
}
async function overview() {
  if (route.page === "settings") {
    const sessions = await api("/sessions");
    return (
      head(
        "A workspace that respects you.",
        "Control your sessions, notifications, and project access.",
      ) +
      `<div class="page-body grid"><section class="card"><h2>${e(me!.user.name)}</h2><p class="muted">${e(me!.user.email)}</p>${button("Change password", "change-password")}${button("Sign out", "logout")}<div class="divider"></div>${button("Revoke other sessions", "revoke-sessions", "danger")}<div id="sessions">${sessions.map((session: Data) => `<div class="activity"><strong>${session.current ? "This session" : "Another signed-in session"}</strong><br><small>Started ${date(session.created_at)} · expires ${date(session.expires_at)}</small></div>`).join("")}</div></section><section class="card"><h2>Notification preferences</h2>${form("preferences", `<label class="check field"><input type="checkbox" name="activity" ${me!.preferences.activity ? "checked" : ""}>In-app project activity updates</label>`, "Save preferences")}<p class="muted">Email, SMS, and external AI services are not activated.</p></section><section class="card"><h2>Have a project invitation?</h2><p class="muted">Accept it using the account it was addressed to.</p>${button("Accept an invitation", "accept-invite")}</section></div>`
    );
  }
  if (route.page === "notifications") {
    const notifications = await api("/notifications");
    return (
      head(
        "Project updates.",
        "Activity without confidential message previews.",
        button("Mark all read", "read-notifications"),
      ) +
      `<div class="page-body">${notifications.length ? notifications.map((n: Data) => `<a class="card link-card" data-layout="layout-9" href="${projectPath(n.project_id)}"><div class="row between"><span>${n.read_at ? "" : "● "}${e(n.action)}</span><small>${date(n.created_at)}</small></div></a>`).join("") : empty("You’re up to date.", "Meaningful project events will appear here.")}</div>`
    );
  }
  if (route.page === "pipeline" && me!.founder) {
    const inquiries = await api("/pipeline");
    return (
      head(
        "From an idea to a shared commitment.",
        "Private inquiries, qualification, scoping, and project creation.",
      ) +
      `<div class="page-body stack">${inquiries.length ? inquiries.map((i: Data) => `<article class="card"><div class="row between"><h2>${e(i.goal)}</h2>${badge(i.status)}</div><p class="muted">${e(i.name)} · ${e(i.email)}</p><p class="prose">${e(i.details)}</p>${form(`pipeline:${i.id}`, `<input type="hidden" name="version" value="${i.version}">${select("Stage", "status", ["new", "qualified", "scoping", "approved", "closed"], i.status)}`, "Update stage")}${i.project_id ? `<a class="button secondary" href="${projectPath(i.project_id)}">Open project ${icon("arrow")}</a>` : i.status === "approved" ? button("Create project from inquiry", `convert:${i.id}`) : ""}</article>`).join("") : empty("No inquiries yet.", "Project inquiries submitted through Discover are recorded here.")}</div>`
    );
  }
  if (route.page === "operations" && me!.founder)
    return (
      head("Organization operations.", "Restricted to the founder.") +
      `<div class="page-body grid"><section class="card"><h2>Organization</h2><p>Founder-led Mizvo workspace.</p><p class="muted">Project access is explicit. Client accounts do not receive Studio permissions.</p></section><section class="card"><h2>Integration boundaries</h2><p class="muted">No payment, accounting, contracts, AI, SMS, or outbound email providers are active. Their activation requires separate requirements and authorization.</p></section><section class="card"><h2>Installation administration</h2><p class="muted">Account provisioning, backups, repository allowlists, and runtime secrets are administered through the documented server configuration.</p></section></div>`
    );
  if (route.page === "home") {
    const focus = await api(
      route.surface === "space" ? "/space/home" : "/home",
    );
    return (
      head(
        `Good ${new Date().getHours() < 12 ? "morning" : "afternoon"}, ${me!.user.name.split(" ")[0]}.`,
        projects.length
          ? "Your project context is ready when you are."
          : "One clear next step: open or create a project.",
        me!.founder
          ? button(`${icon("plus")} Create project`, "new-project", "")
          : button("Accept invitation", "accept-invite"),
      ) +
      `<div class="page-body"><p class="eyebrow">Your focus today</p>${projectCards()}<div class="divider"></div><div class="grid"><section class="card"><h2>Awaiting a decision</h2>${focus.decisions.length ? focus.decisions.map((r: Data) => `<p><a href="${projectPath(r.project_id)}#record-${e(r.id)}">${e(r.title)} ${icon("arrow")}</a></p>`).join("") : '<p class="muted">No outstanding decision proposals.</p>'}</section><section class="card"><h2>Blockers & reviews</h2>${focus.tasks.length ? focus.tasks.map((r: Data) => `<p><a href="${projectPath(r.project_id, "plan")}">${badge(r.status)} ${e(r.title)}</a></p>`).join("") : '<p class="muted">No tasks are blocked or waiting for review.</p>'}</section>${route.surface === "studio" ? `<section class="card"><h2>Recent project activity</h2>${focus.activity.length ? focus.activity.map((r: Data) => `<div class="activity"><strong>${e(r.actor)}</strong> · ${e(r.action.replaceAll(".", " "))}<br><small>${date(r.created_at)}</small></div>`).join("") : '<p class="muted">Activity appears as you work.</p>'}</section>` : ""}</div><div class="divider"></div><p class="muted">Decisions, notes, and verified outcomes. No attendance tracking or productivity scores.</p></div>`
    );
  }
  const copy: Record<string, [string, string]> = {
    projects: [
      "Projects",
      "A durable home for each purpose, decision, and outcome.",
    ],
    rooms: [
      "Your project Rooms.",
      "Choose a project to enter its shared context.",
    ],
    people: [
      "People & project access.",
      "Open a project to manage its actual members and invitations.",
    ],
    workbench: [
      "Connected engineering.",
      "Choose a project to inspect its authorized source and evidence.",
    ],
    delivery: [
      "Versions, reviews, and handover.",
      "Choose a project to review immutable delivery records.",
    ],
  };
  const [title, description] = copy[route.page] ?? [
    "Workspace unavailable",
    "Choose a section from the navigation.",
  ];
  return (
    head(
      title,
      description,
      me!.founder && route.page === "projects"
        ? button(`${icon("plus")} New project`, "new-project", "")
        : "",
    ) +
    `<div class="page-body">${route.page === "people" && route.project ? "" : projectCards().replaceAll("?tab=room", `?tab=${route.page === "workbench" ? "code" : route.page === "delivery" ? "releases" : "room"}`)}${route.page === "people" && projects.length ? `<div class="divider"></div>${projects.map((p) => button(`Manage ${e(p.name)}`, `people:${p.id}`)).join(" ")}` : ""}</div>`
  );
}
async function render() {
  parseRoute();
  room = null;
  document.title =
    route.surface === "site"
      ? "Mizvo — Make the improbable useful."
      : `Mizvo / ${route.surface === "space" ? "Client Space" : "Studio"}`;
  try {
    if (route.surface === "site") {
      root.innerHTML = discover();
      return;
    }
    if (!me) {
      try {
        const identity = await api("/me");
        me = identity;
        csrf = identity.csrf;
      } catch {
        root.innerHTML = login();
        return;
      }
    }
    if (route.surface === "login") {
      await navigate("/studio");
      return;
    }
    root.setAttribute("aria-busy", "true");
    projects = await api(
      route.surface === "space" ? "/space/projects" : "/projects",
    );
    if (route.project) {
      room = await api(
        `${route.surface === "space" ? "/space" : ""}/projects/${route.project}?kind=${recordFilter()}`,
      );
      const target = location.hash.match(/^#record-([a-f0-9-]{36})$/)?.[1];
      if (target && !room!.records.some((r: Data) => r.id === target)) {
        const record = await api(
          `${route.surface === "space" ? "/space" : ""}/projects/${route.project}/records/${target}`,
        );
        room!.records = [record, ...room!.records].sort(
          (a: Data, b: Data) =>
            a.created_at.localeCompare(b.created_at) ||
            a.id.localeCompare(b.id),
        );
      }
      root.innerHTML = shell(projectView());
      if (target)
        document
          .getElementById("record-" + target)
          ?.scrollIntoView({ block: "center" });
    } else root.innerHTML = shell(await overview());
  } catch (err) {
    root.innerHTML = shell(
      head(
        "This workspace could not be opened.",
        "Access may have changed, or the connection may be unavailable.",
      ) +
        `<div class="page-body"><p class="error" role="alert">${e((err as Error).message)}</p><div class="row">${button("Try again", "retry")}<a class="button secondary" href="/${route.surface}">Back to projects</a></div></div>`,
    );
  } finally {
    root.removeAttribute("aria-busy");
  }
}
async function navigate(path: string) {
  if (dirty && !confirm("Leave with unsaved changes?")) return;
  dirty = false;
  history.pushState({}, "", path);
  await render();
  if (!location.hash) window.scrollTo(0, 0);
}
async function people(project: string) {
  const data = await api("/projects/" + project);
  const pending =
    data.role === "owner" ? await api(`/projects/${project}/invitations`) : [];
  modal(
    "Project people",
    `${data.members.map((m: Data) => `<div class="people-row">${avatar(m.name)}<div class="person"><h3>${e(m.name)}</h3><small>${e(m.email)}${m.expires_at ? ` · access until ${date(m.expires_at)}` : ""}</small><div>${badge(m.revoked_at ? "revoked" : m.role)}</div></div>${data.role === "owner" && m.role !== "owner" && !m.revoked_at ? button("Revoke", `revoke-member:${project}:${m.user_id}`, "danger") + button(m.role === "client" ? "Make contributor" : "Make client", `role-member:${project}:${m.user_id}:${m.role === "client" ? "contributor" : "client"}`) : ""}</div>`).join("")}${pending.map((i: Data) => `<div class="people-row"><div class="person"><strong>${e(i.email)}</strong><br><small>${e(i.role)} · ${i.revoked_at ? "Revoked" : i.accepted_at ? "Accepted" : new Date(i.expires_at) < new Date() ? "Expired" : "Pending"} · expires ${date(i.expires_at)}</small></div>${!i.accepted_at && !i.revoked_at ? button("Revoke", `revoke-invite:${project}:${i.id}`, "danger") : ""}</div>`).join("")}${data.role === "owner" ? button("Create project invitation", `invite:${project}`, "") : ""}`,
  );
}
function clientDecisionForm() {
  const active = room!.members.filter(
    (m: Data) =>
      m.role === "client" &&
      !m.revoked_at &&
      (!m.expires_at || new Date(m.expires_at) > new Date()),
  );
  return form(
    "client-decision",
    `<label class="field">Client<select name="client_id" required>${active.map((m: Data) => `<option value="${e(m.user_id)}">${e(m.name)}</option>`).join("")}</select></label>` +
      field("Decision title", "title") +
      textarea("What exactly needs their decision?", "body") +
      `<label class="field">Reviewed shared brief<select name="brief_version"><option value="">Unbound request</option>${room!.shared_brief_version ? `<option value="${room!.shared_brief_version}">Living Brief v${room!.shared_brief_version}</option>` : ""}</select></label>` +
      `<label class="field">Related client-visible preview<select name="preview_release_id"><option value="">No preview attached</option>${room!.releases.filter((r: Data) => r.visibility === "client").map((r: Data) => `<option value="${e(r.id)}">${e(r.label)}</option>`).join("")}</select></label>` +
      `<p class="notice">The optional brief and preview bind this request to an exact reviewed version. Client acceptance is not legal signoff, payment authorization or permission to deploy.</p>`,
    "Request decision",
  );
}
function clientDecisionResponseForm(d: Data) {
  return form(
    `client-response:${d.id}`,
    select(
      "Your decision",
      "outcome",
      ["accepted", "changes_requested"],
      "changes_requested",
    ) +
      textarea("Response and context", "comment") +
      `<input type="hidden" name="version" value="${d.version}"><p class="notice">Your response is recorded against the exact text of this request and is not a legal signature.</p>`,
    "Record response",
  );
}
function milestoneForm(m?: Data) {
  return form(
    m ? `edit-milestone:${m.id}` : "milestone",
    field("Milestone title", "title", m?.title ?? "") +
      textarea(
        "Outcome and acceptance context",
        "summary",
        m?.summary ?? "",
        false,
      ) +
      field("Target date", "target_date", m?.target_date ?? "", "date", false) +
      select(
        "Milestone status",
        "status",
        ["planned", "active", "blocked", "review", "done"],
        m?.status ?? "planned",
      ) +
      select(
        "Milestone visibility",
        "visibility",
        ["internal", "client"],
        m?.visibility ?? "internal",
      ) +
      `<input type="hidden" name="version" value="${m?.version ?? ""}"><p class="notice">Only shared checkpoints appear in Client Space. A completed milestone does not approve or deploy a release.</p>`,
    "Save milestone",
  );
}
function taskForm(t?: Data) {
  const p = room!;
  return form(
    t ? `edit-task:${t.id}` : "task",
    field("Task", "title", t?.title ?? "") +
      field("Milestone", "milestone", t?.milestone ?? "Project") +
      `<label class="field">Linked milestone<select name="milestone_id"><option value="">No linked milestone</option>${(p.milestones ?? []).map((m: Data) => `<option value="${e(m.id)}" ${t?.milestone_id === m.id ? "selected" : ""}>${e(m.title)}</option>`).join("")}</select></label>` +
      select(
        "Status",
        "status",
        ["todo", "doing", "blocked", "review", "done"],
        t?.status ?? "todo",
      ) +
      select(
        "Priority",
        "priority",
        ["normal", "high"],
        t?.priority ?? "normal",
      ) +
      `<label class="field">Dependency<select name="depends_on"><option value="">No dependency</option>${p.tasks
        .filter((x: Data) => x.id !== t?.id)
        .map(
          (x: Data) =>
            `<option value="${e(x.id)}" ${t?.depends_on === x.id ? "selected" : ""}>${e(x.title)}</option>`,
        )
        .join("")}</select></label>` +
      textarea("Completion evidence", "evidence", t?.evidence ?? "", false) +
      select(
        "Visibility",
        "visibility",
        ["internal", "client"],
        t?.visibility ?? "internal",
      ) +
      `<label class="check field"><input type="checkbox" name="review_required" ${!t || t.review_required ? "checked" : ""}>Owner review required for completion</label><input type="hidden" name="version" value="${t?.version ?? ""}">`,
    "Save task",
  );
}
async function action(value: string) {
  const [name, a, b, c] = value.split(":");
  switch (name) {
    case "close":
      if (!dirty || confirm("Discard unsaved changes?")) close();
      break;
    case "retry":
      await render();
      break;
    case "menu": {
      const nav = document.querySelector(".sidebar")!;
      nav.classList.toggle("open");
      document
        .querySelector('[data-action="menu"]')!
        .setAttribute("aria-expanded", String(nav.classList.contains("open")));
      break;
    }
    case "inspector": {
      const panel = document.querySelector<HTMLElement>("#context")!;
      if (innerWidth > 1200) {
        inspectorCollapsed = !inspectorCollapsed;
        panel.hidden = inspectorCollapsed;
        document
          .querySelector(".room-layout")!
          .classList.toggle("inspector-hidden", inspectorCollapsed);
      } else {
        inspectorCollapsed = false;
        panel.hidden = false;
        inspector = !inspector;
        panel.classList.toggle("open", inspector);
        if (inspector) panel.querySelector<HTMLElement>("button")?.focus();
      }
      document
        .querySelector('[data-action="inspector"]')
        ?.setAttribute(
          "aria-expanded",
          String(innerWidth > 1200 ? !inspectorCollapsed : inspector),
        );
      break;
    }
    case "close-inspector": {
      inspector = false;
      inspectorCollapsed = innerWidth > 1200;
      const panel = document.querySelector<HTMLElement>("#context")!;
      panel.classList.remove("open");
      panel.hidden = inspectorCollapsed;
      if (inspectorCollapsed)
        document
          .querySelector(".room-layout")!
          .classList.add("inspector-hidden");
      const toggle = document.querySelector<HTMLElement>(
        '[data-action="inspector"]',
      );
      toggle?.setAttribute("aria-expanded", "false");
      toggle?.focus();
      break;
    }
    case "older-records": {
      if (!room?.record_page?.next_cursor) return;
      const state = room;
      const context = location.pathname + location.search,
        project = route.project,
        client = route.surface === "space";
      const control = document.querySelector<HTMLButtonElement>(
        '[data-action="older-records"]',
      );
      if (control) control.disabled = true;
      try {
        const page = await api(
          `${client ? "/space" : ""}/projects/${project}/records?kind=${recordFilter()}&before=${encodeURIComponent(room.record_page.next_cursor)}`,
        );
        if (
          room !== state ||
          context !== location.pathname + location.search ||
          room?.project.id !== project
        )
          return;
        room.records = [
          ...new Map(
            [...page.records, ...room.records].map((r: Data) => [r.id, r]),
          ).values(),
        ].sort(
          (a: Data, b: Data) =>
            a.created_at.localeCompare(b.created_at) ||
            a.id.localeCompare(b.id),
        );
        room.record_page = page.record_page;
        const feed = document.querySelector("#record-feed");
        if (feed) feed.outerHTML = recordFeed(room.records, client);
        const focus =
          document.querySelector<HTMLElement>(
            '[data-action="older-records"]',
          ) ?? document.querySelector<HTMLElement>("#record-timeline h3");
        if (focus) {
          if (focus.tagName === "H3") focus.tabIndex = -1;
          focus.focus({ preventScroll: true });
        }
        toast("Older project records loaded.");
      } finally {
        if (control?.isConnected) control.disabled = false;
      }
      break;
    }
    case "new-project":
      modal(
        "Give your project a home.",
        form(
          "project",
          field("Project name", "name") +
            textarea("What should this project make possible?", "purpose") +
            textarea("Scope and boundaries (optional)", "scope", "", false),
          "Create project",
        ),
      );
      break;
    case "edit-record": {
      const r = room!.records.find((x: Data) => x.id === a);
      modal(
        "Edit project record",
        form(
          `edit-record:${a}`,
          field("Title", "title", r.title) +
            textarea("Content", "body", r.body) +
            `<input type="hidden" name="version" value="${r.version}"><p class="notice">Edits create a new history version. Editing a decision returns it to proposed.</p>`,
          "Save new version",
        ),
      );
      break;
    }
    case "history": {
      const list = await api(
        `${route.surface === "space" ? "/space" : ""}/projects/${route.project}/records/${a}/history`,
      );
      modal(
        "Record history",
        list
          .map(
            (r: Data) =>
              `<article class="card" data-layout="layout-9"><div class="row between"><strong>Version ${r.version}</strong>${badge(r.state)}</div><h3>${e(r.title)}</h3><p class="prose">${e(r.body)}</p><small>${e(r.actor)} · ${date(r.created_at)}</small></article>`,
          )
          .join(""),
      );
      break;
    }
    case "support-status": {
      const r = room!.records.find((r: Data) => r.id === a);
      await api(
        `${route.surface === "space" ? "/space" : ""}/projects/${route.project}/records/${a}/status`,
        "POST",
        { state: b, version: r.version },
      );
      history.replaceState(
        {},
        "",
        location.pathname + location.search + "#record-" + a,
      );
      await render();
      toast("Support status recorded.");
      break;
    }
    case "decision": {
      const r = room!.records.find((x: Data) => x.id === a);
      if (
        confirm(
          `${b === "approved" ? "Approve" : "Reject"} this exact decision version? This records your identity and timestamp.`,
        )
      ) {
        await api(`/projects/${route.project}/records/${a}/decision`, "POST", {
          state: b,
          version: r.version,
        });
        history.replaceState(
          {},
          "",
          location.pathname + location.search + "#record-" + a,
        );
        await render();
        toast("Decision outcome recorded.");
      }
      break;
    }
    case "revise-brief":
      modal("Edit the Living Brief", briefForm());
      break;
    case "new-client-decision":
      modal("Request a client decision", clientDecisionForm());
      break;
    case "respond-client-decision": {
      const request = room!.client_decisions.find((x: Data) => x.id === a);
      modal(
        "Respond to a decision request",
        clientDecisionResponseForm(request),
      );
      break;
    }
    case "cancel-client-decision": {
      const request = room!.client_decisions.find((x: Data) => x.id === a);
      if (
        confirm(
          "Cancel this pending client request? Its record remains visible.",
        )
      ) {
        await api(
          `/projects/${route.project}/client-decisions/${a}/cancel`,
          "POST",
          { version: request.version },
        );
        await render();
        toast("Decision request cancelled.");
      }
      break;
    }
    case "new-milestone":
      modal("Add a project milestone", milestoneForm());
      break;
    case "edit-milestone":
      modal(
        "Update project milestone",
        milestoneForm(room!.milestones.find((x: Data) => x.id === a)),
      );
      break;
    case "new-task":
      modal("Add a project task", taskForm());
      break;
    case "edit-task":
      modal(
        "Update project task",
        taskForm(room!.tasks.find((x: Data) => x.id === a)),
      );
      break;
    case "people":
      await people(a!);
      break;
    case "invite":
      modal(
        "Create a scoped invitation",
        form(
          `invite:${a}`,
          field("Recipient email", "email", "", "email") +
            select(
              "Project role",
              "role",
              ["contributor", "client"],
              "contributor",
            ) +
            select(
              "Project access (days)",
              "access_days",
              ["7", "30", "90"],
              "30",
            ) +
            '<p class="muted">Valid for 72 hours. No email is sent. Share only through an authorized channel; the recipient must already have a provisioned account.</p>',
          "Create invitation",
        ),
      );
      break;
    case "accept-invite":
      modal(
        "Accept a project invitation",
        form(
          "accept-invite",
          field("Invitation token", "token") +
            '<p class="muted">The invitation must match your signed-in email address.</p>',
          "Accept invitation",
        ),
      );
      break;
    case "revoke-member":
    case "role-member":
      if (
        confirm(
          name === "revoke-member"
            ? "Revoke this person’s project access immediately?"
            : `Change this member’s project role to ${c}?`,
        )
      ) {
        await api(
          `/projects/${a}/members/${b}`,
          "PATCH",
          name === "revoke-member" ? { revoke: true } : { role: c },
        );
        await people(a!);
        toast("Project access updated.");
      }
      break;
    case "revoke-invite":
      if (confirm("Revoke this pending invitation?")) {
        await api(`/projects/${a}/invitations/${b}/revoke`, "POST", {});
        await people(a!);
      }
      break;
    case "logout":
      await api("/logout", "POST", {});
      me = null;
      csrf = "";
      await navigate("/login");
      break;
    case "change-password":
      modal(
        "Change your password",
        form(
          "password",
          field("Current password", "current", "", "password") +
            field(
              "New password (at least 14 characters)",
              "next",
              "",
              "password",
            ) +
            '<p class="muted">Your other sessions will be signed out.</p>',
          "Change password",
        ),
      );
      break;
    case "revoke-sessions":
      if (confirm("Sign out all your other sessions?")) {
        await api("/sessions/revoke", "POST", {});
        await render();
        toast("Other sessions revoked.");
      }
      break;
    case "read-notifications":
      await api("/notifications/read", "POST", {});
      await render();
      break;
    case "search":
      modal(
        "Find your project context",
        form(
          "search",
          field("Search notes, decisions, and discussions", "q"),
          "Search",
        ) +
          '<div id="search-results" class="stack" data-layout="layout-6"></div>',
      );
      break;
    case "convert":
      modal(
        "Create project from approved inquiry",
        form(`convert:${a}`, field("Project name", "name"), "Create project"),
      );
      break;
    case "connect-repo":
      modal(
        "Connect authorized GitHub source",
        form(
          "repository",
          field(
            "Repository (owner/name)",
            "repository",
            room!.repository?.full_name ?? "",
          ) +
            '<p class="muted">Only repositories in the server’s allowlist can be connected. This grants no GitHub permissions and never writes to GitHub.</p>',
          "Connect repository",
        ),
      );
      break;
    case "load-github": {
      const target = document.querySelector("#github-evidence")!;
      target.innerHTML =
        '<p class="muted" role="status">Loading GitHub evidence…</p>';
      try {
        const result = await api(`/projects/${route.project}/github`);
        target.innerHTML = `<p class="muted">Fetched ${date(result.fetched_at)} · GitHub API</p><h3>Branches</h3>${result.branches.map((x: Data) => `<p class="version">${e(x.name)} · ${e(x.sha)} ${x.protected ? "· protected" : ""}</p>`).join("")}<h3>Commits</h3>${result.commits.map((x: Data) => `<article><a href="${e(x.url)}" target="_blank" rel="noopener noreferrer">${e(x.message.split("\n")[0])}</a><p class="version">${e(x.sha)}</p>${button("Inspect CI", `checks:${x.sha}`, "quiet")}</article>`).join("")}<h3>Pull requests</h3>${result.pulls.length ? result.pulls.map((x: Data) => `<a href="${e(x.url)}" target="_blank" rel="noopener noreferrer">#${x.number} ${e(x.title)} ${x.draft ? "(draft)" : ""}</a>`).join("") : '<p class="muted">No open pull requests returned.</p>'}`;
      } catch (err) {
        target.innerHTML = `<p class="error" role="alert">${e((err as Error).message)}</p>`;
      }
      break;
    }
    case "browse-source":
      modal(
        "Browse repository source",
        form(
          "source",
          field("Branch or exact commit SHA", "ref", "HEAD") +
            field(
              "Path (empty for repository root)",
              "path",
              "",
              "text",
              false,
            ),
          "Load source",
        ) + '<div id="source-results"></div>',
      );
      break;
    case "checks": {
      const data = await api(
        `/projects/${route.project}/github/checks?sha=${a}`,
      );
      modal(
        "CI evidence for exact commit",
        `<p class="version">${e(a)}</p>${data.check_runs.length ? data.check_runs.map((x: Data) => `<article class="card"><h3>${e(x.name)}</h3><p>${e(x.status)} · ${e(x.conclusion ?? "No conclusion yet")}</p><a href="${e(x.html_url)}" target="_blank" rel="noopener noreferrer">Open GitHub logs and evidence</a></article>`).join("") : empty("No check runs returned.", "No test result is inferred from the absence of checks.")}`,
      );
      break;
    }
    case "diff":
      modal(
        "Inspect a source comparison",
        form(
          "diff",
          field("Base commit SHA", "base") + field("Head commit SHA", "head"),
          "Load diff",
        ) + '<div id="diff-results"></div>',
      );
      break;
    case "verify-source": {
      const result = await api(
        `/projects/${route.project}/releases/${a}/verify-source`,
        "POST",
        {},
      );
      await render();
      toast(
        `GitHub source receipt saved. CI observed: ${result.ci_state.replaceAll("_", " ")}.`,
      );
      break;
    }
    case "new-release":
      modal(
        "Record an immutable project version",
        form(
          "release",
          field("Version label", "label") +
            textarea("What changed for the user?", "summary") +
            field("Exact Git commit SHA", "commit_sha") +
            field(
              "Demonstration URL (optional)",
              "demo_url",
              "",
              "url",
              false,
            ) +
            field(
              "Deliverable URL (optional)",
              "artifact_url",
              "",
              "url",
              false,
            ) +
            textarea("Rollback and recovery instructions", "rollback") +
            select(
              "Visibility",
              "visibility",
              ["internal", "client"],
              "internal",
            ) +
            '<p class="notice">Recording a version does not deploy or approve it. Links must point to authorized environments.</p>',
          "Record version",
        ),
      );
      break;
    case "review-release":
      modal(
        "Review this exact version",
        form(
          `review-release:${a}`,
          select(
            "Your outcome",
            "outcome",
            ["approved", "changes_requested"],
            "changes_requested",
          ) +
            textarea("What did you review?", "comment") +
            '<p class="notice">This records your identity and timestamp for this version. It does not approve other versions or create a legal agreement.</p>',
          "Record review",
        ),
      );
      break;
  }
}
function showSource(data: any, ref: string) {
  const target = document.querySelector("#source-results")!;
  if (Array.isArray(data)) {
    target.innerHTML = `<div class="file-tree">${data.map((x) => `<button data-source-path="${e(x.path)}" data-source-ref="${e(ref)}">${e(x.type === "dir" ? "▸ " : "")}${e(x.name)}</button>`).join("")}</div>`;
  } else {
    target.innerHTML = `<h3>${e(data.path)}</h3><pre id="source-content"></pre>`;
    document.querySelector("#source-content")!.textContent = data.content
      ? new TextDecoder().decode(
          Uint8Array.from(atob(data.content.replaceAll("\n", "")), (c) =>
            c.charCodeAt(0),
          ),
        )
      : "This file has no inline text content. Open it on GitHub.";
  }
}
async function submit(f: HTMLFormElement) {
  const name = f.dataset.form!,
    [kind, a] = name.split(":"),
    data = Object.fromEntries(new FormData(f)) as Data;
  if (["inquiry", "preferences", "task", "edit-task"].includes(kind!)) {
    data.consent = data.consent === "on";
    data.activity = data.activity === "on";
    data.review_required = data.review_required === "on";
  }
  if ("version" in data) data.version = Number(data.version);
  if ("brief_version" in data && data.brief_version !== "") data.brief_version = Number(data.brief_version);
  switch (kind) {
    case "login": {
      const result = await api("/login", "POST", data);
      csrf = result.csrf;
      me = await api("/me");
      close();
      const clientProjects = await api("/space/projects");
      await navigate(
        clientProjects.length && !me!.founder ? "/space" : "/studio",
      );
      return;
    }
    case "inquiry": {
      const result = await api("/inquiries", "POST", data);
      dirty = false;
      f.innerHTML = `<h2>Your inquiry is recorded.</h2><p class="muted">The founder can review it privately. No email has been sent.</p><p class="version">Reference ${e(result.id)}</p>`;
      return;
    }
    case "project": {
      const p = await api("/projects", "POST", data);
      close();
      await navigate(`/studio/projects/${p.id}`);
      toast("Your project is ready.");
      return;
    }
    case "record":
      await api(
        `${route.surface === "space" ? "/space" : ""}/projects/${route.project}/records`,
        "POST",
        data,
      );
      break;
    case "edit-record":
      await api(
        `${route.surface === "space" ? "/space" : ""}/projects/${route.project}/records/${a}`,
        "PATCH",
        data,
      );
      history.replaceState(
        {},
        "",
        location.pathname + location.search + "#record-" + a,
      );
      break;
    case "status":
      await api(`/projects/${route.project}`, "PATCH", {
        ...data,
        version: room!.project.version,
      });
      break;
    case "brief":
      await api(`/projects/${route.project}/brief`, "POST", data);
      break;
    case "client-decision":
      await api(`/projects/${route.project}/client-decisions`, "POST", data);
      break;
    case "client-response":
      await api(
        `/space/projects/${route.project}/client-decisions/${a}/respond`,
        "POST",
        data,
      );
      break;
    case "milestone":
    case "edit-milestone":
      await api(
        `/projects/${route.project}/milestones${a ? "/" + a : ""}`,
        a ? "PATCH" : "POST",
        data,
      );
      break;
    case "task":
    case "edit-task":
      await api(
        `/projects/${route.project}/tasks${a ? "/" + a : ""}`,
        a ? "PATCH" : "POST",
        data,
      );
      break;
    case "invite": {
      const result = await api(`/projects/${a}/invitations`, "POST", data);
      dirty = false;
      dialog.innerHTML = `<div class="dialog-head"><h2 id="dialog-title">Invitation created.</h2>${button("Close", "close", "quiet")}</div><p>For ${e(data.email)} · expires ${date(result.expires_at)}.</p><p class="notice">This token is shown once. No message has been sent.</p><label>Invitation token<textarea readonly>${e(result.token)}</textarea></label>`;
      return;
    }
    case "accept-invite":
      await api("/invitations/accept", "POST", data);
      break;
    case "password":
      await api("/password", "POST", data);
      break;
    case "preferences":
      await api("/preferences", "PATCH", data);
      me!.preferences.activity = Number(data.activity);
      break;
    case "search": {
      const result = await api("/search?q=" + encodeURIComponent(data.q));
      document.querySelector("#search-results")!.innerHTML = result.length
        ? result
            .map(
              (r: Data) =>
                `<a class="card" href="${projectPath(r.project_id)}#record-${e(r.id)}">${e(r.kind)} / ${e(r.title)}</a>`,
            )
            .join("")
        : empty(
            "No matching records.",
            "Search is limited to projects and records you can access.",
          );
      dirty = false;
      return;
    }
    case "pipeline":
      await api(`/pipeline/${a}`, "PATCH", data);
      break;
    case "convert": {
      const p = await api(`/pipeline/${a}/project`, "POST", data);
      close();
      await navigate(`/studio/projects/${p.id}`);
      return;
    }
    case "repository":
      await api(`/projects/${route.project}/github`, "PUT", data);
      break;
    case "source": {
      const result = await api(
        `/projects/${route.project}/github/source?path=${encodeURIComponent(data.path)}&ref=${encodeURIComponent(data.ref)}`,
      );
      showSource(result, data.ref);
      dirty = false;
      return;
    }
    case "diff": {
      const result = await api(
        `/projects/${route.project}/github/diff?base=${encodeURIComponent(data.base)}&head=${encodeURIComponent(data.head)}`,
      );
      document.querySelector("#diff-results")!.innerHTML =
        `<p>${result.total_commits} commits · ${e(result.status)}</p>${(result.files ?? []).map((x: Data) => `<h3>${e(x.filename)}</h3><pre>${e(x.patch ?? "No inline patch returned; inspect this file on GitHub.")}</pre>`).join("")}`;
      dirty = false;
      return;
    }
    case "release":
      await api(`/projects/${route.project}/releases`, "POST", data);
      break;
    case "review-release":
      await api(
        `${route.surface === "space" ? "/space" : ""}/projects/${route.project}/releases/${a}/review`,
        "POST",
        data,
      );
      break;
  }
  close();
  dirty = false;
  await render();
  toast("Saved to your project.");
}
document.addEventListener("click", async (event) => {
  const element = event.target as Element;
  const anchor = element.closest<HTMLAnchorElement>("a");
  if (
    anchor &&
    anchor.origin === location.origin &&
    !anchor.target &&
    !event.ctrlKey &&
    !event.metaKey
  ) {
    event.preventDefault();
    if (dialog.open) close();
    await navigate(anchor.pathname + anchor.search + anchor.hash);
    return;
  }
  const source = element.closest<HTMLElement>("[data-source-path]");
  const target = element.closest<HTMLElement>("[data-action]");
  if (!target && !source) return;
  try {
    if (source) {
      const result = await api(
        `/projects/${route.project}/github/source?ref=${encodeURIComponent(source.dataset.sourceRef!)}&path=${encodeURIComponent(source.dataset.sourcePath!)}`,
      );
      showSource(result, source.dataset.sourceRef!);
    } else await action(target!.dataset.action!);
  } catch (err) {
    toast((err as Error).message);
  }
});
document.addEventListener("submit", async (event) => {
  const f = event.target as HTMLFormElement;
  if (!f.dataset.form) return;
  event.preventDefault();
  const b = f.querySelector<HTMLButtonElement>("button[type=submit]")!;
  b.disabled = true;
  f.querySelector(".form-error")!.textContent = "";
  try {
    await submit(f);
  } catch (err) {
    f.querySelector(".form-error")!.textContent = navigator.onLine
      ? (err as Error).message
      : "You’re offline. Your text is still here; reconnect and save again.";
  } finally {
    b.disabled = false;
  }
});
document.addEventListener("input", (event) => {
  if ((event.target as Element).closest("form")) dirty = true;
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && inspector && !dialog.open) {
    void action("close-inspector");
    return;
  }
  if ((event.metaKey || event.ctrlKey) && event.key === "k" && me) {
    event.preventDefault();
    void action("search");
  }
});
dialog.addEventListener("cancel", (event) => {
  if (dirty && !confirm("Discard unsaved changes?")) event.preventDefault();
  else dirty = false;
});
window.addEventListener("beforeunload", (event) => {
  if (dirty) {
    event.preventDefault();
    event.returnValue = "";
  }
});
window.addEventListener("popstate", () => {
  dirty = false;
  void render();
});
for (const event of ["online", "offline"])
  window.addEventListener(event, () => {
    document.querySelector<HTMLElement>("#connection")!.hidden =
      navigator.onLine;
    if (navigator.onLine)
      toast("Connection restored. Your unsaved text is still available.");
  });
void render();
