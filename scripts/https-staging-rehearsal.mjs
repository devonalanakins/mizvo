// An ephemeral localhost HTTPS reverse-proxy test of production-mode behavior.
// Do not use this synthetic harness as an internet-facing reverse proxy.
import assert from "node:assert/strict";
import { randomBytes, createHash } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { request as httpRequest } from "node:http";
import {
  createServer as httpsServer,
  request as httpsRequest,
} from "node:https";
import { createServer as netServer } from "node:net";
import { once } from "node:events";
import {
  cp,
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";

const EVIDENCE = resolve("docs/evidence/tls-staging.json");
const PASSWORD = randomBytes(32).toString("hex");
const ROOT_LABEL = "Synthetic TLS Project";
const EMAIL = {
  owner: "tls-founder@example.test",
  client: "tls-client@example.test",
};

async function unusedPort() {
  const server = netServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert(address && typeof address !== "string");
  await new Promise((done) => server.close(done));
  return address.port;
}

function subprocess(args, cwd, env, label) {
  const result = spawnSync(args[0], args.slice(1), {
    cwd,
    env,
    encoding: "utf8",
    timeout: 30000,
    maxBuffer: 8192,
  });
  assert.equal(result.status, 0, label + " exited unsuccessfully");
}

async function waitForUpstream(port, child) {
  const start = Date.now();
  while (Date.now() - start < 12000) {
    assert(
      child.exitCode === null && child.signalCode === null,
      "Staging app quit before readiness",
    );
    try {
      const r = await fetch("http://127.0.0.1:" + port + "/api/ready", {
        signal: AbortSignal.timeout(800),
      });
      if (r.status === 200 && (await r.json()).status === "ready") return;
    } catch {
      // The loopback subprocess has not yet started listening.
    }
    await new Promise((done) => setTimeout(done, 100));
  }
  throw new Error("Staging app did not become healthy");
}

async function stopChild(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const settled = new Promise((done, reject) => {
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("Staging app failed to stop"));
    }, 5000);
    child.once("exit", (code) => {
      clearTimeout(timeout);
      code === 0
        ? done()
        : reject(new Error("Staging app exited unsuccessfully"));
    });
    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
  });
  child.kill("SIGTERM");
  await settled;
}

async function createEphemeralCertificate(folder) {
  const key = join(folder, "staging-test.key");
  const cert = join(folder, "staging-test.crt");
  subprocess(
    [
      "openssl",
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-sha256",
      "-nodes",
      "-keyout",
      key,
      "-out",
      cert,
      "-days",
      "1",
      "-subj",
      "/CN=localhost",
      "-addext",
      "subjectAltName=DNS:localhost,IP:127.0.0.1",
    ],
    folder,
    { PATH: process.env.PATH ?? "", HOME: folder },
    "Ephemeral TLS key generation",
  );
  await chmod(key, 0o600);
  return {
    key: await readFile(key),
    cert: await readFile(cert),
  };
}

function startReverseProxy(port, upstreamPort, identity) {
  const server = httpsServer(
    { ...identity, minVersion: "TLSv1.2" },
    (req, res) => {
      // The harness is not production proxy software. Restrict it to local
      // traffic and pass only headers required to exercise application controls.
      const length = Number(req.headers["content-length"] ?? 0);
      if (!Number.isSafeInteger(length) || length > 32768 || length < 0) {
        res.writeHead(413);
        res.end();
        req.resume();
        return;
      }
      if (req.headers.upgrade) {
        res.writeHead(400);
        res.end();
        return;
      }
      const keep = [
        "origin",
        "accept",
        "content-type",
        "content-length",
        "cookie",
        "x-csrf-token",
        "user-agent",
      ];
      const headers = { host: "localhost:" + upstreamPort };
      for (const name of keep) {
        const value = req.headers[name];
        if (typeof value === "string") headers[name] = value;
      }
      const upstream = httpRequest(
        {
          host: "127.0.0.1",
          port: upstreamPort,
          method: req.method,
          path: req.url,
          headers,
          timeout: 6000,
        },
        (response) => {
          res.writeHead(response.statusCode ?? 502, response.headers);
          response.pipe(res);
        },
      );
      upstream.on("error", () => {
        if (!res.headersSent) res.writeHead(502);
        if (!res.writableEnded) res.end();
      });
      req.pipe(upstream);
    },
  );
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      server.removeListener("error", reject);
      resolve(server);
    });
  });
}

async function secureRequest(port, trustedCert, path, options = {}) {
  const body = options.body === undefined ? null : JSON.stringify(options.body);
  const headers = {
    ...(body !== null ? { "Content-Type": "application/json" } : {}),
    ...(options.origin ? { Origin: options.origin } : {}),
    ...(options.cookie ? { Cookie: options.cookie } : {}),
    ...(options.csrf ? { "X-CSRF-Token": options.csrf } : {}),
    ...(body !== null ? { "Content-Length": Buffer.byteLength(body) } : {}),
  };
  return new Promise((resolve, reject) => {
    const request = httpsRequest(
      {
        host: "127.0.0.1",
        port,
        servername: options.servername ?? "localhost",
        method: options.method ?? "GET",
        path,
        headers,
        ca: trustedCert,
        rejectUnauthorized: true,
        minVersion: "TLSv1.2",
        timeout: 7000,
      },
      (response) => {
        const chunks = [];
        // Node may detach response.socket before the stream's "end" callback.
        // Capture the verified transport identity while the socket is present.
        const tls = response.socket?.getProtocol() ?? null;
        const authorized = response.socket?.authorized === true;
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () => {
          const raw = Buffer.concat(chunks).toString("utf8");
          let value = null;
          try {
            value = JSON.parse(raw);
          } catch {
            // Some routes return static HTML, not JSON.
          }
          resolve({
            status: response.statusCode,
            headers: response.headers,
            value,
            text: raw,
            tls,
            authorized,
          });
        });
      },
    );
    request.on("error", reject);
    request.on("timeout", () =>
      request.destroy(new Error("HTTPS request timed out")),
    );
    if (body !== null) request.write(body);
    request.end();
  });
}

async function main() {
  assert.equal(
    process.argv.length,
    2,
    "Synthetic TLS rehearsal takes no real client paths",
  );
  const root = await mkdtemp(join(tmpdir(), "mizvo-tls-stage-"));
  const release = join(root, "release");
  const database = join(root, "persistent", "mizvo.sqlite");
  let child;
  let proxy;
  try {
    await mkdir(release, { mode: 0o700 });
    await mkdir(join(root, "persistent"), { mode: 0o700 });
    await cp("dist", join(release, "dist"), { recursive: true });
    const artifact = createHash("sha256")
      .update(await readFile(join(release, "dist/apps/api/server.js")))
      .digest("hex");
    const identity = await createEphemeralCertificate(root);
    const port = await unusedPort();
    const tlsPort = await unusedPort();
    assert.notEqual(port, tlsPort);
    const origin = "https://localhost:" + tlsPort;
    const env = {
      PATH: process.env.PATH ?? "",
      HOME: root,
      TMPDIR: root,
      NODE_ENV: "production",
      PORT: String(port),
      MIZVO_ORIGIN: origin,
      MIZVO_DATABASE: database,
      MIZVO_EXPECTED_SERVER_SHA256: artifact,
      MIZVO_ORGANIZATION: "tls-synthetic",
      MIZVO_GITHUB_REPOSITORIES: "",
      MIZVO_PREVIEW_URLS: "",
    };
    for (const [role, email, name] of [
      ["founder", EMAIL.owner, "Synthetic Founder"],
      ["client", EMAIL.client, "Synthetic Client"],
    ]) {
      subprocess(
        [process.execPath, "dist/scripts/account.js", email, name, role],
        release,
        { ...env, MIZVO_ACCOUNT_PASSWORD: PASSWORD },
        "Synthetic identity provisioning",
      );
    }
    child = spawn(process.execPath, ["dist/apps/api/server.js"], {
      cwd: release,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout.resume();
    child.stderr.resume();
    await waitForUpstream(port, child);
    proxy = await startReverseProxy(tlsPort, port, identity);

    // Verify TLS certificate validation and real production response headers.
    await assert.rejects(
      secureRequest(tlsPort, undefined, "/api/health"),
      /certificate|self.signed|verify/i,
    );
    await assert.rejects(
      secureRequest(tlsPort, identity.cert, "/api/health", {
        servername: "incorrect.example.test",
      }),
      /altname|certificate|verify/i,
    );
    const health = await secureRequest(tlsPort, identity.cert, "/api/health");
    assert.equal(health.status, 200);
    assert.equal(health.authorized, true);
    assert.match(health.tls, /^TLSv1\.[23]$/);
    assert.equal(
      health.headers["strict-transport-security"],
      "max-age=31536000",
    );
    assert.equal(health.headers["x-frame-options"], "DENY");
    assert.match(
      health.headers["content-security-policy"],
      /default-src 'self'/,
    );
    assert.equal(health.value.storage, "sqlite");
    assert.equal(health.value.server_sha256, artifact);
    const ready = await secureRequest(tlsPort, identity.cert, "/api/ready");
    assert.equal(ready.status, 200);
    assert.deepEqual(ready.value, { status: "ready" });
    const html = await secureRequest(tlsPort, identity.cert, "/");
    assert.equal(html.status, 200);
    assert.match(html.text, /Mizvo/);

    async function login(email) {
      const r = await secureRequest(tlsPort, identity.cert, "/api/login", {
        method: "POST",
        origin,
        body: { email, password: PASSWORD },
      });
      assert.equal(r.status, 200);
      const setCookie = String(r.headers["set-cookie"]?.[0] ?? "");
      assert.match(setCookie, /HttpOnly/);
      assert.match(setCookie, /SameSite=Strict/);
      assert.match(setCookie, /; Secure/);
      const cookie = setCookie.split(";")[0];
      assert(cookie.startsWith("mizvo_session="));
      assert.equal(typeof r.value.csrf, "string");
      return { cookie, csrf: r.value.csrf };
    }
    const owner = await login(EMAIL.owner);
    const client = await login(EMAIL.client);
    const valid = await secureRequest(tlsPort, identity.cert, "/api/projects", {
      method: "POST",
      origin,
      cookie: owner.cookie,
      csrf: owner.csrf,
      body: {
        name: ROOT_LABEL,
        purpose: "Verify real HTTPS application controls.",
      },
    });
    assert.equal(valid.status, 201);
    const project = valid.value.id;
    const unauthorized = await secureRequest(
      tlsPort,
      identity.cert,
      "/api/space/projects/" + project,
      { cookie: client.cookie },
    );
    assert.equal(unauthorized.status, 404);
    const missingCsrf = await secureRequest(
      tlsPort,
      identity.cert,
      "/api/projects",
      {
        method: "POST",
        origin,
        cookie: owner.cookie,
        body: { name: "No CSRF", purpose: "Must not be created." },
      },
    );
    assert.equal(missingCsrf.status, 403);
    const wrongOrigin = await secureRequest(
      tlsPort,
      identity.cert,
      "/api/projects",
      {
        method: "POST",
        origin: "https://unexpected.example.test",
        cookie: owner.cookie,
        csrf: owner.csrf,
        body: { name: "Wrong origin", purpose: "Must not be created." },
      },
    );
    assert.equal(wrongOrigin.status, 403);
    const oversized = await secureRequest(
      tlsPort,
      identity.cert,
      "/api/projects",
      {
        method: "POST",
        origin,
        cookie: owner.cookie,
        csrf: owner.csrf,
        body: { name: "Too large", purpose: "X".repeat(35000) },
      },
    );
    assert.equal(oversized.status, 413);

    const invite = await secureRequest(
      tlsPort,
      identity.cert,
      "/api/projects/" + project + "/invitations",
      {
        method: "POST",
        origin,
        cookie: owner.cookie,
        csrf: owner.csrf,
        body: { email: EMAIL.client, role: "client" },
      },
    );
    assert.equal(invite.status, 201);
    const accepted = await secureRequest(
      tlsPort,
      identity.cert,
      "/api/invitations/accept",
      {
        method: "POST",
        origin,
        cookie: client.cookie,
        csrf: client.csrf,
        body: { token: invite.value.token },
      },
    );
    assert.equal(accepted.status, 200);
    const clientRoom = await secureRequest(
      tlsPort,
      identity.cert,
      "/api/space/projects/" + project,
      { cookie: client.cookie },
    );
    assert.equal(clientRoom.status, 200);
    const clientInternal = await secureRequest(
      tlsPort,
      identity.cert,
      "/api/projects/" + project,
      {
        cookie: client.cookie,
      },
    );
    assert.equal(clientInternal.status, 404);

    await mkdir(resolve("docs/evidence"), { recursive: true });
    await writeFile(
      EVIDENCE,
      JSON.stringify(
        {
          schema: "mizvo.tls-staging-rehearsal.v1",
          observed_at: new Date().toISOString(),
          scope:
            "Ephemeral localhost HTTPS and copied production-mode Node build only.",
          node_runtime: process.version,
          application_sha256: artifact,
          tls_protocol: health.tls,
          tls_certificate_validated: true,
          untrusted_certificate_rejected: true,
          hostname_mismatch_rejected: true,
          hsts_verified: true,
          csp_verified: true,
          secure_httponly_samesite_session_cookie_verified: true,
          origin_and_csrf_negative_tests_verified: true,
          proxy_body_limit_verified: true,
          unauthorized_client_denied_before_invitation: true,
          authorized_client_scoped_after_invitation: true,
          provider_resource_observed: false,
          public_internet_deployment: false,
          limitations: [
            "An ephemeral self-signed test certificate is not a publicly trusted production certificate.",
            "Reverse proxy is a synthetic local test harness, not reviewed production proxy configuration.",
            "No external DNS, Cloudflare account, production secret, disaster recovery or real customer handoff was verified.",
          ],
        },
        null,
        2,
      ) + "\n",
    );
    console.log(
      "PASS: real localhost HTTPS, production cookie/security controls, client authorization.",
    );
  } finally {
    if (proxy) {
      proxy.closeAllConnections();
      await new Promise((done) => proxy.close(done));
    }
    if (child) {
      try {
        await stopChild(child);
      } catch {
        child.kill("SIGKILL");
      }
    }
    await rm(root, { recursive: true, force: true });
  }
}

try {
  await main();
} catch (error) {
  console.error("FAIL: isolated HTTPS staging rehearsal:", error.message);
  process.exitCode = 1;
}
