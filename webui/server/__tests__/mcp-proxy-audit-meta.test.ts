/**
 * Unit coverage for the audit metadata helper and historical scrub. Real Proxy
 * path coverage lives in mcp-proxy-smoke.test.ts.
 */
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Identity } from "../proxy/identity";

const ACCESS_YAML = `roles:
  ok_role:
    permission_model_version: 2
    allow:
      connections: [warehouse]
      tableSelectors:
        - connection: warehouse
          schema: fin
          names: [fin_ledger]
          row_access: all
      tools: [lucy_query, lucy_begin_question, wiki_search]
users:
  - id: ok_agent
    name: OK
    enabled: true
    role: ok_role
    tokens: []
defaults:
  deny_tools: []
`;

const FIN_SCHEMA = `tables:
  fin_ledger:
    table: fin.fin_ledger
`;

let projectRoot: string;
let previousRoot: string | undefined;
let previousAuditDb: string | undefined;

function identity(userId: string): Identity {
  return { userId, tokenLabel: "meta", tokenHashPrefix: "meta" };
}

beforeEach(async () => {
  previousRoot = process.env.KTX_PROJECT_ROOT;
  previousAuditDb = process.env.LUCY_AUDIT_DB;
  projectRoot = await mkdtemp(path.join(os.tmpdir(), "ktx-audit-meta-"));
  await mkdir(path.join(projectRoot, "webui", "config"), { recursive: true });
  await mkdir(path.join(projectRoot, "semantic-layer", "warehouse", "_schema"), { recursive: true });
  await writeFile(path.join(projectRoot, "ktx.yaml"), "connections: {}\n", "utf8");
  await writeFile(path.join(projectRoot, "webui", "config", "access.yaml"), ACCESS_YAML, "utf8");
  await writeFile(path.join(projectRoot, "semantic-layer", "warehouse", "_schema", "fin.yaml"), FIN_SCHEMA, "utf8");
  process.env.KTX_PROJECT_ROOT = projectRoot;
  process.env.LUCY_AUDIT_DB = path.join(projectRoot, "audit.sqlite");
});

afterEach(async () => {
  if (previousRoot === undefined) delete process.env.KTX_PROJECT_ROOT;
  else process.env.KTX_PROJECT_ROOT = previousRoot;
  if (previousAuditDb === undefined) delete process.env.LUCY_AUDIT_DB;
  else process.env.LUCY_AUDIT_DB = previousAuditDb;
  await rm(projectRoot, { recursive: true, force: true });
});

describe("mcp-proxy auditMeta path (Spec 137)", () => {
  it("buildAccessLogAuditMeta supplies policyVersion + capabilityDigest for writeLog", async () => {
    vi.resetModules();
    const acl = await import("../proxy/acl");
    const audit = await import("../proxy/audit");
    const { buildAccessLogAuditMeta } = await import("../proxy/audit-meta");
    const { summarizeArgsForAudit } = await import("../proxy/audit-privacy");

    await acl.commitEffectivePolicy();
    const meta = await buildAccessLogAuditMeta(identity("ok_agent"), "allowed");
    expect(meta.policyVersion).toMatch(/^[a-f0-9]{64}$/);
    expect(meta.capabilityDigest).toBeTruthy();

    const argsSummary = summarizeArgsForAudit("lucy_begin_question", {
      question: "请分析利润 alice@example.com 13800138000",
      intentSummary: "利润"
    });
    expect(argsSummary).not.toHaveProperty("question");
    expect(JSON.stringify(argsSummary)).not.toContain("alice@example.com");

    const id = await audit.writeLog({
      ts: new Date().toISOString(),
      userId: "ok_agent",
      tool: "lucy_begin_question",
      outcome: "ok",
      durationMs: 1,
      requestId: "req-meta-1",
      argsSummary,
      ...meta
    });

    const Database = (await import("better-sqlite3")).default;
    const db = new Database(process.env.LUCY_AUDIT_DB!);
    const row = db
      .prepare("SELECT policy_version, capability_digest, args_summary FROM access_log WHERE id = ?")
      .get(id) as { policy_version: string; capability_digest: string; args_summary: string };
    expect(row.policy_version).toBe(meta.policyVersion);
    expect(row.capability_digest).toBe(meta.capabilityDigest);
    expect(row.args_summary).not.toContain('"question"');
    expect(row.args_summary).not.toContain('"questionPreview"');
    expect(row.args_summary).not.toContain('"intentSummary"');
    expect(row.args_summary).not.toContain("alice@example.com");
    db.close();
  });

  it("scrubAccessLogArgsSummaries rewrites historical question keys", async () => {
    vi.resetModules();
    const audit = await import("../proxy/audit");
    await audit.writeLog({
      ts: new Date().toISOString(),
      userId: "ok_agent",
      tool: "lucy_begin_question",
      outcome: "ok",
      durationMs: 1,
      requestId: "req-scrub-1",
      argsSummary: { question: "旧原文 bob@x.com", intentSummary: "旧摘要" }
    });

    const dry = await audit.scrubAccessLogArgsSummaries({ dryRun: true });
    expect(dry.matched).toBeGreaterThanOrEqual(1);
    expect(dry.updated).toBe(0);

    const applied = await audit.scrubAccessLogArgsSummaries({ dryRun: false });
    expect(applied.updated).toBeGreaterThanOrEqual(1);

    const Database = (await import("better-sqlite3")).default;
    const db = new Database(process.env.LUCY_AUDIT_DB!);
    const row = db.prepare("SELECT args_summary FROM access_log WHERE request_id = ?").get("req-scrub-1") as {
      args_summary: string;
    };
    expect(row.args_summary).not.toContain('"question"');
    expect(row.args_summary).not.toContain('"questionPreview"');
    expect(row.args_summary).not.toContain('"intentSummary"');
    expect(row.args_summary).not.toContain("bob@x.com");
    const maintenance = db.prepare("SELECT * FROM audit_maintenance_log ORDER BY id DESC LIMIT 1").get() as Record<string, unknown>;
    expect(maintenance.event_type).toBe("access_log_args_summary_scrub");
    expect(maintenance.algorithm_version).toBe("audit-args-summary-scrub/v2");
    expect(String(maintenance.before_digest)).toMatch(/^[0-9a-f]{64}$/);
    expect(String(maintenance.after_digest)).toMatch(/^[0-9a-f]{64}$/);
    db.close();
  });
});
