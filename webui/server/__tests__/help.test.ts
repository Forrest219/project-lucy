import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { navGroups, topLevelEntry } from "../../src/app/navigation";
import { handbookPathForTests, parseHelpToc, readHelpHandbook, searchHelpHandbook, searchHelpMarkdown, HelpQueryTooLongError } from "../help";

let projectRoot: string | undefined;
let appRoot: string | undefined;
let previousRoot: string | undefined;
let previousAppRoot: string | undefined;

async function makeRoot(prefix: string, markdown?: string) {
  const root = await mkdtemp(path.join(os.tmpdir(), prefix));
  if (markdown !== undefined) {
    await mkdir(path.join(root, "docs"), { recursive: true });
    await writeFile(handbookPathForTests(root), markdown, "utf8");
  }
  return root;
}

async function makeProject() {
  projectRoot = await makeRoot("lucy-help-project-");
  await writeFile(path.join(projectRoot, "ktx.yaml"), "connections: {}\n", "utf8");
}

beforeEach(() => {
  previousRoot = process.env.KTX_PROJECT_ROOT;
  previousAppRoot = process.env.LUCY_APP_ROOT;
  vi.resetModules();
});

afterEach(async () => {
  if (previousRoot === undefined) {
    delete process.env.KTX_PROJECT_ROOT;
  } else {
    process.env.KTX_PROJECT_ROOT = previousRoot;
  }
  if (previousAppRoot === undefined) {
    delete process.env.LUCY_APP_ROOT;
  } else {
    process.env.LUCY_APP_ROOT = previousAppRoot;
  }
  if (projectRoot) {
    await rm(projectRoot, { recursive: true, force: true });
    projectRoot = undefined;
  }
  if (appRoot) {
    await rm(appRoot, { recursive: true, force: true });
    appRoot = undefined;
  }
});

async function buildFreshServer() {
  const { buildServer } = await import("../index");
  return buildServer();
}

describe("Help handbook", () => {
  it("parses H1-H3 headings into a stable TOC", () => {
    const toc = parseHelpToc([
      "# Project Lucy 系统使用与运维手册",
      "## 0. 常见问题速查",
      "## 1. 系统概述与架构拓扑",
      "### 1.1 Lucy 是什么",
      "## 4. Agent / 客户端接入指南",
      "### 4.2 Codex / Claude Code `.mcp.json`",
      "```bash",
      "# 1. 这不是标题",
      "```",
      "#### ignored",
      "plain text"
    ].join("\n"));

    expect(toc).toEqual([
      { id: "faq-quick-reference", level: 2, title: "0. 常见问题速查" },
      { id: "system-overview", level: 2, title: "1. 系统概述与架构拓扑" },
      { id: expect.any(String), level: 3, title: "1.1 Lucy 是什么" },
      { id: "mcp-integration", level: 2, title: "4. Agent / 客户端接入指南" },
      { id: "codex-claude-code-mcp-json", level: 3, title: "4.2 Codex / Claude Code `.mcp.json`" }
    ]);
  });

  it("exposes stable aliases for the YAML delivery runbook section tree", () => {
    const toc = parseHelpToc([
      "### 3.7 YAML 文件规范与交付验收",
      "#### 3.7.1 YAML 类型总览",
      "#### 3.7.2 Schema manifest 规范",
      "#### 3.7.3 Manifest augmentation overlay 规范",
      "#### 3.7.4 New semantic source 规范",
      "#### 3.7.5 描述字段规范",
      "#### 3.7.6 GO / NO-GO 交付 checklist",
      "##### 3.7.6.1 静态文件检查",
      "#### 3.7.7 常见错误与诊断 Runbook",
      "#### 3.7.8 Agent 自检协议"
    ].join("\n"));

    expect(toc).toEqual([
      { id: "yaml-delivery-runbook", level: 3, title: "3.7 YAML 文件规范与交付验收" },
      { id: "yaml-type-overview", level: 3, title: "3.7.1 YAML 类型总览" },
      { id: "yaml-schema-manifest", level: 3, title: "3.7.2 Schema manifest 规范" },
      { id: "yaml-augmentation-overlay", level: 3, title: "3.7.3 Manifest augmentation overlay 规范" },
      { id: "yaml-new-semantic-source", level: 3, title: "3.7.4 New semantic source 规范" },
      { id: "yaml-description-fields", level: 3, title: "3.7.5 描述字段规范" },
      { id: "yaml-delivery-checklist", level: 3, title: "3.7.6 GO / NO-GO 交付 checklist" },
      { id: "yaml-common-errors", level: 3, title: "3.7.7 常见错误与诊断 Runbook" },
      { id: "yaml-agent-self-check", level: 3, title: "3.7.8 Agent 自检协议" }
    ]);
  });

  it("exposes stable level-4 aliases for the database connection operations runbook", () => {
    const toc = parseHelpToc([
      "### 3.2 数据库接入",
      "#### 刷新本地目录",
      "#### 连接概览指标说明",
      "#### WebUI 与 ktx.yaml 的职责边界",
      "#### 连接形态与配置字段",
      "#### 新增数据库连接（运维 Runbook）",
      "#### Agent 可见性与 ACL 同步"
    ].join("\n"));

    expect(toc).toEqual([
      { id: "database-connections", level: 3, title: "3.2 数据库接入" },
      { id: "catalog-reload", level: 4, title: "刷新本地目录" },
      { id: "connection-overview-metrics", level: 4, title: "连接概览指标说明" },
      { id: "database-connection-boundary", level: 4, title: "WebUI 与 ktx.yaml 的职责边界" },
      { id: "database-connection-shapes", level: 4, title: "连接形态与配置字段" },
      {
        id: "database-connection-operations-runbook",
        level: 4,
        title: "新增数据库连接（运维 Runbook）"
      },
      { id: "database-connection-acl-sync", level: 4, title: "Agent 可见性与 ACL 同步" }
    ]);
  });

  it("ignores level-4 headings that are not part of the database ops section", () => {
    const toc = parseHelpToc([
      "### 3.2 数据库接入",
      "#### 一些未知子节",
      "#### another unknown sub heading"
    ].join("\n"));

    expect(toc).toEqual([
      { id: "database-connections", level: 3, title: "3.2 数据库接入" }
    ]);
  });

  it("maps §0 sub-sections to stable alias ids", () => {
    const toc = parseHelpToc([
      "## 0. 常见问题速查",
      "",
      "本节是按用户问题组织的快速入口。",
      "",
      "### 0.1 面向开发者",
      "",
      "| Q | A |",
      "|---|---|",
      "| foo | bar |",
      "",
      "### 0.2 面向管理员",
      "",
      "### 0.3 面向接入协作者"
    ].join("\n"));

    const byTitle = Object.fromEntries(toc.map((t) => [t.title, t.id]));
    expect(byTitle["0. 常见问题速查"]).toBe("faq-quick-reference");
    expect(byTitle["0.1 面向开发者"]).toBe("faq-developer");
    expect(byTitle["0.2 面向管理员"]).toBe("faq-admin");
    expect(byTitle["0.3 面向接入协作者"]).toBe("faq-agent-integration");
  });

  it("maps §1.5 WebUI Entry Map to the webui-entry-map alias id", () => {
    const toc = parseHelpToc([
      "## 1. 系统概述与架构拓扑",
      "",
      "### 1.1 Lucy 是什么",
      "",
      "### 1.4 目录与事实源地图",
      "",
      "### 1.5 WebUI 入口速查（6+1 侧栏地图）",
      "",
      "| 分组 | 二级菜单 | 路径 | 一句话用途 |",
      "| --- | --- | --- | --- |",
      "| 系统概览 | 系统概览 | `/overview` | 顶部入口 |"
    ].join("\n"));

    const entry = toc.find((t) => t.id === "webui-entry-map");
    expect(entry).toBeDefined();
    expect(entry?.level).toBe(3);
    expect(entry?.title).toBe("1.5 WebUI 入口速查（6+1 侧栏地图）");
  });

  it("does not regress the §0 / §3 / §6 anchor set when §1.5 is added", () => {
    const baseline = parseHelpToc([
      "## 0. 常见问题速查",
      "",
      "### 0.1 面向开发者",
      "",
      "### 0.2 面向管理员",
      "",
      "### 0.3 面向接入协作者",
      "",
      "## 3. 功能模块操作指南",
      "",
      "### 3.1 部署向导与上线检查",
      "",
      "## 6. FAQ 与排障指南",
      "",
      "### 6.1 为什么提示\"未发现本地 manifest\"？"
    ].join("\n"));
    const baselineIds = new Set(baseline.map((t) => t.id));

    const extended = parseHelpToc([
      "## 0. 常见问题速查",
      "",
      "### 0.1 面向开发者",
      "",
      "### 0.2 面向管理员",
      "",
      "### 0.3 面向接入协作者",
      "",
      "## 1. 系统概述与架构拓扑",
      "",
      "### 1.1 Lucy 是什么",
      "",
      "### 1.5 WebUI 入口速查（6+1 侧栏地图）",
      "",
      "## 3. 功能模块操作指南",
      "",
      "### 3.1 部署向导与上线检查",
      "",
      "## 6. FAQ 与排障指南",
      "",
      "### 6.1 为什么提示\"未发现本地 manifest\"？"
    ].join("\n"));
    const extendedIds = new Set(extended.map((t) => t.id));

    for (const id of baselineIds) {
      expect(extendedIds.has(id), `expected anchor "${id}" to remain after §1.5 added`).toBe(true);
    }
    expect(extendedIds.has("webui-entry-map")).toBe(true);
  });

  it("also routes the legacy §0.3 alias variants to faq-agent-integration", () => {
    // 防止标题回退到旧文案时 alias 失效；regex 必须覆盖三种写法。
    const toc = parseHelpToc([
      "### 0.3 面向接入 Agent 的协作者"
    ].join("\n"));
    expect(toc[0]?.id).toBe("faq-agent-integration");

    const toc2 = parseHelpToc([
      "### 0.3 接入 Agent 的协作者"
    ].join("\n"));
    expect(toc2[0]?.id).toBe("faq-agent-integration");
  });

  it("reads only the bundled docs/SYSTEM_HANDBOOK.md and returns the API envelope", async () => {
    await makeProject();
    appRoot = await makeRoot("lucy-help-app-", [
      "# Project Lucy 系统使用与运维手册",
      "",
      "## 1. 系统概述与架构拓扑",
      "",
      "正文",
      "",
      "### 1.1 Lucy 是什么"
    ].join("\n"));
    process.env.KTX_PROJECT_ROOT = projectRoot;
    process.env.LUCY_APP_ROOT = appRoot;

    const app = await buildFreshServer();
    await app.ready();

    const response = await request(app.server)
      .get("/api/help/handbook?path=../../.ktx/secrets/token")
      .expect(200);

    expect(response.body).toMatchObject({
      ok: true,
      data: {
        id: "system-handbook",
        title: "Project Lucy 系统使用与运维手册",
        sourcePath: "docs/SYSTEM_HANDBOOK.md"
      }
    });
    expect(response.body.data.markdown).toContain("## 1. 系统概述与架构拓扑");
    expect(response.body.data.etag).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(response.body.data.updatedAt).toMatch(/T/);
    expect(response.body.data.toc).toEqual(
      expect.arrayContaining([
        { id: "system-overview", level: 2, title: "1. 系统概述与架构拓扑" }
      ])
    );

    await app.close();
  });

  it("throws ERR_HELP_DOC_NOT_FOUND when the fixed handbook is missing", async () => {
    await makeProject();
    appRoot = await makeRoot("lucy-help-app-");
    process.env.KTX_PROJECT_ROOT = projectRoot;
    process.env.LUCY_APP_ROOT = appRoot;

    await expect(readHelpHandbook(appRoot)).rejects.toMatchObject({
      code: "ERR_HELP_DOC_NOT_FOUND",
      statusCode: 404
    });

    const app = await buildFreshServer();
    await app.ready();
    const response = await request(app.server).get("/api/help/handbook").expect(404);

    expect(response.body).toEqual({
      ok: false,
      error: {
        code: "ERR_HELP_DOC_NOT_FOUND",
        message: "docs/SYSTEM_HANDBOOK.md was not found"
      }
    });

    await app.close();
  });

  it("exposes the YAML delivery runbook anchors and content markers via the API", async () => {
    const fixture = [
      "# Project Lucy 系统使用与运维手册",
      "",
      "## 1. 系统概述与架构拓扑",
      "",
      "Lucy 本地语义补充工作台。",
      "",
      "## 3.7 YAML 文件规范与交付验收",
      "",
      "事故教训：reindex 成功不等于交付成功。",
      "",
      "### 3.7.1 YAML 类型总览",
      "",
      "7 类 YAML 文件。",
      "",
      "### 3.7.2 Schema manifest 规范",
      "",
      "manifest 顶层 `tables:`，物理列用 `descriptions:`。",
      "",
      "### 3.7.3 Manifest augmentation overlay 规范",
      "",
      "overlay 文件名 = manifest source name，默认无 `table:`。",
      "",
      "### 3.7.4 New semantic source 规范",
      "",
      "new source 是高级操作，必须同步 ACL。",
      "",
      "### 3.7.5 描述字段规范",
      "",
      "物理列用 `descriptions:`，measure 用 `description:`。",
      "",
      "### 3.7.6 GO / NO-GO 交付 checklist",
      "",
      "静态、KTX、真实 query、MCP smoke 四道关。",
      "",
      "### 3.7.7 常见错误与诊断 Runbook",
      "",
      "`Unrecognized key: \"description\"` 等症状速查。",
      "",
      "### 3.7.8 Agent 自检协议",
      "",
      "Agent 必须按 GO / NO-GO 输出模板给结论。"
    ].join("\n");

    appRoot = await makeRoot("lucy-help-yaml-fixture-", fixture);
    process.env.LUCY_APP_ROOT = appRoot;

    const handbook = await readHelpHandbook(appRoot);

    expect(handbook.markdown).toContain("reindex 成功");
    expect(handbook.markdown).toContain("GO / NO-GO");
    expect(handbook.markdown).toContain("Manifest augmentation overlay");
    expect(handbook.toc).toEqual(
      expect.arrayContaining([
        { id: "yaml-delivery-runbook", level: 2, title: "3.7 YAML 文件规范与交付验收" },
        { id: "yaml-augmentation-overlay", level: 3, title: "3.7.3 Manifest augmentation overlay 规范" },
        { id: "yaml-delivery-checklist", level: 3, title: "3.7.6 GO / NO-GO 交付 checklist" },
        { id: "yaml-agent-self-check", level: 3, title: "3.7.8 Agent 自检协议" }
      ])
    );
  });

  it("the bundled handbook declares reindex success is not delivery success", async () => {
    // Resolved from the test file location, this is the real on-disk handbook shipped with the app.
    // Test file lives at <root>/webui/server/__tests__/help.test.ts → walk up to <root>/.
    const realAppRoot = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "../../.."
    );
    const handbook = await readHelpHandbook(realAppRoot);

    expect(handbook.markdown).toMatch(/reindex.*?不(等于|代表)/u);
    expect(handbook.markdown).toContain("GO / NO-GO");
    expect(handbook.markdown).toContain("Manifest augmentation overlay");
    expect(handbook.markdown).toContain("Agent 自检协议");
    expect(handbook.toc).toEqual(
      expect.arrayContaining([
        { id: "yaml-delivery-runbook", level: 3, title: "3.7 YAML 文件规范与交付验收" },
        { id: "yaml-augmentation-overlay", level: 3, title: "3.7.3 Manifest augmentation overlay 规范" },
        { id: "yaml-delivery-checklist", level: 3, title: "3.7.6 GO / NO-GO 交付 checklist" },
        { id: "yaml-agent-self-check", level: 3, title: "3.7.8 Agent 自检协议" }
      ])
    );
  });

  it("the bundled handbook entry map mirrors the current navigation directory", async () => {
    const realAppRoot = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "../../.."
    );
    const handbook = await readHelpHandbook(realAppRoot);
    const lines = handbook.markdown.split("\n");
    const tableHeaderIndex = lines.indexOf("| 分组 | 二级菜单 | 路径 | 一句话用途 |");
    expect(tableHeaderIndex).toBeGreaterThanOrEqual(0);

    const expectedItems = [topLevelEntry, ...navGroups.flatMap((group) => group.items)];
    const expectedGroups = [
      topLevelEntry.label,
      ...navGroups.flatMap((group) => group.items.map(() => group.title))
    ];

    const rows = lines.slice(tableHeaderIndex + 2, tableHeaderIndex + 2 + expectedItems.length).map((line) =>
      line
        .split("|")
        .slice(1, -1)
        .map((cell) => cell.replaceAll("`", "").trim())
    );

    expect(rows).toHaveLength(expectedItems.length);
    rows.forEach((cells, index) => {
      expect(cells).toEqual([
        expectedGroups[index],
        expectedItems[index]?.label,
        expectedItems[index]?.to,
        expectedItems[index]?.description
      ]);
    });
  });

  it("the bundled handbook documents the database connection operations runbook", async () => {
    const realAppRoot = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "../../.."
    );
    const handbook = await readHelpHandbook(realAppRoot);

    // Content markers — operations runbook must be self-contained and explicit.
    expect(handbook.markdown).toContain("WebUI 不负责新建物理数据库连接");
    expect(handbook.markdown).toContain("新增数据库连接（运维 Runbook）");
    expect(handbook.markdown).toContain("Agent 可见性与 ACL 同步");
    expect(handbook.markdown).toContain("连接形态与配置字段");
    expect(handbook.markdown).toContain("WebUI 与 ktx.yaml 的职责边界");
    expect(handbook.markdown).toContain("刷新本地目录");
    expect(handbook.markdown).toContain("/help?section=catalog-reload");
    expect(handbook.markdown).toContain("当前 `scan.enrichment`、LLM 和 embedding 配置涉及的外部数据流已获得客户 / 数据 Owner 授权");
    expect(handbook.markdown).toContain("docker compose exec lucy ktx --project-dir /data/lucy ingest <connection-id>");
    // Catalog Reload must not be conflated with physical scanning / ingest.
    expect(handbook.markdown).toContain("不会连接物理数据库扫描新表");
    expect(handbook.markdown).toContain("不会替代 `ktx ingest`");
    // Credential safety: every `password:` line in the bundled doc must use a
    // safe reference (file:, env:, or placeholder), never an inline secret.
    const passwordLines = handbook.markdown.match(/password:\s+[^\n]+/g) ?? [];
    expect(passwordLines.length).toBeGreaterThan(0);
    for (const line of passwordLines) {
      expect(line).toMatch(/^password:\s+(file:|env:|<)/);
    }
    // Spot-check the documented placeholders are present so the safety rule
    // has something concrete to assert against.
    expect(handbook.markdown).toContain("file:<PROJECT_ROOT>/.ktx/secrets/<connection-id>-password");
    expect(handbook.markdown).toContain("file:/data/lucy/.ktx/secrets/<connection-id>-password");
    // Stable anchors for the new section tree.
    expect(handbook.toc).toEqual(
      expect.arrayContaining([
        { id: "database-connections", level: 3, title: "3.2 数据库接入" },
        { id: "catalog-reload", level: 4, title: "刷新本地目录" },
        {
          id: "database-connection-boundary",
          level: 4,
          title: "WebUI 与 ktx.yaml 的职责边界"
        },
        { id: "database-connection-shapes", level: 4, title: "连接形态与配置字段" },
        {
          id: "database-connection-operations-runbook",
          level: 4,
          title: "新增数据库连接（运维 Runbook）"
        },
        { id: "database-connection-acl-sync", level: 4, title: "Agent 可见性与 ACL 同步" }
      ])
    );
  });

  it("maps deployment checklist sub-section to overview-action-required", () => {
    const toc = parseHelpToc(
      ["### 3.1 部署向导与上线检查", "", "#### 系统概览待处理事项", "", "### 3.2 数据库接入"].join(
        "\n"
      )
    );

    expect(toc).toEqual(
      expect.arrayContaining([
        { id: "deployment-checklist", level: 3, title: "3.1 部署向导与上线检查" },
        { id: "overview-action-required", level: 4, title: "系统概览待处理事项" },
        { id: "database-connections", level: 3, title: "3.2 数据库接入" }
      ])
    );
  });

  it("the bundled handbook documents overview action-required counting", async () => {
    const realAppRoot = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "../../.."
    );
    const handbook = await readHelpHandbook(realAppRoot);

    expect(handbook.markdown).toContain("#### 系统概览待处理事项");
    expect(handbook.markdown).toContain("N 张表待补语义");
    expect(handbook.markdown).toContain("当前实现与「待补语义」使用同一公式");
    // Task 4: old limit=1 limitation removed; handbook now documents the real 30-day contract
    expect(handbook.markdown).toContain("GET /api/eval/runs/summary?days=30");
    expect(handbook.markdown).toContain(
      "`/overview`「待处理事项」里「N 张表待补语义」怎么算？"
    );
    expect(handbook.toc).toEqual(
      expect.arrayContaining([
        { id: "deployment-checklist", level: 3, title: "3.1 部署向导与上线检查" },
        { id: "overview-action-required", level: 4, title: "系统概览待处理事项" }
      ])
    );
  });

  it("maps semantic authoring sub-sections to stable alias ids", () => {
    const toc = parseHelpToc([
      "### 3.3 语义层维护",
      "",
      "#### 语义状态与启用表范围状态",
      "",
      "#### 为什么要编写语义 YAML",
      "",
      "#### 推荐编写工作流",
      "",
      "#### grain、join 与 fanout",
      "",
      "#### overlay 常见字段速查",
      "",
      "#### KTX 官方延伸阅读"
    ].join("\n"));

    const byTitle = Object.fromEntries(toc.map((t) => [t.title, t.id]));
    expect(byTitle["语义状态与启用表范围状态"]).toBe("semantic-status-and-enabled-status");
    expect(byTitle["为什么要编写语义 YAML"]).toBe("semantic-yaml-why");
    expect(byTitle["推荐编写工作流"]).toBe("semantic-authoring-workflow");
    expect(byTitle["grain、join 与 fanout"]).toBe("semantic-grain-fanout");
    expect(byTitle["overlay 常见字段速查"]).toBe("semantic-overlay-fields");
    expect(byTitle["KTX 官方延伸阅读"]).toBe("ktx-further-reading");
  });

  it("maps admin audit hot/cold store sub-section to a stable alias id", () => {
    const toc = parseHelpToc(
      [
        "### 3.5 访问治理 Admin",
        "",
        "#### 什么时候配置角色、Agent 和 Token",
        "",
        "#### 问询记录与调用流水怎么选、怎么导出",
        "",
        "#### 审计热库与冷库（SQL 留存边界）",
        "",
        "### 3.6 质量评测 Eval"
      ].join("\n")
    );
    const byTitle = Object.fromEntries(toc.map((t) => [t.title, t.id]));
    expect(byTitle["3.5 访问治理 Admin"]).toBe("admin-governance");
    expect(byTitle["什么时候配置角色、Agent 和 Token"]).toBe("admin-role-agent-token-guide");
    expect(byTitle["问询记录与调用流水怎么选、怎么导出"]).toBe("admin-audit-turns-vs-calls");
    expect(byTitle["审计热库与冷库（SQL 留存边界）"]).toBe("admin-audit-hot-cold-store");
    expect(byTitle["3.6 质量评测 Eval"]).toBe("eval");
    expect(toc).toEqual(
      expect.arrayContaining([
        {
          id: "admin-role-agent-token-guide",
          level: 4,
          title: "什么时候配置角色、Agent 和 Token"
        },
        {
          id: "admin-audit-turns-vs-calls",
          level: 4,
          title: "问询记录与调用流水怎么选、怎么导出"
        },
        {
          id: "admin-audit-hot-cold-store",
          level: 4,
          title: "审计热库与冷库（SQL 留存边界）"
        }
      ])
    );
  });

  it("the bundled handbook documents audit hot/cold store and SQL retention boundaries", async () => {
    const realAppRoot = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "../../.."
    );
    const handbook = await readHelpHandbook(realAppRoot);

    expect(handbook.markdown).toContain("#### 审计热库与冷库（SQL 留存边界）");
    expect(handbook.markdown).toContain("/help?section=admin-audit-hot-cold-store");
    expect(handbook.markdown).toContain("generated_sql");
    expect(handbook.markdown).toContain("生成 SQL");
    expect(handbook.markdown).toContain("调用流水里的「生成 SQL」从哪来？");
    expect(handbook.markdown).toContain("#### 问询记录与调用流水怎么选、怎么导出");
    expect(handbook.markdown).toContain("/help?section=admin-audit-turns-vs-calls");
    expect(handbook.markdown).toContain("导出问询记录");
    expect(handbook.markdown).toContain("导出调用流水");
    expect(handbook.markdown).toContain("audit-calls-YYYYMMDD-HHmmss-000001.csv");
    expect(handbook.markdown).toContain("字段说明");
    expect(handbook.markdown).toContain("ts_local");
    expect(handbook.toc).toEqual(
      expect.arrayContaining([
        { id: "admin-governance", level: 3, title: "3.5 访问治理 Admin" },
        {
          id: "admin-audit-turns-vs-calls",
          level: 4,
          title: "问询记录与调用流水怎么选、怎么导出"
        },
        {
          id: "admin-audit-hot-cold-store",
          level: 4,
          title: "审计热库与冷库（SQL 留存边界）"
        }
      ])
    );
  });

  it("the bundled handbook documents Role / Agent / Token user guidance", async () => {
    const realAppRoot = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "../../.."
    );
    const handbook = await readHelpHandbook(realAppRoot);

    expect(handbook.markdown).toContain("#### 什么时候配置角色、Agent 和 Token");
    expect(handbook.markdown).toContain("/help?section=admin-role-agent-token-guide");
    expect(handbook.markdown).toContain("一人一 `Agent`");
    expect(handbook.markdown).toContain("什么时候该建角色，什么时候该建 `Agent` / `Token`？");
    expect(handbook.markdown).toContain("同一人多台电脑要建几个 `Agent`？");
    expect(handbook.markdown).toContain(
      "会。`MCP` Proxy 在鉴权时校验 `expires_at`（不再只是 `metadata`）"
    );
    expect(handbook.markdown).not.toContain("要下线 `token` 必须在 `Admin` 撤销或调用删除 `token` `API`");
    expect(handbook.toc).toEqual(
      expect.arrayContaining([
        {
          id: "admin-role-agent-token-guide",
          level: 4,
          title: "什么时候配置角色、Agent 和 Token"
        }
      ])
    );
  });

  it("maps FAQ §6.10–6.14 semantic query troubleshooting to stable alias ids", () => {
    const toc = parseHelpToc(
      [
        "## 6. FAQ 与排障指南",
        "",
        "### 6.10 `lucy_query` 报 No join path / 跨表失败",
        "",
        "### 6.11 fanout / Aggregate locality 拒绝查询",
        "",
        "### 6.12 `order_by` 排序无效或排反",
        "",
        "### 6.13 语义查询答不出复杂分析题，或 Eval 对不上 gold",
        "",
        "### 6.14 改了 Manifest / Wiki，MCP 仍旧或 reindex 失败"
      ].join("\n")
    );
    const byTitle = Object.fromEntries(toc.map((t) => [t.title, t.id]));
    expect(byTitle["6.10 `lucy_query` 报 No join path / 跨表失败"]).toBe("lucy-query-no-join-path");
    expect(byTitle["6.11 fanout / Aggregate locality 拒绝查询"]).toBe("lucy-query-fanout-locality");
    expect(byTitle["6.12 `order_by` 排序无效或排反"]).toBe("lucy-query-order-by");
    expect(byTitle["6.13 语义查询答不出复杂分析题，或 Eval 对不上 gold"]).toBe("eval-semantic-vs-gold");
    expect(byTitle["6.14 改了 Manifest / Wiki，MCP 仍旧或 reindex 失败"]).toBe(
      "manifest-wiki-reindex-sync"
    );
  });

  it("maps §3.7.0 overlay field guide to yaml-overlay-field-guide", () => {
    const toc = parseHelpToc([
      "### 3.7 YAML 文件规范与交付验收",
      "",
      "#### 3.7.0 overlay 字段速查（编写辅导）",
      "",
      "#### 3.7.1 YAML 类型总览"
    ].join("\n"));

    expect(toc).toEqual(
      expect.arrayContaining([
        { id: "yaml-overlay-field-guide", level: 3, title: "3.7.0 overlay 字段速查（编写辅导）" },
        { id: "yaml-type-overview", level: 3, title: "3.7.1 YAML 类型总览" }
      ])
    );
  });

  it("maps 配置作者 Skills to config-author-skills", () => {
    const toc = parseHelpToc([
      "### 3.7 YAML 文件规范与交付验收",
      "",
      "#### 配置作者 Skills",
      "",
      "#### 3.7.0 overlay 字段速查（编写辅导）"
    ].join("\n"));

    expect(toc).toEqual(
      expect.arrayContaining([
        { id: "config-author-skills", level: 4, title: "配置作者 Skills" },
        { id: "yaml-overlay-field-guide", level: 3, title: "3.7.0 overlay 字段速查（编写辅导）" }
      ])
    );
  });

  it("the bundled handbook documents semantic YAML authoring guidance", async () => {
    const realAppRoot = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "../../.."
    );
    const handbook = await readHelpHandbook(realAppRoot);

    expect(handbook.markdown).toContain("#### 语义状态与启用表范围状态");
    expect(handbook.markdown).toContain("#### 为什么要编写语义 YAML");
    expect(handbook.markdown).toContain("#### 推荐编写工作流");
    expect(handbook.markdown).toContain("#### grain、join 与 fanout");
    expect(handbook.markdown).toContain("#### KTX 官方延伸阅读");
    expect(handbook.markdown).toContain("#### 3.7.0 overlay 字段速查（编写辅导）");
    expect(handbook.markdown).toContain("#### 配置作者 Skills");
    expect(handbook.markdown).toContain("lucy-config-package");
    expect(handbook.markdown).toContain("### 6.10 `lucy_query` 报 No join path / 跨表失败");
    expect(handbook.markdown).toContain("### 6.11 fanout / Aggregate locality 拒绝查询");
    expect(handbook.markdown).toContain("direction: desc");
    expect(handbook.markdown).toContain("fanout");
    expect(handbook.markdown).toContain("descriptions.human");
    expect(handbook.markdown).toContain("https://docs.kaelio.com/ktx/docs/guides/writing-context");
    expect(handbook.markdown).toContain(
      "https://docs.kaelio.com/ktx/docs/concepts/semantic-layer-internals"
    );
    expect(handbook.toc).toEqual(
      expect.arrayContaining([
        { id: "semantic-status-and-enabled-status", level: 4, title: "语义状态与启用表范围状态" },
        { id: "semantic-authoring-workflow", level: 4, title: "推荐编写工作流" },
        { id: "semantic-grain-fanout", level: 4, title: "grain、join 与 fanout" },
        { id: "ktx-further-reading", level: 4, title: "KTX 官方延伸阅读" },
        {
          id: "yaml-overlay-field-guide",
          level: 3,
          title: "3.7.0 overlay 字段速查（编写辅导）"
        },
        { id: "config-author-skills", level: 4, title: "配置作者 Skills" }
      ])
    );
  });

  it("the bundled handbook exposes a user-facing FAQ quick reference", async () => {
    const realAppRoot = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "../../.."
    );
    const handbook = await readHelpHandbook(realAppRoot);

    expect(handbook.markdown).toContain("## 0. 常见问题速查");
    expect(handbook.markdown).toContain("我在哪里新建数据库连接？");
    expect(handbook.markdown).toContain("`YAML` 改完后为什么 `Agent` 仍然搜不到新口径？");
    expect(handbook.markdown).toContain("`Agent` 返回 `Access denied` 时先查哪里？");
    expect(handbook.markdown).toContain("`expires_at` 到期后 `token` 会自动失效吗？");
    expect(handbook.markdown).toContain("问询记录和调用流水都能导出吗？");
    expect(handbook.markdown).toContain(
      "`/catalog` 的「语义状态」和 `/connections/enabled-tables` 的「状态」有什么关系？"
    );
    expect(handbook.markdown).toContain(
      "`/overview`「待处理事项」里「N 张表待补语义」怎么算？"
    );
    expect(handbook.markdown).toContain("连接概览上的「已发现表数」是什么？");
    expect(handbook.markdown).toContain("#### 连接概览指标说明");
    expect(handbook.markdown).toContain("已发现表数 / 服务器目录已发现表");
    expect(handbook.markdown).toContain("[系统概览待处理事项](#系统概览待处理事项)");
    expect(handbook.markdown).toContain("可以用编码代理自动生成语义 / Wiki / Eval 吗？");
    expect(handbook.markdown).toContain("[配置作者 Skills](#配置作者-skills)");
    expect(handbook.markdown).toContain("[3.7.6.2 KTX 合并与索引检查](#3762-ktx-合并与索引检查)");
    expect(handbook.toc).toEqual(
      expect.arrayContaining([
        { id: "faq-quick-reference", level: 2, title: "0. 常见问题速查" },
        { id: "overview-action-required", level: 4, title: "系统概览待处理事项" },
        { id: "connection-overview-metrics", level: 4, title: "连接概览指标说明" },
        { id: "semantic-status-and-enabled-status", level: 4, title: "语义状态与启用表范围状态" }
      ])
    );
  });
});

describe("Help search", () => {
  it("returns empty items for blank query without error", () => {
    expect(searchHelpMarkdown("# Title\n\n## Token 配置\n\nBearer token here.", "   ")).toEqual({
      query: "",
      items: []
    });
  });

  it("throws ERR_HELP_QUERY_TOO_LONG when query exceeds 80 characters", () => {
    const tooLong = "x".repeat(81);
    expect(() => searchHelpMarkdown("# Title\n\n## Section\n\nbody", tooLong)).toThrow(
      HelpQueryTooLongError
    );
    try {
      searchHelpMarkdown("# Title\n\n## Section\n\nbody", tooLong);
      expect.unreachable("expected HelpQueryTooLongError");
    } catch (error) {
      expect(error).toMatchObject({
        code: "ERR_HELP_QUERY_TOO_LONG",
        statusCode: 400
      });
    }
  });

  it("ranks title hits first and returns plain-text snippets", () => {
    const markdown = [
      "# Project Lucy 系统使用与运维手册",
      "",
      "## 访问治理 Admin",
      "",
      "这里只是顺带提到 token 一次。",
      "",
      "## Bearer Token 发行",
      "",
      "Token 明文只在创建 token 的 HTTP 响应出现一次。"
    ].join("\n");

    const result = searchHelpMarkdown(markdown, "token");
    expect(result.query).toBe("token");
    expect(result.items.length).toBeGreaterThanOrEqual(1);
    expect(result.items[0]?.sectionId).toBe("admin-tokens");
    expect(result.items[0]?.snippet).toContain("Token");
    expect(result.items[0]?.snippet).not.toMatch(/<[^>]+>/);
  });

  it("finds 已发现表数 in the bundled handbook under connection-overview-metrics", async () => {
    const realAppRoot = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "../../.."
    );
    const result = await searchHelpHandbook("已发现表数", { appRoot: realAppRoot });
    expect(result.items.some((item) => item.sectionId === "connection-overview-metrics")).toBe(
      true
    );
    const hit = result.items.find((item) => item.sectionId === "connection-overview-metrics");
    expect(hit?.snippet).toContain("已发现表数");
  });

  it("finds Role/Agent/Token guidance in the bundled handbook", async () => {
    const realAppRoot = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "../../.."
    );
    const byPhrase = await searchHelpHandbook("什么时候配置角色", { appRoot: realAppRoot });
    expect(
      byPhrase.items.some((item) => item.sectionId === "admin-role-agent-token-guide")
    ).toBe(true);

    const byDecision = await searchHelpHandbook("一人一", { appRoot: realAppRoot });
    expect(
      byDecision.items.some((item) => item.sectionId === "admin-role-agent-token-guide")
    ).toBe(true);
  });

  it("serves GET /api/help/search with the designed envelope", async () => {
    const realAppRoot = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "../../.."
    );
    await makeProject();
    process.env.KTX_PROJECT_ROOT = projectRoot;
    process.env.LUCY_APP_ROOT = realAppRoot;

    const app = await buildFreshServer();
    await app.ready();

    const empty = await request(app.server).get("/api/help/search").query({ q: "" }).expect(200);
    expect(empty.body).toEqual({ ok: true, data: { query: "", items: [] } });

    const found = await request(app.server)
      .get("/api/help/search")
      .query({ q: "已发现表数", limit: "5" })
      .expect(200);
    expect(found.body.ok).toBe(true);
    expect(found.body.data.query).toBe("已发现表数");
    expect(found.body.data.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sectionId: "connection-overview-metrics",
          title: "连接概览指标说明"
        })
      ])
    );

    const tooLong = await request(app.server)
      .get("/api/help/search")
      .query({ q: "y".repeat(81) })
      .expect(400);
    expect(tooLong.body).toEqual({
      ok: false,
      error: {
        code: "ERR_HELP_QUERY_TOO_LONG",
        message: "Help search query exceeds 80 characters"
      }
    });

    await app.close();
  });
});
