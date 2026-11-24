/**
 * P0-A SC-04 / SC-06 — loopback upstream-execution evidence.
 *
 * Spec: lucy_query naming an unexposed column → field_not_exposed with
 * upstream execution count = 0 (before any upstream hop). Also covers
 * tables:["*"] agents and lucy_explain_query local deny (SC-06).
 * No scoped row policy is required on the fixture Source.
 */
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const TABLE_TOKEN = "fe-sc04-table-token";
const STAR_TOKEN = "fe-sc04-star-token";
const CONNECTION = "demo";
const SRC = {
  connectionId: CONNECTION,
  schema: "dataforai",
  sourceName: "orders"
};

function tokenHash(token: string): string {
  return "sha256:" + createHash("sha256").update(token).digest("hex");
}

const ACCESS_YAML = `users:
  - id: table_agent
    name: Table Agent
    enabled: true
    tokens:
      - hash: "${tokenHash(TABLE_TOKEN)}"
        label: table-token
        created: 2026-11-13
    allow:
      tables:
        - dataforai.orders
      tools:
        - lucy_query
        - lucy_explain_query
  - id: star_agent
    name: Star Agent
    enabled: true
    tokens:
      - hash: "${tokenHash(STAR_TOKEN)}"
        label: star-token
        created: 2026-11-13
    allow:
      tables:
        - "*"
      tools:
        - lucy_query
        - lucy_explain_query
defaults:
  deny_tools: []
`;

const SCHEMA_YAML = `tables:
  orders:
    table: dataforai.orders
    columns:
      - name: dt
      - name: amt
      - name: secret
`;

const OVERLAY_YAML = `columns:
  - name: dt
  - name: amt
  - name: secret
measures:
  - name: revenue
    expr: sum(amt)
`;

const UNEXPOSED_QUERY = {
  connectionId: CONNECTION,
  dimensions: [{ field: "orders.secret" }]
};

let projectRoot: string;
let previousRoot: string | undefined;
let previousContentRoot: string | undefined;
let previousUpstreamHost: string | undefined;
let previousUpstreamPort: string | undefined;
let previousBudget: string | undefined;
let previousAuditDb: string | undefined;

beforeEach(async () => {
  vi.resetModules();
  projectRoot = await mkdtemp(path.join(os.tmpdir(), "fe-sc04-sc06-"));
  await writeFile(path.join(projectRoot, "ktx.yaml"), "connections: {}\n", "utf8");
  await mkdir(path.join(projectRoot, "webui", "config"), { recursive: true });
  await writeFile(path.join(projectRoot, "webui", "config", "access.yaml"), ACCESS_YAML, "utf8");
  const schemaDir = path.join(projectRoot, "semantic-layer", CONNECTION, "_schema");
  await mkdir(schemaDir, { recursive: true });
  await writeFile(path.join(schemaDir, "dataforai.yaml"), SCHEMA_YAML, "utf8");
  await writeFile(
    path.join(projectRoot, "semantic-layer", CONNECTION, "orders.yaml"),
    OVERLAY_YAML,
    "utf8"
  );

  previousRoot = process.env.KTX_PROJECT_ROOT;
  previousContentRoot = process.env.LUCY_CONTENT_ROOT;
  previousUpstreamHost = process.env.LUCY_PROXY_UPSTREAM_HOST;
  previousUpstreamPort = process.env.LUCY_PROXY_UPSTREAM_PORT;
  previousBudget = process.env.LUCY_QUESTION_BUDGET;
  previousAuditDb = process.env.LUCY_AUDIT_DB;
  process.env.KTX_PROJECT_ROOT = projectRoot;
  process.env.LUCY_CONTENT_ROOT = ".";
  process.env.LUCY_QUESTION_BUDGET = "off";
  process.env.LUCY_AUDIT_DB = path.join(projectRoot, "audit.sqlite");
});

afterEach(async () => {
  if (previousRoot === undefined) delete process.env.KTX_PROJECT_ROOT;
  else process.env.KTX_PROJECT_ROOT = previousRoot;
  if (previousContentRoot === undefined) delete process.env.LUCY_CONTENT_ROOT;
  else process.env.LUCY_CONTENT_ROOT = previousContentRoot;
  if (previousUpstreamHost === undefined) delete process.env.LUCY_PROXY_UPSTREAM_HOST;
  else process.env.LUCY_PROXY_UPSTREAM_HOST = previousUpstreamHost;
  if (previousUpstreamPort === undefined) delete process.env.LUCY_PROXY_UPSTREAM_PORT;
  else process.env.LUCY_PROXY_UPSTREAM_PORT = previousUpstreamPort;
  if (previousBudget === undefined) delete process.env.LUCY_QUESTION_BUDGET;
  else process.env.LUCY_QUESTION_BUDGET = previousBudget;
  if (previousAuditDb === undefined) delete process.env.LUCY_AUDIT_DB;
  else process.env.LUCY_AUDIT_DB = previousAuditDb;
  const { resetFieldExposureRuntimeForTests } = await import("../proxy/field-exposure.js");
  resetFieldExposureRuntimeForTests();
  await rm(projectRoot, { recursive: true, force: true });
});

async function activateTrimmedServing(): Promise<void> {
  const fe = await import("../proxy/field-exposure.js");
  const { buildTestLedgerText } = await import("../proxy/field-exposure-publish.js");
  const text = buildTestLedgerText(SRC, ["secret"]);
  const key = fe.sourceKey(SRC.connectionId, SRC.schema, SRC.sourceName);
  const base = fe.bootstrapEmptyServingGeneration("gen-sc04");
  const parsed = fe.parseLedgerYaml(text, SRC);
  const snap: typeof base = {
    ...base,
    generationId: "gen-sc04",
    upstreamExecutionGenerationId: "gen-sc04",
    admissionMode: "OPEN",
    expectedSetLoad: {
      state: "ready",
      set: new Set([key]),
      digest: "d-sc04",
      generationId: "gen-sc04",
      expectedSetRequired: true
    },
    exposureLedgersBySource: new Map([[key, text]]),
    exposureDigestPerSource: new Map([[key, parsed.digest ?? "digest-sc04"]])
  };
  await fe.activateExecutionGenerationStratB(snap, { projectRoot });
}

async function withProxy(
  run: (port: number, upstreamHits: () => number) => Promise<void>
): Promise<void> {
  let hits = 0;
  const upstream: Server = createServer((_req: IncomingMessage, res) => {
    hits += 1;
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        result: {
          content: [{ type: "text", text: JSON.stringify({ rows: [], totalRows: 0 }) }]
        }
      })
    );
  });
  await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", () => resolve()));
  process.env.LUCY_PROXY_UPSTREAM_HOST = "127.0.0.1";
  process.env.LUCY_PROXY_UPSTREAM_PORT = String((upstream.address() as AddressInfo).port);

  await activateTrimmedServing();

  const { buildProxy } = await import("../proxy/mcp-proxy.js");
  const { resetEffectivePolicyForTests } = await import("../proxy/acl.js");
  resetEffectivePolicyForTests();
  const { server, host } = buildProxy();
  await new Promise<void>((resolve) => server.listen(0, host, () => resolve()));
  const port = (server.address() as AddressInfo).port;
  try {
    await run(port, () => hits);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve()))
    );
    await new Promise<void>((resolve, reject) =>
      upstream.close((err) => (err ? reject(err) : resolve()))
    );
  }
}

async function callTool(
  port: number,
  token: string,
  name: string,
  args: unknown,
  id = "req-1"
) {
  const res = await fetch(`http://127.0.0.1:${port}/mcp`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id,
      method: "tools/call",
      params: { name, arguments: args }
    })
  });
  const body = (await res.json()) as {
    result?: {
      isError?: boolean;
      content?: Array<{ text?: string }>;
      data?: Record<string, unknown>;
    };
  };
  return {
    status: res.status,
    isError: body.result?.isError === true,
    text: body.result?.content?.[0]?.text ?? "",
    data: body.result?.data
  };
}

describe("P0-A field exposure loopback (SC-04 / SC-06)", () => {
  it("SC-04: lucy_query naming unexposed column → field_not_exposed; upstream execution = 0 (no scoped row policy)", async () => {
    await withProxy(async (port, upstreamHits) => {
      const before = upstreamHits();
      const denied = await callTool(port, TABLE_TOKEN, "lucy_query", UNEXPOSED_QUERY, "sc04-query");
      expect(denied.status).toBe(200);
      expect(denied.isError).toBe(true);
      expect(denied.text).toContain("field_not_exposed");
      expect(upstreamHits()).toBe(before);
      expect(upstreamHits()).toBe(0);
    });
  });

  it('SC-04: tables:["*"] agent lucy_query unexposed → field_not_exposed; upstream = 0', async () => {
    await withProxy(async (port, upstreamHits) => {
      const before = upstreamHits();
      const denied = await callTool(port, STAR_TOKEN, "lucy_query", UNEXPOSED_QUERY, "sc04-star");
      expect(denied.status).toBe(200);
      expect(denied.isError).toBe(true);
      expect(denied.text).toContain("field_not_exposed");
      expect(upstreamHits()).toBe(before);
      expect(upstreamHits()).toBe(0);
    });
  });

  it("SC-06: lucy_explain_query naming unexposed column is denied locally (no upstream)", async () => {
    await withProxy(async (port, upstreamHits) => {
      const before = upstreamHits();
      const denied = await callTool(
        port,
        TABLE_TOKEN,
        "lucy_explain_query",
        UNEXPOSED_QUERY,
        "sc06-explain"
      );
      expect(denied.status).toBe(200);
      expect(denied.isError).toBe(true);
      expect(denied.text).toContain("field_not_exposed");
      expect(upstreamHits()).toBe(before);
      expect(upstreamHits()).toBe(0);
    });
  });

  it('SC-06: tables:["*"] agent lucy_explain_query unexposed → field_not_exposed; upstream = 0', async () => {
    await withProxy(async (port, upstreamHits) => {
      const before = upstreamHits();
      const denied = await callTool(
        port,
        STAR_TOKEN,
        "lucy_explain_query",
        UNEXPOSED_QUERY,
        "sc06-star"
      );
      expect(denied.status).toBe(200);
      expect(denied.isError).toBe(true);
      expect(denied.text).toContain("field_not_exposed");
      expect(upstreamHits()).toBe(before);
      expect(upstreamHits()).toBe(0);
    });
  });
});
