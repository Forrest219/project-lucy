import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Forced row-policy carrier regression:
 * - BY-01: Proxy injects forced_filters + prepends forced exprs into filters[];
 *   mock-KTX AND → returned rows ⊆ forced domain (Lucy-owned carrier for bundled KTX 0.16.0).
 * - BY-18: lucy_explain_query is local (E1–E5); no upstream tools/call.
 *
 * P1-72: runtime enforcement is automatic. Real KTX rowsets remain separate Docker evidence.
 * Do not require kaelio/ktx publish.
 */

const TOKEN = "proxy-row-policy-token";
const INTERNAL_TOKEN = "internal-row-policy-token";

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

const ACCESS_YAML = `roles:
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
        - lucy_explain_query
users:
  - id: scoped_agent
    enabled: true
    role: scoped_east
    tokens:
      - hash: "${tokenHash(TOKEN)}"
        label: scoped-token
        created: 2026-08-09
defaults:
  deny_tools: []
`;

const FIN_SCHEMA_YAML = `tables:
  fin_ledger:
    table: fin.fin_ledger
    columns:
      - name: region
      - name: amount
`;

const FIN_LEDGER_OVERLAY_YAML = `columns:
  - name: region
  - name: amount
measures:
  - name: total_sales
`;

type FixtureRow = { region: string; amount: number };

const FIXTURE_ROWS: FixtureRow[] = [
  { region: "East", amount: 10 },
  { region: "West", amount: 20 },
  { region: "East", amount: 30 }
];

/** Stock KTX 0.16.0 AND-applies filters[]; unknown forced_filters is ignored for rowset. */
function rowsMatchingStockKtxFilters(filters: string[]): FixtureRow[] {
  const joined = filters.join(" AND ");
  if (joined.includes("fin_ledger.region") && joined.includes("'East'")) {
    return FIXTURE_ROWS.filter((row) => row.region === "East");
  }
  if (joined.includes("fin_ledger.region") && joined.includes("'West'")) {
    return FIXTURE_ROWS.filter((row) => row.region === "West");
  }
  return [...FIXTURE_ROWS];
}

let projectRoot: string;
let previousRoot: string | undefined;
  let previousContentRoot: string | undefined;
let previousAuditDb: string | undefined;
let previousInternalToken: string | undefined;
let previousUpstreamHost: string | undefined;
let previousUpstreamPort: string | undefined;
let previousProven: string | undefined;

beforeEach(async () => {
  vi.resetModules();
  previousRoot = process.env.KTX_PROJECT_ROOT;
  previousContentRoot = process.env.LUCY_CONTENT_ROOT;
  previousAuditDb = process.env.LUCY_AUDIT_DB;
  previousInternalToken = process.env.KTX_INTERNAL_TOKEN;
  previousUpstreamHost = process.env.LUCY_PROXY_UPSTREAM_HOST;
  previousUpstreamPort = process.env.LUCY_PROXY_UPSTREAM_PORT;
  previousProven = process.env.LUCY_UPSTREAM_FORCED_PREDICATE_PROVEN;
  delete process.env.LUCY_UPSTREAM_FORCED_PREDICATE_PROVEN;

  projectRoot = await mkdtemp(path.join(os.tmpdir(), "ktx-mcp-row-policy-"));
  await mkdir(path.join(projectRoot, "webui", "config"), { recursive: true });
  await mkdir(path.join(projectRoot, "semantic-layer", "warehouse", "_schema"), { recursive: true });
  // Spec 182 — selector matches intersect with the connection's enabled_tables.
  await writeFile(
    path.join(projectRoot, "ktx.yaml"),
    `connections:
  warehouse:
    driver: mysql
    enabled_tables:
      - fin.fin_ledger
      - fin.fin_budget
`,
    "utf8"
  );
  await writeFile(path.join(projectRoot, "webui", "config", "access.yaml"), ACCESS_YAML, "utf8");
  await writeFile(path.join(projectRoot, "semantic-layer", "warehouse", "_schema", "fin.yaml"), FIN_SCHEMA_YAML, "utf8");
  await writeFile(path.join(projectRoot, "semantic-layer", "warehouse", "fin_ledger.yaml"), FIN_LEDGER_OVERLAY_YAML, "utf8");
  process.env.KTX_PROJECT_ROOT = projectRoot;
  process.env.LUCY_CONTENT_ROOT = ".";
  process.env.LUCY_AUDIT_DB = path.join(projectRoot, "audit.sqlite");
  process.env.KTX_INTERNAL_TOKEN = INTERNAL_TOKEN;
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

describe("BY-01 mock-KTX row ⊆ forced domain", () => {
  it.each([undefined, "false", "true", "1", "invalid"])("enforces the row domain with legacy flag %s", async (flag) => {
    if (flag === undefined) delete process.env.LUCY_UPSTREAM_FORCED_PREDICATE_PROVEN;
    else process.env.LUCY_UPSTREAM_FORCED_PREDICATE_PROVEN = flag;
    const upstreamSeen: Array<Record<string, unknown>> = [];

    const upstream = createServer(async (req, res) => {
      const body = await readRequestBody(req);
      const parsed = JSON.parse(body) as {
        id?: unknown;
        method?: string;
        params?: { name?: string; arguments?: Record<string, unknown> };
      };
      upstreamSeen.push(parsed);
      const args = parsed.params?.arguments ?? {};
      // Stock KTX 0.16.0: rowset follows filters[] AND only (forced_filters dropped at schema).
      const filters = Array.isArray(args.filters) ? args.filters.map(String) : [];
      const rows = rowsMatchingStockKtxFilters(filters);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({
        jsonrpc: "2.0",
        id: parsed.id,
        result: {
          content: [{ type: "text", text: JSON.stringify({ rows }, null, 2) }]
        }
      }));
    });

    await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve));
    const upstreamPort = (upstream.address() as AddressInfo).port;
    process.env.LUCY_PROXY_UPSTREAM_HOST = "127.0.0.1";
    process.env.LUCY_PROXY_UPSTREAM_PORT = String(upstreamPort);

    const { buildProxy } = await import("../proxy/mcp-proxy");
    const { resetEffectivePolicyForTests } = await import("../proxy/acl");
    const { resetRowPolicyCatalogCacheForTests } = await import("../proxy/row-policy");
    resetRowPolicyCatalogCacheForTests();
    resetEffectivePolicyForTests();
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
          id: "by01-rowset",
          method: "tools/call",
          params: {
            name: "lucy_query",
            arguments: {
              connectionId: "warehouse",
              measures: ["fin_ledger.total_sales"],
              // Forged carrier must be stripped / overwritten by Proxy.
              forced_filters: {
                or: [{ and: [{ field: "fin_ledger.region", op: "eq", value: "West" }] }]
              }
            }
          }
        })
      });
      expect(res.status).toBe(200);
      const rpc = await res.json() as {
        result?: { isError?: boolean; content?: Array<{ text?: string }> };
      };
      expect(rpc.result?.isError).not.toBe(true);

      expect(upstreamSeen).toHaveLength(1);
      expect(upstreamSeen[0]?.params).toMatchObject({ name: "sl_query" });
      const upstreamArgs = (upstreamSeen[0]?.params as { arguments?: Record<string, unknown> })?.arguments;
      // Audit / forward-compat only — must not be what the mock uses for rowset.
      expect(upstreamArgs?.forced_filters).toEqual({
        or: [{
          and: [{ field: "fin_ledger.region", op: "eq", value: "East", values: undefined }]
        }]
      });
      expect(upstreamArgs?.forcedFilters).toBeUndefined();
      // Lucy carrier for bundled KTX 0.16: stock AND path is filters[].
      expect(upstreamArgs?.filters).toEqual(
        expect.arrayContaining(["(fin_ledger.region = 'East')"])
      );

      const payloadText = rpc.result?.content?.[0]?.text ?? "{}";
      const payload = JSON.parse(payloadText) as { rows: FixtureRow[] };
      expect(payload.rows.length).toBeGreaterThan(0);
      expect(payload.rows.every((row) => row.region === "East")).toBe(true);
      expect(payload.rows.some((row) => row.region === "West")).toBe(false);
      // Fixture contains West; filters[]-only mock AND must exclude it.
      expect(FIXTURE_ROWS.some((row) => row.region === "West")).toBe(true);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
      await new Promise<void>((resolve, reject) => upstream.close((err) => (err ? reject(err) : resolve())));
    }
  });

  it("rejects unsafe filters before any upstream forward without an env gate", async () => {
    const upstreamSeen: string[] = [];
    const upstream = createServer(async (req, res) => {
      upstreamSeen.push(await readRequestBody(req));
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ jsonrpc: "2.0", id: "by01-unproven", result: {} }));
    });
    await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve));
    process.env.LUCY_PROXY_UPSTREAM_HOST = "127.0.0.1";
    process.env.LUCY_PROXY_UPSTREAM_PORT = String((upstream.address() as AddressInfo).port);

    const { buildProxy } = await import("../proxy/mcp-proxy");
    const { resetEffectivePolicyForTests } = await import("../proxy/acl");
    const { resetRowPolicyCatalogCacheForTests } = await import("../proxy/row-policy");
    resetRowPolicyCatalogCacheForTests();
    resetEffectivePolicyForTests();
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
          id: "by01-unproven",
          method: "tools/call",
          params: {
            name: "lucy_query",
            arguments: {
              connectionId: "warehouse",
              measures: ["fin_ledger.total_sales"],
              filters: ["region = 'West' OR 1=1"]
            }
          }
        })
      });
      const rpc = await res.json() as {
        result?: { isError?: boolean; content?: Array<{ text?: string }> };
      };
      expect(rpc.result?.isError).toBe(true);
      expect(rpc.result?.content?.[0]?.text).toMatch(/filters_string_forbidden_on_scoped/);
      expect(upstreamSeen).toHaveLength(0);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
      await new Promise<void>((resolve, reject) => upstream.close((err) => (err ? reject(err) : resolve())));
    }
  });
});

describe("BY-18 explain E1–E5", () => {
  it("returns local ForcedPredicateAST diagnostic with zero upstream and zero rows", async () => {
    const upstreamSeen: string[] = [];
    const upstream = createServer(async (req, res) => {
      upstreamSeen.push(await readRequestBody(req));
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ jsonrpc: "2.0", id: "by18", result: { leaked: true } }));
    });
    await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve));
    process.env.LUCY_PROXY_UPSTREAM_HOST = "127.0.0.1";
    process.env.LUCY_PROXY_UPSTREAM_PORT = String((upstream.address() as AddressInfo).port);

    const { buildProxy } = await import("../proxy/mcp-proxy");
    const { resetEffectivePolicyForTests } = await import("../proxy/acl");
    const { resetRowPolicyCatalogCacheForTests } = await import("../proxy/row-policy");
    resetRowPolicyCatalogCacheForTests();
    resetEffectivePolicyForTests();
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
          id: "by18",
          method: "tools/call",
          params: {
            name: "lucy_explain_query",
            arguments: {
              connectionId: "warehouse",
              measures: ["fin_ledger.total_sales"]
            }
          }
        })
      });
      expect(res.status).toBe(200);
      const rpc = await res.json() as {
        result?: { isError?: boolean; content?: Array<{ text?: string }> };
      };
      expect(rpc.result?.isError).not.toBe(true);
      expect(upstreamSeen).toHaveLength(0);

      const diagnostic = JSON.parse(rpc.result?.content?.[0]?.text ?? "{}") as Record<string, unknown>;
      // E5 / E1 / E2
      expect(diagnostic.semantics).toBe("permission_forced_predicate_diagnostic");
      expect(diagnostic.upstreamForwarded).toBe(false);
      expect(diagnostic.containsResultRows).toBe(false);
      expect(diagnostic.resultRows).toBeNull();
      expect(diagnostic.sampleRows).toBeNull();
      expect(diagnostic.aggregateResults).toBeNull();
      // E3
      expect(diagnostic.finalRowsNonTrue).toBe(true);
      const ast = diagnostic.forcedPredicateAst as {
        digests: string[];
        forcedFilters: { or: unknown[] };
      };
      expect(ast.digests.length).toBeGreaterThan(0);
      expect(ast.forcedFilters.or.length).toBeGreaterThan(0);
      // P1-72 — product enforcement, independent of deployment env
      const executionPath = diagnostic.executionPath as {
        wouldDeny: boolean;
        denyReason?: string;
        upstreamForcedPredicateProven: boolean;
      };
      expect(executionPath.upstreamForcedPredicateProven).toBe(true);
      expect(executionPath.wouldDeny).toBe(false);
      expect(executionPath.denyReason).toBeUndefined();
      expect(diagnostic).not.toHaveProperty("leaked");
    } finally {
      await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
      await new Promise<void>((resolve, reject) => upstream.close((err) => (err ? reject(err) : resolve())));
    }
  });
});

// Internal consumers must use the same on-wire carrier as public MCP requests.
describe("P1-72 internal authorized queries", () => {
  it.each([undefined, "false"])("filters before aggregation with legacy flag %s", async flag => {
    if (flag === undefined) delete process.env.LUCY_UPSTREAM_FORCED_PREDICATE_PROVEN;
    else process.env.LUCY_UPSTREAM_FORCED_PREDICATE_PROVEN = flag;
    const calls: Array<{ name: string; arguments: Record<string, unknown> }> = [];
    const upstream = createServer(async (req, res) => {
      const rpc = JSON.parse(await readRequestBody(req));
      if (rpc.method === "initialize") {
        res.writeHead(200, { "content-type": "application/json", "mcp-session-id": "internal-row-session" });
        res.end(JSON.stringify({ jsonrpc: "2.0", id: rpc.id, result: { capabilities: {} } }));
      } else if (rpc.method === "notifications/initialized") {
        res.writeHead(202); res.end();
      } else {
        calls.push(rpc.params);
        const args = rpc.params.arguments;
        const rows = rowsMatchingStockKtxFilters(args.filters);
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ jsonrpc: "2.0", id: rpc.id, result: { content: [{ type: "text", text: JSON.stringify({ rows }) }] } }));
      }
    });
    await new Promise<void>(resolve => upstream.listen(0, "127.0.0.1", resolve));
    process.env.LUCY_PROXY_UPSTREAM_HOST = "127.0.0.1";
    process.env.LUCY_PROXY_UPSTREAM_PORT = String((upstream.address() as AddressInfo).port);
    try {
      const { forwardAuthorizedLucyQuery } = await import("../proxy/mcp-proxy");
      const outcome = await forwardAuthorizedLucyQuery({ userId: "scoped_agent", tokenLabel: "scoped-token", tokenHashPrefix: "test" }, {
        connectionId: "warehouse", measures: ["fin_ledger.total_sales"],
        forcedFilters: { forged: true },
        forced_filters: { or: [{ and: [{ field: "fin_ledger.region", op: "eq", value: "West" }] }] },
        filters: [{ field: "fin_ledger.amount", op: "gt", value: 0 }]
      });
      expect(outcome.ok).toBe(true);
      if (!outcome.ok) throw new Error(outcome.reason);
      expect(calls).toHaveLength(1);
      expect(calls[0]?.name).toBe("sl_query");
      expect(calls[0]?.arguments.forcedFilters).toBeUndefined();
      expect(calls[0]?.arguments.filters).toEqual(["(fin_ledger.region = 'East')", "fin_ledger.amount > 0"]);
      const rpc = outcome.payload as { result: { content: Array<{ text: string }> } };
      expect(JSON.parse(rpc.result.content[0]!.text).rows).toEqual(FIXTURE_ROWS.filter(row => row.region === "East"));
    } finally {
      await new Promise<void>((resolve, reject) => upstream.close(err => err ? reject(err) : resolve()));
    }
  });

  it("does not forward an invalid mandatory carrier", async () => {
    const acl = await import("../proxy/acl");
    vi.spyOn(acl, "authorizeAndRewrite").mockResolvedValue({ allowed: true, forcedFilters: { or: [] } });
    try {
      const { forwardAuthorizedLucyQuery } = await import("../proxy/mcp-proxy");
      const outcome = await forwardAuthorizedLucyQuery({ userId: "scoped_agent", tokenLabel: "test", tokenHashPrefix: "test" }, {
        connectionId: "warehouse", measures: ["fin_ledger.total_sales"]
      });
      expect(outcome).toEqual({ ok: false, reason: "row_policy_forced_filters_invalid" });
    } finally { vi.restoreAllMocks(); }
  });
});
