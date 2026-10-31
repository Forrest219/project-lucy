/**
 * L25-10 Hive query execution wave — module HQ acceptance (synthetic).
 *
 * Authority: docs/specs/lucy-20261030-hive-query-execution-spec.md §7
 */
import { afterEach, describe, expect, it } from "vitest";
import {
  buildHivePartitionProfile,
  checkHivePartitionGate,
  countingJdbcWorker,
  createModuleHiveFixture,
  handleHiveMcpTool,
  hiveDiscoveryFromProfiles,
  lookupHiveConnection,
  partitionedProfile,
  registerHiveProxyExecutionContext,
  resolveAndMaybeServeHiveTool,
  resolveHiveMcpRoute,
  runHiveExecution,
  unknownPartitionProfile,
  unpartitionedProfile
} from "../hive/index.js";
import { mkdtemp, writeFile, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

afterEach(() => {
  registerHiveProxyExecutionContext(null);
});

describe("HQ-01 partition profile", () => {
  it("registers ordered keys; empty → unpartitioned; missing → unknown", () => {
    const partitioned = buildHivePartitionProfile([
      { name: "dt", type: "string" },
      { name: "region", type: "string" }
    ]);
    expect(partitioned.ok).toBe(true);
    if (!partitioned.ok) return;
    expect(partitioned.profile.status).toBe("partitioned");
    expect(partitioned.profile.keys.map((k) => k.name)).toEqual(["dt", "region"]);

    const unpartitioned = buildHivePartitionProfile([]);
    expect(unpartitioned.ok).toBe(true);
    if (unpartitioned.ok) expect(unpartitioned.profile.status).toBe("unpartitioned");

    const unknown = buildHivePartitionProfile(undefined);
    expect(unknown.ok).toBe(true);
    if (unknown.ok) expect(unknown.profile.status).toBe("unknown");
  });
});

describe("HQ-02..HQ-10 partition gate", () => {
  const fixture = createModuleHiveFixture();
  const part = "sales.orders_part";
  const dim = "sales.dim_region";

  it("HQ-02 unknown refuses before JDBC", async () => {
    const { worker, invokeCount } = countingJdbcWorker(fixture.worker);
    const result = await runHiveExecution({
      tool: "lucy_query",
      connectionId: "demo_hive",
      compiledSql: `SELECT amount FROM ${part} WHERE dt = '2024-01-01' LIMIT 10`,
      profilesByPhysicalTable: new Map([[part, unknownPartitionProfile()]]),
      jdbcWorker: worker,
      deadlineMs: 5_000,
      maxRows: 100
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.reason).toBe("hive_partition_status_unknown");
    expect(result.failure.jdbcInvokeCount).toBe(0);
    expect(invokeCount()).toBe(0);
  });

  it("HQ-03 missing partition predicate → hive_partition_predicate_required; JDBC=0", async () => {
    const { worker, invokeCount } = countingJdbcWorker(fixture.worker);
    const result = await runHiveExecution({
      tool: "lucy_query",
      connectionId: "demo_hive",
      compiledSql: `SELECT amount FROM ${part} LIMIT 10`,
      profilesByPhysicalTable: fixture.profiles,
      jdbcWorker: worker,
      deadlineMs: 5_000,
      maxRows: 100
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.reason).toBe("hive_partition_predicate_required");
    expect(result.failure.jdbcInvokeCount).toBe(0);
    expect(invokeCount()).toBe(0);
  });

  it("HQ-04 LIMIT alone is not a partition bound", () => {
    const gate = checkHivePartitionGate({
      sql: `SELECT amount FROM ${part} LIMIT 1`,
      profilesByPhysicalTable: fixture.profiles
    });
    expect(gate.ok).toBe(false);
    if (!gate.ok) expect(gate.reason).toBe("hive_partition_predicate_required");
  });

  it("HQ-05 row-policy-like non-partition predicate alone still rejects", () => {
    const gate = checkHivePartitionGate({
      sql: `SELECT amount FROM ${part} WHERE tenant_id = 'A' LIMIT 10`,
      profilesByPhysicalTable: fixture.profiles
    });
    expect(gate.ok).toBe(false);
    if (!gate.ok) expect(gate.reason).toBe("hive_partition_predicate_required");
  });

  it("HQ-06 bounded equality passes gate and executes on synthetic fixture", async () => {
    const result = await runHiveExecution({
      tool: "lucy_query",
      connectionId: "demo_hive",
      compiledSql: `SELECT amount FROM ${part} WHERE dt = '2024-01-01' LIMIT 10`,
      profilesByPhysicalTable: fixture.profiles,
      jdbcWorker: fixture.worker,
      deadlineMs: 5_000,
      maxRows: 100
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.jdbcInvokeCount).toBe(1);
    expect(result.value.rows.length).toBe(2);
  });

  it("HQ-07 bounded prefix (only p1) passes", () => {
    const gate = checkHivePartitionGate({
      sql: `SELECT amount FROM ${part} WHERE dt = '2024-01-01' LIMIT 10`,
      profilesByPhysicalTable: fixture.profiles
    });
    expect(gate.ok).toBe(true);
  });

  it("HQ-08 skip-level (only p2) rejects", () => {
    const gate = checkHivePartitionGate({
      sql: `SELECT amount FROM ${part} WHERE region = 'east' LIMIT 10`,
      profilesByPhysicalTable: fixture.profiles
    });
    expect(gate.ok).toBe(false);
    if (!gate.ok) expect(gate.reason).toBe("hive_partition_predicate_skip_level");
  });

  it("HQ-09 window PARTITION BY does not satisfy table partition bound", () => {
    // OVER is not in the verified AST subset — fail-closed before JDBC.
    const over = checkHivePartitionGate({
      sql: `SELECT SUM(amount) OVER (PARTITION BY dt) AS x FROM ${part} LIMIT 10`,
      profilesByPhysicalTable: fixture.profiles
    });
    expect(over.ok).toBe(false);

    // Gate only inspects WHERE; a non-partition WHERE still fails HQ-D3.
    const whereOnly = checkHivePartitionGate({
      sql: `SELECT amount FROM ${part} WHERE tenant_id = 'A' LIMIT 10`,
      profilesByPhysicalTable: fixture.profiles
    });
    expect(whereOnly.ok).toBe(false);
    if (!whereOnly.ok) expect(whereOnly.reason).toBe("hive_partition_predicate_required");
  });

  it("HQ-10 unpartitioned table does not require partition predicates", () => {
    const gate = checkHivePartitionGate({
      sql: `SELECT region FROM ${dim} LIMIT 10`,
      profilesByPhysicalTable: fixture.profiles
    });
    expect(gate.ok).toBe(true);
  });
});

describe("HQ-11..HQ-18 MCP / worker / audit", () => {
  const fixture = createModuleHiveFixture();

  it("HQ-11 explain never invokes JDBC", async () => {
    const { worker, invokeCount } = countingJdbcWorker(fixture.worker);
    const handled = await handleHiveMcpTool({
      tool: "lucy_explain_query",
      connectionId: "demo_hive",
      compiledSql: `SELECT amount FROM sales.orders_part WHERE dt = '2024-01-01' LIMIT 10`,
      profilesByPhysicalTable: fixture.profiles,
      jdbcWorker: worker
    });
    expect(handled.handled).toBe(true);
    if (!handled.handled) return;
    expect(handled.payload.explain).toBe(true);
    expect(handled.payload.jdbcInvokeCount).toBe(0);
    expect(invokeCount()).toBe(0);
  });

  it("HQ-12 Hive route vs KTX passthrough", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "hive-hq12-"));
    await mkdir(path.join(dir, "webui", "config"), { recursive: true });
    await writeFile(
      path.join(dir, "webui", "config", "hive-connections.yaml"),
      [
        "version: 1",
        "connections:",
        "  demo_hive:",
        "    host: localhost",
        "    port: 10000",
        "    transport: tcp",
        "    auth:",
        "      kind: none",
        "    allowed_databases: [sales]",
        "    enabled_tables: [sales.orders_part]",
        ""
      ].join("\n"),
      "utf8"
    );

    const hive = await resolveHiveMcpRoute(dir, "demo_hive");
    expect(hive.route).toBe("hive");
    const ktx = await resolveHiveMcpRoute(dir, "demo-mysql");
    expect(ktx.route).toBe("ktx");

    const lookup = await lookupHiveConnection(dir, "demo_hive");
    expect(lookup.kind).toBe("hive");
  });

  it("HQ-12 proxy hook never forwards Hive to KTX (context missing → fail closed)", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "hive-hq12b-"));
    await mkdir(path.join(dir, "webui", "config"), { recursive: true });
    await writeFile(
      path.join(dir, "webui", "config", "hive-connections.yaml"),
      [
        "version: 1",
        "connections:",
        "  demo_hive:",
        "    host: localhost",
        "    port: 10000",
        "    transport: tcp",
        "    auth:",
        "      kind: none",
        "    allowed_databases: [sales]",
        "    enabled_tables: [sales.orders_part]",
        ""
      ].join("\n"),
      "utf8"
    );
    const decision = await resolveAndMaybeServeHiveTool({
      projectRoot: dir,
      tool: "lucy_query",
      connectionId: "demo_hive",
      args: { connectionId: "demo_hive" }
    });
    expect(decision.action).toBe("serve_hive");
    if (decision.action !== "serve_hive") return;
    expect(decision.response.payload.ok).toBe(false);
    expect(decision.response.payload.reason).toBe("hive_execution_context_unavailable");
  });

  it("HQ-13 compile credential isolation remains a compile-bridge contract (smoke)", async () => {
    // Full assertions live in p1-hive-compile-bridge.test.ts; here we only
    // confirm the execution path never needs credentials in SQL args.
    const handled = await handleHiveMcpTool({
      tool: "lucy_query",
      connectionId: "demo_hive",
      compiledSql: `SELECT amount FROM sales.orders_part WHERE dt = '2024-01-01' LIMIT 10`,
      profilesByPhysicalTable: fixture.profiles,
      jdbcWorker: fixture.worker
    });
    expect(handled.handled).toBe(true);
    if (!handled.handled) return;
    expect(JSON.stringify(handled.payload)).not.toMatch(/password|keytab|jdbc_url/i);
  });

  it("HQ-14 multi-statement / non-readonly rejected by gate parse", () => {
    const gate = checkHivePartitionGate({
      sql: `SELECT amount FROM sales.orders_part WHERE dt = '2024-01-01' LIMIT 10; DROP TABLE sales.orders_part`,
      profilesByPhysicalTable: fixture.profiles
    });
    expect(gate.ok).toBe(false);
  });

  it("HQ-15 decimal / bigint stay strings (no JS number coercion)", async () => {
    const result = await runHiveExecution({
      tool: "lucy_query",
      connectionId: "demo_hive",
      compiledSql: `SELECT amount FROM sales.orders_part WHERE dt = '2024-01-01' AND region = 'east' LIMIT 10`,
      profilesByPhysicalTable: fixture.profiles,
      jdbcWorker: fixture.worker,
      deadlineMs: 5_000,
      maxRows: 10
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const row = result.value.rows[0]!;
    expect(typeof row.amount).toBe("string");
    expect(row.amount).toBe("100.50");
    expect(typeof row.order_id === "string" || row.order_id === undefined).toBe(true);
  });

  it("HQ-16 cancel observation on synthetic worker", async () => {
    const { worker } = fixture;
    worker.cancel?.("corr-1");
    const result = await worker.execute({
      connectionId: "demo_hive",
      sql: `SELECT amount FROM sales.orders_part WHERE dt = '2024-01-01' LIMIT 10`,
      deadlineMs: 5_000,
      maxRows: 10,
      correlationId: "corr-1"
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.reason).toBe("hive_jdbc_canceled");
    expect(result.failure.terminalState).toBe("canceled");
  });

  it("HQ-17 audit distinction: gate denial has no JDBC success attempt", async () => {
    const { worker, invokeCount } = countingJdbcWorker(fixture.worker);
    const denied = await runHiveExecution({
      tool: "lucy_query",
      connectionId: "demo_hive",
      compiledSql: `SELECT amount FROM sales.orders_part LIMIT 10`,
      profilesByPhysicalTable: fixture.profiles,
      jdbcWorker: worker,
      deadlineMs: 5_000,
      maxRows: 10
    });
    expect(denied.ok).toBe(false);
    if (denied.ok) return;
    expect(denied.failure.jdbcInvokeCount).toBe(0);
    expect(invokeCount()).toBe(0);
    // Compile success ≠ execution success is represented by stage/reason, not rows.
    expect(denied.failure.stage).toBe("partition_predicate_gate");
  });

  it("HQ-18 synthetic partition oracle matches independent expectation", async () => {
    const result = await runHiveExecution({
      tool: "lucy_query",
      connectionId: "demo_hive",
      compiledSql: `SELECT amount FROM sales.orders_part WHERE dt = '2024-01-01' LIMIT 10`,
      profilesByPhysicalTable: fixture.profiles,
      jdbcWorker: fixture.worker,
      deadlineMs: 5_000,
      maxRows: 10
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Independent oracle: two rows on 2024-01-01 with amounts 100.50 + 200.25
    const amounts = result.value.rows.map((row) => String(row.amount)).sort();
    expect(amounts).toEqual(["100.50", "200.25"]);
    const allDays = fixture.tables.get("sales.orders_part")!.rows;
    expect(allDays).toHaveLength(4);
    expect(result.value.rows).toHaveLength(2);
  });

  it("discovery exposes partition keys for agents", () => {
    const discovery = hiveDiscoveryFromProfiles("demo_hive", [
      {
        sourceName: "orders_part",
        physicalTable: "sales.orders_part",
        partitionKeysRaw: [
          { name: "dt", type: "string" },
          { name: "region", type: "string" }
        ]
      },
      {
        sourceName: "dim_region",
        physicalTable: "sales.dim_region",
        partitionKeysRaw: []
      }
    ]);
    expect(discovery[0]!.partitionStatus).toBe("partitioned");
    expect(discovery[0]!.partitionKeys.map((k) => k.name)).toEqual(["dt", "region"]);
    expect(discovery[1]!.partitionStatus).toBe("unpartitioned");
  });

  it("proxy hook with registered context serves Hive query", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "hive-ctx-"));
    await mkdir(path.join(dir, "webui", "config"), { recursive: true });
    await writeFile(
      path.join(dir, "webui", "config", "hive-connections.yaml"),
      [
        "version: 1",
        "connections:",
        "  demo_hive:",
        "    host: localhost",
        "    port: 10000",
        "    transport: tcp",
        "    auth:",
        "      kind: none",
        "    allowed_databases: [sales]",
        "    enabled_tables: [sales.orders_part]",
        ""
      ].join("\n"),
      "utf8"
    );
    registerHiveProxyExecutionContext({
      jdbcWorker: fixture.worker,
      compiledSqlForCall: async () => ({
        ok: true,
        sql: `SELECT amount FROM sales.orders_part WHERE dt = '2024-01-01' LIMIT 10`,
        profilesByPhysicalTable: fixture.profiles
      })
    });
    const decision = await resolveAndMaybeServeHiveTool({
      projectRoot: dir,
      tool: "lucy_query",
      connectionId: "demo_hive",
      args: { connectionId: "demo_hive" }
    });
    expect(decision.action).toBe("serve_hive");
    if (decision.action !== "serve_hive") return;
    expect(decision.response.payload.ok).toBe(true);
    expect(decision.response.payload.jdbcInvokeCount).toBe(1);
  });
});

describe("partition profile helpers", () => {
  it("constructors match buildHivePartitionProfile semantics", () => {
    expect(partitionedProfile([{ name: "dt" }]).status).toBe("partitioned");
    expect(unpartitionedProfile().status).toBe("unpartitioned");
    expect(unknownPartitionProfile().status).toBe("unknown");
  });
});
