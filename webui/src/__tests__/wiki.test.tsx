// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MarkdownPreview } from "../components/MarkdownPreview";
import { WikiEditor } from "../pages/WikiEditor";
import {
  extractWikiToc,
  groupWikiPages,
  validateWikiDraft,
  wikiTitleFromContent
} from "../lib/wiki";

const WIKI_PAGES = [
  {
    key: "global/superstore-analysis-playbook.md",
    summary: "Superstore guide",
    tags: ["analysis"],
    slRefs: ["mysql-aliyun/dataforai/superstore_orders"]
  },
  {
    key: "poc/active-analysis.md",
    summary: "POC active",
    tags: ["poc"],
    slRefs: ["mysql-aliyun/dataforai/superstore_orders"]
  },
  {
    key: "kx/financial-analysis-playbook.md",
    summary: "Financial playbook",
    tags: ["playbook"],
    slRefs: ["mysql-aliyun/dataforai/finance_orders"]
  }
];

const SOURCES = [
  {
    conn: "mysql-aliyun",
    schema: "dataforai",
    table: "superstore_orders",
    filePath: "semantic-layer/mysql-aliyun/_schema/dataforai.yaml",
    columnCount: 3,
    columnNames: ["row_id", "order_id", "order_date"],
    hasTableDesc: true,
    hasGrain: true,
    measureCount: 1,
    joinCount: 0,
    wikiRefCount: 1,
    completion: "done",
    mtime: "2026-07-27T00:00:00.000Z"
  },
  {
    conn: "mysql-aliyun",
    schema: "dataforai",
    table: "finance_orders",
    filePath: "semantic-layer/mysql-aliyun/_schema/dataforai.yaml",
    columnCount: 3,
    columnNames: ["row_id", "amount", "date"],
    hasTableDesc: true,
    hasGrain: true,
    measureCount: 1,
    joinCount: 0,
    wikiRefCount: 1,
    completion: "done",
    mtime: "2026-07-27T00:00:00.000Z"
  }
];

function LocationProbe() {
  const location = useLocation();
  return <span data-testid="current-location">{`${location.pathname}${location.search}`}</span>;
}

function renderWiki(initialPath: string) {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false }
    }
  });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[initialPath]}>
        <Routes>
          <Route path="/wiki" element={<WikiEditor />} />
        </Routes>
        <LocationProbe />
      </MemoryRouter>
    </QueryClientProvider>
  );
  return client;
}

function buildFetchMock(pages = WIKI_PAGES, sources = SOURCES) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === "/api/wiki" && (!init || init.method === undefined)) {
      return new Response(JSON.stringify({ ok: true, data: { pages } }));
    }
    const pageMatch = url.match(/^\/api\/wiki\/(.+)$/);
    if (pageMatch && (!init || init.method === undefined)) {
      const key = decodeURIComponent(pageMatch[1]);
      const page = pages.find((p) => p.key === key);
      if (!page) {
        return new Response(
          JSON.stringify({ ok: false, error: { code: "NOT_FOUND", message: "not found" } }),
          { status: 404 }
        );
      }
      return new Response(
        JSON.stringify({
          ok: true,
          data: {
            key: page.key,
            frontmatter: {
              summary: page.summary,
              tags: page.tags,
              sl_refs: page.slRefs
            },
            content: `# ${page.summary}\n\nDetailed notes here.`,
            rawMarkdown: `---\nsummary: ${page.summary}\ntags:\n  - ${page.tags[0]}\nsl_refs:\n  - ${page.slRefs[0]}\n---\n# ${page.summary}\n\nDetailed notes here.\n`
          }
        })
      );
    }
    if (url === "/api/sources" && (!init || init.method === undefined)) {
      return new Response(JSON.stringify({ ok: true, data: { tables: sources } }));
    }
    if (pageMatch && init?.method === "PUT") {
      const body = JSON.parse(String(init.body));
      return new Response(
        JSON.stringify({
          ok: true,
          data: {
            key: decodeURIComponent(pageMatch[1]),
            filePath: `wiki/${decodeURIComponent(pageMatch[1])}`,
            diff: body.dryRun
              ? `@@\n+summary: ${body.frontmatter?.summary ?? ""}\n+sl_refs:\n+  - ${(body.frontmatter?.sl_refs ?? []).join("\n  - ")}\n`
              : "",
            proposedMarkdown: body.dryRun
              ? `---\nsummary: ${body.frontmatter?.summary ?? ""}\nsl_refs:\n  - ${(body.frontmatter?.sl_refs ?? []).join("\n  - ")}\n---\n# ${body.frontmatter?.summary ?? "Draft"}\n`
              : ""
          }
        })
      );
    }
    return new Response(
      JSON.stringify({ ok: false, error: { code: "NOT_FOUND", message: url } }),
      { status: 404 }
    );
  });
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("MarkdownPreview", () => {
  it("renders GFM pipe tables with inline code translation defense", () => {
    render(
      <MarkdownPreview
        markdown={[
          "| 字段 | 说明 |",
          "|---|---|",
          "| `enabled_tables` | 启用表范围 |"
        ].join("\n")}
      />
    );

    const table = screen.getByRole("table");
    expect(table).toHaveClass("pl-markdown-table");
    expect(table).toHaveAttribute("translate", "no");
    expect(screen.getByRole("columnheader", { name: "字段" })).toBeInTheDocument();
    expect(screen.getByText("启用表范围")).toBeInTheDocument();
    expect(screen.getByText("enabled_tables")).toHaveAttribute("translate", "no");
  });

  it("escapes raw HTML instead of creating nodes", () => {
    render(<MarkdownPreview markdown="<img src=x onerror=alert(1)>" />);

    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(screen.getByText(/<img src=x/)).toBeInTheDocument();
  });

  it("keeps underscores inside inline code literal", () => {
    render(<MarkdownPreview markdown="配置键：`LUCY_AGENT_TOKEN`。" />);

    expect(screen.getByText("LUCY_AGENT_TOKEN")).toHaveAttribute("translate", "no");
    expect(screen.queryByText("AGENT")).not.toBeInTheDocument();
  });

  it("downgrades dangerous link protocols to plain text", () => {
    render(<MarkdownPreview markdown="[bad](javascript:alert)" />);

    expect(screen.queryByRole("link", { name: "bad" })).not.toBeInTheDocument();
    expect(screen.getByText("bad")).toBeInTheDocument();
  });

  it("emits unique anchor ids for duplicate H2/H3 headings so TOC links never collide (P2-1)", () => {
    const { container } = render(
      <MarkdownPreview
        markdown={[
          "## Notes",
          "first",
          "## Notes",
          "second",
          "## Notes",
          "third"
        ].join("\n")}
      />
    );
    const headings = container.querySelectorAll("h2");
    expect(headings).toHaveLength(3);
    const ids = Array.from(headings).map((node) => node.id);
    expect(ids).toEqual(["notes", "notes-2", "notes-3"]);
    expect(new Set(ids).size).toBe(3);
  });
});

describe("wiki lib helpers", () => {
  it("wikiTitleFromContent prefers first heading over basename", () => {
    expect(wikiTitleFromContent("# Real Title\n\nbody", "global/foo.md")).toBe("Real Title");
  });

  it("wikiTitleFromContent falls back to basename without .md", () => {
    expect(wikiTitleFromContent("body without heading", "global/foo.md")).toBe("foo");
  });

  it("extractWikiToc returns level 2/3 headings with slugged ids", () => {
    const toc = extractWikiToc("# Top\n\n## A heading\n\n### Sub heading\n\n## A heading");
    expect(toc.map((item) => item.text)).toEqual(["A heading", "Sub heading", "A heading"]);
    expect(toc.map((item) => item.level)).toEqual([2, 3, 2]);
    expect(new Set(toc.map((item) => item.id)).size).toBe(toc.length);
  });

  it("groupWikiPages groups by directory and sorts pages", () => {
    const groups = groupWikiPages(WIKI_PAGES);
    const labels = groups.map((g) => g.directoryLabel);
    expect(labels).toEqual(["global", "kx", "poc"]);
    expect(groups[0]?.pages[0]?.key).toBe("global/superstore-analysis-playbook.md");
  });

  it("validateWikiDraft reports error / warning / info findings", () => {
    const findings = validateWikiDraft({
      key: "global/test",
      frontmatter: {},
      content: "<script>alert(1)</script>",
      knownSlRefs: new Set()
    });
    const levels = findings.map((f) => f.level);
    expect(levels).toContain("error");
    expect(levels).toContain("warning");
    expect(levels).toContain("info");
  });

  it("validateWikiDraft does not flag a single-line H1 as missing a title (P2-2)", () => {
    const findings = validateWikiDraft({
      key: "global/single-line-h1.md",
      frontmatter: {},
      content: "# Top heading\n\nbody paragraph",
      knownSlRefs: new Set()
    });
    const missingTitle = findings.find(
      (finding) => finding.message.includes("缺少 `# 一级标题`")
    );
    expect(missingTitle).toBeUndefined();
  });

  it("validateWikiDraft still flags a body that has no H1 at all (P2-2)", () => {
    const findings = validateWikiDraft({
      key: "global/no-h1.md",
      frontmatter: {},
      content: "Just a paragraph with no heading at all.",
      knownSlRefs: new Set()
    });
    const missingTitle = findings.find(
      (finding) => finding.message.includes("缺少 `# 一级标题`")
    );
    expect(missingTitle).toBeDefined();
    expect(missingTitle?.level).toBe("info");
  });
});

describe("WikiEditor Read Mode default (P0)", () => {
  it("renders an 编辑 button, shows Markdown preview text, no textarea, no Diff/Raw tabs", async () => {
    vi.stubGlobal("fetch", buildFetchMock());
    renderWiki("/wiki?key=global%2Fsuperstore-analysis-playbook.md");

    // Primary action is 编辑
    expect(await screen.findByTestId("wiki-edit-button")).toHaveTextContent("编辑");
    // Wait for the loaded page to be applied to the read view body.
    await waitFor(() => {
      expect(screen.getByTestId("wiki-read-body")).toHaveTextContent("Detailed notes here.");
    });
    // No source textarea in the default surface
    expect(screen.queryByTestId("wiki-edit-textarea")).not.toBeInTheDocument();
    // No persistent Diff / Raw tabs in read mode
    expect(screen.queryByRole("tab", { name: "Diff" })).not.toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Raw" })).not.toBeInTheDocument();
  });

  it("renders title from first heading, summary, tags and sl_ref badges in Meta Header", async () => {
    vi.stubGlobal("fetch", buildFetchMock());
    renderWiki("/wiki?key=global%2Fsuperstore-analysis-playbook.md");

    const title = await screen.findByTestId("wiki-read-title");
    await waitFor(() => {
      expect(title).toHaveTextContent("Superstore guide");
    });

    const summary = await screen.findByTestId("wiki-read-summary");
    expect(summary).toHaveTextContent("Superstore guide");

    const tags = screen.getByTestId("wiki-read-tags");
    expect(tags.textContent).toContain("analysis");

    const refs = screen.getByTestId("wiki-read-refs");
    expect(refs.textContent).toContain("dataforai.superstore_orders");
  });

  it("renders the TOC for ## and ### headings", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/wiki" && (!init || init.method === undefined)) {
        return new Response(JSON.stringify({ ok: true, data: { pages: WIKI_PAGES } }));
      }
      const pageMatch = url.match(/^\/api\/wiki\/(.+)$/);
      if (pageMatch && (!init || init.method === undefined)) {
        const key = decodeURIComponent(pageMatch[1]);
        const page = WIKI_PAGES.find((p) => p.key === key);
        if (!page) {
          return new Response(
            JSON.stringify({ ok: false, error: { code: "NOT_FOUND", message: "not found" } }),
            { status: 404 }
          );
        }
        const md = [
          `# ${page.summary}`,
          "",
          "## 业务背景",
          "",
          "### 数据依赖",
          "",
          "## 分析步骤"
        ].join("\n");
        return new Response(
          JSON.stringify({
            ok: true,
            data: {
              key: page.key,
              frontmatter: { summary: page.summary, tags: page.tags, sl_refs: page.slRefs },
              content: md,
              rawMarkdown: `---\n---\n${md}`
            }
          })
        );
      }
      if (url === "/api/sources") {
        return new Response(JSON.stringify({ ok: true, data: { tables: SOURCES } }));
      }
      if (pageMatch && init?.method === "PUT") {
        return new Response(
          JSON.stringify({
            ok: true,
            data: { key: decodeURIComponent(pageMatch[1]), filePath: "wiki/x", diff: "", proposedMarkdown: "" }
          })
        );
      }
      return new Response(JSON.stringify({ ok: false, error: { code: "NOT_FOUND", message: url } }));
    });
    vi.stubGlobal("fetch", fetchMock);
    renderWiki("/wiki?key=global%2Fsuperstore-analysis-playbook.md");

    const toc = await screen.findByTestId("wiki-read-toc");
    await waitFor(() => {
      expect(toc.textContent).toContain("业务背景");
    });
    expect(toc.textContent).toContain("数据依赖");
    expect(toc.textContent).toContain("分析步骤");
  });

  it("links a known sl_ref badge to the table detail page", async () => {
    vi.stubGlobal("fetch", buildFetchMock());
    renderWiki("/wiki?key=global%2Fsuperstore-analysis-playbook.md");

    const link = await screen.findByLabelText("打开 superstore_orders 表语义编辑器");
    expect(link).toHaveAttribute("href", "/sources/mysql-aliyun/dataforai/superstore_orders");
  });

  it("marks an unknown sl_ref as a warning badge in Read Mode", async () => {
    const pages = [
      {
        key: "global/orphan.md",
        summary: "Orphan page",
        tags: [],
        slRefs: ["mysql-aliyun/dataforai/ghost_table"]
      }
    ];
    vi.stubGlobal("fetch", buildFetchMock(pages));
    renderWiki("/wiki?key=global%2Forphan.md");

    const refs = await screen.findByTestId("wiki-read-refs");
    const refItem = refs.querySelector('[data-sl-ref-state="unknown"]');
    expect(refItem).not.toBeNull();
    // The dot/tooltip carries the "未知语义对象" status; the chip
    // label itself stays as the schema.table shorthand.
    expect(refs.textContent).not.toContain("未知语义对象未知语义对象");
  });

  it("aggregates > 3 linked semantic objects into a summary with unknown count", async () => {
    const refs = [
      "mysql-aliyun/dataforai/superstore_orders",
      "mysql-aliyun/dataforai/finance_orders",
      "mysql-aliyun/dataforai/ghost_one",
      "mysql-aliyun/dataforai/ghost_two",
      "mysql-aliyun/dataforai/ghost_three"
    ];
    const pages = [
      {
        key: "global/ksc-financial-analysis-playbook.md",
        summary: "KSC playbook",
        tags: [],
        slRefs: refs
      }
    ];
    vi.stubGlobal("fetch", buildFetchMock(pages));
    renderWiki("/wiki?key=global%2Fksc-financial-analysis-playbook.md");

    const summary = await screen.findByTestId("wiki-read-refs-summary");
    expect(summary).toHaveTextContent(`关联 ${refs.length} 个语义实体`);
    expect(summary).toHaveTextContent("3 未识别");

    // Expand to confirm the chip list renders all entries.
    fireEvent.click(screen.getByTestId("wiki-read-refs-summary-toggle"));
    const list = await screen.findByTestId("wiki-read-refs");
    const items = list.querySelectorAll('[data-testid="wiki-read-ref"]');
    expect(items.length).toBe(refs.length);
    const unknownChips = list.querySelectorAll('[data-sl-ref-state="unknown"]');
    expect(unknownChips.length).toBe(3);
  });

  it("keeps the desktop layout two-column so the article stays in the first viewport (P1-1)", async () => {
    vi.stubGlobal("fetch", buildFetchMock());
    renderWiki("/wiki?key=global%2Fsuperstore-analysis-playbook.md");

    const layout = await screen.findByTestId("wiki-layout");
    expect(layout.className.split(/\s+/)).toContain("pl-wiki-layout--read");

    // jsdom does not compute Tailwind-emitted CSS from app.css, so read
    // the stylesheet directly to pin the desktop rule that caused the
    // first-viewport regression.
    const css = readFileSync("src/app/app.css", "utf8");
    expect(css).toContain("grid-template-columns: 240px minmax(0, 1fr);");
    expect(css).toContain("@media (max-width: 768px)");
  });

  it("renders Markdown preview content via MarkdownPreview (no source textarea)", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/wiki" && (!init || init.method === undefined)) {
        return new Response(JSON.stringify({ ok: true, data: { pages: WIKI_PAGES } }));
      }
      const pageMatch = url.match(/^\/api\/wiki\/(.+)$/);
      if (pageMatch && (!init || init.method === undefined)) {
        const key = decodeURIComponent(pageMatch[1]);
        const page = WIKI_PAGES.find((p) => p.key === key);
        if (!page) {
          return new Response(
            JSON.stringify({ ok: false, error: { code: "NOT_FOUND", message: "not found" } }),
            { status: 404 }
          );
        }
        const md = [
          "# Heading One",
          "",
          "## Heading Two",
          "",
          "- list item one",
          "- list item two",
          "",
          "Inline `code()` and a fenced block:",
          "",
          "```sql",
          "SELECT 1;",
          "```"
        ].join("\n");
        return new Response(
          JSON.stringify({
            ok: true,
            data: {
              key: page.key,
              frontmatter: { summary: page.summary, tags: page.tags, sl_refs: page.slRefs },
              content: md,
              rawMarkdown: `---\n---\n${md}`
            }
          })
        );
      }
      if (url === "/api/sources") {
        return new Response(JSON.stringify({ ok: true, data: { tables: SOURCES } }));
      }
      if (pageMatch && init?.method === "PUT") {
        return new Response(
          JSON.stringify({
            ok: true,
            data: { key: decodeURIComponent(pageMatch[1]), filePath: "wiki/x", diff: "", proposedMarkdown: "" }
          })
        );
      }
      return new Response(JSON.stringify({ ok: false, error: { code: "NOT_FOUND", message: url } }));
    });
    vi.stubGlobal("fetch", fetchMock);
    renderWiki("/wiki?key=global%2Fsuperstore-analysis-playbook.md");

    const preview = await screen.findByTestId("wiki-markdown-preview");
    expect(preview.querySelector("h1")?.textContent).toBe("Heading One");
    expect(preview.querySelector("h2")?.textContent).toBe("Heading Two");
    expect(preview.querySelectorAll("li").length).toBe(2);
    expect(preview.querySelector("p code")?.textContent).toBe("code()");
    expect(preview.querySelector("pre code")?.textContent).toContain("SELECT 1;");
  });

  it("shows the empty-state hint and a Template Picker entry on an empty draft", async () => {
    vi.stubGlobal("fetch", buildFetchMock());
    renderWiki("/wiki?sl_ref=mysql-aliyun/dataforai/empty_table");

    const empty = await screen.findByTestId("wiki-read-empty");
    expect(empty.textContent).toContain("Wiki 维护 Markdown 业务说明");
    expect(empty.textContent).toContain("Schema Manifest 请在连接概览上传");
    expect(screen.getByTestId("wiki-read-empty-pick-template")).toBeInTheDocument();
  });

  it("clicking a template in the picker fills the editor and switches to Edit Mode", async () => {
    vi.stubGlobal("fetch", buildFetchMock());
    renderWiki("/wiki?sl_ref=mysql-aliyun/dataforai/empty_table");

    // Open the dedicated Template Picker modal from the empty state.
    fireEvent.click(await screen.findByTestId("wiki-read-empty-pick-template"));
    const template = await screen.findByTestId("wiki-template-option-表使用说明");
    fireEvent.click(template);

    // After picking a template, Edit Mode should be active and the
    // source textarea should contain the seeded body.
    const textarea = await screen.findByTestId("wiki-edit-textarea");
    expect((textarea as HTMLTextAreaElement).value).toContain("[请输入表标题]");
    const layout = screen.getByTestId("wiki-layout");
    expect(layout).toHaveAttribute("data-mode", "edit");
  });
});

describe("WikiEditor Edit Mode (P0)", () => {
  it("clicking 编辑 shows the source textarea and hides Diff / Raw tabs", async () => {
    vi.stubGlobal("fetch", buildFetchMock());
    renderWiki("/wiki?key=global%2Fsuperstore-analysis-playbook.md");

    const editButton = await screen.findByTestId("wiki-edit-button");
    fireEvent.click(editButton);

    expect(await screen.findByTestId("wiki-edit-textarea")).toBeInTheDocument();
    expect(await screen.findByTestId("wiki-edit-preview")).toBeInTheDocument();
    // Frontmatter form has been moved to a Drawer. The textarea is
    // never interrupted by inline form fields.
    expect(screen.queryByLabelText("添加关联语义对象")).not.toBeInTheDocument();
    // Persistent Diff / Raw tabs are absent
    expect(screen.queryByRole("tab", { name: "Diff" })).not.toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Raw" })).not.toBeInTheDocument();
  });

  it("opens the 文档信息 drawer from the header and exposes the frontmatter form", async () => {
    vi.stubGlobal("fetch", buildFetchMock());
    renderWiki("/wiki?key=global%2Fsuperstore-analysis-playbook.md");

    fireEvent.click(await screen.findByTestId("wiki-edit-button"));
    fireEvent.click(await screen.findByTestId("wiki-meta-toggle"));

    const drawer = await screen.findByTestId("wiki-meta-drawer");
    expect(drawer).toBeInTheDocument();
    expect(screen.getByLabelText("添加关联语义对象")).toBeInTheDocument();
    expect(screen.getByText("关联语义对象")).toBeInTheDocument();
    expect(screen.getByText("标签")).toBeInTheDocument();
    expect(screen.getByText("摘要")).toBeInTheDocument();
  });

  it("expanding 更多元信息 inside the drawer still reveals refs / usage_mode", async () => {
    vi.stubGlobal("fetch", buildFetchMock());
    renderWiki("/wiki?key=global%2Fsuperstore-analysis-playbook.md");

    fireEvent.click(await screen.findByTestId("wiki-edit-button"));
    fireEvent.click(await screen.findByTestId("wiki-meta-toggle"));
    await screen.findByTestId("wiki-meta-drawer");
    const advanced = screen.getByRole("button", { name: /更多元信息/ });
    fireEvent.click(advanced);

    expect(screen.getByLabelText(/外部引用/)).toBeInTheDocument();
    expect(screen.getByLabelText(/使用方式/)).toBeInTheDocument();
  });

  it("removes an sl_ref chip from the drawer and updates the dry-run payload", async () => {
    const fetchMock = buildFetchMock();
    vi.stubGlobal("fetch", fetchMock);
    renderWiki("/wiki?key=global%2Fsuperstore-analysis-playbook.md");

    fireEvent.click(await screen.findByTestId("wiki-edit-button"));
    fireEvent.click(await screen.findByTestId("wiki-meta-toggle"));

    const removeButton = await screen.findByLabelText(
      /移除关联语义对象 mysql-aliyun\/dataforai\/superstore_orders/
    );
    fireEvent.click(removeButton);

    await waitFor(() => {
      expect(
        screen.queryByLabelText(/移除关联语义对象 mysql-aliyun\/dataforai\/superstore_orders/)
      ).not.toBeInTheDocument();
    });

    await waitFor(() => {
      const latestDryRun = [...fetchMock.mock.calls]
        .reverse()
        .find((call) => call[1]?.method === "PUT" && JSON.parse(String(call[1]?.body)).dryRun === true);
      expect(latestDryRun).toBeTruthy();
      const body = JSON.parse(String(latestDryRun?.[1]?.body));
      expect(body.frontmatter?.sl_refs ?? []).not.toContain(
        "mysql-aliyun/dataforai/superstore_orders"
      );
    });
  });

  it("normalizes manually entered sl_refs inside the drawer before adding them", async () => {
    vi.stubGlobal("fetch", buildFetchMock());
    renderWiki("/wiki?sl_ref=mysql-aliyun/dataforai/ghost_table");

    fireEvent.click(await screen.findByTestId("wiki-edit-button"));
    fireEvent.click(await screen.findByTestId("wiki-meta-toggle"));

    const input = await screen.findByLabelText("添加关联语义对象");
    fireEvent.change(input, { target: { value: " mysql-aliyun//dataforai / second_ghost " } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(
      await screen.findByLabelText(/移除关联语义对象 mysql-aliyun\/dataforai\/second_ghost/)
    ).toBeInTheDocument();
  });

  it("renders the Markdown toolbar above the textarea with insertion actions", async () => {
    vi.stubGlobal("fetch", buildFetchMock());
    renderWiki("/wiki?key=global%2Fsuperstore-analysis-playbook.md");

    fireEvent.click(await screen.findByTestId("wiki-edit-button"));
    const toolbar = await screen.findByTestId("wiki-markdown-toolbar");
    expect(toolbar).toHaveAttribute("role", "toolbar");
    expect(screen.getByTestId("wiki-toolbar-bold")).toBeInTheDocument();
    expect(screen.getByTestId("wiki-toolbar-codeblock")).toBeInTheDocument();
    expect(screen.getByTestId("wiki-toolbar-table")).toBeInTheDocument();
    expect(screen.getByTestId("wiki-toolbar-link")).toBeInTheDocument();

    // Bold insertion wraps the current selection.
    const textarea = (await screen.findByTestId("wiki-edit-textarea")) as HTMLTextAreaElement;
    textarea.focus();
    textarea.setSelectionRange(0, 0);
    fireEvent.click(screen.getByTestId("wiki-toolbar-bold"));
    await waitFor(() => {
      expect((screen.getByTestId("wiki-edit-textarea") as HTMLTextAreaElement).value).toContain(
        "**加粗文本**"
      );
    });
  });

  it("switches back to read mode via the header 返回阅读 button", async () => {
    vi.stubGlobal("fetch", buildFetchMock());
    renderWiki("/wiki?key=global%2Fsuperstore-analysis-playbook.md");

    fireEvent.click(await screen.findByTestId("wiki-edit-button"));
    expect(await screen.findByTestId("wiki-edit-textarea")).toBeInTheDocument();

    fireEvent.click(await screen.findByTestId("wiki-back-to-read"));
    await waitFor(() => {
      expect(screen.queryByTestId("wiki-edit-textarea")).not.toBeInTheDocument();
    });
    expect(screen.getByTestId("wiki-layout")).toHaveAttribute("data-mode", "read");
  });

  it("toggles 专注编辑 to collapse the sidebar in edit mode", async () => {
    vi.stubGlobal("fetch", buildFetchMock());
    renderWiki("/wiki?key=global%2Fsuperstore-analysis-playbook.md");

    expect(screen.getByTestId("wiki-sidebar")).toBeVisible();
    fireEvent.click(await screen.findByTestId("wiki-edit-button"));
    fireEvent.click(await screen.findByTestId("wiki-focus-toggle"));

    await waitFor(() => {
      expect(screen.getByTestId("wiki-sidebar")).not.toBeVisible();
    });
    expect(screen.getByTestId("wiki-layout")).toHaveAttribute("data-focus", "true");
  });
});

describe("WikiEditor Save Preflight (P0)", () => {
  it("clicking 保存预检 opens the dialog with target, validation, diff, and raw collapse", async () => {
    vi.stubGlobal("fetch", buildFetchMock());
    renderWiki("/wiki?key=global%2Fsuperstore-analysis-playbook.md");

    fireEvent.click(await screen.findByTestId("wiki-edit-button"));
    fireEvent.click(await screen.findByTestId("wiki-save-preflight-button"));

    const dialog = await screen.findByTestId("wiki-save-preflight");
    expect(dialog).toBeInTheDocument();
    expect(dialog).toHaveTextContent("保存预检");
    expect(dialog.textContent).toContain("wiki/global/superstore-analysis-playbook.md");
    expect(dialog.textContent).toContain("Diff");
    // The Raw section is collapsed (secondary), not a persistent page tab
    expect(dialog.textContent).toContain("展开 Raw");
    expect(screen.queryByRole("tab", { name: "Raw" })).not.toBeInTheDocument();
    // Header no longer carries the reading/edit mode tablist.
    expect(screen.queryByTestId("wiki-header-modes")).not.toBeInTheDocument();
  });

  it("opening Save Preflight forces a fresh dry-run so Diff/Raw can never be stale (P0-1)", async () => {
    const fetchMock = buildFetchMock();
    vi.stubGlobal("fetch", fetchMock);
    renderWiki("/wiki?key=global%2Fsuperstore-analysis-playbook.md");

    // Edit the buffer in a way that keeps the previous preview at the
    // previous draft version, then open the preflight and assert that a
    // brand new dry-run is issued rather than the stale preview being
    // shown.
    fireEvent.click(await screen.findByTestId("wiki-edit-button"));
    const textarea = await screen.findByTestId("wiki-edit-textarea");
    fireEvent.change(textarea, { target: { value: "# Edited body\n\nNew section." } });

    fireEvent.click(await screen.findByTestId("wiki-save-preflight-button"));

    // The most recent PUT must be a dry-run issued after the buffer
    // change — that is the "force fresh" behavior.
    await waitFor(() => {
      const putCalls = fetchMock.mock.calls.filter((call) => call[1]?.method === "PUT");
      const last = putCalls.at(-1);
      expect(last).toBeTruthy();
      const body = JSON.parse(String(last?.[1]?.body));
      expect(body.dryRun).toBe(true);
      expect(body.content).toContain("# Edited body");
    });

    // The confirm button stays disabled until the fresh preview lands.
    const confirm = await screen.findByTestId("wiki-save-preflight-confirm");
    await waitFor(() => {
      expect(confirm).not.toBeDisabled();
    });
  });

  it("Save Preflight disables the confirm button while the dry-run is loading (P0-2)", async () => {
    let resolveDryRun: ((value: Response) => void) | null = null;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/wiki" && (!init || init.method === undefined)) {
        return new Response(JSON.stringify({ ok: true, data: { pages: WIKI_PAGES } }));
      }
      const pageMatch = url.match(/^\/api\/wiki\/(.+)$/);
      if (pageMatch && (!init || init.method === undefined)) {
        const key = decodeURIComponent(pageMatch[1]);
        const page = WIKI_PAGES.find((p) => p.key === key);
        if (!page) {
          return new Response(
            JSON.stringify({ ok: false, error: { code: "NOT_FOUND", message: "not found" } }),
            { status: 404 }
          );
        }
        return new Response(
          JSON.stringify({
            ok: true,
            data: {
              key: page.key,
              frontmatter: { summary: page.summary, tags: page.tags, sl_refs: page.slRefs },
              content: `# ${page.summary}\n\nDetailed notes here.`,
              rawMarkdown: `---\n---\n# ${page.summary}\n\nDetailed notes here.\n`
            }
          })
        );
      }
      if (url === "/api/sources") {
        return new Response(JSON.stringify({ ok: true, data: { tables: SOURCES } }));
      }
      if (pageMatch && init?.method === "PUT" && init.body && JSON.parse(String(init.body)).dryRun) {
        // Park the dry-run so the loading state is observable. The
        // latest caller wins; tests resolve the same promise to drive
        // the dialog out of the loading state.
        return await new Promise<Response>((resolve) => {
          resolveDryRun = resolve;
        });
      }
      if (pageMatch && init?.method === "PUT") {
        return new Response(
          JSON.stringify({
            ok: true,
            data: { key: decodeURIComponent(pageMatch[1]), filePath: "wiki/x", diff: "", proposedMarkdown: "" }
          })
        );
      }
      return new Response(JSON.stringify({ ok: false, error: { code: "NOT_FOUND", message: url } }));
    });
    vi.stubGlobal("fetch", fetchMock);
    renderWiki("/wiki?key=global%2Fsuperstore-analysis-playbook.md");

    // Wait for the page detail to land so the draft buffer matches the
    // loaded page before the Save Preflight captures a draft version.
    await screen.findByTestId("wiki-read-title");
    fireEvent.click(await screen.findByTestId("wiki-edit-button"));
    fireEvent.click(await screen.findByTestId("wiki-save-preflight-button"));

    const confirm = await screen.findByTestId("wiki-save-preflight-confirm");
    expect(confirm).toBeDisabled();
    expect(confirm).toHaveAttribute("aria-disabled", "true");
    expect(confirm).toHaveAttribute("title", "正在生成 Dry-run 预览");

    // Resolve the dry-run so the dialog finishes loading and the
    // confirm button unlocks, then verify normal save flow.
    const completeDryRun = resolveDryRun as ((value: Response) => void) | null;
    if (completeDryRun) {
      completeDryRun(
        new Response(
          JSON.stringify({
            ok: true,
            data: { key: "global/superstore-analysis-playbook.md", filePath: "wiki/x", diff: "", proposedMarkdown: "" }
          })
        )
      );
    }

    await waitFor(() => {
      expect(confirm).not.toBeDisabled();
    });
  });

  it("confirming the dialog sends dryRun:false and switches back to read mode", async () => {
    const fetchMock = buildFetchMock();
    vi.stubGlobal("fetch", fetchMock);
    renderWiki("/wiki?key=global%2Fsuperstore-analysis-playbook.md");

    fireEvent.click(await screen.findByTestId("wiki-edit-button"));
    fireEvent.click(await screen.findByTestId("wiki-save-preflight-button"));

    // The Save Preflight always forces a fresh dry-run when it opens,
    // so the confirm button stays disabled until that request lands.
    const confirm = await screen.findByTestId("wiki-save-preflight-confirm");
    await waitFor(() => {
      expect(confirm).not.toBeDisabled();
    });
    fireEvent.click(confirm);

    await waitFor(() => {
      const saveCall = fetchMock.mock.calls.find((call) => {
        if (call[1]?.method !== "PUT") return false;
        const body = JSON.parse(String(call[1]?.body));
        return body.dryRun === false;
      });
      expect(saveCall).toBeTruthy();
    });
    await waitFor(() => {
      expect(screen.queryByTestId("wiki-save-preflight")).not.toBeInTheDocument();
    });
    expect(screen.getByTestId("wiki-layout")).toHaveAttribute("data-mode", "read");
  });

  it("Cmd/Ctrl+S opens the Save Preflight without writing dryRun:false", async () => {
    const fetchMock = buildFetchMock();
    vi.stubGlobal("fetch", fetchMock);
    renderWiki("/wiki?key=global%2Fsuperstore-analysis-playbook.md");

    const event = new KeyboardEvent("keydown", { key: "s", metaKey: true, bubbles: true });
    document.body.dispatchEvent(event);

    const dialog = await screen.findByTestId("wiki-save-preflight");
    expect(dialog).toBeInTheDocument();

    const saveCall = fetchMock.mock.calls.find((call) => {
      if (call[1]?.method !== "PUT") return false;
      const body = JSON.parse(String(call[1]?.body));
      return body.dryRun === false;
    });
    expect(saveCall).toBeUndefined();
  });
});

describe("WikiEditor sl_ref handoff (existing M10 behavior)", () => {
  it("auto-selects a matching Wiki page when sl_ref resolves to an existing slRefs entry", async () => {
    vi.stubGlobal("fetch", buildFetchMock());
    renderWiki("/wiki?sl_ref=mysql-aliyun/dataforai/superstore_orders");

    // The matched page should be marked active in the tree
    const matchedButton = await screen.findByRole("button", { name: /Superstore guide/ });
    expect(matchedButton).toHaveAttribute("aria-current", "page");

    // Page detail should be loaded into the read view
    expect(await screen.findByTestId("wiki-read-title")).toHaveTextContent("Superstore guide");
    expect(await screen.findByTestId("wiki-read-summary")).toHaveTextContent("Superstore guide");

    await waitFor(() => {
      expect(screen.getByTestId("current-location")).toHaveTextContent(
        "/wiki?key=global%2Fsuperstore-analysis-playbook.md&sl_ref=mysql-aliyun%2Fdataforai%2Fsuperstore_orders"
      );
    });
  });

  it("creates a local prefilled draft for an unmatched sl_ref without writing to disk", async () => {
    const fetchMock = buildFetchMock();
    vi.stubGlobal("fetch", fetchMock);
    renderWiki("/wiki?sl_ref=mysql-aliyun/dataforai/unknown_table");

    // The draft key should be derived from the table segment and is
    // surfaced on the layout data attribute (the page-path input was
    // removed in M42).
    await waitFor(() => {
      expect(screen.getByTestId("wiki-layout")).toHaveAttribute(
        "data-key",
        "global/unknown_table.md"
      );
    });

    // No PUT save should have been issued yet (only PUT dry-runs for the preview are allowed)
    const putCalls = fetchMock.mock.calls.filter((call) => call[1]?.method === "PUT");
    for (const call of putCalls) {
      const body = JSON.parse(String(call[1]?.body));
      expect(body.dryRun).toBe(true);
    }
  });

  it("avoids repeated draft key collisions for unmatched sl_ref handoff", async () => {
    vi.stubGlobal("fetch", buildFetchMock([
      {
        key: "global/foo.md",
        summary: "Foo",
        tags: [],
        slRefs: []
      },
      {
        key: "global/foo-wiki.md",
        summary: "Foo Wiki",
        tags: [],
        slRefs: []
      }
    ]));
    renderWiki("/wiki?sl_ref=mysql-aliyun/dataforai/foo");

    await waitFor(() => {
      expect(screen.getByTestId("wiki-layout")).toHaveAttribute(
        "data-key",
        "global/foo-wiki-2.md"
      );
    });
  });

  it("renders the new-document button and a draft when a key is empty", async () => {
    vi.stubGlobal("fetch", buildFetchMock());
    renderWiki("/wiki");

    expect(screen.getByTestId("wiki-new-button")).toBeInTheDocument();
    expect(
      await screen.findByRole("button", { name: /Superstore guide/ })
    ).toBeInTheDocument();
  });
});

describe("WikiEditor Tree View (P1)", () => {
  it("groups pages by directory, shows document title as primary label and path as secondary text", async () => {
    vi.stubGlobal("fetch", buildFetchMock());
    renderWiki("/wiki");

    const groups = await screen.findAllByTestId("wiki-tree-group");
    const labels = groups.map((group) =>
      group.querySelector(".pl-wiki-tree-group-label")?.textContent
    );
    expect(labels).toEqual(expect.arrayContaining(["global", "poc", "kx"]));

    // Each row shows the summary as the primary title
    const superstoreRow = await screen.findByRole("button", { name: /Superstore guide/ });
    expect(superstoreRow.textContent).toContain("global/superstore-analysis-playbook.md");
    // The primary label is rendered before the muted path
    const title = superstoreRow.querySelector(".pl-wiki-tree-page-title")?.textContent;
    expect(title).toBe("Superstore guide");
  });

  it("search matches title, tag, and sl_ref", async () => {
    vi.stubGlobal("fetch", buildFetchMock());
    renderWiki("/wiki");

    const search = await screen.findByTestId("wiki-tree-search");
    // Search by tag
    fireEvent.change(search, { target: { value: "playbook" } });
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: /Superstore guide/ })).not.toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: /Financial playbook/ })).toBeInTheDocument();

    // Search by sl_ref
    fireEvent.change(search, { target: { value: "finance_orders" } });
    expect(screen.getByRole("button", { name: /Financial playbook/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /POC active/ })).not.toBeInTheDocument();

    // Reset search
    fireEvent.change(search, { target: { value: "" } });
    expect(screen.getByRole("button", { name: /POC active/ })).toBeInTheDocument();
  });
});

describe("Catalog table-level Wiki action", () => {
  let origFetch: typeof fetch | undefined;
  beforeEach(() => {
    origFetch = globalThis.fetch;
  });
  afterEach(() => {
    if (origFetch) {
      vi.stubGlobal("fetch", origFetch);
    } else {
      vi.unstubAllGlobals();
    }
  });

  it("renders a 业务 Wiki action per table row linking to /wiki with sl_ref", async () => {
    const { Catalog } = await import("../pages/Catalog");
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/sources") {
        return new Response(
          JSON.stringify({
            ok: true,
            data: { tables: SOURCES }
          })
        );
      }
      return new Response(JSON.stringify({ ok: true, data: {} }));
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={["/"]}>
          <Routes>
            <Route path="/" element={<Catalog />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    );

    // Catalog exposes the Wiki action through a RowMoreMenu, so we open
    // the menu for the superstore_orders row before asserting on the
    // menu item link.
    const triggers = await screen.findAllByTestId("row-more-trigger");
    fireEvent.click(triggers[0] ?? triggers[0]);

    const wikiLink = await screen.findByTestId("catalog-row-wiki-superstore_orders");
    expect(wikiLink).toHaveAttribute(
      "href",
      "/wiki?sl_ref=mysql-aliyun%2Fdataforai%2Fsuperstore_orders"
    );
  });
});
