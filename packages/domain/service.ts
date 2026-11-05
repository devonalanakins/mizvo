import type { Store, Row } from "../storage/database.ts";
import type { PreviewObservation } from "./preview-evidence.ts";
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
  recordPage(
    user: string,
    project: string,
    client = false,
    options: { before?: string; kind?: string; limit?: number } = {},
  ) {
    const m = membership(this.s, project, user, !client);
    assert(
      m.organization_id === this.organization &&
        (!client || m.role === "client"),
      404,
      "Project not found.",
    );
    const kind = choice(
        options.kind ?? "",
        [
          "",
          "shared",
          "note",
          "design",
          "discussion",
          "decision",
          "feedback",
          "support",
        ],
        "record filter",
      ),
      limit = options.limit ?? 50;
    assert(
      Number.isInteger(limit) && limit >= 1 && limit <= 100,
      400,
      "Page size must be between 1 and 100.",
    );
    const values: any[] = [project];
    let where = client ? " AND r.visibility='client'" : "";
    if (kind === "shared")
      where +=
        " AND r.visibility='client' AND r.kind NOT IN ('feedback','support')";
    else if (kind) {
      where += " AND r.kind=?";
      values.push(kind);
    }
    if (options.before) {
      let cursor;
      try {
        assert(
          options.before.length <= 1000 &&
            /^[A-Za-z0-9_-]+$/.test(options.before),
          400,
          "Invalid record cursor.",
        );
        cursor = JSON.parse(
          Buffer.from(options.before, "base64url").toString("utf8"),
        );
      } catch {
        assert(false, 400, "Invalid record cursor.");
      }
      assert(
        cursor &&
          cursor.project === project &&
          cursor.kind === kind &&
          cursor.client === client &&
          typeof cursor.at === "string" &&
          /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(cursor.at) &&
          typeof cursor.id === "string" &&
          /^[a-f0-9-]{36}$/.test(cursor.id),
        400,
        "Invalid record cursor for this view.",
      );
      where += " AND (r.created_at<? OR (r.created_at=? AND r.id<?))";
      values.push(cursor.at, cursor.at, cursor.id);
    }
    const newest = this.s.all(
      `SELECT r.*,u.name AS actor FROM records r JOIN users u ON u.id=r.actor_id WHERE r.project_id=?${where} ORDER BY r.created_at DESC,r.id DESC LIMIT ?`,
      ...values,
      limit + 1,
    );
    const more = newest.length > limit,
      records = newest.slice(0, limit).reverse(),
      oldest = records[0];
    return {
      records,
      record_page: {
        has_more: more,
        next_cursor:
          more && oldest
            ? Buffer.from(
                JSON.stringify({
                  project,
                  kind,
                  client,
                  at: oldest.created_at,
                  id: oldest.id,
                }),
              ).toString("base64url")
            : null,
        limit,
      },
    };
  }
  room(
    user: string,
    project: string,
    client = false,
    options: { before?: string; kind?: string; limit?: number } = {},
  ) {
    const m = membership(this.s, project, user, !client);
    assert(
      m.organization_id === this.organization &&
        (!client || m.role === "client"),
      404,
      "Project not found.",
    );
    const p = this.s.get("SELECT * FROM projects WHERE id=?", project)!;
    const { records, record_page } = this.recordPage(
      user,
      project,
      client,
      options,
    );
    const activeMembers = new Map(
      this.s
        .all(
          "SELECT m.user_id,u.name FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.project_id=? AND m.role IN ('owner','contributor') AND m.revoked_at IS NULL AND (m.expires_at IS NULL OR m.expires_at>?)",
          project,
          now(),
        )
        .map((r) => [r.user_id, r.name]),
    );
    const tasks: Row[] = this.s
      .all(
        `SELECT * FROM tasks WHERE project_id=?${client ? " AND visibility='client'" : ""} ORDER BY created_at,id`,
        project,
      )
      .map((t) => ({
        ...t,
        assignee_id: activeMembers.has(t.assignee_id) ? t.assignee_id : null,
        assignee_name: activeMembers.get(t.assignee_id) ?? null,
      }));
    const milestones = this.s.all(
      `SELECT * FROM project_milestones WHERE project_id=?${client ? " AND visibility='client'" : ""} ORDER BY target_date IS NULL,target_date,created_at,id`,
      project,
    );
    const brief_revisions = this.s.all(
      "SELECT * FROM project_brief_revisions WHERE project_id=? ORDER BY revision DESC",
      project,
    );
    const shared_brief =
      brief_revisions.find((r) => r.visibility === "client") ?? null;
    const brief = client ? shared_brief : (brief_revisions[0] ?? null);
    const ownership_revisions = this.s.all(
      "SELECT * FROM project_ownership_revisions WHERE project_id=? ORDER BY revision DESC",
      project,
    );
    const shared_ownership =
      ownership_revisions.find((r) => r.visibility === "client") ?? null;
    const ownership = client
      ? shared_ownership
      : (ownership_revisions[0] ?? null);
    const client_decisions = this.clientDecisions(user, project, client);
    const next_client_decision =
      client_decisions.find((r) => r.status === "pending" && r.current) ?? null;
    const releases: Row[] = this.s
      .all(
        `SELECT * FROM releases WHERE project_id=?${client ? " AND visibility='client'" : ""} ORDER BY created_at DESC,id`,
        project,
      )
      .map((r) => ({
        ...r,
        review_recorded: !!this.s.get(
          "SELECT 1 FROM release_reviews WHERE release_id=? AND actor_id=?",
          r.id,
          user,
        ),
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
        preview_observations: this.s
          .all(
            "SELECT id,result,http_status,reported_commit,commit_matches,actor_id,observed_at,preview_url,expected_commit FROM preview_observations WHERE project_id=? AND release_id=? ORDER BY observed_at DESC,id DESC LIMIT 5",
            project,
            r.id,
          )
          .map((p) =>
            client
              ? {
                  result: p.result,
                  http_status: p.http_status,
                  observed_at: p.observed_at,
                }
              : p,
          ),
        reviews: this.s.all(
          `SELECT rr.*,u.name AS actor FROM release_reviews rr JOIN users u ON u.id=rr.actor_id WHERE rr.release_id=?${client ? " AND rr.audience='client' AND rr.actor_id=?" : ""}`,
          r.id,
          ...(client ? [user] : []),
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
        record_page,
        tasks: tasks.map(
          ({ id, title, milestone, milestone_id, status, updated_at }) => ({
            id,
            title,
            milestone,
            milestone_id,
            status,
            updated_at,
          }),
        ),
        milestones: milestones.map(
          ({ id, title, summary, status, target_date, updated_at }) => ({
            id,
            title,
            summary,
            status,
            target_date,
            updated_at,
          }),
        ),
        brief: brief
          ? {
              id: brief.id,
              revision: brief.revision,
              problem: brief.problem,
              audience: brief.audience,
              outcome: brief.outcome,
              success_criteria: brief.success_criteria,
              exclusions: brief.exclusions,
              assumptions: brief.assumptions,
              created_at: brief.created_at,
            }
          : null,
        client_decisions,
        next_client_decision,
        ownership: ownership
          ? {
              revision: ownership.revision,
              hosting_model: ownership.hosting_model,
              planned_domain: ownership.planned_domain,
              infrastructure_owner: ownership.infrastructure_owner,
              billing_owner: ownership.billing_owner,
              operator: ownership.operator,
              export_plan: ownership.export_plan,
              support_scope: ownership.support_scope,
              created_at: ownership.created_at,
              verification_status: "not_verified",
            }
          : null,
        releases: releases.map(
          ({
            id,
            label,
            summary,
            demo_url,
            artifact_url,
            created_at,
            reviews,
            preview_observations,
            review_recorded,
          }) => ({
            id,
            label,
            summary,
            demo_url,
            artifact_url,
            created_at,
            reviews,
            preview_observations,
            review_recorded,
          }),
        ),
      };
    return {
      project: p,
      role: m.role,
      records,
      record_page,
      pending_decisions: this.s.get(
        "SELECT COUNT(*) AS count FROM records WHERE project_id=? AND kind='decision' AND state='proposed'",
        project,
      )!.count,
      next_decision:
        this.s.get(
          "SELECT id,title FROM records WHERE project_id=? AND kind='decision' AND state='proposed' ORDER BY created_at,id LIMIT 1",
          project,
        ) ?? null,
      tasks,
      milestones,
      brief,
      shared_brief,
      brief_revisions,
      ownership,
      ownership_revisions,
      client_decisions,
      next_client_decision,
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
  ownershipRevision(user: string, project: string, b: Row) {
    const access = owner(this.s, project, user);
    assert(
      access.organization_id === this.organization,
      404,
      "Project not found.",
    );
    const hostingModel = choice(
        b.hosting_model,
        [
          "undecided",
          "client_owned_mizvo_operated",
          "mizvo_hosted",
          "client_self_hosted",
        ],
        "hosting arrangement",
      ),
      plannedDomain = text(b.planned_domain ?? "", "Planned domain", 255, 0),
      infrastructureOwner = text(
        b.infrastructure_owner ?? "",
        "Infrastructure owner",
        180,
        0,
      ),
      billingOwner = text(b.billing_owner ?? "", "Billing owner", 180, 0),
      operator = text(b.operator ?? "", "Technical operator", 180, 0),
      exportPlan = text(b.export_plan ?? "", "Data export plan", 2000, 0),
      supportScope = text(b.support_scope ?? "", "Support scope", 2000, 0),
      visibility = choice(
        b.visibility ?? "internal",
        ["internal", "client"],
        "visibility",
      ),
      base = Number(b.base_revision);
    assert(
      Number.isSafeInteger(base) && base >= 0 && base <= 100000,
      400,
      "An exact current ownership plan revision is required.",
    );
    return this.s.transaction(() => {
      const latest = this.s.get(
        "SELECT COALESCE(MAX(revision),0) AS revision FROM project_ownership_revisions WHERE project_id=?",
        project,
      )!.revision;
      assert(
        latest === base,
        409,
        "Ownership plan changed. Reload before saving another revision.",
      );
      const key = id(),
        stamp = now();
      this.s.run(
        "INSERT INTO project_ownership_revisions(id,project_id,revision,hosting_model,planned_domain,infrastructure_owner,billing_owner,operator,export_plan,support_scope,visibility,actor_id,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
        key,
        project,
        latest + 1,
        hostingModel,
        plannedDomain,
        infrastructureOwner,
        billingOwner,
        operator,
        exportPlan,
        supportScope,
        visibility,
        user,
        stamp,
      );
      this.audit(project, user, "ownership.plan_revised", key);
      return {
        id: key,
        revision: latest + 1,
        verification_status: "not_verified",
      };
    });
  }
  briefRevision(user: string, project: string, b: Row) {
    const access = owner(this.s, project, user);
    assert(
      access.organization_id === this.organization,
      404,
      "Project not found.",
    );
    const problem = text(b.problem, "Problem to solve", 3000),
      audience = text(b.audience, "People affected", 2000),
      outcome = text(b.outcome, "Desired outcome", 3000),
      success = text(b.success_criteria, "How success will be checked", 3000),
      exclusions = text(b.exclusions ?? "", "Outside scope", 3000, 0),
      assumptions = text(b.assumptions ?? "", "Assumptions", 3000, 0),
      visibility = choice(
        b.visibility ?? "internal",
        ["internal", "client"],
        "visibility",
      ),
      base = Number(b.base_revision);
    assert(
      Number.isSafeInteger(base) && base >= 0 && base <= 100000,
      400,
      "An exact current brief revision is required.",
    );
    return this.s.transaction(() => {
      const latest = this.s.get(
        "SELECT COALESCE(MAX(revision),0) AS revision FROM project_brief_revisions WHERE project_id=?",
        project,
      )!.revision;
      assert(
        latest === base,
        409,
        "Brief changed. Reload before saving another revision.",
      );
      const key = id(),
        revision = latest + 1,
        stamp = now();
      this.s.run(
        "INSERT INTO project_brief_revisions(id,project_id,revision,problem,audience,outcome,success_criteria,exclusions,assumptions,visibility,actor_id,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
        key,
        project,
        revision,
        problem,
        audience,
        outcome,
        success,
        exclusions,
        assumptions,
        visibility,
        user,
        stamp,
      );
      this.audit(project, user, "brief.revised", key);
      return { id: key, revision };
    });
  }
  clientDecisions(user: string, project: string, client: boolean): Row[] {
    const grant = membership(this.s, project, user, !client);
    assert(
      grant.organization_id === this.organization &&
        (!client || grant.role === "client"),
      404,
      "Project not found.",
    );
    const shared = this.s.get(
      "SELECT id FROM project_brief_revisions WHERE project_id=? AND visibility='client' ORDER BY revision DESC LIMIT 1",
      project,
    )?.id;
    const rows = client
      ? this.s.all(
          "SELECT d.id,d.title,d.body,d.status,d.version,d.brief_revision_id,d.release_id,br.revision AS brief_revision,d.created_at,d.updated_at,r.outcome,r.comment,r.created_at AS answered_at FROM client_decision_requests d LEFT JOIN project_brief_revisions br ON br.id=d.brief_revision_id LEFT JOIN client_decision_responses r ON r.request_id=d.id WHERE d.project_id=? AND d.client_id=? ORDER BY d.created_at DESC,d.id DESC",
          project,
          user,
        )
      : this.s.all(
          "SELECT d.*,br.revision AS brief_revision,u.name AS recipient,r.outcome,r.comment,r.created_at AS answered_at,r.request_version FROM client_decision_requests d LEFT JOIN project_brief_revisions br ON br.id=d.brief_revision_id JOIN users u ON u.id=d.client_id LEFT JOIN client_decision_responses r ON r.request_id=d.id WHERE d.project_id=? ORDER BY d.created_at DESC,d.id DESC",
          project,
        );
    return rows.map((r) => ({
      ...r,
      current: !r.brief_revision_id || r.brief_revision_id === shared,
    }));
  }
  requestClientDecision(user: string, project: string, b: Row) {
    const grant = owner(this.s, project, user);
    assert(
      grant.organization_id === this.organization,
      404,
      "Project not found.",
    );
    const recipient = text(b.client_id, "Client", 100),
      title = text(b.title, "Decision request title", 200),
      body = text(b.body, "Decision request", 6000);
    return this.s.transaction(() => {
      const active = this.s.get(
        "SELECT 1 FROM memberships WHERE project_id=? AND user_id=? AND role='client' AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at>?)",
        project,
        recipient,
        now(),
      );
      assert(active, 400, "Select a client with active project access.");
      const briefId = b.brief_revision_id
        ? text(b.brief_revision_id, "Brief revision", 100)
        : null;
      const releaseId = b.release_id
        ? text(b.release_id, "Release version", 100)
        : null;
      if (briefId) {
        const shared = this.s.get(
          "SELECT id FROM project_brief_revisions WHERE project_id=? AND visibility='client' ORDER BY revision DESC LIMIT 1",
          project,
        );
        assert(
          shared?.id === briefId,
          409,
          "Select the current client-visible brief revision.",
        );
      }
      if (releaseId)
        assert(
          this.s.get(
            "SELECT id FROM releases WHERE id=? AND project_id=? AND visibility='client'",
            releaseId,
            project,
          ),
          400,
          "Only a shared release from this project can be reviewed.",
        );
      const request = id(),
        stamp = now();
      this.s.run(
        "INSERT INTO client_decision_requests(id,project_id,client_id,actor_id,title,body,created_at,updated_at,brief_revision_id,release_id) VALUES (?,?,?,?,?,?,?,?,?,?)",
        request,
        project,
        recipient,
        user,
        title,
        body,
        stamp,
        stamp,
        briefId,
        releaseId,
      );
      this.audit(project, user, "client_decision.requested", request);
      return { id: request };
    });
  }
  cancelClientDecision(user: string, project: string, request: string, b: Row) {
    const grant = owner(this.s, project, user);
    assert(
      grant.organization_id === this.organization,
      404,
      "Project not found.",
    );
    this.s.transaction(() => {
      const target = this.s.get(
        "SELECT id FROM client_decision_requests WHERE id=? AND project_id=?",
        request,
        project,
      );
      assert(target, 404, "Decision request not found.");
      const updated = this.s.run(
        "UPDATE client_decision_requests SET status='cancelled',version=version+1,updated_at=? WHERE id=? AND project_id=? AND status='pending' AND version=?",
        now(),
        request,
        project,
        version(b.version),
      );
      assert(
        updated.changes,
        409,
        "Request changed or already has a response.",
      );
      this.audit(project, user, "client_decision.cancelled", request);
    });
  }
  respondClientDecision(
    user: string,
    project: string,
    request: string,
    b: Row,
  ) {
    const grant = membership(this.s, project, user);
    assert(
      grant.organization_id === this.organization && grant.role === "client",
      404,
      "Project not found.",
    );
    const outcome = choice(
        b.outcome,
        ["accepted", "changes_requested"],
        "client outcome",
      ),
      comment = text(b.comment, "Client response", 2000),
      expected = version(b.version);
    this.s.transaction(() => {
      const r = this.s.get(
        "SELECT version,status,brief_revision_id FROM client_decision_requests WHERE id=? AND project_id=? AND client_id=?",
        request,
        project,
        user,
      );
      assert(r, 404, "Decision request not found.");
      assert(
        r.status === "pending" && r.version === expected,
        409,
        "This exact request has changed or already been answered.",
      );
      if (r.brief_revision_id) {
        const current = this.s.get(
          "SELECT id FROM project_brief_revisions WHERE project_id=? AND visibility='client' ORDER BY revision DESC LIMIT 1",
          project,
        );
        assert(
          current?.id === r.brief_revision_id,
          409,
          "The shared brief was revised. Request a new decision for the current version.",
        );
      }
      const updated = this.s.run(
        "UPDATE client_decision_requests SET status='answered',version=version+1,updated_at=? WHERE id=? AND project_id=? AND client_id=? AND version=? AND status='pending'",
        now(),
        request,
        project,
        user,
        expected,
      );
      assert(
        updated.changes,
        409,
        "Decision request changed. Reload before responding.",
      );
      this.s.run(
        "INSERT INTO client_decision_responses(id,request_id,client_id,request_version,outcome,comment,created_at) VALUES (?,?,?,?,?,?,?)",
        id(),
        request,
        user,
        expected,
        outcome,
        comment,
        now(),
      );
      this.audit(project, user, "client_decision.answered", request);
    });
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
      // A revoked or client-only identity must not retain an internal task assignment.
      if (b.revoke === true || b.role === "client")
        this.s.run(
          "UPDATE tasks SET assignee_id=NULL,version=version+1,updated_at=? WHERE project_id=? AND assignee_id=?",
          now(),
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
  milestone(user: string, project: string, b: Row, milestoneId?: string) {
    const access = owner(this.s, project, user);
    assert(
      access.organization_id === this.organization,
      404,
      "Project not found.",
    );
    const title = text(b.title, "Milestone title", 200),
      summary = text(b.summary ?? "", "Milestone summary", 4000, 0),
      status = choice(
        b.status ?? "planned",
        ["planned", "active", "blocked", "review", "done"],
        "milestone status",
      ),
      visibility = choice(
        b.visibility ?? "internal",
        ["internal", "client"],
        "visibility",
      ),
      targetDate =
        b.target_date == null || b.target_date === ""
          ? null
          : text(b.target_date, "Target date", 10, 10);
    assert(
      !targetDate ||
        (/^\d{4}-\d{2}-\d{2}$/.test(targetDate) &&
          !Number.isNaN(Date.parse(targetDate)) &&
          new Date(targetDate).toISOString().slice(0, 10) === targetDate),
      400,
      "Use a real YYYY-MM-DD target date.",
    );
    return this.s.transaction(() => {
      const old = milestoneId
        ? this.s.get(
            "SELECT * FROM project_milestones WHERE id=? AND project_id=?",
            milestoneId,
            project,
          )
        : undefined;
      if (milestoneId) assert(old, 404, "Milestone not found.");
      if (old && visibility === "internal")
        assert(
          !this.s.get(
            "SELECT 1 FROM tasks WHERE milestone_id=? AND visibility='client' LIMIT 1",
            milestoneId,
          ),
          409,
          "Move shared tasks before hiding this milestone.",
        );
      if (status === "done" && milestoneId)
        assert(
          !this.s.get(
            "SELECT 1 FROM tasks WHERE milestone_id=? AND status<>'done' LIMIT 1",
            milestoneId,
          ),
          409,
          "Complete linked tasks before closing this milestone.",
        );
      const key = milestoneId ?? id(),
        stamp = now();
      if (milestoneId) {
        const updated = this.s.run(
          "UPDATE project_milestones SET title=?,summary=?,status=?,visibility=?,target_date=?,version=version+1,updated_at=? WHERE id=? AND project_id=? AND version=?",
          title,
          summary,
          status,
          visibility,
          targetDate,
          stamp,
          key,
          project,
          version(b.version),
        );
        assert(
          updated.changes,
          409,
          "Milestone changed. Reload before updating.",
        );
        if (old && old.title !== title)
          this.s.run(
            "UPDATE tasks SET milestone=?,version=version+1,updated_at=? WHERE milestone_id=?",
            title,
            stamp,
            key,
          );
      } else {
        this.s.run(
          "INSERT INTO project_milestones(id,project_id,title,summary,status,visibility,target_date,actor_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
          key,
          project,
          title,
          summary,
          status,
          visibility,
          targetDate,
          user,
          stamp,
          stamp,
        );
      }
      this.audit(
        project,
        user,
        milestoneId ? "milestone.updated" : "milestone.created",
        key,
      );
      return { id: key };
    });
  }
  task(user: string, project: string, b: Row, taskId?: string) {
    const m = membership(this.s, project, user, true);
    const title = text(b.title, "Task title", 200),
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
      const assignmentIsActive = (target: string) =>
        !!this.s.get(
          "SELECT 1 FROM memberships WHERE project_id=? AND user_id=? AND role IN ('owner','contributor') AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at>?)",
          project,
          target,
          now(),
        );
      const previousAssignee =
        old?.assignee_id && assignmentIsActive(old.assignee_id)
          ? old.assignee_id
          : null;
      const assigneeId =
        b.assignee_id === undefined
          ? previousAssignee
          : b.assignee_id === "" || b.assignee_id === null
            ? null
            : text(b.assignee_id, "Assignee", 100);
      const rawDue =
        b.due_date === undefined ? (old?.due_date ?? null) : b.due_date;
      const dueDate =
        rawDue === "" || rawDue === null
          ? null
          : text(rawDue, "Due date", 10, 10);
      if (dueDate) {
        const stamp = Date.parse(`${dueDate}T00:00:00.000Z`);
        assert(
          /^\d{4}-\d{2}-\d{2}$/.test(dueDate) &&
            Number.isFinite(stamp) &&
            new Date(stamp).toISOString().slice(0, 10) === dueDate,
          400,
          "Enter a valid calendar due date.",
        );
      }
      if (m.role !== "owner")
        assert(
          (b.assignee_id === undefined || assigneeId === previousAssignee) &&
            dueDate === (old?.due_date ?? null),
          403,
          "Only the project owner can set task assignments and due dates.",
        );
      if (assigneeId)
        assert(
          assignmentIsActive(assigneeId),
          400,
          "Assign only an active project owner or contributor.",
        );
      const milestoneId =
        b.milestone_id === undefined ? old?.milestone_id : b.milestone_id;
      const linked = milestoneId
        ? this.s.get(
            "SELECT * FROM project_milestones WHERE id=? AND project_id=?",
            text(milestoneId, "Linked milestone", 100),
            project,
          )
        : undefined;
      if (milestoneId)
        assert(linked, 400, "Linked milestone must belong to this project.");
      assert(
        !linked || visibility !== "client" || linked.visibility === "client",
        400,
        "Share the milestone before linking a client-visible task.",
      );
      assert(
        !linked || linked.status !== "done" || status === "done",
        409,
        "Reopen the completed milestone before adding unfinished work.",
      );
      const milestone = linked
        ? linked.title
        : text(b.milestone ?? old?.milestone ?? "Project", "Milestone", 120);
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
          "UPDATE tasks SET title=?,milestone=?,status=?,priority=?,evidence=?,review_required=?,reviewed_by=?,depends_on=?,visibility=?,milestone_id=?,assignee_id=?,due_date=?,version=version+1,updated_at=? WHERE id=? AND version=?",
          title,
          milestone,
          status,
          priority,
          evidence,
          Number(review),
          status === "done" && review ? user : null,
          dependency?.id ?? null,
          visibility,
          linked?.id ?? null,
          assigneeId,
          dueDate,
          now(),
          task,
          version(b.version),
        );
        assert(r.changes, 409, "Task changed. Reload before updating.");
      } else
        this.s.run(
          "INSERT INTO tasks(id,project_id,title,milestone,status,priority,evidence,review_required,reviewed_by,depends_on,visibility,actor_id,version,created_at,updated_at,milestone_id,assignee_id,due_date) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,1,?,?,?,?,?)",
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
          linked?.id ?? null,
          assigneeId,
          dueDate,
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
  recordPreviewObservation(
    user: string,
    project: string,
    release: string,
    observation: PreviewObservation,
  ) {
    return this.s.transaction(() => {
      const grant = owner(this.s, project, user);
      assert(
        grant.organization_id === this.organization,
        404,
        "Project not found.",
      );
      const r = this.s.get(
        "SELECT commit_sha,demo_url FROM releases WHERE id=? AND project_id=?",
        release,
        project,
      );
      assert(
        r &&
          r.commit_sha === observation.expected_commit &&
          r.demo_url === observation.preview_url,
        409,
        "Preview release or URL changed during observation.",
      );
      assert(
        [
          "reachable",
          "http_error",
          "redirect_denied",
          "network_error",
        ].includes(observation.result),
        400,
        "Invalid preview observation.",
      );
      const receipt = id();
      this.s.run(
        "INSERT INTO preview_observations(id,project_id,release_id,preview_url,expected_commit,result,http_status,reported_commit,commit_matches,actor_id,observed_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
        receipt,
        project,
        release,
        observation.preview_url,
        observation.expected_commit,
        observation.result,
        observation.http_status,
        observation.reported_commit,
        observation.commit_matches,
        user,
        observation.observed_at,
      );
      this.audit(project, user, "preview.observed", receipt);
      return receipt;
    });
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
        "INSERT INTO release_reviews(id,release_id,actor_id,outcome,comment,created_at,audience) VALUES (?,?,?,?,?,?,?)",
        id(),
        release,
        user,
        outcome,
        text(b.comment, "Review comment", 2000),
        now(),
        m.role === "client" ? "client" : "internal",
      );
      this.audit(project, user, "release.reviewed", release);
    });
  }
}
