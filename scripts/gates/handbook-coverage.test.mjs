import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  assertCoverage,
  CoverageError,
  findFaqSectionReferences,
  findHandbookSectionReferences,
  parseHandbookSectionAnchors,
  parseSection15Paths,
  readNavEntries,
  runHandbookCoverage
} from "./handbook-coverage.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

/**
 * Simulated `navigation.ts` mirroring the real file shape: a `topLevelEntry`
 * declaration that is identifier-referenced from `navGroups`, plus inline
 * objects inside each `items` array. Includes every key path called out in the
 * task brief (`/admin/mcp-playground`, `/admin/branding`, `/admin/usage`,
 * `/eval/field-questions`, `/publish/workbench`, `/publish/history`) so the
 * count + key-presence assertions can be tested.
 */
const NAV_FIXTURE = `// Mimics webui/src/app/navigation.ts.
import type { NavItem } from "./navigation-types";

export const topLevelEntry: NavItem = {
  id: "overview",
  label: "系统概览",
  to: "/overview",
  iconKey: "overview",
  active: (path) => path === "/overview",
  description: "确认系统可用，处理当前待办。",
  keywords: ["控制台", "Dashboard", "健康", "巡检", "MCP", "KTX", "Agent"]
};

export const navGroups: Array<{
  id: string;
  title: string;
  items: NavItem[];
}> = [
  {
    id: "runtime-status",
    title: "运行状态",
    items: [
      topLevelEntry,
      {
        id: "ops-calls",
        label: "调用监控",
        to: "/ops/calls",
        iconKey: "callMonitor",
        active: (path) => path === "/ops/calls" || path.startsWith("/ops/calls/"),
        description: "准实时查看 MCP 工具调用量、成败与请求时效。",
        keywords: ["MCP", "调用", "延迟"]
      },
      {
        id: "admin-governance",
        label: "使用概况",
        to: "/admin/usage",
        iconKey: "governanceOverview",
        active: (path) => path === "/admin/usage" || path === "/admin/governance",
        description: "查看 Agent、Token、数据表的活跃率。",
        keywords: ["Governance", "Dashboard"]
      }
    ]
  },
  {
    id: "connections",
    title: "数据接入",
    items: [
      {
        id: "connections-overview",
        label: "连接概览",
        to: "/connections",
        iconKey: "connections",
        active: (path) => path === "/connections",
        description: "管理数据库连接与 Schema。"
      },
      {
        id: "connections-enabled-tables",
        label: "启用表范围",
        to: "/connections/enabled-tables",
        iconKey: "whitelist",
        active: (path) => path === "/connections/enabled-tables",
        description: "配置各连接进入语义层的表范围。"
      }
    ]
  },
  {
    id: "semantic-modeling",
    title: "业务上下文",
    items: [
      {
        id: "semantic-catalog",
        label: "语义资产",
        to: "/catalog",
        iconKey: "catalog",
        active: (path) => path === "/catalog",
        description: "管理表、字段、指标、分群与关联等结构化语义资产。"
      },
      {
        id: "semantic-wiki",
        label: "业务 Wiki",
        to: "/wiki",
        iconKey: "wiki",
        active: (path) => path === "/wiki",
        description: "管理业务口径、指标说明与分析指引。"
      },
      {
        id: "semantic-skills",
        label: "业务 Skill",
        to: "/skills",
        iconKey: "skills",
        active: (path) => path === "/skills" || path.startsWith("/skills/"),
        description: "查看受治理的业务 Skill 资产。"
      }
    ]
  },
  {
    id: "publish",
    title: "语义发布",
    items: [
      {
        id: "publish-workbench",
        label: "发布工作台",
        to: "/publish/workbench",
        iconKey: "publish",
        active: (path) => path.startsWith("/publish/workbench"),
        description: "审阅并校验语义与 Wiki 变更。"
      },
      {
        id: "publish-history",
        label: "发布记录",
        to: "/publish/history",
        iconKey: "history",
        active: (path) => path.startsWith("/publish/history"),
        description: "查看历次语义发布的变更范围、执行结果与操作记录。"
      }
    ]
  },
  {
    id: "evaluation",
    title: "质量评测",
    items: [
      {
        id: "eval-cases",
        label: "评测用例",
        to: "/eval/cases",
        iconKey: "evalCases",
        active: (path) => path.startsWith("/eval/cases"),
        description: "管理数据问答与语义质量的评测用例及预期结果。"
      },
      {
        id: "eval-runs",
        label: "运行历史",
        to: "/eval/runs",
        iconKey: "evalRuns",
        active: (path) => path.startsWith("/eval/runs"),
        description: "查看评测运行记录、通过率、结果明细与失败诊断。"
      },
      {
        id: "eval-monitor",
        label: "趋势监控",
        to: "/eval/monitor",
        iconKey: "monitor",
        active: (path) => path === "/eval/monitor",
        description: "监控评测通过率、失败集中度与质量漂移趋势。"
      },
      {
        id: "eval-field-questions",
        label: "现场提问",
        to: "/eval/field-questions",
        iconKey: "fieldQuestions",
        active: (path) => path === "/eval/field-questions",
        description: "审定访问日志里反复出现的业务问法。"
      },
      {
        id: "eval-security-candidates",
        label: "安全评测候选",
        to: "/eval/security-candidates",
        iconKey: "securityEval",
        active: (path) => path === "/eval/security-candidates",
        description: "从访问拒绝日志中提取权限与数据隔离场景。"
      }
    ]
  },
  {
    id: "governance",
    title: "访问治理",
    items: [
      {
        id: "admin-agents",
        label: "Agent",
        to: "/admin/agents",
        iconKey: "agents",
        active: (path) => path.startsWith("/admin/agents"),
        description: "管理 Agent 身份、角色、Token 及数据访问边界。"
      },
      {
        id: "admin-tokens",
        label: "Token 凭据",
        to: "/admin/tokens",
        iconKey: "tokens",
        active: (path) => path === "/admin/tokens" || path.startsWith("/admin/tokens/"),
        description: "全局查看、签发与定向吊销 Agent 访问凭据。"
      },
      {
        id: "admin-roles",
        label: "角色权限",
        to: "/admin/roles",
        iconKey: "roles",
        active: (path) => path.startsWith("/admin/roles"),
        description: "管理角色的数据库连接、数据表与 MCP 工具授权范围。"
      },
      {
        id: "admin-audit",
        label: "访问日志",
        to: "/admin/audit",
        iconKey: "audit",
        active: (path) => path === "/admin/audit" || path.startsWith("/admin/audit/"),
        description: "按问询和工具调用追溯 Agent 访问行为。"
      },
      {
        id: "admin-mcp-playground",
        label: "MCP 调试台",
        to: "/admin/mcp-playground",
        iconKey: "mcpPlayground",
        active: (path) => path === "/admin/mcp-playground",
        description: "检查 Agent 能不能连上，或者能不能查某张表。"
      },
      {
        id: "admin-config-audit",
        label: "配置审计",
        to: "/admin/config-audit",
        iconKey: "configAudit",
        active: (path) => path === "/admin/config-audit",
        description: "查看各类配置与内容资产的写入记录。"
      }
    ]
  },
  {
    id: "system-settings",
    title: "系统设置",
    items: [
      {
        id: "admin-branding",
        label: "品牌外观",
        to: "/admin/branding",
        iconKey: "branding",
        active: (path) => path === "/admin/branding",
        description: "配置客户 Logo、产品名称与品牌副标题。"
      },
      {
        id: "admin-accounts",
        label: "登录账户",
        to: "/admin/admins",
        iconKey: "admins",
        active: (path) => path === "/admin/admins",
        description: "管理 WebUI 登录账户。"
      }
    ]
  }
];
`;

const HANDBOOK_OK = `# Project Lucy 系统使用与运维手册

| 项 | 内容 |
| --- | --- |
| 文档类型 | System Handbook |

## 目录

- [0. 常见问题速查](#0-常见问题速查)
  - [0.1 面向开发者](#01-面向开发者)
- [1. 系统概述与架构拓扑](#1-系统概述与架构拓扑)
  - [1.5 WebUI 入口速查](#15-webui-入口速查)

## 0. 常见问题速查

### 0.1 面向开发者

| 问题 | 快速答案 | 详见 |
| --- | --- | --- |
| 评测用例和运行历史在哪里？ | 在 \`/eval/cases\` 维护套件。 | [3.6 质量评测](#36-质量评测) |

## 1. 系统概述与架构拓扑

### 1.5 WebUI 入口速查

| 分组 | 二级菜单 | 路径 | 一句话用途 |
| --- | --- | --- | --- |
| 运行状态 | 系统概览 | \`/overview\` | 系统可用性。 |
| 运行状态 | 调用监控 | \`/ops/calls\` | MCP 工具调用量。 |
| 运行状态 | 使用概况 | \`/admin/usage\` | Agent / Token / 表活跃率。 |
| 数据接入 | 连接概览 | \`/connections\` | 管理连接与 Schema。 |
| 数据接入 | 启用表范围 | \`/connections/enabled-tables\` | 启用表范围配置。 |
| 业务上下文 | 语义资产 | \`/catalog\` | 语义资产。 |
| 业务上下文 | 业务 Wiki | \`/wiki\` | 业务文档。 |
| 业务上下文 | 业务 Skill | \`/skills\` | Skill 资产。 |
| 语义发布 | 发布工作台 | \`/publish/workbench\` | 校验与发布。 |
| 语义发布 | 发布记录 | \`/publish/history\` | 发布历史。 |
| 质量评测 | 评测用例 | \`/eval/cases\` | 评测用例。 |
| 质量评测 | 运行历史 | \`/eval/runs\` | 运行历史。 |
| 质量评测 | 趋势监控 | \`/eval/monitor\` | 趋势监控。 |
| 质量评测 | 现场提问 | \`/eval/field-questions\` | 现场提问。 |
| 质量评测 | 安全评测候选 | \`/eval/security-candidates\` | 安全评测候选。 |
| 访问治理 | Agent | \`/admin/agents\` | Agent 管理。 |
| 访问治理 | Token | \`/admin/tokens\` | Token 凭据。 |
| 访问治理 | 角色权限 | \`/admin/roles\` | 角色权限。 |
| 访问治理 | 访问日志 | \`/admin/audit\` | 访问日志。 |
| 访问治理 | MCP 调试台 | \`/admin/mcp-playground\` | MCP 调试台。 |
| 访问治理 | 配置审计 | \`/admin/config-audit\` | 配置审计。 |
| 系统设置 | 品牌外观 | \`/admin/branding\` | 品牌外观。 |
| 系统设置 | 登录账户 | \`/admin/admins\` | 登录账户。 |

### 1.6 产品架构图

酌情占位。
`;

function makeFixtureRepo(files) {
  const tmp = mkdtempSync(path.join(tmpdir(), "handbook-coverage-test-"));
  for (const [relPath, content] of Object.entries(files)) {
    const fullPath = path.join(tmp, relPath);
    mkdirSync(path.dirname(fullPath), { recursive: true });
    writeFileSync(fullPath, content);
  }
  return tmp;
}

function withFixture(files, fn) {
  const tmp = makeFixtureRepo(files);
  try {
    return fn(tmp);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

const REQUIRED_PATHS = [
  "/admin/mcp-playground",
  "/admin/branding",
  "/admin/usage",
  "/eval/field-questions",
  "/publish/workbench",
  "/publish/history"
];

test("readNavEntries parses a fixture navigation.ts and resolves the topLevelEntry reference", () => {
  withFixture({ "webui/src/app/navigation.ts": NAV_FIXTURE }, (tmp) => {
    const entries = readNavEntries(path.join(tmp, "webui/src/app/navigation.ts"));
    // 3+2+3+2+5+6+2 = 23 entries, mirroring the real nav file.
    assert.equal(entries.length, 23);
    // Include every key path required by the brief.
    for (const p of REQUIRED_PATHS) {
      assert.ok(
        entries.some((e) => e.to === p),
        `expected fixture to include ${p}`
      );
    }
    // Identifier reference (`topLevelEntry`) must resolve to its full NavItem shape.
    const overview = entries.find((e) => e.to === "/overview");
    assert.ok(overview, "expected /overview entry to be resolved from topLevelEntry reference");
    assert.equal(overview.label, "系统概览");
    assert.equal(overview.groupId, "runtime-status");
    // Spot-check a deep entry shape.
    const mcp = entries.find((e) => e.to === "/admin/mcp-playground");
    assert.equal(mcp.label, "MCP 调试台");
    assert.equal(mcp.groupTitle, "访问治理");
    // Order matches navGroups declaration order.
    assert.equal(entries[0].to, "/overview");
    assert.equal(entries[entries.length - 1].to, "/admin/admins");
  });
});

test("parseHandbookSectionAnchors extracts every [label](#anchor) link from the §目录 block", () => {
  const anchors = parseHandbookSectionAnchors(HANDBOOK_OK);
  assert.deepEqual(anchors, [
    { anchor: "0-常见问题速查", label: "0. 常见问题速查" },
    { anchor: "01-面向开发者", label: "0.1 面向开发者" },
    { anchor: "1-系统概述与架构拓扑", label: "1. 系统概述与架构拓扑" },
    { anchor: "15-webui-入口速查", label: "1.5 WebUI 入口速查" }
  ]);
});

test("findHandbookSectionReferences returns the line numbers where a known nav path occurs", () => {
  const toKeys = ["/admin/mcp-playground", "/admin/branding"];
  const hits = findHandbookSectionReferences(HANDBOOK_OK, toKeys);
  const mcpHits = hits.get("/admin/mcp-playground");
  assert.ok(mcpHits.length >= 1, "expected at least one match for /admin/mcp-playground");
  // The §1.5 row contains the path with backticks — `line.includes(to)` matches both.
  const brandingHits = hits.get("/admin/branding");
  assert.ok(brandingHits.length >= 1, "expected at least one match for /admin/branding");
  // Unknown routes yield an empty hits array.
  const unknownHits = findHandbookSectionReferences(HANDBOOK_OK, ["/this/does/not/exist"]);
  assert.deepEqual(unknownHits.get("/this/does/not/exist"), []);
});

test("assertCoverage passes when §1.5, §0 FAQ and body coverage all agree", () => {
  const navEntries = readNavEntries; // not called — pure structural fixture below.
  const entries = [
    { id: "a", label: "A", to: "/foo", groupId: "g", groupTitle: "G" },
    { id: "b", label: "B", to: "/bar", groupId: "g", groupTitle: "G" }
  ];
  const section15Paths = new Set(["/foo", "/bar"]);
  const faqPaths = new Set();
  const pathHits = new Map([
    ["/foo", [1]],
    ["/bar", [2]]
  ]);
  const covered = assertCoverage(entries, section15Paths, faqPaths, pathHits);
  assert.equal(covered, 2);
});

test("assertCoverage throws CoverageError when /admin/branding has no coverage at all", () => {
  const entries = [
    { id: "overview", label: "系统概览", to: "/overview", groupId: "runtime", groupTitle: "运行状态" },
    { id: "mcp", label: "MCP 调试台", to: "/admin/mcp-playground", groupId: "gov", groupTitle: "访问治理" },
    {
      id: "branding",
      label: "品牌外观",
      to: "/admin/branding",
      groupId: "sys",
      groupTitle: "系统设置"
    }
  ];
  // Cover everything EXCEPT branding.
  const section15Paths = new Set(["/overview", "/admin/mcp-playground"]);
  const faqPaths = new Set();
  const pathHits = new Map([
    ["/overview", [10]],
    ["/admin/mcp-playground", [11]],
    ["/admin/branding", []]
  ]);
  assert.throws(
    () => assertCoverage(entries, section15Paths, faqPaths, pathHits),
    (err) => {
      assert.ok(err instanceof CoverageError, `expected CoverageError, got ${err && err.name}`);
      assert.equal(err.name, "CoverageError");
      assert.match(err.message, /missing-section/);
      assert.match(err.message, /品牌外观/);
      assert.match(err.message, /\/admin\/branding/);
      return true;
    }
  );
});

test("assertCoverage passes when only the §1.5 row covers the entry (criterion A is sufficient)", () => {
  // A is sufficient on its own: the §1.5 row is the authoritative sidebar map.
  const entries = [
    { id: "x", label: "X", to: "/foo", groupId: "g", groupTitle: "G" },
    { id: "y", label: "Y", to: "/bar", groupId: "g", groupTitle: "G" }
  ];
  const section15Paths = new Set(["/foo", "/bar"]); // covered by A
  const faqPaths = new Set(); // not covered by C
  const pathHits = new Map(); // not covered by B (no body hit)
  const covered = assertCoverage(entries, section15Paths, faqPaths, pathHits);
  assert.equal(covered, 2);
});

test("runHandbookCoverage on the real repo passes with the current 23 entries", () => {
  // Regression test: ensures the gate accepts the actual `webui/src/app/navigation.ts`
  // + `docs/SYSTEM_HANDBOOK.md` shipped in the working tree.
  const result = runHandbookCoverage(ROOT);
  assert.ok(result.covered >= 23, `expected ≥23 nav entries covered, got ${result.covered}`);
  assert.ok(
    result.navEntries.some((e) => e.to === "/admin/branding"),
    "expected /admin/branding to be present in real navigation.ts"
  );
  assert.ok(
    result.navEntries.some((e) => e.to === "/admin/mcp-playground"),
    "expected /admin/mcp-playground to be present in real navigation.ts"
  );
});

test("CoverageError.name is stable and instance of Error", () => {
  const err = new CoverageError("boom");
  assert.ok(err instanceof Error);
  assert.ok(err instanceof CoverageError);
  assert.equal(err.name, "CoverageError");
  assert.equal(err.message, "boom");
});

test("findFaqSectionReferences collects every nav path that appears inside §0 常见问题速查", () => {
  const toKeys = ["/eval/cases", "/admin/branding", "/unknown"];
  const faqPaths = findFaqSectionReferences(HANDBOOK_OK, toKeys);
  assert.ok(faqPaths.has("/eval/cases"), "expected /eval/cases to be found in §0 FAQ");
  assert.ok(!faqPaths.has("/admin/branding"), "expected /admin/branding NOT to be in §0 FAQ");
  assert.ok(!faqPaths.has("/unknown"));
});

test("parseSection15Paths returns the cleaned path set from the §1.5 table", () => {
  const paths = parseSection15Paths(HANDBOOK_OK);
  assert.ok(paths.has("/admin/mcp-playground"));
  assert.ok(paths.has("/admin/branding"));
  assert.ok(paths.has("/eval/field-questions"));
  assert.ok(paths.has("/publish/history"));
  // Backticks should be stripped: the table cell is `/overview`, not `` `/overview` ``.
  assert.ok(paths.has("/overview"));
});
