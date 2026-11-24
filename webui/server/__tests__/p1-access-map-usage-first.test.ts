/**
 * Access-map usage-first Spec v0.4.2 — server SC-22／25／26／27／30.
 */
import { describe, expect, it } from "vitest";
import {
  allowCallIdsFromAccessPaths,
  buildAccessLayer,
  buildAccessMap,
  buildGrantLayer,
  filterAccessPathsByStructureScope,
  filterGrantSideByStructureScope,
  foldAccessMapGraph,
  mergeLayers,
  type AccessMapAccessSide,
  type AccessMapAgentRecord,
  type AccessMapAuditRow,
  type AccessMapGrantSide,
  type AccessMapProvider,
  type AccessMapQuery,
  type AccessMapRoleContribution
} from "../admin/access-map.js";
import {
  applyScopeToDetailBuckets,
  bandSetsFromAuditRows,
  buildHourlyDetailBuckets,
  groupAuditRowsToHourlyCalls,
  projectDetailBucketsWithFocus
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
  inquiryKind: "management",
  accessGrade: "exclude_connect",
  view: "map",
  focus: null
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

function sharedGrantSide(): AccessMapGrantSide {
  const contributions: AccessMapRoleContribution[] = [
    {
      agentId: "agent_a",
      roleId: "role_shared",
      sources: [
        source("mysql_main", "finance", "orders"),
        source("mysql_main", "finance", "returns")
      ]
    },
    {
      agentId: "agent_b",
      roleId: "role_shared",
      sources: [
        source("mysql_main", "finance", "orders"),
        source("mysql_main", "finance", "returns")
      ]
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
    agents: [
      agent("agent_a", ["role_shared"]),
      agent("agent_b", ["role_shared"])
    ],
    contributions,
    orphanGrants: 0,
    enabledConnections: ["mysql_main"]
  };
}

let auditCounter = 0;

function auditRow(overrides: Partial<AccessMapAuditRow> = {}): AccessMapAuditRow {
  auditCounter += 1;
  return {
    callId: `call-${auditCounter}`,
    userId: "agent_a",
    matchedRoleId: "role_shared",
    roleIds: [],
    tokenLabel: "p0-demo",
    outcome: "allow",
    ts: "2026-10-19T00:00:00.000Z",
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
  return {
    state: "ok",
    rows,
    tokenCallCounts: new Map(),
    tokenLastUsed: new Map(),
    loadSnapshot: () => null,
    deniedCalls: rows.filter((row) => row.outcome !== "allow" && row.outcome !== "ok").length,
    echo: {
      enteringAllowCallCount: rows.filter((row) => row.outcome === "allow" || row.outcome === "ok").length,
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

function expectCallSet(actual: Iterable<string>, expected: string[]): void {
  expect([...actual].sort()).toEqual([...expected].sort());
}

function detailAllowCallIds(
  rows: AccessMapAuditRow[],
  query: Pick<AccessMapQuery, "agent" | "role" | "connection" | "table">
): Set<string> {
  const { E, D } = bandSetsFromAuditRows(rows);
  const calls = groupAuditRowsToHourlyCalls({ rows, E, D });
  const buckets = buildHourlyDetailBuckets({ E, D, calls });
  const scoped = applyScopeToDetailBuckets(buckets.values(), query);
  const projected = projectDetailBucketsWithFocus(scoped, null);
  const ids = new Set<string>();
  for (const bucket of projected) {
    for (const id of bucket.allow) ids.add(id);
  }
  return ids;
}

function mapAllowCallIds(
  rows: AccessMapAuditRow[],
  query: Pick<AccessMapQuery, "agent" | "role" | "connection" | "table">
): Set<string> {
  const layer = buildAccessLayer({ rows, tokenLabel: null });
  const scoped = filterAccessPathsByStructureScope(layer.paths, query);
  return allowCallIdsFromAccessPaths(scoped);
}

describe("usage-first · fold SC-27", () => {
  it("SC-27 — 大量闲置表＋少量高 accessPaths 表时，高使用表标签仍在 render", () => {
    const hotTables = ["hot_orders", "hot_customers", "hot_payments"];
    const idleSources = Array.from({ length: 80 }, (_, i) =>
      source("mysql_main", "finance", `idle_${i}`)
    );
    const grant: AccessMapGrantSide = {
      state: "ok",
      problem: null,
      failures: [],
      identity: {
        configVersion: "cfg-1",
        policyVersion: "pol-1",
        sourceMapVersion: "smap-1",
        capabilityDigest: "cap-1"
      },
      agents: [agent("agent_a", ["role_reader"])],
      contributions: [
        {
          agentId: "agent_a",
          roleId: "role_reader",
          sources: [
            ...hotTables.map((name) => source("mysql_main", "finance", name)),
            ...idleSources
          ]
        }
      ],
      orphanGrants: 0,
      enabledConnections: ["mysql_main"]
    };
    const rows = hotTables.map((name) =>
      auditRow({
        callId: `hot-${name}`,
        userId: "agent_a",
        matchedRoleId: "role_reader",
        sourceName: name
      })
    );
    const grantLayer = buildGrantLayer({ side: grant, withSchema: false });
    const layer = buildAccessLayer({ rows, tokenLabel: null });
    const merged = mergeLayers({
      grant: grantLayer,
      paths: layer.paths,
      loadSnapshot: () => null,
      withSchema: false
    });
    // 夹具：闲置表 grant 极高、使用为 0；热表 accessPaths 高、grant 低。
    // 旧受害序（grant+access）会先折热表；usage-first 只看 accessPaths，热表须存活。
    for (const node of merged.nodes.values()) {
      if (node.kind !== "table") continue;
      if (node.label.startsWith("idle_")) {
        node.grantPaths = 100;
        node.accessPaths = 0;
      } else if (hotTables.includes(node.label)) {
        node.grantPaths = 1;
        node.accessPaths = 40;
      }
    }

    const folded = foldAccessMapGraph(
      {
        nodes: [...merged.nodes.values()],
        edges: [...merged.edges.values()]
      },
      { nodeBudget: 12, edgeBudget: 400 }
    );
    const labels = folded.nodes.map((node) => node.label);
    for (const name of hotTables) {
      expect(labels, `hot table ${name} must survive fold`).toContain(name);
    }
    expect(folded.folded.nodes).toBeGreaterThan(0);
  });
});

describe("usage-first · scope path projection SC-22／25／26／30", () => {
  it("SC-22 — agent= 重投影：无第二 Agent；共享下游边权为 A-only；B 的 callIds 消失", async () => {
    const callA1 = auditRow({ callId: "a1", userId: "agent_a", sourceName: "orders" });
    const callA2 = auditRow({ callId: "a2", userId: "agent_a", sourceName: "orders" });
    const callB = auditRow({ callId: "b1", userId: "agent_b", sourceName: "returns" });
    const rows = [callA1, callA2, callB];
    const response = await buildAccessMap(
      provider(sharedGrantSide(), accessSide(rows)),
      { ...DEFAULT_QUERY, agent: "agent_a" }
    );

    expect(response.nodes.some((node) => node.id === "agent:agent_a")).toBe(true);
    expect(response.nodes.some((node) => node.id === "agent:agent_b")).toBe(false);

    const roleConn = response.edges.find(
      (edge) => edge.source === "role:role_shared" && edge.target === "conn:mysql_main"
    );
    expect(roleConn).toBeDefined();
    // A 有 2 张表授权；B 的授权已剔除 → grantPaths=2（非 4）
    expect(roleConn?.grantPaths).toBe(2);
    // A 对 orders 两条访问路径（同表两条调用仍计 1 path?）—— buildAccessLayer 同 pathKey 合并 calls
    // orders 一条路径含 a1+a2；returns 无 A 访问 → accessPaths on role→conn = 1
    expect(roleConn?.accessPaths).toBe(1);
    expect(roleConn?.accessCalls).toBe(2);

    const returnsEdge = response.edges.find((edge) => edge.target.includes("returns"));
    // A 有 returns 授权但无访问 → 闲置边可在；不得残留 B 的访问
    if (returnsEdge) {
      expect(returnsEdge.accessPaths).toBe(0);
      expect(returnsEdge.accessCalls).toBe(0);
    }

    const mapP = mapAllowCallIds(rows, { agent: "agent_a", role: null, connection: null, table: null });
    expectCallSet(mapP, ["a1", "a2"]);
    expect(mapP.has("b1")).toBe(false);
  });

  it("SC-25 — 无结构筛选：图｜E｜＝表允许调用 ID 集＝预写期望；同数替换 ID 必须失败", async () => {
    const call1 = auditRow({ callId: "e1", userId: "agent_a", sourceName: "orders" });
    const call2 = auditRow({ callId: "e2", userId: "agent_a", sourceName: "returns" });
    const call3 = auditRow({ callId: "e3", userId: "agent_b", sourceName: "orders" });
    const rows = [call1, call2, call3];
    const expectedE = ["e1", "e2", "e3"];

    const response = await buildAccessMap(
      provider(sharedGrantSide(), accessSide(rows)),
      DEFAULT_QUERY
    );
    expect(response.meta.echo?.enteringAllowCallCount).toBe(expectedE.length);
    expect(response.meta.echo?.projectedAllowCallCount).toBe(expectedE.length);

    const mapP = mapAllowCallIds(rows, {
      agent: null,
      role: null,
      connection: null,
      table: null
    });
    const tableP = detailAllowCallIds(rows, {
      agent: null,
      role: null,
      connection: null,
      table: null
    });
    expectCallSet(mapP, expectedE);
    expectCallSet(tableP, expectedE);
    expectCallSet(mapP, [...tableP]);

    // 计数相同但 ID 被替换必须失败
    const impostor = ["x1", "x2", "x3"];
    expect(impostor.length).toBe(expectedE.length);
    expect([...impostor].sort()).not.toEqual([...expectedE].sort());
    expect([...mapP].sort()).not.toEqual([...impostor].sort());
  });

  it("SC-25 — 改 inquiryKind：允许调用 ID 集等于该种类预写期望（禁止只比个数）", async () => {
    // 模拟 loadAccessSide 已按 inquiryKind 投影到 E：provider 只返回该种类行。
    const realOrders = auditRow({
      callId: "ik-real-1",
      userId: "agent_a",
      sourceName: "orders",
      inquiryKind: "real"
    });
    const realReturns = auditRow({
      callId: "ik-real-2",
      userId: "agent_a",
      sourceName: "returns",
      inquiryKind: "real"
    });
    const visitOrders = auditRow({
      callId: "ik-visit-1",
      userId: "agent_b",
      sourceName: "orders",
      inquiryKind: "session_visit"
    });
    const allRows = [realOrders, realReturns, visitOrders];
    const expectedByKind: Record<"real" | "session_visit" | "all", string[]> = {
      real: ["ik-real-1", "ik-real-2"],
      session_visit: ["ik-visit-1"],
      all: ["ik-real-1", "ik-real-2", "ik-visit-1"]
    };

    for (const kind of ["real", "session_visit", "all"] as const) {
      const expected = expectedByKind[kind];
      const kindRows =
        kind === "all" ? allRows : allRows.filter((row) => row.inquiryKind === kind);
      const response = await buildAccessMap(
        provider(sharedGrantSide(), accessSide(kindRows)),
        { ...DEFAULT_QUERY, inquiryKind: kind }
      );
      expect(response.meta.echo?.enteringAllowCallCount).toBe(expected.length);
      expect(response.meta.echo?.projectedAllowCallCount).toBe(expected.length);

      const scope = { agent: null, role: null, connection: null, table: null };
      const mapP = mapAllowCallIds(kindRows, scope);
      const tableP = detailAllowCallIds(kindRows, scope);
      expectCallSet(mapP, expected);
      expectCallSet(tableP, expected);
      expectCallSet(mapP, [...tableP]);

      // 同个数但 ID 被替换必须不相等（禁止只比 count）
      const impostor = expected.map((_, index) => `impostor-${kind}-${index}`);
      expect(impostor.length).toBe(expected.length);
      expect([...mapP].sort()).not.toEqual([...impostor].sort());
    }
  });

  it("SC-26 — agent=：预写 P；图＝表＝P；enteringAllowCallCount=｜E｜；双侧漏数失败", async () => {
    const callA1 = auditRow({ callId: "p1", userId: "agent_a", sourceName: "orders" });
    const callA2 = auditRow({ callId: "p2", userId: "agent_a", sourceName: "orders" });
    const callB = auditRow({ callId: "p3", userId: "agent_b", sourceName: "returns" });
    const rows = [callA1, callA2, callB];
    const expectedE = ["p1", "p2", "p3"];
    const expectedP = ["p1", "p2"];

    const response = await buildAccessMap(
      provider(sharedGrantSide(), accessSide(rows)),
      { ...DEFAULT_QUERY, agent: "agent_a" }
    );
    expect(response.meta.echo?.enteringAllowCallCount).toBe(expectedE.length);
    expect(response.meta.echo?.projectedAllowCallCount).toBe(expectedP.length);
    expect(response.meta.echo!.enteringAllowCallCount).toBeGreaterThanOrEqual(
      response.meta.echo!.projectedAllowCallCount!
    );

    const scope = { agent: "agent_a" as string | null, role: null, connection: null, table: null };
    const mapP = mapAllowCallIds(rows, scope);
    const tableP = detailAllowCallIds(rows, scope);
    expectCallSet(mapP, expectedP);
    expectCallSet(tableP, expectedP);
    expectCallSet(mapP, [...tableP]);

    // 双方同时漏掉一个 ID 必须失败（不得只比个数）
    const bothDropped = ["p1"];
    expect(bothDropped.length).not.toBe(expectedP.length);
    expect([...mapP].sort()).not.toEqual([...bothDropped].sort());
    expect([...tableP].sort()).not.toEqual([...bothDropped].sort());
    const sameCountImpostor = ["p1", "fake"];
    expect(sameCountImpostor.length).toBe(expectedP.length);
    expect([...mapP].sort()).not.toEqual([...sameCountImpostor].sort());
  });

  it("focus=table — keptAccessRefs／counts.accessPaths 不含子图外兄弟表路径", async () => {
    const callOrders = auditRow({ callId: "f-orders", userId: "agent_a", sourceName: "orders" });
    const callReturns = auditRow({ callId: "f-returns", userId: "agent_a", sourceName: "returns" });
    const rows = [callOrders, callReturns];
    const focusTableId = "table:mysql_main::finance::orders";

    const response = await buildAccessMap(
      provider(sharedGrantSide(), accessSide(rows)),
      { ...DEFAULT_QUERY, focus: focusTableId }
    );

    expect(response.nodes.some((node) => node.id === focusTableId)).toBe(true);
    expect(response.nodes.some((node) => node.id.includes("returns"))).toBe(false);
    expect(response.pathRefs.access.every((ref) => ref.sourceName === "orders")).toBe(true);
    expect(response.pathRefs.access.some((ref) => ref.sourceName === "returns")).toBe(false);
    // 仅 orders 一条访问路径；不得把 returns 路径计入
    expect(response.meta.counts.accessPaths).toBe(1);
    expect(response.meta.echo?.projectedAllowCallCount).toBe(1);
  });

  it("SC-30 — table=：P 不含未选中表 callId；连通分量不得带回", async () => {
    const callOrders = auditRow({ callId: "t-orders", userId: "agent_a", sourceName: "orders" });
    const callReturns = auditRow({ callId: "t-returns", userId: "agent_a", sourceName: "returns" });
    const rows = [callOrders, callReturns];
    const tableKey = "mysql_main::finance::orders";
    const expectedP = ["t-orders"];

    const response = await buildAccessMap(
      provider(sharedGrantSide(), accessSide(rows)),
      { ...DEFAULT_QUERY, table: tableKey }
    );

    expect(response.nodes.some((node) => node.id.includes("orders"))).toBe(true);
    expect(response.nodes.some((node) => node.id.includes("returns"))).toBe(false);

    const scope = {
      agent: null,
      role: null,
      connection: null,
      table: tableKey
    };
    const mapP = mapAllowCallIds(rows, scope);
    const tableP = detailAllowCallIds(rows, scope);
    expectCallSet(mapP, expectedP);
    expectCallSet(tableP, expectedP);
    expect(mapP.has("t-returns")).toBe(false);
    expect(response.meta.echo?.projectedAllowCallCount).toBe(1);

    // 旧连通分量会经共享 role／conn 把 returns 带回 —— 路径投影不得如此
    const scopedSide = filterGrantSideByStructureScope(sharedGrantSide(), scope);
    expect(
      scopedSide.contributions.every((c) =>
        c.sources.every((s) => s.sourceName === "orders")
      )
    ).toBe(true);
  });

  it("SC-18 抽样 — path projection 后流守恒仍成立", () => {
    const scoped = filterGrantSideByStructureScope(sharedGrantSide(), {
      agent: "agent_a",
      role: null,
      connection: null,
      table: null
    });
    const grant = buildGrantLayer({ side: scoped, withSchema: false });
    const layer = buildAccessLayer({
      rows: [
        auditRow({ callId: "c1", userId: "agent_a", sourceName: "orders" }),
        auditRow({ callId: "c2", userId: "agent_b", sourceName: "returns" })
      ],
      tokenLabel: null
    });
    const paths = filterAccessPathsByStructureScope(layer.paths, {
      agent: "agent_a",
      role: null,
      connection: null,
      table: null
    });
    const merged = mergeLayers({
      grant,
      paths,
      loadSnapshot: () => null,
      withSchema: false
    });
    // 手工守恒：中间节点入＝出（grant）
    const incoming = new Map<string, number>();
    const outgoing = new Map<string, number>();
    for (const edge of merged.edges.values()) {
      outgoing.set(edge.source, (outgoing.get(edge.source) ?? 0) + edge.grantPaths);
      incoming.set(edge.target, (incoming.get(edge.target) ?? 0) + edge.grantPaths);
    }
    for (const node of merged.nodes.values()) {
      if (node.kind === "role" || node.kind === "connection") {
        expect(incoming.get(node.id) ?? 0).toBe(outgoing.get(node.id) ?? 0);
      }
    }
  });
});
