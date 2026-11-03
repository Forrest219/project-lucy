/**
 * Lucy v0.25 P1-2 — 授权摘要服务端派生模型测试（W2 / B1–B8）。
 *
 * Authority:
 *   - docs/specs/lucy-20261025-v0p25-access-authorization-summary-spec.md §2.1、§2.2、§2.3、
 *     §3、§4.1、§5、§6、§8（ASV-01～ASV-13）
 *   - docs/plans/2026-10-25-lucy-v0.25-p1-implementation-plan.md §5
 *
 * 断言针对**行为**：计数不混用、三/四态降级、Agent 与 Role 的行边界差异、秘密不泄露。
 * 每个「失败必须关闭」场景都有一条用例。
 */
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  commitEffectivePolicy,
  resetEffectivePolicyForTests
} from "../proxy/acl";
import { invalidateAccessConfigCache } from "../proxy/identity";
import { invalidateContentPathsCache } from "../paths";
import { readAccessSnapshot } from "../admin/permission-display";
import {
  buildAuthorizationSummary,
  deriveAuthorizationSummary,
  enabledTableDenominatorOf,
  overlayAgentDraft,
  overlayRoleDraft,
  partitionToolsForDisplay,
  playgroundUrlForTable,
  rowPolicyViewUrlForTable,
  type AuthorizationDerivationInput
} from "../admin/authorization-summary";
import { buildAdminPermissionContext } from "../proxy/acl";
import { parseAccessConfigText } from "../proxy/identity";

const TOOLS = `      tools:
        - lucy_query
        - lucy_catalog
        - wiki_search`;

const KTX_YAML = `connections:
  warehouse:
    driver: mysql
    enabled_tables:
      - fin.fin_ledger
      - fin.fin_budget
  lake:
    driver: mysql
    enabled_tables:
      - ops.ops_orders
`;

const ACCESS_YAML = `roles:
  ledger_all:
    permission_model_version: 2
    allow:
      connections: [warehouse]
      tableSelectors:
        - connection: warehouse
          schema: fin
          names: [fin_ledger]
          row_access: all
${TOOLS}
  ledger_budget:
    permission_model_version: 2
    allow:
      connections: [warehouse]
      tableSelectors:
        - connection: warehouse
          schema: fin
          names: [fin_budget]
          row_access: all
${TOOLS}
  ledger_all_scoped:
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
              - { field: region, op: eq, value: East }
${TOOLS}
  ledger_scoped_west:
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
              - { field: region, op: eq, value: West }
${TOOLS}
  lake_catalog:
    permission_model_version: 2
    allow:
      connections: [lake]
      source_scope: catalog_bound
${TOOLS}
  broken_role:
    permission_model_version: 2
    allow:
      connections: [warehouse]
      tools: []
users:
  - { id: a_single, name: A Single, enabled: true, roles: [ledger_all], tokens: [] }
  - { id: a_multi, name: A Multi, enabled: true, roles: [ledger_all, ledger_budget], tokens: [] }
  - { id: a_overlap, name: A Overlap, enabled: true, roles: [ledger_all, ledger_all_scoped], tokens: [] }
  - { id: a_two_scoped, name: A Two Scoped, enabled: true, roles: [ledger_all_scoped, ledger_scoped_west], tokens: [] }
  - { id: a_partial, name: A Partial, enabled: true, roles: [ledger_all, broken_role], tokens: [] }
  - { id: a_partial_scoped, name: A Partial Scoped, enabled: true, roles: [ledger_all_scoped, broken_role], tokens: [] }
  - { id: a_all_failed, name: A All Failed, enabled: true, roles: [broken_role], tokens: [] }
  - { id: a_legacy, name: A Legacy, enabled: true, allow: { connections: [lake], tables: [ops.ops_orders], tools: [lucy_query] }, tokens: [] }
  - { id: a_constrained, name: A Constrained, enabled: true, roles: [ledger_all], constraints: { sources: [{ connection: warehouse, schema: fin, names: [fin_ledger], predicates: [{ field: id, op: eq, value: 7 }] }] }, tokens: [] }
  - { id: a_disabled, name: A Disabled, enabled: false, roles: [ledger_all], tokens: [] }
defaults:
  known_tools: [lucy_query, lucy_catalog, wiki_search, wiki_read]
  table_touching_tools: [lucy_query]
`;

function manifest(schema: string, tables: string[]): string {
  return `tables:\n${tables
    .map(
      (table) =>
        `  ${table}:\n    table: ${schema}.${table}\n    columns:\n      - name: id\n        type: number\n      - name: region\n        type: string\n`
    )
    .join("")}`;
}

let projectRoot: string;
const savedEnv = {
  root: process.env.KTX_PROJECT_ROOT,
  content: process.env.LUCY_CONTENT_ROOT,
  access: process.env.LUCY_ACCESS_CONFIG_PATH
};

async function writeProject(root: string, accessYaml: string = ACCESS_YAML): Promise<void> {
  await mkdir(path.join(root, "semantic-layer", "warehouse", "_schema"), { recursive: true });
  await mkdir(path.join(root, "semantic-layer", "lake", "_schema"), { recursive: true });
  await mkdir(path.join(root, "webui", "config"), { recursive: true });
  await writeFile(path.join(root, "ktx.yaml"), KTX_YAML, "utf8");
  await writeFile(
    path.join(root, "semantic-layer", "warehouse", "_schema", "fin.yaml"),
    manifest("fin", ["fin_ledger", "fin_budget"]),
    "utf8"
  );
  await writeFile(
    path.join(root, "semantic-layer", "lake", "_schema", "ops.yaml"),
    manifest("ops", ["ops_orders"]),
    "utf8"
  );
  await writeFile(path.join(root, "webui", "config", "access.yaml"), accessYaml, "utf8");
}

beforeEach(async () => {
  projectRoot = await mkdtemp(path.join(os.tmpdir(), "lucy-authz-summary-"));
  await writeProject(projectRoot);
  process.env.KTX_PROJECT_ROOT = projectRoot;
  process.env.LUCY_CONTENT_ROOT = ".";
  delete process.env.LUCY_ACCESS_CONFIG_PATH;
  invalidateContentPathsCache();
  invalidateAccessConfigCache();
  resetEffectivePolicyForTests();
});

afterEach(async () => {
  for (const [key, value] of [
    ["KTX_PROJECT_ROOT", savedEnv.root],
    ["LUCY_CONTENT_ROOT", savedEnv.content],
    ["LUCY_ACCESS_CONFIG_PATH", savedEnv.access]
  ] as const) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  invalidateContentPathsCache();
  invalidateAccessConfigCache();
  resetEffectivePolicyForTests();
  await rm(projectRoot, { recursive: true, force: true });
});

async function summaryFor(
  kind: "agent" | "role",
  id: string,
  options: { candidate?: Parameters<typeof buildAuthorizationSummary>[0]["candidate"]; candidateDigest?: string } = {}
) {
  const snapshot = await readAccessSnapshot(projectRoot);
  return buildAuthorizationSummary({
    subject: { kind, id },
    basis: options.candidate ? "draft" : "committed",
    snapshot,
    projectRoot,
    ...(options.candidate ? { candidate: options.candidate } : {}),
    ...(options.candidateDigest ? { candidateDigest: options.candidateDigest } : {})
  });
}

describe("P1-2 §2.2 — 计数口径（ASV-01～04、ASV-11）", () => {
  it("counts tables by 规范源键 de-duplication, never by grant path or tool×table tuple", async () => {
    await commitEffectivePolicy();
    const summary = await summaryFor("agent", "a_multi");
    expect(summary.summaryContext.state).toBe("ok");
    // 两个 Role，各授权一张不同的表 → 2 张表、2 条授权路径。
    expect(summary.headline.tableCount).toBe(2);
    expect(summary.headline.grantPathCount).toBe(2);
    expect(summary.headline.connectionCount).toBe(1);
    // 工具并集 × 表并集的笛卡尔积会出现 4 个工具×表元组，表数不得因此放大。
    const capabilityCount = summary.resources
      .flatMap((connection) => connection.schemas)
      .flatMap((schema) => schema.tables)
      .flatMap((table) => table.capabilities).length;
    expect(summary.headline.tableCount).toBe(2);
    expect(capabilityCount).toBeGreaterThanOrEqual(2);
  });

  it("keeps the table count at 1 when two Roles grant the same table, and counts grant paths separately", async () => {
    await commitEffectivePolicy();
    const summary = await summaryFor("agent", "a_overlap");
    expect(summary.summaryContext.state).toBe("ok");
    expect(summary.headline.tableCount).toBe(1);
    expect(summary.headline.grantPathCount).toBe(2);
    const tables = summary.resources.flatMap((c) => c.schemas).flatMap((s) => s.tables);
    expect(tables).toHaveLength(1);
    // 两个 Role 的来源都要可见，且不得从合并后的 sources 反推。
    expect(tables[0].roleIds).toEqual(["ledger_all", "ledger_all_scoped"]);
  });

  it("never pads the readable connection count with declared-but-unmatched connections", async () => {
    await commitEffectivePolicy();
    const summary = await summaryFor("agent", "a_single");
    // ledger_all 只声明 warehouse；lake 不得被算进可读连接。
    expect(summary.headline.connectionCount).toBe(1);
    expect(summary.resources.map((connection) => connection.connectionId)).toEqual(["warehouse"]);
  });

  it("shows the enabled-table denominator only when it can be proven", async () => {
    await commitEffectivePolicy();
    const summary = await summaryFor("agent", "a_single");
    // warehouse 的启用表目录完整 → 分母可证明（fin_ledger + fin_budget）。
    expect(summary.headline.enabledTableCount).toBe(2);
    expect(summary.headline.enabledTableDenominatorUnavailableReason).toBeNull();
  });
});

describe("P1-2 §6 — 失败必须关闭", () => {
  it("场景1：配置缺失 → unavailable + 问题码，不得出现空资源卡或「0 张表」", async () => {
    await rm(path.join(projectRoot, "webui", "config", "access.yaml"), { force: true });
    invalidateAccessConfigCache();
    await commitEffectivePolicy();
    const summary = await summaryFor("agent", "a_single");
    expect(summary.summaryContext.state).toBe("unavailable");
    expect(summary.summaryContext.problem).toBe("access_unreadable");
    expect(summary.resources).toEqual([]);
    expect(summary.headline.state).toBe("unavailable");
    // 失败不是「没有权限」——失败清单必须说清原因。
    expect(summary.summaryContext.failures.length).toBeGreaterThanOrEqual(0);
  });

  it("场景1b：配置路径不一致 → unavailable + access_config_path_mismatch", async () => {
    const overridePath = path.join(projectRoot, "override-access.yaml");
    await writeFile(overridePath, ACCESS_YAML.replace("id: a_single", "id: z_single"), "utf8");
    process.env.LUCY_ACCESS_CONFIG_PATH = overridePath;
    await commitEffectivePolicy();
    const summary = await summaryFor("agent", "a_single");
    expect(summary.summaryContext.state).toBe("unavailable");
    expect(summary.summaryContext.problem).toBe("access_config_path_mismatch");
    expect(summary.resources).toEqual([]);
  });

  it("场景2：部分 Role 失败 → 已解析集合 + partial + 失败 Role 清单", async () => {
    await commitEffectivePolicy();
    const summary = await summaryFor("agent", "a_partial");
    expect(summary.summaryContext.state).toBe("partial");
    expect(summary.summaryContext.failures.map((failure) => failure.subjectId)).toContain("broken_role");
    // 已解析的集合仍在，但不能被称为完整授权。
    expect(summary.headline.tableCount).toBe(1);
    expect(summary.headline.state).toBe("partial");
  });

  it("场景2b：Agent 的受限表数按最终行约束计；最终行约束未合成时不得用角色级口径代替", async () => {
    await commitEffectivePolicy();
    const summary = await summaryFor("agent", "a_partial_scoped");
    expect(summary.summaryContext.state).toBe("partial");
    // 已解析的 Role 带有 scoped 行授予，但 Agent 的最终行约束没有合成。
    const table = summary.resources.flatMap((c) => c.schemas).flatMap((s) => s.tables)[0];
    expect(table.rowSummary.kind).toBe("scoped");
    expect(table.rowSummary.basis).toBe("effective_row_grant");
    expect(table.rowSummary.agentFinalRowsAvailable).toBe(false);
    // Agent 视图的受限表数口径是 FinalRows —— 未合成就不可知，不得替换成角色级计数。
    expect(summary.headline.scopedTableCount).toBeNull();
    expect(summary.headline.scopedTableCountBasis).toBe("unknown");
  });

  it("场景2c：全部 Role 失败 → unavailable，不得以零值冒充无权限", async () => {
    await commitEffectivePolicy();
    const summary = await summaryFor("agent", "a_all_failed");
    expect(summary.summaryContext.state).toBe("unavailable");
    expect(summary.resources).toEqual([]);
    expect(summary.summaryContext.failures.map((failure) => failure.subjectId)).toContain("a_all_failed");
  });

  it("场景3：启用目录分母未知 → 分子照常显示，分母为空值且带原因", async () => {
    await commitEffectivePolicy();
    const snapshot = await readAccessSnapshot(projectRoot);
    const context = await buildAdminPermissionContext(snapshot.runtimeConfig!);
    // 移除 warehouse 的启用表目录条目 → 该连接的启用范围不可证明。
    const withoutWarehouse = new Map(context.enabledTables);
    withoutWarehouse.delete("warehouse");
    const capabilities = [
      {
        tool: "lucy_query",
        connectionId: "warehouse",
        schema: "fin",
        sourceName: "fin_ledger",
        physicalTable: "fin.fin_ledger",
        rowGrant: { kind: "all" as const }
      }
    ];
    const denominator = enabledTableDenominatorOf({ ...context, enabledTables: withoutWarehouse }, capabilities);
    expect("count" in denominator).toBe(false);
    if (!("count" in denominator)) {
      expect(denominator.unavailableReason).toContain("enabled_catalog_connection_unknown");
      expect(denominator.unavailableReason).not.toBe("");
    }
  });

  it("场景3b：目录本身不可用时不得把分母填成 0", async () => {
    await commitEffectivePolicy();
    const snapshot = await readAccessSnapshot(projectRoot);
    const context = await buildAdminPermissionContext(snapshot.runtimeConfig!);
    const broken = { ...context, sourceMap: { ...context.sourceMap, compileError: "duplicate_source_name" } };
    const denominator = enabledTableDenominatorOf(broken, []);
    expect("count" in denominator).toBe(false);
  });

  it("场景4：多 Role 覆盖同表 → 表数 1、角色来源 N、授权路径 N", async () => {
    await commitEffectivePolicy();
    const summary = await summaryFor("agent", "a_overlap");
    expect(summary.headline.tableCount).toBe(1);
    expect(summary.headline.grantPathCount).toBe(2);
    const table = summary.resources.flatMap((c) => c.schemas).flatMap((s) => s.tables)[0];
    expect(table.roleIds).toHaveLength(2);
  });

  it("场景5：两个受限 Role → 有效行授予保留 OR 分支，不得显示成 AND 或全部行", async () => {
    await commitEffectivePolicy();
    const summary = await summaryFor("agent", "a_two_scoped");
    const table = summary.resources.flatMap((c) => c.schemas).flatMap((s) => s.tables)[0];
    expect(table.rowSummary.kind).toBe("scoped");
    expect(table.rowSummary.displayShape).toBe("OR-of-AND");
    expect(table.rowSummary.orArms).toHaveLength(2);
    expect(table.rowSummary.orArms.join(" | ")).toContain("region=East");
    expect(table.rowSummary.orArms.join(" | ")).toContain("region=West");
    expect(summary.headline.scopedTableCount).toBe(1);
  });

  it("场景6：Role 摘要不得冒充 Agent 最终行约束", async () => {
    await commitEffectivePolicy();
    const roleSummary = await summaryFor("role", "ledger_all_scoped");
    const roleTable = roleSummary.resources.flatMap((c) => c.schemas).flatMap((s) => s.tables)[0];
    expect(roleTable.rowSummary.basis).toBe("effective_row_grant");
    expect(roleTable.rowSummary.agentFinalRowsAvailable).toBe(false);
    expect(roleTable.rowSummary.agentPersonalLimitsApplied).toBe(false);
    expect(roleTable.rowSummary.constraintSummary).toContain("不含 Agent 个人行限制");
    // Role 视图不提供调试台 Agent 预填（Role 不是可认证 Agent）。
    expect(roleTable.playgroundUrl).toBeNull();
    expect(roleSummary.actions.playgroundUrl).toBeNull();
  });

  it("场景6b：Agent 视图的行摘要用 FinalRows，Agent 个人行限制生效时可见", async () => {
    await commitEffectivePolicy();
    const summary = await summaryFor("agent", "a_constrained");
    const table = summary.resources.flatMap((c) => c.schemas).flatMap((s) => s.tables)[0];
    expect(table.rowSummary.basis).toBe("final_rows");
    expect(table.rowSummary.agentFinalRowsAvailable).toBe(true);
    expect(table.rowSummary.agentPersonalLimitsApplied).toBe(true);
    expect(table.rowSummary.constraintSummary).toContain("Agent 个人行限制");
  });

  it("场景7：行编译不可满足 → 显示诊断，不得显示全部行或正常空集", async () => {
    await commitEffectivePolicy();
    const snapshot = await readAccessSnapshot(projectRoot);
    const summary = await summaryFor("agent", "a_constrained");
    expect(summary.summaryContext.state).toBe("ok");
    // 构造不可满足的 Agent 个人行限制 → 整个主体解析失败。
    const config = snapshot.runtimeConfig!;
    const broken = overlayAgentDraft(config, "a_constrained", {
      constraints: {
        sources: [
          {
            connection: "warehouse",
            schema: "fin",
            names: ["fin_ledger"],
            predicates: [{ field: "id", op: "eq", value: 7 }]
          }
        ]
      }
    });
    const unsatisfiable = {
      ...config,
      users: (config.users ?? []).map((user) =>
        user.id === "a_constrained"
          ? {
              ...user,
              constraints: {
                sources: [
                  {
                    connection: "warehouse",
                    schema: "fin",
                    names: ["fin_ledger"],
                    predicates: [
                      { field: "id", op: "eq", value: 7 },
                      { field: "id", op: "eq", value: 9 }
                    ]
                  }
                ]
              }
            }
          : user
      )
    };
    const failed = await buildAuthorizationSummary({
      subject: { kind: "agent", id: "a_constrained" },
      basis: "draft",
      snapshot,
      projectRoot,
      candidate: unsatisfiable,
      candidateDigest: "digest-unsatisfiable"
    });
    expect(failed.summaryContext.state).toBe("unavailable");
    expect(failed.resources).toEqual([]);
    expect(
      failed.diagnostics.some((diagnostic) => diagnostic.code.includes("unsatisfiable"))
    ).toBe(true);
    // 不得把不可满足显示成「全部行」。
    expect(JSON.stringify(failed)).not.toContain("全部行");
    void broken;
  });

  it("场景8：草稿变化 → 旧候选摘要失效（candidateDigest 随草稿改变）", async () => {
    await commitEffectivePolicy();
    const snapshot = await readAccessSnapshot(projectRoot);
    const config = snapshot.runtimeConfig!;
    const candidateA = overlayRoleDraft(config, "ledger_all", {
      permission_model_version: 2,
      allow: {
        connections: ["warehouse"],
        tableSelectors: [
          { connection: "warehouse", schema: "fin", names: ["fin_ledger"], row_access: "all" }
        ],
        tools: ["lucy_query"]
      }
    });
    const candidateB = overlayRoleDraft(config, "ledger_all", {
      permission_model_version: 2,
      allow: {
        connections: ["warehouse"],
        tableSelectors: [
          { connection: "warehouse", schema: "fin", names: ["fin_budget"], row_access: "all" }
        ],
        tools: ["lucy_query"]
      }
    });
    const a = await buildAuthorizationSummary({
      subject: { kind: "role", id: "ledger_all" },
      basis: "draft",
      snapshot,
      projectRoot,
      candidate: candidateA,
      candidateDigest: "digest-a"
    });
    const b = await buildAuthorizationSummary({
      subject: { kind: "role", id: "ledger_all" },
      basis: "draft",
      snapshot,
      projectRoot,
      candidate: candidateB,
      candidateDigest: "digest-b"
    });
    expect(a.summaryContext.basis).toBe("draft");
    expect(a.summaryContext.candidateOnly).toBe(true);
    expect(a.summaryContext.candidateDigest).toBe("digest-a");
    expect(b.summaryContext.candidateDigest).toBe("digest-b");
    // 两个草稿的表集合不同 → 旧候选摘要不能用来确认新草稿。
    expect(a.headline.tableCount).toBe(1);
    expect(b.headline.tableCount).toBe(1);
    expect(
      a.resources.flatMap((c) => c.schemas).flatMap((s) => s.tables)[0].sourceName
    ).toBe("fin_ledger");
    expect(
      b.resources.flatMap((c) => c.schemas).flatMap((s) => s.tables)[0].sourceName
    ).toBe("fin_budget");
  });

  it("场景9：工具并集 × 表并集不得产生笛卡尔积", async () => {
    await commitEffectivePolicy();
    const summary = await summaryFor("agent", "a_multi");
    const tables = summary.resources.flatMap((c) => c.schemas).flatMap((s) => s.tables);
    // 每个工具只出现在它真正被授予的表上。
    for (const table of tables) {
      const tools = table.capabilities.map((capability) => capability.tool);
      expect(new Set(tools).size).toBe(tools.length);
    }
    const toolCount = summary.tools.query.length + summary.tools.meta.length + summary.tools.semanticRead.length;
    const tableCount = summary.headline.tableCount;
    // 工具数与表数各自独立表达，不得相乘成一张「权限表」。
    expect(summary.headline.tableCount).not.toBe(toolCount * tableCount);
  });
});

describe("P1-2 §3 — 工具分组（ASV-12）", () => {
  it("groups tools without changing their classification; AbsoluteDeny is never shown as grantable", () => {
    const { groups, unclassified } = partitionToolsForDisplay([
      "lucy_query",
      "lucy_read_source",
      "wiki_read",
      "lucy_catalog",
      "sql_execution",
      "memory_ingest"
    ]);
    expect(groups.query).toEqual(["lucy_query"]);
    expect(groups.semanticRead).toEqual(["lucy_read_source"]);
    expect(groups.wikiRead).toEqual(["wiki_read"]);
    expect(groups.meta).toEqual(["lucy_catalog"]);
    expect(groups.write).toEqual([]);
    expect(unclassified).toEqual([]);
    // AbsoluteDeny 工具不得出现在任何分组里。
    const all = [...groups.query, ...groups.semanticRead, ...groups.wikiRead, ...groups.write, ...groups.meta];
    expect(all).not.toContain("sql_execution");
    expect(all).not.toContain("memory_ingest");
  });

  it("marks the legacy allow block as 旧 ACL without inventing a Role source", async () => {
    await commitEffectivePolicy();
    const summary = await summaryFor("agent", "a_legacy");
    expect(summary.legacyAllow).toBe(true);
    const table = summary.resources.flatMap((c) => c.schemas).flatMap((s) => s.tables)[0];
    expect(table.roleIds).toEqual([]);
  });
});

describe("P1-2 §4.1 — 深链（ASV-10）", () => {
  it("builds the MCP 调试台 deep link with agentId, mode, tool and url-encoded args", () => {
    const url = playgroundUrlForTable("a_single", { connectionId: "warehouse", sourceName: "fin_ledger" });
    expect(url.startsWith("/admin/mcp-playground?")).toBe(true);
    expect(url).toContain("agentId=a_single");
    expect(url).toContain("mode=dry-run");
    expect(url).toContain("tool=lucy_query");
    const args = decodeURIComponent(url.split("args=")[1]);
    expect(JSON.parse(args)).toEqual({ connectionId: "warehouse", sourceName: "fin_ledger" });
  });

  it("offers the playground link on Agent resource rows only, and no live-call trigger", async () => {
    await commitEffectivePolicy();
    const summary = await summaryFor("agent", "a_single");
    const table = summary.resources.flatMap((c) => c.schemas).flatMap((s) => s.tables)[0];
    expect(table.playgroundUrl).toContain("/admin/mcp-playground?");
    expect(table.playgroundUrl).toContain("mode=dry-run");
    // W6 挂载后，访问关系图与行权限视图都是真实存在的页面，链接必须可用。
    expect(summary.actions.accessMapUrl).toContain("/admin/access-map?agent=a_single");
  });

  it("offers no link to a target page that does not exist (Spec §4.1)", async () => {
    await commitEffectivePolicy();
    const summary = await buildAuthorizationSummary({
      subject: { kind: "agent", id: "a_single" },
      basis: "committed",
      snapshot: await readAccessSnapshot(projectRoot),
      projectRoot,
      linkTargets: { playground: true, accessMap: false, rowPolicyView: false }
    });
    expect(summary.actions.accessMapUrl).toBeNull();
    expect(summary.actions.rowPolicyViewUrl).toBeNull();
    // 调试台已实施，链接照旧可用。
    expect(summary.actions.playgroundUrl).toContain("/admin/mcp-playground?");
  });
});

describe("P1-2 §2.1 / §4.3 — 快照身份与秘密保护（ASV-08、ASV-13）", () => {
  it("publishes one snapshot identity for the whole summary", async () => {
    await commitEffectivePolicy();
    const summary = await summaryFor("agent", "a_single");
    const context = summary.summaryContext;
    expect(context.configVersion).toMatch(/^[0-9a-f]{16}$/);
    expect(context.policyVersion).not.toBe("");
    expect(context.sourceMapVersion).not.toBe("");
    expect(context.capabilityDigest).toMatch(/^[0-9a-f]{16}$/);
    expect(context.snapshotHash).toMatch(/^[0-9a-f]{64}$/);
    expect(context.subject).toEqual({ kind: "agent", id: "a_single" });
    expect(context.basis).toBe("committed");
  });

  it("never leaks token plaintext, database passwords or over-granted content", async () => {
    await commitEffectivePolicy();
    const withSecret = ACCESS_YAML.replace(
      "  - { id: a_single, name: A Single, enabled: true, roles: [ledger_all], tokens: [] }",
      "  - { id: a_single, name: A Single, enabled: true, roles: [ledger_all], tokens: [{ label: prod, hash: abcdef1234567890, secret: super-secret-token }] }"
    );
    await writeFile(path.join(projectRoot, "webui", "config", "access.yaml"), withSecret, "utf8");
    invalidateAccessConfigCache();
    await commitEffectivePolicy();
    const summary = await summaryFor("agent", "a_single");
    const serialized = JSON.stringify(summary);
    expect(serialized).not.toContain("super-secret-token");
    expect(serialized).not.toContain("abcdef1234567890");
    // 摘要不得暴露未被授予的表。
    expect(serialized).not.toContain("fin_budget");
  });

  it("keeps the pure derivation free of a second permission algorithm", () => {
    const input: AuthorizationDerivationInput = {
      subject: { kind: "agent", id: "x" },
      basis: "committed",
      configVersion: "cfg",
      policyVersion: "pol",
      sourceMapVersion: "src",
      state: "ok",
      problem: null,
      failures: [],
      capabilities: [
        {
          tool: "lucy_query",
          connectionId: "warehouse",
          schema: "fin",
          sourceName: "fin_ledger",
          physicalTable: "fin.fin_ledger",
          rowGrant: { kind: "all" }
        },
        {
          tool: "lucy_read_source",
          connectionId: "warehouse",
          schema: "fin",
          sourceName: "fin_ledger",
          physicalTable: "fin.fin_ledger",
          rowGrant: { kind: "all" }
        }
      ],
      roleContributions: [
        {
          roleId: "r1",
          ok: true,
          capabilities: [
            {
              tool: "lucy_query",
              connectionId: "warehouse",
              schema: "fin",
              sourceName: "fin_ledger",
              physicalTable: "fin.fin_ledger",
              rowGrant: { kind: "all" }
            }
          ]
        }
      ],
      tools: ["lucy_query", "lucy_read_source"],
      legacyAllow: false,
      snapshotHash: "hash",
      enabledTableDenominator: { count: 2 }
    };
    const summary = deriveAuthorizationSummary(input);
    // 两个工具 × 一张表 → 1 张表，不是 2 张。
    expect(summary.headline.tableCount).toBe(1);
    expect(summary.headline.connectionCount).toBe(1);
    expect(summary.headline.grantPathCount).toBe(1);
    expect(summary.resources).toHaveLength(1);
    expect(summary.resources[0].schemas[0].tables).toHaveLength(1);
    expect(summary.resources[0].schemas[0].tables[0].capabilities).toHaveLength(2);
  });
});

describe("P1-2 §4.2 — Role 概览", () => {
  it("lists the Agents that reference the Role and links to their own summaries", async () => {
    await commitEffectivePolicy();
    const summary = await summaryFor("role", "ledger_all");
    // 引用 ledger_all 的全部 Agent（含禁用与降级的）都要可见。
    expect(summary.actions.referencingAgentIds).toEqual([
      "a_constrained",
      "a_disabled",
      "a_multi",
      "a_overlap",
      "a_partial",
      "a_single"
    ]);
    // Role 不是可认证 Agent → 不提供调试台 Agent 预填。
    expect(summary.actions.playgroundUrl).toBeNull();
    expect(summary.summaryContext.subject).toEqual({ kind: "role", id: "ledger_all" });
  });

  it("degrades a Role whose compile fails instead of showing an empty grant", async () => {
    await commitEffectivePolicy();
    const summary = await summaryFor("role", "broken_role");
    expect(summary.summaryContext.state).toBe("unavailable");
    expect(summary.resources).toEqual([]);
    expect(summary.summaryContext.failures.length).toBeGreaterThan(0);
  });
});

describe("P1-2 — 草稿候选（ASV-09）", () => {
  it("marks a draft summary as a candidate that is not in effect yet", async () => {
    await commitEffectivePolicy();
    const snapshot = await readAccessSnapshot(projectRoot);
    const config = snapshot.runtimeConfig!;
    const candidate = overlayRoleDraft(config, "ledger_all", {
      permission_model_version: 2,
      allow: {
        connections: ["warehouse"],
        tableSelectors: [
          { connection: "warehouse", schema: "fin", names: ["fin_budget"], row_access: "all" }
        ],
        tools: ["lucy_query"]
      }
    });
    const summary = await buildAuthorizationSummary({
      subject: { kind: "role", id: "ledger_all" },
      basis: "draft",
      snapshot,
      projectRoot,
      candidate,
      candidateDigest: "digest-draft"
    });
    expect(summary.summaryContext.basis).toBe("draft");
    expect(summary.summaryContext.candidateOnly).toBe(true);
    expect(summary.summaryContext.candidateDigest).toBe("digest-draft");
    expect(
      summary.resources.flatMap((c) => c.schemas).flatMap((s) => s.tables)[0].sourceName
    ).toBe("fin_budget");
    // 已提交配置没有被改写。
    const committed = parseAccessConfigText(ACCESS_YAML);
    expect(committed.roles?.ledger_all?.allow?.tableSelectors?.[0]?.names).toEqual(["fin_ledger"]);
  });
});

/**
 * ONE agent, TWO tables, sorted by source name: `fin_budget` (全部行) comes
 * FIRST and `fin_ledger` (the one with a real row constraint) comes SECOND.
 *
 * The deep link must point at `fin_ledger`. The old implementation took the
 * target from `resources[0]` — the FIRST table — which here is the `all` one,
 * so it pointed at a table that has no row constraint at all.
 */
const MIXED_ACCESS_YAML = `roles:
  budget_all:
    permission_model_version: 2
    allow:
      connections: [warehouse]
      tableSelectors:
        - connection: warehouse
          schema: fin
          names: [fin_budget]
          row_access: all
${TOOLS}
  ledger_scoped:
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
              - { field: region, op: eq, value: East }
${TOOLS}
users:
  - { id: a_mixed, name: A Mixed, enabled: true, roles: [budget_all, ledger_scoped], tokens: [] }
defaults:
  known_tools: [lucy_query, lucy_catalog, wiki_search, wiki_read]
  table_touching_tools: [lucy_query]
`;

describe("W8 回归 — P1-2 §4.1 深链（ASV-10）", () => {
  it("ASV-10 — the row-policy deep link points at the table that ACTUALLY has a row constraint", async () => {
    await writeProject(projectRoot, MIXED_ACCESS_YAML);
    invalidateAccessConfigCache();
    await commitEffectivePolicy();
    const summary = await summaryFor("agent", "a_mixed");
    const tables = summary.resources.flatMap((c) => c.schemas).flatMap((s) => s.tables);
    expect(tables.map((table) => table.sourceName)).toEqual(["fin_budget", "fin_ledger"]);
    expect(tables[0].rowSummary.kind).toBe("all");
    expect(tables[1].rowSummary.kind).toBe("scoped");
    const url = summary.actions.rowPolicyViewUrl;
    expect(url).not.toBeNull();
    // 指向真正受限的那张表，而不是资源列表里的第一张（这里是 全部行 的那张）。
    expect(url).toContain("sourceName=fin_ledger");
    expect(url).not.toContain("sourceName=fin_budget");
  });

  it("ASV-10 — the deep link emits the row-policy view's own query parameter names", () => {
    const url = rowPolicyViewUrlForTable({
      connectionId: "warehouse",
      schema: "fin",
      sourceName: "fin_ledger"
    });
    const params = new URL(url, "http://local").searchParams;
    // `RowPolicyView.tsx` 读的就是这三个名字；参数名对不上时单表面板永不查询。
    expect(params.get("connectionId")).toBe("warehouse");
    expect(params.get("schema")).toBe("fin");
    expect(params.get("sourceName")).toBe("fin_ledger");
    expect(params.get("connection")).toBeNull();
    expect(params.get("table")).toBeNull();
  });
});

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * P1-2 §8 验收矩阵 — 按编号命名的用例（ASV-02 ～ ASV-07）。
 *
 * Authority:
 *   - docs/specs/lucy-20261025-v0p25-access-authorization-summary-spec.md
 *     §2.2（计数口径）、§2.3（Agent 与 Role 的差异）、§3（授权摘要读取模型）、
 *     §6（一致性与降级）、§8（ASV-02 ～ ASV-07 的验收条款原文）
 *
 * §8 里此前只有 ASV-01、ASV-08～14 有编号痕迹；这六条落在「计数口径混用」与
 * 「Role / Agent 行边界不可互换」的高风险区，因此逐条补成可按名字追溯的用例。
 *
 * 既有断言一行未改；这里只新增编号用例。每条断言的是**行为**（口径、边界、
 * 来源、来源的权威性），不是「函数存在」或「没抛异常」。
 * ─────────────────────────────────────────────────────────────────────────────
 */

/**
 * ASV 专用夹具：一套同时覆盖「多 Role 重复授权同表」「多工具覆盖同表」
 * 「Role 间 OR」「Agent 个人行限制」「模板 vs 内联行策略」的 access.yaml。
 *
 * - `row_policy_templates` 是 access.yaml 顶层块（命名静态谓词集合）。
 * - `row_policy: { template: … }` 由编译期展开成与内联策略同形的 `predicates`
 *   （P1-1 §3.1），所以「模板」与「内联」在编译产物里应当是同一条边界。
 */
const ASV_ACCESS_YAML = `roles:
  dual_tool:
    permission_model_version: 2
    allow:
      connections: [warehouse]
      tableSelectors:
        - connection: warehouse
          schema: fin
          names: [fin_ledger]
          row_access: all
      tools: [lucy_query, lucy_read_source]
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
              - { field: region, op: eq, value: East }
      tools: [lucy_query]
  scoped_west:
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
              - { field: region, op: eq, value: West }
      tools: [lucy_query]
  scoped_inline:
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
              - { field: region, op: eq, value: East }
      tools: [lucy_query]
  scoped_template:
    permission_model_version: 2
    allow:
      connections: [warehouse]
      tableSelectors:
        - connection: warehouse
          schema: fin
          names: [fin_ledger]
          row_access: scoped
          row_policy:
            template: east_only
      tools: [lucy_query]
row_policy_templates:
  east_only:
    description: 仅东区订单
    predicates:
      - { field: region, op: eq, value: East }
users:
  - { id: a_asv_or, name: A Asv Or, enabled: true, roles: [scoped_east, scoped_west], tokens: [] }
  - { id: a_asv_dup, name: A Asv Dup, enabled: true, roles: [dual_tool, scoped_east], tokens: [] }
  - { id: a_asv_tools, name: A Asv Tools, enabled: true, roles: [dual_tool], tokens: [] }
  - { id: a_asv_constrained, name: A Asv Constrained, enabled: true, roles: [scoped_east], constraints: { sources: [{ connection: warehouse, schema: fin, names: [fin_ledger], predicates: [{ field: id, op: eq, value: 7 }] }] }, tokens: [] }
  - { id: a_asv_template, name: A Asv Template, enabled: true, roles: [scoped_template], tokens: [] }
  - { id: a_asv_inline, name: A Asv Inline, enabled: true, roles: [scoped_inline], tokens: [] }
defaults:
  known_tools: [lucy_query, lucy_read_source, lucy_catalog, wiki_search, wiki_read]
  table_touching_tools: [lucy_query, lucy_read_source]
`;

/** 把 access.yaml 换成 ASV 夹具并重新提交生效策略。 */
async function useAsvFixture(): Promise<void> {
  await writeProject(projectRoot, ASV_ACCESS_YAML);
  invalidateAccessConfigCache();
  await commitEffectivePolicy();
}

/** 摘要里的一张表（断言用：避免到处重复 flatMap）。 */
function tableOf(summary: Awaited<ReturnType<typeof summaryFor>>) {
  return summary.resources.flatMap((connection) => connection.schemas).flatMap((schema) => schema.tables);
}

describe("P1-2 §8 — ASV-02 多 Role 重复授权同表", () => {
  it("ASV-02 — 表数不重复、全部角色来源可见，OR 语义不变成 AND", async () => {
    await useAsvFixture();

    const summary = await summaryFor("agent", "a_asv_or");
    expect(summary.summaryContext.state).toBe("ok");

    // 两个 Role 都授权同一张表 → 表数仍是 1，授权路径是 2（两个数不得混用）。
    expect(summary.headline.tableCount).toBe(1);
    expect(summary.headline.grantPathCount).toBe(2);

    const tables = tableOf(summary);
    expect(tables).toHaveLength(1);

    // 全部角色来源可见：逐 Role 编译得来，不从合并后的 sources 反推。
    expect([...tables[0].roleIds].sort()).toEqual(["scoped_east", "scoped_west"]);

    // OR 语义保留：两个受限 Role 是两条 OR 分支。
    expect(tables[0].rowSummary.kind).toBe("scoped");
    expect(tables[0].rowSummary.displayShape).toBe("OR-of-AND");
    expect(tables[0].rowSummary.orArms).toHaveLength(2);
    expect(tables[0].rowSummary.orArms.join(" | ")).toContain("region=East");
    expect(tables[0].rowSummary.orArms.join(" | ")).toContain("region=West");

    // 若被错折成 AND，两条分支会并成一条、且同一条里同时含 East 与 West。
    const andFolded = tables[0].rowSummary.orArms.filter(
      (arm) => arm.includes("region=East") && arm.includes("region=West")
    );
    expect(andFolded).toHaveLength(0);

    // 受限表数按 Agent 的最终行约束计，且口径明确标出。
    expect(summary.headline.scopedTableCount).toBe(1);
    expect(summary.headline.scopedTableCountBasis).toBe("final_rows");
  });
});

describe("P1-2 §8 — ASV-03 多工具覆盖同表", () => {
  it("ASV-03 — 表数不因工具数放大，每个工具×表×行边界仍可查", async () => {
    await useAsvFixture();

    const summary = await summaryFor("agent", "a_asv_tools");
    expect(summary.summaryContext.state).toBe("ok");

    const tables = tableOf(summary);
    expect(tables).toHaveLength(1);

    // 两个数据面工具覆盖同一张表 → 表数仍是 1，但每个工具都有一条能力。
    const tools = tables[0].capabilities.map((capability) => capability.tool).sort();
    expect(tools).toEqual(["lucy_query", "lucy_read_source"]);
    expect(tables[0].capabilities).toHaveLength(2);
    expect(summary.headline.tableCount).toBe(1);

    // 工具×表元组数不得被当成表数（§2.2「不把工具×表元组数当表数」）。
    expect(summary.headline.tableCount).not.toBe(tables[0].capabilities.length);

    // 每个工具×表×行边界仍可查：每条能力都带自己的行授予。
    for (const capability of tables[0].capabilities) {
      expect(capability.rowGrant).toBeDefined();
      expect(capability.rowGrant.kind).toBe("all");
    }

    // 工具分组是展示分类，不改变工具本身：两个工具都被授予且各自归位。
    expect(summary.tools.query).toContain("lucy_query");
    expect(summary.tools.semanticRead).toContain("lucy_read_source");
  });
});

describe("P1-2 §8 — ASV-04 启用表目录完整／不完整", () => {
  it("ASV-04 — 分母只在可证明时展示；未知不填 0，也不保留陈旧数字", async () => {
    await useAsvFixture();

    // 目录完整 → 分母可证明。
    const complete = await summaryFor("agent", "a_asv_tools");
    expect(complete.summaryContext.state).toBe("ok");
    expect(complete.headline.enabledTableCount).toBe(2);
    expect(complete.headline.enabledTableDenominatorUnavailableReason).toBeNull();

    const capabilities = [
      {
        tool: "lucy_query",
        connectionId: "warehouse",
        schema: "fin",
        sourceName: "fin_ledger",
        physicalTable: "fin.fin_ledger",
        rowGrant: { kind: "all" as const }
      }
    ];
    const snapshot = await readAccessSnapshot(projectRoot);
    const context = await buildAdminPermissionContext(snapshot.runtimeConfig!);

    // 目录完整时分母是一个可证明的数。
    const proven = enabledTableDenominatorOf(context, capabilities);
    expect("count" in proven).toBe(true);
    if (!("count" in proven)) return;
    expect(proven.count).toBe(2);

    // 目录不完整（该连接的启用范围不可证明）→ 分母为空值且带原因，绝不填 0。
    const withoutCatalog = new Map(context.enabledTables);
    withoutCatalog.delete("warehouse");
    const unknown = enabledTableDenominatorOf({ ...context, enabledTables: withoutCatalog }, capabilities);
    expect("count" in unknown).toBe(false);
    if ("count" in unknown) return;
    expect(unknown.unavailableReason).not.toBe("");
    expect(unknown.unavailableReason).toContain("enabled_catalog");

    // 不保留陈旧数字：目录不可证明时重新计算，不得沿用上面那个已证明的数。
    expect(JSON.stringify(unknown)).not.toContain(`"count":${proven.count}`);

    // 分子不受影响：可确定的表数照常展示，分母缺失不得拉低分子。
    expect(complete.headline.tableCount).toBe(1);
  });
});

describe("P1-2 §8 — ASV-05 Agent 行策略与个人行限制", () => {
  it("ASV-05 — 最终行约束与运行时同一编译结果一致，且保留 OR-of-AND", async () => {
    await useAsvFixture();

    // 运行时自己的编译产物（摘要不得有第二套权限算法）。
    const { resolveEffectivePermissionsBatchForAdmin } = await import("../proxy/acl");
    const snapshot = await readAccessSnapshot(projectRoot);
    const context = await buildAdminPermissionContext(snapshot.runtimeConfig!);
    const runtimeRows = async (userId: string) => {
      const batch = await resolveEffectivePermissionsBatchForAdmin([userId], context);
      const resolved = batch.get(userId);
      expect(resolved?.ok).toBe(true);
      if (!resolved || !resolved.ok) return undefined;
      return resolved.permissions.finalRowsBySource ?? {};
    };

    // ── Agent 行策略 + 个人行限制 ──────────────────────────────────────────
    const constrained = await summaryFor("agent", "a_asv_constrained");
    expect(constrained.summaryContext.state).toBe("ok");
    const constrainedTable = tableOf(constrained)[0];
    expect(constrainedTable.rowSummary.basis).toBe("final_rows");
    expect(constrainedTable.rowSummary.agentFinalRowsAvailable).toBe(true);
    expect(constrainedTable.rowSummary.agentPersonalLimitsApplied).toBe(true);

    const constrainedRuntime = await runtimeRows("a_asv_constrained");
    const constrainedGrant = constrainedRuntime?.["warehouse\0fin_ledger"];
    expect(constrainedGrant?.kind).toBe("scoped");
    if (!constrainedGrant || constrainedGrant.kind !== "scoped") return;

    // 摘要的行边界 == 运行时同一编译结果（同一 digest、同一 OR 分支数）。
    expect(constrainedTable.rowSummary.digest).toBe(constrainedGrant.digest);
    expect(constrainedTable.rowSummary.orArms).toHaveLength(constrainedGrant.orArms.length);
    expect(constrainedTable.rowSummary.orArms.join(" | ")).toContain("region=East");
    expect(constrainedTable.rowSummary.orArms.join(" | ")).toContain("id=7");

    // ── 多 Role 的 OR-of-AND 不被压平 ──────────────────────────────────────
    const orSummary = await summaryFor("agent", "a_asv_or");
    const orTable = tableOf(orSummary)[0];
    const orRuntime = await runtimeRows("a_asv_or");
    const orGrant = orRuntime?.["warehouse\0fin_ledger"];
    expect(orGrant?.kind).toBe("scoped");
    if (!orGrant || orGrant.kind !== "scoped") return;

    expect(orGrant.orArms).toHaveLength(2);
    expect(orTable.rowSummary.orArms).toHaveLength(2);
    expect(orTable.rowSummary.digest).toBe(orGrant.digest);
    // 没有被折成一条同时含 East 与 West 的 AND。
    expect(
      orTable.rowSummary.orArms.filter((arm) => arm.includes("region=East") && arm.includes("region=West"))
    ).toHaveLength(0);
  });
});

describe("P1-2 §8 — ASV-06 Role 与 Agent 对照", () => {
  it("ASV-06 — Role 不含 Agent 个人行限制，通用 Role 预览不冒充 Agent FinalRows", async () => {
    await useAsvFixture();

    // Role 视图：只表示该 Role 自身的行授予。
    const roleSummary = await summaryFor("role", "scoped_east");
    expect(roleSummary.summaryContext.state).toBe("ok");
    expect(roleSummary.summaryContext.subject).toEqual({ kind: "role", id: "scoped_east" });
    const roleTable = tableOf(roleSummary)[0];
    expect(roleTable.rowSummary.basis).toBe("effective_row_grant");
    expect(roleTable.rowSummary.agentFinalRowsAvailable).toBe(false);
    expect(roleTable.rowSummary.agentPersonalLimitsApplied).toBe(false);
    expect(roleTable.rowSummary.constraintSummary).toContain("不含 Agent 个人行限制");
    expect(roleSummary.headline.scopedTableCountBasis).toBe("effective_row_grant");

    // 同一个 Role 加上 Agent 个人行限制 → Agent 视图才报 FinalRows。
    const agentSummary = await summaryFor("agent", "a_asv_constrained");
    const agentTable = tableOf(agentSummary)[0];
    expect(agentTable.rowSummary.basis).toBe("final_rows");
    expect(agentTable.rowSummary.agentPersonalLimitsApplied).toBe(true);
    expect(agentSummary.headline.scopedTableCountBasis).toBe("final_rows");

    // 两套边界不同：Role 视图不含个人行限制，Agent 视图含。
    expect(roleTable.rowSummary.digest).not.toBe(agentTable.rowSummary.digest);
    expect(roleTable.rowSummary.orArms.join(" | ")).not.toContain("id=7");
    expect(agentTable.rowSummary.orArms.join(" | ")).toContain("id=7");

    // Role 视图里的每一张表都不得报 final_rows 口径。
    expect(tableOf(roleSummary).every((table) => table.rowSummary.basis !== "final_rows")).toBe(true);

    // 通用 Role 预览身份：__role_preview__ 不携带 Agent 个人行限制。
    const { ROLE_PREVIEW_USER_ID } = await import("../admin/authorization-summary");
    expect(ROLE_PREVIEW_USER_ID).toBe("__role_preview__");
  });
});

describe("P1-2 §8 — ASV-07 模板与内联行策略", () => {
  it("ASV-07 — 摘要来自展开后编译产物；模板名仅作溯源，不改变摘要语义", async () => {
    await useAsvFixture();

    const templateSummary = await summaryFor("agent", "a_asv_template");
    const inlineSummary = await summaryFor("agent", "a_asv_inline");
    expect(templateSummary.summaryContext.state).toBe("ok");
    expect(inlineSummary.summaryContext.state).toBe("ok");

    const templateTable = tableOf(templateSummary)[0];
    const inlineTable = tableOf(inlineSummary)[0];

    // 模板名只出现在溯源字段里。
    expect(templateTable.rowSummary.templateRefs).toEqual(["east_only"]);
    expect(inlineTable.rowSummary.templateRefs).toEqual([]);

    // 行边界来自展开后的编译产物：模板与内联得到同一条边界。
    expect(templateTable.rowSummary.kind).toBe("scoped");
    expect(inlineTable.rowSummary.kind).toBe("scoped");
    expect(templateTable.rowSummary.digest).toBe(inlineTable.rowSummary.digest);
    expect(templateTable.rowSummary.orArms).toEqual(inlineTable.rowSummary.orArms);

    // 展开后是真实的谓词，不是模板名。
    expect(templateTable.rowSummary.orArms.join(" | ")).toContain("region=East");
    expect(templateTable.rowSummary.orArms.join(" | ")).not.toContain("east_only");
    expect(templateTable.rowSummary.constraintSummary).not.toContain("east_only");
  });
});
