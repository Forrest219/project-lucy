import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let projectRoot: string;
let auditDbPath: string;
let previousRoot: string | undefined;
let previousAuditDb: string | undefined;

beforeEach(async () => {
  vi.resetModules();
  projectRoot = await mkdtemp(path.join(os.tmpdir(), "ktx-admin-audit-"));
  await mkdir(projectRoot, { recursive: true });
  await writeFile(path.join(projectRoot, "ktx.yaml"), "connections: {}\n", "utf8");
  auditDbPath = path.join(projectRoot, "audit.sqlite");
  previousRoot = process.env.KTX_PROJECT_ROOT;
  previousAuditDb = process.env.LUCY_AUDIT_DB;
  process.env.KTX_PROJECT_ROOT = projectRoot;
  process.env.LUCY_AUDIT_DB = auditDbPath;
});

afterEach(async () => {
  if (previousRoot === undefined) delete process.env.KTX_PROJECT_ROOT;
  else process.env.KTX_PROJECT_ROOT = previousRoot;
  if (previousAuditDb === undefined) delete process.env.LUCY_AUDIT_DB;
  else process.env.LUCY_AUDIT_DB = previousAuditDb;
  await rm(projectRoot, { recursive: true, force: true });
});

describe("GET /api/admin/audit", () => {
  it("hides protocol calls by default, keeps CIO summary counts, and exports redacted rich CSV", async () => {
    const { writeLog } = await import("../proxy/audit");
    await writeLog({
      ts: "2026-06-21T09:00:00.000Z",
      userId: "workhorse",
      tokenLabel: "kx-readonly",
      tokenHashPrefix: "sha256:111122223333",
      client: "hermes",
      tool: "tools/list",
      outcome: "ok",
      durationMs: 3,
      requestId: "protocol-1",
      roleIds: ["kx_readonly"],
      permissionSnapshotHash: "0".repeat(64),
      effectiveTablesCount: 7,
      decisionReason: "tools_list_filtered"
    });
    await writeLog({
      ts: "2026-06-21T09:01:00.000Z",
      userId: "workhorse",
      tokenLabel: "kx-readonly",
      tokenHashPrefix: "sha256:111122223333",
      lucySessionId: "session-1",
      lucyTurnId: "turn-1",
      lucyPlatform: "telegram",
      client: "=hermes",
      tool: "sl_query",
      tables: ["dataforai.kx_fact_financial_amount"],
      argsSummary: {
        question: "=1+1",
        note: "password=hunter2",
        token: "super-secret",
        nested: { private_key: "private123" }
      },
      outcome: "ok",
      durationMs: 42,
      queryHash: "a".repeat(64),
      queryLength: 76,
      queryOperation: "select",
      queryPreview: "select * from dataforai.kx_fact_financial_amount where id = ?",
      responseBytes: 512,
      responseRowCount: 3,
      responseColumnCount: 2,
      responseTruncated: false,
      requestId: "business-1",
      roleIds: ["kx_readonly"],
      permissionSnapshotHash: "1".repeat(64),
      effectiveTablesCount: 7,
      decisionReason: "allowed"
    });
    await writeLog({
      ts: "2026-06-21T09:02:00.000Z",
      userId: "workhorse",
      tokenLabel: "kx-readonly",
      tokenHashPrefix: "sha256:111122223333",
      client: "hermes",
      tool: "sql_execution",
      argsSummary: { sql: "select 1" },
      outcome: "denied",
      errorDetail: "password=leaked",
      durationMs: 2,
      requestId: "denied-1",
      roleIds: ["kx_readonly"],
      permissionSnapshotHash: "1".repeat(64),
      effectiveTablesCount: 7,
      decisionReason: "tool_denied"
    });

    const { buildServer } = await import("../index");
    const app = buildServer();
    await app.ready();
    try {
      const res = await request(app.server).get("/api/admin/audit?limit=10").expect(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.data.total).toBe(2);
      expect(res.body.data.entries.map((entry: { tool: string }) => entry.tool)).not.toContain("tools/list");
      expect(res.body.data.summary).toMatchObject({
        protocolCalls: 1,
        businessCalls: 2,
        deniedCalls: 1,
        dataBearingCalls: 1
      });
      const business = res.body.data.entries.find((entry: { requestId: string }) => entry.requestId === "business-1");
      expect(business).toMatchObject({
        tokenLabel: "kx-readonly",
        tokenHashPrefix: "sha256:111122223333",
        lucySessionId: "session-1",
        lucyTurnId: "turn-1",
        lucyPlatform: "telegram",
        roleIds: ["kx_readonly"],
        effectiveTablesCount: 7,
        decisionReason: "allowed",
        queryHash: "a".repeat(64),
        queryLength: 76,
        queryOperation: "select",
        responseBytes: 512,
        responseRowCount: 3,
        responseColumnCount: 2,
        responseTruncated: false,
        argsSummary: {
          question: "=1+1",
          note: "password=[REDACTED]",
          token: "[REDACTED]",
          nested: { private_key: "[REDACTED]" }
        }
      });

      const withProtocol = await request(app.server).get("/api/admin/audit?includeProtocol=true&limit=10").expect(200);
      expect(withProtocol.body.data.total).toBe(3);
      expect(withProtocol.body.data.entries.map((entry: { tool: string }) => entry.tool)).toContain("tools/list");

      const csvRes = await request(app.server).get("/api/admin/audit/export").expect(200);
      const csv = csvRes.text;
      expect(csv).toContain("token_label");
      expect(csv).toContain("token_hash_prefix");
      expect(csv).toContain("lucy_session_id");
      expect(csv).toContain("query_hash");
      expect(csv).toContain("response_bytes");
      expect(csv).toContain("permission_snapshot_hash");
      expect(csv).toContain("decision_reason");
      expect(csv).toContain("[REDACTED]");
      expect(csv).toContain("'=hermes");
      expect(csv).not.toContain("tools/list");
      expect(csv).not.toContain("super-secret");
      expect(csv).not.toContain("private123");
      expect(csv).not.toContain("hunter2");
      expect(csv).not.toContain("leaked");

      const filtered = await request(app.server).get("/api/admin/audit?sessionId=session-1&limit=10").expect(200);
      expect(filtered.body.data.total).toBe(1);
      expect(filtered.body.data.entries[0].requestId).toBe("business-1");

      const sources = await request(app.server).get("/api/admin/audit/sources").expect(200);
      expect(sources.body.data.topTables).toContainEqual({
        table: "dataforai.kx_fact_financial_amount",
        calls: 1,
        denied: 0
      });
    } finally {
      await app.close();
    }
  });

  it("filters callSource=playground (auto includeProtocol) vs callSource=agent", async () => {
    const { writeLog } = await import("../proxy/audit");
    await writeLog({
      ts: "2026-06-21T10:00:00.000Z",
      userId: "zhangsan",
      tool: "tools/list",
      lucyPlatform: "mcp-playground",
      outcome: "ok",
      durationMs: 5,
      requestId: "playground-1",
      decisionReason: "allowed"
    });
    await writeLog({
      ts: "2026-06-21T10:01:00.000Z",
      userId: "zhangsan",
      tool: "lucy_query",
      lucyPlatform: "telegram",
      outcome: "ok",
      durationMs: 20,
      requestId: "agent-1",
      decisionReason: "allowed"
    });
    await writeLog({
      ts: "2026-06-21T10:02:00.000Z",
      userId: "zhangsan",
      tool: "lucy_query",
      outcome: "ok",
      durationMs: 18,
      requestId: "agent-2",
      decisionReason: "allowed"
    });

    const { buildServer } = await import("../index");
    const app = buildServer();
    await app.ready();
    try {
      const defaultList = await request(app.server).get("/api/admin/audit?limit=20").expect(200);
      expect(defaultList.body.data.entries.map((e: { requestId: string }) => e.requestId)).not.toContain("playground-1");

      const playground = await request(app.server).get("/api/admin/audit?callSource=playground&limit=20").expect(200);
      expect(playground.body.data.total).toBe(1);
      expect(playground.body.data.entries[0].requestId).toBe("playground-1");
      expect(playground.body.data.entries[0].lucyPlatform).toBe("mcp-playground");

      const agentOnly = await request(app.server).get("/api/admin/audit?callSource=agent&limit=20").expect(200);
      const agentIds = agentOnly.body.data.entries.map((e: { requestId: string }) => e.requestId);
      expect(agentIds).toContain("agent-1");
      expect(agentIds).toContain("agent-2");
      expect(agentIds).not.toContain("playground-1");

      const exportPlayground = await request(app.server).get("/api/admin/audit/export?callSource=playground").expect(200);
      expect(exportPlayground.text).toContain("playground-1");
      expect(exportPlayground.text).not.toContain("agent-1");
    } finally {
      await app.close();
    }
  });

  it("lists config changes with single-admin actor notice", async () => {
    const { recordConfigChange } = await import("../admin/audit");
    await recordConfigChange({
      filePath: "webui/config/access.yaml",
      changeType: "agent.patch",
      targetId: "workhorse",
      oldSummary: { role: "old" },
      newSummary: { role: "kx_readonly" },
      diff: "- role: old\n+ role: kx_readonly\n",
      requestId: "config-1"
    });

    const { buildServer } = await import("../index");
    const app = buildServer();
    await app.ready();
    try {
      const res = await request(app.server).get("/api/admin/config-audit?targetId=workhorse").expect(200);
      expect(res.body.data.actorMode).toBe("single_local_admin");
      expect(res.body.data.actorNotice).toContain("不具备多人问责语义");
      expect(res.body.data.total).toBe(1);
      expect(res.body.data.entries[0]).toMatchObject({
        actor: "local-admin",
        filePath: "webui/config/access.yaml",
        changeType: "agent.patch",
        targetId: "workhorse",
        requestId: "config-1"
      });

      const csvRes = await request(app.server).get("/api/admin/config-audit/export.csv?targetId=workhorse").expect(200);
      expect(csvRes.headers["content-disposition"]).toMatch(/config-audit-\d{8}-\d{6}\.csv/);
      expect(csvRes.text.charCodeAt(0)).toBe(0xFEFF);
      const csvBody = csvRes.text.replace(/^\uFEFF/, "");
      const [headerLine, firstRow] = csvBody.split("\n");
      expect(headerLine).toBe("时间,操作者,来源,资产域,变更类型,目标,文件路径");
      expect(headerLine).not.toContain("change_type");
      expect(firstRow).toContain("本机管理员");
      expect(firstRow).toContain("workhorse");
      expect(firstRow).not.toContain("local-admin");
      expect(csvBody).not.toContain("old_summary");
      expect(csvBody).not.toContain("actor_type");

      const futureSince = new Date(Date.now() + 60_000).toISOString();
      const filtered = await request(app.server)
        .get(`/api/admin/config-audit?targetId=workhorse&since=${encodeURIComponent(futureSince)}`)
        .expect(200);
      expect(filtered.body.data.total).toBe(0);

      const pastUntil = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const untilFiltered = await request(app.server)
        .get(`/api/admin/config-audit?targetId=workhorse&until=${encodeURIComponent(pastUntil)}`)
        .expect(200);
      expect(untilFiltered.body.data.total).toBe(0);
    } finally {
      await app.close();
    }
  });
});

describe("GET /api/admin/audit/:id/sources", () => {
  it("returns structured source rows for a given access_log id", async () => {
    const { writeLog, writeAccessLogSources } = await import("../proxy/audit");
    const accessLogId = await writeLog({
      ts: "2026-06-22T09:00:00.000Z",
      userId: "workhorse",
      tool: "sl_read_source",
      outcome: "ok",
      durationMs: 5,
      requestId: "sources-detail-1"
    });
    await writeAccessLogSources(accessLogId, "2026-06-22T09:00:00.000Z", "workhorse", "sl_read_source", [{
      connectionId: "mysql-aliyun",
      schemaName: "dataforai",
      sourceName: "kx_fact_financial_amount",
      physicalTable: "dataforai.kx_fact_financial_amount",
      extractionMethod: "args_source_name",
      confidence: "high"
    }]);

    const { buildServer } = await import("../index");
    const app = buildServer();
    await app.ready();
    try {
      const res = await request(app.server).get(`/api/admin/audit/${accessLogId}/sources`).expect(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.data.accessLogId).toBe(accessLogId);
      expect(res.body.data.sources).toHaveLength(1);
      expect(res.body.data.sources[0]).toMatchObject({
        userId: "workhorse",
        tool: "sl_read_source",
        connectionId: "mysql-aliyun",
        schemaName: "dataforai",
        sourceName: "kx_fact_financial_amount",
        physicalTable: "dataforai.kx_fact_financial_amount",
        extractionMethod: "args_source_name",
        confidence: "high"
      });

      const empty = await request(app.server).get(`/api/admin/audit/${accessLogId + 999}/sources`).expect(200);
      expect(empty.body.data.sources).toEqual([]);

      await request(app.server).get("/api/admin/audit/not-a-number/sources").expect(400);
    } finally {
      await app.close();
    }
  });
});

describe("GET /api/admin/audit/turns", () => {
  it("surfaces inferred and reported question clusters, individually and merged via source=all", async () => {
    const { writeLog, writeAccessLogSources, writeConversationTurn } = await import("../proxy/audit");
    const now = Date.now();
    const at = (offsetMs: number) => new Date(now + offsetMs).toISOString();

    // Inferred cluster: two close-together sl_read_source calls, no explicit turn id.
    const inf1 = await writeLog({ ts: at(0), userId: "turns-user", tool: "sl_read_source", tables: ["dataforai.superstore_orders"], outcome: "ok", durationMs: 1, requestId: "turns-inf-1" });
    await writeAccessLogSources(inf1, at(0), "turns-user", "sl_read_source", [{
      connectionId: "mysql-aliyun", schemaName: "dataforai", sourceName: "superstore_orders",
      physicalTable: "dataforai.superstore_orders", extractionMethod: "args_source_name", confidence: "high"
    }]);
    await writeLog({ ts: at(30_000), userId: "turns-user", tool: "sl_read_source", tables: ["dataforai.superstore_orders"], outcome: "ok", durationMs: 1, requestId: "turns-inf-2" });

    // Reported turn: an explicit lucy_begin_question report, linked via lucy_turn_id. The
    // report call itself also gets an access_log row with lucy_turn_id set to its own turn id
    // (mirrors mcp-proxy.ts's recordAudit call for the lucy_begin_question branch) — it must NOT
    // be counted as a linked business call.
    await writeConversationTurn({
      turnId: "lucy_turns_test_1",
      userId: "turns-user",
      questionSummary: "reported test question",
      questionSource: "reported_tool"
    });
    await writeLog({ ts: at(50_000), userId: "turns-user", tool: "lucy_begin_question", outcome: "ok", durationMs: 1, requestId: "turns-rep-report-call", lucyTurnId: "lucy_turns_test_1" });
    await writeLog({ ts: at(60_000), userId: "turns-user", tool: "sl_query", tables: ["dataforai.superstore_returns"], outcome: "ok", durationMs: 1, requestId: "turns-rep-1", lucyTurnId: "lucy_turns_test_1" });

    const { buildServer } = await import("../index");
    const app = buildServer();
    await app.ready();
    try {
      // The reported call is only 30s after the inferred pair (well within the 120s gap), so
      // inferred clustering — which doesn't know about explicit lucy_turn_id — merges all three
      // business calls into a single cluster. This is expected: inferred and reported turns can
      // legitimately overlap on the same underlying access_log rows.
      const inferredRes = await request(app.server).get("/api/admin/audit/turns?user=turns-user&source=inferred").expect(200);
      expect(inferredRes.body.data.entries).toHaveLength(1);
      expect(inferredRes.body.data.entries[0]).toMatchObject({ source: "inferred", userId: "turns-user", businessCallCount: 3 });

      const reportedRes = await request(app.server).get("/api/admin/audit/turns?user=turns-user&source=reported").expect(200);
      expect(reportedRes.body.data.entries).toHaveLength(1);
      expect(reportedRes.body.data.entries[0]).toMatchObject({
        id: "lucy_turns_test_1",
        source: "reported",
        userId: "turns-user",
        businessCallCount: 1,
        questionSummary: "reported test question"
      });

      const allRes = await request(app.server).get("/api/admin/audit/turns?user=turns-user&source=all").expect(200);
      expect(allRes.body.data.total).toBe(2);
      expect(allRes.body.data.entries.map((e: { source: string }) => e.source).sort()).toEqual(["inferred", "reported"]);
      expect(allRes.body.data.summary).toEqual({
        reportedCount: 1,
        inferredCount: 1,
        reportedShare: 0.5
      });
      expect(inferredRes.body.data.summary).toEqual({
        reportedCount: 0,
        inferredCount: 1,
        reportedShare: 0
      });
      expect(reportedRes.body.data.summary).toEqual({
        reportedCount: 1,
        inferredCount: 0,
        reportedShare: 1
      });
    } finally {
      await app.close();
    }
  });

  it("returns turn detail for both inferred and reported ids, and 404s for unknown ids", async () => {
    const { writeLog, writeConversationTurn, writeAccessLogSources } = await import("../proxy/audit");
    const now = Date.now();
    const at = (offsetMs: number) => new Date(now + offsetMs).toISOString();
    const inferredLogId = await writeLog({ ts: at(0), userId: "turns-detail-user", tool: "sl_read_source", tables: ["dataforai.superstore_orders"], outcome: "ok", durationMs: 1, requestId: "turns-detail-1" });
    await writeAccessLogSources(inferredLogId, at(0), "turns-detail-user", "sl_read_source", [{
      connectionId: "demo-mysql",
      schemaName: "dataforai",
      sourceName: "superstore_orders",
      physicalTable: "dataforai.superstore_orders",
      extractionMethod: "args_source_name",
      confidence: "high"
    }]);
    // Separate user for the reported-turn case, so its access_log rows don't bleed into the
    // inferred-cluster assertion above (clustering is purely time-based per user).
    await writeConversationTurn({ turnId: "lucy_turns_detail_1", userId: "turns-detail-reported-user", questionSummary: "detail test", questionSource: "reported_tool" });
    // The report call itself also lands in access_log with lucy_turn_id set to its own turn id
    // (mirrors mcp-proxy.ts) — the detail view's accessLogs must exclude it, same as the list view.
    await writeLog({ ts: at(5_000), userId: "turns-detail-reported-user", tool: "lucy_begin_question", outcome: "ok", durationMs: 1, requestId: "turns-detail-report-call", lucyTurnId: "lucy_turns_detail_1" });
    const linkedLogId = await writeLog({ ts: at(10_000), userId: "turns-detail-reported-user", tool: "sl_query", tables: ["dataforai.superstore_returns"], outcome: "ok", durationMs: 1, requestId: "turns-detail-linked", lucyTurnId: "lucy_turns_detail_1" });
    await writeAccessLogSources(linkedLogId, at(10_000), "turns-detail-reported-user", "sl_query", [{
      connectionId: "demo-mysql",
      schemaName: "dataforai",
      sourceName: "superstore_returns",
      physicalTable: "dataforai.superstore_returns",
      extractionMethod: "args_source_name",
      confidence: "high"
    }]);

    const { buildServer } = await import("../index");
    const app = buildServer();
    await app.ready();
    try {
      const listRes = await request(app.server).get("/api/admin/audit/turns?user=turns-detail-user&source=inferred").expect(200);
      const inferredId = listRes.body.data.entries[0].id as string;
      expect(inferredId).toMatch(/^inf_/);

      const inferredDetail = await request(app.server).get(`/api/admin/audit/turns/${inferredId}`).expect(200);
      expect(inferredDetail.body.data).toMatchObject({ id: inferredId, source: "inferred", userId: "turns-detail-user" });
      expect(inferredDetail.body.data.accessLogs).toHaveLength(1);
      expect(inferredDetail.body.data.accessLogs[0].connectionId).toBe("demo-mysql");

      const reportedDetail = await request(app.server).get("/api/admin/audit/turns/lucy_turns_detail_1").expect(200);
      expect(reportedDetail.body.data).toMatchObject({ id: "lucy_turns_detail_1", source: "reported", userId: "turns-detail-reported-user", questionSummary: "detail test" });
      expect(reportedDetail.body.data.accessLogs).toHaveLength(1);
      expect(reportedDetail.body.data.accessLogs[0].tool).toBe("sl_query");
      expect(reportedDetail.body.data.accessLogs[0].connectionId).toBe("demo-mysql");

      await request(app.server).get("/api/admin/audit/turns/inf_does_not_exist").expect(404);
      await request(app.server).get("/api/admin/audit/turns/lucy_does_not_exist").expect(404);
    } finally {
      await app.close();
    }
  });

  it("does not let a narrow-lookbackHours rebuild debounce-skip a wider one for the same user", async () => {
    const { writeLog } = await import("../proxy/audit");
    const now = Date.now();
    const at = (offsetMs: number) => new Date(now + offsetMs).toISOString();

    // A cluster well outside the 1h window but inside the 24h window.
    await writeLog({ ts: at(-20 * 60 * 60 * 1000), userId: "debounce-window-user", tool: "sl_read_source", tables: ["dataforai.superstore_orders"], outcome: "ok", durationMs: 1, requestId: "debounce-old-1" });
    // A cluster inside the 1h window.
    await writeLog({ ts: at(-5 * 60 * 1000), userId: "debounce-window-user", tool: "sl_read_source", tables: ["dataforai.superstore_orders"], outcome: "ok", durationMs: 1, requestId: "debounce-recent-1" });

    const { buildServer } = await import("../index");
    const app = buildServer();
    await app.ready();
    try {
      // First call: narrow window, only sees the recent cluster.
      const narrow = await request(app.server).get("/api/admin/audit/turns?user=debounce-window-user&source=inferred&lookbackHours=1").expect(200);
      expect(narrow.body.data.entries).toHaveLength(1);

      // Second call, immediately after (well within any debounce window): wide lookback must
      // still trigger its own rebuild and surface the older cluster too, not be skipped because
      // a rebuild for this user "just happened" under a different window size.
      const wide = await request(app.server).get("/api/admin/audit/turns?user=debounce-window-user&source=inferred&lookbackHours=24").expect(200);
      expect(wide.body.data.entries).toHaveLength(2);
    } finally {
      await app.close();
    }
  });

  it("includes timing enrichment and referenceLatency for turns list and detail", async () => {
    const { writeLog } = await import("../proxy/audit");
    const now = Date.now();
    const at = (offsetMs: number) => new Date(now + offsetMs).toISOString();

    await writeLog({ ts: at(0), userId: "latency-user", tool: "sl_query", tables: ["dataforai.superstore_orders"], outcome: "ok", durationMs: 500, requestId: "latency-slow" });
    await writeLog({ ts: at(30_000), userId: "latency-user", tool: "sl_read_source", tables: ["dataforai.superstore_orders"], outcome: "ok", durationMs: 10, requestId: "latency-fast-1" });
    await writeLog({ ts: at(60_000), userId: "latency-user", tool: "sl_read_source", tables: ["dataforai.superstore_orders"], outcome: "ok", durationMs: 10, requestId: "latency-fast-2" });

    const { buildServer } = await import("../index");
    const app = buildServer();
    await app.ready();
    try {
      const listRes = await request(app.server).get("/api/admin/audit/turns?user=latency-user&source=inferred&hours=24").expect(200);
      expect(listRes.body.data.referenceLatency).toMatchObject({
        windowHours: 24,
        totalCallsInWindow: 3
      });
      expect(listRes.body.data.referenceLatency.p95Ms).toBeGreaterThanOrEqual(10);
      expect(listRes.body.data.entries[0]).toMatchObject({
        turnSpanMs: expect.any(Number),
        totalCallDurationMs: expect.any(Number),
        maxCallDurationMs: expect.any(Number),
        slowCallCount: expect.any(Number),
        outcomeSummary: expect.objectContaining({ ok: expect.any(Number) })
      });

      const turnId = listRes.body.data.entries[0].id as string;
      const detailRes = await request(app.server).get(`/api/admin/audit/turns/${turnId}?hours=24`).expect(200);
      expect(detailRes.body.data.referenceLatency).toMatchObject({ windowHours: 24, p95Ms: expect.any(Number) });
      expect(detailRes.body.data.accessLogs[0]).toMatchObject({
        durationMs: expect.any(Number),
        isSlowCall: expect.any(Boolean)
      });
    } finally {
      await app.close();
    }
  });
});

describe("POST /api/admin/audit/conversation-turns/purge", () => {
  it("purges expired conversation turn previews via the admin API", async () => {
    const { writeConversationTurn } = await import("../proxy/audit");
    await writeConversationTurn({ turnId: "lucy_purge_api_1", userId: "purge-user", questionPreview: "preview", questionSummary: "summary", questionSource: "reported_tool" });

    const { buildServer } = await import("../index");
    const app = buildServer();
    await app.ready();
    try {
      const dryRun = await request(app.server)
        .post("/api/admin/audit/conversation-turns/purge")
        .send({ retentionDays: 0, dryRun: true })
        .expect(200);
      expect(dryRun.body.data).toEqual({ scanned: 1, purged: 0 });

      const real = await request(app.server)
        .post("/api/admin/audit/conversation-turns/purge")
        .send({ retentionDays: 0 })
        .expect(200);
      expect(real.body.data).toEqual({ scanned: 1, purged: 1 });
    } finally {
      await app.close();
    }
  });
});

describe("GET /api/admin/audit/query-artifacts", () => {
  it("decrypts cold-store SQL by requestId and records forensic access", async () => {
    process.env.LUCY_AUDIT_QUERY_KEY = "admin-audit-forensics-key";
    process.env.LUCY_AUDIT_COLD_DIR = path.join(projectRoot, "cold");

    const { writeQueryArtifact } = await import("../audit/query-artifact-store");
    const { writeLog } = await import("../proxy/audit");
    const written = await writeQueryArtifact({
      kind: "generated_sql",
      tool: "lucy_query",
      requestId: "forensic-req-1",
      plaintext: "SELECT SUM(sales) FROM orders"
    });
    expect(written).not.toBeNull();
    await writeLog({
      ts: "2026-08-20T10:00:00.000Z",
      userId: "analyst",
      tool: "lucy_query",
      outcome: "ok",
      durationMs: 12,
      requestId: "forensic-req-1",
      queryHash: written!.queryHash,
      queryArtifactRef: written!.ref,
      queryPreview: "SELECT SUM(sales) FROM orders WHERE id = ?",
    });

    const { buildServer } = await import("../index");
    const app = buildServer();
    await app.ready();
    try {
      const list = await request(app.server).get("/api/admin/audit?includeProtocol=1").expect(200);
      const entry = list.body.data.entries.find((row: { requestId: string }) => row.requestId === "forensic-req-1");
      expect(entry.queryArtifactRef).toBe(written!.ref);
      expect(list.body.data.entries.every((row: { plaintext?: string }) => row.plaintext === undefined)).toBe(true);

      const viewed = await request(app.server)
        .get("/api/admin/audit/query-artifacts?requestId=forensic-req-1")
        .expect(200);
      expect(viewed.body.data.plaintext).toBe("SELECT SUM(sales) FROM orders");
      expect(viewed.body.data.kind).toBe("generated_sql");

      const { getAuditDb } = await import("../admin/audit");
      const db = await getAuditDb();
      const access = db
        .prepare("SELECT outcome, artifact_ref FROM query_artifact_access_log ORDER BY id DESC LIMIT 1")
        .get() as { outcome: string; artifact_ref: string };
      expect(access.outcome).toBe("ok");
      expect(access.artifact_ref).toBe(written!.ref);
    } finally {
      await app.close();
      delete process.env.LUCY_AUDIT_QUERY_KEY;
      delete process.env.LUCY_AUDIT_COLD_DIR;
    }
  });
});

describe("Spec 125 generated_sql hot store", () => {
  it("returns generatedSql on list and CSV without requiring cold-store key", async () => {
    const { writeLog } = await import("../proxy/audit");
    await writeLog({
      ts: "2026-08-21T10:00:00.000Z",
      userId: "analyst",
      tool: "lucy_query",
      outcome: "ok",
      durationMs: 9,
      requestId: "gen-sql-req-1",
      generatedSql: "SELECT SUM(sales) AS total FROM dataforai.superstore_orders",
      queryHash: "b".repeat(64),
      queryLength: 58,
      queryOperation: "select"
    });
    await writeLog({
      ts: "2026-08-21T10:01:00.000Z",
      userId: "attacker",
      tool: "lucy_query",
      outcome: "denied",
      durationMs: 2,
      requestId: "raw-deny-req-1",
      queryPreview: "select * from secret where id = ?",
      decisionReason: "raw_query_forbidden"
    });

    const { buildServer } = await import("../index");
    const app = buildServer();
    await app.ready();
    try {
      const list = await request(app.server).get("/api/admin/audit?includeProtocol=1").expect(200);
      const okRow = list.body.data.entries.find((row: { requestId: string }) => row.requestId === "gen-sql-req-1");
      const denyRow = list.body.data.entries.find((row: { requestId: string }) => row.requestId === "raw-deny-req-1");
      expect(okRow.generatedSql).toBe("SELECT SUM(sales) AS total FROM dataforai.superstore_orders");
      expect(denyRow.generatedSql).toBeUndefined();

      const csv = await request(app.server).get("/api/admin/audit/export?includeProtocol=1").expect(200);
      expect(csv.text).toContain("generated_sql");
      expect(csv.text).toContain("SELECT SUM(sales) AS total FROM dataforai.superstore_orders");
    } finally {
      await app.close();
    }
  });
});
