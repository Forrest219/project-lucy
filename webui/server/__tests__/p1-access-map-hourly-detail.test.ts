/**
 * Spec lucy-20261104-access-map-hourly-detail — S1 server SC-07–SC-14、SC-17.
 */
import { describe, expect, it } from "vitest";
import {
  assertFlowConservation,
  buildAccessMap,
  buildGrantLayer,
  parseAccessMapQuery,
  type AccessMapAccessSide,
  type AccessMapAgentRecord,
  type AccessMapAuditRow,
  type AccessMapGrantSide,
  type AccessMapProvider,
  type AccessMapQuery,
  type AccessMapRoleContribution
} from "../admin/access-map.js";
import {
  bandSetsFromAuditRows,
  buildHourlyDetailBuckets,
  groupAuditRowsToHourlyCalls,
  packHourlyDetailKey,
  shanghaiHourFloor,
  type HourlyDetailBucket,
  type HourlyDetailBucketMeta
} from "../admin/access-map-hourly-detail.js";

const DEFAULT_QUERY: AccessMapQuery = {
  agent: null,
  role: null,
  token: null,
  table: null,
  connection: null,
  window: "168h",
  layer: "flat",
  trust: "confirmed",
  inquiryKind: "all",
  accessGrade: "all",
  view: "table",
  focus: null,
  detailLimit: 200,
  detailOffset: 0
};

function source(connectionId: string, schema: string, sourceName: string) {
  return {
    connectionId,
    schema,
    sourceName,
    physicalTable: `${schema}.${sourceName}`
  };
}

function agent(
  id: string,
  roleIds: string[],
  tokens: Array<{ label: string }> = [{ label: "p0-demo" }]
): AccessMapAgentRecord {
  return {
    id,
    name: id.toUpperCase(),
    enabled: true,
    roleIds,
    tokens: tokens.map((token) => ({
      label: token.label,
      status: "active" as const,
      callCount: 0
    }))
  };
}

function grantSide(overrides: Partial<AccessMapGrantSide> = {}): AccessMapGrantSide {
  const contributions: AccessMapRoleContribution[] = [
    {
      agentId: "agent_a",
      roleId: "role_reader",
      sources: [
        source("mysql_main", "finance", "orders"),
        source("mysql_main", "finance", "returns")
      ]
    },
    {
      agentId: "agent_a",
      roleId: "role_auditor",
      sources: [source("mysql_main", "finance", "orders")]
    }
  ];
  return {
    state: "ok",
    problem: null,
    failures: [],
    identity: {
      configVersion: "cfg-1",
      policyVersion: "pol-1",
      sourceMapVersion: "smap-1",
      capabilityDigest: "cap-1"
    },
    agents: [agent("agent_a", ["role_reader", "role_auditor"])],
    contributions,
    orphanGrants: 0,
    enabledConnections: ["mysql_main"],
    ...overrides
  };
}

let auditCounter = 0;

function auditRow(overrides: Partial<AccessMapAuditRow> = {}): AccessMapAuditRow {
  auditCounter += 1;
  return {
    callId: `call-${auditCounter}`,
    userId: "agent_a",
    matchedRoleId: "role_reader",
    roleIds: [],
    tokenLabel: "p0-demo",
    outcome: "allow",
    ts: "2026-10-19T00:30:00.000Z",
    permissionSnapshotHash: null,
    capabilityDigest: null,
    connectionId: "mysql_main",
    schemaName: "finance",
    sourceName: "orders",
    tool: "lucy_query",
    inquiryKind: "real",
    ...overrides
  };
}

function accessSide(rows: AccessMapAuditRow[]): AccessMapAccessSide {
  const { E, D } = bandSetsFromAuditRows(rows);
  return {
    state: "ok",
    rows,
    tokenCallCounts: new Map(),
    tokenLastUsed: new Map(),
    loadSnapshot: () => null,
    deniedCalls: D.size,
    echo: {
      enteringAllowCallCount: E.size,
      enteringAllowCallCountBasis: "pre_structure"
    }
  };
}

function provider(grant: AccessMapGrantSide, access: AccessMapAccessSide): AccessMapProvider {
  return {
    loadGrantSide: async () => grant,
    loadAccessSide: async () => access
  };
}

function metaOf(partial: Partial<HourlyDetailBucketMeta> & Pick<HourlyDetailBucketMeta, "hour" | "table">): HourlyDetailBucketMeta {
  return {
    hour: partial.hour,
    agentId: partial.agentId ?? "agent_a",
    roleId: partial.roleId ?? "role_reader",
    connectionId: partial.connectionId ?? "mysql_main",
    schema: partial.schema ?? "finance",
    table: partial.table,
    inquiryKind: partial.inquiryKind === undefined ? "real" : partial.inquiryKind,
    accessGrade: partial.accessGrade ?? "query"
  };
}

function expectBucketSetsEqual(
  actual: Map<string, HourlyDetailBucket>,
  expected: Map<string, { allow: Set<string>; deny: Set<string> }>
): void {
  expect([...actual.keys()].sort()).toEqual([...expected.keys()].sort());
  for (const [key, exp] of expected) {
    const got = actual.get(key);
    expect(got, `missing bucket ${key}`).toBeDefined();
    expect([...got!.allow].sort()).toEqual([...exp.allow].sort());
    expect([...got!.deny].sort()).toEqual([...exp.deny].sort());
  }
}

describe("SC-08 shanghai hour floor", () => {
  it("floors UTC timestamps to Asia/Shanghai hour buckets", () => {
    // 2026-10-19T00:30Z = 08:30+08 → hour 08
    expect(shanghaiHourFloor("2026-10-19T00:30:00.000Z")).toBe("2026-10-19T08:00:00+08:00");
    // 2026-10-19T16:05Z = 00:05+08 next day → hour 00
    expect(shanghaiHourFloor("2026-10-19T16:05:00.000Z")).toBe("2026-10-20T00:00:00+08:00");
  });
});

describe("SC-07 / SC-08 / SC-09 / SC-10 — hourly buckets + conservation", () => {
  it("view=map omits detail; view=table returns hourly rows", async () => {
    const rows = [
      auditRow({
        callId: "c-h1",
        ts: "2026-10-19T00:10:00.000Z",
        sourceName: "orders"
      }),
      auditRow({
        callId: "c-h2",
        ts: "2026-10-19T01:10:00.000Z",
        sourceName: "orders"
      })
    ];
    const mapView = await buildAccessMap(provider(grantSide(), accessSide(rows)), {
      ...DEFAULT_QUERY,
      view: "map"
    });
    expect(mapView.detail).toBeUndefined();

    const tableView = await buildAccessMap(provider(grantSide(), accessSide(rows)), DEFAULT_QUERY);
    expect(tableView.detail).toBeDefined();
    expect(tableView.detail?.totalRowCount).toBe(2);
    expect(tableView.detail?.rows.map((r) => r.hour)).toEqual([
      "2026-10-19T08:00:00+08:00",
      "2026-10-19T09:00:00+08:00"
    ]);
  });

  it("access unavailable → detail null (not empty success table)", async () => {
    const access: AccessMapAccessSide = {
      state: "unavailable",
      reason: "审计数据不可用"
    };
    const response = await buildAccessMap(provider(grantSide(), access), DEFAULT_QUERY);
    expect(response.meta.access.state).toBe("unavailable");
    expect(response.detail).toBeNull();
  });

  it("cross-hour same five-tuple splits into two rows", async () => {
    const rows = [
      auditRow({
        callId: "a1",
        ts: "2026-10-19T00:15:00.000Z",
        sourceName: "orders"
      }),
      auditRow({
        callId: "a2",
        ts: "2026-10-19T01:15:00.000Z",
        sourceName: "orders"
      })
    ];
    const response = await buildAccessMap(provider(grantSide(), accessSide(rows)), DEFAULT_QUERY);
    expect(response.detail?.rows).toHaveLength(2);
    expect(response.detail?.rows[0].table).toBe("orders");
    expect(response.detail?.rows[1].table).toBe("orders");
    expect(response.detail?.rows[0].hour).not.toBe(response.detail?.rows[1].hour);
  });

  it("D14: per-bucket ID sets match fixture; swap-two-buckets fails set equality", () => {
    const hourA = "2026-10-19T08:00:00+08:00";
    const hourB = "2026-10-19T09:00:00+08:00";
    const rows = [
      auditRow({
        callId: "allow-1",
        ts: "2026-10-19T00:10:00.000Z",
        sourceName: "orders",
        outcome: "allow"
      }),
      auditRow({
        callId: "allow-2",
        ts: "2026-10-19T01:10:00.000Z",
        sourceName: "returns",
        outcome: "allow"
      }),
      auditRow({
        callId: "deny-1",
        ts: "2026-10-19T00:20:00.000Z",
        sourceName: "orders",
        outcome: "deny"
      })
    ];
    const { E, D } = bandSetsFromAuditRows(rows);
    const calls = groupAuditRowsToHourlyCalls({ rows, E, D });
    const buckets = buildHourlyDetailBuckets({ E, D, calls });

    const keyOrders = packHourlyDetailKey(
      metaOf({ hour: hourA, table: "orders", inquiryKind: "real", accessGrade: "query" })
    );
    const keyReturns = packHourlyDetailKey(
      metaOf({ hour: hourB, table: "returns", inquiryKind: "real", accessGrade: "query" })
    );

    const expected = new Map([
      [keyOrders, { allow: new Set(["allow-1"]), deny: new Set(["deny-1"]) }],
      [keyReturns, { allow: new Set(["allow-2"]), deny: new Set<string>() }]
    ]);
    expectBucketSetsEqual(buckets, expected);

    // Response counts = set sizes
    expect(buckets.get(keyOrders)!.allow.size).toBe(1);
    expect(buckets.get(keyOrders)!.deny.size).toBe(1);

    // Swap-two-buckets fixture: counts match but ID sets differ — must fail set check.
    const swapped = new Map([
      [keyOrders, { allow: new Set(["allow-2"]), deny: new Set(["deny-1"]) }],
      [keyReturns, { allow: new Set(["allow-1"]), deny: new Set<string>() }]
    ]);
    expect(swapped.get(keyOrders)!.allow.size).toBe(expected.get(keyOrders)!.allow.size);
    expect(swapped.get(keyReturns)!.allow.size).toBe(expected.get(keyReturns)!.allow.size);
    expect([...swapped.get(keyOrders)!.allow]).not.toEqual([...expected.get(keyOrders)!.allow]);

    // Global conservation: never Σ allowCalls as |E|
    const sumAllow = [...buckets.values()].reduce((n, b) => n + b.allow.size, 0);
    const globalAllow = new Set([...buckets.values()].flatMap((b) => [...b.allow]));
    expect(globalAllow.size).toBe(E.size);
    // Multi-role expansion would make sum >= |E|; here single role so equal, but assert global.
    expect(sumAllow).toBeGreaterThanOrEqual(E.size);
    expect(globalAllow.size).not.toBe(sumAllow - 1); // sanity
  });

  it("SC-09/10: full page without scope/focus — global allow/deny = echo counts; multi-role does not inflate |E|", async () => {
    const rows = [
      auditRow({
        callId: "shared",
        matchedRoleId: null,
        roleIds: ["role_reader", "role_auditor"],
        sourceName: "orders",
        outcome: "allow",
        ts: "2026-10-19T00:10:00.000Z"
      }),
      auditRow({
        callId: "denied",
        matchedRoleId: "role_reader",
        sourceName: "orders",
        outcome: "deny",
        ts: "2026-10-19T00:20:00.000Z"
      })
    ];
    const response = await buildAccessMap(provider(grantSide(), accessSide(rows)), DEFAULT_QUERY);
    expect(response.meta.echo?.enteringAllowCallCount).toBe(1);
    expect(response.meta.access.deniedCalls).toBe(1);
    expect(response.detail?.hasMore).toBe(false);
    expect(response.detail?.offset).toBe(0);
    expect(response.detail?.rows.length).toBe(response.detail?.totalRowCount);

    const { E, D } = bandSetsFromAuditRows(rows);
    const buckets = buildHourlyDetailBuckets({
      E,
      D,
      calls: groupAuditRowsToHourlyCalls({ rows, E, D })
    });
    const globalAllow = new Set([...buckets.values()].flatMap((b) => [...b.allow]));
    const globalDeny = new Set([...buckets.values()].flatMap((b) => [...b.deny]));
    expect(globalAllow.size).toBe(response.meta.echo!.enteringAllowCallCount);
    expect(globalDeny.size).toBe(response.meta.access.deniedCalls);

    // Σ allowCalls across rows would be 2 (two roles) — must not equal |E|
    const sumAllowCalls = response.detail!.rows.reduce((n, r) => n + r.allowCalls, 0);
    expect(sumAllowCalls).toBe(2);
    expect(sumAllowCalls).not.toBe(response.meta.echo!.enteringAllowCallCount);
  });

  it("deny-only rows appear in detail even when graph has no access edges on that path", async () => {
    const rows = [
      auditRow({
        callId: "only-deny",
        outcome: "deny",
        sourceName: "orders",
        ts: "2026-10-19T00:10:00.000Z"
      })
    ];
    const response = await buildAccessMap(provider(grantSide(), accessSide(rows)), DEFAULT_QUERY);
    expect(response.detail?.rows.length).toBeGreaterThan(0);
    expect(response.detail?.rows.every((r) => r.denyCalls > 0 && r.allowCalls === 0)).toBe(true);
  });
});

describe("SC-11 — token ignored", () => {
  it("token query param does not change map/table E/D/edge counts/detail", async () => {
    const rows = [
      auditRow({ callId: "t1", tokenLabel: "p0-demo", sourceName: "orders" }),
      auditRow({ callId: "t2", tokenLabel: "p1-other", sourceName: "returns" })
    ];
    const without = await buildAccessMap(provider(grantSide(), accessSide(rows)), DEFAULT_QUERY);
    const withToken = await buildAccessMap(provider(grantSide(), accessSide(rows)), {
      ...DEFAULT_QUERY,
      token: "p0-demo"
    });
    expect(withToken.meta.counts.accessPaths).toBe(without.meta.counts.accessPaths);
    expect(withToken.meta.access.rawCalls).toBe(without.meta.access.rawCalls);
    expect(withToken.meta.echo?.enteringAllowCallCount).toBe(
      without.meta.echo?.enteringAllowCallCount
    );
    expect(withToken.detail?.totalRowCount).toBe(without.detail?.totalRowCount);
    expect(withToken.detail?.rows).toEqual(without.detail?.rows);
  });

  it("token in URL does not 400; other illegal params still 400", () => {
    const withToken = parseAccessMapQuery({ token: "anything", view: "table" });
    expect(withToken.ok).toBe(true);
    expect(parseAccessMapQuery({ window: "48h" }).ok).toBe(false);
    expect(parseAccessMapQuery({ detailLimit: "1.5" }).ok).toBe(false);
  });
});

describe("SC-12 — detail pagination", () => {
  function manyRows(n: number): AccessMapAuditRow[] {
    return Array.from({ length: n }, (_, i) =>
      auditRow({
        callId: `page-${i}`,
        // Spread across hours so each call is its own bucket (stable sort).
        ts: new Date(Date.UTC(2026, 9, 19, i, 10, 0)).toISOString(),
        sourceName: "orders"
      })
    );
  }

  it("non-integer detailLimit/detailOffset → 400; limit clamps to 2000; offset<0 → 0", () => {
    expect(parseAccessMapQuery({ detailLimit: "abc" }).ok).toBe(false);
    expect(parseAccessMapQuery({ detailOffset: "1.2" }).ok).toBe(false);
    const clamped = parseAccessMapQuery({ detailLimit: "5000", detailOffset: "-3" });
    expect(clamped.ok).toBe(true);
    if (!clamped.ok) return;
    expect(clamped.query.detailLimit).toBe(2000);
    expect(clamped.query.detailOffset).toBe(0);
  });

  it("first / middle / last / past-end pages: hasMore and totalRowCount", async () => {
    const rows = manyRows(5);
    const p = provider(grantSide(), accessSide(rows));

    const first = await buildAccessMap(p, {
      ...DEFAULT_QUERY,
      detailLimit: 2,
      detailOffset: 0
    });
    expect(first.detail?.totalRowCount).toBe(5);
    expect(first.detail?.rows).toHaveLength(2);
    expect(first.detail?.hasMore).toBe(true);

    const mid = await buildAccessMap(p, {
      ...DEFAULT_QUERY,
      detailLimit: 2,
      detailOffset: 2
    });
    expect(mid.detail?.rows).toHaveLength(2);
    expect(mid.detail?.hasMore).toBe(true);

    const last = await buildAccessMap(p, {
      ...DEFAULT_QUERY,
      detailLimit: 2,
      detailOffset: 4
    });
    expect(last.detail?.rows).toHaveLength(1);
    expect(last.detail?.hasMore).toBe(false);

    const past = await buildAccessMap(p, {
      ...DEFAULT_QUERY,
      detailLimit: 2,
      detailOffset: 10
    });
    expect(past.detail?.rows).toHaveLength(0);
    expect(past.detail?.hasMore).toBe(false);
    expect(past.detail?.totalRowCount).toBe(5);
    // Past-end must not claim full-page conservation precondition
    expect(past.detail?.offset === 0 && !past.detail.hasMore).toBe(false);
  });
});

describe("SC-13 — scope / focus on detail", () => {
  it("scope exact-matches detail row fields", async () => {
    const rows = [
      auditRow({ callId: "s1", sourceName: "orders", matchedRoleId: "role_reader" }),
      auditRow({ callId: "s2", sourceName: "returns", matchedRoleId: "role_reader" }),
      auditRow({
        callId: "s3",
        sourceName: "orders",
        matchedRoleId: "role_auditor"
      })
    ];
    const byTable = await buildAccessMap(provider(grantSide(), accessSide(rows)), {
      ...DEFAULT_QUERY,
      table: "mysql_main::finance::orders"
    });
    expect(byTable.detail?.rows.every((r) => r.table === "orders")).toBe(true);
    expect(byTable.detail?.totalRowCount).toBe(2);

    const byRole = await buildAccessMap(provider(grantSide(), accessSide(rows)), {
      ...DEFAULT_QUERY,
      role: "role_auditor"
    });
    expect(byRole.detail?.rows.every((r) => r.roleId === "role_auditor")).toBe(true);
    expect(byRole.detail?.totalRowCount).toBe(1);
  });

  it("invalid focus ignored; agent focus keeps deny-only matching rows", async () => {
    const rows = [
      auditRow({
        callId: "allow-focus",
        outcome: "allow",
        sourceName: "orders",
        userId: "agent_a"
      }),
      auditRow({
        callId: "deny-focus",
        outcome: "deny",
        sourceName: "returns",
        userId: "agent_a"
      })
    ];
    const invalid = await buildAccessMap(provider(grantSide(), accessSide(rows)), {
      ...DEFAULT_QUERY,
      focus: "agent:does-not-exist"
    });
    expect(invalid.detail?.totalRowCount).toBe(2);

    const agentFocus = await buildAccessMap(provider(grantSide(), accessSide(rows)), {
      ...DEFAULT_QUERY,
      focus: "agent:agent_a"
    });
    expect(agentFocus.detail?.rows.some((r) => r.denyCalls > 0)).toBe(true);
    expect(agentFocus.detail?.totalRowCount).toBeGreaterThanOrEqual(2);
  });
});

describe("SC-14 — grant skeleton / dormant unchanged by detail", () => {
  it("dormant edges still present on map when building table detail", async () => {
    const rows = [
      auditRow({ callId: "only-orders", sourceName: "orders" })
    ];
    const response = await buildAccessMap(provider(grantSide(), accessSide(rows)), DEFAULT_QUERY);
    const returns = response.edges.find(
      (e) => e.target === "table:mysql_main::finance::returns" || e.source === "table:mysql_main::finance::returns"
    );
    // returns has grant but no access → dormant somewhere on path
    expect(response.meta.signals.dormantEdges).toBeGreaterThan(0);
    expect(response.detail?.rows.every((r) => r.table === "orders")).toBe(true);
    // Grant layer conservation still holds
    const grant = buildGrantLayer({ side: grantSide(), withSchema: false });
    expect(assertFlowConservation(grant)).toEqual([]);
    void returns;
  });
});

describe("SC-17 — buildBandED once; ok:false → unavailable", () => {
  it("ok:false from buildBandED surfaces as access unavailable with detail null", async () => {
    const access: AccessMapAccessSide = {
      state: "unavailable",
      reason: "问询关联重建失败，访问层不可用"
    };
    const response = await buildAccessMap(provider(grantSide(), access), DEFAULT_QUERY);
    expect(response.meta.access.state).toBe("unavailable");
    expect(response.meta.access.reason).toContain("不可用");
    expect(response.detail).toBeNull();
  });

  it("buildAccessMap does not call loadAccessSide twice per request", async () => {
    let loadCount = 0;
    const rows = [auditRow({ callId: "once" })];
    const p: AccessMapProvider = {
      loadGrantSide: async () => grantSide(),
      loadAccessSide: async () => {
        loadCount += 1;
        return accessSide(rows);
      }
    };
    await buildAccessMap(p, DEFAULT_QUERY);
    expect(loadCount).toBe(1);
  });
});

describe("P1-19 outcome vocabulary", () => {
  it("ok and legacy allow enter E; denied/error/budget_stop enter D", () => {
    const { E, D } = bandSetsFromAuditRows([
      auditRow({ callId: "ok-1", outcome: "ok" }),
      auditRow({ callId: "allow-1", outcome: "allow" }),
      auditRow({ callId: "denied-1", outcome: "denied" }),
      auditRow({ callId: "error-1", outcome: "error" }),
      auditRow({ callId: "budget-1", outcome: "budget_stop" })
    ]);
    expect([...E].sort()).toEqual(["allow-1", "ok-1"]);
    expect([...D].sort()).toEqual(["budget-1", "denied-1", "error-1"]);
  });
});

describe("inquiryKind null → 无关联 field", () => {
  it("null inquiryKind is preserved on detail rows", async () => {
    const rows = [
      auditRow({
        callId: "no-kind",
        inquiryKind: null,
        sourceName: "orders"
      })
    ];
    const response = await buildAccessMap(provider(grantSide(), accessSide(rows)), DEFAULT_QUERY);
    expect(response.detail?.rows[0]?.inquiryKind).toBeNull();
  });
});
