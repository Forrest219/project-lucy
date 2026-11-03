/**
 * Spec 189 — the shared usage classification module.
 *
 * Covers the classification layer (SC-08…SC-13):
 *   - every protocol method, plus the `server/*` prefix rule
 *   - the handshake / probe boundary (transport sub-type must not drift)
 *   - the eval-probe rule (explicit `eval_mark` AND a probe name)
 *   - the admission coverage matrix: every admitted JSON-RPC method has
 *     exactly one usage classification, and the admission set is NOT the
 *     protocol set
 *   - TypeScript ↔ SQLite parity on one mixed fixture
 *   - >5000 window rows are aggregated in SQL, not truncated
 */
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { ALLOWED_RPC_METHODS } from "../proxy/admission.js";
import {
  MCP_HANDSHAKE_METHODS,
  MCP_PROBE_METHODS,
  MCP_PROTOCOL_METHODS,
  MCP_SERVER_METHOD_PREFIX,
  classifyUsage,
  defaultUsageConditionSql,
  defaultUsageExcluded,
  evalProbeConditionSql,
  hasProbeName,
  isEvalProbeCall,
  isMcpHandshakeMethod,
  isMcpProtocolMethod,
  protocolConditionSql,
  rawBusinessConditionSql
} from "../proxy/usage-classification.js";
import {
  ADMITTED_METHOD_CLASSIFICATION,
  PROTOCOL_METHODS,
  SERVER_PREFIXED_METHOD,
  buildFixtureRows
} from "./usage-mixed-fixture.js";

describe("Spec 189 §4.2 — protocol classification", () => {
  it("classifies every named protocol method as protocol", () => {
    for (const method of MCP_PROTOCOL_METHODS) {
      expect(isMcpProtocolMethod(method), `${method} must be protocol`).toBe(true);
      expect(classifyUsage({ tool: method })).toBe("protocol");
    }
  });

  it("treats any server/* method as a protocol event", () => {
    expect(isMcpProtocolMethod(SERVER_PREFIXED_METHOD)).toBe(true);
    expect(isMcpProtocolMethod("server/anything-new")).toBe(true);
    expect(isMcpProtocolMethod("server")).toBe(false);
    // The prefix rule is case-sensitive, mirroring TypeScript `startsWith`.
    expect(isMcpProtocolMethod("Server/unknown")).toBe(false);
  });

  it("keeps business content reads out of the protocol set", () => {
    for (const method of ["tools/call", "resources/read", "prompts/get", "lucy_query", "lucy_skill_read"]) {
      expect(isMcpProtocolMethod(method), `${method} must not be protocol`).toBe(false);
      expect(classifyUsage({ tool: method })).toBe("default_usage");
    }
  });

  it("separates the handshake set from the probe set", () => {
    for (const method of MCP_HANDSHAKE_METHODS) {
      expect(isMcpHandshakeMethod(method)).toBe(true);
    }
    for (const method of MCP_PROBE_METHODS) {
      expect(isMcpHandshakeMethod(method), `${method} must not be handshake`).toBe(false);
    }
    // The two sets are disjoint — an index-derived handshake set would break
    // here the moment the protocol list grew.
    expect(MCP_HANDSHAKE_METHODS.filter((m) => (MCP_PROBE_METHODS as readonly string[]).includes(m))).toEqual([]);
  });

  it("does not classify a missing tool as protocol", () => {
    expect(isMcpProtocolMethod(null)).toBe(false);
    expect(isMcpProtocolMethod(undefined)).toBe(false);
    expect(isMcpProtocolMethod("")).toBe(false);
  });
});

describe("Spec 189 §4.3 — eval probe rule", () => {
  it("requires an explicit eval_mark", () => {
    expect(isEvalProbeCall({ evalMark: false, args: { connection: "probe-demo" } })).toBe(false);
    expect(isEvalProbeCall({ evalMark: null, args: { connection: "probe-demo" } })).toBe(false);
    expect(isEvalProbeCall({ evalMark: true, args: { connection: "probe-demo" } })).toBe(true);
  });

  it("requires a probe-looking name", () => {
    expect(isEvalProbeCall({ evalMark: true, args: { connection: "mysql-aliyun" } })).toBe(false);
    expect(isEvalProbeCall({ evalMark: true, args: {} })).toBe(false);
    expect(isEvalProbeCall({ evalMark: true, args: null })).toBe(false);
  });

  it("only inspects connection-like argument keys", () => {
    expect(isEvalProbeCall({ evalMark: true, args: { prompt: "probe-demo" } })).toBe(false);
    expect(isEvalProbeCall({ evalMark: true, args: { source: "rds-test" } })).toBe(true);
    expect(isEvalProbeCall({ evalMark: true, args: { table: "demo-mysql" } })).toBe(true);
    expect(isEvalProbeCall({ evalMark: true, args: { schema: "probe-x" } })).toBe(true);
  });

  it("matches probe names case-insensitively", () => {
    expect(hasProbeName("PROBE-Demo")).toBe(true);
    expect(hasProbeName("demo-mysql")).toBe(true);
    expect(hasProbeName("mysql-aliyun")).toBe(false);
    expect(hasProbeName(null)).toBe(false);
  });

  it("keeps a name-only match in the default usage view", () => {
    expect(defaultUsageExcluded({ tool: "lucy_query", evalMark: false, args: { connection: "probe-demo" } })).toBe(false);
  });
});

describe("Spec 189 §4.2 — admission coverage matrix", () => {
  it("classifies every admitted JSON-RPC method exactly once", () => {
    const admitted = [...ALLOWED_RPC_METHODS].sort();
    const classified = ADMITTED_METHOD_CLASSIFICATION.map((m) => m.method).sort();
    expect(classified).toEqual(admitted);
  });

  it("maps each admitted method to its usage class", () => {
    for (const { method, classification } of ADMITTED_METHOD_CLASSIFICATION) {
      const cls = classifyUsage({ tool: method });
      const expected = classification === "protocol" ? "protocol" : "default_usage";
      expect(cls, `${method} must classify as ${expected}`).toBe(expected);
    }
  });

  it("does NOT assert that the admission set equals the protocol set", () => {
    const admitted = new Set<string>(ALLOWED_RPC_METHODS);
    const protocol = new Set<string>(MCP_PROTOCOL_METHODS);
    // The two domains differ on purpose: three admitted methods are business.
    expect(admitted.size).not.toBe(protocol.size);
    for (const business of ["tools/call", "resources/read", "prompts/get"]) {
      expect(admitted.has(business)).toBe(true);
      expect(protocol.has(business)).toBe(false);
    }
  });

  it("covers every admitted method and keeps server/* outside the admission set", () => {
    for (const method of ALLOWED_RPC_METHODS) {
      expect(
        ADMITTED_METHOD_CLASSIFICATION.some((m) => m.method === method),
        `${method} must have a classification`
      ).toBe(true);
    }
    // Spec 189 §4.2: `server/*` is an audit-side supplemental rule — protocol
    // events may appear in access_log without being an admitted method.
    expect(ALLOWED_RPC_METHODS.has("server/discover")).toBe(false);
    expect(PROTOCOL_METHODS).toContain("server/discover");
  });
});

describe("Spec 189 §5.1 — TypeScript ↔ SQLite parity", () => {
  function classifyInSqlite(rows: Array<{ tool: string; eval_mark: number | null; args_summary: string | null }>) {
    const db = new Database(":memory:");
    try {
      db.exec("CREATE TABLE access_log (id INTEGER PRIMARY KEY, tool TEXT, eval_mark INTEGER, args_summary TEXT)");
      const insert = db.prepare("INSERT INTO access_log (tool, eval_mark, args_summary) VALUES (?, ?, ?)");
      for (const r of rows) insert.run(r.tool, r.eval_mark, r.args_summary);
      const usage = db
        .prepare(`SELECT COUNT(*) AS n FROM access_log WHERE ${defaultUsageConditionSql().sql}`)
        .get() as { n: number };
      const rawBusiness = db
        .prepare(`SELECT COUNT(*) AS n FROM access_log WHERE ${rawBusinessConditionSql().sql}`)
        .get() as { n: number };
      const protocol = db
        .prepare(`SELECT COUNT(*) AS n FROM access_log WHERE ${protocolConditionSql().sql}`)
        .get() as { n: number };
      const probes = db
        .prepare(`SELECT COUNT(*) AS n FROM access_log WHERE ${evalProbeConditionSql().sql}`)
        .get() as { n: number };
      return { usage: usage.n, rawBusiness: rawBusiness.n, protocol: protocol.n, probes: probes.n };
    } finally {
      db.close();
    }
  }

  function parseArgs(value: string | null): Record<string, unknown> | null {
    if (!value) return null;
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }

  it("produces identical counts on the mixed fixture", () => {
    const rows = buildFixtureRows();
    const sqlInput = rows.map((r) => ({
      tool: r.tool,
      eval_mark: r.eval_mark,
      args_summary: r.args_summary
    }));
    const sql = classifyInSqlite(sqlInput);

    let usage = 0;
    let rawBusiness = 0;
    let protocol = 0;
    let probes = 0;
    for (const r of rows) {
      const cls = classifyUsage({
        tool: r.tool,
        evalMark: r.eval_mark === 1,
        args: parseArgs(r.args_summary)
      });
      if (cls === "protocol") protocol += 1;
      else {
        rawBusiness += 1;
        if (cls === "eval_probe") probes += 1;
        else usage += 1;
      }
    }

    expect(sql.protocol).toBe(protocol);
    expect(sql.rawBusiness).toBe(rawBusiness);
    expect(sql.probes).toBe(probes);
    expect(sql.usage).toBe(usage);
    // The layer identity must hold on both sides.
    expect(sql.rawBusiness).toBe(sql.usage + sql.probes);
  });

  it("treats malformed or empty args_summary as 'not a probe' instead of failing", () => {
    const sql = classifyInSqlite([
      { tool: "lucy_query", eval_mark: 1, args_summary: "{not json" },
      { tool: "lucy_query", eval_mark: 1, args_summary: "" },
      { tool: "lucy_query", eval_mark: 1, args_summary: null },
      { tool: "lucy_query", eval_mark: 1, args_summary: "[]" }
    ]);
    expect(sql.probes).toBe(0);
    expect(sql.usage).toBe(4);
  });

  it("normalizes SQLite integer eval_mark to the TS boolean semantics", () => {
    // eval_mark = 1 is true; 0 and NULL are not. The TS path receives a boolean.
    const sql = classifyInSqlite([
      { tool: "lucy_query", eval_mark: 1, args_summary: JSON.stringify({ connection: "probe-demo" }) },
      { tool: "lucy_query", eval_mark: 0, args_summary: JSON.stringify({ connection: "probe-demo" }) },
      { tool: "lucy_query", eval_mark: null, args_summary: JSON.stringify({ connection: "probe-demo" }) }
    ]);
    expect(sql.probes).toBe(1);
    expect(sql.usage).toBe(2);
  });
});

describe("Spec 189 §5.1 — no compat row limit on usage aggregation", () => {
  it("aggregates more than 5000 window rows without truncation", () => {
    const db = new Database(":memory:");
    try {
      db.exec("CREATE TABLE access_log (id INTEGER PRIMARY KEY, tool TEXT, eval_mark INTEGER, args_summary TEXT)");
      const insert = db.prepare("INSERT INTO access_log (tool, eval_mark, args_summary) VALUES (?, ?, ?)");
      const total = 5200;
      const seed = db.transaction(() => {
        for (let i = 0; i < total; i += 1) {
          insert.run(i % 2 === 0 ? "lucy_query" : "ping", 0, JSON.stringify({ connection: "mysql-aliyun" }));
        }
      });
      seed();
      const usage = db
        .prepare(`SELECT COUNT(*) AS n FROM access_log WHERE ${defaultUsageConditionSql().sql}`)
        .get() as { n: number };
      const protocol = db
        .prepare(`SELECT COUNT(*) AS n FROM access_log WHERE ${protocolConditionSql().sql}`)
        .get() as { n: number };
      expect(usage.n).toBe(total / 2);
      expect(protocol.n).toBe(total / 2);
      expect(usage.n + protocol.n).toBe(total);
    } finally {
      db.close();
    }
  });
});
