import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { application, type Config } from "../apps/api/server.ts";
import { account } from "../packages/authz/security.ts";
import { Store } from "../packages/storage/database.ts";
import { GitHub } from "../apps/api/github.ts";
const password = "Independent-Test-Password-2026";
async function fixture(github?: GitHub) {
  const dir = mkdtempSync(join(tmpdir(), "mizvo-"));
  const config: Config = {
    database: join(dir, "data.sqlite"),
    origin: "http://localhost",
    organization: "test-org",
    githubRepositories: ["devonalanakins/mizvo"],
  };
  const app = application(config, { github });
  const users = {
    owner: account(
      app.s,
      "Test Founder",
      "founder@example.test",
      password,
      "test-org",
      "founder",
    ),
    contributor: account(
      app.s,
      "Test Engineer",
      "engineer@example.test",
      password,
      null,
    ),
    client: account(
      app.s,
      "Test Client",
      "client@example.test",
      password,
      null,
    ),
    other: account(app.s, "Other Client", "other@example.test", password, null),
  };
  app.server.listen(0, "127.0.0.1");
  await once(app.server, "listening");
  const address = app.server.address();
  assert(address && typeof address !== "string");
  const port = address.port;
  config.origin = `http://localhost:${port}`;
  type Session = { cookie: string; csrf: string };
  async function request(
    path: string,
    method = "GET",
    body?: unknown,
    session?: Session,
    overrides: Record<string, string> = {},
  ) {
    const r = await fetch(`http://127.0.0.1:${port}/api${path}`, {
      method,
      headers: {
        Origin: config.origin,
        Connection: "close",
        ...(body ? { "Content-Type": "application/json" } : {}),
        ...(session
          ? { Cookie: session.cookie, "X-CSRF-Token": session.csrf }
          : {}),
        ...overrides,
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const value = await r.json();
    return { status: r.status, value, headers: r.headers };
  }
  async function login(address: string) {
    const r = await request("/login", "POST", { email: address, password });
    assert.equal(r.status, 200, JSON.stringify(r.value));
    return {
      cookie: r.headers.get("set-cookie")!.split(";")[0]!,
      csrf: r.value.csrf,
    };
  }
  return {
    app,
    config,
    dir,
    users,
    request,
    login,
    async stop() {
      await new Promise<void>((r) => app.server.close(() => r()));
      app.s.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
test("real HTTP Room workflow survives restart; proposals, history, concurrency and authorization", async () => {
  const f = await fixture();
  try {
    const founder = await f.login(f.users.owner.email),
      unrelated = await f.login(f.users.other.email);
    const p = await f.request(
      "/projects",
      "POST",
      {
        name: "Persistent room",
        purpose: "Recover real project context after leaving.",
        scope: "Private test only.",
      },
      founder,
    );
    assert.equal(p.status, 201);
    const path = "/projects/" + p.value.id;
    const note = await f.request(
      path + "/records",
      "POST",
      {
        kind: "note",
        title: "Architecture",
        body: "<script>alert(1)</script>",
      },
      founder,
    );
    assert.equal(note.status, 201);
    let result = await f.request(path, "GET", undefined, founder);
    assert.equal(result.value.records[0].body, "<script>alert(1)</script>");
    assert.equal(result.value.records[0].version, 1);
    assert.equal(
      (await f.request(path, "GET", undefined, unrelated)).status,
      404,
    );
    assert.equal(
      (
        await f.request(
          path + "/records",
          "POST",
          { kind: "note", title: "No", body: "No" },
          unrelated,
        )
      ).status,
      404,
    );
    assert.equal((await f.request(path, "GET")).status, 401);
    assert.equal(
      (
        await f.request(
          path + "/records",
          "POST",
          { kind: "note", title: "No", body: "No" },
          founder,
          { "X-CSRF-Token": "wrong" },
        )
      ).status,
      403,
    );
    assert.equal(
      (
        await f.request(
          path + "/records",
          "POST",
          { kind: "note", title: "No", body: "No" },
          founder,
          { Origin: "https://evil.test" },
        )
      ).status,
      403,
    );
    const edit = await f.request(
      path + "/records/" + note.value.id,
      "PATCH",
      { title: "Architecture v2", body: "Updated context", version: 1 },
      founder,
    );
    assert.equal(edit.status, 200);
    assert.equal(
      (
        await f.request(
          path + "/records/" + note.value.id,
          "PATCH",
          { title: "Stale", body: "Overwritten?", version: 1 },
          founder,
        )
      ).status,
      409,
    );
    const decision = await f.request(
      path + "/records",
      "POST",
      {
        kind: "decision",
        title: "Use portable SQL",
        body: "A proposed direction.",
        state: "approved",
      },
      founder,
    );
    assert.equal(decision.status, 201);
    result = await f.request(path, "GET", undefined, founder);
    assert.equal(
      result.value.records.find((x: any) => x.id === decision.value.id).state,
      "proposed",
    );
    assert.equal(
      (
        await f.request(
          path + "/records/" + decision.value.id + "/decision",
          "POST",
          { state: "approved", version: 1 },
          founder,
        )
      ).status,
      200,
    );
    assert.equal(
      (
        await f.request(
          path + "/records/" + decision.value.id + "/decision",
          "POST",
          { state: "approved", version: 1 },
          founder,
        )
      ).status,
      409,
    );
    assert.equal(
      (
        await f.request(
          path + "/records/" + decision.value.id,
          "PATCH",
          { title: "Changed proposal", body: "Changed terms", version: 2 },
          founder,
        )
      ).status,
      200,
    );
    assert.equal(
      (await f.request(path, "GET", undefined, founder)).value.records.find(
        (x: any) => x.id === decision.value.id,
      ).state,
      "proposed",
    );
    const history = await f.request(
      path + "/records/" + decision.value.id + "/history",
      "GET",
      undefined,
      founder,
    );
    assert.deepEqual(
      history.value.map((x: any) => x.state),
      ["proposed", "approved", "proposed"],
    );
    const otherStore = new Store(f.config.database);
    assert.equal(
      otherStore.get("SELECT title FROM records WHERE id=?", note.value.id)
        ?.title,
      "Architecture v2",
    );
    otherStore.close();
    await new Promise<void>((r) => f.app.server.close(() => r()));
    f.app.s.close();
    const restarted = application(f.config);
    restarted.server.listen(Number(new URL(f.config.origin).port), "127.0.0.1");
    await once(restarted.server, "listening");
    const r = await f.request(path, "GET", undefined, founder);
    assert.equal(r.status, 200);
    assert.equal(r.value.records.length, 2);
    await new Promise<void>((r) => restarted.server.close(() => r()));
    restarted.s.close();
    rmSync(f.dir, { recursive: true, force: true });
  } catch (error) {
    await f.stop().catch(() => {});
    throw error;
  }
});
test("independent accounts: scoped invitation, expiry, replay, role changes and immediate revocation", async () => {
  const f = await fixture();
  try {
    const a = await f.login(f.users.owner.email),
      b = await f.login(f.users.contributor.email),
      wrong = await f.login(f.users.other.email);
    const p = (
      await f.request(
        "/projects",
        "POST",
        { name: "Shared", purpose: "Work together asynchronously." },
        a,
      )
    ).value.id;
    const q = (
      await f.request(
        "/projects",
        "POST",
        { name: "Separate", purpose: "Never cross this boundary." },
        a,
      )
    ).value.id;
    const path = "/projects/" + p;
    const inv = await f.request(
      path + "/invitations",
      "POST",
      { email: f.users.contributor.email, role: "contributor" },
      a,
    );
    assert.equal(inv.status, 201);
    assert.equal(
      (
        await f.request(
          "/invitations/accept",
          "POST",
          { token: inv.value.token },
          wrong,
        )
      ).status,
      404,
    );
    assert.equal(
      (
        await f.request(
          "/invitations/accept",
          "POST",
          { token: inv.value.token },
          b,
        )
      ).status,
      200,
    );
    assert.equal(
      (
        await f.request(
          "/invitations/accept",
          "POST",
          { token: inv.value.token },
          b,
        )
      ).status,
      404,
    );
    assert.equal((await f.request(path, "GET", undefined, b)).status, 200);
    assert.equal(
      (await f.request("/projects/" + q, "GET", undefined, b)).status,
      404,
    );
    assert.equal(
      (
        await f.request(
          path + "/invitations",
          "POST",
          { email: f.users.other.email, role: "contributor" },
          b,
        )
      ).status,
      403,
    );
    assert.equal(
      (
        await f.request(
          path + "/records",
          "POST",
          {
            kind: "note",
            title: "Engineer context",
            body: "Independent authenticated contribution.",
          },
          b,
        )
      ).status,
      201,
    );
    assert.equal(
      (
        await f.request(
          path + "/members/" + f.users.contributor.id,
          "PATCH",
          { role: "client" },
          a,
        )
      ).status,
      200,
    );
    assert.equal((await f.request(path, "GET", undefined, b)).status, 404);
    assert.equal(
      (await f.request("/space" + path, "GET", undefined, b)).status,
      200,
    );
    assert.equal(
      (
        await f.request(
          path + "/members/" + f.users.contributor.id,
          "PATCH",
          { role: "contributor" },
          a,
        )
      ).status,
      200,
    );
    assert.equal(
      (
        await f.request(
          path + "/members/" + f.users.contributor.id,
          "PATCH",
          { revoke: true },
          a,
        )
      ).status,
      200,
    );
    assert.equal((await f.request(path, "GET", undefined, b)).status, 404);
    assert.equal(
      (await f.request("/search?q=Engineer", "GET", undefined, b)).value.length,
      0,
    );
    const expired = (
      await f.request(
        path + "/invitations",
        "POST",
        { email: f.users.contributor.email, role: "contributor" },
        a,
      )
    ).value;
    f.app.s.run(
      "UPDATE invitations SET expires_at='2000-01-01T00:00:00Z' WHERE id=?",
      expired.id,
    );
    assert.equal(
      (
        await f.request(
          "/invitations/accept",
          "POST",
          { token: expired.token },
          b,
        )
      ).status,
      404,
    );
    const revoked = (
      await f.request(
        path + "/invitations",
        "POST",
        { email: f.users.other.email, role: "client" },
        a,
      )
    ).value;
    assert.equal(
      (
        await f.request(
          path + "/invitations/" + revoked.id + "/revoke",
          "POST",
          {},
          a,
        )
      ).status,
      200,
    );
    assert.equal(
      (
        await f.request(
          "/invitations/accept",
          "POST",
          { token: revoked.token },
          wrong,
        )
      ).status,
      404,
    );
    const list = await f.request(path + "/invitations", "GET", undefined, a);
    assert(!JSON.stringify(list.value).includes("token_hash"));
    assert(!JSON.stringify(list.value).includes(inv.value.token));
  } finally {
    await f.stop();
  }
});
test("Client Space is a projection: no internal records, history, engineering, tasks or cross-client access", async () => {
  const f = await fixture();
  try {
    const a = await f.login(f.users.owner.email),
      b = await f.login(f.users.client.email),
      other = await f.login(f.users.other.email);
    const p = (
        await f.request(
          "/projects",
          "POST",
          { name: "Client project", purpose: "Understand your project." },
          a,
        )
      ).value.id,
      path = "/projects/" + p;
    const inv = (
      await f.request(
        path + "/invitations",
        "POST",
        { email: f.users.client.email, role: "client" },
        a,
      )
    ).value;
    await f.request("/invitations/accept", "POST", { token: inv.token }, b);
    const secret = (
      await f.request(
        path + "/records",
        "POST",
        { kind: "note", title: "INTERNAL_SECRET", body: "Never exposed" },
        a,
      )
    ).value;
    await f.request(
      path + "/records",
      "POST",
      {
        kind: "note",
        title: "Shared scope",
        body: "Understandable update",
        visibility: "client",
      },
      a,
    );
    await f.request(
      path + "/tasks",
      "POST",
      { title: "PRIVATE_TASK", milestone: "Internal", visibility: "internal" },
      a,
    );
    await f.request(
      path + "/tasks",
      "POST",
      {
        title: "Public milestone",
        milestone: "Build",
        visibility: "client",
        evidence: "PRIVATE_ENGINEERING_EVIDENCE",
      },
      a,
    );
    const r = await f.request("/space" + path, "GET", undefined, b);
    assert.equal(r.status, 200);
    const encoded = JSON.stringify(r.value);
    assert(!encoded.includes("INTERNAL_SECRET"));
    assert(!encoded.includes("PRIVATE_TASK"));
    assert(!encoded.includes("PRIVATE_ENGINEERING_EVIDENCE"));
    assert(!encoded.includes("audit"));
    assert(!encoded.includes("owner_id"));
    assert.equal(
      (await f.request("/space" + path, "GET", undefined, other)).status,
      404,
    );
    assert.equal(
      (await f.request(path + "/github", "GET", undefined, b)).status,
      404,
    );
    assert.equal(
      (
        await f.request(
          "/space" + path + "/records/" + secret.id + "/history",
          "GET",
          undefined,
          b,
        )
      ).status,
      404,
    );
    assert.equal(
      (
        await f.request(
          "/space" + path + "/records",
          "POST",
          {
            kind: "decision",
            title: "Client injected approval",
            body: "Denied",
          },
          b,
        )
      ).status,
      403,
    );
    assert.equal(
      (
        await f.request(
          "/space" + path + "/records",
          "POST",
          {
            kind: "feedback",
            title: "Feedback",
            body: "A legitimate client comment.",
            visibility: "internal",
          },
          b,
        )
      ).status,
      201,
    );
    assert.equal(
      (await f.request("/pipeline", "GET", undefined, b)).status,
      403,
    );
    assert.equal(
      (await f.request("/search?q=INTERNAL_SECRET", "GET", undefined, b)).value
        .length,
      0,
    );
  } finally {
    await f.stop();
  }
});
test("task dependencies, completion evidence, version checks and immutable release reviews", async () => {
  const f = await fixture();
  try {
    const a = await f.login(f.users.owner.email),
      b = await f.login(f.users.contributor.email);
    const p = (
        await f.request(
          "/projects",
          "POST",
          { name: "Quality", purpose: "Evidence-backed delivery." },
          a,
        )
      ).value.id,
      path = "/projects/" + p;
    const invite = (
      await f.request(
        path + "/invitations",
        "POST",
        { email: f.users.contributor.email, role: "contributor" },
        a,
      )
    ).value;
    await f.request("/invitations/accept", "POST", { token: invite.token }, b);
    assert.equal(
      (
        await f.request(
          path + "/tasks",
          "POST",
          { title: "Fake completion", status: "done" },
          a,
        )
      ).status,
      400,
    );
    await f.request(
      path + "/tasks",
      "POST",
      { title: "First", milestone: "Foundation" },
      a,
    );
    let tasks = (await f.request(path, "GET", undefined, a)).value.tasks;
    const first = tasks[0];
    await f.request(
      path + "/tasks",
      "POST",
      { title: "Second", depends_on: first.id },
      a,
    );
    tasks = (await f.request(path, "GET", undefined, a)).value.tasks;
    const second = tasks.find((x: any) => x.title === "Second");
    assert.equal(
      (
        await f.request(
          path + "/tasks/" + first.id,
          "PATCH",
          { ...first, depends_on: second.id },
          a,
        )
      ).status,
      400,
    );
    assert.equal(
      (
        await f.request(
          path + "/tasks/" + second.id,
          "PATCH",
          { ...second, status: "done", evidence: "Actual evidence" },
          a,
        )
      ).status,
      409,
    );
    assert.equal(
      (
        await f.request(
          path + "/tasks/" + first.id,
          "PATCH",
          {
            ...first,
            status: "done",
            evidence: "Claimed",
            review_required: true,
          },
          b,
        )
      ).status,
      403,
    );
    assert.equal(
      (
        await f.request(
          path + "/tasks/" + first.id,
          "PATCH",
          {
            ...first,
            status: "done",
            evidence: "Bypass?",
            review_required: false,
          },
          b,
        )
      ).status,
      403,
    );
    assert.equal(
      (
        await f.request(
          path + "/tasks/" + first.id,
          "PATCH",
          { ...first, status: "done", evidence: "Reviewed command output" },
          a,
        )
      ).status,
      200,
    );
    const release = {
      label: "v1",
      summary: "A specific immutable version",
      commit_sha: "a".repeat(40),
      rollback: "Restore previous artifact",
      visibility: "client",
      demo_url: "https://example.test/demo",
    };
    assert.equal(
      (
        await f.request(
          path + "/releases",
          "POST",
          { ...release, demo_url: "javascript:alert(1)" },
          a,
        )
      ).status,
      400,
    );
    const r = await f.request(path + "/releases", "POST", release, a);
    assert.equal(r.status, 201);
    assert.equal(
      (
        await f.request(
          path + "/releases/" + r.value.id + "/review",
          "POST",
          { outcome: "approved", comment: "Self-review" },
          a,
        )
      ).status,
      403,
    );
    assert.equal(
      (
        await f.request(
          path + "/releases/" + r.value.id + "/review",
          "POST",
          { outcome: "approved", comment: "Reviewed exact version" },
          b,
        )
      ).status,
      200,
    );
    assert.equal(
      (
        await f.request(
          path + "/releases/" + r.value.id + "/review",
          "POST",
          { outcome: "changes_requested", comment: "Overwrite?" },
          b,
        )
      ).status,
      409,
    );
  } finally {
    await f.stop();
  }
});
test("public inquiry validates consent, stays private, and connects to project lifecycle", async () => {
  const f = await fixture();
  try {
    const a = await f.login(f.users.owner.email),
      other = await f.login(f.users.other.email),
      b = {
        name: "Synthetic Inquirer",
        email: "inquiry@example.test",
        goal: "Build a useful independent application.",
        details: "Synthetic test only.",
      };
    assert.equal((await f.request("/inquiries", "POST", b)).status, 400);
    assert.equal(
      (
        await f.request("/inquiries", "POST", {
          ...b,
          consent: true,
          website: "spam",
        })
      ).status,
      400,
    );
    const inquiry = await f.request("/inquiries", "POST", {
      ...b,
      consent: true,
    });
    assert.equal(inquiry.status, 201);
    assert.equal(
      (await f.request("/pipeline", "GET", undefined, other)).status,
      403,
    );
    assert.equal(
      (
        await f.request(
          "/pipeline/" + inquiry.value.id + "/project",
          "POST",
          { name: "New project" },
          a,
        )
      ).status,
      409,
    );
    assert.equal(
      (
        await f.request(
          "/pipeline/" + inquiry.value.id,
          "PATCH",
          { status: "approved", version: 1 },
          a,
        )
      ).status,
      200,
    );
    const p = await f.request(
      "/pipeline/" + inquiry.value.id + "/project",
      "POST",
      { name: "From inquiry" },
      a,
    );
    assert.equal(p.status, 201);
    assert.equal(p.value.purpose, b.goal);
    assert.equal(
      (
        await f.request(
          "/pipeline/" + inquiry.value.id + "/project",
          "POST",
          { name: "Duplicate" },
          a,
        )
      ).status,
      409,
    );
  } finally {
    await f.stop();
  }
});
test("session controls and organization isolation are enforced by the server", async () => {
  const f = await fixture();
  try {
    const a = await f.login(f.users.owner.email),
      second = await f.login(f.users.owner.email);
    assert.equal(
      (await f.request("/sessions", "GET", undefined, a)).value.length,
      2,
    );
    await f.request("/sessions/revoke", "POST", {}, a);
    assert.equal(
      (await f.request("/me", "GET", undefined, second)).status,
      401,
    );
    const p = (
      await f.request(
        "/projects",
        "POST",
        { name: "Foreign org", purpose: "Must stay outside this instance." },
        a,
      )
    ).value.id;
    f.app.s.run("INSERT INTO organizations VALUES ('foreign','Other')");
    f.app.s.run("UPDATE projects SET organization_id='foreign' WHERE id=?", p);
    assert.equal(
      (await f.request("/projects/" + p, "GET", undefined, a)).status,
      404,
    );
    assert.equal(
      (await f.request("/projects", "GET", undefined, a)).value.length,
      0,
    );
    await f.request("/logout", "POST", {}, a);
    assert.equal((await f.request("/me", "GET", undefined, a)).status, 401);
  } finally {
    await f.stop();
  }
});
test("GitHub adapter contract: allowlist, exact endpoints, authentic upstream status and failures (mock transport)", async () => {
  const calls: string[] = [];
  const transport = (async (input: any) => {
    calls.push(String(input));
    if (String(input).includes("/branches"))
      return new Response(
        JSON.stringify([
          { name: "main", commit: { sha: "b".repeat(40) }, protected: true },
        ]),
      );
    if (String(input).includes("/commits"))
      return new Response(
        JSON.stringify([
          {
            sha: "b".repeat(40),
            commit: { message: "Real upstream message" },
            html_url:
              "https://github.com/example/repo/commit/" + "b".repeat(40),
          },
        ]),
      );
    return new Response("[]");
  }) as typeof fetch;
  const github = new GitHub(["example/repo"], undefined, transport);
  const evidence = await github.evidence("example/repo");
  assert.equal(evidence.branches[0].protected, true);
  assert.equal(calls.length, 3);
  await assert.rejects(() => github.evidence("unauthorized/repo"));
  await assert.rejects(() =>
    github.source("example/repo", "../../secrets", "main"),
  );
  const failure = new GitHub(
    ["example/repo"],
    undefined,
    (async () => new Response("{}", { status: 403 })) as typeof fetch,
  );
  await assert.rejects(
    () => failure.evidence("example/repo"),
    /could not return evidence/,
  );
});
test("backup CLI captures live WAL data and restored database preserves attribution and schema", async () => {
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const exec = promisify(execFile);
  const f = await fixture();
  try {
    const a = await f.login(f.users.owner.email);
    const p = (
      await f.request(
        "/projects",
        "POST",
        {
          name: "Recover me",
          purpose: "Recover a durable project and its records.",
        },
        a,
      )
    ).value.id;
    await f.request(
      `/projects/${p}/records`,
      "POST",
      { kind: "note", title: "Before backup", body: "Must survive restore." },
      a,
    );
    const destination = join(f.dir, "backup.sqlite");
    await exec(process.execPath, ["scripts/backup.ts", destination], {
      env: { ...process.env, MIZVO_DATABASE: f.config.database },
    });
    const restored = new Store(destination);
    try {
      assert.equal(
        restored.get("PRAGMA integrity_check")?.integrity_check,
        "ok",
      );
      assert.equal(
        restored.get("SELECT title FROM records WHERE project_id=?", p)?.title,
        "Before backup",
      );
      assert.equal(
        restored.get("SELECT actor_id FROM audit WHERE project_id=?", p)
          ?.actor_id,
        f.users.owner.id,
      );
      assert.equal(restored.get("SELECT version FROM migrations")?.version, 1);
    } finally {
      restored.close();
    }
    assert.equal(
      f.app.s.get("SELECT COUNT(*) AS count FROM records")?.count,
      1,
    );
  } finally {
    await f.stop();
  }
});
test("concurrent writes accept only one reviewed version; malformed versions are rejected", async () => {
  const f = await fixture();
  try {
    const a = await f.login(f.users.owner.email);
    const p = (
        await f.request(
          "/projects",
          "POST",
          { name: "Concurrent", purpose: "Avoid silent lost updates." },
          a,
        )
      ).value.id,
      path = "/projects/" + p;
    const r = (
      await f.request(
        path + "/records",
        "POST",
        { kind: "note", title: "Original", body: "One version" },
        a,
      )
    ).value.id;
    const results = await Promise.all(
      ["A", "B"].map((title) =>
        f.request(
          path + "/records/" + r,
          "PATCH",
          { title, body: "Simultaneous update", version: 1 },
          a,
        ),
      ),
    );
    assert.deepEqual(results.map((x) => x.status).sort(), [200, 409]);
    assert.equal(
      (
        await f.request(
          path + "/records/" + r,
          "PATCH",
          { title: "Bad input", body: "No overwrite", version: { bad: true } },
          a,
        )
      ).status,
      400,
    );
    const history = (
      await f.request(path + "/records/" + r + "/history", "GET", undefined, a)
    ).value;
    assert.equal(history.length, 2);
  } finally {
    await f.stop();
  }
});
test("password changes invalidate other sessions, reject wrong current password, and preserve current access", async () => {
  const f = await fixture();
  try {
    const a = await f.login(f.users.owner.email),
      b = await f.login(f.users.owner.email);
    const next = "A-new-long-and-unique-password";
    assert.equal(
      (
        await f.request(
          "/password",
          "POST",
          { current: "Incorrect current password", next },
          a,
        )
      ).status,
      403,
    );
    assert.equal(
      (await f.request("/password", "POST", { current: password, next }, a))
        .status,
      200,
    );
    assert.equal((await f.request("/me", "GET", undefined, b)).status, 401);
    assert.equal((await f.request("/me", "GET", undefined, a)).status, 200);
    assert.equal(
      (
        await f.request("/login", "POST", {
          email: f.users.owner.email,
          password,
        })
      ).status,
      401,
    );
    assert.equal(
      (
        await f.request("/login", "POST", {
          email: f.users.owner.email,
          password: next,
        })
      ).status,
      200,
    );
  } finally {
    await f.stop();
  }
});
test("grant expiry, cross-project object IDs, private notifications, and preference controls", async () => {
  const f = await fixture();
  try {
    const a = await f.login(f.users.owner.email),
      b = await f.login(f.users.contributor.email);
    const p = (
      await f.request(
        "/projects",
        "POST",
        { name: "Scoped", purpose: "Expire grants on every server request." },
        a,
      )
    ).value.id;
    const q = (
      await f.request(
        "/projects",
        "POST",
        {
          name: "Other project",
          purpose: "Keep object IDs scoped to the correct project.",
        },
        a,
      )
    ).value.id;
    const invitation = (
      await f.request(
        `/projects/${p}/invitations`,
        "POST",
        {
          email: f.users.contributor.email,
          role: "contributor",
          access_days: 7,
        },
        a,
      )
    ).value;
    assert(invitation.access_expires_at);
    await f.request(
      "/invitations/accept",
      "POST",
      { token: invitation.token },
      b,
    );
    const secret = (
      await f.request(
        `/projects/${q}/records`,
        "POST",
        {
          kind: "note",
          title: "Other project note",
          body: "Object scope matters.",
        },
        a,
      )
    ).value;
    assert.equal(
      (
        await f.request(
          `/projects/${p}/records/${secret.id}/history`,
          "GET",
          undefined,
          b,
        )
      ).status,
      404,
    );
    await f.request(
      `/projects/${p}/records`,
      "POST",
      {
        kind: "note",
        title: "Secret notification content",
        body: "Must not be copied into a notification.",
      },
      a,
    );
    const notices = (await f.request("/notifications", "GET", undefined, b))
      .value;
    assert(notices.length > 0);
    assert(!JSON.stringify(notices).includes("Secret notification content"));
    await f.request("/preferences", "PATCH", { activity: false }, b);
    const count = notices.length;
    await f.request(
      `/projects/${p}/records`,
      "POST",
      {
        kind: "note",
        title: "After opt out",
        body: "No notification should be created.",
      },
      a,
    );
    assert.equal(
      (await f.request("/notifications", "GET", undefined, b)).value.length,
      count,
    );
    f.app.s.run(
      "UPDATE memberships SET expires_at='2000-01-01T00:00:00Z' WHERE project_id=? AND user_id=?",
      p,
      f.users.contributor.id,
    );
    assert.equal(
      (await f.request(`/projects/${p}`, "GET", undefined, b)).status,
      404,
    );
    assert.equal(
      (await f.request("/notifications", "GET", undefined, b)).value.length,
      0,
    );
    assert.equal(
      (await f.request("/home", "GET", undefined, b)).value.decisions.length,
      0,
    );
  } finally {
    await f.stop();
  }
});
test("versioned migration upgrade preserves data; edited migrations and incompatible downgrades are refused", async () => {
  const { mkdir, copyFile, writeFile } = await import("node:fs/promises");
  const dir = mkdtempSync(join(tmpdir(), "mizvo-migrate-"));
  const migrations = join(dir, "migrations"),
    database = join(dir, "data.sqlite");
  await mkdir(migrations);
  await copyFile(
    "packages/storage/001-foundation.sql",
    join(migrations, "001-foundation.sql"),
  );
  try {
    let s = new Store(database, migrations);
    s.run(
      "INSERT INTO organizations VALUES ('migration','Preserved organization')",
    );
    s.close();
    await writeFile(
      join(migrations, "099-test-upgrade.sql"),
      "ALTER TABLE organizations ADD COLUMN recovery_label TEXT NOT NULL DEFAULT 'preserved';",
    );
    s = new Store(database, migrations);
    assert.equal(
      s.get("SELECT recovery_label FROM organizations WHERE id='migration'")
        ?.recovery_label,
      "preserved",
    );
    assert.equal(s.all("SELECT * FROM migrations").length, 2);
    s.close();
    assert.throws(() => new Store(database), /does not support/);
    await writeFile(join(migrations, "099-test-upgrade.sql"), "SELECT 1;");
    assert.throws(() => new Store(database, migrations), /checksum mismatch/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
test("password verification preserves whitespace and uses explicit recorded work factors", async () => {
  const { hashPassword, verifyPassword } = await import(
    "../packages/authz/security.ts"
  );
  const value = "  significant spaces are preserved  ",
    hash = hashPassword(value);
  assert.match(hash, /^scrypt:65536:8:2:/);
  assert.equal(await verifyPassword(value, hash), true);
  assert.equal(await verifyPassword(value.trim(), hash), false);
});
test("client support requests have attributable team resolution and client reopening with version protection", async () => {
  const f = await fixture();
  try {
    const a = await f.login(f.users.owner.email),
      b = await f.login(f.users.client.email);
    const p = (
      await f.request(
        "/projects",
        "POST",
        {
          name: "Support",
          purpose: "Resolve a real client request with attributable history.",
        },
        a,
      )
    ).value.id;
    const invite = (
      await f.request(
        `/projects/${p}/invitations`,
        "POST",
        { email: f.users.client.email, role: "client" },
        a,
      )
    ).value;
    await f.request("/invitations/accept", "POST", { token: invite.token }, b);
    const r = (
      await f.request(
        `/space/projects/${p}/records`,
        "POST",
        {
          kind: "support",
          title: "Help requested",
          body: "A synthetic support issue.",
        },
        b,
      )
    ).value.id;
    assert.equal(
      (
        await f.request(
          `/space/projects/${p}/records/${r}/status`,
          "POST",
          { state: "resolved", version: 1 },
          b,
        )
      ).status,
      403,
    );
    assert.equal(
      (
        await f.request(
          `/projects/${p}/records/${r}/status`,
          "POST",
          { state: "resolved", version: 1 },
          a,
        )
      ).status,
      200,
    );
    assert.equal(
      (
        await f.request(
          `/space/projects/${p}/records/${r}/status`,
          "POST",
          { state: "open", version: 1 },
          b,
        )
      ).status,
      409,
    );
    assert.equal(
      (
        await f.request(
          `/space/projects/${p}/records/${r}/status`,
          "POST",
          { state: "open", version: 2 },
          b,
        )
      ).status,
      200,
    );
    const history = (
      await f.request(
        `/space/projects/${p}/records/${r}/history`,
        "GET",
        undefined,
        b,
      )
    ).value;
    assert.deepEqual(
      history.map((r: any) => r.state),
      ["open", "resolved", "open"],
    );
    assert.deepEqual(
      history.map((r: any) => r.actor),
      ["Test Client", "Test Founder", "Test Client"],
    );
  } finally {
    await f.stop();
  }
});
test("release source receipts resolve exact GitHub objects and distinguish absent, pending and failed CI (mock transport)", async () => {
  const sha = "a".repeat(40),
    tree = "b".repeat(40);
  let mode = "none";
  const github = new GitHub(["example/repo"], undefined, (async (
    input: any,
  ) => {
    const path = String(input);
    if (mode === "network") throw new Error("network unavailable");
    if (path.includes("check-runs"))
      return new Response(
        JSON.stringify({
          total_count: mode === "overflow" ? 101 : mode === "none" ? 0 : 1,
          check_runs:
            mode === "none"
              ? []
              : [
                  {
                    name: "CI",
                    status: mode === "pending" ? "in_progress" : "completed",
                    conclusion:
                      mode === "failure"
                        ? "failure"
                        : mode === "skipped"
                          ? "skipped"
                          : "success",
                  },
                ],
        }),
      );
    if (path.endsWith("status?per_page=100"))
      return new Response(JSON.stringify({ total_count: 0, statuses: [] }));
    return new Response(
      JSON.stringify({
        sha: mode === "wrong" ? "c".repeat(40) : sha,
        commit: { tree: { sha: tree } },
      }),
    );
  }) as typeof fetch);
  for (const [value, expected] of [
    ["none", "no_checks"],
    ["success", "success"],
    ["failure", "failure"],
    ["pending", "pending"],
    ["skipped", "pending"],
  ]) {
    mode = value!;
    const receipt = await github.releaseSource("example/repo", sha);
    assert.equal(receipt.ci_state, expected);
    assert.equal(receipt.tree_sha, tree);
  }
  for (const value of ["wrong", "overflow", "network"]) {
    mode = value;
    await assert.rejects(() => github.releaseSource("example/repo", sha));
  }
});
test("release verification authorization, persistence, client isolation and reauthorization after provider awaits", async () => {
  let onFetch: (() => void) | undefined;
  let calls = 0;
  let wrong = false;
  const sha = "a".repeat(40),
    tree = "b".repeat(40);
  const github = new GitHub(["devonalanakins/mizvo"], undefined, (async (
    input: any,
  ) => {
    calls++;
    onFetch?.();
    const path = String(input);
    if (path.includes("check-runs"))
      return new Response(JSON.stringify({ total_count: 0, check_runs: [] }));
    if (path.endsWith("status?per_page=100"))
      return new Response(JSON.stringify({ total_count: 0, statuses: [] }));
    return new Response(
      JSON.stringify({
        sha: wrong ? "f".repeat(40) : sha,
        commit: { tree: { sha: tree } },
      }),
    );
  }) as typeof fetch);
  const f = await fixture(github);
  try {
    const a = await f.login(f.users.owner.email),
      b = await f.login(f.users.contributor.email),
      c = await f.login(f.users.client.email);
    const p = (
      await f.request(
        "/projects",
        "POST",
        {
          name: "Release evidence",
          purpose: "Distinguish observed source from claims.",
        },
        a,
      )
    ).value.id;
    for (const [user, role] of [
      [f.users.contributor, "contributor"],
      [f.users.client, "client"],
    ] as const) {
      const i = (
        await f.request(
          `/projects/${p}/invitations`,
          "POST",
          { email: user.email, role },
          a,
        )
      ).value;
      await f.request(
        "/invitations/accept",
        "POST",
        { token: i.token },
        role === "client" ? c : b,
      );
    }
    const release = (
      await f.request(
        `/projects/${p}/releases`,
        "POST",
        {
          label: "Source candidate",
          summary: "Synthetic release record",
          commit_sha: sha,
          rollback: "Restore previous artifact.",
          visibility: "client",
        },
        a,
      )
    ).value.id;
    const path = `/projects/${p}/releases/${release}/verify-source`;
    assert.equal((await f.request(path, "POST", {}, b)).status, 403);
    assert.equal(calls, 0);
    assert.equal((await f.request("/space" + path, "POST", {}, c)).status, 404);
    assert.equal(calls, 0);
    assert.equal((await f.request(path, "POST", {}, a)).status, 409);
    assert.equal(calls, 0);
    assert.equal(
      (
        await f.request(
          `/projects/${p}/github`,
          "PUT",
          { repository: "devonalanakins/mizvo" },
          a,
        )
      ).status,
      200,
    );
    const other = (
      await f.request(
        "/projects",
        "POST",
        { name: "Other", purpose: "Keep release IDs scoped." },
        a,
      )
    ).value.id;
    assert.equal(
      (
        await f.request(
          `/projects/${other}/releases/${release}/verify-source`,
          "POST",
          {},
          a,
        )
      ).status,
      404,
    );
    assert.equal(calls, 0);
    wrong = true;
    assert.equal((await f.request(path, "POST", {}, a)).status, 502);
    assert.equal(
      f.app.s.get("SELECT COUNT(*) AS count FROM release_source_evidence")!
        .count,
      0,
    );
    wrong = false;
    const result = await f.request(path, "POST", {}, a);
    assert.equal(result.status, 201);
    assert.match(result.value.id, /^[a-f0-9-]{36}$/);
    assert.equal(result.value.ci_state, "no_checks");
    assert.equal(result.value.tree_sha, tree);
    let room = (await f.request(`/projects/${p}`, "GET", undefined, a)).value;
    assert.equal(room.releases[0].source_evidence.length, 1);
    assert.equal(room.releases[0].reviews.length, 0);
    const visible = (
      await f.request(`/space/projects/${p}`, "GET", undefined, c)
    ).value;
    assert(!JSON.stringify(visible).includes("source_evidence"));
    assert(!JSON.stringify(visible).includes(tree));
    const reopened = new Store(f.config.database);
    assert.equal(
      reopened.get("SELECT actor_id FROM release_source_evidence")?.actor_id,
      f.users.owner.id,
    );
    reopened.close();
    onFetch = () => {
      f.app.s.run(
        "UPDATE repositories SET full_name='different/repo' WHERE project_id=?",
        p,
      );
    };
    assert.equal((await f.request(path, "POST", {}, a)).status, 409);
    assert.equal(
      f.app.s.get("SELECT COUNT(*) AS count FROM release_source_evidence")!
        .count,
      1,
    );
    f.app.s.run(
      "UPDATE repositories SET full_name='devonalanakins/mizvo' WHERE project_id=?",
      p,
    );
    onFetch = () => {
      f.app.s.run(
        "UPDATE memberships SET revoked_at=? WHERE project_id=? AND user_id=?",
        new Date().toISOString(),
        p,
        f.users.owner.id,
      );
    };
    assert.equal((await f.request(path, "POST", {}, a)).status, 404);
    assert.equal(
      f.app.s.get("SELECT COUNT(*) AS count FROM release_source_evidence")!
        .count,
      1,
    );
  } finally {
    await f.stop();
  }
});
test("release-source migration upgrades an existing V0.5 database without changing recorded versions", async () => {
  const { mkdir, copyFile } = await import("node:fs/promises");
  const { Domain } = await import("../packages/domain/service.ts");
  const dir = mkdtempSync(join(tmpdir(), "mizvo-release-upgrade-")),
    migrations = join(dir, "old-migrations"),
    database = join(dir, "data.sqlite");
  await mkdir(migrations);
  await copyFile(
    "packages/storage/001-foundation.sql",
    join(migrations, "001-foundation.sql"),
  );
  try {
    let s = new Store(database, migrations);
    s.run("INSERT INTO organizations VALUES ('upgrade','Mizvo')");
    const user = account(
        s,
        "Migration Founder",
        "upgrade@example.test",
        password,
        "upgrade",
        "founder",
      ),
      domain = new Domain(s, "upgrade"),
      p = domain.createProject(user.id, {
        name: "Preserved",
        purpose: "Preserve original release attribution.",
      }),
      release = domain.release(user.id, p.id, {
        label: "Existing v1",
        summary: "Already recorded before upgrade",
        commit_sha: "a".repeat(40),
        rollback: "Restore old build",
      });
    s.close();
    s = new Store(database);
    try {
      assert.equal(
        s.get("SELECT label FROM releases WHERE id=?", release.id)?.label,
        "Existing v1",
      );
      assert.equal(
        s.get("SELECT actor_id FROM releases WHERE id=?", release.id)?.actor_id,
        user.id,
      );
      assert.equal(
        s.get("SELECT COUNT(*) AS count FROM release_source_evidence")?.count,
        0,
      );
      assert.equal(s.all("SELECT * FROM migrations").length, 2);
    } finally {
      s.close();
    }
    assert.throws(() => new Store(database, migrations), /does not support/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
