// Synthetic-only, independent Node subprocess rehearsal. Never receives real client paths.
import assert from "node:assert/strict";
import { randomBytes, createHash } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { createServer } from "node:net";
import { once } from "node:events";
import {
  chmod,
  copyFile,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const sampleEmail = {
  founder: "synthetic-founder@example.test",
  client: "synthetic-client@example.test",
};
const password = randomBytes(32).toString("hex");
const projectLabel = "Synthetic Mizvo commissioning rehearsal";
const projectPurpose =
  "Validate an isolated client handoff and same-version restore.";
const privateTitle = "Private synthetic engineering record";
const sharedTitle = "Shared synthetic client update";
const afterSnapshotTitle = "Synthetic update written after the snapshot";
const evidenceDirectory = resolve("docs/evidence");
const marker = "mizvo.synthetic-staging-rehearsal.v1";
const durationLimitMs = 12000;

async function freeLoopbackPort() {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert(address && typeof address !== "string");
  await new Promise((done) => server.close(done));
  return address.port;
}

function isolatedEnv(root, database, port) {
  return {
    PATH: process.env.PATH ?? "",
    HOME: process.env.HOME ?? root,
    TMPDIR: root,
    PORT: String(port),
    MIZVO_ORIGIN: "http://localhost:" + port,
    MIZVO_DATABASE: database,
    MIZVO_ORGANIZATION: "mizvo-synthetic-stage",
    MIZVO_GITHUB_REPOSITORIES: "",
    MIZVO_PREVIEW_URLS: "",
    // This loopback exercise is deliberately not a public HTTPS production service.
    NODE_ENV: "test",
  };
}

function command(root, env, args) {
  const result = spawnSync(process.execPath, args, {
    cwd: root,
    env,
    encoding: "utf8",
    timeout: 30000,
    maxBuffer: 16384,
  });
  if (result.status !== 0) {
    throw new Error(
      "Isolated subprocess failed: " +
        args[0] +
        " (exit " +
        result.status +
        ").",
    );
  }
}

function stageProcess(root, env) {
  const child = spawn(process.execPath, ["dist/apps/api/server.js"], {
    cwd: root,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  // Do not publish subprocess output in CI; it could contain local operational detail.
  child.stdout.resume();
  child.stderr.resume();
  return child;
}

async function stop(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise((done, fail) => {
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      fail(
        new Error("Staging subprocess did not exit within the safety timeout."),
      );
    }, 5000);
    child.once("exit", (code, signal) => {
      clearTimeout(timeout);
      if (code === 0) done();
      else
        fail(
          new Error(
            "Staging subprocess exited unexpectedly: " + (signal ?? code),
          ),
        );
    });
    child.once("error", (error) => {
      clearTimeout(timeout);
      fail(error);
    });
  });
  child.kill("SIGTERM");
  await exited;
}

async function waitForHealth(child, origin, port) {
  const endpoint = "http://127.0.0.1:" + port + "/api/ready";
  const started = Date.now();
  while (Date.now() - started < durationLimitMs) {
    assert(
      child.exitCode === null && child.signalCode === null,
      "Staging process exited before health was ready.",
    );
    try {
      const response = await fetch(endpoint, {
        signal: AbortSignal.timeout(800),
      });
      if (response.status === 200) {
        const value = await response.json();
        assert.equal(value.status, "ok");
        assert.equal(value.storage, "sqlite");
        return;
      }
    } catch {
      // The new loopback process has not yet begun listening.
    }
    await new Promise((done) => setTimeout(done, 100));
  }
  throw new Error(
    "Staging process did not become healthy within the deadline for " + origin,
  );
}

function apiFactory(port) {
  const origin = "http://localhost:" + port;
  const base = "http://127.0.0.1:" + port;
  async function request(path, method = "GET", payload, session) {
    const response = await fetch(base + "/api" + path, {
      method,
      headers: {
        Origin: origin,
        ...(payload !== undefined
          ? { "Content-Type": "application/json" }
          : {}),
        ...(session
          ? { Cookie: session.cookie, "X-CSRF-Token": session.csrf }
          : {}),
      },
      ...(payload !== undefined ? { body: JSON.stringify(payload) } : {}),
      signal: AbortSignal.timeout(4000),
    });
    const result = await response.json();
    return {
      status: response.status,
      value: result,
      headers: response.headers,
    };
  }
  async function login(email, secret) {
    const response = await request("/login", "POST", {
      email,
      password: secret,
    });
    assert.equal(response.status, 200, "Synthetic account login failed.");
    const cookie = response.headers.get("set-cookie")?.split(";")[0];
    assert(cookie && typeof response.value.csrf === "string");
    return { cookie, csrf: response.value.csrf };
  }
  async function required(path, expected, method = "GET", payload, session) {
    const response = await request(path, method, payload, session);
    assert.equal(
      response.status,
      expected,
      "HTTP " + method + " " + path + " returned " + response.status,
    );
    return response.value;
  }
  return { login, required };
}

async function main() {
  assert.equal(
    process.argv.length,
    2,
    "This automated rehearsal accepts no user-provided paths.",
  );
  const source = resolve("dist");
  const root = await mkdtemp(join(tmpdir(), "mizvo-synthetic-stage-"));
  const first = join(root, "release-one");
  const second = join(root, "release-two");
  const persistent = join(root, "persistent");
  const privateBackups = join(root, "private-backups");
  const recovery = join(root, "recovery");
  const sourceDatabase = join(persistent, "source.sqlite");
  const snapshot = join(privateBackups, "snapshot.sqlite");
  const restoredDatabase = join(recovery, "restored.sqlite");
  let child;
  try {
    await Promise.all([
      mkdir(first, { mode: 0o700 }),
      mkdir(second, { mode: 0o700 }),
      mkdir(persistent, { mode: 0o700 }),
      mkdir(privateBackups, { mode: 0o700 }),
      mkdir(recovery, { mode: 0o700 }),
    ]);
    await cp(source, join(first, "dist"), { recursive: true });
    await cp(source, join(second, "dist"), { recursive: true });
    const bytesOne = await readFile(join(first, "dist/apps/api/server.js"));
    const bytesTwo = await readFile(join(second, "dist/apps/api/server.js"));
    const artifactSha = createHash("sha256").update(bytesOne).digest("hex");
    assert.equal(
      artifactSha,
      createHash("sha256").update(bytesTwo).digest("hex"),
    );

    const port = await freeLoopbackPort();
    const firstEnv = isolatedEnv(root, sourceDatabase, port);
    command(first, { ...firstEnv, MIZVO_ACCOUNT_PASSWORD: password }, [
      "dist/scripts/account.js",
      sampleEmail.founder,
      "Synthetic Founder",
      "founder",
    ]);
    command(first, { ...firstEnv, MIZVO_ACCOUNT_PASSWORD: password }, [
      "dist/scripts/account.js",
      sampleEmail.client,
      "Synthetic Client",
      "client",
    ]);
    child = stageProcess(first, firstEnv);
    await waitForHealth(child, firstEnv.MIZVO_ORIGIN, port);
    const firstApi = apiFactory(port);
    const page = await fetch("http://127.0.0.1:" + port + "/");
    assert.equal(page.status, 200);
    assert.match(await page.text(), /Mizvo/);
    const owner = await firstApi.login(sampleEmail.founder, password);
    const client = await firstApi.login(sampleEmail.client, password);
    const created = await firstApi.required(
      "/projects",
      201,
      "POST",
      {
        name: projectLabel,
        purpose: projectPurpose,
      },
      owner,
    );
    const project = created.id;
    assert.equal(typeof project, "string");
    await firstApi.required(
      "/projects/" + project + "/records",
      201,
      "POST",
      {
        kind: "note",
        title: privateTitle,
        body: "Fictional operational detail, not customer data.",
        visibility: "internal",
      },
      owner,
    );
    await firstApi.required(
      "/projects/" + project + "/records",
      201,
      "POST",
      {
        kind: "note",
        title: sharedTitle,
        body: "A safe, original fictional commissioning update.",
        visibility: "client",
      },
      owner,
    );
    await firstApi.required(
      "/projects/" + project + "/ownership-plan",
      201,
      "POST",
      {
        base_revision: 0,
        hosting_model: "client_owned_mizvo_operated",
        planned_domain: "staging.example.test",
        infrastructure_owner: "Example Customer (synthetic only)",
        billing_owner: "Example Customer (synthetic only)",
        operator: "Mizvo (proposed)",
        export_plan: "Portable handoff would require a signed client scope.",
        support_scope: "No actual support arrangement exists.",
        visibility: "client",
      },
      owner,
    );
    const invitation = await firstApi.required(
      "/projects/" + project + "/invitations",
      201,
      "POST",
      {
        email: sampleEmail.client,
        role: "client",
      },
      owner,
    );
    assert.equal(typeof invitation.token, "string");
    // A provisioned identity is not an authorized project member until
    // the specific one-time invitation is accepted.
    await firstApi.required(
      "/space/projects/" + project,
      404,
      "GET",
      undefined,
      client,
    );
    await firstApi.required(
      "/invitations/accept",
      200,
      "POST",
      { token: invitation.token },
      client,
    );
    const clientBefore = await firstApi.required(
      "/space/projects/" + project,
      200,
      "GET",
      undefined,
      client,
    );
    assert.equal(
      clientBefore.ownership.hosting_model,
      "client_owned_mizvo_operated",
    );
    assert.equal(clientBefore.ownership.verification_status, "not_verified");
    assert(!JSON.stringify(clientBefore).includes(privateTitle));
    assert(clientBefore.records.some((item) => item.title === sharedTitle));
    await firstApi.required(
      "/projects/" + project,
      404,
      "GET",
      undefined,
      client,
    );

    // Create a snapshot through the real built CLI while the service is still active.
    command(first, firstEnv, ["dist/scripts/backup.js", snapshot]);
    command(first, firstEnv, [
      "dist/scripts/recovery-drill.js",
      snapshot,
      recovery,
    ]);
    const originalSnapshotSha = createHash("sha256")
      .update(await readFile(snapshot))
      .digest("hex");
    await firstApi.required(
      "/projects/" + project + "/records",
      201,
      "POST",
      {
        kind: "note",
        title: afterSnapshotTitle,
        body: "This later write must be absent from a snapshot rollback.",
        visibility: "internal",
      },
      owner,
    );
    const afterWrite = await firstApi.required(
      "/projects/" + project,
      200,
      "GET",
      undefined,
      owner,
    );
    assert(
      afterWrite.records.some((item) => item.title === afterSnapshotTitle),
    );
    await stop(child);
    child = undefined;

    await copyFile(snapshot, restoredDatabase, fsConstants.COPYFILE_EXCL);
    await chmod(restoredDatabase, 0o600);
    const restored = new DatabaseSync(restoredDatabase);
    try {
      restored.exec("PRAGMA foreign_keys=ON");
      assert.equal(
        restored.prepare("PRAGMA integrity_check").get()?.integrity_check,
        "ok",
      );
      assert.equal(
        restored.prepare("PRAGMA foreign_key_check").all().length,
        0,
      );
      assert(
        restored.prepare("SELECT COUNT(*) AS count FROM sessions").get()
          .count >= 2,
      );
      restored.exec("BEGIN IMMEDIATE");
      try {
        restored.exec("DELETE FROM sessions");
        restored.exec("COMMIT");
      } catch (error) {
        restored.exec("ROLLBACK");
        throw error;
      }
      assert.equal(
        restored.prepare("SELECT COUNT(*) AS count FROM sessions").get().count,
        0,
      );
    } finally {
      restored.close();
    }
    const secondEnv = isolatedEnv(root, restoredDatabase, port);
    child = stageProcess(second, secondEnv);
    await waitForHealth(child, secondEnv.MIZVO_ORIGIN, port);
    const secondApi = apiFactory(port);
    await secondApi.required("/me", 401, "GET", undefined, owner);
    await secondApi.required("/me", 401, "GET", undefined, client);
    const ownerAfter = await secondApi.login(sampleEmail.founder, password);
    const clientAfter = await secondApi.login(sampleEmail.client, password);
    const room = await secondApi.required(
      "/projects/" + project,
      200,
      "GET",
      undefined,
      ownerAfter,
    );
    assert.equal(room.project.name, projectLabel);
    assert(room.records.some((item) => item.title === privateTitle));
    assert(room.records.some((item) => item.title === sharedTitle));
    assert(!room.records.some((item) => item.title === afterSnapshotTitle));
    const clientRoom = await secondApi.required(
      "/space/projects/" + project,
      200,
      "GET",
      undefined,
      clientAfter,
    );
    assert.equal(clientRoom.ownership.verification_status, "not_verified");
    assert(!JSON.stringify(clientRoom).includes(privateTitle));
    assert(!JSON.stringify(clientRoom).includes(afterSnapshotTitle));
    await secondApi.required(
      "/projects/" + project,
      404,
      "GET",
      undefined,
      clientAfter,
    );
    assert.equal(
      createHash("sha256")
        .update(await readFile(snapshot))
        .digest("hex"),
      originalSnapshotSha,
      "The rehearsal must not mutate the snapshot.",
    );
    await stop(child);
    child = undefined;

    const receipt = {
      schema: marker,
      observed_at: new Date().toISOString(),
      scope:
        "Loopback-only synthetic Node/SQLite process rehearsal; not deployed staging.",
      runtime: process.version,
      binary_sha256: artifactSha,
      sample_project_count: 1,
      self_contained_snapshot_sha256: originalSnapshotSha,
      startup_health_checked: true,
      compiled_assets_checked: true,
      separate_synthetic_identities_checked: true,
      server_side_client_projection_checked: true,
      private_record_non_disclosure_checked: true,
      online_backup_and_isolated_recovery_drill_checked: true,
      process_restart_with_separate_restored_database_checked: true,
      restored_sessions_invalidated_checked: true,
      snapshot_rollback_discarded_later_write: true,
      no_real_client_data_processed: true,
      external_infrastructure_provisioned: false,
      limitations: [
        "The original release and restored release use identical compiled code; schema downgrade was not exercised.",
        "This is a synthetic loopback smoke test, not a public deployment or TLS verification.",
        "Backup storage, independent restore, key management, client approval and on-call support are not verified.",
      ],
    };
    await mkdir(evidenceDirectory, { recursive: true });
    await writeFile(
      join(evidenceDirectory, "staging-rehearsal.json"),
      JSON.stringify(receipt, null, 2) + "\n",
    );
    console.log(
      "PASS: synthetic, compiled, isolated staging startup -> backup -> session-safe restore -> rollback.",
    );
  } finally {
    if (child) {
      await stop(child).catch(() => child.kill("SIGKILL"));
    }
    await rm(root, { recursive: true, force: true });
  }
}

try {
  await main();
} catch (error) {
  // Keep synthetic passwords, session cookies and record contents out of CI logs.
  console.error("FAIL: synthetic staging rehearsal:", error.message);
  process.exitCode = 1;
}
