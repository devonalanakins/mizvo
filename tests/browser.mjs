import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { chromium } from "playwright";
import AxeBuilder from "@axe-core/playwright";
import { application } from "../apps/api/server.ts";
import { account } from "../packages/authz/security.ts";
const directory = await mkdtemp(join(tmpdir(), "mizvo-browser-"));
const config = {
  database: join(directory, "data.sqlite"),
  origin: "http://localhost",
  organization: "browser-tests",
  githubRepositories: ["devonalanakins/mizvo"],
};
const app = application(config),
  password = "Browser-only-test-password-2026";
const founder = account(
  app.s,
  "Test Founder",
  "founder@example.test",
  password,
  "browser-tests",
  "founder",
);
account(app.s, "Test Engineer", "engineer@example.test", password, null);
account(app.s, "Test Client", "client@example.test", password, null);
app.server.listen(0, "127.0.0.1");
await once(app.server, "listening");
config.origin = "http://localhost:" + app.server.address().port;
const browser = await chromium.launch({
  headless: true,
  args: ["--no-sandbox"],
});
const ownerContext = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  }),
  page = await ownerContext.newPage();
const errors = [],
  csp = [],
  checks = [];
function observe(page) {
  page.on("pageerror", (err) => errors.push(err.message));
  page.on("console", (msg) => {
    if (
      msg.type() === "error" &&
      msg.text().includes("Content Security Policy")
    )
      csp.push(msg.text());
  });
}
observe(page);
async function signIn(p, email, path = "/studio") {
  await p.goto(config.origin + path);
  await p.getByLabel("Email", { exact: true }).fill(email);
  await p.getByLabel("Password", { exact: true }).fill(password);
  await p.getByRole("button", { name: "Sign in", exact: true }).click();
  await p.getByRole("heading", { name: /Good/ }).waitFor();
}
async function api(p, path, method = "GET", body) {
  return p.evaluate(
    async ({ path, method, body }) => {
      const me = await (await fetch("/api/me")).json();
      const r = await fetch("/api" + path, {
        method,
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Token": me.csrf,
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      return { status: r.status, body: await r.json() };
    },
    { path, method, body },
  );
}
async function capture(p, name, width) {
  await p.setViewportSize({ width, height: 1000 });
  await p.evaluate(() => document.fonts.ready);
  await p.locator("#notice:empty").waitFor({ state: "attached" });
  await p.screenshot({
    path: `docs/evidence/${name}-${width}.png`,
    fullPage: true,
  });
  const overflow = await p.evaluate(
    () => document.documentElement.scrollWidth > innerWidth,
  );
  assert.equal(overflow, false, `${name} overflows at ${width}`);
  const issues = (
    await new AxeBuilder({ page: p })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
      .analyze()
  ).violations;
  checks.push({
    surface: name,
    width,
    overflow,
    axe_violations: issues.map((v) => ({
      id: v.id,
      impact: v.impact,
      nodes: v.nodes.map((x) => x.target),
    })),
  });
  assert.equal(issues.length, 0, JSON.stringify(checks.at(-1), null, 2));
}
try {
  await mkdir("docs/evidence", { recursive: true });
  await page.goto(config.origin + "/");
  await page
    .getByRole("heading", { name: "Make the improbable useful." })
    .waitFor();
  for (const w of [320, 390, 768, 1024, 1440, 1920])
    await capture(page, "discover", w);
  await page.goto(config.origin + "/inquiry");
  await page.getByLabel("Your name").fill("Synthetic Browser Inquirer");
  await page.getByLabel("Email address").fill("browser@example.test");
  await page
    .getByLabel("What should the software help you do?")
    .fill("Keep our work understandable and connected.");
  await page.getByLabel(/I agree/).check();
  await page.getByRole("button", { name: "Send inquiry" }).click();
  await page
    .getByRole("heading", { name: "Your inquiry is recorded." })
    .waitFor();
  await signIn(page, founder.email);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page
    .getByRole("button", { name: "Create project", exact: true })
    .click();
  await page
    .getByLabel("Project name", { exact: true })
    .fill("Mizvo verification project");
  await page
    .getByLabel("What should this project make possible?")
    .fill("A durable, understandable home for engineering decisions.");
  await page
    .getByLabel("Scope and boundaries (optional)")
    .fill("Synthetic browser verification; no client data.");
  await page
    .locator("dialog")
    .getByRole("button", { name: "Create project", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "Mizvo verification project" })
    .waitFor();
  const project = page.url().match(/projects\/([^?]+)/)[1];
  await page.locator("#record-kind").selectOption("note");
  await page.locator("#record-title").fill("Architecture context");
  await page
    .locator("#record-body")
    .fill('Persistent browser note: <img src=x onerror="window.xss=true">');
  await page.getByRole("button", { name: "Save to project" }).click();
  await page.getByRole("heading", { name: "Architecture context" }).waitFor();
  assert.equal(await page.locator(".record img").count(), 0);
  assert.equal(await page.evaluate(() => window.xss), undefined);
  await page.getByRole("button", { name: "Edit", exact: true }).first().click();
  await page
    .locator("dialog")
    .getByLabel("Title", { exact: true })
    .fill("Architecture context, revised");
  await page
    .locator("dialog")
    .locator('textarea[name="body"]')
    .fill("Edited and preserved after leaving the application.");
  await page.getByRole("button", { name: "Save new version" }).click();
  await page
    .getByRole("heading", { name: "Architecture context, revised" })
    .waitFor();
  await page.locator("#record-kind").selectOption("decision");
  await page.locator("#record-title").fill("Keep decisions explicit");
  await page
    .locator("#record-body")
    .fill("Proposals require a deliberate, attributable review.");
  await page.getByRole("button", { name: "Save to project" }).click();
  await page
    .getByRole("heading", { name: "Keep decisions explicit" })
    .waitFor();
  assert.equal(
    await page.locator(".record.decision .tag").textContent(),
    "proposed",
  );
  await page.reload();
  await page
    .getByRole("heading", { name: "Architecture context, revised" })
    .waitFor();
  assert.equal(await page.evaluate(() => window.xss), undefined);
  await page
    .getByRole("button", { name: "History", exact: true })
    .first()
    .click();
  await page.getByText("Version 2", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Close dialog" }).click();
  await page.getByRole("link", { name: "Plan", exact: true }).click();
  await page.getByRole("button", { name: "Add task" }).click();
  await page
    .getByLabel("Task", { exact: true })
    .fill("Verify persistent project context");
  await page
    .getByLabel("Milestone", { exact: true })
    .fill("Platform foundation");
  await page.getByRole("button", { name: "Save task" }).click();
  await page
    .getByRole("heading", { name: "Verify persistent project context" })
    .waitFor();
  await page.getByRole("link", { name: "Room", exact: true }).click();
  for (const w of [320, 390, 768, 1024, 1440, 1920])
    await capture(page, "room", w);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole("link", { name: "Code", exact: true }).click();
  if (process.env.MIZVO_VERIFY_GITHUB === "1") {
    await page
      .getByRole("button", { name: "Connect repository", exact: true })
      .click();
    await page
      .getByLabel("Repository (owner/name)")
      .fill("devonalanakins/mizvo");
    await page
      .locator("dialog")
      .getByRole("button", { name: "Connect repository", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Load branches, commits & pull requests" })
      .click();
    await page
      .locator("#github-evidence")
      .getByRole("heading", { name: "Branches", exact: true })
      .waitFor();
  }
  await capture(page, "workbench", 1440);
  await capture(page, "workbench", 390);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole("link", { name: "People", exact: true }).click();
  await page
    .getByRole("button", { name: "Manage Mizvo verification project" })
    .click();
  await page.getByRole("button", { name: "Create project invitation" }).click();
  await page.getByLabel("Recipient email").fill("engineer@example.test");
  await page
    .getByRole("button", { name: "Create invitation", exact: true })
    .click();
  const invitation = await page.locator("dialog textarea").inputValue();
  await page.getByRole("button", { name: "Close", exact: true }).click();
  const engineerContext = await browser.newContext(),
    engineer = await engineerContext.newPage();
  observe(engineer);
  await signIn(engineer, "engineer@example.test");
  await engineer
    .getByRole("button", { name: "Accept invitation", exact: true })
    .click();
  await engineer.getByLabel("Invitation token").fill(invitation);
  await engineer
    .locator("dialog")
    .getByRole("button", { name: "Accept invitation", exact: true })
    .click();
  await engineer
    .getByRole("heading", { name: "Mizvo verification project" })
    .waitFor();
  await engineer
    .getByRole("heading", { name: "Mizvo verification project" })
    .click();
  await engineer
    .locator("#record-title")
    .fill("Independent engineer contribution");
  await engineer
    .locator("#record-body")
    .fill("Written from an independently authenticated browser session.");
  await engineer.getByRole("button", { name: "Save to project" }).click();
  await engineer
    .getByRole("heading", { name: "Independent engineer contribution" })
    .waitFor();
  await page
    .getByRole("button", { name: "Manage Mizvo verification project" })
    .click();
  await capture(page, "people", 1440);
  await page.getByRole("button", { name: "Create project invitation" }).click();
  await page.getByLabel("Recipient email").fill("client@example.test");
  await page.getByLabel("Project role").selectOption("client");
  await page
    .getByRole("button", { name: "Create invitation", exact: true })
    .click();
  const clientInvite = await page.locator("dialog textarea").inputValue();
  await page.getByRole("button", { name: "Close", exact: true }).click();
  const accepted = await api(page, `/projects/${project}/records`, "POST", {
    kind: "note",
    title: "A shared project update",
    body: "The core workflow is ready for your feedback.",
    visibility: "client",
  });
  assert.equal(accepted.status, 201);
  const rel = await api(page, `/projects/${project}/releases`, "POST", {
    label: "Verification version 1",
    summary: "A specific version for your review.",
    commit_sha:
      process.env.MIZVO_VERIFY_GITHUB === "1"
        ? "b247d4e1c78af0057992ec2be9f68c13b755aaca"
        : "a".repeat(40),
    rollback: "Return to the prior reviewed artifact.",
    visibility: "client",
    demo_url: "https://example.test/authorized-demo",
  });
  assert.equal(rel.status, 201);
  const clientContext = await browser.newContext(),
    client = await clientContext.newPage();
  observe(client);
  await signIn(client, "client@example.test", "/space");
  await client
    .getByRole("button", { name: "Accept invitation", exact: true })
    .click();
  await client.getByLabel("Invitation token").fill(clientInvite);
  await client
    .locator("dialog")
    .getByRole("button", { name: "Accept invitation", exact: true })
    .click();
  await client.goto(config.origin + `/space/projects/${project}`);
  await client
    .getByRole("heading", { name: "Mizvo verification project" })
    .waitFor();
  assert.equal(
    await client.getByText("Architecture context, revised").count(),
    0,
  );
  await client
    .getByRole("heading", { name: "A shared project update" })
    .waitFor();
  for (const w of [320, 390, 768, 1024, 1440, 1920])
    await capture(client, "client-space", w);
  await client.getByRole("link", { name: "Feedback", exact: true }).click();
  await client.locator("#record-title").fill("Client feedback");
  await client
    .locator("#record-body")
    .fill("The project is understandable without technical training.");
  await client.getByRole("button", { name: "Save to project" }).click();
  await client.getByRole("heading", { name: "Client feedback" }).waitFor();
  await client
    .getByRole("link", { name: "Reviews & files", exact: true })
    .click();
  await client.getByRole("button", { name: "Review this version" }).click();
  await client.getByLabel("Your outcome").selectOption("approved");
  await client
    .getByLabel("What did you review?")
    .fill("Reviewed this exact synthetic version.");
  await client.getByRole("button", { name: "Record review" }).click();
  await client.getByText("Reviewed this exact synthetic version.").waitFor();
  await page.goto(config.origin + `/studio/projects/${project}?tab=plan`);
  await page
    .getByRole("heading", { name: "Verify persistent project context" })
    .waitFor();
  await capture(page, "plan", 1440);
  await page.goto(config.origin + `/studio/projects/${project}?tab=releases`);
  await page
    .getByRole("heading", { name: "Verification version 1", exact: true })
    .waitFor();
  if (process.env.MIZVO_VERIFY_GITHUB === "1") {
    await page
      .getByRole("button", { name: "Verify GitHub source", exact: true })
      .click();
    await page.getByText("GitHub source verified", { exact: true }).waitFor();
  } else
    await page
      .getByText("Source SHA is recorded but not verified against GitHub.", {
        exact: true,
      })
      .waitFor();
  await capture(page, "release-evidence", 1440);
  await capture(page, "release-evidence", 390);

  const revoke = await api(
    page,
    `/projects/${project}/members/` +
      app.s.get("SELECT id FROM users WHERE email='engineer@example.test'").id,
    "PATCH",
    { revoke: true },
  );
  assert.equal(revoke.status, 200);
  await engineer.reload();
  await engineer.getByRole("alert").waitFor();
  assert.match(
    await engineer.getByRole("alert").textContent(),
    /not found|unavailable/,
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(config.origin + `/studio/projects/${project}`);
  await page
    .getByRole("button", { name: "Project context", exact: true })
    .click();
  assert.equal(await page.locator("#context").isVisible(), true);
  await page.emulateMedia({ reducedMotion: "reduce" });
  const duration = await page
    .locator("button")
    .first()
    .evaluate((x) => getComputedStyle(x).transitionDuration);
  assert.equal(duration, "0s");
  await page
    .getByRole("button", { name: "Close project context", exact: true })
    .click();
  await page.evaluate(() => document.querySelector("main").focus());
  await page.keyboard.press("Control+k");
  await page
    .getByRole("heading", { name: "Find your project context" })
    .waitFor();
  assert.equal(
    await page
      .getByLabel("Search notes, decisions, and discussions")
      .evaluate((x) => x === document.activeElement),
    true,
  );
  await page
    .getByLabel("Search notes, decisions, and discussions")
    .fill("Architecture");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await page.locator("#search-results a").waitFor();
  await page.getByRole("button", { name: "Close dialog" }).click();
  await ownerContext.setOffline(true);
  await page.locator("#connection").waitFor({ state: "visible" });
  await ownerContext.setOffline(false);
  await page.locator("#connection").waitFor({ state: "hidden" });
  // Seed synthetic long histories to exercise real paging without replacing the UI transport.
  const old = app.domain.createRecord(founder.id, project, {
    kind: "note",
    title: "Oldest paginated note",
    body: "Older context remains retrievable.",
  });
  app.s.run(
    "UPDATE records SET created_at='2020-01-01T00:00:00.000Z' WHERE id=?",
    old.id,
  );
  for (let i = 0; i < 55; i++)
    app.domain.createRecord(founder.id, project, {
      kind: "note",
      title: `History note ${i}`,
      body: "Synthetic history for page boundaries.",
    });
  await page.goto(config.origin + `/studio/projects/${project}?tab=notes`);
  await page
    .getByRole("button", { name: "Load older records", exact: true })
    .waitFor();
  assert.equal(await page.locator(".record").count(), 50);
  assert.equal(
    await page
      .getByRole("heading", { name: "Oldest paginated note", exact: true })
      .count(),
    0,
  );
  await capture(page, "room-history", 390);
  await page.locator("#record-title").fill("Unsaved paging draft");
  await page
    .locator("#record-body")
    .fill("Loading older records must keep this text.");
  await page
    .getByRole("button", { name: "Load older records", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "Oldest paginated note", exact: true })
    .waitFor();
  assert.equal(
    await page.locator("#record-title").inputValue(),
    "Unsaved paging draft",
  );
  assert.equal(
    await page.locator("#record-body").inputValue(),
    "Loading older records must keep this text.",
  );
  await page
    .getByRole("button", { name: "Save to project", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "Unsaved paging draft", exact: true })
    .waitFor();
  await page.goto(
    config.origin + `/studio/projects/${project}?tab=notes#record-${old.id}`,
  );
  await page
    .getByRole("heading", { name: "Oldest paginated note", exact: true })
    .waitFor();
  await page
    .locator("#record-" + old.id)
    .getByRole("button", { name: "Edit", exact: true })
    .click();
  await page
    .locator("dialog")
    .getByLabel("Title", { exact: true })
    .fill("Older note edited through deep link");
  await page
    .getByRole("button", { name: "Save new version", exact: true })
    .click();
  await page
    .getByRole("heading", {
      name: "Older note edited through deep link",
      exact: true,
    })
    .waitFor();
  await page.reload();
  await page
    .getByRole("heading", {
      name: "Older note edited through deep link",
      exact: true,
    })
    .waitFor();
  const clientId = app.s.get(
    "SELECT id FROM users WHERE email='client@example.test'",
  ).id;
  const feedback = app.domain.createRecord(clientId, project, {
    kind: "feedback",
    title: "Oldest client feedback",
    body: "Private client scope.",
  });
  app.s.run(
    "UPDATE records SET created_at='2020-01-01T00:00:00.000Z' WHERE id=?",
    feedback.id,
  );
  for (let i = 0; i < 55; i++)
    app.domain.createRecord(clientId, project, {
      kind: "feedback",
      title: `Feedback history ${i}`,
      body: "Synthetic client history.",
    });
  await client.goto(config.origin + `/space/projects/${project}`);
  await client
    .getByRole("heading", { name: "A shared project update", exact: true })
    .waitFor();
  assert.equal(
    await client.getByText("History note 0", { exact: true }).count(),
    0,
  );
  await client.goto(config.origin + `/space/projects/${project}?tab=feedback`);
  await client
    .getByRole("button", { name: "Load older records", exact: true })
    .waitFor();
  assert.equal(await client.locator(".record").count(), 50);
  await client.locator("#record-title").fill("Client paging draft");
  await client
    .locator("#record-body")
    .fill("Keep this feedback while reading history.");
  await client
    .getByRole("button", { name: "Load older records", exact: true })
    .click();
  await client
    .getByRole("heading", { name: "Oldest client feedback", exact: true })
    .waitFor();
  assert.equal(
    await client.locator("#record-title").inputValue(),
    "Client paging draft",
  );
  assert.deepEqual(errors, []);
  assert.deepEqual(csp, []);
  await writeFile(
    "docs/evidence/browser-results.json",
    JSON.stringify(
      {
        observed_at: new Date().toISOString(),
        environment: "local Node/SQLite + Chromium; synthetic identities only",
        github_live_browser: process.env.MIZVO_VERIFY_GITHUB === "1",
        checks,
        page_errors: errors,
        csp_errors: csp,
        flows: [
          "public inquiry",
          "founder authentication",
          "project creation",
          "note editing and reload",
          "proposed decisions",
          "task creation",
          "two browser identities",
          "invitation acceptance",
          "client isolation",
          "feedback",
          "version-specific client approval",
          "revocation with active session",
          "command keyboard focus",
          "offline feedback",
          "reduced motion",
          "Room and client pagination with unsaved drafts",
          "older-record deep links, editing and reload",
        ],
      },
      null,
      2,
    ),
  );
  console.log(
    JSON.stringify({
      screenshots: checks.length,
      axe_violations: 0,
      page_errors: errors.length,
      flows: "passed",
    }),
  );
} catch (error) {
  await mkdir("test-results", { recursive: true });
  await page.screenshot({ path: "test-results/failure.png", fullPage: true });
  await writeFile("test-results/failure.html", await page.content());
  throw error;
} finally {
  await browser.close();
  await new Promise((r) => app.server.close(r));
  app.s.close();
  await rm(directory, { recursive: true, force: true });
}
