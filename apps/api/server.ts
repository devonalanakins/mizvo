import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { readFile } from "node:fs/promises";
import { resolve, extname } from "node:path";
import { pathToFileURL } from "node:url";
import { Store, type Row } from "../../packages/storage/database.ts";
import { Domain } from "../../packages/domain/service.ts";
import { GitHub } from "./github.ts";
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
export interface Config {
  database: string;
  origin: string;
  organization: string;
  production?: boolean;
  staticRoot?: string;
  githubRepositories?: string[];
  githubToken?: string;
}
export function application(
  config: Config,
  dependencies: { github?: GitHub } = {},
) {
  const s = new Store(config.database),
    d = new Domain(s, config.organization),
    github =
      dependencies.github ??
      new GitHub(config.githubRepositories ?? [], config.githubToken);
  s.run(
    "INSERT OR IGNORE INTO organizations VALUES (?,?)",
    config.organization,
    "Mizvo",
  );
  const dummy = hashPassword("Timing-only-unusable-account-password");
  const production = config.production === true;
  assert(
    !production || config.origin.startsWith("https://"),
    500,
    "Production requires an HTTPS origin.",
  );
  const send = (res: ServerResponse, status: number, value: unknown) => {
    res.writeHead(status, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    });
    res.end(JSON.stringify(value));
  };
  async function body(req: IncomingMessage): Promise<Row> {
    assert(
      req.headers["content-type"]?.startsWith("application/json"),
      415,
      "Use JSON.",
    );
    let raw = "";
    for await (const chunk of req) {
      raw += chunk;
      assert(raw.length <= 32768, 413, "Request too large.");
    }
    try {
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
          version: "0.5.0",
          storage: "sqlite",
          release: "local-review",
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
        assert(u && valid, 401, "Email or password is incorrect.");
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
      if (mutating)
        assert(
          req.headers["x-csrf-token"] === session.csrf,
          403,
          "Session security check failed. Reload and try again.",
        );
      if (path === "/api/password" && method === "POST") {
        rate(s, `password:${user}`, 5, 900000);
        const b = await body(req);
        const old = s.get("SELECT password_hash FROM users WHERE id=?", user)!;
        assert(
          await verifyPassword(passwordValue(b.current), old.password_hash),
          403,
          "Current password is incorrect.",
        );
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
        const activity =
          !client && ids.length
            ? s.all(
                `SELECT a.action,a.project_id,a.created_at,u.name AS actor FROM audit a LEFT JOIN users u ON u.id=a.actor_id WHERE a.project_id IN (${placeholders}) ORDER BY a.sequence DESC LIMIT 10`,
                ...ids,
              )
            : [];
        send(res, 200, { decisions: pending, tasks, activity });
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
        const b = await body(req);
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
        d.accept(user, (await body(req)).token);
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
        send(res, 201, d.createProject(user, await body(req)));
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
          `SELECT r.id,r.project_id,r.kind,r.title FROM records r JOIN memberships m ON m.project_id=r.project_id JOIN projects p ON p.id=r.project_id WHERE m.user_id=? AND m.revoked_at IS NULL AND (m.expires_at IS NULL OR m.expires_at>?) AND p.organization_id=? AND (m.role<>'client' OR r.visibility='client') AND (instr(lower(r.title),lower(?))>0 OR instr(lower(r.body),lower(?))>0) LIMIT 50`,
          user,
          now(),
          config.organization,
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
        const b = await body(req);
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
        const b = await body(req);
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
      if (tail === "" && method === "GET") {
        const params = new URL(req.url!, config.origin).searchParams;
        send(
          res,
          200,
          d.room(user, project, client, {
            before: params.get("before") ?? undefined,
            kind: params.get("kind") ?? undefined,
            limit: params.has("limit")
              ? Number(params.get("limit"))
              : undefined,
          }),
        );
        return;
      }
      if (tail === "" && method === "PATCH" && !client) {
        d.projectUpdate(user, project, await body(req));
        send(res, 200, { ok: true });
        return;
      }
      if (tail === "/brief" && method === "POST" && !client) {
        send(res, 201, d.reviseBrief(user, project, await body(req)));
        return;
      }
      if (tail === "/brief/history" && method === "GET" && !client) {
        send(res, 200, d.briefHistory(user, project));
        return;
      }
      const milestone = tail.match(/^\/milestones(?:\/([^/]+))?$/);
      if (milestone && !client) {
        if (!milestone[1] && method === "POST") {
          send(res, 201, d.milestone(user, project, await body(req)));
          return;
        }
        if (milestone[1] && method === "PATCH") {
          send(
            res,
            200,
            d.milestone(user, project, await body(req), milestone[1]),
          );
          return;
        }
      }
      if (tail === "/client-decisions" && method === "POST" && !client) {
        send(res, 201, d.requestClientDecision(user, project, await body(req)));
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
            await body(req),
          );
          send(res, 200, { ok: true });
          return;
        }
        if (!client && clientDecision[2] === "cancel") {
          d.cancelClientDecision(
            user,
            project,
            clientDecision[1]!,
            await body(req),
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
        send(res, 201, d.createRecord(user, project, await body(req)));
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
            r && (!client || r.visibility === "client"),
            404,
            "Record not found.",
          );
          send(res, 200, r);
          return;
        }

        if (method === "GET" && record[2] === "/history") {
          const r = s.get(
            "SELECT visibility FROM records WHERE id=? AND project_id=?",
            recordId,
            project,
          );
          assert(
            r && (!client || r.visibility === "client"),
            404,
            "Record not found.",
          );
          send(
            res,
            200,
            s.all(
              "SELECT h.*,u.name AS actor FROM record_history h JOIN users u ON u.id=h.actor_id WHERE record_id=? ORDER BY version",
              recordId,
            ),
          );
          return;
        }
        if (method === "POST" && record[2] === "/status") {
          d.supportState(user, project, recordId, await body(req));
          send(res, 200, { ok: true });
          return;
        }
        if (method === "PATCH" && !record[2]) {
          d.editRecord(user, project, recordId, await body(req));
          send(res, 200, { ok: true });
          return;
        }
        if (method === "POST" && record[2] === "/decision" && !client) {
          d.decide(user, project, recordId, await body(req));
          send(res, 200, { ok: true });
          return;
        }
      }
      if (tail === "/invitations" && !client) {
        owner(s, project, user);
        if (method === "POST") {
          send(res, 201, d.invite(user, project, await body(req)));
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
        d.memberUpdate(user, project, member[1]!, await body(req));
        send(res, 200, { ok: true });
        return;
      }
      const task = tail.match(/^\/tasks(?:\/([^/]+))?$/);
      if (task && ["POST", "PATCH"].includes(method) && !client) {
        assert((method === "PATCH") === !!task[1], 405, "Method not allowed.");
        d.task(user, project, await body(req), task[1]);
        send(res, method === "POST" ? 201 : 200, { ok: true });
        return;
      }
      if (tail === "/releases" && method === "POST" && !client) {
        send(res, 201, d.release(user, project, await body(req)));
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
        d.reviewRelease(user, project, review[1]!, await body(req));
        send(res, 200, { ok: true });
        return;
      }
      if (tail.startsWith("/github") && !client) {
        if (tail === "/github" && method === "PUT") {
          owner(s, project, user);
          founder(s, config.organization, user);
          const repo = text((await body(req)).repository, "Repository", 150);
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
        rate(s, `github:${user}`, 60, 60000);
        const params = new URL(req.url!, config.origin).searchParams;
        if (tail === "/github") {
          send(res, 200, await github.evidence(repo.full_name));
          return;
        }
        if (tail === "/github/source") {
          send(
            res,
            200,
            await github.source(
              repo.full_name,
              params.get("path") ?? "",
              params.get("ref") ?? "HEAD",
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
            await github.read(repo.full_name, `commits/${sha}/check-runs`),
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
            await github.read(repo.full_name, `compare/${base}...${head}`),
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
  const port = Number(process.env.PORT ?? 4173);
  const app = application({
    database: process.env.MIZVO_DATABASE ?? "var/mizvo.sqlite",
    origin: process.env.MIZVO_ORIGIN ?? `http://localhost:${port}`,
    organization: process.env.MIZVO_ORGANIZATION ?? "mizvo",
    production: process.env.NODE_ENV === "production",
    githubRepositories: (process.env.MIZVO_GITHUB_REPOSITORIES ?? "")
      .split(",")
      .filter(Boolean),
    githubToken: process.env.MIZVO_GITHUB_TOKEN,
  });
  app.server.listen(port, "127.0.0.1", () =>
    console.log(`Mizvo listening at http://localhost:${port}`),
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
