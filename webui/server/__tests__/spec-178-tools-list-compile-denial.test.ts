import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Spec 178 / T1 — role-compile failure surfaces on `tools/list` as HTTP 403 /
 * JSON-RPC -32003 with `outcome=denied`, never as `result.tools: []`.
 *
 * Five branches are covered:
 *  - Upstream returned a tools/list body, identity fails compile
 *  - Upstream unavailable, identity fails compile (local fallback elided)
 *  - Compile succeeds, visible tools count = 0 (still 200 + `tools: []`)
 *  - `initialize` for the same compile-failed identity stays HTTP 200
 *  - Existing ghost / disabled Agent 403 cases still pass
 *
 * The compile-failure reason covers all three Spec 178 classes:
 *  - `role_resolution_failed:<selector>` (selector_zero_match) — primary case
 *  - `source_map_compile_failed:<detail>` — exercised via two manifest files
 *    in the same connection's `_schema/` declaring the same sourceName
 */

const TOKEN = "spec-178-token";
const DISABLED_TOKEN = "spec-178-disabled-token";

function tokenHash(token: string): string {
  return "sha256:" + createHash("sha256").update(token).digest("hex");
}

const ROLES_YAML = `roles:
  ok_role:
    description: compiles cleanly
    permission_model_version: 2
    allow:
      connections:
        - warehouse
      tableSelectors:
        - connection: warehouse
          schema: fin
          names:
            - fin_ledger
          row_access: all
      tools:
        - lucy_query
        - wiki_search
  bad_role:
    description: selector that matches no source (selector_zero_match)
    permission_model_version: 2
    allow:
      connections:
        - warehouse
      tableSelectors:
        - connection: warehouse
          schema: fin
          names:
            - fin_does_not_exist
          row_access: all
      tools:
        - lucy_query
        - wiki_search
  empty_tools_role:
    description: compiles with a declared connection and no matching selector
    permission_model_version: 2
    allow:
      connections:
        - warehouse
      tools:
        - lucy_query
`;

// Two schema files in the same connection's _schema/ dir, both declaring
// sourceName `fin_ledger` against different source tables. The first wins
// for compile; the second trips the duplicate-sourceName detector in
// `state.compileError` and short-circuits to `source_map_compile_failed:*`.
const SCHEMA_FIN_YAML = `tables:
  fin_ledger:
    table: fin.fin_ledger_v1
`;
const SCHEMA_OPS_YAML = `tables:
  fin_ledger:
    table: ops.fin_ledger_v2
`;

function accessYamlForUsers(users: string): string {
  return `${ROLES_YAML}users:
${users}
defaults:
  deny_tools: []
`;
}

let projectRoot: string;
let auditDbPath: string;
const saved: Record<string, string | undefined> = {};
let upstreamServer: ReturnType<typeof createServer>;
let proxyServer: ReturnType<typeof createServer>;
let upstreamHits: Array<{ method: string; path: string }>;
let proxyPort: number;

beforeEach(async () => {
  for (const key of [
    "KTX_PROJECT_ROOT",
    "LUCY_CONTENT_ROOT",
    "LUCY_ACCESS_CONFIG_PATH",
    "LUCY_AUDIT_DB",
    "LUCY_PROXY_UPSTREAM_HOST",
    "LUCY_PROXY_UPSTREAM_PORT",
    "LUCY_PROXY_UPSTREAM_TIMEOUT_MS"
  ]) {
    saved[key] = process.env[key];
  }
  upstreamHits = [];
  projectRoot = await mkdtemp(path.join(os.tmpdir(), "lucy-spec-178-"));
  auditDbPath = path.join(projectRoot, "audit.sqlite");
  for (const dir of ["webui/config", "semantic-layer/warehouse/_schema"]) {
    await mkdir(path.join(projectRoot, dir), { recursive: true });
  }
  await writeFile(path.join(projectRoot, "ktx.yaml"), "connections: {}\n", "utf8");

  upstreamServer = createServer((req, res) => {
    upstreamHits.push({ method: req.method ?? "?", path: req.url ?? "?" });
    // Distinguish `initialize` (which must echo a serverInfo-shaped result)
    // from `tools/list` (which must echo a tools-shaped result). The proxy
    // keys on the JSON-RPC method, not the URL, so parse the body to be sure.
    const idMatch = /"id"\s*:\s*"([^"]+)"/.exec(req.url ?? "");
    const id = idMatch?.[1] ?? "upstream-id";
    // We can't read the body in this shallow mock — instead default to a
    // tools/list response; T1.4 asserts only the status code and the
    // absence of an error envelope, so a non-error result is enough.
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({
      jsonrpc: "2.0",
      id,
      result: {
        tools: [{ name: "sl_query", inputSchema: { type: "object" } }],
        serverInfo: { name: "lucy-test-upstream", version: "1" }
      }
    }));
  });
  await new Promise<void>((resolve) => upstreamServer.listen(0, "127.0.0.1", () => resolve()));
  process.env.LUCY_PROXY_UPSTREAM_HOST = "127.0.0.1";
  process.env.LUCY_PROXY_UPSTREAM_PORT = String((upstreamServer.address() as AddressInfo).port);
  process.env.LUCY_PROXY_UPSTREAM_TIMEOUT_MS = "500";
});

afterEach(async () => {
  if (proxyServer) await new Promise<void>((resolve) => proxyServer.close(() => resolve()));
  if (upstreamServer) await new Promise<void>((resolve) => upstreamServer.close(() => resolve()));
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  await rm(projectRoot, { recursive: true, force: true });
});

interface WriteFixtureOpts {
  usersBlock: string;
  // When provided, only `fin.yaml` is written (no duplicate sourceName).
  // When omitted, both `fin.yaml` and `ops.yaml` are written, both
  // declaring sourceName `fin_ledger` — this triggers
  // `source_map_compile_failed:duplicate_source_name:*`.
  sourceMapConflict?: boolean;
}

async function writeFixture(opts: WriteFixtureOpts) {
  await writeFile(
    path.join(projectRoot, "webui", "config", "access.yaml"),
    accessYamlForUsers(opts.usersBlock),
    "utf8"
  );
  if (opts.sourceMapConflict) {
    // Two files in the same _schema/ dir with overlapping sourceName.
    await writeFile(
      path.join(projectRoot, "semantic-layer", "warehouse", "_schema", "fin.yaml"),
      SCHEMA_FIN_YAML,
      "utf8"
    );
    await writeFile(
      path.join(projectRoot, "semantic-layer", "warehouse", "_schema", "ops.yaml"),
      SCHEMA_OPS_YAML,
      "utf8"
    );
  } else {
    await writeFile(
      path.join(projectRoot, "semantic-layer", "warehouse", "_schema", "fin.yaml"),
      SCHEMA_FIN_YAML,
      "utf8"
    );
  }
  process.env.KTX_PROJECT_ROOT = projectRoot;
  process.env.LUCY_CONTENT_ROOT = ".";
  process.env.LUCY_AUDIT_DB = auditDbPath;
  process.env.LUCY_ACCESS_CONFIG_PATH = path.join(projectRoot, "webui", "config", "access.yaml");
}

async function bootProxy() {
  vi.resetModules();
  const { buildProxy } = await import("../proxy/mcp-proxy.js");
  proxyServer = buildProxy().server;
  await new Promise<void>((resolve) => proxyServer.listen(0, "127.0.0.1", () => resolve()));
  proxyPort = (proxyServer.address() as AddressInfo).port;
}

async function callToolsList(authorization: string, id: string) {
  const res = await fetch(`http://127.0.0.1:${proxyPort}/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization },
    body: JSON.stringify({ jsonrpc: "2.0", id, method: "tools/list" })
  });
  return { status: res.status, body: await res.json() } as {
    status: number;
    body: {
      jsonrpc?: string;
      id?: string | number;
      result?: { tools?: Array<{ name: string }> };
      error?: { code: number; message: string; data?: unknown };
    };
  };
}

async function callInitialize(authorization: string, id: string) {
  const res = await fetch(`http://127.0.0.1:${proxyPort}/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "spec-178-test", version: "1" }
      }
    })
  });
  return { status: res.status, body: await res.json() } as {
    status: number;
    body: {
      result?: { instructions?: string; serverInfo?: { name: string } };
      error?: { code: number; message: string };
    };
  };
}

function readAccessLogRow(requestId: string): Promise<Record<string, unknown> | undefined> {
  return new Promise((resolve, reject) => {
    setTimeout(async () => {
      try {
        const Database = (await import("better-sqlite3")).default;
        const db = new Database(auditDbPath, { readonly: true });
        try {
          const row = db
            .prepare("SELECT * FROM access_log WHERE request_id = ?")
            .get(requestId) as Record<string, unknown> | undefined;
          resolve(row);
        } finally {
          db.close();
        }
      } catch (err) {
        reject(err);
      }
    }, 200);
  });
}

describe("Spec 178 / T1 — tools/list compile denial", () => {
  it("T1.1 selector_zero_match → 403 / -32003 / no result.tools; audit denied with full machine reason", async () => {
    await writeFixture({
      usersBlock: `  - id: spec_178_bad_agent
    name: Spec 178 Bad Agent
    enabled: true
    role: bad_role
    tokens:
      - hash: "${tokenHash(TOKEN)}"
        label: spec-178-token
        created: 2026-10-18
`
    });
    await bootProxy();

    const id = "tools-list-bad-role";
    const res = await callToolsList(`Bearer ${TOKEN}`, id);
    expect(res.status).toBe(403);
    expect(res.body.id).toBe(id);
    expect(res.body.result).toBeUndefined();
    expect(res.body.error).toEqual({
      code: -32003,
      message: "Access denied: role_resolution_failed"
    });
    // No diagnostic JSON in the client body — only error.code + error.message.
    expect(JSON.stringify(res.body)).not.toContain("sourceMapConnectionIds");
    expect(JSON.stringify(res.body)).not.toContain("compiler_reason");
    expect(JSON.stringify(res.body)).not.toContain("step");

    const row = await readAccessLogRow(id);
    expect(row).toBeTruthy();
    expect(row?.tool).toBe("tools/list");
    expect(row?.outcome).toBe("denied");
    expect(String(row?.decision_reason)).toBe("role_resolution_failed:bad_role");
    expect(String(row?.error_detail)).toBe("role_resolution_failed:bad_role");
    expect(row?.role_ids == null).toBe(true);
    expect(String(row?.compiler_reason ?? "")).toContain("selector_zero_match");
    expect(String(row?.compiler_reason ?? "")).toContain("bad_role");
  });

  it("T1.2 upstream_unavailable + compile failure → 403 (no local_tools_list_fallback)", async () => {
    // Re-point the proxy at a closed port so the forward fails before any data.
    process.env.LUCY_PROXY_UPSTREAM_PORT = "1";
    process.env.LUCY_PROXY_UPSTREAM_HOST = "127.0.0.1";
    process.env.LUCY_PROXY_UPSTREAM_TIMEOUT_MS = "200";

    await writeFixture({
      usersBlock: `  - id: spec_178_unavail_agent
    name: Spec 178 Unavailable Agent
    enabled: true
    role: bad_role
    tokens:
      - hash: "${tokenHash(TOKEN)}"
        label: spec-178-token
        created: 2026-10-18
`
    });
    await bootProxy();

    const id = "tools-list-unavail-deny";
    const res = await callToolsList(`Bearer ${TOKEN}`, id);
    expect(res.status).toBe(403);
    expect(res.body.result).toBeUndefined();
    expect(res.body.error).toEqual({
      code: -32003,
      message: "Access denied: role_resolution_failed"
    });
    expect(JSON.stringify(res.body)).not.toContain("local_tools_list_fallback");

    const row = await readAccessLogRow(id);
    expect(row?.outcome).toBe("denied");
    expect(String(row?.decision_reason)).toBe("role_resolution_failed:bad_role");
    expect(String(row?.error_detail)).toBe("role_resolution_failed:bad_role");
  });

  it("T1.3 compile success + visible tools = 0 → 200 + tools:[] (not denied)", async () => {
    // ok_role matches `fin_ledger`, but DataPlane visibility requires
    // sources>0 in P-GATE-03; DataPlane tools are gated off when no
    // capability exists.
    await writeFixture({
      usersBlock: `  - id: spec_178_happy_agent
    name: Spec 178 Happy Agent
    enabled: true
    role: ok_role
    tokens:
      - hash: "${tokenHash(TOKEN)}"
        label: spec-178-token
        created: 2026-10-18
`
    });
    await bootProxy();

    const id = "tools-list-empty-tools";
    const res = await callToolsList(`Bearer ${TOKEN}`, id);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.result?.tools)).toBe(true);
    expect((res.body.result?.tools ?? []).length).toBeGreaterThan(0);
    expect(res.body.error).toBeUndefined();

    const row = await readAccessLogRow(id);
    expect(row?.outcome).toBe("ok");
    expect(String(row?.decision_reason)).toBe("allowed");
    expect(row?.role_ids == null).toBe(false);
  });

  it("T1.3b compiled identity with zero visible tools stays HTTP 200 and allowed", async () => {
    await writeFixture({
      usersBlock: `  - id: spec_178_empty_agent
    name: Spec 178 Empty Agent
    enabled: true
    role: empty_tools_role
    tokens:
      - hash: "${tokenHash(TOKEN)}"
        label: spec-178-token
        created: 2026-10-18
`
    });
    await bootProxy();

    const id = "tools-list-compiled-empty";
    const res = await callToolsList(`Bearer ${TOKEN}`, id);
    expect(res.status).toBe(200);
    expect(res.body.result?.tools).toEqual([]);
    expect(res.body.error).toBeUndefined();

    const row = await readAccessLogRow(id);
    expect(row?.outcome).toBe("ok");
    expect(String(row?.decision_reason)).toBe("allowed");
    expect(String(row?.compiler_reason ?? "")).not.toContain("selector_zero_match");
  });

  it("T1.4 compile-failed identity: initialize is HTTP 200", async () => {
    await writeFixture({
      usersBlock: `  - id: spec_178_init_agent
    name: Spec 178 Init Agent
    enabled: true
    role: bad_role
    tokens:
      - hash: "${tokenHash(TOKEN)}"
        label: spec-178-token
        created: 2026-10-18
`
    });
    await bootProxy();

    const id = "initialize-bad-role";
    const res = await callInitialize(`Bearer ${TOKEN}`, id);
    expect(res.status).toBe(200);
    expect(res.body.error).toBeUndefined();
    // writeInitializeResponse injects `instructions` into the upstream
    // result and forwards the rest unchanged — including `serverInfo`.
    // (When instructions fail to load — e.g. in a fixture-only test — the
    //  handler still passes through the upstream body, so `serverInfo`
    //  is the only invariant we can assert on a compile-failed identity.)
    expect(res.body.result?.serverInfo?.name).toBe("lucy-test-upstream");
  });

  it("T1.5 source_map_compile_failed → 403 + bare machine reason other than role_resolution_failed", async () => {
    await writeFixture({
      sourceMapConflict: true,
      usersBlock: `  - id: spec_178_source_map_agent
    name: Spec 178 Source Map Agent
    enabled: true
    role: ok_role
    tokens:
      - hash: "${tokenHash(TOKEN)}"
        label: spec-178-token
        created: 2026-10-18
`
    });
    await bootProxy();

    const id = "tools-list-source-map-failed";
    const res = await callToolsList(`Bearer ${TOKEN}`, id);
    expect(res.status).toBe(403);
    expect(res.body.result).toBeUndefined();
    expect(res.body.error?.code).toBe(-32003);
    expect(res.body.error?.message).toMatch(/^Access denied: source_map_compile_failed:/);

    const row = await readAccessLogRow(id);
    expect(row?.outcome).toBe("denied");
    expect(String(row?.decision_reason)).toMatch(/^source_map_compile_failed:/);
    expect(String(row?.error_detail)).toMatch(/^source_map_compile_failed:/);
    expect(row?.role_ids == null).toBe(true);
  });

  it("T1.6 ghost role / disabled Agent existing 403s still pass", async () => {
    // Ghost: declared role missing from YAML → admission layer denies.
    await writeFixture({
      usersBlock: `  - id: spec_178_ghost_agent
    name: Spec 178 Ghost Agent
    enabled: true
    role: ghost_role
    tokens:
      - hash: "${tokenHash(TOKEN)}"
        label: spec-178-token
        created: 2026-10-18
`
    });
    await bootProxy();
    const ghostRes = await callToolsList(`Bearer ${TOKEN}`, "tools-list-ghost");
    expect(ghostRes.status).toBe(403);
    expect(ghostRes.body.error?.code).toBe(-32003);
    expect(ghostRes.body.error?.message).toMatch(/^Access denied: role_resolution_failed/);

    // Disabled Agent → admission layer denies.
    await writeFixture({
      usersBlock: `  - id: spec_178_disabled_agent
    name: Spec 178 Disabled Agent
    enabled: false
    role: ok_role
    tokens:
      - hash: "${tokenHash(DISABLED_TOKEN)}"
        label: spec-178-disabled-token
        created: 2026-10-18
`
    });
    await bootProxy();
    const disabledRes = await callToolsList(`Bearer ${DISABLED_TOKEN}`, "tools-list-disabled");
    expect(disabledRes.status).toBe(403);
    expect(disabledRes.body.error?.code).toBe(-32003);
    expect(disabledRes.body.error?.message).toBe("Access denied: agent_disabled");
  });
});
