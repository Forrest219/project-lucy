import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handbookPathForTests, parseHelpToc, readHelpHandbook } from "../help";

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
      "#### WebUI 与 ktx.yaml 的职责边界",
      "#### 连接形态与配置字段",
      "#### 新增数据库连接（运维 Runbook）",
      "#### Agent 可见性与 ACL 同步"
    ].join("\n"));

    expect(toc).toEqual([
      { id: "database-connections", level: 3, title: "3.2 数据库接入" },
      { id: "catalog-reload", level: 4, title: "刷新本地目录" },
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
});
