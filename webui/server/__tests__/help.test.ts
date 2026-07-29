import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handbookPathForTests, parseHelpToc, readHelpHandbook } from "../help";

let projectRoot: string;
let previousRoot: string | undefined;

async function makeProject(markdown?: string) {
  projectRoot = await mkdtemp(path.join(os.tmpdir(), "lucy-help-"));
  await writeFile(path.join(projectRoot, "ktx.yaml"), "connections: {}\n", "utf8");
  if (markdown !== undefined) {
    await mkdir(path.join(projectRoot, "docs"), { recursive: true });
    await writeFile(handbookPathForTests(projectRoot), markdown, "utf8");
  }
}

beforeEach(() => {
  previousRoot = process.env.KTX_PROJECT_ROOT;
  vi.resetModules();
});

afterEach(async () => {
  if (previousRoot === undefined) {
    delete process.env.KTX_PROJECT_ROOT;
  } else {
    process.env.KTX_PROJECT_ROOT = previousRoot;
  }
  if (projectRoot) {
    await rm(projectRoot, { recursive: true, force: true });
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

  it("reads only docs/SYSTEM_HANDBOOK.md and returns the API envelope", async () => {
    await makeProject([
      "# Project Lucy 系统使用与运维手册",
      "",
      "## 1. 系统概述与架构拓扑",
      "",
      "正文",
      "",
      "### 1.1 Lucy 是什么"
    ].join("\n"));
    process.env.KTX_PROJECT_ROOT = projectRoot;

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
    process.env.KTX_PROJECT_ROOT = projectRoot;

    await expect(readHelpHandbook(projectRoot)).rejects.toMatchObject({
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
});
