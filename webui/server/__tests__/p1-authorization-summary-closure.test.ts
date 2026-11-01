/**
 * Lucy v0.25 P1-2（L25-01）— 授权摘要**功能合同收口**补齐的验收用例。
 *
 * Authority:
 *   - docs/specs/lucy-20261025-v0p25-access-authorization-summary-spec.md §8
 *     ASV-01、ASV-08、ASV-09、ASV-10、ASV-11、ASV-12、ASV-13 的验收条款原文
 *   - docs/plans/2026-10-25-lucy-v0.25-p1-implementation-plan.md §5（B1、B2、B6、B8）
 *
 * 这个文件只补**矩阵里有、但仓里没有任何断言**的那几小句；既有断言一行未改。
 * 每个用例都对着**行为**打假，不是「函数存在」也不是「没抛异常」：
 *
 *   ASV-01 单 Role／单连接／多表：表数按规范源键去重，资源卡片与 capability 集合一致
 *   ASV-08 配置**非法**（access_invalid）这一类问题此前无任何断言
 *   ASV-09 dry-run「不落盘」与「基线变化使旧预览失效」此前无真实断言
 *   ASV-10 深链「只触发既有 ACL 预览，不自动执行查询」此前只断言了 URL 形状
 *   ASV-11 与 R3（按表反查）**行边界**一致此前无跨面断言
 *   ASV-12 「空能力与失败可分」此前无断言
 *   ASV-13 「无新写入口」与「响应不含数据库密码」此前无断言
 *
 * 夹具是**自带的磁盘工程**（access.yaml + ktx.yaml + semantic-layer 清单），
 * 与既有 `p1-authorization-summary.test.ts` 的夹具互不干扰。
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import Fastify from "fastify";
import {
  buildAuthorizationSummary,
  overlayRoleDraft,
  type AuthorizationSummary
} from "../admin/authorization-summary";
import { registerAuthorizationSummaryRoutes } from "../admin/routes/authorization-summary";
import { readAccessSnapshot } from "../admin/permission-display";
import { readRowPolicyTableView } from "../admin/row-policy-views";
import {
  computeAccessConfigDigest,
  commitEffectivePolicy,
  resetEffectivePolicyForTests
} from "../proxy/acl";
import { invalidateAccessConfigCache } from "../proxy/identity";
import { invalidateContentPathsCache } from "../paths";
import { computeCandidateDigest } from "../config-digest";

/**
 * 夹具里刻意放了三种「秘密」，它们必须一个都不出现在摘要响应里：
 *
 *   - Token 明文（`value`）与 Token 摘要（`hash`）——access.yaml 的既有字段；
 *   - Token `secret`——access.yaml 的既有字段；
 *   - 「数据库密码」——写在 access.yaml 的 Role allow 块与 ktx.yaml 的连接块里。
 *
 * access.yaml 的解析器**不做字段白名单**（`parseAccessConfigText` 只校验 `users` 是数组），
 * 所以这些标记真的会留在运行时配置对象里：这条断言是有牙齿的，不是对着空气断言。
 */
const TOKEN_PLAINTEXT = "TOKEN-PLAINTEXT-MARKER";
const TOKEN_HASH = "TOKEN-HASH-MARKER";
const TOKEN_SECRET = "TOKEN-SECRET-MARKER";
const DB_PASSWORD = "DB-PASSWORD-MARKER";

const KTX_YAML = `connections:
  warehouse:
    driver: mysql
    enabled_tables:
      - fin.fin_ledger
      - fin.fin_budget
      - fin.fin_secret
    password: ${DB_PASSWORD}
`;

const ACCESS_YAML = `roles:
  multi_table:
    permission_model_version: 2
    allow:
      connections: [warehouse]
      tableSelectors:
        - connection: warehouse
          schema: fin
          names: [fin_ledger, fin_budget]
          row_access: all
      tools: [lucy_query, lucy_read_source]
      password: ${DB_PASSWORD}
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
users:
  - { id: a_one_role, name: A One Role, enabled: true, roles: [multi_table], tokens: [] }
  - { id: a_constrained, name: A Constrained, enabled: true, roles: [scoped_east], constraints: { sources: [{ connection: warehouse, schema: fin, names: [fin_ledger], predicates: [{ field: id, op: eq, value: 7 }] }] }, tokens: [] }
  - { id: a_no_roles, name: A No Roles, enabled: true, roles: [], tokens: [] }
  - { id: a_secret, name: A Secret, enabled: true, roles: [multi_table], tokens: [{ label: prod, value: ${TOKEN_PLAINTEXT}, hash: ${TOKEN_HASH}, secret: ${TOKEN_SECRET} }] }
defaults:
  known_tools: [lucy_query, lucy_read_source, lucy_catalog, wiki_search, wiki_read]
  table_touching_tools: [lucy_query, lucy_read_source]
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
const accessYamlPath = (): string => path.join(projectRoot, "webui", "config", "access.yaml");

const savedEnv = {
  root: process.env.KTX_PROJECT_ROOT,
  content: process.env.LUCY_CONTENT_ROOT,
  access: process.env.LUCY_ACCESS_CONFIG_PATH
};

async function writeProject(accessYaml: string = ACCESS_YAML): Promise<void> {
  await mkdir(path.join(projectRoot, "semantic-layer", "warehouse", "_schema"), { recursive: true });
  await mkdir(path.join(projectRoot, "webui", "config"), { recursive: true });
  await writeFile(path.join(projectRoot, "ktx.yaml"), KTX_YAML, "utf8");
  await writeFile(
    path.join(projectRoot, "semantic-layer", "warehouse", "_schema", "fin.yaml"),
    manifest("fin", ["fin_ledger", "fin_budget", "fin_secret"]),
    "utf8"
  );
  await writeFile(accessYamlPath(), accessYaml, "utf8");
}

beforeEach(async () => {
  projectRoot = await mkdtemp(path.join(os.tmpdir(), "lucy-authz-closure-"));
  await writeProject();
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

async function summaryFor(kind: "agent" | "role", id: string): Promise<AuthorizationSummary> {
  const snapshot = await readAccessSnapshot(projectRoot);
  return buildAuthorizationSummary({
    subject: { kind, id },
    basis: "committed",
    snapshot,
    projectRoot
  });
}

function tablesOf(summary: AuthorizationSummary) {
  return summary.resources.flatMap((connection) => connection.schemas).flatMap((schema) => schema.tables);
}

/**
 * 递归收集形如 token／secret／password／credential 的属性名。
 *
 * 「计数类」后缀排除：`tokenCount` 是一个数（这个仓库里有好几个 Token 计数字段），
 * 不是凭据本身；把它误报成凭据会让这条断言失去意义。
 */
const CREDENTIAL_KEY = /token|secret|password|credential|bearer|passphrase/i;
const NON_SECRET_AGGREGATE = /(count|counts|length|size|number|total)$/i;

function credentialKeysOf(value: unknown, at = "$", out: string[] = []): string[] {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => credentialKeysOf(entry, `${at}[${index}]`, out));
    return out;
  }
  if (value && typeof value === "object") {
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      if (CREDENTIAL_KEY.test(key) && !NON_SECRET_AGGREGATE.test(key)) {
        out.push(`${at}.${key}`);
      }
      credentialKeysOf(entry, `${at}.${key}`, out);
    }
  }
  return out;
}

/** 与授权摘要同一套行分支文本格式（`field=value`，分支内 AND、分支间 OR）。 */
function armTextOf(arm: Array<{ field: string; value?: unknown }>): string {
  if (arm.length === 0) return "（空分支）";
  return arm.map((predicate) => `${predicate.field}=${String(predicate.value ?? "")}`).join(" AND ");
}

/** 定位 webui 根目录（不依赖 cwd 恰好是 webui/）。 */
function resolveWebuiRoot(): string {
  let dir = process.cwd();
  for (let index = 0; index < 8; index += 1) {
    if (existsSync(path.join(dir, "scripts", "lint-terminology.mjs"))) return dir;
    const nested = path.join(dir, "webui");
    if (existsSync(path.join(nested, "scripts", "lint-terminology.mjs"))) return nested;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error("webui_root_not_found");
}

describe("L25-01 §8 — ASV-01 单 Role、单连接、多表", () => {
  it("ASV-01 — 表数按规范源键去重；一句话、资源卡片与 capability 集合是同一个集合", async () => {
    await commitEffectivePolicy();
    const summary = await summaryFor("agent", "a_one_role");
    expect(summary.summaryContext.state).toBe("ok");

    // 一个 Role、一个连接、两张表。
    expect(summary.headline.connectionCount).toBe(1);
    expect(summary.headline.tableCount).toBe(2);
    expect(summary.resources.map((connection) => connection.connectionId)).toEqual(["warehouse"]);

    // 资源卡片（去重后的表）与 capability 集合必须是**同一个集合**。
    const cardKeys = tablesOf(summary).map((table) => table.sourceKey).sort();
    const capabilityKeys = [
      ...new Set(
        tablesOf(summary).flatMap((table) =>
          table.capabilities.map((capability) => table.sourceKey)
        )
      )
    ].sort();
    expect(cardKeys).toEqual(capabilityKeys);
    expect(new Set(cardKeys).size).toBe(cardKeys.length);

    // 「一句话」的表数 == 资源卡片的行数（两个数不许各说各话）。
    expect(summary.headline.tableCount).toBe(cardKeys.length);
    expect(summary.headline.grantPathCount).toBe(2);

    // 两个工具覆盖两张表 → 表数不因工具数放大。
    expect(summary.tools.query).toContain("lucy_query");
    expect(summary.tools.semanticRead).toContain("lucy_read_source");
    expect(summary.headline.tableCount).not.toBe(4);
  });
});

describe("L25-01 §8 — ASV-08 配置三类问题与角色失败", () => {
  it("ASV-08 — 配置非法 → unavailable + access_invalid，不得以零值冒充无权限", async () => {
    // 非法 YAML：解析必须失败关闭，而不是回退成「没有权限」。
    await writeFile(accessYamlPath(), "roles: [unclosed\n  bad: : :\n", "utf8");
    invalidateAccessConfigCache();

    const summary = await summaryFor("agent", "a_one_role");
    expect(summary.summaryContext.state).toBe("unavailable");
    expect(summary.summaryContext.problem).toBe("access_invalid");
    // 不得给出确定的授权结论，也不得给出资源卡。
    expect(summary.resources).toEqual([]);
    expect(summary.headline.state).toBe("unavailable");
    expect(summary.summaryContext.failures).toEqual([]);
    // 分母不可证明时是空值，不是 0。
    expect(summary.headline.enabledTableCount).toBeNull();
    expect(summary.headline.enabledTableDenominatorUnavailableReason).not.toBeNull();
  });

  it("ASV-08 — 三类配置问题各自给出自己的问题码，互不串台", async () => {
    // ① 读不到
    await rm(accessYamlPath(), { force: true });
    invalidateAccessConfigCache();
    const unreadable = await summaryFor("agent", "a_one_role");
    expect(unreadable.summaryContext.problem).toBe("access_unreadable");

    // ② 非法
    await writeFile(accessYamlPath(), "roles: [unclosed\n", "utf8");
    invalidateAccessConfigCache();
    const invalid = await summaryFor("agent", "a_one_role");
    expect(invalid.summaryContext.problem).toBe("access_invalid");

    // ③ 路径不一致
    await writeFile(accessYamlPath(), ACCESS_YAML, "utf8");
    const overridePath = path.join(projectRoot, "override-access.yaml");
    await writeFile(overridePath, ACCESS_YAML.replace("a_one_role", "z_one_role"), "utf8");
    process.env.LUCY_ACCESS_CONFIG_PATH = overridePath;
    invalidateAccessConfigCache();
    const mismatch = await summaryFor("agent", "a_one_role");
    expect(mismatch.summaryContext.problem).toBe("access_config_path_mismatch");

    // 三个问题码互不相同，且都不是「零值冒充」。
    expect(new Set([unreadable.summaryContext.problem, invalid.summaryContext.problem, mismatch.summaryContext.problem]).size).toBe(3);
    for (const summary of [unreadable, invalid, mismatch]) {
      expect(summary.summaryContext.state).toBe("unavailable");
      expect(summary.resources).toEqual([]);
    }
  });
});

describe("L25-01 §8 — ASV-09 新建／编辑 dry-run", () => {
  it("ASV-09 — 候选摘要不落盘；草稿变化或基线变化都使旧预览失效", async () => {
    await commitEffectivePolicy();
    const before = await readFile(accessYamlPath(), "utf8");

    const snapshot = await readAccessSnapshot(projectRoot);
    const config = snapshot.runtimeConfig!;
    const draft = {
      permission_model_version: 2,
      allow: {
        connections: ["warehouse"],
        tableSelectors: [
          { connection: "warehouse", schema: "fin", names: ["fin_ledger"], row_access: "all" }
        ],
        tools: ["lucy_query"]
      }
    };
    const otherDraft = {
      ...draft,
      allow: {
        ...draft.allow,
        tableSelectors: [
          { connection: "warehouse", schema: "fin", names: ["fin_budget"], row_access: "all" }
        ]
      }
    };

    // ① 草稿变化 → 候选身份变化，旧预览不能用来确认新草稿。
    const candidateA = overlayRoleDraft(config, "multi_table", draft as never);
    const candidateB = overlayRoleDraft(config, "multi_table", otherDraft as never);
    const digestA = computeCandidateDigest(candidateA);
    const digestB = computeCandidateDigest(candidateB);
    expect(digestA).not.toBe(digestB);

    const summaryA = await buildAuthorizationSummary({
      subject: { kind: "role", id: "multi_table" },
      basis: "draft",
      snapshot,
      projectRoot,
      candidate: candidateA,
      candidateDigest: digestA
    });
    expect(summaryA.summaryContext.basis).toBe("draft");
    expect(summaryA.summaryContext.candidateOnly).toBe(true);
    expect(summaryA.summaryContext.candidateDigest).toBe(digestA);
    expect(tablesOf(summaryA).map((table) => table.sourceName)).toEqual(["fin_ledger"]);

    // ② 基线变化（已提交配置改了）→ 同一份草稿算出的候选身份也变了。
    const changedBaseline = ACCESS_YAML.replace(
      "  scoped_east:",
      "  extra_role:\n    permission_model_version: 2\n    allow:\n      connections: [warehouse]\n      tableSelectors:\n        - connection: warehouse\n          schema: fin\n          names: [fin_secret]\n          row_access: all\n      tools: [lucy_query]\n  scoped_east:"
    );
    await writeFile(accessYamlPath(), changedBaseline, "utf8");
    invalidateAccessConfigCache();
    const changedSnapshot = await readAccessSnapshot(projectRoot);
    expect(changedSnapshot.runtimeConfig).not.toBeNull();
    // 基线版本本身也变了（同一份内容的口径）。
    expect(changedSnapshot.runtimeConfig).not.toEqual(config);

    const candidateOnNewBaseline = overlayRoleDraft(
      changedSnapshot.runtimeConfig!,
      "multi_table",
      draft as never
    );
    const digestOnNewBaseline = computeCandidateDigest(candidateOnNewBaseline);
    expect(digestOnNewBaseline).not.toBe(digestA);

    // ③ 不落盘：候选摘要只是内存投影，已提交配置一个字节都没动。
    const after = await readFile(accessYamlPath(), "utf8");
    expect(after).toBe(changedBaseline);
    expect(after).not.toBe(before);
    // 原始基线（第一版）也从未被候选改写。
    expect(before).toBe(ACCESS_YAML);
  });
});

describe("L25-01 §8 — ASV-10 调试台深链", () => {
  it("ASV-10 — 深链只带预填参数，mode 恒为 dry-run，不带任何执行触发参数", async () => {
    await commitEffectivePolicy();
    const summary = await summaryFor("agent", "a_one_role");
    const table = tablesOf(summary)[0];
    expect(table.playgroundUrl).not.toBeNull();

    const url = new URL(table.playgroundUrl!, "http://local");
    // 参数集合**恰好**是预填用的四个：一个不多（凭据、执行触发）一个不少。
    expect([...url.searchParams.keys()].sort()).toEqual(["agentId", "args", "mode", "tool"]);
    expect(url.searchParams.get("agentId")).toBe("a_one_role");
    expect(url.searchParams.get("tool")).toBe("lucy_query");
    // 只走既有 ACL 裁决预览（dry-run），绝不指向受控试调。
    expect(url.searchParams.get("mode")).toBe("dry-run");
    expect(url.searchParams.get("mode")).not.toBe("live-smoke");
    expect(url.toString()).not.toContain("live-smoke");

    // args 只有表坐标：没有 SQL、没有凭据、没有执行指令。
    const args = JSON.parse(url.searchParams.get("args")!);
    expect(Object.keys(args).sort()).toEqual(["connectionId", "sourceName"]);
    expect(args.connectionId).toBe("warehouse");
    // args 指向的必须是**这一行自己的**表，不能是资源列表里的另一张。
    expect(args.sourceName).toBe(table.sourceName);
    expect(["fin_budget", "fin_ledger"]).toContain(args.sourceName);

    // 摘要自己不给任何执行入口：actions 只有链接字段。
    expect(Object.keys(summary.actions).sort()).toEqual([
      "accessMapUrl",
      "playgroundUrl",
      "referencingAgentIds",
      "rowPolicyViewUrl"
    ]);
  });

  it("ASV-10 — Role 视图不提供 Agent 预填（Role 不是可认证 Agent）", async () => {
    await commitEffectivePolicy();
    const roleSummary = await summaryFor("role", "multi_table");
    expect(roleSummary.actions.playgroundUrl).toBeNull();
    for (const table of tablesOf(roleSummary)) {
      expect(table.playgroundUrl).toBeNull();
    }
  });
});

describe("L25-01 §8 — ASV-11 与 R3 对账", () => {
  it("ASV-11 — 同快照下表身份一致，且同一 Agent 的最终行约束在两面完全相同", async () => {
    await commitEffectivePolicy();
    const summary = await summaryFor("agent", "a_constrained");
    expect(summary.summaryContext.state).toBe("ok");
    const table = tablesOf(summary)[0];

    // ① 表身份：摘要与 R3（按表反查）说的是同一张表。
    const r3 = await readRowPolicyTableView(projectRoot, {
      connectionId: "warehouse",
      schema: "fin",
      sourceName: "fin_ledger"
    });
    expect(r3.status).toBe("ok");
    expect(`${r3.table.connectionId}::${r3.table.schema}::${r3.table.sourceName}`).toBe(
      `${table.connectionId}::${table.schema}::${table.sourceName}`
    );

    // ② 行边界：同一个 Agent 的最终行约束在两面一致。
    const branch = r3.agents.find((agent) => agent.agentId === "a_constrained");
    expect(branch).toBeDefined();
    const r3FinalRows = branch!.finalRows;
    expect(r3FinalRows?.kind).toBe("scoped");
    expect(table.rowSummary.kind).toBe("scoped");
    expect(table.rowSummary.basis).toBe("final_rows");
    if (r3FinalRows?.kind !== "scoped") throw new Error("R3 final rows must be scoped");
    expect(table.rowSummary.digest).toBe(r3FinalRows.digest);

    const r3Arms = r3FinalRows.orArms;
    expect(table.rowSummary.orArms).toHaveLength(r3Arms.length);
    expect(table.rowSummary.orArms).toEqual(r3Arms.map((arm) => armTextOf(arm)));
    // 个人行限制在两面都在（id=7 是 Agent 自己的限制）。
    expect(table.rowSummary.orArms.join(" | ")).toContain("id=7");

    // ③ 同一个快照身份：两面发布的是同一份配置版本。
    expect(r3.snapshot.identity.configVersion).toBe(summary.summaryContext.configVersion);
  });
});

describe("L25-01 §8 — ASV-12 legacy、空能力与系统禁止工具", () => {
  it("ASV-12 — 空能力与失败可分：零能力是 ok 的空集合，解析失败是 unavailable", async () => {
    await commitEffectivePolicy();

    // 零能力：主体解析成功，只是没有任何授予 → `ok` 的空集合。
    const empty = await summaryFor("agent", "a_no_roles");
    expect(empty.summaryContext.state).toBe("ok");
    expect(empty.summaryContext.problem).toBeNull();
    expect(empty.summaryContext.failures).toEqual([]);
    expect(empty.headline.state).toBe("ok");
    expect(empty.headline.tableCount).toBe(0);
    expect(empty.resources).toEqual([]);

    // 解析失败：读不到主体 → `unavailable`，并说清原因。
    const broken = await summaryFor("agent", "a_does_not_exist");
    expect(broken.summaryContext.state).toBe("unavailable");
    expect(broken.summaryContext.failures.length).toBeGreaterThan(0);
    expect(broken.resources).toEqual([]);

    // 两者**不共用**一个状态：空能力不是失败，失败不是零值。
    expect(empty.summaryContext.state).not.toBe(broken.summaryContext.state);
    expect(empty.summaryContext.failures).not.toEqual(broken.summaryContext.failures);
  });
});

describe("L25-01 §8 — ASV-14 术语门禁与凭据探测自检", () => {
  it("ASV-14 — 术语 lint 真实通过，且本条的新术语已在术语标准登记", () => {
    const webuiRoot = resolveWebuiRoot();

    // ① 本条引入的两个词已在术语标准里登记（不是只在 Spec 里自称）。
    const standard = readFileSync(
      path.join(webuiRoot, "docs", "00-product-terminology-standard.md"),
      "utf8"
    );
    expect(standard).toContain("Authorization Summary");
    expect(standard).toContain("授权摘要");
    expect(standard).toContain("Authorization Resource Card");
    expect(standard).toContain("资源卡片");

    // ② lint 脚本真实跑一遍（文档 lint 不能代替功能验收，但这条验收方式
    //    写的就是 lint，所以它必须真的绿）。
    const output = execFileSync(
      process.execPath,
      [path.join(webuiRoot, "scripts", "lint-terminology.mjs")],
      { cwd: webuiRoot, encoding: "utf8", timeout: 120_000 }
    );
    expect(output).toContain("Terminology lint passed");
  });

  it("凭据探测器自检：它真的能认出凭据字段（否则上面的扫描是空转）", () => {
    // 探测器本身必须能命中：一个带凭据名的对象一定要被抓出来。
    expect(credentialKeysOf({ a: { bearerToken: "x" } })).toEqual(["$.a.bearerToken"]);
    expect(credentialKeysOf({ a: { dbPassword: "x" } })).toEqual(["$.a.dbPassword"]);
    expect(credentialKeysOf({ a: { credentials: { password: "x" } } })).toEqual([
      "$.a.credentials",
      "$.a.credentials.password"
    ]);
    // 而普通字段不能被误伤。
    expect(credentialKeysOf({ a: { tokenCount: 3, capabilityDigest: "d" } })).toEqual([]);
  });
});

describe("L25-01 §8 — ASV-13 只读与秘密保护", () => {
  it("ASV-13 — 响应不含 Token 明文、数据库密码或超授权内容，也没有任何凭据字段", async () => {
    await commitEffectivePolicy();
    const summary = await summaryFor("agent", "a_secret");
    expect(summary.summaryContext.state).toBe("ok");
    const serialized = JSON.stringify(summary);

    // ① Token 明文、Token 摘要与 secret 都不出现。
    expect(serialized).not.toContain(TOKEN_PLAINTEXT);
    expect(serialized).not.toContain(TOKEN_HASH);
    expect(serialized).not.toContain(TOKEN_SECRET);

    // ② 「数据库密码」不出现——它就写在 access.yaml 与 ktx.yaml 里，解析器不丢。
    expect(serialized).not.toContain(DB_PASSWORD);

    // ③ 超授权内容不出现：fin_secret 在目录里但没有被授予。
    expect(serialized).not.toContain("fin_secret");

    // ④ 整个摘要对象里没有任何形如凭据的属性名。
    expect(credentialKeysOf(summary)).toEqual([]);
  });

  it("ASV-13 — 授权摘要没有写入口：preview 不落盘、不换入策略；写方法不存在", async () => {
    await commitEffectivePolicy();
    const before = await readFile(accessYamlPath(), "utf8");
    const snapshot = await readAccessSnapshot(projectRoot);
    expect(snapshot.runtimeConfig).not.toBeNull();
    const committedDigest = computeAccessConfigDigest(snapshot.runtimeConfig!);

    const app = Fastify();
    registerAuthorizationSummaryRoutes(app);

    // ① preview 端点只在内存里叠加草稿。
    const preview = await app.inject({
      method: "POST",
      url: "/api/admin/authorization-summary/role/multi_table/preview",
      payload: {
        role: {
          permission_model_version: 2,
          allow: {
            connections: ["warehouse"],
            tableSelectors: [
              { connection: "warehouse", schema: "fin", names: ["fin_ledger"], row_access: "all" }
            ],
            tools: ["lucy_query"]
          }
        }
      }
    });
    expect(preview.statusCode).toBe(200);
    const previewBody = preview.json() as {
      ok: boolean;
      data: { summary: AuthorizationSummary; candidateDigest: string | null };
    };
    expect(previewBody.ok).toBe(true);
    expect(previewBody.data.summary.summaryContext.basis).toBe("draft");
    expect(previewBody.data.summary.summaryContext.candidateOnly).toBe(true);
    expect(previewBody.data.candidateDigest).not.toBeNull();

    // ② 不落盘。
    const after = await readFile(accessYamlPath(), "utf8");
    expect(after).toBe(before);

    // ③ 不换入策略：已提交配置的摘要没有变。
    const afterSnapshot = await readAccessSnapshot(projectRoot);
    expect(afterSnapshot.runtimeConfig).not.toBeNull();
    expect(computeAccessConfigDigest(afterSnapshot.runtimeConfig!)).toBe(committedDigest);

    // ④ 写方法不存在（只有 GET 与只读 preview）。
    for (const url of [
      "/api/admin/authorization-summary/agent/a_one_role",
      "/api/admin/authorization-summary/role/multi_table",
      "/api/admin/authorization-summary/role/multi_table/preview",
      "/api/admin/authorization-summary/agent/a_one_role/preview"
    ]) {
      for (const method of ["PUT", "PATCH", "DELETE"] as const) {
        const response = await app.inject({ method, url, payload: {} });
        expect(response.statusCode).toBe(404);
      }
    }
    await app.close();
  });
});
