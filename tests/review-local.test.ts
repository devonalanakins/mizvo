import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, statSync } from "node:fs";
import { startLocalReview } from "../scripts/review-local.ts";

type Session = { cookie: string; csrf: string };

test("fictional local review launches real role-scoped HTTP and deletes its database", async () => {
  const review = await startLocalReview();
  try {
    assert.match(review.origin, /^http:\/\/localhost:\d+$/);
    assert.match(review.directory, /mizvo-local-review-/);
    assert(existsSync(review.database));
    assert.equal(statSync(review.directory).mode & 0o077, 0);
    for (const user of Object.values(review.users)) {
      assert.match(user.email, /@review\.example\.test$/);
      assert(user.password.length >= 32);
    }
    const url = new URL(review.origin);
    const base = `http://127.0.0.1:${url.port}/api`;
    const request = async (
      endpoint: string,
      method = "GET",
      payload?: unknown,
      session?: Session,
    ) => {
      const response = await fetch(base + endpoint, {
        method,
        headers: {
          Origin: review.origin,
          ...(payload === undefined ? {} : { "Content-Type": "application/json" }),
          ...(session
            ? { Cookie: session.cookie, "X-CSRF-Token": session.csrf }
            : {}),
        },
        ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
      });
      return {
        status: response.status,
        value: await response.json(),
        cookie: response.headers.get("set-cookie") ?? "",
      };
    };
    const login = async (role: keyof typeof review.users) => {
      const user = review.users[role];
      const result = await request("/login", "POST", user);
      assert.equal(result.status, 200);
      assert.match(result.cookie, /^mizvo_session=/);
      return {
        cookie: result.cookie.split(";")[0]!,
        csrf: result.value.csrf as string,
      };
    };
    const health = await request("/health");
    assert.equal(health.status, 200);
    assert.equal(health.value.storage, "sqlite");
    const unauthenticated = await request("/projects/" + review.projectId);
    assert.equal(unauthenticated.status, 401);
    const owner = await login("founder");
    const engineer = await login("engineer");
    const client = await login("client");
    const studioPath = "/projects/" + review.projectId;
    const spacePath = "/space/projects/" + review.projectId;
    const founderRoom = await request(studioPath, "GET", undefined, owner);
    assert.equal(founderRoom.status, 200);
    assert.equal(founderRoom.value.role, "owner");
    assert.equal(founderRoom.value.tasks.length, 2);
    assert(founderRoom.value.tasks.some((task: any) => task.assignee_name === "Fictional Engineer"));
    assert(founderRoom.value.records.some((record: any) => record.title === "INTERNAL_ONLY_REVIEW_NOTE"));

    const engineerRoom = await request(studioPath, "GET", undefined, engineer);
    assert.equal(engineerRoom.status, 200);
    assert.equal(engineerRoom.value.role, "contributor");
    const clientRoom = await request(spacePath, "GET", undefined, client);
    assert.equal(clientRoom.status, 200);
    assert.equal(clientRoom.value.role, "client");
    assert.equal(clientRoom.value.next_client_decision.title, "Is the sample brief clear?");
    assert(clientRoom.value.records.some((record: any) => record.title === "A shared fictional project update"));
    assert.equal(clientRoom.value.tasks.length, 1);
    const projection = JSON.stringify(clientRoom.value);
    assert(!projection.includes("INTERNAL_ONLY_REVIEW_NOTE"));
    assert(!projection.includes("Fictional Engineer"));
    assert(!projection.includes("assignee_id"));
    assert(!projection.includes("due_date"));
    assert.equal((await request(studioPath, "GET", undefined, client)).status, 404);
    assert.equal((await request(spacePath, "GET", undefined, engineer)).status, 404);
    assert.equal((await request(spacePath, "GET", undefined, owner)).status, 404);

    const uninvited = await request("/login", "POST", {
      email: "not-provisioned@review.example.test",
      password: "Incorrect-but-long-test-only",
    });
    assert.equal(uninvited.status, 401);
  } finally {
    await review.close();
  }
  assert.equal(existsSync(review.directory), false, "The SQLite data folder must be deleted.");
  await review.close(); // safe repeated cleanup
});

test("local review creates separate temporary databases on sequential launches", async () => {
  const a = await startLocalReview();
  try {
    const b = await startLocalReview();
    try {
      assert.notEqual(a.database, b.database);
      assert.notEqual(a.users.founder.password, b.users.founder.password);
      assert(existsSync(a.database) && existsSync(b.database));
    } finally {
      await b.close();
      assert.equal(existsSync(b.directory), false);
      assert(existsSync(a.directory));
    }
  } finally {
    await a.close();
  }
  assert.equal(existsSync(a.directory), false);
});
