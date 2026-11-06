import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { readFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve, extname, isAbsolute } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { Store, type Row } from "../../packages/storage/database.ts";
import {
  Domain,
  clientRecordProjection,
  clientHistoryProjection,
} from "../../packages/domain/service.ts";
import { GitHub } from "./github.ts";
import { PreviewProbe } from "./preview.ts";
import {
  id,
  now,
  token,
  digest,
  assert,
  HttpError,
  text,
  email,
  choice,
  verifyPassword,
  passwordValue,
  hashPassword,
  membership,
  owner,
  founder,
  rate,
  version,
} from "../../packages/authz/security.ts";
// Hash the exact server entrypoint bytes once at startup. In the compiled
// distribution this is dist/apps/api/server.js; this is a fingerprint, not
// proof of the rest of the installation or a signature.
const serverFileSha256 = createHash("sha256")
  .update(readFileSync(fileURLToPath(import.meta.url)))
  .digest("hex");

export interface Config {
  database: string;
  origin: string;
  organization: string;
  production?: boolean;
  staticRoot?: string;
  githubRepositories?: string[];
  githubToken?: string;
  previewUrls?: string[];
}
export function application(
  config: Config,
  dependencies: { github?: GitHub; previewFetch?: typeof fetch } = {},
) {
  // Refuse invalid production origins before opening or migrating SQLite.
  const production = config.production === true;
  assert(
    !production || config.origin.startsWith("https://"),
    500,
    "Production requires an HTTPS origin.",
  );
  const s = new Store(config.database),
    d = new Domain(s, config.organization),
    github =
      dependencies.github ??
      new GitHub(config.githubRepositories ?? [], config.githubToken),
    previewProbe = new PreviewProbe(
      config.previewUrls ?? [],
      dependencies.previewFetch,
    );
  s.run(
    "INSERT OR IGNORE INTO organizations VALUES (?,?)",
    config.organization,
    "Mizvo",
  );
  const dummy = hashPassword("Timing-only-unusable-account-password");
  const send = (res: ServerResponse, status: number, value: unknown) => {
    res.writeHead(status, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    });
    res.end(JSON.stringify(value));
  };
  async function body(req: IncomingMessage): Promise<Row> {
    const maxBytes = 32 * 1024;
    const contentType = req.headers["content-type"]
      ?.split(";")[0]
      ?.trim()
      .toLowerCase();
    assert(contentType === "application/json", 415, "Use JSON.");
    const encoding = req.headers["content-encoding"];
    assert(
      !encoding || encoding.toLowerCase() === "identity",
      415,
      "Unsupported content encoding.",
    );
    const declaredLength = req.headers["content-length"];
    if (declaredLength !== undefined) {
      assert(/^\d+$/.test(declaredLength), 400, "Invalid content length.");
      assert(Number(declaredLength) <= maxBytes, 413, "Request too large.");
    }
    let bytes = 0;
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      const part = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      bytes += part.byteLength;
      assert(bytes <= maxBytes, 413, "Request too large.");
      chunks.push(part);
    }
    try {
      const raw = new TextDecoder("utf-8", { fatal: true }).decode(
        Buffer.concat(chunks, bytes),
      );
      const value = JSON.parse(raw || "{}");
      assert(
        value && typeof value === "object" && !Array.isArray(value),
        400,
        "Use a JSON object.",
      );
      return value;
    } catch (e) {
      if (e instanceof HttpError) throw e;
      throw new HttpError(400, "Invalid JSON.");
    }
  }
  const server = createServer(async (req, res) => {
    const requestId = id();
    res.setHeader("X-Request-ID", requestId);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader(
      "Permissions-Policy",
      "camera=(), microphone=(), geolocation=()",
    );
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; frame-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    );
    if (production)
      res.setHeader("Strict-Transport-Security", "max-age=31536000");
    try {
      const path = new URL(req.url ?? "/", config.origin).pathname,
        method = req.method ?? "GET",
        mutating = !["GET", "HEAD"].includes(method);
      if (!path.startsWith("/api/")) {
        assert(["GET", "HEAD"].includes(method), 405, "Method not allowed.");
        const root = resolve(config.staticRoot ?? "dist/apps/web");
        const name = path.startsWith("/assets/") ? path.slice(1) : "index.html";
        assert(!name.includes(".."), 404, "Not found.");
        const filename = resolve(root, name);
        assert(filename.startsWith(root + "/"), 404, "Not found.");
        const bytes = await readFile(filename).catch(() => {
          throw new HttpError(404, "Not found.");
        });
        res.writeHead(200, {
          "Content-Type":
            (
              {
                ".html": "text/html; charset=utf-8",
                ".js": "text/javascript; charset=utf-8",
                ".css": "text/css; charset=utf-8",
                ".svg": "image/svg+xml",
                ".woff2": "font/woff2",
              } as Row
            )[extname(filename)] ?? "application/octet-stream",
          "Cache-Control":
            name === "index.html" ? "no-cache" : "public, max-age=3600",
        });
        res.end(method === "HEAD" ? undefined : bytes);
        return;
      }
      if (mutating) {
        assert(
          req.headers.origin === config.origin,
          403,
          "Request origin is not allowed.",
        );
        rate(s, `write:${req.socket.remoteAddress}`, 240, 60000);
      }
      if (path === "/api/health" && method === "GET") {
        send(res, 200, {
          status: "ok",
          version: "0.20.0",
          storage: "sqlite",
          release: "local-review",
          server_sha256: serverFileSha256,
        });
        return;
      }
      // Readiness is distinct from liveness: a listening process may have
      // lost access to its database or required migration metadata.
      if (path === "/api/ready") {
        assert(method === "GET", 405, "Method not allowed.");
        let ready = false;
        try {
          const organization = s.get(
            "SELECT 1 AS present FROM organizations WHERE id=?",
            config.organization,
          );
          const migrations = s.get(
            "SELECT COUNT(*) AS applied, SUM(CASE WHEN c.version IS NULL THEN 1 ELSE 0 END) AS unmatched FROM migrations m LEFT JOIN migration_checksums c ON c.version=m.version",
          );
          // Exercise the critical auth, project and write-limit schemas without
          // reading application records. An empty installation is valid, but
          // a missing required table/column must make readiness fail closed.
          for (const query of [
            "SELECT id FROM users LIMIT 1",
            "SELECT hash FROM sessions LIMIT 1",
            "SELECT organization_id,user_id,role FROM organization_members LIMIT 1",
            "SELECT id,organization_id,owner_id,status FROM projects LIMIT 1",
            "SELECT project_id,user_id,role,revoked_at,expires_at FROM memberships LIMIT 1",
            "SELECT id,project_id,token_hash,expires_at FROM invitations LIMIT 1",
            "SELECT id,project_id,kind,visibility FROM records LIMIT 1",
            "SELECT id,project_id,status FROM tasks LIMIT 1",
            "SELECT id,project_id,visibility FROM releases LIMIT 1",
            "SELECT id,project_id,client_id,status FROM client_decision_requests LIMIT 1",
            "SELECT user_id,project_id,action FROM notifications LIMIT 1",
            "SELECT key,count,resets_at FROM rate_limits LIMIT 1",
          ])
            s.get(query);
          ready =
            organization?.present === 1 &&
            Number(migrations?.applied ?? 0) > 0 &&
            migrations?.unmatched === 0;
        } catch {
          // Never expose database errors or schema details to public probes.
        }
        send(res, ready ? 200 : 503, {
          status: ready ? "ready" : "unavailable",
        });
        return;
      }
      const cookie = req.headers.cookie
        ?.split(";")
        .map((x) => x.trim())
        .find((x) => x.startsWith("mizvo_session="))
        ?.slice(14);
      const session = cookie
        ? s.get(
            "SELECT se.*,u.name,u.email FROM sessions se JOIN users u ON u.id=se.user_id WHERE se.hash=? AND se.expires_at>?",
            digest(cookie),
            now(),
          )
        : undefined;
      if (path === "/api/login" && method === "POST") {
        const b = await body(req),
          address = email(b.email),
          password = passwordValue(b.password);
        rate(s, `login-ip:${req.socket.remoteAddress}`, 30, 900000);
        rate(s, `login:${digest(address)}`, 10, 900000);
        const u = s.get("SELECT * FROM users WHERE email=?", address);
        const valid = await verifyPassword(password, u?.password_hash ?? dummy);
        assert(
          u &&
            valid &&
            s.get("SELECT password_hash FROM users WHERE id=?", u.id)
              ?.password_hash === u.password_hash,
          401,
          "Email or password is incorrect.",
        );
        const raw = token(),
          csrf = token(),
          expires = new Date(Date.now() + 8 * 3600000).toISOString();
        s.transaction(() => {
          s.run("DELETE FROM sessions WHERE expires_at<=?", now());
          s.run(
            "INSERT INTO sessions VALUES (?,?,?,?,?)",
            digest(raw),
            u.id,
            csrf,
            now(),
            expires,
          );
        });
        res.setHeader(
          "Set-Cookie",
          `mizvo_session=${raw}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800${production ? "; Secure" : ""}`,
        );
        send(res, 200, {
          user: { id: u.id, name: u.name, email: u.email },
          csrf,
        });
        return;
      }
      if (path === "/api/inquiries" && method === "POST") {
        rate(s, `inquiry:${req.socket.remoteAddress}`, 5, 3600000);
        const b = await body(req);
        assert(!b.website, 400, "Submission could not be accepted.");
        assert(b.consent === true, 400, "Consent is required.");
        const inquiry = id();
        const values = [
          inquiry,
          config.organization,
          text(b.name, "Name", 100),
          email(b.email),
          text(b.goal, "Project goal", 2000, 10),
          text(b.details ?? "", "Details", 6000, 0),
          now(),
          now(),
        ];
        s.transaction(() => {
          s.run(
            "INSERT INTO inquiries(id,organization_id,name,email,goal,details,consent_at,created_at) VALUES (?,?,?,?,?,?,?,?)",
            ...values,
          );
          d.audit(null, null, "inquiry.received", inquiry);
        });
        send(res, 201, {
          id: inquiry,
          message: "Your inquiry has been recorded for review.",
        });
        return;
      }
      assert(session, 401, "Sign in to continue.");
      const user = session.user_id as string;
      // Authorization at request start is insufficient after an asynchronous wait.
      const checkSession = () =>
        assert(
          s.get(
            "SELECT 1 FROM sessions WHERE hash=? AND user_id=? AND csrf=? AND expires_at>?",
            session.hash,
            user,
            session.csrf,
            now(),
          ),
          401,
          "Sign in to continue.",
        );
      let checkAccess = () => {};
      const readBody = async () => {
        const value = await body(req);
        checkSession();
        checkAccess();
        return value;
      };
      if (mutating)
        assert(
          req.headers["x-csrf-token"] === session.csrf,
          403,
          "Session security check failed. Reload and try again.",
        );
      if (path === "/api/password" && method === "POST") {
        rate(s, `password:${user}`, 5, 900000);
        const b = await readBody();
        const old = s.get("SELECT password_hash FROM users WHERE id=?", user)!;
        assert(
          await verifyPassword(passwordValue(b.current), old.password_hash),
          403,
          "Current password is incorrect.",
        );
        checkSession();
        const next = hashPassword(passwordValue(b.next, 14));
        s.transaction(() => {
          const updated = s.run(
            "UPDATE users SET password_hash=? WHERE id=? AND password_hash=?",
            next,
            user,
            old.password_hash,
          );
          assert(
            updated.changes,
            409,
            "Your password changed during this request. Sign in again.",
          );
          s.run(
            "DELETE FROM sessions WHERE user_id=? AND hash<>?",
            user,
            session.hash,
          );
        });
        send(res, 200, { ok: true });
        return;
      }
      if (
        (path === "/api/home" || path === "/api/space/home") &&
        method === "GET"
      ) {
        const client = path.includes("/space/"),
          ids = d.projects(user, client).map((p) => p.id);
        const placeholders = ids.map(() => "?").join(",");
        const pending = ids.length
          ? s.all(
              `SELECT id,project_id,title,kind,state FROM records WHERE project_id IN (${placeholders}) AND kind='decision' AND state='proposed' ${client ? "AND visibility='client'" : ""} ORDER BY created_at LIMIT 10`,
              ...ids,
            )
          : [];
        const tasks = ids.length
          ? s.all(
              `SELECT id,project_id,title,status FROM tasks WHERE project_id IN (${placeholders}) AND status IN ('blocked','review') ${client ? "AND visibility='client'" : ""} ORDER BY created_at LIMIT 10`,
              ...ids,
            )
          : [];
        // Only decisions addressed to this signed-in client, in projects with
        // current active access and linked to the latest shared brief.
        // Do not surface stale, cancelled, answered, or other-client requests.
        const client_decisions =
          client && ids.length
            ? s.all(
                `SELECT d.id,d.project_id,d.title FROM client_decision_requests d
                 WHERE d.project_id IN (${placeholders}) AND d.client_id=? AND d.status='pending'
                   AND (d.brief_revision_id IS NULL OR d.brief_revision_id=(
                     SELECT br.id FROM project_brief_revisions br
                     WHERE br.project_id=d.project_id AND br.visibility='client'
                     ORDER BY br.revision DESC LIMIT 1
                   ))
                 ORDER BY d.created_at,d.id LIMIT 10`,
                ...ids,
                user,
              )
            : [];
        const activity =
          !client && ids.length
            ? s.all(
                `SELECT a.action,a.project_id,a.created_at,u.name AS actor FROM audit a LEFT JOIN users u ON u.id=a.actor_id WHERE a.project_id IN (${placeholders}) ORDER BY a.sequence DESC LIMIT 10`,
                ...ids,
              )
            : [];
        send(res, 200, {
          decisions: client ? [] : pending,
          client_decisions,
          tasks,
          activity,
        });
        return;
      }
      if (path === "/api/me" && method === "GET") {
        send(res, 200, {
          user: { id: user, name: session.name, email: session.email },
          csrf: session.csrf,
          founder: !!s.get(
            "SELECT 1 FROM organization_members WHERE organization_id=? AND user_id=? AND role='founder'",
            config.organization,
            user,
          ),
          preferences: s.get(
            "SELECT activity FROM preferences WHERE user_id=?",
            user,
          ) ?? { activity: 1 },
        });
        return;
      }
      if (path === "/api/logout" && method === "POST") {
        s.run("DELETE FROM sessions WHERE hash=?", session.hash);
        res.setHeader(
          "Set-Cookie",
          "mizvo_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0",
        );
        send(res, 200, { ok: true });
        return;
      }
      if (path === "/api/sessions" && method === "GET") {
        send(
          res,
          200,
          s.all(
            "SELECT created_at,expires_at,hash=? AS current FROM sessions WHERE user_id=? AND expires_at>?",
            session.hash,
            user,
            now(),
          ),
        );
        return;
      }
      if (path === "/api/sessions/revoke" && method === "POST") {
        s.run(
          "DELETE FROM sessions WHERE user_id=? AND hash<>?",
          user,
          session.hash,
        );
        send(res, 200, { ok: true });
        return;
      }
      if (path === "/api/preferences" && method === "PATCH") {
        const b = await readBody();
        assert(
          typeof b.activity === "boolean",
          400,
          "Choose whether activity notifications are enabled.",
        );
        s.run(
          "INSERT INTO preferences VALUES (?,?) ON CONFLICT(user_id) DO UPDATE SET activity=excluded.activity",
          user,
          Number(b.activity),
        );
        send(res, 200, { ok: true });
        return;
      }
      if (path === "/api/invitations/accept" && method === "POST") {
        d.accept(user, (await readBody()).token);
        send(res, 200, { ok: true });
        return;
      }
      if (
        (path === "/api/projects" || path === "/api/space/projects") &&
        method === "GET"
      ) {
        send(res, 200, d.projects(user, path.includes("/space/")));
        return;
      }
      if (path === "/api/projects" && method === "POST") {
        send(res, 201, d.createProject(user, await readBody()));
        return;
      }
      if (path === "/api/notifications" && method === "GET") {
        send(
          res,
          200,
          s.all(
            `SELECT n.* FROM notifications n JOIN memberships m ON m.project_id=n.project_id AND m.user_id=n.user_id JOIN projects p ON p.id=n.project_id WHERE n.user_id=? AND m.revoked_at IS NULL AND (m.expires_at IS NULL OR m.expires_at>?) AND p.organization_id=? ORDER BY n.created_at DESC LIMIT 100`,
            user,
            now(),
            config.organization,
          ),
        );
        return;
      }
      if (path === "/api/notifications/read" && method === "POST") {
        s.run(
          "UPDATE notifications SET read_at=? WHERE user_id=? AND read_at IS NULL",
          now(),
          user,
        );
        send(res, 200, { ok: true });
        return;
      }
      if (path === "/api/search" && method === "GET") {
        const q = text(
          new URL(req.url!, config.origin).searchParams.get("q") ?? "",
          "Search",
          100,
          1,
        );
        const result = s.all(
          `SELECT r.id,r.project_id,r.kind,r.title FROM records r JOIN memberships m ON m.project_id=r.project_id JOIN projects p ON p.id=r.project_id WHERE m.user_id=? AND m.revoked_at IS NULL AND (m.expires_at IS NULL OR m.expires_at>?) AND p.organization_id=? AND (m.role<>'client' OR (r.visibility='client' AND (r.kind NOT IN ('feedback','support') OR r.actor_id=?))) AND (instr(lower(r.title),lower(?))>0 OR instr(lower(r.body),lower(?))>0) LIMIT 50`,
          user,
          now(),
          config.organization,
          user,
          q,
          q,
        );
        send(res, 200, result);
        return;
      }
      if (path === "/api/pipeline" && method === "GET") {
        founder(s, config.organization, user);
        send(
          res,
          200,
          s.all(
            "SELECT * FROM inquiries WHERE organization_id=? ORDER BY created_at DESC LIMIT 100",
            config.organization,
          ),
        );
        return;
      }
      const inquiry = path.match(/^\/api\/pipeline\/([^/]+)$/);
      if (inquiry && method === "PATCH") {
        founder(s, config.organization, user);
        const b = await readBody();
        founder(s, config.organization, user);
        s.transaction(() => {
          const out = s.run(
            "UPDATE inquiries SET status=?,version=version+1 WHERE id=? AND organization_id=? AND version=?",
            choice(
              b.status,
              ["new", "qualified", "scoping", "approved", "closed"],
              "pipeline status",
            ),
            inquiry[1]!,
            config.organization,
            version(b.version),
          );
          assert(out.changes, 409, "Inquiry changed. Reload before updating.");
          d.audit(null, user, "inquiry.status_changed", inquiry[1]!);
        });
        send(res, 200, { ok: true });
        return;
      }
      const convert = path.match(/^\/api\/pipeline\/([^/]+)\/project$/);
      if (convert && method === "POST") {
        founder(s, config.organization, user);
        const b = await readBody();
        founder(s, config.organization, user);
        const i = s.get(
          "SELECT * FROM inquiries WHERE id=? AND organization_id=?",
          convert[1]!,
          config.organization,
        );
        assert(
          i && !i.project_id && i.status === "approved",
          409,
          "Approve the inquiry before creating its project.",
        );
        const p = s.transaction(() => {
          const p = d.createProject(user, {
            name: b.name,
            purpose: i.goal,
            scope: i.details,
          });
          const out = s.run(
            "UPDATE inquiries SET project_id=?,version=version+1 WHERE id=? AND project_id IS NULL",
            p.id,
            i.id,
          );
          assert(out.changes, 409, "This inquiry already has a project.");
          return p;
        });
        send(res, 201, p);
        return;
      }
      const match = path.match(/^\/api\/(space\/)?projects\/([^/]+)(.*)$/);
      assert(match, 404, "Endpoint not found.");
      const client = !!match[1],
        project = match[2]!,
        tail = match[3]!;
      const access = membership(s, project, user, !client);
      assert(
        access.organization_id === config.organization &&
          (!client || access.role === "client"),
        404,
        "Project not found.",
      );
      checkAccess = () => {
        const current = membership(s, project, user, !client);
        assert(
          current.organization_id === config.organization &&
            (!client || current.role === "client"),
          404,
          "Project not found.",
        );
      };
      if (tail === "" && method === "GET") {
        const params = new URL(req.url!, config.origin).searchParams;
        const view = d.room(user, project, client, {
          before: params.get("before") ?? undefined,
          kind: params.get("kind") ?? undefined,
          limit: params.has("limit") ? Number(params.get("limit")) : undefined,
        });
        send(
          res,
          200,
          client
            ? view
            : {
                ...view,
                releases: view.releases.map((r) => ({
                  ...r,
                  preview_probe_allowed: previewProbe.allows(r.demo_url),
                })),
              },
        );
        return;
      }
      if (tail === "" && method === "PATCH" && !client) {
        d.projectUpdate(user, project, await readBody());
        send(res, 200, { ok: true });
        return;
      }
      if (tail === "/brief-revisions" && method === "POST" && !client) {
        send(res, 201, d.briefRevision(user, project, await readBody()));
        return;
      }
      if (tail === "/ownership-plan" && method === "POST" && !client) {
        send(res, 201, d.ownershipRevision(user, project, await readBody()));
        return;
      }
      const milestone = tail.match(/^\/milestones(?:\/([^/]+))?$/);
      if (milestone && !client) {
        if (!milestone[1] && method === "POST") {
          send(res, 201, d.milestone(user, project, await readBody()));
          return;
        }
        if (milestone[1] && method === "PATCH") {
          send(
            res,
            200,
            d.milestone(user, project, await readBody(), milestone[1]),
          );
          return;
        }
      }
      if (tail === "/client-decisions" && method === "POST" && !client) {
        send(
          res,
          201,
          d.requestClientDecision(user, project, await readBody()),
        );
        return;
      }
      const clientDecision = tail.match(
        /^\/client-decisions\/([^/]+)\/(respond|cancel)$/,
      );
      if (clientDecision && method === "POST") {
        if (client && clientDecision[2] === "respond") {
          d.respondClientDecision(
            user,
            project,
            clientDecision[1]!,
            await readBody(),
          );
          send(res, 200, { ok: true });
          return;
        }
        if (!client && clientDecision[2] === "cancel") {
          d.cancelClientDecision(
            user,
            project,
            clientDecision[1]!,
            await readBody(),
          );
          send(res, 200, { ok: true });
          return;
        }
      }
      if (tail === "/records" && method === "GET") {
        const params = new URL(req.url!, config.origin).searchParams;
        send(
          res,
          200,
          d.recordPage(user, project, client, {
            before: params.get("before") ?? undefined,
            kind: params.get("kind") ?? undefined,
            limit: params.has("limit")
              ? Number(params.get("limit"))
              : undefined,
          }),
        );
        return;
      }
      if (tail === "/records" && method === "POST") {
        send(res, 201, d.createRecord(user, project, await readBody()));
        return;
      }
      const record = tail.match(
        /^\/records\/([^/]+)(\/history|\/decision|\/status)?$/,
      );
      if (record) {
        const recordId = record[1]!;
        if (method === "GET" && !record[2]) {
          const r = s.get(
            "SELECT r.*,u.name AS actor FROM records r JOIN users u ON u.id=r.actor_id WHERE r.id=? AND r.project_id=?",
            recordId,
            project,
          );
          assert(
            r &&
              (!client ||
                (r.visibility === "client" &&
                  (!["feedback", "support"].includes(r.kind) ||
                    r.actor_id === user))),
            404,
            "Record not found.",
          );
          send(res, 200, client ? clientRecordProjection(r, user) : r);
          return;
        }

        if (method === "GET" && record[2] === "/history") {
          const r = s.get(
            "SELECT visibility,kind,actor_id FROM records WHERE id=? AND project_id=?",
            recordId,
            project,
          );
          assert(
            r &&
              (!client ||
                (r.visibility === "client" &&
                  (!["feedback", "support"].includes(r.kind) ||
                    r.actor_id === user))),
            404,
            "Record not found.",
          );
          const entries = s.all(
            "SELECT h.*,u.name AS actor FROM record_history h JOIN users u ON u.id=h.actor_id WHERE record_id=? ORDER BY version",
            recordId,
          );
          send(
            res,
            200,
            client ? entries.map(clientHistoryProjection) : entries,
          );
          return;
        }
        if (method === "POST" && record[2] === "/status") {
          d.supportState(user, project, recordId, await readBody());
          send(res, 200, { ok: true });
          return;
        }
        if (method === "PATCH" && !record[2]) {
          d.editRecord(user, project, recordId, await readBody());
          send(res, 200, { ok: true });
          return;
        }
        if (method === "POST" && record[2] === "/decision" && !client) {
          d.decide(user, project, recordId, await readBody());
          send(res, 200, { ok: true });
          return;
        }
      }
      if (tail === "/invitations" && !client) {
        owner(s, project, user);
        if (method === "POST") {
          send(res, 201, d.invite(user, project, await readBody()));
          return;
        }
        if (method === "GET") {
          send(
            res,
            200,
            s.all(
              "SELECT id,email,role,expires_at,access_expires_at,accepted_at,revoked_at,created_at FROM invitations WHERE project_id=?",
              project,
            ),
          );
          return;
        }
      }
      const invitation = tail.match(/^\/invitations\/([^/]+)\/revoke$/);
      if (invitation && method === "POST" && !client) {
        owner(s, project, user);
        s.transaction(() => {
          const out = s.run(
            "UPDATE invitations SET revoked_at=? WHERE id=? AND project_id=? AND accepted_at IS NULL",
            now(),
            invitation[1]!,
            project,
          );
          assert(out.changes, 404, "Pending invitation not found.");
          d.audit(project, user, "invitation.revoked", invitation[1]!);
        });
        send(res, 200, { ok: true });
        return;
      }
      const member = tail.match(/^\/members\/([^/]+)$/);
      if (member && method === "PATCH" && !client) {
        d.memberUpdate(user, project, member[1]!, await readBody());
        send(res, 200, { ok: true });
        return;
      }
      const task = tail.match(/^\/tasks(?:\/([^/]+))?$/);
      if (task && ["POST", "PATCH"].includes(method) && !client) {
        assert((method === "PATCH") === !!task[1], 405, "Method not allowed.");
        d.task(user, project, await readBody(), task[1]);
        send(res, method === "POST" ? 201 : 200, { ok: true });
        return;
      }
      if (tail === "/releases" && method === "POST" && !client) {
        send(res, 201, d.release(user, project, await readBody()));
        return;
      }
      const observePreview = tail.match(
        /^\/releases\/([^/]+)\/observe-preview$/,
      );
      if (observePreview && method === "POST" && !client) {
        owner(s, project, user);
        rate(s, `preview:${user}`, 6, 60000);
        const release = s.get(
          "SELECT demo_url,commit_sha FROM releases WHERE id=? AND project_id=?",
          observePreview[1]!,
          project,
        );
        assert(release, 404, "Release not found.");
        assert(
          previewProbe.allows(release.demo_url),
          409,
          "Preview checks are disabled for this URL. The administrator must configure an exact public HTTPS URL first.",
        );
        const observation = await previewProbe.observe(
          release.demo_url,
          release.commit_sha,
        );
        checkSession();
        checkAccess();
        const receipt = d.recordPreviewObservation(
          user,
          project,
          observePreview[1]!,
          observation,
        );
        send(res, 201, { id: receipt, ...observation });
        return;
      }
      const verifySource = tail.match(/^\/releases\/([^/]+)\/verify-source$/);
      if (verifySource && method === "POST" && !client) {
        owner(s, project, user);
        rate(s, `github:${user}`, 60, 60000);
        const release = s.get(
            "SELECT commit_sha FROM releases WHERE id=? AND project_id=?",
            verifySource[1]!,
            project,
          ),
          repo = s.get(
            "SELECT full_name FROM repositories WHERE project_id=?",
            project,
          );
        assert(release, 404, "Release not found.");
        assert(
          repo,
          409,
          "Connect an authorized repository before verifying source.",
        );
        const evidence = await github.releaseSource(
          repo.full_name,
          release.commit_sha,
        );
        checkSession();
        checkAccess();
        const receipt = d.recordSourceEvidence(
          user,
          project,
          verifySource[1]!,
          evidence,
        );
        send(res, 201, { id: receipt, ...evidence });
        return;
      }
      const review = tail.match(/^\/releases\/([^/]+)\/review$/);
      if (review && method === "POST") {
        d.reviewRelease(user, project, review[1]!, await readBody());
        send(res, 200, { ok: true });
        return;
      }
      if (tail.startsWith("/github") && !client) {
        if (tail === "/github" && method === "PUT") {
          owner(s, project, user);
          founder(s, config.organization, user);
          const repo = text((await readBody()).repository, "Repository", 150);
          owner(s, project, user);
          founder(s, config.organization, user);
          github.allow(repo);
          s.transaction(() => {
            s.run(
              "INSERT INTO repositories VALUES (?,?,?,?) ON CONFLICT(project_id) DO UPDATE SET full_name=excluded.full_name,connected_by=excluded.connected_by,created_at=excluded.created_at",
              project,
              repo,
              user,
              now(),
            );
            d.audit(project, user, "repository.connected", project);
          });
          send(res, 200, { ok: true });
          return;
        }
        assert(method === "GET", 405, "Method not allowed.");
        const repo = s.get(
          "SELECT full_name FROM repositories WHERE project_id=?",
          project,
        );
        assert(repo, 409, "No repository is connected.");
        const readGithub = async (pending: Promise<unknown>) => {
          const value = await pending;
          checkSession();
          checkAccess();
          assert(
            s.get(
              "SELECT full_name FROM repositories WHERE project_id=?",
              project,
            )?.full_name === repo.full_name,
            409,
            "The repository binding changed during this request.",
          );
          return value;
        };
        rate(s, `github:${user}`, 60, 60000);
        const params = new URL(req.url!, config.origin).searchParams;
        if (tail === "/github") {
          send(res, 200, await readGithub(github.evidence(repo.full_name)));
          return;
        }
        if (tail === "/github/source") {
          send(
            res,
            200,
            await readGithub(
              github.source(
                repo.full_name,
                params.get("path") ?? "",
                params.get("ref") ?? "HEAD",
              ),
            ),
          );
          return;
        }
        if (tail === "/github/checks") {
          const sha = text(params.get("sha"), "Commit SHA", 40, 40);
          assert(/^[a-f0-9]{40}$/.test(sha), 400, "Invalid SHA.");
          send(
            res,
            200,
            await readGithub(
              github.read(repo.full_name, `commits/${sha}/check-runs`),
            ),
          );
          return;
        }
        if (tail === "/github/diff") {
          const base = text(params.get("base"), "Base SHA", 40, 40),
            head = text(params.get("head"), "Head SHA", 40, 40);
          assert(
            /^[a-f0-9]{40}$/.test(base) && /^[a-f0-9]{40}$/.test(head),
            400,
            "Use exact commit SHAs.",
          );
          send(
            res,
            200,
            await readGithub(
              github.read(repo.full_name, `compare/${base}...${head}`),
            ),
          );
          return;
        }
      }
      throw new HttpError(404, "Endpoint not found.");
    } catch (e) {
      const error =
        e instanceof HttpError
          ? e
          : new HttpError(500, "The request could not be completed.");
      if (error.status === 500)
        console.error(
          JSON.stringify({
            request_id: requestId,
            event: "request.failed",
            error_type: e instanceof Error ? e.name : "unknown",
          }),
        );
      if (!res.headersSent)
        send(res, error.status, {
          error: error.message,
          request_id: requestId,
        });
      else res.end();
    }
  });
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  return { server, s, domain: d };
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  // An operator may pin the server binary against a digest obtained through
  // an independent review channel. A mismatch must abort before DB startup.
  const expected = process.env.MIZVO_EXPECTED_SERVER_SHA256;
  if (
    expected !== undefined &&
    (!/^[a-f0-9]{64}$/.test(expected) || expected !== serverFileSha256)
  )
    throw new Error("Runtime server fingerprint differs from approved digest.");
  // Check the complete operator-controlled startup configuration before
  // application() opens or migrates a database. A relative fallback is fine
  // for local review, but could silently lose production data on redeploy.
  const port = Number(process.env.PORT ?? 4173);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535)
    throw new Error("PORT must be an integer between 1 and 65535.");
  const production = process.env.NODE_ENV === "production";
  const origin = process.env.MIZVO_ORIGIN ?? `http://localhost:${port}`;
  if (production && !origin.startsWith("https://"))
    throw new Error("Production requires an HTTPS origin.");
  const database = process.env.MIZVO_DATABASE ?? "var/mizvo.sqlite";
  if (
    production &&
    (!process.env.MIZVO_DATABASE || !isAbsolute(database))
  )
    throw new Error("Production requires an explicit absolute MIZVO_DATABASE path.");
  const bindHost = process.env.MIZVO_BIND_HOST ?? "127.0.0.1";
  if (bindHost !== "127.0.0.1" && bindHost !== "0.0.0.0")
    throw new Error("Unsupported bind address.");
  if (
    bindHost === "0.0.0.0" &&
    (!production || !origin.startsWith("https://"))
  )
    throw new Error(
      "Container network binding requires production HTTPS origin.",
    );
  const app = application({
    database,
    origin,
    organization: process.env.MIZVO_ORGANIZATION ?? "mizvo",
    production,
    githubRepositories: (process.env.MIZVO_GITHUB_REPOSITORIES ?? "")
      .split(",")
      .filter(Boolean),
    githubToken: process.env.MIZVO_GITHUB_TOKEN,
    previewUrls: (process.env.MIZVO_PREVIEW_URLS ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  });
  app.server.listen(port, bindHost, () =>
    console.log(`Mizvo listening on ${bindHost}:${port}`),
  );
  const stop = () => {
    app.server.close(() => {
      app.s.close();
      process.exit(0);
    });
  };
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
}
