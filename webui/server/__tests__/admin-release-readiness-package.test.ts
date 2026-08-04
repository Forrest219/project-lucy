import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const auditRows = vi.hoisted(() => [] as Array<{
  id: number;
  user_id: string;
  token_label: string | null;
  token_hash_prefix: string | null;
  ts: string;
  tool: string;
  outcome: string;
  role_ids: string | null;
  decision_reason: string | null;
  request_id: string;
}>);

const revokedTokens = vi.hoisted(() => [] as Array<{ token_hash: string; revoked_at: string }>);

const configChangeRows = vi.hoisted(() => [] as Array<{
  id: number;
  ts: string;
  actor: string;
  file_path: string;
  change_type: string;
  target_id: string | null;
}>);

const evalDbConnectable = vi.hoisted(() => ({ value: true }));
const evalSecurityCandidateTableExists = vi.hoisted(() => ({ value: false }));
const securityCandidateRows = vi.hoisted(() => [] as Array<{ id: string; status: string }>);

let nextRowId = 1;

vi.mock("../admin/audit.js", () => ({
  getAuditDb: vi.fn(() => ({
    prepare: vi.fn((sql: string) => {
      if (sql.includes("SELECT 1 FROM access_log LIMIT 1")) return { get: vi.fn(() => ({ row: 1 })), all: vi.fn(() => []), run: vi.fn() };
      if (sql.includes("SELECT 1 FROM revoked_tokens LIMIT 1")) return { get: vi.fn(() => ({ row: 1 })), all: vi.fn(() => []), run: vi.fn() };
      if (sql.includes("SELECT 1 FROM config_change_log LIMIT 1")) return { get: vi.fn(() => ({ row: 1 })), all: vi.fn(() => []), run: vi.fn() };
      if (sql.includes("SELECT token_hash FROM revoked_tokens")) {
        return { all: vi.fn(() => [...revokedTokens]), get: vi.fn(), run: vi.fn() };
      }
      if (sql.includes("FROM access_log") && sql.includes("outcome = 'denied'") && sql.includes("token_hash_prefix")) {
        return {
          all: vi.fn((userId: string, _placeholder: string, isoCutoff: string) => {
            const cutoffMs = Date.parse(isoCutoff);
            return auditRows
              .filter((row) =>
                row.user_id === userId
                && row.outcome === "denied"
                && row.token_hash_prefix
                && Date.parse(row.ts) >= cutoffMs
              )
              .map((row) => ({
                token_hash_prefix: row.token_hash_prefix,
                ts: row.ts,
                request_id: row.request_id
              }))
              .sort((a, b) => b.ts.localeCompare(a.ts));
          }),
          get: vi.fn(),
          run: vi.fn()
        };
      }
      if (sql.includes("ROW_NUMBER() OVER")) {
        return {
          all: vi.fn((...userIds: string[]) => {
            const userIdSet = new Set(userIds);
            const filtered = auditRows
              .filter((row) => userIdSet.has(row.user_id) && row.token_hash_prefix)
              .sort((a, b) => b.ts.localeCompare(a.ts));
            const seen = new Set<string>();
            const out: Array<{ user_id: string; token_hash_prefix: string; ts: string; outcome: string }> = [];
            for (const row of filtered) {
              const key = `${row.user_id}|${row.token_hash_prefix}`;
              if (seen.has(key)) continue;
              seen.add(key);
              out.push({
                user_id: row.user_id,
                token_hash_prefix: row.token_hash_prefix!,
                ts: row.ts,
                outcome: row.outcome
              });
            }
            return out;
          }),
          get: vi.fn(),
          run: vi.fn()
        };
      }
      if (sql.includes("SELECT token_hash_prefix, MAX(ts) AS last_used")) {
        return {
          all: vi.fn((userId: string, ...prefixes: string[]) => {
            const prefixSet = new Set(prefixes);
            const grouped = new Map<string, string>();
            for (const row of auditRows) {
              if (row.user_id !== userId) continue;
              if (!row.token_hash_prefix) continue;
              if (!prefixSet.has(row.token_hash_prefix)) continue;
              if (!grouped.has(row.token_hash_prefix) || row.ts > grouped.get(row.token_hash_prefix)!) {
                grouped.set(row.token_hash_prefix, row.ts);
              }
            }
            return [...grouped.entries()].map(([token_hash_prefix, last_used]) => ({ token_hash_prefix, last_used }));
          }),
          get: vi.fn(),
          run: vi.fn()
        };
      }
      if (sql.includes("GROUP BY user_id")) {
        return {
          all: vi.fn((userIds: string[], isoCutoff: string) => {
            const cutoffMs = Date.parse(isoCutoff);
            const userIdSet = new Set(userIds);
            const buckets = new Map<string, { calls: number; denied: number; lastSeen: string | null }>();
            for (const uid of userIds) buckets.set(uid, { calls: 0, denied: 0, lastSeen: null });
            for (const row of auditRows) {
              if (!userIdSet.has(row.user_id)) continue;
              if (Date.parse(row.ts) < cutoffMs) continue;
              const entry = buckets.get(row.user_id)!;
              entry.calls += 1;
              if (row.outcome === "denied") entry.denied += 1;
              if (!entry.lastSeen || row.ts > entry.lastSeen) entry.lastSeen = row.ts;
            }
            return [...buckets.entries()].map(([user_id, stats]) => ({
              user_id,
              calls: stats.calls,
              denied: stats.denied,
              last_seen: stats.lastSeen
            }));
          }),
          get: vi.fn((userId: string, isoCutoff: string) => {
            const cutoffMs = Date.parse(isoCutoff);
            const matched = auditRows.filter(
              (row) => row.user_id === userId && Date.parse(row.ts) >= cutoffMs
            );
            return {
              calls: matched.length,
              denied: matched.filter((row) => row.outcome === "denied").length,
              last_seen: matched.map((row) => row.ts).sort().at(-1) ?? null,
              last_used: matched.filter((row) => row.token_hash_prefix).map((row) => row.ts).sort().at(-1) ?? null,
              active_tokens: new Set(matched.filter((row) => row.token_hash_prefix).map((row) => row.token_hash_prefix)).size
            };
          }),
          run: vi.fn()
        };
      }
      // denial summary totals (no GROUP BY)
      if (sql.includes("FROM access_log WHERE ts >= ?") || sql.includes("FROM access_log\n         WHERE ts >= ?")) {
        return {
          all: vi.fn((isoCutoff: string) => {
            const cutoffMs = Date.parse(isoCutoff);
            const matched = auditRows.filter((row) => Date.parse(row.ts) >= cutoffMs);
            const denied = matched.filter((row) => row.outcome === "denied");
            const map = new Map<string, number>();
            for (const row of denied) {
              map.set(row.decision_reason ?? "unspecified", (map.get(row.decision_reason ?? "unspecified") ?? 0) + 1);
            }
            return [...map.entries()].map(([reason, cnt]) => ({ reason, cnt })).sort((a, b) => b.cnt - a.cnt).slice(0, 8);
          }),
          get: vi.fn((isoCutoff: string) => {
            const cutoffMs = Date.parse(isoCutoff);
            const matched = auditRows.filter((row) => Date.parse(row.ts) >= cutoffMs);
            const denied = matched.filter((row) => row.outcome === "denied");
            return { calls: matched.length, denied: denied.length };
          }),
          run: vi.fn()
        };
      }
      if (sql.includes("FROM access_log\n         WHERE outcome = 'denied' AND ts >= ?") && !sql.includes("GROUP BY tool")) {
        return {
          all: vi.fn((isoCutoff: string) => {
            const cutoffMs = Date.parse(isoCutoff);
            const matched = auditRows.filter((row) => row.outcome === "denied" && Date.parse(row.ts) >= cutoffMs);
            const map = new Map<string, number>();
            for (const row of matched) {
              map.set(row.decision_reason ?? "unspecified", (map.get(row.decision_reason ?? "unspecified") ?? 0) + 1);
            }
            return [...map.entries()].map(([reason, cnt]) => ({ reason, cnt })).sort((a, b) => b.cnt - a.cnt).slice(0, 8);
          }),
          get: vi.fn(),
          run: vi.fn()
        };
      }
      if (
        (sql.includes("FROM access_log\n         WHERE outcome = 'denied' AND ts >= ?")
          || sql.includes("FROM access_log WHERE outcome = 'denied' AND ts >= ?"))
        && sql.includes("GROUP BY tool")
      ) {
        return {
          all: vi.fn((isoCutoff: string) => {
            const cutoffMs = Date.parse(isoCutoff);
            const matched = auditRows.filter((row) => row.outcome === "denied" && Date.parse(row.ts) >= cutoffMs);
            const map = new Map<string, number>();
            for (const row of matched) map.set(row.tool, (map.get(row.tool) ?? 0) + 1);
            return [...map.entries()].map(([tool, cnt]) => ({ tool, cnt })).sort((a, b) => b.cnt - a.cnt).slice(0, 8);
          }),
          get: vi.fn(),
          run: vi.fn()
        };
      }
      // config_change_log queries (WHERE or no WHERE)
      if (sql.includes("FROM config_change_log")) {
        return {
          all: vi.fn((isoCutoff?: string) => {
            const cutoffMs = isoCutoff ? Date.parse(isoCutoff) : Number.NEGATIVE_INFINITY;
            const matched = configChangeRows.filter((row) => Date.parse(row.ts) >= cutoffMs);
            const map = new Map<string, number>();
            for (const row of matched) map.set(row.change_type, (map.get(row.change_type) ?? 0) + 1);
            return [...map.entries()].map(([change_type, cnt]) => ({ change_type, cnt })).sort((a, b) => b.cnt - a.cnt).slice(0, 16);
          }),
          get: vi.fn((isoCutoff?: string) => {
            const cutoffMs = isoCutoff ? Date.parse(isoCutoff) : Number.NEGATIVE_INFINITY;
            const matched = configChangeRows.filter((row) => Date.parse(row.ts) >= cutoffMs);
            return { cnt: matched.length, last_ts: matched.map((row) => row.ts).sort().at(-1) ?? null };
          }),
          run: vi.fn()
        };
      }
      if (sql.includes("FROM config_change_log\n         GROUP BY file_path") || sql.includes("FROM config_change_log WHERE ts >= ?\n         GROUP BY file_path")) {
        return {
          all: vi.fn((isoCutoff?: string) => {
            const cutoffMs = isoCutoff ? Date.parse(isoCutoff) : Number.NEGATIVE_INFINITY;
            const matched = configChangeRows.filter((row) => Date.parse(row.ts) >= cutoffMs);
            const map = new Map<string, number>();
            for (const row of matched) map.set(row.file_path, (map.get(row.file_path) ?? 0) + 1);
            return [...map.entries()].map(([file_path, cnt]) => ({ file_path, cnt })).sort((a, b) => b.cnt - a.cnt).slice(0, 16);
          }),
          get: vi.fn(),
          run: vi.fn()
        };
      }
      if (sql.includes("COUNT(*) AS cnt") && sql.includes("role_ids")) {
        return { all: vi.fn(), get: vi.fn(() => ({ cnt: 0 })), run: vi.fn() };
      }
      if (sql.startsWith("INSERT INTO evidence_events")) {
        return { run: vi.fn(() => ({ lastInsertRowid: 1 })), all: vi.fn(() => []), get: vi.fn() };
      }
      return { get: vi.fn(() => undefined), all: vi.fn(() => []), run: vi.fn() };
    }),
    exec: vi.fn(),
    pragma: vi.fn(),
    transaction: vi.fn((fn: (...args: unknown[]) => unknown) => fn)
  })),
  recordConfigChange: vi.fn(async () => 1),
  registerAuditRoutes: vi.fn()
}));

// The optional security candidate pool is absent by default, but individual
// tests can enable the table to exercise the bounded count branch.
vi.mock("../eval/db.js", () => ({
  getEvalDb: vi.fn(async () => {
    if (!evalDbConnectable.value) throw new Error("eval db unavailable");
    return {
      prepare: vi.fn((sql: string) => {
        if (sql.includes("sqlite_master") && sql.includes("security_eval_candidate")) {
          return {
            all: vi.fn(() => (evalSecurityCandidateTableExists.value ? [{ name: "security_eval_candidate" }] : [])),
            get: vi.fn(() => (evalSecurityCandidateTableExists.value ? { name: "security_eval_candidate" } : undefined)),
            run: vi.fn()
          };
        }
        if (sql.includes("COUNT(*) AS cnt") && sql.includes("FROM security_eval_candidate") && sql.includes("status IN")) {
          return {
            all: vi.fn(() => []),
            get: vi.fn(() => ({
              cnt: securityCandidateRows.filter((row) => ["promoted", "promoted_to_eval", "formal"].includes(row.status)).length
            })),
            run: vi.fn()
          };
        }
        if (sql.includes("COUNT(*) AS cnt") && sql.includes("FROM security_eval_candidate")) {
          return {
            all: vi.fn(() => []),
            get: vi.fn(() => ({ cnt: securityCandidateRows.length })),
            run: vi.fn()
          };
        }
        return { all: vi.fn(() => []), get: vi.fn(() => undefined), run: vi.fn() };
      }),
      exec: vi.fn(),
      pragma: vi.fn()
    };
  })
}));

// ─── Project root + access.yaml fixtures ─────────────────────────────────────

const KX_TEMPLATE_NAMES = [
  "kx_dim_company",
  "kx_dim_financial_item",
  "kx_fact_financial_amount",
  "kx_vw_balance_sheet_detail",
  "kx_vw_cash_flow_statement_detail",
  "kx_vw_income_statement_detail",
  "superstore_orders",
  "superstore_people",
  "superstore_returns"
];

const ACCESS_YAML = `roles:
  analyst:
    description: Analyst role
    allow:
      connections:
        - mysql-aliyun
      tableSelectors:
        - connection: mysql-aliyun
          schema: dataforai
          names:
            - superstore_orders
      tools:
        - sl_query
  risk_officer:
    description: Sensitive finance role
    allow:
      connections:
        - mysql-aliyun
      tableSelectors:
        - connection: mysql-aliyun
          schema: dataforai
          names:
            - kx_fact_financial_amount
      tools:
        - sl_query
  orphan_role:
    description: Never referenced
    allow:
      connections:
        - mysql-aliyun
      tableSelectors:
        - connection: mysql-aliyun
          schema: dataforai
          names:
            - superstore_orders
      tools:
        - sl_query
users:
  - id: zhangsan
    name: 张三
    enabled: true
    role: analyst
    tokens:
      - hash: "sha256:aaaaaaaaaaaaaaaaaaaa"
        label: hermes-laptop
        created: 2026-06-18
      - hash: "sha256:bbbbbbbbbbbbbbbbbbbb"
        label: archived-token
        created: 2026-01-01
  - id: lisi
    name: 李四
    enabled: true
    role: risk_officer
    tokens:
      - hash: "sha256:cccccccccccccccccccc"
        label: revoked-token
        created: 2026-05-01
  - id: wangwu
    name: 王五
    enabled: false
    role: analyst
    tokens: []
defaults:
  deny_tools:
    - sql_execution
`;

let projectRoot: string;
let prevRoot: string | undefined;

async function makeProject(yamlContent = ACCESS_YAML) {
  const root = await mkdtemp(path.join(os.tmpdir(), "ktx-release-readiness-"));
  await mkdir(path.join(root, "webui", "config"), { recursive: true });
  await mkdir(path.join(root, "semantic-layer", "mysql-aliyun", "_schema"), { recursive: true });
  await mkdir(path.join(root, ".ktx-ui"), { recursive: true });
  await writeFile(path.join(root, "ktx.yaml"), "connections: {}\n", "utf8");
  await writeFile(path.join(root, "webui", "config", "access.yaml"), yamlContent, "utf8");
  await writeFile(
    path.join(root, "semantic-layer", "mysql-aliyun", "_schema", "dataforai.yaml"),
    [
      "tables:",
      ...KX_TEMPLATE_NAMES.map((name) => `  ${name}:\n    table: dataforai.${name}`),
      ""
    ].join("\n"),
    "utf8"
  );
  return root;
}

beforeEach(async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-08-02T12:00:00.000Z"));
  projectRoot = await makeProject();
  prevRoot = process.env.KTX_PROJECT_ROOT;
  process.env.KTX_PROJECT_ROOT = projectRoot;
  auditRows.length = 0;
  revokedTokens.length = 0;
  configChangeRows.length = 0;
  securityCandidateRows.length = 0;
  nextRowId = 1;
  evalDbConnectable.value = true;
  evalSecurityCandidateTableExists.value = false;
});

afterEach(async () => {
  if (prevRoot === undefined) delete process.env.KTX_PROJECT_ROOT;
  else process.env.KTX_PROJECT_ROOT = prevRoot;
  await rm(projectRoot, { recursive: true, force: true });
  vi.useRealTimers();
});

function pushAudit(row: Omit<typeof auditRows[number], "id" | "request_id" | "role_ids" | "decision_reason">) {
  auditRows.push({
    id: nextRowId++,
    role_ids: null,
    decision_reason: row.outcome === "denied" ? "tool_forbidden" : null,
    request_id: `req-${nextRowId}`,
    ...row
  });
}

describe("GET /api/admin/governance/release-readiness-package", () => {
  it("returns one bounded package with current facts only", async () => {
    pushAudit({ user_id: "zhangsan", token_label: "hermes-laptop", token_hash_prefix: "sha256:aaaaaaaaaaaa", ts: "2026-08-02T08:00:00.000Z", tool: "sl_query", outcome: "ok" });
    pushAudit({ user_id: "zhangsan", token_label: "hermes-laptop", token_hash_prefix: "sha256:aaaaaaaaaaaa", ts: "2026-08-02T09:00:00.000Z", tool: "sl_query", outcome: "denied" });
    pushAudit({ user_id: "lisi", token_label: "revoked-token", token_hash_prefix: "sha256:cccccccccccc", ts: "2026-08-02T10:00:00.000Z", tool: "sl_query", outcome: "denied" });
    configChangeRows.push({ id: 1, ts: "2026-08-02T08:00:00.000Z", actor: "local-admin", file_path: "webui/config/access.yaml", change_type: "agent_create", target_id: "zhangsan" });
    revokedTokens.push({ token_hash: "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc", revoked_at: "2026-07-25T00:00:00.000Z" });

    const app = (await import("../index.js")).buildServer();
    await app.ready();
    const res = await request(app.server).get("/api/admin/governance/release-readiness-package").expect(200);
    const body = res.body as { ok: boolean; data: { generatedAt: string; accessConfigHash: string; factSourcesUsed: string[]; inventory: { agentCount: number; enabledAgentCount: number; yamlRoleCount: number; templateRoleCount: number; tokenCount: number; revokedTokenCount: number; tokens: Array<{ hashPrefix: string; revoked: boolean }>; roles: Array<{ id: string; source: string; broken: boolean }> }; denialSummary: { totalCalls: number; deniedCalls: number; denialRate: number; topReasons: Array<{ reason: string; count: number }>; topAffectedTools: Array<{ reason: string; count: number }>; unavailableReason?: string }; configChangeSummary: { totalChanges: number; byChangeType: Record<string, number>; lastChangeAt: string | null; unavailableReason?: string }; securityEvalSummary: { status: string; reason?: string; skipped?: boolean }; riskReviewSummary: { summary: { totalCount: number; bySeverity: Record<string, number> }; factSources: Record<string, string> }; knownLimitations: string[]; schemaVersion: string } };

    // shape
    expect(body.ok).toBe(true);
    expect(body.data.schemaVersion).toBe("202608-gov-06.v1");
    expect(body.data.accessConfigHash).toBeTruthy();
    expect(body.data.factSourcesUsed).toEqual(expect.arrayContaining(["access_yaml", "audit_db_access_log", "audit_db_config_change_log"]));

    // inventory
    expect(body.data.inventory.agentCount).toBe(3);
    expect(body.data.inventory.enabledAgentCount).toBe(2);
    expect(body.data.inventory.yamlRoleCount).toBe(3);
    expect(body.data.inventory.templateRoleCount).toBeGreaterThan(0);
    expect(body.data.inventory.tokenCount).toBe(3);
    expect(body.data.inventory.revokedTokenCount).toBe(1);
    // tokens expose hash prefix only — never plaintext
    for (const token of body.data.inventory.tokens) {
      expect(token.hashPrefix).toMatch(/^sha256:[a-f0-9]{1,32}$/);
      expect(token.hashPrefix.length).toBeLessThan(64);
    }
    // roles
    const orphan = body.data.inventory.roles.find((role) => role.id === "orphan_role");
    expect(orphan?.source).toBe("yaml");
    expect(orphan?.broken).toBe(false);

    // denial summary
    expect(body.data.denialSummary.totalCalls).toBe(3);
    expect(body.data.denialSummary.deniedCalls).toBe(2);
    expect(body.data.denialSummary.denialRate).toBeCloseTo(0.6667, 3);
    expect(body.data.denialSummary.topReasons[0].reason).toBe("tool_forbidden");
    expect(body.data.denialSummary.topAffectedTools[0].reason).toBe("sl_query");

    // config change summary
    expect(body.data.configChangeSummary.totalChanges).toBe(1);
    expect(body.data.configChangeSummary.byChangeType).toEqual({ agent_create: 1 });
    expect(body.data.configChangeSummary.lastChangeAt).toBe("2026-08-02T08:00:00.000Z");

    // security eval summary — must be unavailable + explicit reason
    expect(body.data.securityEvalSummary.status).toBe("unavailable");
    expect(body.data.securityEvalSummary.skipped).toBe(true);
    expect(body.data.securityEvalSummary.reason).toMatch(/202608-GOV-04/);

    // risk review summary
    expect(body.data.riskReviewSummary.summary.totalCount).toBeGreaterThan(0);
    expect(body.data.riskReviewSummary.summary.bySeverity.P0).toBeGreaterThanOrEqual(1);

    // known limitations — current-scope only, with no future access-boundary language.
    const joined = body.data.knownLimitations.join(" | ");
    expect(joined).toMatch(/SSO/);
    expect(joined).toMatch(/Visual Debugger/);
    expect(joined).toMatch(/FDE Copilot/);
    expect(joined).not.toMatch(/Dynamic RLS/);
    expect(joined).not.toMatch(/\bCLS\b/);
    expect(joined).not.toMatch(/multi-tenant/i);
    expect(joined).not.toMatch(/\btenant\b/i);
    expect(joined).toMatch(/remediation lifecycle/);

    await app.close();
  });

  it("never includes forbidden payloads in the package", async () => {
    pushAudit({ user_id: "zhangsan", token_label: "hermes-laptop", token_hash_prefix: "sha256:aaaaaaaaaaaa", ts: "2026-08-02T08:00:00.000Z", tool: "sl_query", outcome: "ok" });
    const app = (await import("../index.js")).buildServer();
    await app.ready();
    const res = await request(app.server).get("/api/admin/governance/release-readiness-package").expect(200);
    const body = res.body as { data: Record<string, unknown> };
    const serialized = JSON.stringify(body);
    expect(serialized).not.toMatch(/raw_sql_ast/);
    expect(serialized).not.toMatch(/raw_token/);
    expect(serialized).not.toMatch(/raw_result_row/);
    expect(serialized).not.toMatch(/full_question_payload/);
    expect(serialized).not.toMatch(/Dynamic RLS/);
    expect(serialized).not.toMatch(/\bCLS\b/);
    expect(serialized).not.toMatch(/multi-tenant/i);
    expect(serialized).not.toMatch(/\btenant\b/i);
    expect(serialized).not.toMatch(/AKIA/);
    expect(serialized).not.toMatch(/Bearer [A-Za-z0-9]{16,}/);
    await app.close();
  });

  it("renders the same package as a deterministic Markdown file", async () => {
    pushAudit({ user_id: "zhangsan", token_label: "hermes-laptop", token_hash_prefix: "sha256:aaaaaaaaaaaa", ts: "2026-08-02T08:00:00.000Z", tool: "sl_query", outcome: "ok" });
    const { buildReleaseReadinessPackage, renderReleaseReadinessMarkdown, writeReleaseReadinessMarkdown } = await import("../admin/release-readiness-package.js");
    const pkg = await buildReleaseReadinessPackage();
    const md = renderReleaseReadinessMarkdown(pkg);
    expect(md).toContain("# 202608 Governance Release Readiness Evidence Package");
    expect(md).toContain("## 1. Inventory");
    expect(md).toContain("## 2. Denial Summary");
    expect(md).toContain("## 3. Config Change Summary");
    expect(md).toContain("## 4. Security Eval Summary");
    expect(md).toContain("## 5. Risk Review Candidate Summary");
    expect(md).toContain("## 6. Known Limitations");
    expect(md).toContain("## 7. Package Integrity");
    expect(md).toContain("202608-GOV-04");
    expect(md).toContain("schemaVersion");
    expect(md).not.toMatch(/raw_sql_ast/);
    expect(md).not.toMatch(/raw_token/);

    const result = await writeReleaseReadinessMarkdown(pkg, {
      outputPath: path.join(projectRoot, "inbox", "202608-governance-release-readiness.md")
    });
    expect(result.path).toBe(path.join(projectRoot, "inbox", "202608-governance-release-readiness.md"));
    expect(result.bytes).toBeGreaterThan(0);
    const onDisk = await readFile(result.path, "utf8");
    expect(onDisk).toContain("# 202608 Governance Release Readiness Evidence Package");
  });

  it("returns the same package shape regardless of reviewWindowHours argument", async () => {
    const app = (await import("../index.js")).buildServer();
    await app.ready();
    const small = await request(app.server).get("/api/admin/governance/release-readiness-package?reviewWindowHours=24").expect(200);
    const large = await request(app.server).get("/api/admin/governance/release-readiness-package?reviewWindowHours=720").expect(200);
    const smallBody = small.body as { data: { schemaVersion: string; inventory: { agentCount: number } } };
    const largeBody = large.body as { data: { schemaVersion: string; inventory: { agentCount: number } } };
    expect(smallBody.data.schemaVersion).toBe("202608-gov-06.v1");
    expect(largeBody.data.schemaVersion).toBe("202608-gov-06.v1");
    expect(smallBody.data.inventory.agentCount).toBe(largeBody.data.inventory.agentCount);
    await app.close();
  });

  it("still responds when eval db is unavailable (no fabricated evidence)", async () => {
    evalDbConnectable.value = false;
    const app = (await import("../index.js")).buildServer();
    await app.ready();
    const res = await request(app.server).get("/api/admin/governance/release-readiness-package").expect(200);
    const body = res.body as { data: { securityEvalSummary: { status: string; reason?: string } } };
    expect(body.data.securityEvalSummary.status).toBe("unavailable");
    expect(body.data.securityEvalSummary.reason).toBeTruthy();
    await app.close();
  });

  it("reports security eval candidate counts when the optional candidate pool is available", async () => {
    evalSecurityCandidateTableExists.value = true;
    securityCandidateRows.push(
      { id: "candidate-1", status: "pending" },
      { id: "candidate-2", status: "promoted" },
      { id: "candidate-3", status: "formal" }
    );

    const app = (await import("../index.js")).buildServer();
    await app.ready();
    const res = await request(app.server).get("/api/admin/governance/release-readiness-package").expect(200);
    const body = res.body as { data: { factSourcesUsed: string[]; securityEvalSummary: { status: string; candidateCount?: number; promotedCount?: number; skipped?: boolean } } };
    expect(body.data.securityEvalSummary.status).toBe("available");
    expect(body.data.securityEvalSummary.candidateCount).toBe(3);
    expect(body.data.securityEvalSummary.promotedCount).toBe(2);
    expect(body.data.securityEvalSummary.skipped).toBeUndefined();
    expect(body.data.factSourcesUsed).toContain("eval_db");
    await app.close();
  });
});
