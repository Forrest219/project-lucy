/**
 * Spec lucy-20261117-access-map-sankey-restoration — D3／SC-A4（服务端折叠部分）。
 * 每列可见节点不超过 COLUMN_NODE_CAP，余者并入同层「其他（n）」；折叠只影响渲染。
 */
import { describe, expect, it } from "vitest";
import {
  buildGrantLayer,
  COLUMN_NODE_CAP,
  foldAccessMapGraph,
  type AccessMapGrantSide
} from "../admin/access-map.js";

function manyAgents(count: number): AccessMapGrantSide {
  return {
    state: "ok",
    problem: null,
    failures: [],
    identity: {
      configVersion: "cfg",
      policyVersion: "pol",
      sourceMapVersion: "smap",
      capabilityDigest: "cap"
    },
    agents: Array.from({ length: count }, (_, index) => ({
      id: `agent_${String(index).padStart(2, "0")}`,
      name: `Agent ${index}`,
      enabled: true,
      roleIds: ["role_reader"],
      tokens: []
    })),
    contributions: Array.from({ length: count }, (_, index) => ({
      agentId: `agent_${String(index).padStart(2, "0")}`,
      roleId: "role_reader",
      sources: [
        {
          connectionId: "mysql_main",
          schema: "finance",
          sourceName: "orders",
          physicalTable: "finance.orders"
        }
      ]
    })),
    orphanGrants: 0,
    enabledConnections: ["mysql_main"]
  };
}

function graphWithUsage(count: number) {
  const layer = buildGrantLayer({ side: manyAgents(count), withSchema: false });
  const agents = [...layer.nodes.values()]
    .filter((node) => node.kind === "agent")
    .sort((a, b) => a.id.localeCompare(b.id));
  // agent_00 使用最少，agent_(count-1) 使用最多。
  agents.forEach((node, index) => {
    node.accessPaths = index + 1;
  });
  return { nodes: [...layer.nodes.values()], edges: [...layer.edges.values()], agents };
}

describe("access-map · 每列节点上限（D3／SC-A4）", () => {
  it("COLUMN_NODE_CAP 取值为 24", () => {
    expect(COLUMN_NODE_CAP).toBe(24);
  });

  it("42 个 Agent：保留使用最多的 24 个，余 18 个并入 1 个「其他（18）」", () => {
    const graph = graphWithUsage(42);
    const folded = foldAccessMapGraph({ nodes: graph.nodes, edges: graph.edges });

    const agentColumn = folded.nodes.filter((node) => node.depth === 0 && node.kind === "agent");
    expect(agentColumn.length).toBe(COLUMN_NODE_CAP + 1);

    const other = agentColumn.find((node) => node.label.startsWith("其他"));
    expect(other?.label).toBe("其他（18）");
    expect(other?.meta.foldedMemberIds).toHaveLength(18);

    // 受害序：使用最少者先折（agent_00…agent_17），使用最多的 agent_41 必须保留。
    expect(other?.meta.foldedMemberIds).toContain("agent:agent_00");
    expect(other?.meta.foldedMemberIds).not.toContain("agent:agent_41");
    expect(agentColumn.some((node) => node.id === "agent:agent_41")).toBe(true);

    // 守恒：折叠只改渲染，「其他」的使用路径数 = 被折成员之和。
    const expectedAccess = Array.from({ length: 18 }, (_, i) => i + 1).reduce((a, b) => a + b, 0);
    expect(other?.accessPaths).toBe(expectedAccess);
    expect(folded.folded.nodes).toBe(18);
  });

  it("不超过上限的列不折叠", () => {
    const graph = graphWithUsage(24);
    const folded = foldAccessMapGraph({ nodes: graph.nodes, edges: graph.edges });
    expect(folded.folded.nodes).toBe(0);
    expect(folded.nodes.length).toBe(graph.nodes.length);
  });

  it("折叠后「其他」到 Role 的边合并了被折成员的授权路径", () => {
    const graph = graphWithUsage(30);
    const folded = foldAccessMapGraph({ nodes: graph.nodes, edges: graph.edges });
    const other = folded.nodes.find((node) => node.id.startsWith("other:agent"));
    expect(other).toBeDefined();
    const edge = folded.edges.find(
      (item) => item.source === other?.id && item.target === "role:role_reader"
    );
    expect(edge?.grantPaths).toBe(6);
  });
});
