import { test } from "node:test";
import { request as httpRequest } from "node:http";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { application, type Config } from "../apps/api/server.ts";
import { account } from "../packages/authz/security.ts";
import { Store } from "../packages/storage/database.ts";
import { GitHub } from "../apps/api/github.ts";
import { PreviewProbe } from "../apps/api/preview.ts";
const password = "Independent-Test-Password-2026";
async function fixture(
  github?: GitHub,
  preview?: { urls: string[]; transport: typeof fetch },
) {
  const dir = mkdtempSync(join(tmpdir(), "mizvo-"));
  const config: Config = {
    database: join(dir, "data.sqlite"),
    origin: "http://localhost",
    organization: "test-org",
    githubRepositories: ["devonalanakins/mizvo"],
    previewUrls: preview?.urls,
  };
  const app = application(config, { github, previewFetch: preview?.transport });
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
      assert(s.get("SELECT 1 FROM migrations WHERE version=2"));
      assert(s.get("SELECT 1 FROM migrations WHERE version=3"));
      assert(s.get("SELECT 1 FROM migrations WHERE version=4"));
      assert(s.get("SELECT 1 FROM migrations WHERE version=5"));
      assert(s.get("SELECT 1 FROM migrations WHERE version=6"));
      assert(s.get("SELECT 1 FROM migrations WHERE version=7"));
    } finally {
      s.close();
    }
    assert.throws(() => new Store(database, migrations), /does not support/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
test("record pages are bounded and stable through timestamp ties, new inserts and reload", async () => {
  const f = await fixture();
  try {
    const a = await f.login(f.users.owner.email),
      p = (
        await f.request(
          "/projects",
          "POST",
          { name: "History", purpose: "Retrieve long histories without loss." },
          a,
        )
      ).value.id;
    for (let i = 0; i < 67; i++)
      f.app.domain.createRecord(f.users.owner.id, p, {
        kind: "note",
        title: `Note ${i}`,
        body: "Durable content.",
      });
    f.app.s.run(
      "UPDATE records SET created_at='2026-01-01T00:00:00.000Z' WHERE project_id=?",
      p,
    );
    const expected = f.app.s
      .all(
        "SELECT id FROM records WHERE project_id=? ORDER BY created_at,id",
        p,
      )
      .map((r) => r.id);
    const pending = f.app.domain.createRecord(f.users.owner.id, p, {
      kind: "decision",
      title: "Older pending proposal",
      body: "Must remain discoverable beyond the latest page.",
    });
    f.app.s.run(
      "UPDATE records SET created_at='2019-01-01T00:00:00.000Z' WHERE id=?",
      pending.id,
    );
    const initial = (await f.request(`/projects/${p}`, "GET", undefined, a))
      .value;
    assert.equal(initial.records.length, 50);
    assert.equal(initial.record_page.has_more, true);
    assert.equal(initial.pending_decisions, 1);
    assert.equal(initial.next_decision.id, pending.id);
    assert(!initial.records.some((r: any) => r.id === pending.id));
    let cursor = "",
      ids: string[] = [];
    let first = true;
    do {
      const result = await f.request(
        `/projects/${p}/records?kind=note&limit=7${cursor ? "&before=" + cursor : ""}`,
        "GET",
        undefined,
        a,
      );
      assert.equal(result.status, 200);
      assert(result.value.records.length <= 7);
      ids = [...result.value.records.map((r: any) => r.id), ...ids];
      cursor = result.value.record_page.next_cursor ?? "";
      if (first) {
        f.app.domain.createRecord(f.users.owner.id, p, {
          kind: "note",
          title: "New insertion",
          body: "Should not shift older page boundaries.",
        });
        first = false;
      }
    } while (cursor);
    assert.deepEqual(ids, expected);
    assert.equal(new Set(ids).size, 67);
    const oldest = expected[0]!;
    assert.equal(
      (await f.request(`/projects/${p}/records/${oldest}`, "GET", undefined, a))
        .status,
      200,
    );
    const restored = new Store(f.config.database);
    assert.equal(
      restored.get(
        "SELECT COUNT(*) AS count FROM records WHERE project_id=?",
        p,
      )?.count,
      69,
    );
    restored.close();
  } finally {
    await f.stop();
  }
});
test("paged filters, cursors and direct records enforce project/client isolation and revocation", async () => {
  const f = await fixture();
  try {
    const a = await f.login(f.users.owner.email),
      c = await f.login(f.users.client.email),
      other = await f.login(f.users.other.email);
    const p = (
        await f.request(
          "/projects",
          "POST",
          { name: "Client history", purpose: "Keep shared histories private." },
          a,
        )
      ).value.id,
      q = (
        await f.request(
          "/projects",
          "POST",
          {
            name: "Other history",
            purpose: "Reject cursor reuse across projects.",
          },
          a,
        )
      ).value.id;
    const inv = (
      await f.request(
        `/projects/${p}/invitations`,
        "POST",
        { email: f.users.client.email, role: "client" },
        a,
      )
    ).value;
    await f.request("/invitations/accept", "POST", { token: inv.token }, c);
    for (let i = 0; i < 12; i++) {
      f.app.domain.createRecord(f.users.owner.id, p, {
        kind: "note",
        title: `PRIVATE ${i}`,
        body: "Internal only.",
      });
      f.app.domain.createRecord(f.users.owner.id, p, {
        kind: "note",
        title: `Shared ${i}`,
        body: "Shared scope.",
        visibility: "client",
      });
      f.app.domain.createRecord(f.users.owner.id, p, {
        kind: "discussion",
        title: `Discussion ${i}`,
        body: "Other type.",
        visibility: "client",
      });
    }
    const privateId = f.app.s.get(
      "SELECT id FROM records WHERE project_id=? AND visibility='internal'",
      p,
    )!.id;
    let cursor = "",
      count = 0;
    do {
      const page = (
        await f.request(
          `/space/projects/${p}/records?kind=note&limit=5${cursor ? "&before=" + cursor : ""}`,
          "GET",
          undefined,
          c,
        )
      ).value;
      assert(
        page.records.every(
          (r: any) => r.kind === "note" && r.visibility === "client",
        ),
      );
      assert(!JSON.stringify(page).includes("PRIVATE"));
      count += page.records.length;
      cursor = page.record_page.next_cursor ?? "";
    } while (cursor);
    assert.equal(count, 12);
    const studio = (
      await f.request(
        `/projects/${p}/records?kind=note&limit=1`,
        "GET",
        undefined,
        a,
      )
    ).value.record_page.next_cursor;
    assert.equal(
      (
        await f.request(
          `/projects/${q}/records?kind=note&before=${studio}`,
          "GET",
          undefined,
          a,
        )
      ).status,
      400,
    );
    assert.equal(
      (
        await f.request(
          `/projects/${p}/records?kind=discussion&before=${studio}`,
          "GET",
          undefined,
          a,
        )
      ).status,
      400,
    );
    assert.equal(
      (
        await f.request(
          `/space/projects/${p}/records?kind=note&before=${studio}`,
          "GET",
          undefined,
          c,
        )
      ).status,
      400,
    );
    for (const query of [
      "limit=0",
      "limit=101",
      "limit=1.5",
      "limit=oops",
      "kind=invalid",
      "before=not-json",
    ])
      assert.equal(
        (
          await f.request(
            `/projects/${p}/records?${query}`,
            "GET",
            undefined,
            a,
          )
        ).status,
        400,
      );
    assert.equal(
      (
        await f.request(
          `/space/projects/${p}/records/${privateId}`,
          "GET",
          undefined,
          c,
        )
      ).status,
      404,
    );
    assert.equal(
      (await f.request(`/space/projects/${p}/records`, "GET", undefined, other))
        .status,
      404,
    );
    assert.equal(
      (
        await f.request(
          `/space/projects/${p}/records/${privateId}`,
          "GET",
          undefined,
          other,
        )
      ).status,
      404,
    );
    await f.request(
      `/projects/${p}/members/${f.users.client.id}`,
      "PATCH",
      { revoke: true },
      a,
    );
    assert.equal(
      (
        await f.request(
          `/space/projects/${p}/records?before=not-json`,
          "GET",
          undefined,
          c,
        )
      ).status,
      404,
    );
  } finally {
    await f.stop();
  }
});

test("versioned milestones enforce owner rights, project isolation and safe client projection", async () => {
  const f = await fixture();
  try {
    const a = await f.login(f.users.owner.email),
      client = await f.login(f.users.client.email),
      other = await f.login(f.users.other.email);
    const p = (
      await f.request(
        "/projects",
        "POST",
        {
          name: "Delivery milestones",
          purpose: "Visible progress.",
        },
        a,
      )
    ).value.id;
    const otherProject = (
      await f.request(
        "/projects",
        "POST",
        {
          name: "Other",
          purpose: "Project boundary.",
        },
        a,
      )
    ).value.id;
    const path = "/projects/" + p;
    const invite = (
      await f.request(
        path + "/invitations",
        "POST",
        {
          email: f.users.client.email,
          role: "client",
        },
        a,
      )
    ).value;
    assert.equal(
      (
        await f.request(
          "/invitations/accept",
          "POST",
          { token: invite.token },
          client,
        )
      ).status,
      200,
    );
    const privateMilestone = await f.request(
      path + "/milestones",
      "POST",
      {
        title: "PRIVATE_MILESTONE",
        visibility: "internal",
      },
      a,
    );
    assert.equal(privateMilestone.status, 201);
    const shared = await f.request(
      path + "/milestones",
      "POST",
      {
        title: "Shared acceptance checkpoint",
        summary: "Verify actual client progress.",
        visibility: "client",
        status: "active",
        target_date: "2026-12-01",
      },
      a,
    );
    assert.equal(shared.status, 201);
    assert.equal(
      (
        await f.request(
          path + "/milestones",
          "POST",
          {
            title: "Invalid",
            target_date: "2026-02-31",
          },
          a,
        )
      ).status,
      400,
    );
    assert.equal(
      (
        await f.request(
          path + "/milestones",
          "POST",
          {
            title: "Bad",
            visibility: "client",
          },
          client,
        )
      ).status,
      404,
    );
    assert.equal(
      (
        await f.request(
          "/space" + path + "/milestones",
          "POST",
          {
            title: "Bad",
            visibility: "client",
          },
          client,
        )
      ).status,
      404,
    );
    assert.equal((await f.request(path, "GET", undefined, other)).status, 404);
    let space = await f.request("/space" + path, "GET", undefined, client);
    assert.equal(space.status, 200);
    assert.equal(space.value.milestones.length, 1);
    assert.equal(
      space.value.milestones[0].title,
      "Shared acceptance checkpoint",
    );
    assert(!JSON.stringify(space.value).includes("PRIVATE_MILESTONE"));
    assert(!JSON.stringify(space.value.milestones).includes("actor_id"));
    assert(!JSON.stringify(space.value.milestones).includes("visibility"));
    const linked = await f.request(
      path + "/tasks",
      "POST",
      {
        title: "Verify user outcome",
        milestone_id: shared.value.id,
        visibility: "client",
      },
      a,
    );
    assert.equal(linked.status, 201);
    assert.equal(
      (
        await f.request(
          path + "/tasks",
          "POST",
          {
            title: "Leaked linkage",
            milestone_id: privateMilestone.value.id,
            visibility: "client",
          },
          a,
        )
      ).status,
      400,
    );
    assert.equal(
      (
        await f.request(
          "/projects/" + otherProject + "/tasks",
          "POST",
          {
            title: "Cross project",
            milestone_id: shared.value.id,
          },
          a,
        )
      ).status,
      400,
    );
    assert.equal(
      (
        await f.request(
          path + "/milestones/" + shared.value.id,
          "PATCH",
          {
            title: "Shared acceptance checkpoint",
            visibility: "internal",
            status: "active",
            version: 1,
          },
          a,
        )
      ).status,
      409,
    );
    assert.equal(
      (
        await f.request(
          path + "/milestones/" + shared.value.id,
          "PATCH",
          {
            title: "Shared acceptance checkpoint",
            visibility: "client",
            status: "done",
            version: 1,
          },
          a,
        )
      ).status,
      409,
    );
    let studio = (await f.request(path, "GET", undefined, a)).value;
    const task = studio.tasks.find(
      (t: any) => t.title === "Verify user outcome",
    );
    assert.equal(task.milestone_id, shared.value.id);
    assert.equal(
      (
        await f.request(
          path + "/tasks/" + task.id,
          "PATCH",
          {
            ...task,
            status: "done",
            evidence: "Reviewed test observation",
          },
          a,
        )
      ).status,
      200,
    );
    assert.equal(
      (
        await f.request(
          path + "/milestones/" + shared.value.id,
          "PATCH",
          {
            title: "Completed shared milestone",
            visibility: "client",
            status: "done",
            summary: "Reviewed outcome.",
            target_date: "2026-12-01",
            version: 1,
          },
          a,
        )
      ).status,
      200,
    );
    assert.equal(
      (
        await f.request(
          path + "/milestones/" + shared.value.id,
          "PATCH",
          {
            title: "Stale update",
            visibility: "client",
            status: "active",
            version: 1,
          },
          a,
        )
      ).status,
      409,
    );
    space = await f.request("/space" + path, "GET", undefined, client);
    assert.equal(space.value.milestones[0].status, "done");
    assert.equal(
      space.value.tasks.find((t: any) => t.id === task.id).milestone,
      "Completed shared milestone",
    );
    assert.equal(
      (
        await f.request(
          path + "/tasks",
          "POST",
          {
            title: "Premature reopening",
            milestone_id: shared.value.id,
            visibility: "client",
          },
          a,
        )
      ).status,
      409,
    );
  } finally {
    await f.stop();
  }
});

test("targeted client decisions keep request versions, recipient isolation and internal approvals independent", async () => {
  const f = await fixture();
  try {
    const founder = await f.login(f.users.owner.email),
      client = await f.login(f.users.client.email),
      other = await f.login(f.users.other.email);
    const project = (
        await f.request(
          "/projects",
          "POST",
          {
            name: "Client decisions",
            purpose: "Ask an assigned client for an explicit response.",
          },
          founder,
        )
      ).value.id,
      path = "/projects/" + project;
    for (const [email, session] of [
      [f.users.client.email, client],
      [f.users.other.email, other],
    ] as const) {
      const invite = (
        await f.request(
          path + "/invitations",
          "POST",
          {
            email,
            role: "client",
          },
          founder,
        )
      ).value;
      assert.equal(
        (
          await f.request(
            "/invitations/accept",
            "POST",
            {
              token: invite.token,
            },
            session,
          )
        ).status,
        200,
      );
    }
    const internal = (
      await f.request(
        path + "/records",
        "POST",
        {
          kind: "decision",
          title: "Internal proposal",
          body: "Independent engineering judgment",
        },
        founder,
      )
    ).value.id;
    const requested = await f.request(
      path + "/client-decisions",
      "POST",
      {
        client_id: f.users.client.id,
        title: "Confirm onboarding language",
        body: "Does this explain the benefit clearly?",
      },
      founder,
    );
    assert.equal(requested.status, 201);
    assert.equal(
      (
        await f.request(
          path + "/client-decisions",
          "POST",
          {
            client_id: f.users.contributor.id,
            title: "Wrong role",
            body: "Not a client",
          },
          founder,
        )
      ).status,
      400,
    );
    assert.equal(
      (
        await f.request(
          path + "/client-decisions",
          "POST",
          {
            client_id: f.users.other.id,
            title: "Forged",
            body: "Not allowed",
          },
          client,
        )
      ).status,
      404,
    );
    const clientRoom = await f.request(
      "/space" + path,
      "GET",
      undefined,
      client,
    );
    const otherRoom = await f.request("/space" + path, "GET", undefined, other);
    assert.equal(clientRoom.value.client_decisions.length, 1);
    assert.equal(otherRoom.value.client_decisions.length, 0);
    assert(
      !JSON.stringify(clientRoom.value.client_decisions).includes("client_id"),
    );
    const response =
      "/space" + path + "/client-decisions/" + requested.value.id + "/respond";
    assert.equal(
      (
        await f.request(
          response,
          "POST",
          {
            outcome: "accepted",
            comment: "Other client",
            version: 1,
          },
          other,
        )
      ).status,
      404,
    );
    assert.equal(
      (
        await f.request(
          response,
          "POST",
          {
            outcome: "accepted",
            comment: "Founder",
            version: 1,
          },
          founder,
        )
      ).status,
      404,
    );
    assert.equal(
      (
        await f.request(
          response,
          "POST",
          {
            outcome: "accepted",
            comment: "Clear and useful.",
            version: 1,
          },
          client,
        )
      ).status,
      200,
    );
    assert.equal(
      (
        await f.request(
          response,
          "POST",
          {
            outcome: "changes_requested",
            comment: "Replay",
            version: 1,
          },
          client,
        )
      ).status,
      409,
    );
    const after = (await f.request(path, "GET", undefined, founder)).value;
    const answer = after.client_decisions.find(
      (x: any) => x.id === requested.value.id,
    );
    assert.equal(answer.version, 2);
    assert.equal(answer.status, "answered");
    assert.equal(answer.outcome, "accepted");
    assert.equal(answer.request_version, 1);
    assert.equal(
      after.records.find((r: any) => r.id === internal).state,
      "proposed",
    );
    assert.equal(
      (
        await f.request(
          path + "/client-decisions/" + requested.value.id + "/cancel",
          "POST",
          {
            version: 2,
          },
          founder,
        )
      ).status,
      409,
    );
    const pending = (
      await f.request(
        path + "/client-decisions",
        "POST",
        {
          client_id: f.users.client.id,
          title: "Withdraw request",
          body: "No longer needed",
        },
        founder,
      )
    ).value.id;
    assert.equal(
      (
        await f.request(
          path + "/client-decisions/" + pending + "/cancel",
          "POST",
          {
            version: 1,
          },
          founder,
        )
      ).status,
      200,
    );
    assert.equal(
      (
        await f.request(
          "/space" + path + "/client-decisions/" + pending + "/respond",
          "POST",
          {
            outcome: "accepted",
            comment: "Too late",
            version: 1,
          },
          client,
        )
      ).status,
      409,
    );
    assert.equal(
      f.app.s.get(
        "SELECT COUNT(*) AS count FROM client_decision_responses WHERE request_id=?",
        requested.value.id,
      )?.count,
      1,
    );
    const otherProject = (
      await f.request(
        "/projects",
        "POST",
        {
          name: "Other project",
          purpose: "Isolation check",
        },
        founder,
      )
    ).value.id;
    assert.equal(
      (
        await f.request(
          "/projects/" +
            otherProject +
            "/client-decisions/" +
            requested.value.id +
            "/cancel",
          "POST",
          {
            version: 1,
          },
          founder,
        )
      ).status,
      404,
    );
  } finally {
    await f.stop();
  }
});

test("Living Brief preserves private revisions, client-safe projection, exact preview decision and stale-response boundary", async () => {
  const f = await fixture();
  try {
    const founder = await f.login(f.users.owner.email),
      contributor = await f.login(f.users.contributor.email),
      client = await f.login(f.users.client.email),
      other = await f.login(f.users.other.email);
    const project = (
      await f.request(
        "/projects",
        "POST",
        {
          name: "Human-first commission",
          purpose: "Test one actual client decision.",
        },
        founder,
      )
    ).value.id;
    const path = `/projects/${project}`;
    const otherProject = (
      await f.request(
        "/projects",
        "POST",
        {
          name: "Separate commission",
          purpose: "Keep each project isolated.",
        },
        founder,
      )
    ).value.id;
    for (const [person, role, session] of [
      [f.users.contributor, "contributor", contributor],
      [f.users.client, "client", client],
      [f.users.other, "client", other],
    ] as const) {
      const invite = await f.request(
        path + "/invitations",
        "POST",
        {
          email: person.email,
          role,
        },
        founder,
      );
      assert.equal(invite.status, 201);
      assert.equal(
        (
          await f.request(
            "/invitations/accept",
            "POST",
            {
              token: invite.value.token,
            },
            session,
          )
        ).status,
        200,
      );
    }
    const initial = (await f.request("/space" + path, "GET", undefined, client))
      .value;
    assert.equal(initial.brief, null);
    assert.equal(initial.next_client_decision, null);
    const briefBody = {
      problem: "The current process confuses people.",
      audience: "Nontechnical facilitators.",
      outcome: "Start confidently on a phone.",
      success_criteria: "Finish a real guided rehearsal.",
      exclusions: "No payroll records.",
      assumptions: "Needs live phone trial.",
    };
    assert.equal(
      (
        await f.request(
          path + "/brief-revisions",
          "POST",
          {
            ...briefBody,
            visibility: "client",
            base_revision: 0,
          },
          contributor,
        )
      ).status,
      403,
    );
    assert.equal(
      (
        await f.request(
          path + "/brief-revisions",
          "POST",
          {
            ...briefBody,
            visibility: "client",
            base_revision: 0,
          },
          client,
        )
      ).status,
      404,
    );
    assert.equal(
      (
        await f.request(
          "/space" + path + "/brief-revisions",
          "POST",
          {
            ...briefBody,
            visibility: "client",
            base_revision: 0,
          },
          client,
        )
      ).status,
      404,
    );
    assert.equal(
      (
        await f.request(
          "/projects/" + otherProject + "/brief-revisions",
          "POST",
          {
            ...briefBody,
            visibility: "client",
            base_revision: 0,
          },
          client,
        )
      ).status,
      404,
    );
    const privateRev = await f.request(
      path + "/brief-revisions",
      "POST",
      {
        ...briefBody,
        problem: "PRIVATE_INTERNAL_DISCOVERY",
        assumptions: "PRIVATE_ASSUMPTION",
        visibility: "internal",
        base_revision: 0,
      },
      founder,
    );
    assert.equal(privateRev.status, 201);
    const hidden = (await f.request("/space" + path, "GET", undefined, client))
      .value;
    assert.equal(hidden.brief, null);
    assert(!JSON.stringify(hidden).includes("PRIVATE_INTERNAL_DISCOVERY"));
    assert(!JSON.stringify(hidden).includes("PRIVATE_ASSUMPTION"));
    const shared = await f.request(
      path + "/brief-revisions",
      "POST",
      {
        ...briefBody,
        visibility: "client",
        base_revision: 1,
      },
      founder,
    );
    assert.equal(shared.status, 201);
    assert.equal(shared.value.revision, 2);
    assert.equal(
      (
        await f.request(
          path + "/brief-revisions",
          "POST",
          {
            ...briefBody,
            visibility: "client",
            base_revision: 1,
          },
          founder,
        )
      ).status,
      409,
    );
    let room = (await f.request(path, "GET", undefined, founder)).value;
    assert.equal(room.brief_revisions.length, 2);
    assert.equal(room.shared_brief.id, shared.value.id);
    const currentClient = (
      await f.request("/space" + path, "GET", undefined, client)
    ).value;
    assert.equal(currentClient.brief.revision, 2);
    assert.equal(currentClient.brief.problem, briefBody.problem);
    assert(
      !JSON.stringify(currentClient).includes("PRIVATE_INTERNAL_DISCOVERY"),
    );
    assert(!JSON.stringify(currentClient).includes("PRIVATE_ASSUMPTION"));
    assert(!JSON.stringify(currentClient.brief).includes("actor_id"));
    assert(!JSON.stringify(currentClient.brief).includes("visibility"));
    assert(!JSON.stringify(currentClient).includes("brief_revisions"));
    assert.equal(
      (await f.request("/space" + path, "GET", undefined, other)).value.brief
        .id,
      shared.value.id,
    );
    const release = await f.request(
      path + "/releases",
      "POST",
      {
        label: "Phone rehearsal v1",
        summary: "Recorded draft; not deployed.",
        commit_sha: "a".repeat(40),
        demo_url: "https://example.test/synthetic-preview",
        visibility: "client",
        rollback: "Restore earlier build.",
      },
      founder,
    );
    assert.equal(release.status, 201);
    const internalRelease = await f.request(
      path + "/releases",
      "POST",
      {
        label: "Internal only",
        summary: "Not shared with client.",
        commit_sha: "b".repeat(40),
        visibility: "internal",
        rollback: "Restore.",
      },
      founder,
    );
    assert.equal(internalRelease.status, 201);
    const crossRelease = await f.request(
      "/projects/" + otherProject + "/releases",
      "POST",
      {
        label: "Another project",
        summary: "Not the same customer.",
        commit_sha: "c".repeat(40),
        visibility: "client",
        rollback: "Restore.",
      },
      founder,
    );
    assert.equal(crossRelease.status, 201);
    for (const bad of [
      { brief_revision_id: privateRev.value.id },
      { brief_revision_id: "not-a-brief" },
    ]) {
      assert.equal(
        (
          await f.request(
            path + "/client-decisions",
            "POST",
            {
              client_id: f.users.client.id,
              title: "Wrong version",
              body: "Not current.",
              ...bad,
            },
            founder,
          )
        ).status,
        409,
      );
    }
    for (const badRelease of [
      internalRelease.value.id,
      crossRelease.value.id,
    ]) {
      assert.equal(
        (
          await f.request(
            path + "/client-decisions",
            "POST",
            {
              client_id: f.users.client.id,
              title: "Wrong preview",
              body: "Not shared.",
              brief_revision_id: shared.value.id,
              release_id: badRelease,
            },
            founder,
          )
        ).status,
        400,
      );
    }
    const request = await f.request(
      path + "/client-decisions",
      "POST",
      {
        client_id: f.users.client.id,
        title: "Does the phone flow work for you?",
        body: "Review the recorded phone rehearsal for Living Brief revision 2.",
        brief_revision_id: shared.value.id,
        release_id: release.value.id,
      },
      founder,
    );
    assert.equal(request.status, 201);
    let clientRoom = (
      await f.request("/space" + path, "GET", undefined, client)
    ).value;
    assert.equal(clientRoom.next_client_decision.id, request.value.id);
    assert.equal(clientRoom.next_client_decision.release_id, release.value.id);
    assert.equal(clientRoom.next_client_decision.brief_revision, 2);
    assert.equal(clientRoom.next_client_decision.current, true);
    assert.equal(
      (await f.request("/space" + path, "GET", undefined, other)).value
        .next_client_decision,
      null,
    );
    const stillUnshared = await f.request(
      path + "/brief-revisions",
      "POST",
      {
        ...briefBody,
        assumptions: "PRIVATE_ONLY_ASSUMPTION",
        visibility: "internal",
        base_revision: 2,
      },
      founder,
    );
    assert.equal(stillUnshared.status, 201);
    clientRoom = (await f.request("/space" + path, "GET", undefined, client))
      .value;
    assert.equal(clientRoom.brief.revision, 2);
    assert(clientRoom.next_client_decision);
    assert(!JSON.stringify(clientRoom).includes("PRIVATE_ONLY_ASSUMPTION"));
    const published = await f.request(
      path + "/brief-revisions",
      "POST",
      {
        ...briefBody,
        outcome: "A new user-facing outcome.",
        visibility: "client",
        base_revision: 3,
      },
      founder,
    );
    assert.equal(published.status, 201);
    clientRoom = (await f.request("/space" + path, "GET", undefined, client))
      .value;
    assert.equal(clientRoom.brief.revision, 4);
    assert.equal(clientRoom.next_client_decision, null);
    assert.equal(clientRoom.client_decisions[0].current, false);
    const respond =
      "/space" + path + "/client-decisions/" + request.value.id + "/respond";
    assert.equal(
      (
        await f.request(
          respond,
          "POST",
          {
            outcome: "accepted",
            comment: "Stale request should not pass.",
            version: 1,
          },
          client,
        )
      ).status,
      409,
    );
    assert.equal(
      (
        await f.request(
          respond,
          "POST",
          {
            outcome: "accepted",
            comment: "Wrong client should not pass.",
            version: 1,
          },
          other,
        )
      ).status,
      404,
    );
    const fresh = await f.request(
      path + "/client-decisions",
      "POST",
      {
        client_id: f.users.client.id,
        title: "Review the updated brief and phone flow",
        body: "The latest shared brief revision and recorded demo are now ready for your review.",
        brief_revision_id: published.value.id,
        release_id: release.value.id,
      },
      founder,
    );
    assert.equal(fresh.status, 201);
    const freshAnswer = await f.request(
      "/space" + path + "/client-decisions/" + fresh.value.id + "/respond",
      "POST",
      {
        outcome: "changes_requested",
        comment: "Please enlarge one control.",
        version: 1,
      },
      client,
    );
    assert.equal(freshAnswer.status, 200);
    assert.equal(
      (
        await f.request(
          "/space" + path + "/client-decisions/" + fresh.value.id + "/respond",
          "POST",
          {
            outcome: "accepted",
            comment: "Replay.",
            version: 1,
          },
          client,
        )
      ).status,
      409,
    );
    const reread = new Store(f.config.database);
    try {
      assert.equal(
        reread.get(
          "SELECT COUNT(*) AS count FROM project_brief_revisions WHERE project_id=?",
          project,
        )?.count,
        4,
      );
      assert.equal(
        reread.get(
          "SELECT revision FROM project_brief_revisions WHERE id=?",
          published.value.id,
        )?.revision,
        4,
      );
      assert.equal(
        reread.get(
          "SELECT release_id FROM client_decision_requests WHERE id=?",
          fresh.value.id,
        )?.release_id,
        release.value.id,
      );
      assert.equal(
        reread.get(
          "SELECT outcome FROM client_decision_responses WHERE request_id=?",
          fresh.value.id,
        )?.outcome,
        "changes_requested",
      );
    } finally {
      reread.close();
    }
    const own = (await f.request(path, "GET", undefined, founder)).value;
    assert.equal(own.brief.revision, 4);
    assert.equal(own.brief_revisions.length, 4);
  } finally {
    await f.stop();
  }
});

test("preview probe requires administrator exact public HTTPS allowlist and never follows redirects", async () => {
  const target = "https://preview.example.org/check";
  for (const bad of [
    "http://preview.example.org/check",
    "https://127.0.0.1/check",
    "https://[::1]/",
    "https://localhost/ready",
    "https://service.internal/check",
    "https://service.example/check",
    "https://preview.example.org/check?token=secret",
    "https://preview.example.org/check#hash",
    "https://preview.example.org:8443/check",
    "https://user:password@preview.example.org/check",
  ]) {
    assert.throws(
      () => new PreviewProbe([bad]),
      "Invalid configured URL: " + bad,
    );
  }
  let mode = "ok",
    count = 0;
  const probe = new PreviewProbe([target], (async (
    input: any,
    options: any,
  ) => {
    count++;
    assert.equal(String(input), target);
    assert.equal(options.method, "HEAD");
    assert.equal(options.redirect, "manual");
    assert.equal(options.credentials, "omit");
    assert.equal(options.cache, "no-store");
    assert.equal(options.headers.Accept, "text/html");
    if (mode === "network")
      throw new Error("INTERNAL_PRIVATE_TRANSPORT_DETAILS");
    if (mode === "redirect")
      return new Response(null, {
        status: 302,
        headers: { Location: "https://untrusted.example.org/private" },
      });
    if (mode === "error") return new Response(null, { status: 503 });
    return new Response(null, {
      status: 200,
      headers: {
        "X-Mizvo-Source-Commit":
          mode === "wrong" ? "b".repeat(40) : "a".repeat(40),
      },
    });
  }) as typeof fetch);
  assert.equal(probe.allows(target), true);
  for (const notAllowed of [
    "https://untrusted.example.org/private",
    "https://preview.example.org/check/other",
    "https://preview.example.org/secret",
    "https://preview.example.org/check?token=x",
    "http://preview.example.org/check",
  ]) {
    assert.equal(probe.allows(notAllowed), false);
    await assert.rejects(() => probe.observe(notAllowed, "a".repeat(40)));
  }
  assert.equal(count, 0, "No outbound requests for unconfigured targets");
  const expected = "a".repeat(40);
  let observed = await probe.observe(target, expected);
  assert.equal(observed.result, "reachable");
  assert.equal(observed.http_status, 200);
  assert.equal(observed.reported_commit, expected);
  assert.equal(observed.commit_matches, 1);
  mode = "wrong";
  observed = await probe.observe(target, expected);
  assert.equal(observed.result, "reachable");
  assert.equal(observed.commit_matches, 0);
  mode = "redirect";
  observed = await probe.observe(target, expected);
  assert.equal(observed.result, "redirect_denied");
  assert.equal(observed.http_status, 302);
  mode = "error";
  observed = await probe.observe(target, expected);
  assert.equal(observed.result, "http_error");
  assert.equal(observed.http_status, 503);
  mode = "network";
  observed = await probe.observe(target, expected);
  assert.equal(observed.result, "network_error");
  assert.equal(observed.http_status, null);
  assert(
    !JSON.stringify(observed).includes("INTERNAL_PRIVATE_TRANSPORT_DETAILS"),
  );
  assert.equal(count, 5);
});

test("preview observations preserve exact release binding, reauthorize after I/O, and project-specific client privacy", async () => {
  const target = "https://preview.example.org/check";
  const wrongUrl = "https://preview.example.org/other";
  const sha = "a".repeat(40);
  let mode = "ok";
  let onRequest: (() => void) | undefined;
  let hits = 0;
  const transport = (async (input: any, options: any) => {
    hits++;
    assert.equal(String(input), target);
    assert.equal(options.method, "HEAD");
    assert.equal(options.redirect, "manual");
    onRequest?.();
    if (mode === "network") throw new Error("private host info");
    if (mode === "redirect") return new Response(null, { status: 302 });
    if (mode === "error") return new Response(null, { status: 503 });
    return new Response(null, {
      status: 200,
      headers: {
        "X-Mizvo-Source-Commit": mode === "wrong" ? "b".repeat(40) : sha,
      },
    });
  }) as typeof fetch;
  const f = await fixture(undefined, { urls: [target], transport });
  try {
    const founder = await f.login(f.users.owner.email),
      contributor = await f.login(f.users.contributor.email),
      client = await f.login(f.users.client.email),
      otherClient = await f.login(f.users.other.email);
    const project = (
      await f.request(
        "/projects",
        "POST",
        {
          name: "Observed Preview",
          purpose: "Show recorded proof honestly.",
        },
        founder,
      )
    ).value.id;
    const path = "/projects/" + project;
    for (const [person, role, session] of [
      [f.users.contributor, "contributor", contributor],
      [f.users.client, "client", client],
    ] as const) {
      const invite = (
        await f.request(
          path + "/invitations",
          "POST",
          {
            email: person.email,
            role,
          },
          founder,
        )
      ).value;
      assert.equal(
        (
          await f.request(
            "/invitations/accept",
            "POST",
            {
              token: invite.token,
            },
            session,
          )
        ).status,
        200,
      );
    }
    const release = (
      await f.request(
        path + "/releases",
        "POST",
        {
          label: "Staging preview candidate",
          summary: "Recorded version, not deployed.",
          commit_sha: sha,
          demo_url: target,
          visibility: "client",
          rollback: "Return to previous version.",
        },
        founder,
      )
    ).value.id;
    const unallowed = (
      await f.request(
        path + "/releases",
        "POST",
        {
          label: "Unconfigured demo URL",
          summary: "Not in the administrator allowlist.",
          commit_sha: sha,
          demo_url: wrongUrl,
          visibility: "client",
          rollback: "No action.",
        },
        founder,
      )
    ).value.id;
    const internal = (
      await f.request(
        path + "/releases",
        "POST",
        {
          label: "Private preview",
          summary: "Private evidence.",
          commit_sha: sha,
          demo_url: target,
          visibility: "internal",
          rollback: "No action.",
        },
        founder,
      )
    ).value.id;
    const otherProject = (
      await f.request(
        "/projects",
        "POST",
        {
          name: "Unrelated",
          purpose: "Do not leak evidence.",
        },
        founder,
      )
    ).value.id;
    const check = path + "/releases/" + release + "/observe-preview";
    assert.equal((await f.request(check, "POST", {}, contributor)).status, 403);
    assert.equal(
      (await f.request("/space" + check, "POST", {}, client)).status,
      404,
    );
    assert.equal((await f.request(check, "POST", {}, otherClient)).status, 404);
    assert.equal(
      (
        await f.request(
          "/projects/" +
            otherProject +
            "/releases/" +
            release +
            "/observe-preview",
          "POST",
          {},
          founder,
        )
      ).status,
      404,
    );
    assert.equal(
      (
        await f.request(
          path + "/releases/" + unallowed + "/observe-preview",
          "POST",
          {},
          founder,
        )
      ).status,
      409,
    );
    assert.equal(
      hits,
      0,
      "Unauthorized and unconfigured attempts make no request",
    );
    let response = await f.request(
      check,
      "POST",
      { result: "production_observed" },
      founder,
    );
    assert.equal(response.status, 201);
    assert.equal(response.value.result, "reachable");
    assert.equal(response.value.expected_commit, sha);
    assert.equal(response.value.commit_matches, 1);
    assert.equal(hits, 1);
    let ownerRoom = (await f.request(path, "GET", undefined, founder)).value;
    const releaseOwner = ownerRoom.releases.find((r: any) => r.id === release);
    assert.equal(releaseOwner.preview_probe_allowed, true);
    assert.equal(releaseOwner.preview_observations[0].expected_commit, sha);
    assert.equal(
      ownerRoom.releases.find((r: any) => r.id === unallowed)
        .preview_probe_allowed,
      false,
    );
    const clientRoom = (
      await f.request("/space" + path, "GET", undefined, client)
    ).value;
    const releaseClient = clientRoom.releases.find(
      (r: any) => r.id === release,
    );
    assert.equal(releaseClient.preview_observations[0].result, "reachable");
    assert.equal(releaseClient.preview_observations[0].http_status, 200);
    assert(
      !JSON.stringify(releaseClient.preview_observations).includes("actor_id"),
    );
    assert(!JSON.stringify(clientRoom).includes("commit_matches"));
    assert(!JSON.stringify(clientRoom).includes("reported_commit"));
    assert(!JSON.stringify(clientRoom).includes("preview_probe_allowed"));
    assert(!JSON.stringify(clientRoom).includes("Private preview"));
    assert.equal(
      (await f.request("/space" + path, "GET", undefined, otherClient)).status,
      404,
    );
    const reopened = new Store(f.config.database);
    try {
      assert.equal(
        reopened.get(
          "SELECT COUNT(*) AS count FROM preview_observations WHERE release_id=?",
          release,
        )?.count,
        1,
      );
      assert.equal(
        reopened.get(
          "SELECT actor_id FROM preview_observations WHERE release_id=?",
          release,
        )?.actor_id,
        f.users.owner.id,
      );
      assert.equal(
        reopened.get(
          "SELECT COUNT(*) AS count FROM preview_observations WHERE release_id=?",
          internal,
        )?.count,
        0,
      );
    } finally {
      reopened.close();
    }
    mode = "wrong";
    response = await f.request(check, "POST", {}, founder);
    assert.equal(response.status, 201);
    assert.equal(response.value.commit_matches, 0);
    assert.equal(response.value.result, "reachable");
    mode = "redirect";
    response = await f.request(check, "POST", {}, founder);
    assert.equal(response.status, 201);
    assert.equal(response.value.result, "redirect_denied");
    mode = "network";
    response = await f.request(check, "POST", {}, founder);
    assert.equal(response.status, 201);
    assert.equal(response.value.result, "network_error");
    assert(!JSON.stringify(response.value).includes("private host info"));
    f.app.s.run(
      "DELETE FROM rate_limits WHERE key=?",
      "preview:" + f.users.owner.id,
    );
    onRequest = () =>
      f.app.s.run(
        "UPDATE releases SET demo_url=? WHERE id=?",
        wrongUrl,
        release,
      );
    mode = "ok";
    assert.equal((await f.request(check, "POST", {}, founder)).status, 409);
    assert.equal(
      f.app.s.get(
        "SELECT COUNT(*) AS count FROM preview_observations WHERE release_id=?",
        release,
      )?.count,
      4,
    );
    f.app.s.run("UPDATE releases SET demo_url=? WHERE id=?", target, release);
    onRequest = () =>
      f.app.s.run(
        "UPDATE memberships SET revoked_at=? WHERE project_id=? AND user_id=?",
        new Date().toISOString(),
        project,
        f.users.owner.id,
      );
    assert.equal((await f.request(check, "POST", {}, founder)).status, 404);
    assert.equal(
      f.app.s.get(
        "SELECT COUNT(*) AS count FROM preview_observations WHERE release_id=?",
        release,
      )?.count,
      4,
    );
    assert.equal(hits, 6);
  } finally {
    await f.stop();
  }
});

test("client release reviews exclude engineering comments and other clients' responses", async () => {
  const f = await fixture();
  try {
    const a = await f.login(f.users.owner.email);
    const engineer = await f.login(f.users.contributor.email);
    const client = await f.login(f.users.client.email);
    const other = await f.login(f.users.other.email);
    const p = f.app.domain.createProject(f.users.owner.id, {
      name: "Review privacy",
      purpose: "Keep engineering review private.",
    });
    for (const [person, role] of [
      [f.users.contributor, "contributor"],
      [f.users.client, "client"],
      [f.users.other, "client"],
    ] as const) {
      const i = f.app.domain.invite(f.users.owner.id, p.id, {
        email: person.email,
        role,
      });
      f.app.domain.accept(person.id, i.token);
    }
    const path = `/projects/${p.id}`;
    const release = (
      await f.request(
        path + "/releases",
        "POST",
        {
          label: "Privacy version",
          summary: "Shared version",
          commit_sha: "a".repeat(40),
          rollback: "Keep previous version",
          visibility: "client",
        },
        a,
      )
    ).value;
    for (const [session, prefix, comment] of [
      [engineer, "", "PRIVATE_ENGINEERING_FINDING"],
      [client, "/space", "CLIENT_ONE_RESPONSE"],
      [other, "/space", "CLIENT_TWO_RESPONSE"],
    ] as const) {
      assert.equal(
        (
          await f.request(
            prefix + path + `/releases/${release.id}/review`,
            "POST",
            { outcome: "approved", comment },
            session,
          )
        ).status,
        200,
      );
    }
    const own = (await f.request("/space" + path, "GET", undefined, client))
      .value;
    assert.equal(
      JSON.stringify(own).includes("PRIVATE_ENGINEERING_FINDING"),
      false,
    );
    assert.equal(JSON.stringify(own).includes("CLIENT_TWO_RESPONSE"), false);
    assert.equal(own.releases[0].reviews[0].comment, "CLIENT_ONE_RESPONSE");
    const internal = (await f.request(path, "GET", undefined, a)).value;
    assert.equal(internal.releases[0].reviews.length, 3);
    assert.equal(
      internal.releases[0].reviews.find(
        (r: any) => r.comment === "PRIVATE_ENGINEERING_FINDING",
      ).audience,
      "internal",
    );
    // Role changes cannot retroactively publish a historical engineering comment.
    f.app.domain.memberUpdate(f.users.owner.id, p.id, f.users.contributor.id, {
      role: "client",
    });
    assert.equal(
      JSON.stringify(
        (await f.request("/space" + path, "GET", undefined, engineer)).value,
      ).includes("PRIVATE_ENGINEERING_FINDING"),
      false,
    );
    assert.equal(
      (await f.request("/space" + path, "GET", undefined, engineer)).value
        .releases[0].review_recorded,
      true,
    );
  } finally {
    await f.stop();
  }
});

test("revoked or expired sessions cannot finish a delayed authenticated write", async () => {
  const f = await fixture();
  try {
    for (const expire of [false, true]) {
      const a = await f.login(f.users.owner.email);
      const result = new Promise<number>((resolve, reject) => {
        const req = httpRequest(
          f.config.origin + "/api/projects",
          {
            method: "POST",
            headers: {
              Origin: f.config.origin,
              Cookie: a.cookie,
              "X-CSRF-Token": a.csrf,
              "Content-Type": "application/json",
            },
          },
          (res) => {
            res.resume();
            res.on("end", () => resolve(res.statusCode!));
          },
        );
        req.on("error", reject);
        f.app.server.once("request", () =>
          setImmediate(() => {
            if (expire)
              f.app.s.run(
                "UPDATE sessions SET expires_at='2000-01-01' WHERE user_id=?",
                f.users.owner.id,
              );
            else
              f.app.s.run(
                "DELETE FROM sessions WHERE user_id=?",
                f.users.owner.id,
              );
            req.end(
              JSON.stringify({
                name: "Revoked write",
                purpose: "Must never persist.",
              }),
            );
          }),
        );
        req.flushHeaders();
      });
      assert.equal(await result, 401);
      assert.equal(f.app.s.get("SELECT COUNT(*) AS n FROM projects")!.n, 0);
    }
  } finally {
    await f.stop();
  }
});

test("GitHub responses recheck session, project role and repository after provider awaits", async () => {
  let entered!: () => void, release!: () => void;
  let started: Promise<void>, gate: Promise<void>;
  const github = new GitHub(["devonalanakins/mizvo"], undefined, async () => {
    entered();
    await gate;
    return Response.json({
      path: "private.txt",
      content: Buffer.from("PRIVATE_PROVIDER_SOURCE").toString("base64"),
      encoding: "base64",
      size: 23,
    });
  });
  const f = await fixture(github);
  try {
    const p = f.app.domain.createProject(f.users.owner.id, {
      name: "Provider race",
      purpose: "Never return private evidence after access changes.",
    });
    const i = f.app.domain.invite(f.users.owner.id, p.id, {
      email: f.users.contributor.email,
      role: "contributor",
    });
    f.app.domain.accept(f.users.contributor.id, i.token);
    for (const change of ["session", "role", "repository"] as const) {
      f.app.s.run(
        "UPDATE memberships SET role='contributor' WHERE project_id=? AND user_id=?",
        p.id,
        f.users.contributor.id,
      );
      f.app.s.run(
        "INSERT OR REPLACE INTO repositories VALUES (?,?,?,?)",
        p.id,
        "devonalanakins/mizvo",
        f.users.owner.id,
        new Date().toISOString(),
      );
      const engineer = await f.login(f.users.contributor.email);
      started = new Promise((r) => {
        entered = r;
      });
      gate = new Promise((r) => {
        release = r;
      });
      const pending = f.request(
        `/projects/${p.id}/github/source?path=private.txt`,
        "GET",
        undefined,
        engineer,
      );
      await started;
      if (change === "session")
        f.app.s.run(
          "DELETE FROM sessions WHERE user_id=?",
          f.users.contributor.id,
        );
      if (change === "role")
        f.app.domain.memberUpdate(
          f.users.owner.id,
          p.id,
          f.users.contributor.id,
          { role: "client" },
        );
      if (change === "repository")
        f.app.s.run("DELETE FROM repositories WHERE project_id=?", p.id);
      release();
      const result = await pending;
      assert.equal(
        result.status,
        change === "session" ? 401 : change === "role" ? 404 : 409,
      );
      assert.equal(
        JSON.stringify(result.value).includes("PRIVATE_PROVIDER_SOURCE"),
        false,
      );
    }
  } finally {
    release?.();
    await f.stop();
  }
});

test("a password changed during scrypt verification cannot mint a stale login session", async () => {
  const f = await fixture();
  try {
    const { hashPassword } = await import("../packages/authz/security.ts");
    const replacement = hashPassword("Replacement-password-for-race-test");
    let completed = false;
    const pending = f
      .request("/login", "POST", { email: f.users.owner.email, password })
      .then((r) => {
        completed = true;
        return r;
      });
    const deadline = Date.now() + 5000;
    while (!f.app.s.get("SELECT 1 FROM rate_limits WHERE key LIKE 'login:%'")) {
      assert(
        Date.now() < deadline,
        "Login must reach its verification boundary.",
      );
      await new Promise((r) => setTimeout(r, 1));
    }
    assert.equal(
      completed,
      false,
      "Change the credential while scrypt is still pending.",
    );
    f.app.s.run(
      "UPDATE users SET password_hash=? WHERE id=?",
      replacement,
      f.users.owner.id,
    );
    const result = await pending;
    assert.equal(result.status, 401);
    assert.equal(result.headers.has("set-cookie"), false);
    assert.equal(f.app.s.get("SELECT COUNT(*) AS n FROM sessions")!.n, 0);
  } finally {
    await f.stop();
  }
});

test("V0.17 delegated tasks enforce active membership, owner changes, date validity and client isolation", async () => {
  const f = await fixture();
  try {
    const founder = await f.login(f.users.owner.email);
    const engineer = await f.login(f.users.contributor.email);
    const client = await f.login(f.users.client.email);
    const p = (
      await f.request("/projects", "POST", {
        name: "Delegation",
        purpose: "Deliver work through accountable people.",
      }, founder)
    ).value.id;
    const path = "/projects/" + p;
    for (const [user, session, role] of [
      [f.users.contributor, engineer, "contributor"],
      [f.users.client, client, "client"],
    ] as const) {
      const invitation = await f.request(
        path + "/invitations", "POST", { email: user.email, role }, founder,
      );
      assert.equal(invitation.status, 201);
      assert.equal(
        (await f.request("/invitations/accept", "POST", {
          token: invitation.value.token,
        }, session)).status,
        200,
      );
    }
    assert.equal(
      (await f.request(path + "/tasks", "POST", {
        title: "Assigned task",
        assignee_id: f.users.contributor.id,
        due_date: "2026-12-31",
        visibility: "client",
      }, founder)).status,
      201,
    );
    let room = (await f.request(path, "GET", undefined, founder)).value;
    let task = room.tasks.find((t: any) => t.title === "Assigned task");
    assert.equal(task.assignee_id, f.users.contributor.id);
    assert.equal(task.assignee_name, "Test Engineer");
    assert.equal(task.due_date, "2026-12-31");
    let projection = (await f.request("/space/projects/" + p, "GET", undefined, client)).value;
    assert.equal(projection.tasks.length, 1);
    assert.equal(projection.tasks[0].title, "Assigned task");
    assert.equal("assignee_id" in projection.tasks[0], false);
    assert.equal("assignee_name" in projection.tasks[0], false);
    assert.equal("due_date" in projection.tasks[0], false);
    assert.equal(JSON.stringify(projection).includes(f.users.contributor.id), false);
    assert.equal(
      (await f.request(path + "/tasks/" + task.id, "PATCH", {
        ...task, assignee_id: f.users.owner.id,
      }, engineer)).status,
      403,
    );
    assert.equal(
      (await f.request(path + "/tasks/" + task.id, "PATCH", {
        ...task, due_date: "2027-01-01",
      }, engineer)).status,
      403,
    );
    assert.equal(
      (await f.request(path + "/tasks/" + task.id, "PATCH", {
        ...task, status: "doing", assignee_id: undefined, due_date: undefined,
      }, engineer)).status,
      200,
    );
    assert.equal(
      (await f.request(path + "/tasks/" + task.id, "PATCH", task, founder)).status,
      409,
      "Concurrent changes must reject an obsolete task version.",
    );
    task = (await f.request(path, "GET", undefined, founder)).value.tasks[0];
    assert.equal(task.status, "doing");
    for (const invalid of ["2026-02-30", "2026-13-01", "12/31/2026", "2026-01-01T00:00"]) {
      assert.equal(
        (await f.request(path + "/tasks/" + task.id, "PATCH", {
          ...task, due_date: invalid,
        }, founder)).status,
        400,
      );
    }
    assert.equal(
      (await f.request(path + "/tasks/" + task.id, "PATCH", {
        ...task, assignee_id: f.users.client.id,
      }, founder)).status,
      400,
      "Client roles cannot receive internal assignments.",
    );
    assert.equal(
      (await f.request(path + "/tasks/" + task.id, "PATCH", {
        ...task, assignee_id: f.users.other.id,
      }, founder)).status,
      400,
      "Unrelated users cannot receive assignments.",
    );
    f.app.s.run(
      "UPDATE memberships SET expires_at='2000-01-01' WHERE project_id=? AND user_id=?",
      p, f.users.contributor.id,
    );
    room = (await f.request(path, "GET", undefined, founder)).value;
    task = room.tasks[0];
    assert.equal(task.assignee_id, null, "Expired access must hide an assignment.");
    assert.equal(task.assignee_name, null);
    assert.equal(
      (await f.request(path + "/tasks/" + task.id, "PATCH", {
        ...task, priority: "high",
      }, founder)).status,
      200,
      "The owner can clear obsolete assignments without losing the task.",
    );
    assert.equal(
      f.app.s.get("SELECT assignee_id FROM tasks WHERE id=?", task.id)!.assignee_id,
      null,
    );
    f.app.s.run(
      "UPDATE memberships SET expires_at=NULL WHERE project_id=? AND user_id=?",
      p, f.users.contributor.id,
    );
    task = (await f.request(path, "GET", undefined, founder)).value.tasks[0];
    assert.equal(
      (await f.request(path + "/tasks/" + task.id, "PATCH", {
        ...task, assignee_id: f.users.contributor.id,
      }, founder)).status,
      200,
    );
    assert.equal(
      (await f.request(path + "/members/" + f.users.contributor.id, "PATCH", {
        role: "client",
      }, founder)).status,
      200,
    );
    assert.equal(
      f.app.s.get("SELECT assignee_id FROM tasks WHERE id=?", task.id)!.assignee_id,
      null,
      "Downgrading a contributor to client must atomically unassign tasks.",
    );
    assert.equal(
      (await f.request(path + "/members/" + f.users.contributor.id, "PATCH", {
        role: "contributor",
      }, founder)).status,
      200,
    );
    task = (await f.request(path, "GET", undefined, founder)).value.tasks[0];
    assert.equal(
      (await f.request(path + "/tasks/" + task.id, "PATCH", {
        ...task, assignee_id: f.users.contributor.id,
      }, founder)).status,
      200,
    );
    assert.equal(
      (await f.request(path + "/members/" + f.users.contributor.id, "PATCH", {
        revoke: true,
      }, founder)).status,
      200,
    );
    assert.equal(
      f.app.s.get("SELECT assignee_id FROM tasks WHERE id=?", task.id)!.assignee_id,
      null,
      "Revoking project membership must atomically unassign tasks.",
    );
    task = (await f.request(path, "GET", undefined, founder)).value.tasks[0];
    assert.equal(
      (await f.request(path + "/tasks/" + task.id, "PATCH", {
        ...task, assignee_id: f.users.contributor.id,
      }, founder)).status,
      400,
    );
    projection = (await f.request("/space/projects/" + p, "GET", undefined, client)).value;
    assert.equal(projection.tasks[0].title, "Assigned task");
  } finally {
    await f.stop();
  }
});

test("V0.17 migration preserves existing tasks and refuses older release schemas", async () => {
  const { mkdirSync, copyFileSync, readdirSync } = await import("node:fs");
  const root = mkdtempSync(join(tmpdir(), "mizvo-task-upgrade-"));
  const directory = join(root, "migrations");
  const database = join(root, "database.sqlite");
  mkdirSync(directory);
  for (const name of readdirSync("packages/storage").filter((n) =>
    /^00[1-9]-.+\.sql$/.test(n),
  ))
    copyFileSync("packages/storage/" + name, join(directory, name));
  let store: Store | undefined;
  try {
    store = new Store(database, directory);
    store.run("INSERT INTO organizations VALUES ('old','Legacy')");
    const user = account(
      store, "Legacy Founder", "legacy-delegation@example.test",
      password, "old", "founder",
    );
    const { Domain } = await import("../packages/domain/service.ts");
    const project = new Domain(store, "old").createProject(user.id, {
      name: "Legacy delivery", purpose: "Preserve old task identity.",
    });
    store.run(
      "INSERT INTO tasks(id,project_id,title,milestone,status,priority,visibility,actor_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
      "task-v0-16", project.id, "Keep original task", "Plan", "todo",
      "normal", "internal", user.id, "2026-01-01", "2026-01-01",
    );
    const before = store.get("SELECT * FROM tasks WHERE id='task-v0-16'")!;
    store.close();
    store = undefined;
    store = new Store(database);
    const upgraded = store.get("SELECT * FROM tasks WHERE id='task-v0-16'")!;
    assert.equal(upgraded.assignee_id, null);
    assert.equal(upgraded.due_date, null);
    const { assignee_id, due_date, ...preserved } = upgraded;
    assert.deepEqual(preserved, before);
    assert.equal(store.get("PRAGMA integrity_check")!.integrity_check, "ok");
    assert.deepEqual(store.all("PRAGMA foreign_key_check"), []);
    store.close();
    store = undefined;
    assert.throws(() => new Store(database, directory), /does not support/);
  } finally {
    store?.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("V0.15 review migration preserves original rows, defaults private, and refuses downgrade", async () => {
  const { mkdirSync, copyFileSync, readdirSync } = await import("node:fs");
  const root = mkdtempSync(join(tmpdir(), "mizvo-review-upgrade-"));
  const directory = join(root, "migrations"),
    database = join(root, "data.sqlite");
  mkdirSync(directory);
  for (const name of readdirSync("packages/storage").filter((n) =>
    /^00[1-8]-.+\.sql$/.test(n),
  ))
    copyFileSync("packages/storage/" + name, join(directory, name));
  let store: Store | undefined;
  try {
    store = new Store(database, directory);
    store.run("INSERT INTO organizations VALUES ('old','Legacy')");
    const author = account(
      store,
      "Legacy Founder",
      "legacy-author@example.test",
      password,
      "old",
      "founder",
    );
    const reviewer = account(
      store,
      "Legacy Reviewer",
      "legacy-reviewer@example.test",
      password,
      null,
    );
    const { Domain } = await import("../packages/domain/service.ts");
    const d = new Domain(store, "old");
    const project = d.createProject(author.id, {
      name: "Legacy room",
      purpose: "Preserve original reviews.",
    });
    const release = d.release(author.id, project.id, {
      label: "Legacy version",
      summary: "Historical version",
      commit_sha: "a".repeat(40),
      rollback: "Restore snapshot",
    });
    store.run(
      "INSERT INTO release_reviews VALUES ('legacy-review',?,?, 'approved','Legacy engineering text','2026-01-01')",
      release.id,
      reviewer.id,
    );
    const original = store.get(
      "SELECT * FROM release_reviews WHERE id='legacy-review'",
    );
    store.close();
    store = undefined;
    store = new Store(database);
    const upgraded = store.get(
      "SELECT * FROM release_reviews WHERE id='legacy-review'",
    )!;
    const { audience, ...preserved } = upgraded;
    assert.equal(audience, "internal");
    assert.deepEqual(preserved, { ...original });
    assert.equal(store.get("PRAGMA integrity_check")!.integrity_check, "ok");
    assert.deepEqual(store.all("PRAGMA foreign_key_check"), []);
    store.close();
    store = undefined;
    assert.throws(() => new Store(database, directory), /does not support/);
  } finally {
    store?.close();
    rmSync(root, { recursive: true, force: true });
  }
});
