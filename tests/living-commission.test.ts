import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { application, type Config } from "../apps/api/server.ts";
import { account } from "../packages/authz/security.ts";
import { Store } from "../packages/storage/database.ts";

const password = "Living-Commission-Test-Password-2026";

test("Living Brief: versioned customer projection, exact decision binding, denial and persistence", async () => {
  const directory = mkdtempSync(join(tmpdir(), "mizvo-brief-"));
  const config: Config = {
    database: join(directory, "data.sqlite"),
    origin: "http://localhost",
    organization: "brief-example",
  };
  const app = application(config);
  const founder = account(
    app.s,
    "Example Owner",
    "owner@example.test",
    password,
    config.organization,
    "founder",
  );
  const client = account(
    app.s,
    "Example Client",
    "client@example.test",
    password,
    null,
  );
  const other = account(
    app.s,
    "Other Client",
    "other@example.test",
    password,
    null,
  );
  const engineer = account(
    app.s,
    "Example Engineer",
    "engineer@example.test",
    password,
    null,
  );
  app.server.listen(0, "127.0.0.1");
  await once(app.server, "listening");
  const address = app.server.address();
  assert(address && typeof address !== "string");
  config.origin = `http://localhost:${address.port}`;

  type Identity = { cookie: string; csrf: string };
  async function request(
    route: string,
    method = "GET",
    payload?: unknown,
    identity?: Identity,
  ) {
    const result = await fetch(`http://127.0.0.1:${address.port}/api${route}`, {
      method,
      headers: {
        Origin: config.origin,
        Connection: "close",
        ...(payload ? { "Content-Type": "application/json" } : {}),
        ...(identity
          ? { Cookie: identity.cookie, "X-CSRF-Token": identity.csrf }
          : {}),
      },
      ...(payload ? { body: JSON.stringify(payload) } : {}),
    });
    return {
      status: result.status,
      data: await result.json() as any,
    };
  }
  async function login(email: string): Promise<Identity> {
    const result = await fetch(`http://127.0.0.1:${address.port}/api/login`, {
      method: "POST",
      headers: {
        Origin: config.origin,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ email, password }),
    });
    assert.equal(result.status, 200);
    const value = await result.json() as any;
    return {
      cookie: result.headers.get("set-cookie")!.split(";")[0]!,
      csrf: value.csrf,
    };
  }
  async function invite(
    project: string,
    email: string,
    role: "client" | "contributor",
    owner: Identity,
    invitee: Identity,
  ) {
    const invitation = await request(
      `/projects/${project}/invitations`,
      "POST",
      { email, role },
      owner,
    );
    assert.equal(invitation.status, 201);
    const accepted = await request(
      "/invitations/accept",
      "POST",
      { token: invitation.data.token },
      invitee,
    );
    assert.equal(accepted.status, 200);
  }
  try {
    const a = await login(founder.email);
    const b = await login(client.email);
    const c = await login(other.email);
    const e = await login(engineer.email);
    const projectResponse = await request(
      "/projects",
      "POST",
      {
        name: "Original synthetic commission",
        purpose: "Show the customer why the work matters.",
      },
      a,
    );
    assert.equal(projectResponse.status, 201);
    const project = projectResponse.data.id as string;
    const path = `/projects/${project}`;
    await invite(project, client.email, "client", a, b);
    await invite(project, other.email, "client", a, c);
    await invite(project, engineer.email, "contributor", a, e);

    assert.equal((await request("/space" + path, "GET", undefined, b)).data.brief, null);
    assert.equal(
      (await request("/space" + path + "/brief", "POST", {
        problem: "Client alteration",
      }, b)).status,
      404,
    );
    assert.equal(
      (await request(path + "/brief", "POST", {
        version: 0,
        problem: "Engineer alteration",
        audience: "Anyone",
        outcome: "No",
      }, e)).status,
      403,
    );
    const privateDraft = await request(path + "/brief", "POST", {
      version: 0,
      problem: "PRIVATE_DISCOVERY_NOTE",
      audience: "Internal only",
      outcome: "Do not share",
      visibility: "internal",
    }, a);
    assert.equal(privateDraft.status, 201);
    assert.equal(privateDraft.data.version, 1);
    const clientBefore = await request("/space" + path, "GET", undefined, b);
    assert.equal(clientBefore.data.brief, null);
    assert(!JSON.stringify(clientBefore.data).includes("PRIVATE_DISCOVERY_NOTE"));

    const shared = await request(path + "/brief", "POST", {
      version: 1,
      problem: "The client cannot review useful work on a phone.",
      audience: "Nontechnical client and facilitator",
      outcome: "The client can preview and approve a specific working version.",
      next_step: "Review the mobile preview.",
      exclusions: "No real employee feedback or regulated data.",
      visibility: "client",
    }, a);
    assert.equal(shared.status, 201);
    assert.equal(shared.data.version, 2);
    const visible = (await request("/space" + path, "GET", undefined, b)).data;
    assert.equal(visible.brief.version, 2);
    assert.equal(visible.brief.outcome, "The client can preview and approve a specific working version.");
    assert(!JSON.stringify(visible).includes("PRIVATE_DISCOVERY_NOTE"));
    assert(!("actor_id" in visible.brief));
    assert(!("visibility" in visible.brief));
    assert.equal((await request(path, "GET", undefined, a)).data.shared_brief_version, 2);
    assert.equal((await request(path + "/brief/history", "GET", undefined, a)).data.length, 2);
    assert.equal((await request("/space" + path + "/brief/history", "GET", undefined, b)).status, 404);
    assert.equal((await request(path + "/brief/history", "GET", undefined, b)).status, 404);

    assert.equal((await request(path + "/brief", "POST", {
      version: 1, problem: "Stale", audience: "Client", outcome: "Not allowed",
    }, a)).status, 409);

    const preview = await request(path + "/releases", "POST", {
      label: "Mobile briefing preview v1",
      summary: "Synthetic, client-visible demonstration.",
      commit_sha: "a".repeat(40),
      rollback: "Return to the prior version.",
      demo_url: "https://example.test/approved-preview",
      visibility: "client",
    }, a);
    assert.equal(preview.status, 201);
    const internalPreview = await request(path + "/releases", "POST", {
      label: "Internal only",
      summary: "Never for client decisions.",
      commit_sha: "b".repeat(40),
      rollback: "No change",
      visibility: "internal",
    }, a);
    assert.equal(internalPreview.status, 201);
    const requestData = {
      client_id: client.id,
      title: "Review the mobile flow",
      body: "Does the approved preview match the shared brief?",
      brief_version: 2,
      preview_release_id: preview.data.id,
    };
    assert.equal((await request(path + "/client-decisions", "POST", {
      ...requestData, brief_version: 1,
    }, a)).status, 409);
    assert.equal((await request(path + "/client-decisions", "POST", {
      ...requestData, preview_release_id: internalPreview.data.id,
    }, a)).status, 400);
    const linked = await request(path + "/client-decisions", "POST", requestData, a);
    assert.equal(linked.status, 201);
    const decisions = (await request("/space" + path, "GET", undefined, b)).data.client_decisions;
    assert.equal(decisions.length, 1);
    assert.equal(decisions[0].brief_version, 2);
    assert.equal(decisions[0].preview_release_id, preview.data.id);
    assert(!JSON.stringify(decisions).includes("Internal only"));
    const response = `/space${path}/client-decisions/${linked.data.id}/respond`;
    assert.equal((await request(response, "POST", {
      version: 1, outcome: "accepted", comment: "Wrong recipient",
    }, c)).status, 404);

    const updated = await request(path + "/brief", "POST", {
      version: 2,
      problem: "We need an even simpler starting experience.",
      audience: "Nontechnical client",
      outcome: "One-tap preview and a clear decision.",
      visibility: "client",
    }, a);
    assert.equal(updated.status, 201);
    assert.equal(updated.data.version, 3);
    assert.equal((await request(response, "POST", {
      version: 1, outcome: "accepted", comment: "Stale brief",
    }, b)).status, 409);

    const current = await request(path + "/client-decisions", "POST", {
      ...requestData,
      brief_version: 3,
      title: "Review the revised brief",
    }, a);
    assert.equal(current.status, 201);
    const currentResponse = `/space${path}/client-decisions/${current.data.id}/respond`;
    const draft = await request(path + "/brief", "POST", {
      version: 3,
      problem: "PRIVATE_NEW_DRAFT",
      audience: "Internal",
      outcome: "Unpublished",
      visibility: "internal",
    }, a);
    assert.equal(draft.status, 201);
    assert.equal(draft.data.version, 4);
    const clientAfterDraft = (await request("/space" + path, "GET", undefined, b)).data;
    assert.equal(clientAfterDraft.brief.version, 3);
    assert(!JSON.stringify(clientAfterDraft).includes("PRIVATE_NEW_DRAFT"));
    assert.equal((await request(currentResponse, "POST", {
      version: 1, outcome: "accepted", comment: "Understood revised flow",
    }, b)).status, 200);
    assert.equal((await request(currentResponse, "POST", {
      version: 1, outcome: "accepted", comment: "Duplicate",
    }, b)).status, 409);
    const unbound = await request(path + "/client-decisions", "POST", {
      client_id: client.id,
      title: "Legacy-style decision",
      body: "No brief binding required.",
    }, a);
    assert.equal(unbound.status, 201);
    assert.equal((await request(
      `/space${path}/client-decisions/${unbound.data.id}/respond`,
      "POST",
      { version: 1, outcome: "changes_requested", comment: "Still works." },
      b,
    )).status, 200);

    const otherProject = await request("/projects", "POST", {
      name: "Isolated commission", purpose: "Another customer's work.",
    }, a);
    assert.equal(otherProject.status, 201);
    assert.equal(
      (await request(`/projects/${otherProject.data.id}/brief/history`, "GET", undefined, b)).status,
      404,
    );
    assert.equal(
      (await request(`/projects/${otherProject.data.id}/client-decisions`, "POST", {
        ...requestData,
        client_id: client.id,
      }, a)).status,
      400,
    );

    const upgraded = new Store(config.database);
    assert.equal(
      upgraded.get(
        "SELECT COUNT(*) AS count FROM project_brief_revisions WHERE project_id=?",
        project,
      )?.count,
      4,
    );
    assert.equal(upgraded.get(
      "SELECT COUNT(*) AS count FROM client_decision_responses WHERE request_id=?",
      current.data.id,
    )?.count, 1);
    upgraded.close();
  } finally {
    await new Promise<void>((done) => app.server.close(() => done()));
    app.s.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
