/**
 * Spec 20261107 §7 — Proxy 层空结果 next_step 落位（SC-09…SC-30 关键路径）。
 *
 * 夹具：自建上游 + buildProxy + fetch（对齐 mcp-proxy-smoke 启动方式）。
 * 不发真实数据查询。
 */
import Database from "better-sqlite3";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TRUNCATION_REPAIR_HINT } from "../proxy/question-experience.js";

const TOKEN = "empty-next-step-token";
const SCOPED_TOKEN = "empty-next-step-scoped-token";
const INTERNAL_TOKEN = "empty-next-step-internal-token";

function tokenHash(token: string): string {
  return "sha256:" + createHash("sha256").update(token).digest("hex");
}

function readRequestBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

const ACCESS_YAML = `users:
  - id: empty_next_agent
    name: Empty Next Agent
    enabled: true
    tokens:
      - hash: "${tokenHash(TOKEN)}"
        label: empty-next-token
        created: 2026-11-09
    allow:
      connections:
        - mysql-aliyun
      tables:
        - dataforai.superstore_orders
        - dataforai.superstore_people
      tools:
        - lucy_catalog
        - lucy_begin_question
        - lucy_continue_question
        - lucy_read_source
        - lucy_query
        - lucy_explain_query
        - lucy_freshness
        - sl_read_source
        - sl_query
defaults:
  deny_tools: []
`;

const SCHEMA_YAML = `tables:
  superstore_orders:
    table: dataforai.superstore_orders
  superstore_people:
    table: dataforai.superstore_people
`;

const SCOPED_ACCESS_YAML = `roles:
  scoped_east:
    permission_model_version: 2
    allow:
      connections: [warehouse]
      tableSelectors:
        - connection: warehouse
          schema: fin
          names: [fin_ledger]
          row_access: scoped
          row_policy:
            predicates:
              - field: region
                op: eq
                value: East
      tools:
        - lucy_query
        - lucy_read_source
        - lucy_freshness
users:
  - id: scoped_empty_agent
    enabled: true
    role: scoped_east
    tokens:
      - hash: "${tokenHash(SCOPED_TOKEN)}"
        label: scoped-empty-token
        created: 2026-11-09
defaults:
  deny_tools: []
`;

type LucyResult = {
  content?: Array<{ type?: string; text?: string }>;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
  _meta?: {
    lucy?: {
      next_step?: { kind?: string; query?: { filters?: { items?: Array<{ field?: string }> }; count?: number } };
      next_step_skipped_reason?: string;
      answer_verifiability?: unknown;
      repair?: string;
      tool?: string;
      result?: { rowCount?: number | null };
    };
  };
};

type RpcResult = { id?: unknown; result?: LucyResult; error?: unknown };

let projectRoot: string;
let auditDbPath: string;
let previousRoot: string | undefined;
let previousContentRoot: string | undefined;
let previousAuditDb: string | undefined;
let previousInternalToken: string | undefined;
let previousUpstreamHost: string | undefined;
let previousUpstreamPort: string | undefined;
let previousProven: string | undefined;

async function makeProject() {
  const root = await mkdtemp(path.join(os.tmpdir(), "lucy-empty-next-step-"));
  await mkdir(path.join(root, "webui", "config"), { recursive: true });
  await mkdir(path.join(root, "semantic-layer", "mysql-aliyun", "_schema"), { recursive: true });
  await mkdir(path.join(root, "wiki", "global"), { recursive: true });
  // Align with mcp-proxy-smoke: empty connections map; ACL tables drive visibility.
  await writeFile(path.join(root, "ktx.yaml"), "connections: {}\n", "utf8");
  await writeFile(path.join(root, "webui", "config", "access.yaml"), ACCESS_YAML, "utf8");
  await writeFile(
    path.join(root, "semantic-layer", "mysql-aliyun", "_schema", "dataforai.yaml"),
    SCHEMA_YAML,
    "utf8"
  );
  return root;
}

beforeEach(async () => {
  vi.resetModules();
  projectRoot = await makeProject();
  auditDbPath = path.join(projectRoot, "audit.sqlite");
  previousRoot = process.env.KTX_PROJECT_ROOT;
  previousContentRoot = process.env.LUCY_CONTENT_ROOT;
  previousAuditDb = process.env.LUCY_AUDIT_DB;
  previousInternalToken = process.env.KTX_INTERNAL_TOKEN;
  previousUpstreamHost = process.env.LUCY_PROXY_UPSTREAM_HOST;
  previousUpstreamPort = process.env.LUCY_PROXY_UPSTREAM_PORT;
  previousProven = process.env.LUCY_UPSTREAM_FORCED_PREDICATE_PROVEN;
  process.env.KTX_PROJECT_ROOT = projectRoot;
  process.env.LUCY_CONTENT_ROOT = ".";
  process.env.LUCY_AUDIT_DB = auditDbPath;
  process.env.KTX_INTERNAL_TOKEN = INTERNAL_TOKEN;
  delete process.env.LUCY_UPSTREAM_FORCED_PREDICATE_PROVEN;
});

afterEach(async () => {
  if (previousRoot === undefined) delete process.env.KTX_PROJECT_ROOT;
  else process.env.KTX_PROJECT_ROOT = previousRoot;
  if (previousContentRoot === undefined) delete process.env.LUCY_CONTENT_ROOT;
  else process.env.LUCY_CONTENT_ROOT = previousContentRoot;
  if (previousAuditDb === undefined) delete process.env.LUCY_AUDIT_DB;
  else process.env.LUCY_AUDIT_DB = previousAuditDb;
  if (previousInternalToken === undefined) delete process.env.KTX_INTERNAL_TOKEN;
  else process.env.KTX_INTERNAL_TOKEN = previousInternalToken;
  if (previousUpstreamHost === undefined) delete process.env.LUCY_PROXY_UPSTREAM_HOST;
  else process.env.LUCY_PROXY_UPSTREAM_HOST = previousUpstreamHost;
  if (previousUpstreamPort === undefined) delete process.env.LUCY_PROXY_UPSTREAM_PORT;
  else process.env.LUCY_PROXY_UPSTREAM_PORT = previousUpstreamPort;
  if (previousProven === undefined) delete process.env.LUCY_UPSTREAM_FORCED_PREDICATE_PROVEN;
  else process.env.LUCY_UPSTREAM_FORCED_PREDICATE_PROVEN = previousProven;
  await rm(projectRoot, { recursive: true, force: true });
});

async function waitForAuditRow(requestId: string, timeoutMs = 1500): Promise<Record<string, unknown>> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const db = new Database(auditDbPath, { readonly: true });
    try {
      const row = db.prepare("SELECT * FROM access_log WHERE request_id = ?").get(requestId) as
        | Record<string, unknown>
        | undefined;
      if (row) return row;
    } finally {
      db.close();
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`audit row not found for request_id=${requestId}`);
}

type UpstreamMode = "json" | "sse";

async function withProxyCall(input: {
  mode: UpstreamMode;
  statusCode?: number;
  result: LucyResult;
  toolName?: string;
  args?: Record<string, unknown>;
  token?: string;
  requestId?: string;
  spyAllowedTools?: boolean;
  /** Skip P0-3 begin when the tool is not under the ambiguity gate. */
  skipBegin?: boolean;
  /** When upstream status ≠ 200, proxy may forward that status (SC-30). */
  allowNon200?: boolean;
  /**
   * P0-4 C2：模拟 SSE 可 decode 但 extractSseJsonRpcResponseRaw 拿不到 raw
   * → 必须 B-ASSEMBLE，禁止静默无块。
   */
  missingOriginalEnvelopeWire?: boolean;
}): Promise<{ parsed: RpcResult; allowedToolCalls: number; upstreamText: string }> {
  const toolName = input.toolName ?? "lucy_query";
  const requestId = input.requestId ?? `empty-next-${input.mode}-${Date.now()}`;
  const statusCode = input.statusCode ?? 200;
  const sessionId = `empty-next-session-${requestId}`;
  const token = input.token ?? TOKEN;
  let upstreamText = "";
  let allowedToolCalls = 0;

  const upstream = createServer(async (req, res) => {
    const body = JSON.parse(await readRequestBody(req)) as { id: string };
    const payload = {
      jsonrpc: "2.0",
      id: body.id,
      result: input.result
    };
    if (input.mode === "sse") {
      const sseBody = `event: message\ndata: ${JSON.stringify(payload)}\n\n`;
      res.writeHead(statusCode, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
        "content-length": Buffer.byteLength(sseBody)
      });
      res.end(sseBody);
    } else {
      const jsonBody = JSON.stringify(payload);
      res.writeHead(statusCode, {
        "content-type": "application/json",
        "content-length": Buffer.byteLength(jsonBody)
      });
      res.end(jsonBody);
    }
  });

  await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve));
  process.env.LUCY_PROXY_UPSTREAM_HOST = "127.0.0.1";
  process.env.LUCY_PROXY_UPSTREAM_PORT = String((upstream.address() as AddressInfo).port);

  // mcp-proxy caches KTX_PORT at module load — must re-import after each port bind.
  vi.resetModules();
  // C2 mock 不得泄漏到后续用例：每次显式 doMock 或 unmock。
  if (input.missingOriginalEnvelopeWire) {
    vi.doMock("../proxy/answer-verifiability.js", async () => {
      const actual = await vi.importActual<typeof import("../proxy/answer-verifiability.js")>(
        "../proxy/answer-verifiability.js"
      );
      return {
        ...actual,
        extractSseJsonRpcResponseRaw: () => undefined
      };
    });
  } else {
    vi.doUnmock("../proxy/answer-verifiability.js");
  }
  const acl = await import("../proxy/acl.js");
  if (input.spyAllowedTools) {
    const original = acl.allowedToolNames;
    vi.spyOn(acl, "allowedToolNames").mockImplementation(async (...args) => {
      allowedToolCalls += 1;
      return original.apply(acl, args);
    });
  }

  const { buildProxy } = await import("../proxy/mcp-proxy.js");
  const { server, host } = buildProxy();
  await new Promise<void>((resolve) => server.listen(0, host, resolve));
  const proxyPort = (server.address() as AddressInfo).port;

  const authHeaders = {
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
    authorization: `Bearer ${token}`,
    "x-lucy-session-id": sessionId
  };

  try {
    // P0-3：never_begun + 已断言 source（qualified measures）会 source_ambiguity_gate。
    // 先 begin；intent 用无命中词 → zero_hits 放行后续 lucy_query。
    if (toolName === "lucy_query" && input.skipBegin !== true) {
      const beginRes = await fetch(`http://127.0.0.1:${proxyPort}/mcp`, {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: `${requestId}-begin`,
          method: "tools/call",
          params: {
            name: "lucy_begin_question",
            arguments: { intentSummary: "zzz_nomatch_empty_next_step_fixture" }
          }
        })
      });
      expect(beginRes.status).toBe(200);
      const beginBody = (await beginRes.json()) as { result?: { isError?: boolean; content?: Array<{ text?: string }> } };
      expect(beginBody.result?.isError).not.toBe(true);
    }

    const firstText = input.result.content?.[0]?.text;
    upstreamText = typeof firstText === "string" ? firstText : "";
    // Reset spy counter after begin so SC-18/20/30 only count enrichment-path calls.
    if (input.spyAllowedTools) allowedToolCalls = 0;
    const res = await fetch(`http://127.0.0.1:${proxyPort}/mcp`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: requestId,
        method: "tools/call",
        params: {
          name: toolName,
          arguments: input.args ?? {
            connectionId: "mysql-aliyun",
            measures: ["superstore_orders.sales"],
            limit: 5
          }
        }
      })
    });
    // JSON-RPC-shaped upstream errors may keep the upstream HTTP status (e.g. 500).
    expect([200, statusCode]).toContain(res.status);
    const parsed = (await res.json()) as RpcResult;
    return { parsed, allowedToolCalls, upstreamText };
  } finally {
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
    await new Promise<void>((resolve, reject) => upstream.close((err) => (err ? reject(err) : resolve())));
  }
}

function emptyPayload(overrides: {
  text?: string;
  structured?: Record<string, unknown> | null;
  isError?: boolean;
  truncated?: boolean;
} = {}): LucyResult {
  const data = {
    headers: ["dau"],
    rows: [] as unknown[],
    totalRows: 0,
    ...(overrides.truncated ? { truncated: true } : {})
  };
  const text = overrides.text ?? JSON.stringify(data);
  const result: LucyResult = {
    content: [{ type: "text", text }],
    ...(overrides.isError ? { isError: true } : {})
  };
  if (overrides.structured === null) {
    // omit structuredContent
  } else if (overrides.structured) {
    result.structuredContent = overrides.structured;
  } else {
    result.structuredContent = { ...data };
  }
  return result;
}

describe("empty-result next_step proxy", () => {
  it("SC-09／SC-10 空结果带 next_step，三处一致且上游取值不变", async () => {
    const { parsed } = await withProxyCall({
      mode: "json",
      result: emptyPayload(),
      requestId: "sc-09"
    });
    const meta = parsed.result?._meta?.lucy;
    expect(meta?.next_step?.kind).toBe("empty_result");
    const text = parsed.result?.content?.[0]?.text ?? "";
    const data = JSON.parse(text) as Record<string, unknown>;
    expect(data.next_step).toEqual(meta?.next_step);
    expect(data.headers).toEqual(["dau"]);
    expect(data.rows).toEqual([]);
    expect(data.totalRows).toBe(0);
    expect(data.answer_verifiability).toBeTruthy();
    expect(parsed.result?.structuredContent?.next_step).toEqual(meta?.next_step);
    expect(parsed.result?.structuredContent?.answer_verifiability).toBeTruthy();
    expect(meta?.answer_verifiability).toBeTruthy();
    expect(parsed.result?.content?.length).toBe(1);
  });

  it("SC-11 非空结果无 next_step；P0-4 可核对块与业务字段共存", async () => {
    const upstreamData = { headers: ["dau"], rows: [["2902"]], totalRows: 1 };
    const upstreamText = JSON.stringify(upstreamData);
    const upstreamStructured = { ...upstreamData };
    const { parsed } = await withProxyCall({
      mode: "json",
      result: {
        content: [{ type: "text", text: upstreamText }],
        structuredContent: upstreamStructured
      },
      requestId: "sc-11",
      spyAllowedTools: true
    });
    // 与 AV 共存后不再要求整段 text 与上游逐字节相等；业务字段须保真。
    const textObj = JSON.parse(parsed.result?.content?.[0]?.text ?? "{}") as Record<string, unknown>;
    expect(textObj.headers).toEqual(["dau"]);
    expect(textObj.rows).toEqual([["2902"]]);
    expect(textObj.totalRows).toBe(1);
    expect(textObj.answer_verifiability).toBeTruthy();
    expect(parsed.result?.structuredContent?.headers).toEqual(["dau"]);
    expect(parsed.result?.structuredContent?.rows).toEqual([["2902"]]);
    expect(parsed.result?.structuredContent?.answer_verifiability).toBeTruthy();
    expect(parsed.result?._meta?.lucy?.next_step).toBeUndefined();
    expect(parsed.result?._meta?.lucy?.answer_verifiability).toBeTruthy();
    expect(parsed.result?.content?.length).toBe(1);
  });

  it("SC-12 text 不是 JSON 对象 → 018 不注入；skipped_reason 不被 AV 抹掉", async () => {
    const { parsed } = await withProxyCall({
      mode: "json",
      result: emptyPayload({ text: "plain text" }),
      requestId: "sc-12"
    });
    // P0-4 D6／B-ASSEMBLE：成功查数 text 非 JSON 对象不得标 success。
    expect(parsed.result?.isError).toBe(true);
    const errText = parsed.result?.content?.[0]?.text ?? "";
    expect(errText).toContain("answer_verifiability_assemble_failed");
    expect(parsed.result?.structuredContent?.next_step).toBeUndefined();
    expect(parsed.result?._meta?.lucy?.next_step).toBeUndefined();
    // M2／SC-12：AV 错误信封必须保留 018 已写入的 skipped_reason。
    expect(parsed.result?._meta?.lucy?.next_step_skipped_reason).toBe("content_text_not_json_object");
  });

  it("C2：SSE 成功查数缺 originalEnvelopeWire → isError／assemble_failed，无成功块", async () => {
    const upstreamText = JSON.stringify({
      headers: ["dau"],
      rows: [["2902"]],
      totalRows: 1
    });
    const { parsed } = await withProxyCall({
      mode: "sse",
      result: {
        content: [{ type: "text", text: upstreamText }],
        structuredContent: { headers: ["dau"], rows: [["2902"]], totalRows: 1 }
      },
      requestId: "c2-missing-wire",
      missingOriginalEnvelopeWire: true
    });
    expect(parsed.result?.isError).toBe(true);
    const errText = parsed.result?.content?.[0]?.text ?? "";
    expect(errText).toContain("answer_verifiability_assemble_failed");
    expect(errText).toContain("missing_original_envelope_wire");
    // 禁止静默成功无块：错误路径不得带合法 success 块。
    expect(parsed.result?.structuredContent?.answer_verifiability).toBeUndefined();
    expect(parsed.result?._meta?.lucy?.answer_verifiability).toBeUndefined();
    try {
      const maybe = JSON.parse(errText) as { answer_verifiability?: unknown };
      expect(maybe.answer_verifiability).toBeUndefined();
    } catch {
      // errText 本身是 reason JSON，无 success 块即可
    }
  });

  it("SC-18 JSON：200 + isError:true + rows:[] 不发且不调 allowedToolNames", async () => {
    const { parsed, allowedToolCalls } = await withProxyCall({
      mode: "json",
      result: emptyPayload({ isError: true }),
      requestId: "sc-18-json",
      spyAllowedTools: true
    });
    expect(parsed.result?._meta?.lucy?.next_step).toBeUndefined();
    expect(parsed.result?._meta?.lucy?.next_step_skipped_reason).toBe("result_is_error");
    expect(allowedToolCalls).toBe(0);
  });

  it("SC-18 SSE：200 + isError:true + rows:[] 不发且不调 allowedToolNames", async () => {
    const { parsed, allowedToolCalls } = await withProxyCall({
      mode: "sse",
      result: emptyPayload({ isError: true }),
      requestId: "sc-18-sse",
      spyAllowedTools: true
    });
    expect(parsed.result?._meta?.lucy?.next_step).toBeUndefined();
    expect(parsed.result?._meta?.lucy?.next_step_skipped_reason).toBe("result_is_error");
    expect(allowedToolCalls).toBe(0);
  });

  it("SC-19 上游 text 已带 next_step 键时不覆盖（可与 P0-4 块共存）", async () => {
    const upstreamText = JSON.stringify({
      headers: ["dau"],
      rows: [],
      totalRows: 0,
      next_step: { upstream: true }
    });
    const { parsed } = await withProxyCall({
      mode: "json",
      result: emptyPayload({ text: upstreamText, structured: { headers: ["dau"], rows: [], totalRows: 0 } }),
      requestId: "sc-19"
    });
    const textObj = JSON.parse(parsed.result?.content?.[0]?.text ?? "{}") as Record<string, unknown>;
    expect(textObj.next_step).toEqual({ upstream: true });
    expect(textObj.headers).toEqual(["dau"]);
    expect(textObj.answer_verifiability).toBeTruthy();
    expect(parsed.result?._meta?.lucy?.next_step).toBeUndefined();
    expect(parsed.result?._meta?.lucy?.next_step_skipped_reason).toBe("upstream_next_step_present");
    expect(parsed.result?._meta?.lucy?.answer_verifiability).toBeTruthy();
  });

  it("SC-20 有数据／非 lucy_query 时不触发可见性裁决（计数）", async () => {
    const nonempty = await withProxyCall({
      mode: "json",
      result: {
        content: [{ type: "text", text: JSON.stringify({ headers: ["dau"], rows: [["1"]], totalRows: 1 }) }],
        structuredContent: { headers: ["dau"], rows: [["1"]], totalRows: 1 }
      },
      requestId: "sc-20-a",
      spyAllowedTools: true
    });
    expect(nonempty.parsed.result?._meta?.lucy?.next_step).toBeUndefined();
    expect(nonempty.allowedToolCalls).toBe(0);

    const readSource = await withProxyCall({
      mode: "json",
      toolName: "lucy_read_source",
      args: { connectionId: "mysql-aliyun", sourceName: "superstore_orders" },
      result: emptyPayload(),
      requestId: "sc-20-b",
      spyAllowedTools: true
    });
    expect(readSource.parsed.result?._meta?.lucy?.next_step).toBeUndefined();
    expect(readSource.allowedToolCalls).toBe(0);
  });

  it("SC-22 无 structuredContent 时 text＋meta 仍注入", async () => {
    const { parsed } = await withProxyCall({
      mode: "json",
      result: emptyPayload({ structured: null }),
      requestId: "sc-22"
    });
    expect(parsed.result?.structuredContent).toBeUndefined();
    expect(parsed.result?._meta?.lucy?.next_step?.kind).toBe("empty_result");
    expect(JSON.parse(parsed.result?.content?.[0]?.text ?? "").next_step).toEqual(
      parsed.result?._meta?.lucy?.next_step
    );
  });

  it("SC-23 structured 已有 next_step、text 无 → 018 整单跳过；P0-4 仍可投影", async () => {
    const upstreamText = JSON.stringify({ headers: ["dau"], rows: [], totalRows: 0 });
    const { parsed } = await withProxyCall({
      mode: "json",
      result: {
        content: [{ type: "text", text: upstreamText }],
        structuredContent: { headers: ["dau"], rows: [], totalRows: 0, next_step: { upstream: true } }
      },
      requestId: "sc-23"
    });
    expect(parsed.result?.structuredContent?.next_step).toEqual({ upstream: true });
    const textObj = JSON.parse(parsed.result?.content?.[0]?.text ?? "{}") as Record<string, unknown>;
    expect(textObj.next_step).toBeUndefined();
    expect(textObj.headers).toEqual(["dau"]);
    expect(textObj.answer_verifiability).toBeTruthy();
    expect(parsed.result?.structuredContent?.answer_verifiability).toBeTruthy();
    expect(parsed.result?._meta?.lucy?.next_step).toBeUndefined();
    expect(parsed.result?._meta?.lucy?.next_step_skipped_reason).toBe("upstream_next_step_present");
  });

  it("SC-24 rows=[] 且截断 → repair 与 next_step 并存", async () => {
    const { parsed } = await withProxyCall({
      mode: "json",
      result: emptyPayload({ truncated: true }),
      requestId: "sc-24"
    });
    expect(parsed.result?._meta?.lucy?.repair).toBe(TRUNCATION_REPAIR_HINT);
    expect(parsed.result?._meta?.lucy?.next_step?.kind).toBe("empty_result");
  });

  for (const [label, token] of [
    ["overflow", "1e400"],
    ["precision", "9007199254740993"],
    ["underflow", "1e-400"]
  ] as const) {
    it(`SC-25 ${label}：018 跳过 next_step；P0-4 保留字面量并加可核对块`, async () => {
      const upstreamText = `{"headers":["dau"],"rows":[],"totalRows":${token}}`;
      // Keep structuredContent free of non-finite / rewritten numbers so only
      // content[0].text carries the unsafe raw token under test.
      const { parsed } = await withProxyCall({
        mode: "json",
        result: emptyPayload({
          text: upstreamText,
          structured: { headers: ["dau"], rows: [] }
        }),
        requestId: `sc-25-${label}-${Date.now()}`
      });
      expect(parsed.error, label).toBeUndefined();
      const finalText = parsed.result?.content?.[0]?.text ?? "";
      expect(finalText, label).toContain(token);
      expect(finalText, label).toContain("answer_verifiability");
      expect(parsed.result?._meta?.lucy?.next_step, label).toBeUndefined();
      expect(parsed.result?._meta?.lucy?.next_step_skipped_reason, label).toBe(
        "content_json_number_not_fidelity_safe"
      );
      expect(parsed.result?._meta?.lucy?.answer_verifiability, label).toBeTruthy();
    });
  }

  it("SC-30 JSON／SSE：HTTP 500 + JSON-RPC result + rows:[] → 无 next_step 且不调 allowedToolNames", async () => {
    for (const mode of ["json", "sse"] as const) {
      const { parsed, allowedToolCalls } = await withProxyCall({
        mode,
        statusCode: 500,
        result: emptyPayload(),
        requestId: `sc-30-${mode}`,
        spyAllowedTools: true,
        allowNon200: true
      });
      expect(parsed.result?._meta?.lucy?.next_step).toBeUndefined();
      expect(parsed.result?._meta?.lucy?.answer_verifiability).toBeUndefined();
      expect(allowedToolCalls).toBe(0);
    }
  });

  it("SC-14 审计行数不被污染，载荷无 rows/totalRows/columns/headers 键", async () => {
    const { parsed } = await withProxyCall({
      mode: "json",
      result: emptyPayload(),
      requestId: "sc-14",
      args: {
        connectionId: "mysql-aliyun",
        measures: ["superstore_orders.sales"],
        dimensions: [{ field: "superstore_orders.region", granularity: "day", extra: true }],
        orderBy: [{ field: "superstore_orders.region", direction: "asc", rows: [] }],
        limit: 5
      }
    });
    const step = parsed.result?._meta?.lucy?.next_step;
    expect(step?.kind).toBe("empty_result");
    const payload = JSON.stringify(step);
    for (const banned of ["\"rows\"", "\"totalRows\"", "\"columns\"", "\"headers\"", "\"extra\""]) {
      expect(payload).not.toContain(banned);
    }
    const audit = await waitForAuditRow("sc-14");
    expect(audit.response_row_count).toBe(0);
  });

  it("SC-26／SC-27 ACL 外表／未授权表拒绝 → 无 next_step", async () => {
    const upstream = createServer(async (_req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ jsonrpc: "2.0", id: "deny", result: { content: [{ type: "text", text: "should-not-reach" }] } }));
    });
    await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve));
    process.env.LUCY_PROXY_UPSTREAM_HOST = "127.0.0.1";
    process.env.LUCY_PROXY_UPSTREAM_PORT = String((upstream.address() as AddressInfo).port);
    const { buildProxy } = await import("../proxy/mcp-proxy.js");
    const { server, host } = buildProxy();
    await new Promise<void>((resolve) => server.listen(0, host, resolve));
    const proxyPort = (server.address() as AddressInfo).port;
    try {
      const res = await fetch(`http://127.0.0.1:${proxyPort}/mcp`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${TOKEN}`
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: "sc-26",
          method: "tools/call",
          params: {
            name: "lucy_query",
            arguments: {
              connectionId: "mysql-aliyun",
              measures: ["unknown_table.sales"],
              limit: 5
            }
          }
        })
      });
      const parsed = (await res.json()) as RpcResult;
      expect(parsed.result?._meta?.lucy?.next_step).toBeUndefined();
      const text = parsed.result?.content?.[0]?.text ?? "";
      // denial path: either structured denial JSON or error; never Lucy next_step
      if (text.trim().startsWith("{")) {
        const body = JSON.parse(text) as Record<string, unknown>;
        expect(body.next_step).toBeUndefined();
      }
    } finally {
      await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
      await new Promise<void>((resolve, reject) => upstream.close((err) => (err ? reject(err) : resolve())));
    }
  });

  it("SC-28 非 lucy_query 成功 0 行样例 → 无 next_step 且 SC-20 计数为 0", async () => {
    const { parsed, allowedToolCalls } = await withProxyCall({
      mode: "sse",
      toolName: "lucy_read_source",
      args: { connectionId: "mysql-aliyun", sourceName: "superstore_orders" },
      result: emptyPayload(),
      requestId: "sc-28",
      spyAllowedTools: true
    });
    expect(parsed.result?._meta?.lucy?.next_step).toBeUndefined();
    expect(allowedToolCalls).toBe(0);
  });

  it("N7 用户 filters 去值摘要进入 next_step.query，不含原始值", async () => {
    // 完整 forced-filter 角色夹具依赖行策略 catalog；本条先锁 D6 快照不变量：
    // originalUserFilters 去值后进入 query.filters，原始 value 不得出现。
    const { parsed } = await withProxyCall({
      mode: "json",
      result: emptyPayload(),
      requestId: "n7",
      args: {
        connectionId: "mysql-aliyun",
        measures: ["superstore_orders.sales"],
        filters: [{ field: "company", op: "contains", value: "某某公司" }],
        limit: 5
      }
    });
    const rawText = parsed.result?.content?.[0]?.text ?? "";
    expect(rawText.startsWith("Access denied")).toBe(false);
    const text = JSON.parse(rawText) as {
      next_step?: { query?: { filters?: { count?: number; items?: Array<{ field?: string; op?: string }> } } };
    };
    const filters = text.next_step?.query?.filters;
    expect(filters?.count).toBe(1);
    const fields = (filters?.items ?? []).map((i) => i.field);
    expect(fields).toContain("company");
    expect(JSON.stringify(filters)).not.toContain("某某公司");
    expect(JSON.stringify(filters)).not.toContain("forced");
  });

  it("SC-13(b) 018 注入成功后 AV 键冲突失败 → _meta 仍含 next_step", async () => {
    // 上游 text 已带 answer_verifiability → 018 可注入 next_step；AV 投影键冲突 → 错误信封。
    const upstreamText = JSON.stringify({
      headers: ["dau"],
      rows: [],
      totalRows: 0,
      answer_verifiability: { upstream: true }
    });
    const { parsed } = await withProxyCall({
      mode: "json",
      result: emptyPayload({
        text: upstreamText,
        structured: { headers: ["dau"], rows: [], totalRows: 0 }
      }),
      requestId: "sc-13b"
    });
    expect(parsed.result?.isError).toBe(true);
    const errText = parsed.result?.content?.[0]?.text ?? "";
    expect(errText).toContain("answer_verifiability_assemble_failed");
    expect(parsed.result?._meta?.lucy?.next_step?.kind).toBe("empty_result");
  });

  it("SC-13(a) 018 富化抛错（AV 尚未执行）→ 无 next_step", async () => {
    // Unsupported content-type forces metaFailed before AV；HTTP 200 → P0-4 错误信封，无 018 指导。
    const upstream = createServer(async (req, res) => {
      const body = JSON.parse(await readRequestBody(req)) as { id: string };
      const payload = {
        jsonrpc: "2.0",
        id: body.id,
        result: emptyPayload()
      };
      const raw = JSON.stringify(payload);
      res.writeHead(200, {
        "content-type": "text/plain",
        "content-length": Buffer.byteLength(raw)
      });
      res.end(raw);
    });
    await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve));
    process.env.LUCY_PROXY_UPSTREAM_HOST = "127.0.0.1";
    process.env.LUCY_PROXY_UPSTREAM_PORT = String((upstream.address() as AddressInfo).port);
    const { buildProxy } = await import("../proxy/mcp-proxy.js");
    const { server, host } = buildProxy();
    await new Promise<void>((resolve) => server.listen(0, host, resolve));
    const proxyPort = (server.address() as AddressInfo).port;
    const sessionId = "sc-13-session";
    try {
      await fetch(`http://127.0.0.1:${proxyPort}/mcp`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${TOKEN}`,
          "x-lucy-session-id": sessionId
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: "sc-13-begin",
          method: "tools/call",
          params: {
            name: "lucy_begin_question",
            arguments: { intentSummary: "zzz_nomatch_empty_next_step_fixture" }
          }
        })
      });
      const res = await fetch(`http://127.0.0.1:${proxyPort}/mcp`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${TOKEN}`,
          "x-lucy-session-id": sessionId
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: "sc-13",
          method: "tools/call",
          params: {
            name: "lucy_query",
            arguments: {
              connectionId: "mysql-aliyun",
              measures: ["superstore_orders.sales"],
              limit: 5
            }
          }
        })
      });
      const text = await res.text();
      const body = JSON.parse(text) as RpcResult;
      // SC-13(a)：018 未完成 → 无 next_step／skipped_reason（HTTP 200 可为 P0-4 错误信封）。
      expect(body.result?._meta?.lucy?.next_step).toBeUndefined();
      expect(body.result?._meta?.lucy?.next_step_skipped_reason).toBeUndefined();
      expect(text).not.toContain("\"next_step\"");
    } finally {
      await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
      await new Promise<void>((resolve, reject) => upstream.close((err) => (err ? reject(err) : resolve())));
    }
  });
});
