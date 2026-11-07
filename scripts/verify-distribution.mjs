import { mkdtemp, cp, rm, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { once } from "node:events";
import assert from "node:assert/strict";
const temporary = await mkdtemp(join(tmpdir(), "mizvo-independent-install-"));
try {
  await cp("dist", join(temporary, "dist"), { recursive: true });
  const { application } = await import(
    pathToFileURL(join(temporary, "dist/apps/api/server.js"))
  );
  const { account } = await import(
    pathToFileURL(join(temporary, "dist/packages/authz/security.js"))
  );
  const config = {
    database: join(temporary, "persistent/mizvo.sqlite"),
    staticRoot: join(temporary, "dist/apps/web"),
    origin: "http://localhost",
    organization: "distribution",
  };
  const app = application(config);
  account(
    app.s,
    "Distribution Test",
    "distribution@example.test",
    "Ephemeral-distribution-password",
    config.organization,
    "founder",
  );
  app.server.listen(0, "127.0.0.1");
  await once(app.server, "listening");
  config.origin = "http://localhost:" + app.server.address().port;
  try {
    const health = await fetch(config.origin + "/api/health");
    assert.equal(health.status, 200);
    const served = await health.json();
    const expectedServerSha = createHash("sha256")
      .update(await readFile(join(temporary, "dist/apps/api/server.js")))
      .digest("hex");
    assert.equal(served.server_sha256, expectedServerSha);
    const site = await fetch(config.origin);
    assert.equal(site.status, 200);
    assert.match(await site.text(), /Mizvo/);
    const font = await fetch(
      config.origin + "/assets/inter-latin-400-normal.woff2",
    );
    assert.equal(font.status, 200);
    const login = await fetch(config.origin + "/api/login", {
      method: "POST",
      headers: { Origin: config.origin, "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "distribution@example.test",
        password: "Ephemeral-distribution-password",
      }),
    });
    assert.equal(login.status, 200);
    const identity = await login.json();
    const headers = {
      Origin: config.origin,
      "Content-Type": "application/json",
      Cookie: login.headers.get("set-cookie").split(";")[0],
      "X-CSRF-Token": identity.csrf,
    };
    const project = await fetch(config.origin + "/api/projects", {
      method: "POST",
      headers,
      body: JSON.stringify({
        name: "Independent artifact",
        purpose: "Run from compiled files without source or node_modules.",
      }),
    });
    assert.equal(project.status, 201);
    const p = await project.json();
    const room = await fetch(config.origin + "/api/projects/" + p.id, {
      headers,
    });
    assert.equal(room.status, 200);
    assert.equal((await room.json()).project.name, "Independent artifact");
    console.log(
      "PASS: copied compiled distribution runs with Node alone, migrations, local fonts, login, persistent project and authorized Room.",
    );
  } finally {
    await new Promise((r) => app.server.close(r));
    app.s.close();
  }
} finally {
  await rm(temporary, { recursive: true, force: true });
}
