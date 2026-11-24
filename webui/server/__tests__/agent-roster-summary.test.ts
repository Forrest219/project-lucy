import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { agentCommitTestHooks, agentStatisticsDisplayTestState, agentRosterProjectionDiagnostics } from "../admin/agents.js";
import { buildServer } from "../index";
import * as displaySnapshots from "../display-snapshot.js";
import { isMcpProtocolMethod } from "../proxy/usage-classification.js";

const auditRows = vi.hoisted(() => [] as Array<{
  user_id: string;
  token_hash_prefix: string;
  ts: string;
  tool: string;
  outcome: string;
}>);

const KX_TEMPLATE_NAMES = [
  "kx_dim_company",
  "kx_dim_financial_item",
  "kx_fact_financial_amount",
  "kx_vw_balance_sheet_detail",
  "kx_vw_cash_flow_statement_detail",
  "kx_vw_income_statement_detail"
];

// Mock audit db so tests don't need a real sqlite
vi.mock("../admin/audit.js", () => ({
  getAuditDb: vi.fn(() => ({
    prepare: vi.fn((sql: string) => {
      if (sql.includes("ROW_NUMBER() OVER") || sql.includes("WITH configured")) {
        return {
          all: vi.fn((...args: unknown[]) => {
            const userIds = args.filter(
              (value): value is string => typeof value === "string" && !/^\d{4}-\d{2}-\d{2}T/.test(value)
            );
            return auditRows
              .filter((row) => userIds.includes(row.user_id))
              .sort((a, b) => b.ts.localeCompare(a.ts));
          })
        };
      }
      // M55 + Spec 128 Task 7: COUNT(DISTINCT token_hash_prefix) can be called
      // per-agent (args: userId, startIso, endIso) or globally (args: startIso, endIso).
      if (sql.includes("COUNT(DISTINCT token_hash_prefix)")) {
        const isGlobal = !sql.includes("user_id = ?");
        return {
          get: vi.fn((...args: unknown[]) => {
            const startMs = Date.parse(String(isGlobal ? args[0] : args[1]));
            const endMs = Date.parse(String(isGlobal ? args[1] : args[2]));
            const seen = new Set<string>();
            if (isGlobal) {
              for (const row of auditRows) {
                if (!row.token_hash_prefix) continue;
                const ts = new Date(row.ts).getTime();
                if (ts < startMs || ts >= endMs) continue;
                seen.add(row.token_hash_prefix);
              }
            } else {
              const userId = args[0] as string;
              for (const row of auditRows) {
                if (row.user_id !== userId) continue;
                if (!row.token_hash_prefix) continue;
                const ts = new Date(row.ts).getTime();
                if (ts < startMs || ts >= endMs) continue;
                seen.add(row.token_hash_prefix);
              }
            }
            return { active_tokens: seen.size };
          })
        };
      }
      const parseWindowedUserArgs = (args: unknown[]) => {
        const userIds: string[] = [];
        let index = 0;
        while (index < args.length && typeof args[index] === "string" && !/^\d{4}-\d{2}-\d{2}T/.test(String(args[index]))) {
          userIds.push(args[index] as string);
          index += 1;
        }
        const startMs = Date.parse(String(args[index]));
        const endMs = Date.parse(String(args[index + 1]));
        return { userIds, startMs, endMs };
      };
      const statsForUser = (userId: string, startMs: number, endMs: number, includeLatest: boolean) => {
        const allForUser = auditRows.filter((row) => row.user_id === userId);
        if (allForUser.length === 0) return null;
        const matched = allForUser.filter((row) => {
          const ts = new Date(row.ts).getTime();
          return Number.isFinite(startMs) && Number.isFinite(endMs)
            ? ts >= startMs && ts < endMs
            : false;
        });
        const business = matched.filter((row) => !isMcpProtocolMethod(row.tool));
        const base = {
          user_id: userId,
          calls7: matched.length,
          business_calls7: business.length,
          protocol_calls7: matched.length - business.length,
          usage_calls7: business.length,
          eval_probe_calls7: 0,
          denied7: business.filter((row) => row.outcome === "denied").length,
          active_tokens: new Set(matched.map((row) => row.token_hash_prefix).filter(Boolean)).size
        };
        if (!includeLatest) return base;
        return {
          ...base,
          last_seen: allForUser.map((row) => row.ts).sort().at(-1) ?? null,
          last_business_seen: allForUser
            .filter((row) => !isMcpProtocolMethod(row.tool))
            .map((row) => row.ts)
            .sort()
            .at(-1) ?? null
        };
      };
      if (sql.includes("AS last_seen") && sql.includes("last_business_seen")) {
        return {
          all: vi.fn((...args: unknown[]) => {
            const userIds = args.filter(
              (value): value is string => typeof value === "string" && !/^\d{4}-\d{2}-\d{2}T/.test(value)
            );
            return userIds.flatMap((userId) => {
              const allForUser = auditRows.filter((row) => row.user_id === userId);
              if (allForUser.length === 0) return [];
              return [{
                user_id: userId,
                last_seen: allForUser.map((row) => row.ts).sort().at(-1) ?? null,
                last_business_seen: allForUser
                  .filter((row) => !isMcpProtocolMethod(row.tool))
                  .map((row) => row.ts)
                  .sort()
                  .at(-1) ?? null
              }];
            });
          })
        };
      }
      if (sql.includes("AS business_calls7")) {
        return {
          all: vi.fn((...args: unknown[]) => {
            const { userIds, startMs, endMs } = parseWindowedUserArgs(args);
            return userIds.flatMap((userId) => {
              const row = statsForUser(userId, startMs, endMs, false);
              return row ? [row] : [];
            });
          })
        };
      }
      // inferred-turn-maintainer.scanFull() reads the access_log high-water mark
      // on server start; an undefined row makes every buildServer() call throw.
      if (sql.includes("MAX(id)")) {
        return { get: vi.fn(() => ({ id: 0 })), all: vi.fn(() => []), run: vi.fn(() => ({ lastInsertRowid: 1 })) };
      }
      return { get: vi.fn(() => undefined), all: vi.fn(() => []), run: vi.fn(() => ({ lastInsertRowid: 1 })) };
    }),
    exec: vi.fn(),
    pragma: vi.fn(),
    transaction: vi.fn((fn: (...args: unknown[]) => unknown) => fn)
  })),
  recordConfigChange: vi.fn(async () => 1),
  updateConfigChangeStatus: vi.fn(async () => undefined),
  registerAgentAuditRoutes: vi.fn(),
  registerAuditRoutes: vi.fn()
}));

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
        - lucy_query
users:
  - id: zhangsan
    name: 张三
    enabled: true
    tokens:
      - hash: "sha256:aaaa"
        label: hermes-laptop
        created: 2026-06-18
    allow:
      tables:
        - dataforai.superstore_orders
      tools:
        - lucy_query
  - id: lisi
    name: 李四
    enabled: false
    tokens: []
    allow:
      tables: ["*"]
      tools: ["*"]
defaults:
  deny_tools:
    - sql_execution
`;

let projectRoot: string;
let prevRoot: string | undefined;
let previousAuth: string | undefined;

async function makeProject(yamlContent = ACCESS_YAML) {
  const root = await mkdtemp(path.join(os.tmpdir(), "ktx-admin-agents-"));
  await mkdir(path.join(root, "webui", "config"), { recursive: true });
  await mkdir(path.join(root, "semantic-layer", "mysql-aliyun", "_schema"), { recursive: true });
  await mkdir(path.join(root, ".ktx-ui"), { recursive: true });
  // Spec 182 — selector matches intersect with the connection's enabled_tables.
  // The sensitive fixture adds kx_* tables; pre-seed them so the
  // kx_fact_financial_amount / superstore_orders roles still resolve.
  const allEnabled = [
    "dataforai.superstore_orders",
    ...KX_TEMPLATE_NAMES.map((n) => `dataforai.${n}`)
  ];
  await writeFile(
    path.join(root, "ktx.yaml"),
    `connections:
  mysql-aliyun:
    driver: mysql
    enabled_tables:
${allEnabled.map((t) => `      - ${t}`).join("\n")}
`,
    "utf8"
  );
  await writeFile(path.join(root, "webui", "config", "access.yaml"), yamlContent, "utf8");
  await writeFile(path.join(root, "semantic-layer", "mysql-aliyun", "_schema", "dataforai.yaml"), "tables:\n  superstore_orders:\n    table: dataforai.superstore_orders\n", "utf8");
  return root;
}

beforeEach(async () => {
  previousAuth=process.env.LUCY_WEBUI_AUTH;process.env.LUCY_WEBUI_AUTH="off";
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-08-02T12:00:00.000Z"));
  projectRoot = await makeProject();
  prevRoot = process.env.KTX_PROJECT_ROOT;
  process.env.KTX_PROJECT_ROOT = projectRoot;
  process.env.LUCY_CONTENT_ROOT = ".";
  auditRows.length = 0;
  // A parallel P1-58 worker implementation exposes a reader injection hook.
  // Keep these unit fixtures portable to the frozen pre-worker A/B source too.
  const setReader=Reflect.get(agentStatisticsDisplayTestState,"setReader");
  if(typeof setReader==="function")setReader(async(input:{range:"7d"|"14d"|"30d";users:Array<{id:string}>})=>{
    const {agentStatsTestExports}=await import("../admin/agents.js");const {getAuditDb}=await import("../admin/audit.js");
    const {buildAgentStatsWindow}=await import("../admin/metric-window.js");const db=await getAuditDb(),window=buildAgentStatsWindow(input.range);
    const call=(name:string,...args:unknown[])=>Reflect.get(agentStatsTestExports,name)(...args);
    const snapshot=call("captureAgentAuditReadSnapshot",db);
    return {asOf:window.endIso,window,snapshot,stats:[...call("queryAgentStatsFromDb",db,input.users,window,snapshot)],
      globalActiveTokenCount:call("queryGlobalActiveTokenCount",db,window,snapshot),
      tokenUsage:[...call("queryLastUsedMapFromDb",db,input.users.map(u=>u.id),snapshot,input.users,Date.parse(window.endIso))].map(([id,tokens])=>[id,[...tokens]])};
  });
});

afterEach(async () => {
  if(previousAuth===undefined)delete process.env.LUCY_WEBUI_AUTH;else process.env.LUCY_WEBUI_AUTH=previousAuth;
  const setReader=Reflect.get(agentStatisticsDisplayTestState,"setReader");if(typeof setReader==="function")setReader();
  agentCommitTestHooks.afterCapture = null;
  agentCommitTestHooks.beforeResponse = null;
  if (prevRoot === undefined) delete process.env.KTX_PROJECT_ROOT;
  else process.env.KTX_PROJECT_ROOT = prevRoot;
  await rm(projectRoot, { recursive: true, force: true });
  vi.useRealTimers();
});

describe("P1-66 explicit roster summary projection", () => {
  it("coalesces recovery and rejects expanded fields injected into an otherwise valid sidecar", async () => {
    const app=buildServer();await app.ready();agentRosterProjectionDiagnostics.reset();
    const original=displaySnapshots.getDisplaySnapshot;let corruptSlot:symbol|undefined;
    const spy=vi.spyOn(displaySnapshots,"getDisplaySnapshot").mockImplementation(async (...args)=>{
      const slot=await original(...args);if(args[0]!=="agent-permissions")return slot;
      corruptSlot??=slot.incarnation;if(slot.incarnation!==corruptSlot)return slot;
      const small=JSON.parse(slot.sidecar!);small.summaries.zhangsan.tokens=[{hash:"must-not-leak"}];
      return {...slot,sidecar:JSON.stringify(small)};
    });
    try{
      const responses=await Promise.all(Array.from({length:10},()=>request(app.server).get("/api/admin/agents?view=roster&projection=summary").expect(200)));
      for(const r of responses)expect(JSON.stringify(r.body)).not.toContain("must-not-leak");
      expect(agentRosterProjectionDiagnostics.read().builds).toBe(2);expect(agentRosterProjectionDiagnostics.read().fullParses).toBe(0);
    }finally{spy.mockRestore();await app.close();}
  });
  it("recomputes expiring credentials while reusing the permission sidecar", async () => {
    await writeFile(path.join(projectRoot,"webui/config/access.yaml"),ACCESS_YAML.replace("label: hermes-laptop","label: hermes-laptop\n        expires_at: 2026-08-02T12:00:00.100Z"));
    const app=buildServer(); await app.ready(); agentRosterProjectionDiagnostics.reset();
    const before=await request(app.server).get("/api/admin/agents?view=roster&projection=summary").expect(200);
    expect(before.body.data.agents[0].credentialSummary.available).toBe(1);
    vi.setSystemTime(new Date("2026-08-02T12:00:00.200Z"));
    const after=await request(app.server).get("/api/admin/agents?view=roster&projection=summary").expect(200);
    expect(after.body.data.agents[0].credentialSummary.available).toBe(0);
    expect(after.body.data.meta.snapshotVersion).toBe(before.body.data.meta.snapshotVersion);
    expect(agentRosterProjectionDiagnostics.read().builds).toBe(1);await app.close();
  });
  it.each([false,true])("evicts a malformed paired slot once; permanent corruption=%s", async permanent => {
    const app=buildServer();await app.ready();agentRosterProjectionDiagnostics.reset();
    const original=displaySnapshots.getDisplaySnapshot;let corruptions=0;
    const spy=vi.spyOn(displaySnapshots,"getDisplaySnapshot").mockImplementation(async (...args)=>{
      const slot=await original(...args);
      if(args[0]==="agent-permissions" && (permanent||corruptions++===0)) return {...slot,sidecar:JSON.stringify({schemaVersion:1,summaries:{},permissionsState:"ok",policyInputs:null})};
      return slot;
    });
    try{
      const response=await request(app.server).get("/api/admin/agents?view=roster&projection=summary").expect(permanent?503:200);
      if(permanent)expect(response.body.error.code).toBe("DISPLAY_SNAPSHOT_BUSY");
      expect(agentRosterProjectionDiagnostics.read()).toEqual({builds:2,fullParses:0,sidecarParses:2});
    }finally{spy.mockRestore();await app.close();}
  });
  it("single-flights ten cold readers and never parses full permissions on the hot summary/statistics journey", async () => {
    const app=buildServer(); await app.ready(); agentRosterProjectionDiagnostics.reset();
    const rows=await Promise.all(Array.from({length:10},()=>request(app.server).get("/api/admin/agents?view=roster&projection=summary").expect(200)));
    expect(new Set(rows.map(r=>r.body.data.meta.snapshotVersion)).size).toBe(1);
    expect(agentRosterProjectionDiagnostics.read().builds).toBe(1);
    agentRosterProjectionDiagnostics.reset();
    await request(app.server).get("/api/admin/agents?view=roster&projection=summary").expect(200);
    await request(app.server).get("/api/admin/agents/statistics?range=7d").expect(200);
    expect(agentRosterProjectionDiagnostics.read()).toEqual({builds:0,fullParses:0,sidecarParses:2});
    await app.close();
  });
  it("preserves complete defaults and roster while summary excludes expanded permission and token objects", async () => {
    const app = buildServer(); await app.ready();
    const full = await request(app.server).get("/api/admin/agents").expect(200);
    const roster = await request(app.server).get("/api/admin/agents?view=roster").expect(200);
    const summary = await request(app.server).get("/api/admin/agents?view=roster&projection=summary").expect(200);
    expect(full.body.data.agents[0]).toHaveProperty("tokens");
    expect(roster.body.data.agents[0]).toHaveProperty("tokens");
    expect(summary.body.data.meta.projection).toBe("summary");
    expect(summary.body.data.meta.projectionVersion).toBe(1);
    expect(summary.body.data.meta.snapshotVersion).toBe(roster.body.data.meta.snapshotVersion);
    for (const row of summary.body.data.agents) {
      for (const key of ["tokens", "effectivePermissions", "allow", "constraints", "stats"]) expect(row).not.toHaveProperty(key);
      const original = roster.body.data.agents.find((x: {id: string}) => x.id === row.id);
      expect(row.credentialSummary.configured).toBe(original.tokens.length);
      if (original.effectivePermissions) {
        expect(row.permissionSummary.capabilityCount).toBe(original.effectivePermissions.capabilities.length);
        expect(row.permissionSummary.sourceCount).toBe(original.effectivePermissions.sources.length);
      } else expect(row.permissionSummary.capabilityCount).toBeNull();
    }
    const stats = await request(app.server).get("/api/admin/agents/statistics?range=7d").expect(200);
    expect(stats.body.data.meta.snapshotVersion).toBe(summary.body.data.meta.snapshotVersion);
    await app.close();
  });
  it.each(["projection=", "projection=unknown", "projection=summary", "view=roster&projection=summary&projection=summary", "view=roster&projection%5B%5D=summary", "view=roster&projection%5B0%5D=summary"])("rejects invalid explicit projection: %s", async (query) => {
    const app=buildServer(); await app.ready();
    const res=await request(app.server).get(`/api/admin/agents?${query}`).expect(400);
    expect(res.body.error.code).toBe("BAD_REQUEST"); await app.close();
  });
  it("P1-75 publishes the verified post-save view before the ack: first read sees the new note without a cold build", async () => {
    const app = buildServer(); await app.ready(); agentRosterProjectionDiagnostics.reset();
    const url = "/api/admin/agents?view=roster&projection=summary";
    const before = await request(app.server).get(url).expect(200);
    expect(before.body.data.agents[0].note).toBeUndefined();
    expect(agentRosterProjectionDiagnostics.read().builds).toBe(1);
    const saved = await request(app.server).patch("/api/admin/agents/zhangsan").send({ dryRun: false, patch: { note: "新备注" } }).expect(200);
    const afterAck = agentRosterProjectionDiagnostics.read().builds;
    const first = await request(app.server).get(url).expect(200);
    expect(first.body.data.agents[0].note).toBe("新备注");
    expect(first.body.data.version).toBe(saved.body.data.after.version);
    // The post-save view was already built and published before the ack; the read only hits it.
    expect(agentRosterProjectionDiagnostics.read().builds).toBe(afterAck);
    expect(first.body.data.meta.runtimeConsistency).toBe("matched");
    await app.close();
  });
  it("P1-75 keeps statistics and the roster on the same snapshot after a note-only save", async () => {
    const app = buildServer(); await app.ready();
    const url = "/api/admin/agents?view=roster&projection=summary";
    await request(app.server).get(url).expect(200);
    await request(app.server).patch("/api/admin/agents/zhangsan").send({ dryRun: false, patch: { note: "统计一致" } }).expect(200);
    const roster = await request(app.server).get(url).expect(200);
    const stats = await request(app.server).get("/api/admin/agents/statistics?range=7d").expect(200);
    expect(stats.body.data.meta.snapshotVersion).toBe(roster.body.data.meta.snapshotVersion);
    expect(stats.body.data.meta.configVersion).toBe(roster.body.data.version);
    await app.close();
  });
});
