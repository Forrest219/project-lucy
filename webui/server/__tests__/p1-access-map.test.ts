/**
 * Lucy v0.25 P1-3 — 访问关系图 (Access Map) 服务端行为测试。
 *
 * Authority: `webui/docs/187-access-relation-sankey-spec.md`
 *   §4.2 / §4.3 / §4.4 / §4.5 / §4.8 / §4.9
 *   §5.1–§5.5、§6.3
 *
 * 断言针对**行为**（守恒、四口径、快照证据分档、Token 只过滤访问层），
 * 不是「函数存在」。每条失败关闭场景都有对应用例。
 */
import { describe, expect, it } from "vitest";
import Fastify from "fastify";
import Database from "better-sqlite3";
import { registerAccessMapRoutes } from "../admin/routes/access-map.js";
import {
  createAdminAccessMapProvider,
  assertFlowConservation,
  buildAccessLayer,
  buildAccessMap,
  buildGrantLayer,
  countOrphanGrants,
  parseAccessMapQuery,
  splitTableParam,
  type AccessMapAccessSide,
  type AccessMapAgentRecord,
  type AccessMapAuditRow,
  type AccessMapGrantSide,
  type AccessMapProvider,
  type AccessMapQuery,
  type AccessMapRoleContribution
} from "../admin/access-map.js";

const DEFAULT_QUERY: AccessMapQuery = {
  agent: null,
  role: null,
  token: null,
  table: null,
  connection: null,
  window: "168h",
  layer: "flat",
  trust: "confirmed",
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

function agent(id: string, roleIds: string[], tokens: Array<{ label: string; status?: "active" | "expired" | "revoked" }> = []): AccessMapAgentRecord {
  return {
    id,
    name: id.toUpperCase(),
    enabled: true,
    roleIds,
    tokens: tokens.map((token) => ({
      label: token.label,
      status: token.status ?? "active",
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
    agents: [agent("agent_a", ["role_reader", "role_auditor"], [{ label: "p0-demo" }])],
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
    ts: "2026-10-19T00:00:00.000Z",
    permissionSnapshotHash: null,
    capabilityDigest: null,
    connectionId: "mysql_main",
    schemaName: "finance",
    sourceName: "orders",
    ...overrides
  };
}

function accessSide(
  rows: AccessMapAuditRow[],
  snapshots: Record<string, { rolesJson: unknown; resolvedJson: unknown; capabilityDigest: string | null }> = {}
): AccessMapAccessSide {
  return {
    state: "ok",
    rows,
    tokenCallCounts: new Map<string, number>(),
    tokenLastUsed: new Map<string, string>(),
    loadSnapshot: (hash: string) => {
      const found = snapshots[hash];
      if (!found) return null;
      return { hash, ...found };
    }
  };
}

function provider(
  grant: AccessMapGrantSide,
  access: AccessMapAccessSide
): AccessMapProvider {
  return {
    loadGrantSide: async () => grant,
    loadAccessSide: async () => access
  };
}

function edgeOf(
  response: Awaited<ReturnType<typeof buildAccessMap>>,
  source: string,
  target: string
) {
  const edge = response.edges.find((item) => item.source === source && item.target === target);
  if (!edge) throw new Error(`edge not found: ${source} -> ${target}`);
  return edge;
}

describe("P1-3 访问关系图 · 授权骨架（A1）", () => {
  it("区分两个 Role 的贡献：合并 sources 反推角色被禁止", async () => {
    const response = await buildAccessMap(
      provider(grantSide(), accessSide([])),
      DEFAULT_QUERY
    );

    // role_reader 贡献 2 张表，role_auditor 贡献 1 张表（同一张 orders）。
    const reader = edgeOf(response, "role:role_reader", "conn:mysql_main");
    const auditor = edgeOf(response, "role:role_auditor", "conn:mysql_main");
    expect(reader.grantPaths).toBe(2);
    expect(auditor.grantPaths).toBe(1);

    // 同一张表被两个 Role 授权 → 2 条授权路径、1 个 Agent。
    expect(response.meta.counts.grantPaths).toBe(3);
    expect(response.meta.counts.grantUsers).toBe(1);
    expect(response.meta.counts.tables).toBe(2);
  });

  it("流守恒：任一非凭证节点入流授权路径数 == 出流授权路径数", async () => {
    const grant = grantSide();
    const layer = buildGrantLayer({ side: grant, withSchema: false });
    expect(assertFlowConservation(layer)).toEqual([]);

    const response = await buildAccessMap(provider(grant, accessSide([])), DEFAULT_QUERY);
    // Agent 出流总量 == Table 入流合计 == 授权路径总数
    const agentOut = response.edges
      .filter((edge) => edge.source.startsWith("agent:"))
      .reduce((sum, edge) => sum + edge.grantPaths, 0);
    const tableIn = response.edges
      .filter((edge) => edge.target.startsWith("table:"))
      .reduce((sum, edge) => sum + edge.grantPaths, 0);
    expect(agentOut).toBe(3);
    expect(tableIn).toBe(3);
  });

  it("Schema 层展开不改变任何计数（§4.6）", async () => {
    const grant = grantSide();
    const flat = await buildAccessMap(provider(grant, accessSide([])), DEFAULT_QUERY);
    const schema = await buildAccessMap(provider(grant, accessSide([])), {
      ...DEFAULT_QUERY,
      layer: "schema"
    });
    expect(schema.meta.counts.grantPaths).toBe(flat.meta.counts.grantPaths);
    expect(schema.meta.counts.tables).toBe(flat.meta.counts.tables);
    expect(schema.nodes.filter((node) => node.kind === "schema").length).toBe(1);
    expect(flat.nodes.filter((node) => node.kind === "schema").length).toBe(0);
  });
});

describe("P1-3 访问关系图 · 访问层（A2）", () => {
  it("matched_role_id 优先，缺失时回退 role_ids，都没有则归伪节点", async () => {
    const rows = [
      auditRow({ matchedRoleId: "role_reader", roleIds: ["role_auditor"], sourceName: "orders" }),
      auditRow({ matchedRoleId: null, roleIds: ["role_auditor"], sourceName: "returns" }),
      auditRow({ matchedRoleId: null, roleIds: [], sourceName: "people" })
    ];
    const layer = buildAccessLayer({ rows, tokenLabel: null });
    const roles = layer.paths.map((path) => path.roleId).sort();
    expect(roles).toEqual(["<unresolved>", "role_auditor", "role_reader"]);

    const response = await buildAccessMap(provider(grantSide(), accessSide(rows)), DEFAULT_QUERY);
    const unresolved = response.nodes.find((node) => node.id === "role:<unresolved>");
    expect(unresolved).toBeDefined();
    expect(unresolved?.meta.unresolved).toBe(true);
  });

  it("只有 allow 进入访问内核，deny 单独计数", async () => {
    const rows = [
      auditRow({ outcome: "allow", sourceName: "orders" }),
      auditRow({ outcome: "deny", sourceName: "orders" }),
      auditRow({ outcome: "deny", sourceName: "returns" })
    ];
    const layer = buildAccessLayer({ rows, tokenLabel: null });
    expect(layer.paths.every((path) => path.calls.length > 0)).toBe(true);
    expect(layer.deniedCalls).toBe(2);
    expect(layer.rawCalls).toBe(1);
  });

  it("同一 (user, role, conn, schema, table) 去重；ts 与 token 不进路径主键", async () => {
    const rows = [
      auditRow({ callId: "c1", ts: "2026-10-19T01:00:00.000Z", tokenLabel: "p0-demo", sourceName: "orders" }),
      auditRow({ callId: "c2", ts: "2026-10-20T01:00:00.000Z", tokenLabel: "p1-other", sourceName: "orders" })
    ];
    const layer = buildAccessLayer({ rows, tokenLabel: null });
    expect(layer.paths).toHaveLength(1);
    expect(layer.paths[0].calls).toHaveLength(2);
  });
});

describe("P1-3 访问关系图 · 四口径与全局调用数（A3）", () => {
  it("授权路径数与去重 Agent 数分列，不得互相冒充", async () => {
    const response = await buildAccessMap(provider(grantSide(), accessSide([])), DEFAULT_QUERY);
    const table = response.nodes.find((node) => node.id === "table:mysql_main::finance::orders");
    // orders 被两个 Role 授权 → 2 条授权路径、1 个 Agent。
    expect(table?.meta.grantPaths).toBe(2);
    expect(table?.meta.grantUsers).toBe(1);
    expect(response.meta.counts.grantPaths).toBe(3);
    expect(response.meta.counts.grantUsers).toBe(1);
  });

  it("一次调用归属两个 Role：全局调用数按稳定 ID 去重，不做边计数相加", async () => {
    const rows = [
      auditRow({
        callId: "shared-call",
        matchedRoleId: null,
        roleIds: ["role_reader", "role_auditor"],
        sourceName: "orders"
      })
    ];
    const response = await buildAccessMap(provider(grantSide(), accessSide(rows)), DEFAULT_QUERY);
    // 一条调用展开成两条访问路径（两个 Role），但全局原始调用数仍然是 1。
    expect(response.meta.access.rawCalls).toBe(1);
    expect(response.meta.counts.accessPaths).toBe(2);
    const roleEdge = edgeOf(response, "agent:agent_a", "role:role_reader");
    expect(roleEdge.accessCalls).toBe(1);
  });
});

describe("P1-3 访问关系图 · Token 凭证清单（A4）", () => {
  it("Token 只过滤访问层，授权骨架完全不变", async () => {
    const rows = [
      auditRow({ tokenLabel: "p0-demo", sourceName: "orders" }),
      auditRow({ tokenLabel: "p1-other", sourceName: "returns" })
    ];
    const unfiltered = await buildAccessMap(provider(grantSide(), accessSide(rows)), DEFAULT_QUERY);
    const filtered = await buildAccessMap(provider(grantSide(), accessSide(rows)), {
      ...DEFAULT_QUERY,
      token: "p0-demo"
    });

    const grantEdges = (response: typeof unfiltered) =>
      response.edges.map((edge) => ({
        id: edge.id,
        grantPaths: edge.grantPaths,
        grantUsers: edge.grantUsers
      }));
    expect(grantEdges(filtered)).toEqual(grantEdges(unfiltered));

    // 访问层变了：只剩 p0-demo 产生的访问路径。
    expect(unfiltered.meta.counts.accessPaths).toBe(2);
    expect(filtered.meta.counts.accessPaths).toBe(1);
    expect(filtered.meta.access.rawCalls).toBe(1);
  });

  it("Token 不进流主干、不参与守恒", async () => {
    const response = await buildAccessMap(
      provider(grantSide(), accessSide([auditRow()])),
      DEFAULT_QUERY
    );
    const tokenNodes = response.nodes.filter((node) => node.kind === "token");
    expect(tokenNodes).toHaveLength(1);
    expect(tokenNodes[0].parentId).toBe("agent:agent_a");
    // 没有任何边连到 token 节点。
    expect(
      response.edges.some(
        (edge) => edge.source.startsWith("token:") || edge.target.startsWith("token:")
      )
    ).toBe(false);
  });
});

describe("P1-3 访问关系图 · 快照证据分档（A5/A6）", () => {
  const needsReviewGrant = grantSide({
    contributions: [
      {
        agentId: "agent_a",
        roleId: "role_reader",
        sources: [source("mysql_main", "finance", "orders")]
      }
    ],
    agents: [agent("agent_a", ["role_reader"], [{ label: "p0-demo" }])]
  });

  it("快照缺失 / 损坏 / 身份不符一律只保留需复核，不判确凿越权", async () => {
    const rows = [
      auditRow({
        callId: "missing",
        permissionSnapshotHash: "hash-missing",
        matchedRoleId: "role_ghost",
        sourceName: "secret"
      }),
      auditRow({
        callId: "corrupt",
        permissionSnapshotHash: "hash-corrupt",
        matchedRoleId: "role_ghost",
        sourceName: "secret"
      }),
      auditRow({
        callId: "mismatch",
        permissionSnapshotHash: "hash-mismatch",
        matchedRoleId: "role_ghost",
        capabilityDigest: "cap-other",
        sourceName: "secret"
      })
    ];
    const response = await buildAccessMap(
      provider(
        needsReviewGrant,
        accessSide(rows, {
          "hash-corrupt": { rolesJson: { role_ghost: {} }, resolvedJson: "not-json", capabilityDigest: null },
          "hash-mismatch": {
            rolesJson: { role_ghost: {} },
            resolvedJson: { sources: [] },
            capabilityDigest: "cap-1"
          }
        })
      ),
      DEFAULT_QUERY
    );

    expect(response.meta.signals.needsReviewEdges).toBeGreaterThan(0);
    expect(response.meta.signals.confirmedUnauthorizedEdges).toBe(0);
    // 覆盖率：0 条可关联，3 条缺失或无效。
    expect(response.meta.snapshotCoverage.reviewPaths).toBeGreaterThan(0);
    expect(response.meta.snapshotCoverage.matched).toBe(0);
    expect(response.meta.snapshotCoverage.missingOrInvalid).toBe(
      response.meta.snapshotCoverage.reviewPaths
    );
  });

  it("调用当时的快照不含该表 → 确凿越权", async () => {
    const rows = [
      auditRow({
        callId: "confirmed",
        permissionSnapshotHash: "hash-confirmed",
        matchedRoleId: "role_ghost",
        sourceName: "secret"
      })
    ];
    const response = await buildAccessMap(
      provider(
        needsReviewGrant,
        accessSide(rows, {
          "hash-confirmed": {
            rolesJson: { role_ghost: {} },
            resolvedJson: { sources: [{ connectionId: "mysql_main", schema: "finance", sourceName: "other_table" }] },
            capabilityDigest: null
          }
        })
      ),
      DEFAULT_QUERY
    );

    expect(response.meta.signals.confirmedUnauthorizedEdges).toBeGreaterThan(0);
    const reviewEdge = response.edges.find((edge) => edge.reviewEvaluations.length > 0);
    expect(reviewEdge?.reviewEvaluations[0].result).toBe("confirmed_unauthorized");
  });

  it("逐条访问路径判定：不得拿边上的一个 hash 代表全部路径", async () => {
    const rows = [
      auditRow({
        callId: "covered-call",
        permissionSnapshotHash: "hash-covered",
        matchedRoleId: "role_ghost",
        sourceName: "secret"
      }),
      auditRow({
        callId: "uncovered-call",
        permissionSnapshotHash: "hash-uncovered",
        matchedRoleId: "role_ghost",
        sourceName: "secret"
      })
    ];
    const response = await buildAccessMap(
      provider(
        needsReviewGrant,
        accessSide(rows, {
          "hash-covered": {
            rolesJson: { role_ghost: {} },
            resolvedJson: { sources: [{ connectionId: "mysql_main", schema: "finance", sourceName: "secret" }] },
            capabilityDigest: null
          },
          "hash-uncovered": {
            rolesJson: { role_ghost: {} },
            resolvedJson: { sources: [] },
            capabilityDigest: null
          }
        })
      ),
      DEFAULT_QUERY
    );

    const evaluation = response.edges
      .flatMap((edge) => edge.reviewEvaluations)
      .find((item) => item.pathKey.length > 0);
    expect(evaluation?.evidence).toHaveLength(2);
    expect(evaluation?.evidence.map((item) => item.result).sort()).toEqual([
      "confirmed_unauthorized",
      "covered_at_call_time"
    ]);
  });

  it("覆盖率披露完整：可关联数 / 需复核记录数 / 缺失数", async () => {
    // 两条不同的访问路径：一条有可用快照（当时覆盖该表），一条快照缺失。
    const rows = [
      auditRow({ callId: "ok", permissionSnapshotHash: "hash-ok", matchedRoleId: "role_ghost", sourceName: "secret" }),
      auditRow({ callId: "gone", permissionSnapshotHash: "hash-gone", matchedRoleId: "role_ghost", sourceName: "secret2" })
    ];
    const response = await buildAccessMap(
      provider(
        needsReviewGrant,
        accessSide(rows, {
          "hash-ok": {
            rolesJson: { role_ghost: {} },
            resolvedJson: { sources: [{ connectionId: "mysql_main", schema: "finance", sourceName: "secret" }] },
            capabilityDigest: null
          }
        })
      ),
      DEFAULT_QUERY
    );
    const coverage = response.meta.snapshotCoverage;
    expect(coverage.reviewPaths).toBe(2);
    expect(coverage.matched).toBe(1);
    expect(coverage.missingOrInvalid).toBe(1);
    expect(coverage.ratio).toBe(0.5);
  });

  it("同一条路径上「有快照覆盖」+「快照缺失」→ 仍只保留需复核，不判确凿越权", async () => {
    // 路径级判定取所有贡献调用的最弱证据：只要有一次调用无法取证，
    // 这条路径就不能被判成确凿越权。
    const rows = [
      auditRow({ callId: "ok", permissionSnapshotHash: "hash-ok", matchedRoleId: "role_ghost", sourceName: "secret" }),
      auditRow({ callId: "gone", permissionSnapshotHash: "hash-gone", matchedRoleId: "role_ghost", sourceName: "secret" })
    ];
    const response = await buildAccessMap(
      provider(
        needsReviewGrant,
        accessSide(rows, {
          "hash-ok": {
            rolesJson: { role_ghost: {} },
            resolvedJson: { sources: [{ connectionId: "mysql_main", schema: "finance", sourceName: "secret" }] },
            capabilityDigest: null
          }
        })
      ),
      DEFAULT_QUERY
    );
    expect(response.meta.signals.confirmedUnauthorizedEdges).toBe(0);
    expect(response.meta.snapshotCoverage.reviewPaths).toBe(1);
    expect(response.meta.snapshotCoverage.matched).toBe(0);
    expect(response.meta.snapshotCoverage.missingOrInvalid).toBe(1);
  });
});

describe("P1-3 访问关系图 · 状态判定与折叠（A7/A9）", () => {
  it("grantPaths == 0 且 accessPaths > 0 → needs_review 优先于 overflow", async () => {
    const grant = grantSide({
      contributions: [
        {
          agentId: "agent_a",
          roleId: "role_reader",
          sources: [source("mysql_main", "finance", "orders")]
        }
      ],
      agents: [agent("agent_a", ["role_reader"], [{ label: "p0-demo" }])]
    });
    const rows = [
      auditRow({ matchedRoleId: "role_ghost", sourceName: "orders" }),
      auditRow({ matchedRoleId: "role_ghost", sourceName: "returns" })
    ];
    const response = await buildAccessMap(provider(grant, accessSide(rows)), DEFAULT_QUERY);
    const ghostEdge = response.edges.find((edge) => edge.target === "role:role_ghost");
    expect(ghostEdge?.grantPaths).toBe(0);
    expect(ghostEdge?.accessPaths).toBe(2);
    expect(ghostEdge?.state).toBe("needs_review");
  });

  it("有授权无访问 → dormant（僵尸授权）", async () => {
    const response = await buildAccessMap(provider(grantSide(), accessSide([])), DEFAULT_QUERY);
    const edge = edgeOf(response, "conn:mysql_main", "table:mysql_main::finance::returns");
    expect(edge.grantPaths).toBe(1);
    expect(edge.accessPaths).toBe(0);
    expect(edge.state).toBe("dormant");
    expect(response.meta.signals.dormantEdges).toBeGreaterThan(0);
  });

  it("折叠只影响渲染：全量仍在响应里，计数不变", async () => {
    const agents: AccessMapAgentRecord[] = [];
    const contributions: AccessMapRoleContribution[] = [];
    for (let index = 0; index < 60; index += 1) {
      const agentId = `agent_${index}`;
      agents.push(agent(agentId, ["role_reader"]));
      contributions.push({
        agentId,
        roleId: "role_reader",
        sources: [
          source("mysql_main", "finance", `t${index}_a`),
          source("mysql_main", "finance", `t${index}_b`),
          source("mysql_main", "finance", `t${index}_c`),
          source("mysql_main", "finance", `t${index}_d`)
        ]
      });
    }
    const grant = grantSide({ agents, contributions });
    const response = await buildAccessMap(provider(grant, accessSide([])), DEFAULT_QUERY);

    expect(response.meta.folded.nodes).toBeGreaterThan(0);
    // 全量图仍然完整（表格等价视图读它）。
    expect(response.nodes.length).toBe(60 + 1 + 1 + 240);
    expect(response.render.nodes.length).toBeLessThan(response.nodes.length);
    // 计数不受折叠影响。
    expect(response.meta.counts.grantPaths).toBe(240);
    expect(response.meta.counts.tables).toBe(240);
  });
});

describe("P1-3 访问关系图 · 降级矩阵（A7）", () => {
  it("审计库不可用：授权骨架仍可渲染，访问层标记不可用", async () => {
    const response = await buildAccessMap(
      provider(grantSide(), { state: "unavailable", reason: "审计数据不可用" }),
      DEFAULT_QUERY
    );
    expect(response.meta.access.state).toBe("unavailable");
    expect(response.meta.grant.state).toBe("ok");
    expect(response.nodes.length).toBeGreaterThan(0);
    expect(response.render.nodes.length).toBeGreaterThan(0);
  });

  it("授权配置不可用：不渲染图，并给出三态原因", async () => {
    const grant = grantSide({
      state: "unavailable",
      problem: "access_config_path_mismatch"
    });
    const response = await buildAccessMap(provider(grant, accessSide([])), DEFAULT_QUERY);
    expect(response.meta.grant.state).toBe("unavailable");
    expect(response.meta.grant.problem).toBe("access_config_path_mismatch");
    expect(response.render.nodes).toEqual([]);
    expect(response.nodes).toEqual([]);
  });

  it("部分 Agent 解析失败 → partial 且披露失败主体", async () => {
    const grant = grantSide({
      state: "partial",
      failures: [{ subjectId: "agent_b", reason: "role_resolution_failed" }]
    });
    const response = await buildAccessMap(provider(grant, accessSide([])), DEFAULT_QUERY);
    expect(response.meta.grant.state).toBe("partial");
    expect(response.meta.grant.failures).toHaveLength(1);
  });
});

describe("P1-3 访问关系图 · URL 参数（§6.3）", () => {
  it("默认值与全部参数组合", () => {
    const parsed = parseAccessMapQuery({});
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.query.window).toBe("168h");
    expect(parsed.query.layer).toBe("flat");
    expect(parsed.query.trust).toBe("confirmed");
    expect(parsed.query.view).toBe("map");

    const full = parseAccessMapQuery({
      agent: "agent_a",
      role: "role_reader",
      token: "p0-demo",
      table: "mysql_main::finance::orders",
      connection: "mysql_main",
      window: "24h",
      layer: "schema",
      trust: "include_candidate",
      view: "table",
      focus: "agent:agent_a"
    });
    expect(full.ok).toBe(true);
    if (!full.ok) return;
    expect(full.query).toEqual({
      agent: "agent_a",
      role: "role_reader",
      token: "p0-demo",
      table: "mysql_main::finance::orders",
      connection: "mysql_main",
      window: "24h",
      layer: "schema",
      trust: "include_candidate",
      view: "table",
      focus: "agent:agent_a"
    });
  });

  it("失效的 focus 深链回到全图，不渲染空图", async () => {
    const response = await buildAccessMap(provider(grantSide(), accessSide([])), {
      ...DEFAULT_QUERY,
      focus: "agent:已经不存在"
    });
    // 空图会被误读成「这个 Agent 没有授权」，所以失效 focus 必须回退到全图。
    expect(response.nodes.length).toBeGreaterThan(0);
    expect(response.render.nodes.length).toBeGreaterThan(0);
  });

  it("非法参数值一律判为非法（路由据此返回 400）", () => {
    expect(parseAccessMapQuery({ window: "48h" }).ok).toBe(false);
    expect(parseAccessMapQuery({ layer: "wide" }).ok).toBe(false);
    expect(parseAccessMapQuery({ trust: "everything" }).ok).toBe(false);
    expect(parseAccessMapQuery({ view: "pdf" }).ok).toBe(false);
    expect(parseAccessMapQuery({ table: "not-a-table" }).ok).toBe(false);
  });

  it("表定位参数解析", () => {
    expect(splitTableParam("conn::schema::table")).toEqual({
      connectionId: "conn",
      schema: "schema",
      sourceName: "table"
    });
    expect(splitTableParam("conn::schema")).toBeNull();
  });
});

describe("P1-3 访问关系图 · 孤儿授权（§4.8）", () => {
  it("已授权但连接未启用该表 → 计入 orphanGrants，不进图面", () => {
    const orphans = countOrphanGrants({
      roleIds: ["role_reader"],
      roles: {
        role_reader: {
          allow: {
            tableSelectors: [
              { connection: "mysql_main", schema: "finance", names: ["orders", "ghost_table"] }
            ]
          }
        }
      },
      sourceMapEntries: [
        { connectionId: "mysql_main", schema: "finance", sourceName: "orders", physicalTable: "finance.orders" },
        { connectionId: "mysql_main", schema: "finance", sourceName: "ghost_table", physicalTable: "finance.ghost_table" }
      ],
      enabledTables: new Map([["mysql_main", new Set(["finance.orders"])]])
    });
    expect(orphans).toBe(1);
  });

  it("catalog_bound 不产生孤儿授权", () => {
    const orphans = countOrphanGrants({
      roleIds: ["role_catalog"],
      roles: { role_catalog: { allow: { source_scope: "catalog_bound" } } },
      sourceMapEntries: [
        { connectionId: "mysql_main", schema: "finance", sourceName: "ghost", physicalTable: "finance.ghost" }
      ],
      enabledTables: new Map([["mysql_main", new Set()]])
    });
    expect(orphans).toBe(0);
  });
});

describe("P1-3 访问关系图 · HTTP 端点（§6.1/§6.3）", () => {
  it("非法 URL 参数 → 400，不静默纠正成默认值", async () => {
    const app = Fastify();
    registerAccessMapRoutes(app, provider(grantSide(), accessSide([])));
    const res = await app.inject({ method: "GET", url: "/api/admin/access-map?window=48h" });
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("INVALID_ACCESS_MAP_PARAMETER");
    expect(body.data.param).toBe("window");
    await app.close();
  });

  it("合法参数 → 200，并按参数返回全量图与渲染子集", async () => {
    const app = Fastify();
    registerAccessMapRoutes(app, provider(grantSide(), accessSide([auditRow()])));
    const res = await app.inject({
      method: "GET",
      url: "/api/admin/access-map?window=24h&layer=schema&trust=include_candidate&view=table"
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.data.meta.access.trust).toBe("include_candidate");
    expect(body.data.nodes.length).toBeGreaterThan(0);
    expect(body.data.render.nodes.length).toBeGreaterThan(0);
    await app.close();
  });
});

describe("P1-3 访问关系图 · 真实 provider 的审计读取（SQL 口径）", () => {
  it("半开区间 [startIso, endIso)、信任口径与 token 过滤都在 SQL 里生效", async () => {
    const db = new Database(":memory:");
    db.exec(`
      CREATE TABLE access_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ts TEXT NOT NULL,
        user_id TEXT NOT NULL,
        matched_role_id TEXT,
        role_ids TEXT,
        token_label TEXT,
        tool TEXT NOT NULL DEFAULT 'lucy_query',
        eval_mark INTEGER,
        args_summary TEXT,
        outcome TEXT NOT NULL,
        permission_snapshot_hash TEXT,
        capability_digest TEXT,
        association_status TEXT
      );
      CREATE TABLE access_log_sources (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        access_log_id INTEGER NOT NULL,
        connection_id TEXT,
        schema_name TEXT,
        source_name TEXT
      );
      CREATE TABLE permission_snapshots (
        hash TEXT PRIMARY KEY,
        roles_json TEXT,
        resolved_json TEXT,
        capability_digest TEXT
      );
    `);
    const insertLog = db.prepare(
      `INSERT INTO access_log (ts, user_id, matched_role_id, role_ids, token_label, outcome,
        permission_snapshot_hash, capability_digest, association_status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    const insertSource = db.prepare(
      `INSERT INTO access_log_sources (access_log_id, connection_id, schema_name, source_name)
       VALUES (?, ?, ?, ?)`
    );

    // 窗口内、已确认、token p0
    insertLog.run("2026-10-19T00:00:00.000Z", "agent_a", "role_reader", null, "p0-demo", "allow", "snap-1", "cap-1", "confirmed");
    insertSource.run(1, "mysql_main", "finance", "orders");
    // 窗口内、候选口径（默认口径应排除）
    insertLog.run("2026-10-19T01:00:00.000Z", "agent_a", "role_reader", null, "p0-demo", "allow", "snap-1", "cap-1", "candidate");
    insertSource.run(2, "mysql_main", "finance", "returns");
    // 窗口外
    insertLog.run("2020-01-01T00:00:00.000Z", "agent_a", "role_reader", null, "p0-demo", "allow", "snap-1", "cap-1", "confirmed");
    insertSource.run(3, "mysql_main", "finance", "people");
    // 另一个 token
    insertLog.run("2026-10-19T02:00:00.000Z", "agent_a", "role_reader", null, "p1-other", "allow", "snap-1", "cap-1", "confirmed");
    insertSource.run(4, "mysql_main", "finance", "orders");
    db.prepare(
      `INSERT INTO permission_snapshots (hash, roles_json, resolved_json, capability_digest)
       VALUES (?, ?, ?, ?)`
    ).run(
      "snap-1",
      JSON.stringify({ role_reader: {} }),
      JSON.stringify({ sources: [{ connectionId: "mysql_main", schema: "finance", sourceName: "orders" }] }),
      "cap-1"
    );

    const provider = createAdminAccessMapProvider({ openAuditDb: async () => db });
    const window = { startIso: "2026-10-18T00:00:00.000Z", endIso: "2026-10-25T00:00:00.000Z", asOf: "2026-10-25T00:00:00.000Z" };

    const confirmed = await provider.loadAccessSide({ window, trust: "confirmed", tokenLabel: null });
    expect(confirmed.state).toBe("ok");
    if (confirmed.state !== "ok") return;
    const confirmedTables = confirmed.rows.map((row) => row.sourceName).sort();
    // 候选口径与窗口外记录都不进来。
    expect(confirmedTables).toEqual(["orders", "orders"]);

    const withCandidate = await provider.loadAccessSide({ window, trust: "include_candidate", tokenLabel: null });
    expect(withCandidate.state).toBe("ok");
    if (withCandidate.state !== "ok") return;
    expect(withCandidate.rows.map((row) => row.sourceName).sort()).toEqual(["orders", "orders", "returns"]);

    const tokenScoped = await provider.loadAccessSide({ window, trust: "confirmed", tokenLabel: "p0-demo" });
    expect(tokenScoped.state).toBe("ok");
    if (tokenScoped.state !== "ok") return;
    expect(tokenScoped.rows.every((row) => row.tokenLabel === "p0-demo")).toBe(true);

    // 凭证清单的调用数与 token 过滤无关（固定参照物）。
    expect(confirmed.tokenCallCounts.get("p0-demo")).toBe(1);
    expect(confirmed.tokenCallCounts.get("p1-other")).toBe(1);

    // 快照可按 hash 取回。
    const snapshot = confirmed.loadSnapshot("snap-1");
    expect(snapshot?.capabilityDigest).toBe("cap-1");
    expect(confirmed.loadSnapshot("snap-missing")).toBeNull();

    db.close();
  });

  it("审计库打不开 → 访问层不可用（授权骨架仍可渲染）", async () => {
    const provider = createAdminAccessMapProvider({
      openAuditDb: async () => {
        throw new Error("audit store unavailable");
      }
    });
    const access = await provider.loadAccessSide({
      window: { startIso: "2026-10-18T00:00:00.000Z", endIso: "2026-10-25T00:00:00.000Z", asOf: "2026-10-25T00:00:00.000Z" },
      trust: "confirmed",
      tokenLabel: null
    });
    expect(access.state).toBe("unavailable");
  });
});

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * P1-3 §10 验收映射 — 按编号命名的用例（SC-03 ～ SC-08、SC-13）。
 *
 * Authority:
 *   - webui/docs/187-access-relation-sankey-spec.md
 *     §1.3（SC-01 ～ SC-14 成功标准）、§4.4（访问内核 = 访问路径数）、
 *     §4.5（Token 凭证清单）、§4.9（越权信号的可信度边界）、
 *     §5.4（折叠）、§5.5（降级矩阵）、§6.3（URL 参数）、§10（验收映射）
 *
 * §10 逐条给出了每条 SC 的**指定验证方式**；下面每条用例都按那一条写。
 * 既有断言一行未改，这里只新增编号用例。断言的是**行为**（宽度口径、
 * 三态降级、折叠可见性、覆盖率披露），不是「函数存在」。
 * ─────────────────────────────────────────────────────────────────────────────
 */

/** 注入访问层，并给出凭证清单的统计期调用次数（Token 过滤前）。 */
function accessSideWithTokens(
  rows: AccessMapAuditRow[],
  tokenCallCounts: Record<string, number>
): AccessMapAccessSide {
  return {
    state: "ok",
    rows,
    tokenCallCounts: new Map(Object.entries(tokenCallCounts)),
    tokenLastUsed: new Map<string, string>(),
    loadSnapshot: () => null
  };
}

describe("P1-3 §10 — SC-03 访问内核宽度与僵尸授权", () => {
  it("SC-03 — 内核宽度 = 访问路径数（不是调用次数）；访问数为 0 的边为 dormant 且可被筛出", async () => {
    const rows = [
      auditRow({ callId: "c1", matchedRoleId: "role_reader", sourceName: "orders" }),
      auditRow({ callId: "c2", matchedRoleId: "role_reader", sourceName: "orders" }),
      auditRow({ callId: "c3", matchedRoleId: "role_auditor", sourceName: "orders" })
    ];
    const response = await buildAccessMap(provider(grantSide(), accessSide(rows)), DEFAULT_QUERY);

    // orders 上有 2 条访问路径（两个 Role 各一条），但发生了 3 次调用。
    // 内核宽度取访问路径数，不得取调用次数。
    const orders = edgeOf(response, "conn:mysql_main", "table:mysql_main::finance::orders");
    expect(orders.accessPaths).toBe(2);
    expect(orders.accessCalls).toBe(3);
    expect(orders.state).toBe("normal");

    // 「授权有 / 访问无」→ 内核宽度 0 + 僵尸授权态。
    const returns = edgeOf(response, "conn:mysql_main", "table:mysql_main::finance::returns");
    expect(returns.grantPaths).toBeGreaterThan(0);
    expect(returns.accessPaths).toBe(0);
    expect(returns.state).toBe("dormant");
    expect(response.meta.signals.dormantEdges).toBeGreaterThan(0);

    // 可被筛出：每条边都带状态，僵尸授权可按 state 单独挑出来。
    expect(response.edges.every((edge) => typeof edge.state === "string")).toBe(true);
    expect(response.edges.filter((edge) => edge.state === "dormant").length).toBeGreaterThan(0);
  });
});

describe("P1-3 §10 — SC-04 Token 凭证清单", () => {
  it("SC-04 — Token 挂在 Agent 下并显示 label／状态／调用次数；按 Token 过滤只动访问层", async () => {
    const rows = [
      auditRow({ tokenLabel: "p0-demo", sourceName: "orders" }),
      auditRow({ tokenLabel: "p1-other", sourceName: "returns" })
    ];
    const access = accessSideWithTokens(rows, { "p0-demo": 3, "p1-other": 1 });
    const unfiltered = await buildAccessMap(provider(grantSide(), access), DEFAULT_QUERY);
    const filtered = await buildAccessMap(provider(grantSide(), access), {
      ...DEFAULT_QUERY,
      token: "p0-demo"
    });

    // 凭证清单：挂在 Agent 节点下，显示 label、状态与统计期调用次数。
    const tokenNode = unfiltered.nodes.find((node) => node.kind === "token");
    expect(tokenNode).toBeDefined();
    expect(tokenNode?.parentId).toBe("agent:agent_a");
    expect(tokenNode?.meta.label).toBe("p0-demo");
    expect(tokenNode?.meta.status).toBe("active");
    expect(tokenNode?.meta.callCount).toBe(3);

    // 点击 Token → 访问层内核变化；授权骨架的边与 grantPaths 一字不变。
    const skeleton = (response: typeof unfiltered) =>
      response.edges.map((edge) => ({
        id: edge.id,
        grantPaths: edge.grantPaths,
        grantUsers: edge.grantUsers
      }));
    expect(skeleton(filtered)).toEqual(skeleton(unfiltered));
    expect(unfiltered.meta.counts.accessPaths).toBe(2);
    expect(filtered.meta.counts.accessPaths).toBe(1);
    expect(filtered.meta.access.rawCalls).toBe(1);
  });
});

describe("P1-3 §10 — SC-05 访问层信任口径", () => {
  it("SC-05 — 默认只统计 association_status='confirmed'；当前口径随响应发布，可切到含候选口径", async () => {
    const db = new Database(":memory:");
    db.exec(`
      CREATE TABLE access_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ts TEXT NOT NULL,
        user_id TEXT NOT NULL,
        matched_role_id TEXT,
        role_ids TEXT,
        token_label TEXT,
        tool TEXT NOT NULL DEFAULT 'lucy_query',
        eval_mark INTEGER,
        args_summary TEXT,
        outcome TEXT NOT NULL,
        permission_snapshot_hash TEXT,
        capability_digest TEXT,
        association_status TEXT
      );
      CREATE TABLE access_log_sources (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        access_log_id INTEGER NOT NULL,
        connection_id TEXT,
        schema_name TEXT,
        source_name TEXT
      );
      CREATE TABLE permission_snapshots (
        hash TEXT PRIMARY KEY,
        roles_json TEXT,
        resolved_json TEXT,
        capability_digest TEXT
      );
    `);
    const ts = new Date(Date.now() - 3_600_000).toISOString();
    const insertLog = db.prepare(
      `INSERT INTO access_log (ts, user_id, matched_role_id, role_ids, token_label, outcome,
        permission_snapshot_hash, capability_digest, association_status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    const insertSource = db.prepare(
      `INSERT INTO access_log_sources (access_log_id, connection_id, schema_name, source_name)
       VALUES (?, ?, ?, ?)`
    );
    // 已确认的一次访问。
    insertLog.run(ts, "agent_a", "role_reader", null, "p0-demo", "allow", null, null, "confirmed");
    insertSource.run(1, "mysql_main", "finance", "orders");
    // 候选口径的一次访问。
    insertLog.run(ts, "agent_a", "role_reader", null, "p0-demo", "allow", null, null, "candidate");
    insertSource.run(2, "mysql_main", "finance", "returns");

    const realProvider = createAdminAccessMapProvider({ openAuditDb: async () => db });
    const hybrid: AccessMapProvider = {
      loadGrantSide: async () => grantSide(),
      loadAccessSide: (input) => realProvider.loadAccessSide(input)
    };

    // 默认口径就是 confirmed（§6.3）。
    expect(parseAccessMapQuery({}).ok).toBe(true);
    const parsed = parseAccessMapQuery({});
    if (parsed.ok) expect(parsed.query.trust).toBe("confirmed");

    // 默认口径下候选记录不计入访问内核。
    const confirmed = await buildAccessMap(hybrid, DEFAULT_QUERY);
    expect(confirmed.meta.access.trust).toBe("confirmed");
    expect(confirmed.meta.counts.accessPaths).toBe(1);

    // 切到含候选口径后计入。
    const withCandidate = await buildAccessMap(hybrid, {
      ...DEFAULT_QUERY,
      trust: "include_candidate"
    });
    expect(withCandidate.meta.access.trust).toBe("include_candidate");
    expect(withCandidate.meta.counts.accessPaths).toBe(2);

    db.close();
  });
});

describe("P1-3 §10 — SC-07 授权面不可用时的三态降级", () => {
  it("SC-07 — 三种配置问题各自给出对应降级提示，不渲染空白图冒充正常", async () => {
    for (const problem of ["access_unreadable", "access_invalid", "access_config_path_mismatch"] as const) {
      const grant = grantSide({ state: "unavailable", problem });
      const response = await buildAccessMap(provider(grant, accessSide([])), DEFAULT_QUERY);

      // 三态原因如实发布，页面据此显示与角色权限页口径一致的提示。
      expect(response.meta.grant.state).toBe("unavailable");
      expect(response.meta.grant.problem).toBe(problem);

      // 不渲染空白图：降级时不得出一张「看起来正常的空图」。
      expect(response.render.nodes).toEqual([]);
      expect(response.nodes).toEqual([]);
      expect(response.render.edges).toEqual([]);
    }

    // 三态彼此可分：ok 出图、partial 出图并披露失败主体、unavailable 不出图。
    const ok = await buildAccessMap(provider(grantSide(), accessSide([])), DEFAULT_QUERY);
    expect(ok.meta.grant.state).toBe("ok");
    expect(ok.nodes.length).toBeGreaterThan(0);

    const partial = await buildAccessMap(
      provider(
        grantSide({ state: "partial", failures: [{ subjectId: "agent_b", reason: "role_resolution_failed" }] }),
        accessSide([])
      ),
      DEFAULT_QUERY
    );
    expect(partial.meta.grant.state).toBe("partial");
    expect(partial.meta.grant.failures).toHaveLength(1);
    expect(partial.nodes.length).toBeGreaterThan(0);
  });
});

describe("P1-3 §10 — SC-08 规模预算与折叠", () => {
  it("SC-08 — 超过渲染预算时自动折叠，折叠数量显式可见且全量图仍可展开", async () => {
    const agents: AccessMapAgentRecord[] = [];
    const contributions: AccessMapRoleContribution[] = [];
    for (let index = 0; index < 40; index += 1) {
      const agentId = `agent_${index}`;
      agents.push(agent(agentId, ["role_reader"]));
      contributions.push({
        agentId,
        roleId: "role_reader",
        sources: ["t0_a", "t0_b", "t0_c", "t0_d", "t0_e"].map((name) =>
          source("mysql_main", "finance", `${name}_${index}`)
        )
      });
    }
    const response = await buildAccessMap(
      provider(grantSide({ agents, contributions }), accessSide([])),
      DEFAULT_QUERY
    );

    // 242 个节点（40 Agent + 1 Role + 1 连接 + 200 表）超过 150 的节点预算。
    expect(response.nodes.length).toBe(40 + 1 + 1 + 200);
    expect(response.meta.folded.nodes).toBeGreaterThan(0);
    expect(response.render.nodes.length).toBeLessThan(response.nodes.length);

    // 折叠数量显式可见：被折叠的节点并入同层的「其他（N）」。
    const other = response.render.nodes.find((node) => node.label.startsWith("其他（"));
    expect(other).toBeDefined();
    expect(other?.label).toMatch(/^其他（\d+）$/);

    // 全量图仍在响应里（表格等价视图读它）→ 可展开。
    expect(response.nodes.filter((node) => node.kind === "table")).toHaveLength(200);

    // 折叠只影响渲染：一个计数口径都没改。
    expect(response.meta.counts.grantPaths).toBe(200);
    expect(response.meta.counts.tables).toBe(200);
  });
});

describe("P1-3 §10 — SC-13 快照覆盖率披露", () => {
  it("SC-13 — 披露可关联数／总数／缺失数与覆盖率；缺失快照不判确凿越权，低覆盖率不等于低越权率", async () => {
    const grant = grantSide({
      contributions: [
        {
          agentId: "agent_a",
          roleId: "role_reader",
          sources: [source("mysql_main", "finance", "orders")]
        }
      ],
      agents: [agent("agent_a", ["role_reader"], [{ label: "p0-demo" }])]
    });
    // 三条需复核路径：一条当时被快照覆盖，两条快照缺失。
    const rows = [
      auditRow({
        callId: "ok",
        permissionSnapshotHash: "hash-ok",
        matchedRoleId: "role_ghost",
        sourceName: "secret1"
      }),
      auditRow({
        callId: "gone-1",
        permissionSnapshotHash: "hash-gone-1",
        matchedRoleId: "role_ghost",
        sourceName: "secret2"
      }),
      auditRow({
        callId: "gone-2",
        permissionSnapshotHash: "hash-gone-2",
        matchedRoleId: "role_ghost",
        sourceName: "secret3"
      })
    ];
    const response = await buildAccessMap(
      provider(
        grant,
        accessSide(rows, {
          "hash-ok": {
            rolesJson: { role_ghost: {} },
            resolvedJson: {
              sources: [{ connectionId: "mysql_main", schema: "finance", sourceName: "secret1" }]
            },
            capabilityDigest: null
          }
        })
      ),
      DEFAULT_QUERY
    );

    // 覆盖率披露完整：可关联数 / 需复核记录总数 / 缺失数 / 覆盖率。
    const coverage = response.meta.snapshotCoverage;
    expect(coverage.reviewPaths).toBe(3);
    expect(coverage.matched).toBe(1);
    expect(coverage.missingOrInvalid).toBe(2);
    expect(coverage.ratio).toBeCloseTo(1 / 3, 10);

    // 缺失／无效快照不判确凿越权。
    expect(response.meta.signals.confirmedUnauthorizedEdges).toBe(0);

    // 低覆盖率不得解释为低越权率：两条无法取证的路径既没有消失，
    // 也没有被按覆盖率折算成「越权率 1/3」。
    expect(coverage.missingOrInvalid).toBe(2);
    expect(response.meta.signals.needsReviewEdges).toBeGreaterThan(0);
    expect(response.meta.signals.confirmedUnauthorizedEdges).not.toBe(coverage.ratio);
  });
});
