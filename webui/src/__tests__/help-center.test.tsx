// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HelpCenter } from "../pages/HelpCenter";

function renderHelp(path = "/help") {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false }
    }
  });
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url === "/api/help/handbook") {
      return new Response(
        JSON.stringify({
          ok: true,
          data: {
            id: "system-handbook",
            title: "Project Lucy 系统使用与运维手册",
            sourcePath: "docs/SYSTEM_HANDBOOK.md",
            updatedAt: "2026-07-29T12:00:00.000Z",
            etag: "sha256:abc",
            toc: [
              { id: "system-overview", level: 2, title: "1. 系统概述与架构拓扑" },
              { id: "database-connections", level: 3, title: "3.2 数据库接入" },
              {
                id: "database-connection-boundary",
                level: 4,
                title: "WebUI 与 ktx.yaml 的职责边界"
              },
              {
                id: "database-connection-shapes",
                level: 4,
                title: "连接形态与配置字段"
              },
              {
                id: "database-connection-operations-runbook",
                level: 4,
                title: "新增数据库连接（运维 Runbook）"
              },
              {
                id: "database-connection-acl-sync",
                level: 4,
                title: "Agent 可见性与 ACL 同步"
              },
              { id: "deployment-checklist", level: 3, title: "3.1 部署向导与上线检查" },
              { id: "yaml-delivery-runbook", level: 3, title: "3.7 YAML 文件规范与交付验收" },
              { id: "yaml-delivery-checklist", level: 3, title: "3.7.6 GO / NO-GO 交付 checklist" },
              { id: "mcp-integration", level: 2, title: "4. Agent / 客户端接入指南" },
              { id: "configuration-reference", level: 2, title: "5. 配置与环境变量速查" }
            ],
            markdown: [
              "# Project Lucy 系统使用与运维手册",
              "",
              "| 项 | 内容 |",
              "|---|---|",
              "| 文档类型 | System Handbook |",
              "| 事实来源 | `webui/server/`, `webui/src/` |",
              "",
              "## 目录",
              "",
              "- [1. 系统概述与架构拓扑](#1-系统概述与架构拓扑)",
              "- [2. 快速上手](#2-快速上手)",
              "- [3. 功能模块操作指南](#3-功能模块操作指南)",
              "  - [3.1 部署向导与上线检查](#31-部署向导与上线检查)",
              "  - [3.2 数据库接入](#32-数据库接入)",
              "",
              "## 1. 系统概述与架构拓扑",
              "",
              "Lucy 是本地语义补充工作台。",
              "",
              "### 3.1 部署向导与上线检查",
              "",
              "| 步骤 | Ready 条件 | 检查方法 | 异常处理 |",
              "|---|---|---|---|",
              "| 1 | `ktx.yaml` 已存在 | 查看项目根目录 | 补齐配置 |",
              "",
              "### 3.2 数据库接入",
              "",
              "WebUI 不负责新建物理数据库连接。新增连接的 host、port、database、username、password、driver 等字段由运维在 `ktx.yaml` 和 secret 文件中配置。",
              "",
              "#### WebUI 与 ktx.yaml 的职责边界",
              "",
              "WebUI 是已声明连接的管理界面，不承担物理数据库连接的创建与凭据管理。",
              "",
              "#### 连接形态与配置字段",
              "",
              "通用模板见 `ktx.yaml`。",
              "",
              "#### 新增数据库连接（运维 Runbook）",
              "",
              "按 10 步顺序操作。",
              "",
              "#### Agent 可见性与 ACL 同步",
              "",
              "新增连接后必须同步 `webui/config/access.yaml` 的 role。",
              "",
              "### 3.7 YAML 文件规范与交付验收",
              "",
              "FAQ 可跳到 [KTX 合并与索引检查](#3762-ktx-合并与索引检查)。",
              "",
              "#### 3.7.6 GO / NO-GO 交付 checklist",
              "",
              "只有全部检查通过才允许 GO。",
              "",
              "##### 3.7.6.2 KTX 合并与索引检查",
              "",
              "必须执行 `sl read`。",
              "",
              "## 4. Agent / 客户端接入指南",
              "",
              "接入地址 `http://127.0.0.1:7879/mcp`。",
              "",
              "## 5. 配置与环境变量速查",
              "",
              "`LUCY_AGENT_TOKEN` 由环境变量注入。"
            ].join("\n")
          }
        })
      );
    }
    return new Response(JSON.stringify({ ok: false, error: { code: "NOT_FOUND", message: "not found" } }), { status: 404 });
  });
  vi.stubGlobal("fetch", fetchMock);

  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <HelpCenter />
      </MemoryRouter>
    </QueryClientProvider>
  );
  return { fetchMock };
}

function flushRequestAnimationFrame() {
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb: FrameRequestCallback) => {
    cb(0);
    return 0;
  });
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("HelpCenter", () => {
  it("renders the handbook TOC and markdown content", async () => {
    const { fetchMock } = renderHelp();

    expect(await screen.findByRole("heading", { name: "系统手册" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "系统概述与架构拓扑" })).toHaveAttribute("href", "/help?section=system-overview");
    expect(screen.getByRole("link", { name: "部署向导与上线检查" })).toHaveAttribute("href", "/help?section=deployment-checklist");
    expect(screen.getByRole("link", { name: "YAML 文件规范与交付验收" })).toHaveAttribute("href", "/help?section=yaml-delivery-runbook");
    expect(screen.getByRole("link", { name: "GO / NO-GO 交付 checklist" })).toHaveAttribute("href", "/help?section=yaml-delivery-checklist");
    expect(screen.getByRole("link", { name: "Agent / 客户端接入指南" })).toHaveAttribute("href", "/help?section=mcp-integration");
    expect(screen.queryByRole("link", { name: "Agent 可见性与 ACL 同步" })).not.toBeInTheDocument();
    expect(screen.getByText(/Lucy 是本地语义补充工作台/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "KTX 合并与索引检查" })).toHaveAttribute("href", "#3762-ktx-合并与索引检查");
    expect(screen.getByRole("link", { name: "KTX 合并与索引检查" })).not.toHaveAttribute("target");
    expect(screen.getByRole("heading", { name: "3.7.6.2 KTX 合并与索引检查" })).toHaveAttribute("id", "3762-ktx-合并与索引检查");
    expect(screen.getByText("docs/SYSTEM_HANDBOOK.md")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith("/api/help/handbook");
  });

  it("scrolls to the section from the section query parameter", async () => {
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    flushRequestAnimationFrame();

    renderHelp("/help?section=mcp-integration");

    await waitFor(() => {
      expect(scrollIntoView).toHaveBeenCalledWith({ behavior: "smooth", block: "start" });
    });
  });

  it("renders the deployment checklist as a real markdown table", async () => {
    renderHelp("/help?section=deployment-checklist");

    const article = await screen.findByRole("article");
    const table = within(article).getByRole("table");

    expect(screen.getByRole("heading", { name: "3.1 部署向导与上线检查" })).toBeInTheDocument();
    expect(screen.queryByText("系统手册加载中...")).not.toBeInTheDocument();
    expect(within(table).getByRole("columnheader", { name: "步骤" })).toBeInTheDocument();
    expect(within(table).getByRole("columnheader", { name: "Ready 条件" })).toBeInTheDocument();
    expect(within(table).getByText("补齐配置")).toBeInTheDocument();
    expect(article).not.toHaveTextContent("| 步骤 | Ready 条件 | 检查方法 | 异常处理 |");
  });

  it("scrolls to the YAML delivery checklist section from a stable section id", async () => {
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    flushRequestAnimationFrame();

    renderHelp("/help?section=yaml-delivery-checklist");

    await waitFor(() => {
      expect(scrollIntoView).toHaveBeenCalledWith({ behavior: "smooth", block: "start" });
    });
  });

  it("renders the database connection operations runbook section tree and content for an active level-4 section", async () => {
    const { fetchMock } = renderHelp("/help?section=database-connection-acl-sync");

    // Boundary statement + capability table must be present in the markdown.
    expect(
      await screen.findByText(/WebUI 不负责新建物理数据库连接/)
    ).toBeInTheDocument();
    // All four level-4 anchors must surface as toc links with stable hrefs.
    expect(
      screen.getByRole("link", { name: "WebUI 与 ktx.yaml 的职责边界" })
    ).toHaveAttribute("href", "/help?section=database-connection-boundary");
    expect(
      screen.getByRole("link", { name: "连接形态与配置字段" })
    ).toHaveAttribute("href", "/help?section=database-connection-shapes");
    expect(
      screen.getByRole("link", { name: "新增数据库连接（运维 Runbook）" })
    ).toHaveAttribute(
      "href",
      "/help?section=database-connection-operations-runbook"
    );
    expect(
      screen.getByRole("link", { name: "Agent 可见性与 ACL 同步" })
    ).toHaveAttribute("href", "/help?section=database-connection-acl-sync");
    // Sections are rendered as anchors with the stable id.
    expect(
      document.getElementById("database-connection-operations-runbook")
    ).toBeInTheDocument();
    expect(
      document.getElementById("database-connection-acl-sync")
    ).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith("/api/help/handbook");
  });

  it("scrolls to the database connection operations runbook section from a stable section id", async () => {
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    flushRequestAnimationFrame();

    renderHelp("/help?section=database-connection-operations-runbook");

    await waitFor(() => {
      expect(scrollIntoView).toHaveBeenCalledWith({ behavior: "smooth", block: "start" });
    });
  });

  it("renders the handbook header metadata as separate chips with translation defense", async () => {
    renderHelp();

    const header = await screen.findByTestId("help-header");
    expect(within(header).getByText("来源")).toBeInTheDocument();
    expect(within(header).getByText("docs/SYSTEM_HANDBOOK.md")).toHaveAttribute("translate", "no");
    expect(within(header).getByText(/更新时间/)).toBeInTheDocument();
    // Source path and updated time must not be glued together without a separator.
    expect(header).not.toHaveTextContent("docs/SYSTEM_HANDBOOK.md2026");
  });

  it("marks the deep-link section as current in the TOC and scrolls to it", async () => {
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    flushRequestAnimationFrame();

    renderHelp("/help?section=database-connection-acl-sync");

    const activeLink = await screen.findByRole("link", { name: "Agent 可见性与 ACL 同步" });
    expect(activeLink).toHaveAttribute("aria-current", "location");
    expect(document.getElementById("database-connection-acl-sync")).toBeInTheDocument();
    await waitFor(() => {
      expect(scrollIntoView).toHaveBeenCalledWith({ behavior: "smooth", block: "start" });
    });
  });

  it("does not render the leading handbook metadata table in the article body", async () => {
    renderHelp();

    const article = await screen.findByRole("article");
    expect(within(article).queryByText("文档类型")).not.toBeInTheDocument();
    expect(within(article).queryByRole("heading", { name: "目录" })).not.toBeInTheDocument();
    expect(within(article).getByRole("heading", { name: /系统概述与架构拓扑/ })).toBeInTheDocument();
  });

  it("does not scroll when the section query parameter does not match any section", async () => {
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    flushRequestAnimationFrame();

    renderHelp("/help?section=does-not-exist");

    expect(await screen.findByRole("heading", { name: "系统手册" })).toBeInTheDocument();
    // Give the rAF callback (if scheduled) a chance to run.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(scrollIntoView).not.toHaveBeenCalled();
  });
});
