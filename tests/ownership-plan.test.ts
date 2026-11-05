import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { application, type Config } from "../apps/api/server.ts";
import { account } from "../packages/authz/security.ts";
import { Store } from "../packages/storage/database.ts";

const password = "Ownership-Planning-Synthetic-Test-2026";

test("ownership plan: private drafts, immutable revisions, client projection, denial, upgrade and revocation", async () => {
  const directory = mkdtempSync(join(tmpdir(), "mizvo-ownership-"));
  const config: Config = {
    database: join(directory, "data.sqlite"),
    origin: "http://localhost",
    organization: "ownership-test",
  };
  const app = application(config);
  const founder = account(
    app.s, "Synthetic Owner", "owner@example.test", password, config.organization, "founder",
  );
  const client = account(
    app.s, "Synthetic Client", "client@example.test", password, null,
  );
  const other = account(
    app.s, "Other Organization", "other@example.test", password, null,
  );
  const engineer = account(
    app.s, "Synthetic Engineer", "engineer@example.test", password, null,
  );
  app.server.listen(0, "127.0.0.1");
  await once(app.server, "listening");
  const address = app.server.address();
  assert(address && typeof address !== "string");
  config.origin = `http://localhost:${address.port}`;

  type Identity = { cookie: string; csrf: string };
  async function request(route: string, method = "GET", payload?: unknown, identity?: Identity) {
    const r = await fetch(`http://127.0.0.1:${address.port}/api${route}`, {
      method,
      headers: {
        Origin: config.origin,
        Connection: "close",
        ...(payload ? { "Content-Type": "application/json" } : {}),
        ...(identity ? { Cookie: identity.cookie, "X-CSRF-Token": identity.csrf } : {}),
      },
      ...(payload ? { body: JSON.stringify(payload) } : {}),
    });
    return { status: r.status, data: await r.json() as any };
  }
  async function login(email: string): Promise<Identity> {
    const r = await fetch(`http://127.0.0.1:${address.port}/api/login`, {
      method: "POST",
      headers: { Origin: config.origin, "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    assert.equal(r.status, 200);
    const data = await r.json() as any;
    return { cookie: r.headers.get("set-cookie")!.split(";")[0]!, csrf: data.csrf };
  }
  try {
    const a = await login(founder.email);
    const b = await login(client.email);
    const c = await login(other.email);
    const eng = await login(engineer.email);
    const created = await request(
      "/projects", "POST", { name: "Synthetic ownership", purpose: "Prove a portable client handoff." }, a,
    );
    assert.equal(created.status, 201);
    const path = `/projects/${created.data.id}`;
    async function invite(email: string, role: "client" | "contributor", identity: Identity) {
      const invitation = await request(path + "/invitations", "POST", { email, role }, a);
      assert.equal(invitation.status, 201);
      assert.equal((await request("/invitations/accept", "POST", { token: invitation.data.token }, identity)).status, 200);
    }
    await invite(client.email, "client", b);
    await invite(engineer.email, "contributor", eng);

    const initial = await request("/space" + path, "GET", undefined, b);
    assert.equal(initial.status, 200);
    assert.equal(initial.data.ownership, null);
    assert.equal((await request("/space" + path + "/ownership-plan", "POST", {
      hosting_model: "mizvo_hosted", base_revision: 0,
    }, b)).status, 404);
    assert.equal((await request(path + "/ownership-plan", "POST", {
      hosting_model: "mizvo_hosted", base_revision: 0,
    }, eng)).status, 403);
    assert.equal((await request(path + "/ownership-plan", "POST", {
      hosting_model: "unknown_provider", base_revision: 0,
    }, a)).status, 400);

    const internal = await request(path + "/ownership-plan", "POST", {
      base_revision: 0,
      hosting_model: "undecided",
      infrastructure_owner: "PRIVATE_OWNER_ONLY",
      billing_owner: "PRIVATE_BILLING_ONLY",
      visibility: "internal",
    }, a);
    assert.equal(internal.status, 201);
    assert.equal(internal.data.revision, 1);
    assert.equal(internal.data.verification_status, "not_verified");
    const hidden = await request("/space" + path, "GET", undefined, b);
    assert.equal(hidden.data.ownership, null);
    assert(!JSON.stringify(hidden.data).includes("PRIVATE_OWNER_ONLY"));
    assert(!JSON.stringify(hidden.data).includes("PRIVATE_BILLING_ONLY"));

    const shared = await request(path + "/ownership-plan", "POST", {
      base_revision: 1,
      hosting_model: "client_owned_mizvo_operated",
      planned_domain: "demo.example.test",
      infrastructure_owner: "Example Organization",
      billing_owner: "Example Organization",
      operator: "Mizvo (proposed)",
      export_plan: "Provide portable files, database backup, and restore instructions.",
      support_scope: "Business hours only, once a service agreement is signed.",
      visibility: "client",
      verified: true,
    }, a);
    assert.equal(shared.status, 201);
    assert.equal(shared.data.revision, 2);
    assert.equal(shared.data.verification_status, "not_verified");

    const clientRoom = await request("/space" + path, "GET", undefined, b);
    assert.equal(clientRoom.data.ownership.revision, 2);
    assert.equal(clientRoom.data.ownership.hosting_model, "client_owned_mizvo_operated");
    assert.equal(clientRoom.data.ownership.verification_status, "not_verified");
    assert(!("actor_id" in clientRoom.data.ownership));
    assert(!("visibility" in clientRoom.data.ownership));
    assert(!("ownership_revisions" in clientRoom.data));
    assert(!JSON.stringify(clientRoom.data).includes("PRIVATE_OWNER_ONLY"));

    assert.equal((await request(path + "/ownership-plan", "POST", {
      base_revision: 1,
      hosting_model: "client_self_hosted",
    }, a)).status, 409);
    const revision3 = await request(path + "/ownership-plan", "POST", {
      base_revision: 2,
      hosting_model: "client_self_hosted",
      infrastructure_owner: "PRIVATE_UNPUBLISHED_HANDOFF",
      visibility: "internal",
    }, a);
    assert.equal(revision3.status, 201);
    const afterDraft = (await request("/space" + path, "GET", undefined, b)).data;
    assert.equal(afterDraft.ownership.revision, 2);
    assert(!JSON.stringify(afterDraft).includes("PRIVATE_UNPUBLISHED_HANDOFF"));
    const ownerRoom = (await request(path, "GET", undefined, a)).data;
    assert.equal(ownerRoom.ownership.revision, 3);
    assert.equal(ownerRoom.ownership_revisions.length, 3);
    assert.equal(ownerRoom.ownership_revisions[0].visibility, "internal");

    const unrelated = await request("/space" + path, "GET", undefined, c);
    assert.equal(unrelated.status, 404);
    assert.equal((await request(path + "/ownership-plan", "POST", {
      base_revision: 3,
      hosting_model: "client_self_hosted",
    }, c)).status, 404);

    const reopened = new Store(config.database);
    assert.equal(reopened.get(
      "SELECT COUNT(*) AS count FROM project_ownership_revisions WHERE project_id=?",
      created.data.id,
    )?.count, 3);
    assert.equal(reopened.get(
      "SELECT revision FROM project_ownership_revisions WHERE project_id=? AND visibility='client' ORDER BY revision DESC LIMIT 1",
      created.data.id,
    )?.revision, 2);
    reopened.close();

    assert.equal((await request(path + "/members/" + client.id, "PATCH", {
      revoke: true,
    }, a)).status, 200);
    assert.equal((await request("/space" + path, "GET", undefined, b)).status, 404);
  } finally {
    await new Promise<void>((done) => app.server.close(() => done()));
    app.s.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
