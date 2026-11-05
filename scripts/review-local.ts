// Explicitly local and disposable Mizvo review; never connects to an existing installation.
import { randomBytes } from "node:crypto";
import { once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { application, type Config } from "../apps/api/server.ts";
import { account } from "../packages/authz/security.ts";

type Login = { email: string; password: string };
export type LocalReviewSession = {
  origin: string;
  projectId: string;
  directory: string;
  database: string;
  users: { founder: Login; engineer: Login; client: Login };
  close: () => Promise<void>;
};

const password = () => randomBytes(32).toString("base64url");
const dueDate = () =>
  new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);

/**
 * Real HTTP and Studio/Client Space, fictional identities, isolated SQLite.
 * The implementation never consults MIZVO_DATABASE or binds a public socket.
 */
export async function startLocalReview(): Promise<LocalReviewSession> {
  const directory = mkdtempSync(join(tmpdir(), "mizvo-local-review-"));
  const database = join(directory, "fictional.sqlite");
  const config: Config = {
    database,
    organization: "mizvo-fictional-local-review",
    origin: "http://localhost",
    production: false,
    githubRepositories: [],
    previewUrls: [],
  };
  let instance: ReturnType<typeof application> | undefined;
  try {
    instance = application(config);
    const users = {
      founder: { email: "founder@review.example.test", password: password() },
      engineer: { email: "engineer@review.example.test", password: password() },
      client: { email: "client@review.example.test", password: password() },
    };
    const founder = account(
      instance.s,
      "Fictional Founder",
      users.founder.email,
      users.founder.password,
      config.organization,
      "founder",
    );
    const engineer = account(
      instance.s,
      "Fictional Engineer",
      users.engineer.email,
      users.engineer.password,
      null,
    );
    const client = account(
      instance.s,
      "Fictional Client",
      users.client.email,
      users.client.password,
      null,
    );
    const service = instance.domain;
    const project = service.createProject(founder.id, {
      name: "Lighthouse — fictional client project",
      purpose: "See how Mizvo turns an idea into shared decisions and reviewed delivery.",
      scope: "A fictional demonstration only. No real provider, client or payment.",
    });
    for (const [member, role] of [
      [engineer, "contributor"],
      [client, "client"],
    ] as const) {
      const invitation = service.invite(founder.id, project.id, {
        email: member.email,
        role,
        access_days: 7,
      });
      service.accept(member.id, invitation.token);
    }
    const brief = service.briefRevision(founder.id, project.id, {
      base_revision: 0,
      problem: "A fictional community group needs a clearer process for sharing progress.",
      audience: "Fictional staff members and a fictional project sponsor.",
      outcome: "One accessible workspace with visible decisions and reviewable tasks.",
      success_criteria: "Each role can see only the project context assigned to it.",
      exclusions: "No production hosting, data collection or external accounts.",
      assumptions: "All project details and identities are invented for this local review.",
      visibility: "client",
    });
    service.createRecord(founder.id, project.id, {
      kind: "note",
      title: "INTERNAL_ONLY_REVIEW_NOTE",
      body: "This fictional internal planning note must not appear in Client Space.",
      visibility: "internal",
    });
    service.createRecord(founder.id, project.id, {
      kind: "note",
      title: "A shared fictional project update",
      body: "The sample project is ready for a role-based review.",
      visibility: "client",
    });
    const date = dueDate();
    const milestone = service.milestone(founder.id, project.id, {
      title: "Review the fictional prototype",
      summary: "Walk through a real workflow using invented data.",
      status: "active",
      visibility: "client",
      target_date: date,
    });
    service.task(founder.id, project.id, {
      title: "Check the accessible participant journey",
      milestone_id: milestone.id,
      status: "doing",
      priority: "high",
      visibility: "client",
      assignee_id: engineer.id,
      due_date: date,
      review_required: true,
    });
    service.task(founder.id, project.id, {
      title: "Verify private engineering notes remain private",
      milestone: "Internal quality",
      status: "review",
      priority: "normal",
      visibility: "internal",
      assignee_id: engineer.id,
      due_date: date,
      evidence: "This is fictional review evidence, not a passed deployment.",
    });
    service.requestClientDecision(founder.id, project.id, {
      client_id: client.id,
      title: "Is the sample brief clear?",
      body: "Review the fictional brief and record feedback for this demonstration.",
      brief_revision_id: brief.id,
    });
    instance.server.listen(0, "127.0.0.1");
    await once(instance.server, "listening");
    const address = instance.server.address();
    if (!address || typeof address === "string")
      throw new Error("Local review server has no loopback port.");
    config.origin = "http://localhost:" + address.port;
    let closing: Promise<void> | undefined;
    const active = instance;
    const close = () =>
      (closing ??= (async () => {
        try {
          await new Promise<void>((done, fail) =>
            active.server.close((error) => (error ? fail(error) : done())),
          );
        } finally {
          active.s.close();
          rmSync(directory, { recursive: true, force: true });
        }
      })());
    return {
      origin: config.origin,
      projectId: project.id,
      database,
      directory,
      users,
      close,
    };
  } catch (error) {
    if (instance) {
      if (instance.server.listening)
        await new Promise<void>((done) => instance!.server.close(() => done()));
      instance.s.close();
    }
    rmSync(directory, { recursive: true, force: true });
    throw error;
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  if (process.argv.length !== 2 || !process.stdout.isTTY || !process.stdin.isTTY) {
    console.error("Run npm run review:local in an interactive local terminal, without arguments.");
    process.exitCode = 1;
  } else {
    const session = await startLocalReview();
    console.log("LOCAL FICTIONAL REVIEW — not a public staging service");
    console.log("Open " + session.origin + "/studio");
    for (const role of ["founder", "engineer", "client"] as const) {
      const login = session.users[role];
      console.log(role + ": " + login.email + " / " + login.password);
    }
    console.log("All data stays in an isolated temporary folder and is deleted on Ctrl+C.");
    console.log("No email was sent, no real customer account was created, and no external access is granted.");
    let stopping = false;
    const stop = () => {
      if (stopping) return;
      stopping = true;
      void session.close().then(
        () => { process.exitCode = 0; },
        () => { process.exitCode = 1; },
      );
    };
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  }
}
