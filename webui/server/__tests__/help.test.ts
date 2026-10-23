import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { navGroups } from "../../src/app/navigation";
import {
  LEGACY_SECTION_IDS,
  SECTION_ID_CONTRACT,
  cleanSectionTitle,
  handbookPathForTests,
  parseHelpToc,
  readHelpHandbook,
  resolveLegacySectionId,
  searchHelpHandbook,
  searchHelpMarkdown,
  HelpQueryTooLongError
} from "../help";

/** 真实随应用发布的手册（测试文件位于 <root>/webui/server/__tests__/）。 */
const realAppRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

/**
 * 扫描 markdown，返回不在代码围栏内的标题（保留前导编号）。
 * 围栏判定与 `server/help.ts` 的 `FENCE_RE` 保持一致。
 */
function markdownHeadings(markdown: string, minLevel: number, maxLevel: number): string[] {
  const headings: string[] = [];
  let inFence = false;
  for (const line of markdown.split(/\r?\n/)) {
    if (/^```/.test(line.trim())) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const match = line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (!match) continue;
    const level = match[1]!.length;
    if (level < minLevel || level > maxLevel) continue;
    headings.push(match[2]!.trim());
  }
  return headings;
}

function isHelpTableSeparatorLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed.includes("|")) return false;
  const inner = trimmed.replace(/^\|/, "").replace(/\|$/, "");
  if (!inner) return false;
  return inner
    .split("|")
    .map((cell) => cell.trim())
    .every((cell) => /^:?-{3,}:?$/.test(cell));
}

/**
 * 复刻前端 `webui/src/pages/HelpCenter.tsx:110-144` 的 `stripLeadingHandbookPreface()`：
 * 剥掉 H1、紧随其后的元数据表、可选的「目录」节。前端文件不在本流的改动白名单内，
 * 也不能被 server 测试直接 import，故在此逐字复刻其语义。
 */
function stripLeadingHandbookPreface(markdown: string): string {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  let i = 0;

  while (i < lines.length && (lines[i] ?? "").trim() === "") i++;
  if (i >= lines.length || !/^#\s+/.test(lines[i] ?? "")) return markdown;
  i++;

  while (i < lines.length && (lines[i] ?? "").trim() === "") i++;

  if (i + 1 >= lines.length) return markdown;
  const headerLine = lines[i] ?? "";
  const separatorLine = lines[i + 1] ?? "";
  if (!headerLine.includes("|") || !isHelpTableSeparatorLine(separatorLine)) return markdown;

  i += 2;
  while (i < lines.length && (lines[i] ?? "").trim() !== "") {
    if (!(lines[i] ?? "").includes("|")) break;
    i++;
  }

  while (i < lines.length && (lines[i] ?? "").trim() === "") i++;

  if (/^##\s+目录\s*#*\s*$/.test(lines[i] ?? "")) {
    i++;
    while (i < lines.length && !/^##\s+/.test(lines[i] ?? "")) i++;
    while (i < lines.length && (lines[i] ?? "").trim() === "") i++;
  }

  return lines.slice(i).join("\n");
}

let projectRoot: string | undefined;
let appRoot: string | undefined;
let previousRoot: string | undefined;
  let previousContentRoot: string | undefined;
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
  previousContentRoot = process.env.LUCY_CONTENT_ROOT;
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
  it("parses H2-H4 headings into a stable TOC", () => {
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
      "#### 4.2.1 unregistered sub section",
      "plain text"
    ].join("\n"));

    // H4 默认进目录：契约表未登记的标题回落到 stableSlug，而不是被静默丢弃。
    expect(toc).toEqual([
      { id: "faq-quick-reference", level: 2, title: "0. 常见问题速查" },
      { id: "system-overview", level: 2, title: "1. 系统概述与架构拓扑" },
      { id: "lucy", level: 3, title: "1.1 Lucy 是什么" },
      { id: "mcp-integration", level: 2, title: "4. Agent / 客户端接入指南" },
      { id: "codex-claude-code-mcp-json", level: 3, title: "4.2 Codex / Claude Code `.mcp.json`" },
      {
        id: "unregistered-sub-section",
        level: 4,
        title: "4.2.1 unregistered sub section"
      }
    ]);
  });

  it("exposes stable section ids for the YAML delivery standard section tree", () => {
    const toc = parseHelpToc([
      "### 3.7 YAML 规范与交付验收",
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

    // §3.7.0–3.7.8 保持 level 4（H5 及更深不进目录）。
    expect(toc).toEqual([
      { id: "yaml-delivery-standard", level: 3, title: "3.7 YAML 规范与交付验收" },
      { id: "yaml-type-overview", level: 4, title: "3.7.1 YAML 类型总览" },
      { id: "yaml-schema-manifest", level: 4, title: "3.7.2 Schema manifest 规范" },
      { id: "yaml-augmentation-overlay", level: 4, title: "3.7.3 Manifest augmentation overlay 规范" },
      { id: "yaml-new-semantic-source", level: 4, title: "3.7.4 New semantic source 规范" },
      { id: "yaml-description-fields", level: 4, title: "3.7.5 描述字段规范" },
      { id: "yaml-go-no-go-checklist", level: 4, title: "3.7.6 GO / NO-GO 交付 checklist" },
      { id: "yaml-common-errors", level: 4, title: "3.7.7 常见错误与诊断 Runbook" },
      { id: "yaml-agent-self-check", level: 4, title: "3.7.8 Agent 自检协议" }
    ]);
  });

  it("exposes stable level-4 aliases for the database connection operations runbook", () => {
    const toc = parseHelpToc([
      "### 3.2 数据接入 · 连接 / Schema / 表范围",
      "#### 刷新本地目录",
      "#### 连接概览指标说明",
      "#### WebUI 与 ktx.yaml 的职责边界",
      "#### 连接形态与配置字段",
      "#### 新增数据库连接（运维 Runbook）",
      "#### Agent 可见性与 ACL 同步"
    ].join("\n"));

    expect(toc).toEqual([
      {
        id: "data-access-connections",
        level: 3,
        title: "3.2 数据接入 · 连接 / Schema / 表范围"
      },
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

  it("routes every level-4 heading into the TOC unless it is explicitly excluded", () => {
    const toc = parseHelpToc([
      "### 3.2 数据接入 · 连接 / Schema / 表范围",
      "#### unregistered sub section",
      "#### another unknown sub heading",
      "<!-- toc:exclude -->",
      "#### excluded by marker"
    ].join("\n"));

    // 白名单机制已删除：H4 默认放行，需要隐藏时用 `<!-- toc:exclude -->` 显式排除。
    expect(toc).toEqual([
      {
        id: "data-access-connections",
        level: 3,
        title: "3.2 数据接入 · 连接 / Schema / 表范围"
      },
      { id: "unregistered-sub-section", level: 4, title: "unregistered sub section" },
      { id: "another-unknown-sub-heading", level: 4, title: "another unknown sub heading" }
    ]);
  });

  it("excludes a heading that is directly preceded by a toc:exclude marker", () => {
    const toc = parseHelpToc([
      "## 3. 功能模块操作指南",
      "<!-- toc:exclude -->",
      "#### internal implementation detail",
      "#### public sub section"
    ].join("\n"));

    expect(toc).toEqual([
      { id: "functional-modules", level: 2, title: "3. 功能模块操作指南" },
      { id: "public-sub-section", level: 4, title: "public sub section" }
    ]);
  });

  it("routes every bundled handbook H3 and H4 into the parsed TOC", async () => {
    // 门禁：handbook 里新写的 H3/H4 若没进 parseHelpToc 的 TOC，正文还在，
    // 但侧栏不可达、正文被并入相邻章节，搜索也会命中错章节。
    // 以运行时 TOC 为准，不在测试里复刻放行规则常量，避免两边一起漂移。
    const handbook = await readHelpHandbook(realAppRoot);

    const h3h4Titles = markdownHeadings(handbook.markdown, 3, 4);
    const tocTitles = new Set(handbook.toc.map((t) => t.title));

    const missing = h3h4Titles.filter((title) => !tocTitles.has(title));

    expect(missing, "这些 H3/H4 没有进入 TOC，章节在侧栏不可达").toEqual([]);
  });

  it("exposes stable non-hash ids for every bundled handbook section", async () => {
    // stableSlug 对纯中文标题会回退到 SHA1，产出 10 位十六进制 id：
    // 无语义、且标题微调即静默改变，会打断已发布的深链。
    const handbook = await readHelpHandbook(realAppRoot);
    expect(handbook.toc.length).toBeGreaterThan(0);

    for (const item of handbook.toc) {
      expect(item.id, `章节「${item.title}」应命中 SECTION_ID_CONTRACT`).not.toMatch(
        /^[0-9a-f]{10}$/
      );
      expect(item.id, `章节「${item.title}」应命中 SECTION_ID_CONTRACT`).toMatch(
        /^[a-z][a-z0-9-]*$/
      );
    }
  });

  it("exposes the admin login and break-glass sections as reachable level-4 entries", async () => {
    // 回归：这两章正文早已存在，但曾因漏配白名单而不可达（搜索错落到审计章节）。
    const handbook = await readHelpHandbook(realAppRoot);
    const byId = new Map(handbook.toc.filter((t) => t.level === 4).map((t) => [t.id, t]));

    expect(byId.get("admin-webui-login")?.title).toBe("WebUI 管理员登录");
    expect(byId.get("admin-break-glass")?.title).toBe(
      "丢失管理员账号或密码时如何恢复（break-glass）"
    );
  });

  it("routes break-glass and admin-login searches to their own sections", async () => {
    // 回归：修复前这两个词会命中 admin-audit-turns-vs-calls（问询记录与调用流水）。
    const handbook = await readHelpHandbook(realAppRoot);

    for (const [query, expectedId] of [
      ["break-glass", "admin-break-glass"],
      ["管理员登录", "admin-webui-login"]
    ] as const) {
      const first = searchHelpMarkdown(handbook.markdown, query, { limit: 1 }).items[0];
      expect(first?.sectionId, `搜索「${query}」应命中 ${expectedId}`).toBe(expectedId);
    }
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
      "### 1.5 WebUI 入口速查（运行状态侧栏地图）",
      "",
      "| 分组 | 二级菜单 | 路径 | 一句话用途 |",
      "| --- | --- | --- | --- |",
      "| 系统概览 | 系统概览 | `/overview` | 顶部入口 |"
    ].join("\n"));

    const entry = toc.find((t) => t.id === "webui-entry-map");
    expect(entry).toBeDefined();
    expect(entry?.level).toBe(3);
    expect(entry?.title).toBe("1.5 WebUI 入口速查（运行状态侧栏地图）");
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
      "### 3.1 运行状态 · 系统概览与上线检查",
      "",
      "## 6. FAQ 与排障指南",
      "",
      "### 6.1 为什么提示“未发现本地 manifest”？"
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
      "### 1.5 WebUI 入口速查（运行状态侧栏地图）",
      "",
      "## 3. 功能模块操作指南",
      "",
      "### 3.1 运行状态 · 系统概览与上线检查",
      "",
      "## 6. FAQ 与排障指南",
      "",
      "### 6.1 为什么提示“未发现本地 manifest”？"
    ].join("\n"));
    const extendedIds = new Set(extended.map((t) => t.id));

    for (const id of baselineIds) {
      expect(extendedIds.has(id), `expected anchor "${id}" to remain after §1.5 added`).toBe(true);
    }
    expect(extendedIds.has("webui-entry-map")).toBe(true);
    // 契约表命中：不是靠 stableSlug 兜底出来的哈希。
    expect(baselineIds.has("runtime-status-checklist")).toBe(true);
    expect(baselineIds.has("manifest")).toBe(true);
  });

  it("routes the §0.3 title to faq-agent-integration and keeps legacy variants stable", () => {
    // 契约表是精确标题查表：`面向接入协作者` 是手册里的现行标题。
    // 历史文案变体不再命中契约表，回落到 stableSlug——仍是稳定、无哈希的 id。
    const toc = parseHelpToc(["### 0.3 面向接入协作者"].join("\n"));
    expect(toc[0]?.id).toBe("faq-agent-integration");

    for (const legacyTitle of ["0.3 面向接入 Agent 的协作者", "0.3 接入 Agent 的协作者"]) {
      const legacyToc = parseHelpToc([`### ${legacyTitle}`].join("\n"));
      expect(legacyToc[0]?.id, `历史标题「${legacyTitle}」应回落到稳定的 agent id`).toBe("agent");
    }
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
    process.env.LUCY_CONTENT_ROOT = ".";
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
    // 旧 section id 重定向表随手册一起下发，前端据此把历史深链指到现行章节。
    expect(response.body.data.legacySectionMap).toEqual(LEGACY_SECTION_IDS);
    expect(response.body.data.legacySectionMap["database-connections"]).toBe(
      "data-access-connections"
    );

    await app.close();
  });

  it("throws ERR_HELP_DOC_NOT_FOUND when the fixed handbook is missing", async () => {
    await makeProject();
    appRoot = await makeRoot("lucy-help-app-");
    process.env.KTX_PROJECT_ROOT = projectRoot;
    process.env.LUCY_CONTENT_ROOT = ".";
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

  it("exposes the YAML delivery standard anchors and content markers via the API", async () => {
    const fixture = [
      "# Project Lucy 系统使用与运维手册",
      "",
      "## 1. 系统概述与架构拓扑",
      "",
      "Lucy 本地语义补充工作台。",
      "",
      "## 3. 功能模块操作指南",
      "",
      "### 3.7 YAML 规范与交付验收",
      "",
      "事故教训：reindex 成功不等于交付成功。",
      "",
      "#### 3.7.1 YAML 类型总览",
      "",
      "7 类 YAML 文件。",
      "",
      "#### 3.7.2 Schema manifest 规范",
      "",
      "manifest 顶层 `tables:`，物理列用 `descriptions:`。",
      "",
      "#### 3.7.3 Manifest augmentation overlay 规范",
      "",
      "overlay 文件名 = manifest source name，默认无 `table:`。",
      "",
      "#### 3.7.4 New semantic source 规范",
      "",
      "new source 是高级操作，必须同步 ACL。",
      "",
      "#### 3.7.5 描述字段规范",
      "",
      "物理列用 `descriptions:`，measure 用 `description:`。",
      "",
      "#### 3.7.6 GO / NO-GO 交付 checklist",
      "",
      "静态、KTX、真实 query、MCP smoke 四道关。",
      "",
      "#### 3.7.7 常见错误与诊断 Runbook",
      "",
      "`Unrecognized key: \"description\"` 等症状速查。",
      "",
      "#### 3.7.8 Agent 自检协议",
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
        {
          id: "yaml-delivery-standard",
          level: 3,
          title: "3.7 YAML 规范与交付验收"
        },
        {
          id: "yaml-augmentation-overlay",
          level: 4,
          title: "3.7.3 Manifest augmentation overlay 规范"
        },
        { id: "yaml-go-no-go-checklist", level: 4, title: "3.7.6 GO / NO-GO 交付 checklist" },
        { id: "yaml-agent-self-check", level: 4, title: "3.7.8 Agent 自检协议" }
      ])
    );
  });

  it("the bundled handbook declares reindex success is not delivery success", async () => {
    // Resolved from the test file location, this is the real on-disk handbook shipped with the app.
    // Test file lives at <root>/webui/server/__tests__/help.test.ts → walk up to <root>/.
    const handbook = await readHelpHandbook(realAppRoot);

    expect(handbook.markdown).toMatch(/reindex.*?不(等于|代表)/u);
    expect(handbook.markdown).toContain("GO / NO-GO");
    expect(handbook.markdown).toContain("Manifest augmentation overlay");
    expect(handbook.markdown).toContain("Agent 自检协议");
    expect(handbook.toc).toEqual(
      expect.arrayContaining([
        { id: "yaml-delivery-standard", level: 3, title: "3.7 YAML 规范与交付验收" },
        {
          id: "yaml-augmentation-overlay",
          level: 4,
          title: "3.7.3 Manifest augmentation overlay 规范"
        },
        { id: "yaml-go-no-go-checklist", level: 4, title: "3.7.6 GO / NO-GO 交付 checklist" },
        { id: "yaml-agent-self-check", level: 4, title: "3.7.8 Agent 自检协议" }
      ])
    );
  });

  it("the bundled handbook entry map mirrors the current navigation directory", async () => {
    const handbook = await readHelpHandbook(realAppRoot);
    const lines = handbook.markdown.split("\n");
    const tableHeaderIndex = lines.indexOf("| 分组 | 二级菜单 | 路径 | 一句话用途 |");
    expect(tableHeaderIndex).toBeGreaterThanOrEqual(0);

    const expectedItems = navGroups.flatMap((group) => group.items);
    const expectedGroups = navGroups.flatMap((group) => group.items.map(() => group.title));

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
        {
          id: "data-access-connections",
          level: 3,
          title: "3.2 数据接入 · 连接 / Schema / 表范围"
        },
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
      [
        "### 3.1 运行状态 · 系统概览与上线检查",
        "",
        "#### 系统概览待处理事项",
        "",
        "### 3.2 数据接入 · 连接 / Schema / 表范围"
      ].join("\n")
    );

    expect(toc).toEqual(
      expect.arrayContaining([
        {
          id: "runtime-status-checklist",
          level: 3,
          title: "3.1 运行状态 · 系统概览与上线检查"
        },
        { id: "overview-action-required", level: 4, title: "系统概览待处理事项" },
        {
          id: "data-access-connections",
          level: 3,
          title: "3.2 数据接入 · 连接 / Schema / 表范围"
        }
      ])
    );
  });

  it("the bundled handbook documents overview action-required counting", async () => {
    const handbook = await readHelpHandbook(realAppRoot);

    expect(handbook.markdown).toContain("#### 系统概览待处理事项");
    expect(handbook.markdown).toContain("N 张表待补语义");
    expect(handbook.markdown).toContain("已启用 ∩ `Manifest`");
    expect(handbook.markdown).toContain("首页 **不再** 并列「Catalog 对象待处理」");
    // Task 4: old limit=1 limitation removed; handbook now documents the real 30-day contract
    expect(handbook.markdown).toContain("GET /api/eval/runs/summary?days=30");
    expect(handbook.markdown).toContain(
      "`/overview`「待处理事项」里「N 张表待补语义」怎么算？"
    );
    expect(handbook.toc).toEqual(
      expect.arrayContaining([
        {
          id: "runtime-status-checklist",
          level: 3,
          title: "3.1 运行状态 · 系统概览与上线检查"
        },
        { id: "overview-action-required", level: 4, title: "系统概览待处理事项" }
      ])
    );
  });

  it("maps semantic authoring sub-sections to stable alias ids", () => {
    const toc = parseHelpToc([
      "### 3.3 业务上下文 · 语义层",
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
    expect(byTitle["3.3 业务上下文 · 语义层"]).toBe("semantic-layer");
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
        "### 3.5 访问治理 · 角色 / Agent / Token",
        "",
        "#### 什么时候配置角色、Agent 和 Token",
        "",
        "#### 问询记录与调用流水怎么选、怎么导出",
        "",
        "#### 审计热库与冷库（SQL 留存边界）",
        "",
        "### 3.6 质量评测"
      ].join("\n")
    );
    const byTitle = Object.fromEntries(toc.map((t) => [t.title, t.id]));
    expect(byTitle["3.5 访问治理 · 角色 / Agent / Token"]).toBe("access-governance");
    expect(byTitle["什么时候配置角色、Agent 和 Token"]).toBe("admin-role-agent-token-guide");
    expect(byTitle["问询记录与调用流水怎么选、怎么导出"]).toBe("admin-audit-turns-vs-calls");
    expect(byTitle["审计热库与冷库（SQL 留存边界）"]).toBe("admin-audit-hot-cold-store");
    expect(byTitle["3.6 质量评测"]).toBe("quality-evaluation");
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
        {
          id: "access-governance",
          level: 3,
          title: "3.5 访问治理 · 角色 / Agent / Token"
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

  it("the bundled handbook documents Role / Agent / Token user guidance", async () => {
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
      "### 3.7 YAML 规范与交付验收",
      "",
      "#### 3.7.0 overlay 字段速查（编写辅导）",
      "",
      "#### 3.7.1 YAML 类型总览"
    ].join("\n"));

    expect(toc).toEqual(
      expect.arrayContaining([
        { id: "yaml-overlay-field-guide", level: 4, title: "3.7.0 overlay 字段速查（编写辅导）" },
        { id: "yaml-type-overview", level: 4, title: "3.7.1 YAML 类型总览" }
      ])
    );
  });

  it("maps 配置作者 Skills to config-author-skills", () => {
    const toc = parseHelpToc([
      "### 3.7 YAML 规范与交付验收",
      "",
      "#### 配置作者 Skills",
      "",
      "#### 3.7.0 overlay 字段速查（编写辅导）"
    ].join("\n"));

    expect(toc).toEqual(
      expect.arrayContaining([
        { id: "config-author-skills", level: 4, title: "配置作者 Skills" },
        { id: "yaml-overlay-field-guide", level: 4, title: "3.7.0 overlay 字段速查（编写辅导）" }
      ])
    );
  });

  it("the bundled handbook documents semantic YAML authoring guidance", async () => {
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
          level: 4,
          title: "3.7.0 overlay 字段速查（编写辅导）"
        },
        { id: "config-author-skills", level: 4, title: "配置作者 Skills" }
      ])
    );
  });

  it("the bundled handbook exposes a user-facing FAQ quick reference", async () => {
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
    expect(handbook.markdown).toContain("[系统概览待处理事项](#overview-action-required)");
    expect(handbook.markdown).toContain("可以用编码代理自动生成语义 / Wiki / 评测用例吗？");
    expect(handbook.markdown).toContain("[配置作者 Skills](#config-author-skills)");
    // §3.7.6 的子步骤是 H5（不进目录），正文按编号引用；速查表链到 §3.7.6 的稳定 id。
    expect(handbook.markdown).toContain("3.7.6.2 KTX 合并与索引检查");
    expect(handbook.markdown).toContain(
      "[3.7.6 GO / NO-GO 交付 checklist](#yaml-go-no-go-checklist)"
    );
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
      "## 质量评测",
      "",
      "这里只是顺带提到 token 一次。",
      "",
      "## Token 凭据（/admin/tokens）",
      "",
      "Token 明文只在创建 token 的 HTTP 响应出现一次。"
    ].join("\n");

    const result = searchHelpMarkdown(markdown, "token");
    expect(result.query).toBe("token");
    expect(result.items.length).toBeGreaterThanOrEqual(1);
    expect(result.items[0]?.sectionId).toBe("agent-tokens");
    expect(result.items[0]?.snippet).toContain("Token");
    expect(result.items[0]?.snippet).not.toMatch(/<[^>]+>/);
  });

  it("finds 已发现表数 in the bundled handbook under connection-overview-metrics", async () => {
    const result = await searchHelpHandbook("已发现表数", { appRoot: realAppRoot });
    expect(result.items.some((item) => item.sectionId === "connection-overview-metrics")).toBe(
      true
    );
    const hit = result.items.find((item) => item.sectionId === "connection-overview-metrics");
    expect(hit?.snippet).toContain("已发现表数");
  });

  it("finds Role/Agent/Token guidance in the bundled handbook", async () => {
    const byPhrase = await searchHelpHandbook("什么时候配置角色", { appRoot: realAppRoot });
    expect(
      byPhrase.items.some((item) => item.sectionId === "admin-role-agent-token-guide")
    ).toBe(true);

    const byDecision = await searchHelpHandbook("一人一", { appRoot: realAppRoot });
    // 「一人一 `Agent`」的口径写在「先建立三层对象关系」小节里；H4 默认进目录后，
    // 搜索命中的是更精确的那一节。
    expect(
      byDecision.items.some((item) => item.sectionId === "role-agent-token-overview")
    ).toBe(true);
  });

  it("serves GET /api/help/search with the designed envelope", async () => {
    await makeProject();
    process.env.KTX_PROJECT_ROOT = projectRoot;
    process.env.LUCY_CONTENT_ROOT = ".";
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

  it("aliases 产品架构图 to a stable section id", () => {
    const toc = parseHelpToc(["### 1.6 产品架构图（摄取与服务）"].join("\n"));
    expect(toc[0]).toMatchObject({
      id: "product-architecture-diagrams",
      level: 3,
      title: "1.6 产品架构图（摄取与服务）"
    });
  });

  it("the bundled handbook documents the product architecture diagrams", async () => {
    const handbook = await readHelpHandbook(realAppRoot);

    expect(handbook.markdown).toContain("### 1.6 产品架构图（摄取与服务）");
    expect(handbook.markdown).toContain("/api/help/diagrams/lucy-architecture-diagram");
    expect(handbook.markdown).toContain("/api/help/diagrams/lucy-docs-flows");
    expect(handbook.markdown).toContain("docs/user-guide/lucy-architecture-diagram.html");
    expect(handbook.markdown).toContain("docs/user-guide/lucy-docs-flows.html");
    expect(handbook.toc.some((item) => item.id === "product-architecture-diagrams")).toBe(true);

    const byArchitecture = await searchHelpHandbook("产品架构图", { appRoot: realAppRoot });
    expect(
      byArchitecture.items.some((item) => item.sectionId === "product-architecture-diagrams")
    ).toBe(true);
  });

  it("serves the whitelisted architecture diagram HTML and rejects unknown ids", async () => {
    const realAppRoot = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "../../.."
    );
    await makeProject();
    process.env.KTX_PROJECT_ROOT = projectRoot;
    process.env.LUCY_CONTENT_ROOT = ".";
    process.env.LUCY_APP_ROOT = realAppRoot;

    const app = await buildFreshServer();
    await app.ready();

    const architecture = await request(app.server)
      .get("/api/help/diagrams/lucy-architecture-diagram")
      .expect(200);
    expect(architecture.headers["content-type"]).toMatch(/text\/html/);
    expect(architecture.text).toContain("Lucy 架构");

    const flows = await request(app.server)
      .get("/api/help/diagrams/lucy-docs-flows")
      .expect(200);
    expect(flows.headers["content-type"]).toMatch(/text\/html/);
    expect(flows.text).toContain("摄取");

    const missing = await request(app.server)
      .get("/api/help/diagrams/not-a-real-diagram")
      .expect(404);
    expect(missing.body).toMatchObject({
      ok: false,
      error: {
        code: "ERR_HELP_DIAGRAM_NOT_FOUND"
      }
    });

    // Encoded traversal segments must still miss the whitelist (not open arbitrary files).
    const escapeAttempt = await request(app.server)
      .get("/api/help/diagrams/%2e%2e%2fktx.yaml")
      .expect(404);
    expect(escapeAttempt.body.error.code).toBe("ERR_HELP_DIAGRAM_NOT_FOUND");

    await app.close();
  });
});

describe("Help handbook section id contract", () => {
  it("keeps the section id contract and the bundled handbook in sync", async () => {
    // 契约表是「手册标题 → section id」的唯一事实源。表里有手册中不存在的标题，
    // 说明手册改名后契约表没跟上；表里的 id 找不到对应章节，说明映射失效。
    const handbook = await readHelpHandbook(realAppRoot);
    const handbookTitles = new Set(
      markdownHeadings(handbook.markdown, 2, 4).map((title) => cleanSectionTitle(title))
    );

    const missingTitles: string[] = [];
    const mismatchedIds: string[] = [];
    for (const [title, id] of SECTION_ID_CONTRACT) {
      if (!handbookTitles.has(title)) {
        missingTitles.push(title);
        continue;
      }
      const item = handbook.toc.find((entry) => entry.id === id);
      if (!item || cleanSectionTitle(item.title) !== title) {
        mismatchedIds.push(`${title} → ${id}`);
      }
    }

    expect(missingTitles, "契约表里有手册中不存在的标题").toEqual([]);
    expect(mismatchedIds, "契约表映射出的 id 与实际 TOC 不一致").toEqual([]);
  });

  it("registers every handbook heading in the section id contract", async () => {
    // 反向断言：手册里每个 H2/H3/H4 都必须登记进契约表。
    //
    // 没有这条断言时，新增一个**含 ASCII 字符**的标题会静默走 `stableSlug()`
    // 回落——拿到一个合法 slug，锚点门禁也全绿（TOC 条目可达、正文无死链），
    // 但这个 id 不在契约表内：id 由标题派生，标题一改 id 就变，已发布的深链失效。
    // 纯中文标题回落时是 sha1，会被「无哈希 id」断言拦下，所以只有含 ASCII 的
    // 标题能溜过去——这条断言专门堵这个口子。
    const handbook = await readHelpHandbook(realAppRoot);
    const unregistered = markdownHeadings(handbook.markdown, 2, 4)
      .map((title) => cleanSectionTitle(title))
      .filter((title) => !SECTION_ID_CONTRACT.has(title));

    expect(
      unregistered,
      "这些章节标题没有登记进 SECTION_ID_CONTRACT，id 会静默退回 stableSlug 派生"
    ).toEqual([]);
  });

  it("keeps the legacy section id map resolvable against the current TOC", async () => {
    const handbook = await readHelpHandbook(realAppRoot);
    const tocIds = new Set(handbook.toc.map((item) => item.id));

    const dangling: string[] = [];
    const ambiguous: string[] = [];
    for (const [legacyId, targetId] of Object.entries(LEGACY_SECTION_IDS)) {
      if (!tocIds.has(targetId)) dangling.push(`${legacyId} → ${targetId}`);
      // 与现行 id 同名的旧 id 必须自映射，否则重定向会把用户带到别的章节。
      if (tocIds.has(legacyId) && targetId !== legacyId) {
        ambiguous.push(`${legacyId} → ${targetId}`);
      }
    }

    expect(dangling, "legacy 表指向的章节已不存在").toEqual([]);
    expect(ambiguous, "legacy 表与现行 id 冲突").toEqual([]);
  });

  it("keeps the §3.7.0–§3.7.8 sub-sections at level 4", async () => {
    // 旧实现把 §3.7.x 压平成 level 3，侧栏里与 §3.7 平级，编号层级消失。
    const handbook = await readHelpHandbook(realAppRoot);
    const subSections = handbook.toc.filter((item) => /^3\.7\.\d+/.test(item.title));

    expect(subSections.map((item) => item.title.replace(/^3\.7\.(\d+).*$/, "$1"))).toEqual([
      "0",
      "1",
      "2",
      "3",
      "4",
      "5",
      "6",
      "7",
      "8"
    ]);
    for (const item of subSections) {
      expect(item.level, `「${item.title}」应为 level 4`).toBe(4);
    }
  });

  it("keeps every TOC section reachable in the stripped handbook body", async () => {
    // 剥除前置（H1 + 元数据表 + 「目录」节）后，每个 TOC id 都必须还能在正文里
    // 找到对应标题——否则侧栏入口点进去是一段空白。
    const handbook = await readHelpHandbook(realAppRoot);
    const body = stripLeadingHandbookPreface(handbook.markdown);
    const bodyHeadings = new Set(markdownHeadings(body, 2, 4));

    const unreachable = handbook.toc
      .filter((item) => !bodyHeadings.has(item.title))
      .map((item) => `${item.level} ${item.id} ${item.title}`);

    expect(unreachable, "这些章节在剥除前置后没有对应标题，侧栏点进去是空的").toEqual([]);
  });

  it("only excludes the heading that directly follows a toc:exclude marker", () => {
    const toc = parseHelpToc([
      "<!-- toc:exclude -->",
      "",
      "#### spaced sub section",
      "",
      "## 2. 快速上手"
    ].join("\n"));

    // 标记只对紧邻的下一行生效：中间隔了空行就不再排除。
    expect(toc.map((item) => item.id)).toEqual(["spaced-sub-section", "quick-start"]);
  });

  it("redirects legacy section ids to the current ones", () => {
    expect(resolveLegacySectionId("database-connections")).toBe("data-access-connections");
    expect(resolveLegacySectionId("admin-governance")).toBe("access-governance");
    expect(resolveLegacySectionId("b9c274fb1c")).toBe("handbook-baseline");
    expect(resolveLegacySectionId("v2-0-0")).toBe("product-version-cutover");
    // Wave 1 之前的 sha1 哈希 id：旧书签必须还能落到内容所在的新章节。
    expect(resolveLegacySectionId("6071f2d2b3")).toBe("architecture-topology");
    expect(resolveLegacySectionId("81d1ee0418")).toBe("functional-modules");
    expect(resolveLegacySectionId("15c67413dc")).toBe("semantic-layer");
    expect(resolveLegacySectionId("b999ac41e5")).toBe("enabled-tables-save-failure");
    // 章节改名后的旧哈希 id：内容已下沉到对应 H4。
    expect(resolveLegacySectionId("e41aa0d406")).toBe("semantic-asset-scope-tree");
    expect(resolveLegacySectionId("0edbdd1f46")).toBe("admin-role-list");
    expect(resolveLegacySectionId("2457dc14a2")).toBe("row-level-policy");
    // 与现行 id 同名的旧 id 自映射。
    expect(resolveLegacySectionId("semantic-layer")).toBe("semantic-layer");
    expect(resolveLegacySectionId("business-wiki")).toBe("business-wiki");
    // 未登记的 id 原样返回；原型链上的属性名不能被误当成 legacy id。
    expect(resolveLegacySectionId("not-a-legacy-id")).toBe("not-a-legacy-id");
    expect(resolveLegacySectionId("constructor")).toBe("constructor");
  });
});
