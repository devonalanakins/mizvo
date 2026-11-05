import type { Store, Row } from "../storage/database.ts";
import {
  id,
  now,
  assert,
  text,
  choice,
  email,
  url,
  token,
  digest,
  membership,
  owner,
  founder,
  version,
} from "../authz/security.ts";
export class Domain {
  s: Store;
  organization: string;
  constructor(s: Store, organization: string) {
    this.s = s;
    this.organization = organization;
  }
  audit(
    project: string | null,
    actor: string | null,
    action: string,
    object: string,
  ) {
    this.s.run(
      "INSERT INTO audit(id,organization_id,project_id,actor_id,action,object_id,created_at) VALUES (?,?,?,?,?,?,?)",
      id(),
      this.organization,
      project,
      actor,
      action,
      object,
      now(),
    );
    if (project)
      for (const m of this.s.all(
        `SELECT m.user_id FROM memberships m LEFT JOIN preferences p ON p.user_id=m.user_id WHERE m.project_id=? AND m.user_id<>? AND m.revoked_at IS NULL AND (m.expires_at IS NULL OR m.expires_at>?) AND COALESCE(p.activity,1)=1`,
        project,
        actor,
        now(),
      )) {
        this.s.run(
          "INSERT INTO notifications VALUES (?,?,?,?,?,NULL)",
          id(),
          m.user_id,
          project,
          "Project updated",
          now(),
        );
      }
  }
  projects(user: string, clients = false) {
    return this.s.all(
      `SELECT p.*,m.role FROM projects p JOIN memberships m ON m.project_id=p.id WHERE m.user_id=? AND p.organization_id=? AND m.revoked_at IS NULL AND (m.expires_at IS NULL OR m.expires_at>?) ${clients ? "AND m.role='client'" : "AND m.role<>'client'"} ORDER BY p.updated_at DESC`,
      user,
      this.organization,
      now(),
    );
  }
  createProject(user: string, b: Row) {
    founder(this.s, this.organization, user);
    const p = {
      id: id(),
      name: text(b.name, "Project name", 120),
      purpose: text(b.purpose, "Purpose", 1200),
      scope: text(b.scope ?? "", "Scope", 6000, 0),
    };
    this.s.transaction(() => {
      this.s.run(
        "INSERT INTO projects(id,organization_id,name,purpose,scope,owner_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)",
        p.id,
        this.organization,
        p.name,
        p.purpose,
        p.scope,
        user,
        now(),
        now(),
      );
      this.s.run(
        "INSERT INTO memberships VALUES (?,?,?,NULL,NULL)",
        p.id,
        user,
        "owner",
      );
      this.audit(p.id, user, "project.created", p.id);
    });
    return this.s.get("SELECT * FROM projects WHERE id=?", p.id)!;
  }
  room(user: string, project: string, client = false) {
    const m = membership(this.s, project, user, !client);
    assert(
      m.organization_id === this.organization &&
        (!client || m.role === "client"),
      404,
      "Project not found.",
    );
    const p = this.s.get("SELECT * FROM projects WHERE id=?", project)!;
    const visible = client ? " AND r.visibility='client'" : "";
    const records = this.s.all(
      `SELECT r.*,u.name AS actor FROM records r JOIN users u ON u.id=r.actor_id WHERE r.project_id=?${visible} ORDER BY r.created_at,r.id`,
      project,
    );
    const tasks = this.s.all(
      `SELECT * FROM tasks WHERE project_id=?${client ? " AND visibility='client'" : ""} ORDER BY created_at,id`,
      project,
    );
    const releases: Row[] = this.s
      .all(
        `SELECT * FROM releases WHERE project_id=?${client ? " AND visibility='client'" : ""} ORDER BY created_at DESC,id`,
        project,
      )
      .map((r) => ({
        ...r,
        source_evidence: client
          ? undefined
          : this.s
              .all(
                "SELECT id,repository,commit_sha,tree_sha,ci_state,actor_id,observed_at,checks_json FROM release_source_evidence WHERE release_id=? ORDER BY observed_at DESC,id",
                r.id,
              )
              .map((row) => ({
                ...row,
                checks: JSON.parse(row.checks_json),
                checks_json: undefined,
              })),
        reviews: this.s.all(
          "SELECT rr.*,u.name AS actor FROM release_reviews rr JOIN users u ON u.id=rr.actor_id WHERE rr.release_id=?",
          r.id,
        ),
      }));
    if (client)
      return {
        project: {
          id: p.id,
          name: p.name,
          purpose: p.purpose,
          scope: p.scope,
          status: p.status,
          updated_at: p.updated_at,
        },
        role: m.role,
        records,
        tasks: tasks.map(({ id, title, milestone, status, updated_at }) => ({
          id,
          title,
          milestone,
          status,
          updated_at,
        })),
        releases: releases.map(
          ({
            id,
            label,
            summary,
            demo_url,
            artifact_url,
            created_at,
            reviews,
          }) => ({
            id,
            label,
            summary,
            demo_url,
            artifact_url,
            created_at,
            reviews,
          }),
        ),
      };
    return {
      project: p,
      role: m.role,
      records,
      tasks,
      releases,
      members: this.s.all(
        "SELECT m.role,m.user_id,m.expires_at,m.revoked_at,u.name,u.email FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.project_id=?",
        project,
      ),
      activity: this.s.all(
        "SELECT a.*,u.name AS actor FROM audit a LEFT JOIN users u ON u.id=a.actor_id WHERE a.project_id=? ORDER BY sequence DESC LIMIT 100",
        project,
      ),
      repository:
        this.s.get(
          "SELECT full_name,created_at FROM repositories WHERE project_id=?",
          project,
        ) ?? null,
    };
  }
  projectUpdate(user: string, project: string, b: Row) {
    owner(this.s, project, user);
    const status = choice(
      b.status,
      [
        "discovery",
        "scoping",
        "design",
        "engineering",
        "review",
        "delivered",
        "support",
      ],
      "project status",
    );
    this.s.transaction(() => {
      const r = this.s.run(
        "UPDATE projects SET status=?,version=version+1,updated_at=? WHERE id=? AND version=?",
        status,
        now(),
        project,
        version(b.version),
      );
      assert(r.changes, 409, "Project changed. Reload before updating.");
      this.audit(project, user, "project.status_changed", project);
    });
  }
  createRecord(user: string, project: string, b: Row) {
    const m = membership(this.s, project, user);
    const kind = choice(
      b.kind,
      ["discussion", "note", "decision", "feedback", "support", "design"],
      "record type",
    );
    assert(
      m.role !== "client" || ["feedback", "support"].includes(kind),
      403,
      "Clients can submit feedback or support requests.",
    );
    const r = {
      id: id(),
      title: text(b.title, "Title", 200),
      body: text(b.body, "Content", 12000),
      visibility:
        m.role === "client"
          ? "client"
          : choice(
              b.visibility ?? "internal",
              ["internal", "client"],
              "visibility",
            ),
      state: kind === "decision" ? "proposed" : "open",
    };
    this.s.transaction(() => {
      this.s.run(
        "INSERT INTO records VALUES (?,?,?,?,?,?,?,?,1,?,?)",
        r.id,
        project,
        kind,
        r.title,
        r.body,
        r.visibility,
        r.state,
        user,
        now(),
        now(),
      );
      this.history(r.id, user);
      this.audit(project, user, `${kind}.created`, r.id);
    });
    return { id: r.id };
  }
  history(record: string, actor: string) {
    const r = this.s.get("SELECT * FROM records WHERE id=?", record)!;
    this.s.run(
      "INSERT INTO record_history VALUES (?,?,?,?,?,?,?,?)",
      id(),
      r.id,
      r.version,
      r.title,
      r.body,
      r.state,
      actor,
      now(),
    );
  }
  editRecord(user: string, project: string, record: string, b: Row) {
    const m = membership(this.s, project, user);
    const r = this.s.get(
      "SELECT * FROM records WHERE id=? AND project_id=?",
      record,
      project,
    );
    assert(
      r && (m.role !== "client" || r.visibility === "client"),
      404,
      "Record not found.",
    );
    assert(
      r.actor_id === user || m.role === "owner",
      403,
      "Only the author or project owner may edit this record.",
    );
    const title = text(b.title, "Title", 200),
      body = text(b.body, "Content", 12000);
    this.s.transaction(() => {
      const out = this.s.run(
        "UPDATE records SET title=?,body=?,state=CASE WHEN kind='decision' THEN 'proposed' ELSE state END,version=version+1,updated_at=? WHERE id=? AND version=?",
        title,
        body,
        now(),
        record,
        version(b.version),
      );
      assert(
        out.changes,
        409,
        "This record has changed. Reload to avoid overwriting someone else’s work.",
      );
      this.history(record, user);
      this.audit(project, user, "record.edited", record);
    });
  }
  decide(user: string, project: string, record: string, b: Row) {
    owner(this.s, project, user);
    choice(b.state, ["approved", "rejected"], "decision outcome");
    this.s.transaction(() => {
      const r = this.s.run(
        "UPDATE records SET state=?,version=version+1,updated_at=? WHERE id=? AND project_id=? AND kind='decision' AND state='proposed' AND version=?",
        b.state,
        now(),
        record,
        project,
        version(b.version),
      );
      assert(
        r.changes,
        409,
        "Decision is no longer the proposed version you reviewed.",
      );
      this.history(record, user);
      this.audit(project, user, `decision.${b.state}`, record);
    });
  }
  supportState(user: string, project: string, record: string, b: Row) {
    const m = membership(this.s, project, user),
      r = this.s.get(
        "SELECT * FROM records WHERE id=? AND project_id=? AND kind='support'",
        record,
        project,
      );
    assert(
      r && (m.role !== "client" || r.visibility === "client"),
      404,
      "Support request not found.",
    );
    const state = choice(b.state, ["open", "resolved"], "support status");
    assert(
      m.role !== "client" || (r.actor_id === user && state === "open"),
      403,
      "The project team resolves support requests.",
    );
    this.s.transaction(() => {
      const result = this.s.run(
        "UPDATE records SET state=?,version=version+1,updated_at=? WHERE id=? AND version=?",
        state,
        now(),
        record,
        version(b.version),
      );
      assert(
        result.changes,
        409,
        "Support request changed. Reload before updating.",
      );
      this.history(record, user);
      this.audit(project, user, `support.${state}`, record);
    });
  }
  invite(user: string, project: string, b: Row) {
    owner(this.s, project, user);
    const address = email(b.email),
      role = choice(b.role, ["contributor", "client"], "role"),
      secret = token(),
      invitation = id();
    const expires = new Date(Date.now() + 72 * 3600000).toISOString();
    const days = Number(b.access_days ?? 30);
    assert(
      [7, 30, 90].includes(days),
      400,
      "Access duration must be 7, 30, or 90 days.",
    );
    const accessExpires = new Date(Date.now() + days * 86400000).toISOString();
    this.s.transaction(() => {
      this.s.run(
        "INSERT INTO invitations VALUES (?,?,?,?,?,?,?,?,NULL,NULL,NULL,?)",
        invitation,
        project,
        address,
        role,
        digest(secret),
        expires,
        accessExpires,
        user,
        now(),
      );
      this.audit(project, user, "invitation.created", invitation);
    });
    return {
      id: invitation,
      token: secret,
      expires_at: expires,
      access_expires_at: accessExpires,
    };
  }
  accept(user: string, secret: unknown) {
    const hash = digest(text(secret, "Invitation token", 100));
    this.s.transaction(() => {
      const i = this.s.get(
        "SELECT * FROM invitations WHERE token_hash=? AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at>?",
        hash,
        now(),
      );
      const u = this.s.get("SELECT email FROM users WHERE id=?", user)!;
      assert(
        i && i.email.toLowerCase() === u.email.toLowerCase(),
        404,
        "Invitation is invalid, expired, or belongs to another account.",
      );
      const p = this.s.get(
        "SELECT organization_id FROM projects WHERE id=?",
        i.project_id,
      );
      assert(
        p?.organization_id === this.organization,
        404,
        "Invitation is unavailable.",
      );
      const existing = this.s.get(
        "SELECT role FROM memberships WHERE project_id=? AND user_id=?",
        i.project_id,
        user,
      );
      assert(
        existing?.role !== "owner",
        409,
        "Owner access cannot be replaced by an invitation.",
      );
      this.s.run(
        "INSERT INTO memberships VALUES (?,?,?,?,NULL) ON CONFLICT(project_id,user_id) DO UPDATE SET role=excluded.role,revoked_at=NULL,expires_at=excluded.expires_at",
        i.project_id,
        user,
        i.role,
        i.access_expires_at,
      );
      this.s.run(
        "UPDATE invitations SET accepted_at=?,accepted_by=? WHERE id=?",
        now(),
        user,
        i.id,
      );
      this.audit(i.project_id, user, "invitation.accepted", i.id);
    });
  }
  memberUpdate(user: string, project: string, target: string, b: Row) {
    owner(this.s, project, user);
    const member = this.s.get(
      "SELECT * FROM memberships WHERE project_id=? AND user_id=?",
      project,
      target,
    );
    assert(
      member && member.role !== "owner",
      400,
      "The project owner cannot be changed or revoked here.",
    );
    this.s.transaction(() => {
      if (b.revoke === true) {
        this.s.run(
          "UPDATE memberships SET revoked_at=? WHERE project_id=? AND user_id=?",
          now(),
          project,
          target,
        );
        this.s.run(
          "UPDATE invitations SET revoked_at=? WHERE project_id=? AND email=(SELECT email FROM users WHERE id=?) AND accepted_at IS NULL",
          now(),
          project,
          target,
        );
      } else
        this.s.run(
          "UPDATE memberships SET role=? WHERE project_id=? AND user_id=?",
          choice(b.role, ["client", "contributor"], "role"),
          project,
          target,
        );
      this.audit(
        project,
        user,
        b.revoke ? "membership.revoked" : "membership.role_changed",
        target,
      );
    });
  }
  task(user: string, project: string, b: Row, taskId?: string) {
    const m = membership(this.s, project, user, true);
    const title = text(b.title, "Task title", 200),
      milestone = text(b.milestone ?? "Project", "Milestone", 120),
      status = choice(
        b.status ?? "todo",
        ["todo", "doing", "blocked", "review", "done"],
        "task status",
      ),
      priority = choice(b.priority ?? "normal", ["normal", "high"], "priority"),
      evidence = text(b.evidence ?? "", "Evidence", 6000, 0),
      visibility = choice(
        b.visibility ?? "internal",
        ["internal", "client"],
        "visibility",
      );
    this.s.transaction(() => {
      const old = taskId
        ? this.s.get(
            "SELECT * FROM tasks WHERE id=? AND project_id=?",
            taskId,
            project,
          )
        : undefined;
      if (taskId) assert(old, 404, "Task not found.");
      const dependency = b.depends_on
        ? this.s.get(
            "SELECT * FROM tasks WHERE id=? AND project_id=?",
            text(b.depends_on, "Dependency", 100),
            project,
          )
        : null;
      if (b.depends_on)
        assert(dependency, 400, "Dependency must belong to this project.");
      let dep = dependency;
      const visited = new Set<string>(taskId ? [taskId] : []);
      while (dep) {
        assert(
          !visited.has(dep.id),
          400,
          "Task dependencies cannot contain a cycle.",
        );
        visited.add(dep.id);
        dep = dep.depends_on
          ? this.s.get("SELECT * FROM tasks WHERE id=?", dep.depends_on)
          : undefined;
      }
      const review = b.review_required !== false;
      assert(
        m.role === "owner" || review,
        403,
        "Only the owner may waive a required task review.",
      );
      if (status === "done") {
        assert(evidence.length, 400, "Completion requires evidence.");
        assert(
          !dependency || dependency.status === "done",
          409,
          "Complete the dependency first.",
        );
        assert(
          !review || m.role === "owner",
          403,
          "The owner must review this task before completion.",
        );
      }
      const task = taskId ?? id();
      if (taskId) {
        const r = this.s.run(
          "UPDATE tasks SET title=?,milestone=?,status=?,priority=?,evidence=?,review_required=?,reviewed_by=?,depends_on=?,visibility=?,version=version+1,updated_at=? WHERE id=? AND version=?",
          title,
          milestone,
          status,
          priority,
          evidence,
          Number(review),
          status === "done" && review ? user : null,
          dependency?.id ?? null,
          visibility,
          now(),
          task,
          version(b.version),
        );
        assert(r.changes, 409, "Task changed. Reload before updating.");
      } else
        this.s.run(
          "INSERT INTO tasks VALUES (?,?,?,?,?,?,?,?,?,?,?, ?,1,?,?)",
          task,
          project,
          title,
          milestone,
          status,
          priority,
          evidence,
          Number(review),
          status === "done" && review ? user : null,
          dependency?.id ?? null,
          visibility,
          user,
          now(),
          now(),
        );
      this.audit(project, user, taskId ? "task.updated" : "task.created", task);
    });
  }
  release(user: string, project: string, b: Row) {
    owner(this.s, project, user);
    const release = id(),
      sha = text(b.commit_sha, "Commit SHA", 40, 40);
    assert(
      /^[a-f0-9]{40}$/.test(sha),
      400,
      "Use the exact 40-character Git commit SHA.",
    );
    const values = [
      release,
      project,
      text(b.label, "Version label", 100),
      text(b.summary, "Release summary", 6000),
      sha,
      url(b.demo_url ?? ""),
      url(b.artifact_url ?? ""),
      text(b.rollback, "Rollback instructions", 6000),
      choice(b.visibility ?? "internal", ["internal", "client"], "visibility"),
      user,
      now(),
    ];
    this.s.transaction(() => {
      this.s.run(
        "INSERT INTO releases VALUES (?,?,?,?,?,?,?,?,?,?,?)",
        ...values,
      );
      this.audit(project, user, "release.recorded", release);
    });
    return { id: release };
  }
  recordSourceEvidence(
    user: string,
    project: string,
    release: string,
    evidence: Row,
  ) {
    return this.s.transaction(() => {
      owner(this.s, project, user);
      const r = this.s.get(
          "SELECT commit_sha FROM releases WHERE id=? AND project_id=?",
          release,
          project,
        ),
        repo = this.s.get(
          "SELECT full_name FROM repositories WHERE project_id=?",
          project,
        );
      assert(
        r &&
          repo &&
          repo.full_name === evidence.repository &&
          r.commit_sha === evidence.commit_sha,
        409,
        "The release or repository binding changed during verification.",
      );
      const receipt = id();
      this.s.run(
        "INSERT INTO release_source_evidence VALUES (?,?,?,?,?,?,?,?,?)",
        receipt,
        release,
        evidence.repository,
        evidence.commit_sha,
        evidence.tree_sha,
        evidence.ci_state,
        JSON.stringify(evidence.checks),
        user,
        evidence.observed_at,
      );
      this.audit(project, user, "release.source_verified", receipt);
      return receipt;
    });
  }
  reviewRelease(user: string, project: string, release: string, b: Row) {
    const m = membership(this.s, project, user);
    const r = this.s.get(
      "SELECT * FROM releases WHERE id=? AND project_id=?",
      release,
      project,
    );
    assert(
      r && (m.role !== "client" || r.visibility === "client"),
      404,
      "Release not found.",
    );
    assert(
      r.actor_id !== user,
      403,
      "The release author cannot approve their own release.",
    );
    const outcome = choice(
      b.outcome,
      ["approved", "changes_requested"],
      "review outcome",
    );
    this.s.transaction(() => {
      assert(
        !this.s.get(
          "SELECT 1 FROM release_reviews WHERE release_id=? AND actor_id=?",
          release,
          user,
        ),
        409,
        "Your review of this immutable version is already recorded.",
      );
      this.s.run(
        "INSERT INTO release_reviews VALUES (?,?,?,?,?,?)",
        id(),
        release,
        user,
        outcome,
        text(b.comment, "Review comment", 2000),
        now(),
      );
      this.audit(project, user, "release.reviewed", release);
    });
  }
}
