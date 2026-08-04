// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MarkdownPreview } from "../components/MarkdownPreview";
import { WikiEditor } from "../pages/WikiEditor";
import { nextNewNoteKey } from "../lib/slRef";
import type { WikiDirectorySummary } from "../lib/types";
import {
  buildWikiDirectoryTree,
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

const NESTED_WIKI_PAGES = [
  ...WIKI_PAGES,
  {
    key: "ops/playbooks/month-end-close.md",
    summary: "Month end close",
    tags: ["ops"],
    slRefs: []
  },
  {
    key: "ops/runbooks/incident-response.md",
    summary: "Incident response",
    tags: ["ops"],
    slRefs: []
  }
];

const EMPTY_WIKI_DIRECTORIES: WikiDirectorySummary[] = [
  {
    path: "global",
    name: "global",
    documentCount: 1,
    explicit: true,
    empty: false
  },
  {
    path: "ops",
    name: "ops",
    documentCount: 0,
    explicit: true,
    empty: true
  },
  {
    path: "ops/playbooks",
    name: "playbooks",
    documentCount: 0,
    explicit: true,
    empty: true
  }
];

const WIKI_VERSIONS = [
  {
    versionId: "v-upload-replace",
    key: "global/superstore-analysis-playbook.md",
    createdAt: "2026-08-02T08:30:00.000Z",
    operation: "upload_replace",
    title: "Superstore guide",
    summary: "Uploaded replacement",
    sourceFileName: "指标服务表设计草案.md",
    contentHash: "hash-upload-replace"
  },
  {
    versionId: "v-create",
    key: "global/superstore-analysis-playbook.md",
    createdAt: "2026-08-02T08:00:00.000Z",
    operation: "create",
    title: "Superstore guide",
    summary: "Initial version",
    contentHash: "hash-create"
  }
];

const WIKI_VERSION_DETAILS = {
  "v-upload-replace": {
    ...WIKI_VERSIONS[0],
    rawMarkdown: "# 指标服务表设计草案\n\n历史版本内容。",
    diffFromCurrent: "@@\n-Detailed notes here.\n+历史版本内容。\n"
  },
  "v-create": {
    ...WIKI_VERSIONS[1],
    rawMarkdown: "# Superstore guide\n\nInitial body.",
    diffFromCurrent: "@@\n-Detailed notes here.\n+Initial body.\n"
  }
};

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

function buildFetchMock(
  pages = WIKI_PAGES,
  sources = SOURCES,
  directories: WikiDirectorySummary[] = []
) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === "/api/wiki" && (!init || init.method === undefined)) {
      return new Response(JSON.stringify({ ok: true, data: { pages, directories } }));
    }
    if (url === "/api/wiki/directories" && init?.method === "POST") {
      const body = JSON.parse(String(init.body));
      const path = body.path ?? [body.parent, body.name].filter(Boolean).join("/");
      const name = String(path).split("/").filter(Boolean).at(-1) ?? String(path);
      return new Response(
        JSON.stringify({
          ok: true,
          data: {
            directory: {
              path,
              name,
              documentCount: 0,
              explicit: true,
              empty: true
            },
            created: true,
            filePath: `wiki/${path}/`
          }
        })
      );
    }
    const rawMatch = url.match(/^\/api\/wiki\/(.+)\/raw$/);
    if (rawMatch && (!init || init.method === undefined)) {
      const key = decodeURIComponent(rawMatch[1]);
      const page = pages.find((p) => p.key === key);
      return new Response(`# ${page?.summary ?? "Raw"}\n\nDownloaded body.\n`, {
        headers: { "Content-Type": "text/markdown" }
      });
    }
    if (url === "/api/wiki/upload/preview" && init?.method === "POST") {
      const body = JSON.parse(String(init.body));
      const sourceFileName: string =
        typeof body.sourceFileName === "string" && body.sourceFileName.trim()
          ? String(body.sourceFileName).split(/[\\/]/).pop() || String(body.sourceFileName)
          : body.key.split("/").pop() ?? body.key;
      const warnings: string[] = [];
      if (sourceFileName !== body.key.split("/").pop()) {
        warnings.push(
          `本地文件名 ${sourceFileName} 与目标路径文件名 ${body.key.split("/").pop()} 不一致，将按目标 Wiki 路径保存。`
        );
      }
      return new Response(
        JSON.stringify({
          ok: true,
          data: {
            key: body.key,
            filePath: `wiki/${body.key}`,
            diff: `@@\n+# Uploaded\n`,
            proposedMarkdown: body.markdown,
            exists: Boolean(body.overwrite),
            mode: body.overwrite ? "replace" : "create",
            sourceFileName,
            targetKey: body.key,
            existingTitle: body.overwrite ? "Existing title" : null,
            targetTitle: "Uploaded",
            title: "Uploaded",
            slRefs: ["mysql-aliyun/dataforai/superstore_orders"],
            warnings
          }
        })
      );
    }
    if (url === "/api/wiki/upload/commit" && init?.method === "POST") {
      const body = JSON.parse(String(init.body));
      const sourceFileName: string =
        typeof body.sourceFileName === "string" && body.sourceFileName.trim()
          ? String(body.sourceFileName).split(/[\\/]/).pop() || String(body.sourceFileName)
          : body.key.split("/").pop() ?? body.key;
      return new Response(
        JSON.stringify({
          ok: true,
          data: {
            key: body.key,
            filePath: `wiki/${body.key}`,
            diff: `@@\n+# Uploaded\n`,
            proposedMarkdown: body.markdown,
            exists: Boolean(body.overwrite),
            mode: body.overwrite ? "replace" : "create",
            sourceFileName,
            targetKey: body.key,
            existingTitle: body.overwrite ? "Existing title" : null,
            targetTitle: "Uploaded",
            title: "Uploaded",
            slRefs: ["mysql-aliyun/dataforai/superstore_orders"],
            warnings: []
          }
        })
      );
    }
    if (init?.method === "DELETE" && url.startsWith("/api/wiki/directories/")) {
      const path = decodeURIComponent(url.replace("/api/wiki/directories/", ""));
      return new Response(
        JSON.stringify({
          ok: true,
          data: { path, deleted: true, filePath: `wiki/${path}/` }
        })
      );
    }
    const movePreviewMatch = url.match(/^\/api\/wiki\/(.+)\/move\/preview$/);
    if (movePreviewMatch && init?.method === "POST") {
      const sourceKey = decodeURIComponent(movePreviewMatch[1]);
      const body = JSON.parse(String(init.body));
      const targetDirectory = String(body.targetDirectory ?? "").replace(/^\/+|\/+$/g, "");
      const basename = sourceKey.split("/").pop() ?? sourceKey;
      const targetKey = targetDirectory ? `${targetDirectory}/${basename}` : basename;
      return new Response(
        JSON.stringify({
          ok: true,
          data: {
            key: targetKey,
            filePath: `wiki/${targetKey}`,
            diff: "",
            proposedMarkdown: "",
            sourceKey,
            targetKey,
            targetDirectory: targetDirectory,
            exists: false,
            title: sourceKey.split("/").pop()?.replace(/\.md$/, "") ?? sourceKey,
            basenameChanged: false,
            warnings: []
          }
        })
      );
    }
    const moveMatch = url.match(/^\/api\/wiki\/(.+)\/move$/);
    if (moveMatch && init?.method === "POST") {
      const sourceKey = decodeURIComponent(moveMatch[1]);
      const body = JSON.parse(String(init.body));
      const targetDirectory = String(body.targetDirectory ?? "").replace(/^\/+|\/+$/g, "");
      const basename = sourceKey.split("/").pop() ?? sourceKey;
      const targetKey = targetDirectory ? `${targetDirectory}/${basename}` : basename;
      return new Response(
        JSON.stringify({
          ok: true,
          data: {
            sourceKey,
            key: targetKey,
            targetDirectory,
            previousKey: sourceKey,
            newVersionId: "v-move",
            filePath: `wiki/${targetKey}`
          }
        })
      );
    }
    const versionsMatch = url.match(/^\/api\/wiki\/(.+)\/versions$/);
    if (versionsMatch && (!init || init.method === undefined)) {
      return new Response(
        JSON.stringify({
          ok: true,
          data: {
            key: decodeURIComponent(versionsMatch[1]),
            retentionLimit: 5,
            versions: WIKI_VERSIONS
          }
        })
      );
    }
    const versionDetailMatch = url.match(/^\/api\/wiki\/(.+)\/versions\/([^/]+)$/);
    if (versionDetailMatch && (!init || init.method === undefined)) {
      const versionId = decodeURIComponent(versionDetailMatch[2]);
      const detail = WIKI_VERSION_DETAILS[versionId as keyof typeof WIKI_VERSION_DETAILS];
      return new Response(JSON.stringify({ ok: true, data: detail }));
    }
    const restorePreviewMatch = url.match(
      /^\/api\/wiki\/(.+)\/versions\/([^/]+)\/restore\/preview$/
    );
    if (restorePreviewMatch && init?.method === "POST") {
      return new Response(
        JSON.stringify({
          ok: true,
          data: {
            key: decodeURIComponent(restorePreviewMatch[1]),
            versionId: decodeURIComponent(restorePreviewMatch[2]),
            targetTitle: "指标服务表设计草案",
            diff: "@@\n-Detailed notes here.\n+历史版本内容。\n"
          }
        })
      );
    }
    const restoreMatch = url.match(/^\/api\/wiki\/(.+)\/versions\/([^/]+)\/restore$/);
    if (restoreMatch && init?.method === "POST") {
      return new Response(
        JSON.stringify({
          ok: true,
          data: {
            key: decodeURIComponent(restoreMatch[1]),
            restoredFromVersionId: decodeURIComponent(restoreMatch[2]),
            newVersionId: "v-restored",
            filePath: `wiki/${decodeURIComponent(restoreMatch[1])}`
          }
        })
      );
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

  it("drops a leading H1 that duplicates hideLeadingHeading (UX-WIKI-022)", () => {
    const { container } = render(
      <MarkdownPreview
        hideLeadingHeading="Superstore guide"
        markdown={"# Superstore guide\n\nDetailed notes here."}
      />
    );

    expect(container.querySelectorAll("h1")).toHaveLength(0);
    expect(screen.getByText("Detailed notes here.")).toBeInTheDocument();
  });

  it("keeps a leading H1 that does not match hideLeadingHeading (UX-WIKI-022)", () => {
    const { container } = render(
      <MarkdownPreview
        hideLeadingHeading="Superstore guide"
        markdown={"# Heading One\n\nDetailed notes here."}
      />
    );

    expect(container.querySelector("h1")?.textContent).toBe("Heading One");
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

  it("buildWikiDirectoryTree preserves sibling and nested directories with subtree document counts", () => {
    const tree = buildWikiDirectoryTree(NESTED_WIKI_PAGES);
    const ops = tree.find((node) => node.path === "ops");
    expect(tree.map((node) => node.path)).toEqual(
      expect.arrayContaining(["global", "kx", "ops", "poc"])
    );
    expect(ops?.documentCount).toBe(2);
    expect(ops?.children.map((node) => node.path)).toEqual([
      "ops/playbooks",
      "ops/runbooks"
    ]);
    expect(ops?.children[0]?.pages[0]?.key).toBe("ops/playbooks/month-end-close.md");
  });

  it("buildWikiDirectoryTree keeps root-level markdown files separate from top-level directories", () => {
    const tree = buildWikiDirectoryTree([
      { key: "root-note.md", summary: "Root note", tags: [], slRefs: [] },
      { key: "global/guide.md", summary: "Guide", tags: [], slRefs: [] }
    ]);
    expect(tree.map((node) => node.path)).toEqual(["", "global"]);
    expect(tree[0]).toMatchObject({
      path: "",
      documentCount: 1
    });
    expect(tree[0]?.children).toEqual([]);
    expect(tree[1]?.documentCount).toBe(1);
  });

  it("nextNewNoteKey can allocate a draft under a selected directory", () => {
    expect(nextNewNoteKey(["kx/new-note.md"], "kx")).toBe("kx/new-note-2.md");
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
    // UX-WIKI-022: the fixture body's first heading equals the page
    // title ("Superstore guide"), so it must not be rendered twice.
    expect(screen.getByTestId("wiki-read-body").querySelectorAll("h1")).toHaveLength(0);
  });

  it("renders title, tags and linked table badges without a visible file path", async () => {
    vi.stubGlobal("fetch", buildFetchMock());
    renderWiki("/wiki?key=global%2Fsuperstore-analysis-playbook.md");

    const title = await screen.findByTestId("wiki-read-title");
    await waitFor(() => {
      expect(title).toHaveTextContent("Superstore guide");
    });

    const meta = await screen.findByTestId("wiki-read-meta");
    expect(meta).not.toHaveTextContent("wiki/global/superstore-analysis-playbook.md");

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
    expect(link).toHaveAttribute("href", "/catalog/mysql-aliyun/dataforai/superstore_orders");
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

  it("gives nested directory lists a left guide line for hierarchy (UX-WIKI-019)", () => {
    const css = readFileSync("src/app/app.css", "utf8");
    const rule = css.match(/\.pl-wiki-tree-pages\s*\{[^}]*\}/)?.[0] ?? "";
    expect(rule).toContain("border-l");
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

  it("keeps low-frequency metadata and focus controls out of the edit header", async () => {
    vi.stubGlobal("fetch", buildFetchMock());
    renderWiki("/wiki?key=global%2Fsuperstore-analysis-playbook.md");

    fireEvent.click(await screen.findByTestId("wiki-edit-button"));

    expect(await screen.findByTestId("wiki-edit-textarea")).toBeInTheDocument();
    expect(screen.queryByTestId("wiki-meta-toggle")).not.toBeInTheDocument();
    expect(screen.queryByTestId("wiki-focus-toggle")).not.toBeInTheDocument();
    expect(screen.getByTestId("wiki-back-to-read")).toHaveTextContent("取消");
    expect(screen.getByTestId("wiki-save-preflight-button")).toHaveTextContent("保存并发布");
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

  it("prompts before cancelling dirty edit mode and then restores the saved body", async () => {
    vi.stubGlobal("fetch", buildFetchMock());
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValueOnce(false).mockReturnValueOnce(true);
    renderWiki("/wiki?key=global%2Fsuperstore-analysis-playbook.md");

    fireEvent.click(await screen.findByTestId("wiki-edit-button"));
    const textarea = (await screen.findByTestId("wiki-edit-textarea")) as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "# Unsaved\n\nDraft" } });

    fireEvent.click(await screen.findByTestId("wiki-back-to-read"));
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("wiki-layout")).toHaveAttribute("data-mode", "edit");

    fireEvent.click(await screen.findByTestId("wiki-back-to-read"));
    await waitFor(() => {
      expect(screen.queryByTestId("wiki-edit-textarea")).not.toBeInTheDocument();
    });
    expect(screen.getByTestId("wiki-layout")).toHaveAttribute("data-mode", "read");
    expect(await screen.findByTestId("wiki-read-body")).toHaveTextContent("Detailed notes here.");
  });

  it("prompts before navigating away from a dirty document", async () => {
    const fetchMock = buildFetchMock();
    vi.stubGlobal("fetch", fetchMock);
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValueOnce(false).mockReturnValueOnce(true);
    renderWiki("/wiki?key=global%2Fsuperstore-analysis-playbook.md");

    fireEvent.click(await screen.findByTestId("wiki-edit-button"));
    const textarea = (await screen.findByTestId("wiki-edit-textarea")) as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "# Unsaved\n\nDraft" } });

    const tree = within(screen.getByTestId("wiki-tree"));
    // UX-WIKI-020: the tree no longer lists every document by default,
    // so search for the target document before clicking it.
    fireEvent.change(tree.getByTestId("wiki-tree-search"), {
      target: { value: "Financial playbook" }
    });
    fireEvent.click(tree.getByRole("button", { name: /Financial playbook/ }));
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("wiki-layout")).toHaveAttribute(
      "data-key",
      "global/superstore-analysis-playbook.md"
    );

    await waitFor(() => {
      expect(screen.getByTestId("wiki-layout")).toHaveAttribute("data-mode", "edit");
    });

    fireEvent.click(tree.getByRole("button", { name: /Financial playbook/ }));
    await waitFor(() => {
      expect(screen.getByTestId("wiki-layout")).toHaveAttribute(
        "data-key",
        "kx/financial-analysis-playbook.md"
      );
    });
    expect(screen.getByTestId("wiki-layout")).toHaveAttribute("data-mode", "read");
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
    const meta = await screen.findByTestId("wiki-read-meta");
    expect(meta).not.toHaveTextContent("wiki/global/superstore-analysis-playbook.md");
    expect(meta).toHaveTextContent("dataforai.superstore_orders");

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

  it("renders the neutral Markdown library home when the key is empty", async () => {
    vi.stubGlobal("fetch", buildFetchMock());
    renderWiki("/wiki");

    expect(screen.getByTestId("wiki-new-button")).toBeInTheDocument();
    expect(screen.getByTestId("wiki-upload-button")).toBeInTheDocument();
    // M64：hero 大标题文案移除，"Markdown 文档库" 退化为 aria-label
    const home = await screen.findByTestId("wiki-library-home");
    expect(home).toHaveAttribute("aria-label", "Markdown 文档库");
    expect(home).toHaveTextContent("当前收录");
    expect(screen.getAllByRole("button", { name: "上传 Markdown" })).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: "新建文档" })).toHaveLength(1);
    expect(screen.getByTestId("wiki-body")).toHaveClass("pl-wiki-body--library");
    // M64：右侧改为 Markdown 文档列表
    const documents = await screen.findByTestId("wiki-library-documents");
    expect(within(documents).getAllByTestId("wiki-library-document").length).toBeGreaterThan(0);
    expect(home).toHaveTextContent("篇");
    expect(screen.queryByTestId("wiki-library-groups")).not.toBeInTheDocument();
    expect(screen.queryByTestId("wiki-read-title")).not.toBeInTheDocument();
    expect(screen.getByTestId("wiki-layout")).not.toHaveAttribute("data-key");
  });

  it("renders empty directories from the API as independent resources", async () => {
    vi.stubGlobal("fetch", buildFetchMock(WIKI_PAGES, SOURCES, EMPTY_WIKI_DIRECTORIES));
    renderWiki("/wiki");

    const tree = await screen.findByTestId("wiki-tree");
    await waitFor(() => {
      expect(within(tree).getByRole("button", { name: /ops\s*0\s*篇/ })).toBeInTheDocument();
    });
    expect(within(tree).getByRole("button", { name: /playbooks\s*0\s*篇/ })).toBeInTheDocument();
    // M64：右侧文档列表只展示 Markdown 文档；空目录只出现在左侧 tree
    const documents = await screen.findByTestId("wiki-library-documents");
    expect(documents).toBeInTheDocument();
    expect(documents).not.toHaveTextContent("ops");

    fireEvent.change(within(tree).getByTestId("wiki-tree-search"), {
      target: { value: "playbooks" }
    });
    expect(within(tree).getByRole("button", { name: /playbooks\s*0\s*篇/ })).toBeInTheDocument();
  });

  it("creates a draft in a selected subdirectory", async () => {
    vi.stubGlobal("fetch", buildFetchMock());
    renderWiki("/wiki");

    fireEvent.click(await screen.findByTestId("wiki-new-button"));
    const dialog = await screen.findByTestId("wiki-new-document-dialog");
    fireEvent.change(within(dialog).getByTestId("wiki-new-directory-input"), {
      target: { value: "kx" }
    });
    fireEvent.change(within(dialog).getByTestId("wiki-new-file-input"), {
      target: { value: "metrics-playbook.md" }
    });
    expect(within(dialog).getByTestId("wiki-new-target-preview")).toHaveTextContent(
      "wiki/kx/metrics-playbook.md"
    );
    fireEvent.click(within(dialog).getByTestId("wiki-new-confirm"));

    await waitFor(() => {
      expect(screen.getByTestId("wiki-layout")).toHaveAttribute(
        "data-key",
        "kx/metrics-playbook.md"
      );
    });
    expect(screen.getByTestId("current-location")).toHaveTextContent(
      "/wiki?key=kx%2Fmetrics-playbook.md"
    );
  });

  it("jumps from 新建文档 to 新建目录 with the current target directory (UX-WIKI-021)", async () => {
    vi.stubGlobal("fetch", buildFetchMock());
    renderWiki("/wiki");

    fireEvent.click(await screen.findByTestId("wiki-new-button"));
    const documentDialog = await screen.findByTestId("wiki-new-document-dialog");
    fireEvent.change(within(documentDialog).getByTestId("wiki-new-directory-input"), {
      target: { value: "ops/playbooks" }
    });

    fireEvent.click(within(documentDialog).getByTestId("wiki-new-document-open-directory"));

    expect(screen.queryByTestId("wiki-new-document-dialog")).not.toBeInTheDocument();
    const directoryDialog = await screen.findByTestId("wiki-new-directory-dialog");
    expect(within(directoryDialog).getByTestId("wiki-new-directory-parent-input")).toHaveValue(
      "ops/playbooks"
    );
  });
});

describe("WikiEditor Markdown file operations (M47)", () => {
  it("downloads the saved raw Markdown for the selected document", async () => {
    const fetchMock = buildFetchMock();
    vi.stubGlobal("fetch", fetchMock);
    const createObjectURL = vi.fn(() => "blob:wiki-download");
    const revokeObjectURL = vi.fn();
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: createObjectURL
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: revokeObjectURL
    });
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);

    renderWiki("/wiki?key=global%2Fsuperstore-analysis-playbook.md");
    fireEvent.click(await screen.findByTestId("wiki-download-button"));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/wiki/global%2Fsuperstore-analysis-playbook.md/raw"
      );
    });
    expect(createObjectURL).toHaveBeenCalled();
    expect(clickSpy).toHaveBeenCalled();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:wiki-download");
  });

  it("opens upload preview from the library home and commits a new Markdown document", async () => {
    const fetchMock = buildFetchMock();
    vi.stubGlobal("fetch", fetchMock);
    renderWiki("/wiki");

    fireEvent.click(await screen.findByTestId("wiki-upload-button"));
    const input = screen.getByTestId("wiki-upload-input") as HTMLInputElement;
    const file = new File(
      ["---\nsummary: Uploaded\nsl_refs:\n  - mysql-aliyun/dataforai/superstore_orders\n---\n# Uploaded\n"],
      "uploaded.md",
      { type: "text/markdown" }
    );
    fireEvent.change(input, { target: { files: [file] } });

    const dialog = await screen.findByTestId("wiki-upload-preflight");
    await waitFor(() => {
      expect(dialog).toHaveTextContent("wiki/global/uploaded.md");
    });
    expect(dialog).toHaveTextContent("关联表");
    expect(dialog).toHaveTextContent("mysql-aliyun/dataforai/superstore_orders");

    fireEvent.change(screen.getByTestId("wiki-upload-directory-input"), {
      target: { value: "ops/playbooks" }
    });
    await waitFor(() => {
      expect(dialog).toHaveTextContent("wiki/ops/playbooks/uploaded.md");
    });

    fireEvent.click(screen.getByTestId("wiki-upload-confirm"));
    await waitFor(() => {
      const commit = fetchMock.mock.calls.find((call) => call[0] === "/api/wiki/upload/commit");
      expect(commit).toBeTruthy();
      const body = JSON.parse(String(commit?.[1]?.body));
      expect(body.key).toBe("ops/playbooks/uploaded.md");
      expect(body.markdown).toContain("# Uploaded");
      expect(body.sourceFileName).toBe("uploaded.md");
    });
    await waitFor(() => {
      expect(screen.getByTestId("current-location")).toHaveTextContent(
        "/wiki?key=ops%2Fplaybooks%2Fuploaded.md"
      );
    });
  });

  it("opens upload overwrite preview for the current document", async () => {
    const fetchMock = buildFetchMock();
    vi.stubGlobal("fetch", fetchMock);
    renderWiki("/wiki?key=global%2Fsuperstore-analysis-playbook.md");

    fireEvent.click(await screen.findByTestId("wiki-upload-replace-button"));
    const input = screen.getByTestId("wiki-upload-input") as HTMLInputElement;
    const file = new File(["# Replacement\n"], "replacement.md", { type: "text/markdown" });
    fireEvent.change(input, { target: { files: [file] } });

    const dialog = await screen.findByTestId("wiki-upload-preflight");
    await waitFor(() => {
      expect(dialog).toHaveTextContent("上传覆盖预检");
    });
    expect(dialog).toHaveTextContent("wiki/global/superstore-analysis-playbook.md");
    expect(within(dialog).getByTestId("wiki-upload-summary-source")).toHaveTextContent("replacement.md");
    expect(within(dialog).getByTestId("wiki-upload-summary-target")).toHaveTextContent(
      "wiki/global/superstore-analysis-playbook.md"
    );
    expect(within(dialog).getByTestId("wiki-upload-summary-existing")).toHaveTextContent("Existing title");
    expect(within(dialog).getByTestId("wiki-upload-summary-title")).toHaveTextContent("Uploaded");
    expect(within(dialog).getByTestId("wiki-upload-warnings")).toHaveTextContent("replacement.md");

    fireEvent.click(screen.getByTestId("wiki-upload-confirm"));
    await waitFor(() => {
      const commit = fetchMock.mock.calls.find((call) => call[0] === "/api/wiki/upload/commit");
      expect(commit).toBeTruthy();
      const body = JSON.parse(String(commit?.[1]?.body));
      expect(body.key).toBe("global/superstore-analysis-playbook.md");
      expect(body.overwrite).toBe(true);
      expect(body.sourceFileName).toBe("replacement.md");
    });
  });

  it("opens version history, previews a historical Markdown version and restores it", async () => {
    const fetchMock = buildFetchMock();
    vi.stubGlobal("fetch", fetchMock);
    renderWiki("/wiki?key=global%2Fsuperstore-analysis-playbook.md");

    await waitFor(() => {
      expect(screen.getByTestId("wiki-read-body")).toHaveTextContent("Detailed notes here.");
    });
    fireEvent.click(await screen.findByTestId("wiki-version-button"));

    const dialog = await screen.findByTestId("wiki-version-history-dialog");
    await waitFor(() => {
      expect(dialog).toHaveTextContent("保留最近 5 版 Markdown 快照");
    });
    expect(dialog).toHaveTextContent("指标服务表设计草案.md");

    // UX-WIKI-025: 历史版本 renders as a table with a clear header row.
    const table = within(dialog).getByTestId("wiki-version-table");
    expect(table.tagName).toBe("TABLE");
    expect(table).toHaveTextContent("时间");
    expect(table).toHaveTextContent("操作类型");
    expect(table).toHaveTextContent("版本");
    expect(table).toHaveTextContent("操作");

    // UX-WIKI-025: 历史预览 stays lazy until the user clicks 查看 — no
    // version is auto-selected when the dialog opens.
    expect(screen.queryByTestId("wiki-version-markdown-preview")).not.toBeInTheDocument();
    expect(screen.queryByTestId("wiki-version-diff")).not.toBeInTheDocument();
    expect(dialog).toHaveTextContent("选择一个历史版本查看 Markdown 预览和 Diff。");

    fireEvent.click(await screen.findByTestId("wiki-version-view-v-upload-replace"));
    await waitFor(() => {
      expect(screen.getByTestId("wiki-version-markdown-preview")).toHaveTextContent(
        "历史版本内容"
      );
    });
    expect(screen.getByTestId("wiki-version-diff")).toHaveTextContent("Detailed notes here");

    fireEvent.click(screen.getByTestId("wiki-version-restore-v-upload-replace"));
    const restoreDialog = await screen.findByTestId("wiki-restore-preflight");
    await waitFor(() => {
      expect(restoreDialog).toHaveTextContent("指标服务表设计草案");
    });
    expect(restoreDialog).toHaveTextContent("v-upload-replace");

    fireEvent.click(screen.getByTestId("wiki-restore-confirm"));
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/wiki/global%2Fsuperstore-analysis-playbook.md/versions/v-upload-replace/restore",
        expect.objectContaining({ method: "POST" })
      );
    });
    await waitFor(() => {
      expect(screen.queryByTestId("wiki-restore-preflight")).not.toBeInTheDocument();
    });
  });
});

describe("WikiEditor Tree View (P1)", () => {
  it("groups pages by directory and shows document title without visible raw path", async () => {
    vi.stubGlobal("fetch", buildFetchMock());
    renderWiki("/wiki");

    const tree = await screen.findByTestId("wiki-tree");
    await waitFor(() => {
      expect(within(tree).getAllByTestId("wiki-tree-group").length).toBeGreaterThan(0);
    });
    const groups = within(tree).getAllByTestId("wiki-tree-group");
    const labels = groups.map((group) =>
      group.querySelector(".pl-wiki-tree-group-label")?.textContent
    );
    expect(labels).toEqual(expect.arrayContaining(["global", "poc", "kx"]));
    expect(groups[0]).toHaveTextContent("1 篇");

    // UX-WIKI-020: by default the tree only shows directories + counts,
    // no document rows.
    expect(
      within(tree).queryByRole("button", { name: /Superstore guide/ })
    ).not.toBeInTheDocument();

    // Searching reveals the matching document row with its summary as
    // the primary title.
    fireEvent.change(within(tree).getByTestId("wiki-tree-search"), {
      target: { value: "Superstore" }
    });
    const superstoreRow = within(tree).getByRole("button", { name: /Superstore guide/ });
    expect(superstoreRow.textContent).not.toContain("global/superstore-analysis-playbook.md");
    const title = superstoreRow.querySelector(".pl-wiki-tree-page-title")?.textContent;
    expect(title).toBe("Superstore guide");
  });

  it("renders nested directories and keeps ancestor folders during search", async () => {
    vi.stubGlobal("fetch", buildFetchMock(NESTED_WIKI_PAGES));
    renderWiki("/wiki");

    const tree = await screen.findByTestId("wiki-tree");
    await waitFor(() => {
      expect(within(tree).getByRole("button", { name: /ops\s*2\s*篇/ })).toBeInTheDocument();
    });
    expect(within(tree).getByRole("button", { name: /playbooks\s*1\s*篇/ })).toBeInTheDocument();
    expect(within(tree).getByRole("button", { name: /runbooks\s*1\s*篇/ })).toBeInTheDocument();

    fireEvent.click(within(tree).getByRole("button", { name: /ops\s*2\s*篇/ }));
    expect(within(tree).queryByRole("button", { name: /Month end close/ })).not.toBeInTheDocument();

    fireEvent.change(within(tree).getByTestId("wiki-tree-search"), {
      target: { value: "Month end" }
    });

    expect(within(tree).getByRole("button", { name: /ops\s*1\s*篇/ })).toBeInTheDocument();
    expect(within(tree).getByRole("button", { name: /playbooks\s*1\s*篇/ })).toBeInTheDocument();
    expect(within(tree).getByRole("button", { name: /Month end close/ })).toBeInTheDocument();
    expect(within(tree).queryByRole("button", { name: /runbooks\s*1\s*篇/ })).not.toBeInTheDocument();
  });

  it("separates sidebar create-directory and create-document actions", async () => {
    const fetchMock = buildFetchMock(WIKI_PAGES, SOURCES, EMPTY_WIKI_DIRECTORIES);
    vi.stubGlobal("fetch", fetchMock);
    renderWiki("/wiki");

    fireEvent.click(await screen.findByTestId("wiki-sidebar-create-directory"));
    const directoryDialog = await screen.findByTestId("wiki-new-directory-dialog");
    expect(within(directoryDialog).getByTestId("wiki-new-directory-parent-input")).toHaveValue("global");
    fireEvent.change(within(directoryDialog).getByTestId("wiki-new-directory-name-input"), {
      target: { value: "playbooks" }
    });
    expect(within(directoryDialog).getByTestId("wiki-new-directory-target-preview")).toHaveTextContent(
      "wiki/global/playbooks/"
    );
    fireEvent.click(within(directoryDialog).getByTestId("wiki-new-directory-confirm"));

    await waitFor(() => {
      const createCall = fetchMock.mock.calls.find((call) => call[0] === "/api/wiki/directories");
      expect(createCall).toBeTruthy();
      expect(JSON.parse(String(createCall?.[1]?.body))).toEqual({
        parent: "global",
        name: "playbooks"
      });
    });

    fireEvent.click(await screen.findByTestId("wiki-sidebar-create-document"));
    const documentDialog = await screen.findByTestId("wiki-new-document-dialog");
    expect(within(documentDialog).getByTestId("wiki-new-directory-input")).toHaveValue("global");
  });

  it("opens scoped directory menus for child directories and documents", async () => {
    vi.stubGlobal("fetch", buildFetchMock(NESTED_WIKI_PAGES));
    renderWiki("/wiki");

    fireEvent.click(await screen.findByTestId("wiki-sidebar-create-document"));
    let dialog = await screen.findByTestId("wiki-new-document-dialog");
    expect(within(dialog).getByTestId("wiki-new-directory-input")).toHaveValue("global");
    expect(dialog.querySelector('option[value="ops"]')).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "取消" }));

    const tree = await screen.findByTestId("wiki-tree");
    fireEvent.click(await within(tree).findByRole("button", { name: "ops/playbooks 目录操作" }));
    fireEvent.click(await within(tree).findByTestId("wiki-tree-create-document-ops-playbooks"));
    dialog = await screen.findByTestId("wiki-new-document-dialog");
    expect(within(dialog).getByTestId("wiki-new-directory-input")).toHaveValue("ops/playbooks");
    expect(within(dialog).getByTestId("wiki-new-target-preview")).toHaveTextContent(
      "wiki/ops/playbooks/new-note.md"
    );
    fireEvent.click(within(dialog).getByRole("button", { name: "取消" }));

    fireEvent.click(await within(tree).findByRole("button", { name: "ops/playbooks 目录操作" }));
    fireEvent.click(await within(tree).findByTestId("wiki-tree-create-directory-ops-playbooks"));
    const directoryDialog = await screen.findByTestId("wiki-new-directory-dialog");
    expect(within(directoryDialog).getByTestId("wiki-new-directory-parent-input")).toHaveValue(
      "ops/playbooks"
    );
  });
});

describe("WikiEditor directory and document governance (M56)", () => {
  it("creates a top-level directory via the 顶层目录 checkbox (UX-WIKI-008)", async () => {
    const fetchMock = buildFetchMock();
    vi.stubGlobal("fetch", fetchMock);
    renderWiki("/wiki");

    fireEvent.click(await screen.findByTestId("wiki-sidebar-create-directory"));
    const dialog = await screen.findByTestId("wiki-new-directory-dialog");
    const checkbox = within(dialog).getByTestId("wiki-new-directory-top-level-checkbox") as HTMLInputElement;
    fireEvent.click(checkbox);
    expect(checkbox.checked).toBe(true);

    fireEvent.change(within(dialog).getByTestId("wiki-new-directory-name-input"), {
      target: { value: "browser-top" }
    });

    // Parent input is disabled + cleared when the top-level checkbox is on,
    // and the preview reflects wiki/browser-top/.
    expect(within(dialog).getByTestId("wiki-new-directory-parent-input")).toHaveValue("");
    expect(within(dialog).getByTestId("wiki-new-directory-parent-input")).toBeDisabled();
    expect(within(dialog).getByTestId("wiki-new-directory-target-preview")).toHaveTextContent(
      "wiki/browser-top/"
    );

    fireEvent.click(within(dialog).getByTestId("wiki-new-directory-confirm"));

    await waitFor(() => {
      const createCall = fetchMock.mock.calls.find((call) => call[0] === "/api/wiki/directories");
      expect(createCall).toBeTruthy();
      const body = JSON.parse(String(createCall?.[1]?.body));
      expect(body).toEqual({ path: "browser-top" });
    });
  });

  it("deletes an empty directory through the WikiTree menu (UX-WIKI-010)", async () => {
    const fetchMock = buildFetchMock(WIKI_PAGES, SOURCES, EMPTY_WIKI_DIRECTORIES);
    vi.stubGlobal("fetch", fetchMock);
    renderWiki("/wiki?key=global%2Fsuperstore-analysis-playbook.md");

    const tree = await screen.findByTestId("wiki-tree");
    const opsButton = await within(tree).findByRole("button", { name: /ops\s*0\s*篇/ });
    // Open the ops directory `...` menu and pick 删除目录.
    fireEvent.click(await within(tree).findByRole("button", { name: "ops 目录操作" }));
    const deleteItem = await within(tree).findByTestId("wiki-tree-delete-directory-ops");
    expect(deleteItem).not.toBeDisabled();
    fireEvent.click(deleteItem);

    const confirmDialog = await screen.findByTestId("wiki-delete-directory-dialog");
    expect(within(confirmDialog).getByTestId("wiki-delete-directory-target")).toHaveTextContent(
      "wiki/ops/"
    );

    fireEvent.click(within(confirmDialog).getByTestId("wiki-delete-directory-confirm"));

    await waitFor(() => {
      const deleteCall = fetchMock.mock.calls.find(
        (call) => call[0] === "/api/wiki/directories/ops" && call[1]?.method === "DELETE"
      );
      expect(deleteCall).toBeTruthy();
    });
  });

  it("disables 删除目录 for non-empty directories and explains why (UX-WIKI-010)", async () => {
    const fetchMock = buildFetchMock(WIKI_PAGES, SOURCES, [
      {
        path: "global",
        name: "global",
        documentCount: 1,
        explicit: true,
        empty: false
      }
    ]);
    vi.stubGlobal("fetch", fetchMock);
    renderWiki("/wiki?key=global%2Fsuperstore-analysis-playbook.md");

    const tree = await screen.findByTestId("wiki-tree");
    fireEvent.click(await within(tree).findByRole("button", { name: "global 目录操作" }));
    const deleteItem = await within(tree).findByTestId("wiki-tree-delete-directory-global");
    expect(deleteItem).toBeDisabled();
    expect(deleteItem).toHaveAttribute("aria-disabled", "true");
    expect(deleteItem.getAttribute("title") ?? "").toContain("请先移动或删除内容");
  });

  it("moves the current document into another directory (UX-WIKI-011)", async () => {
    const fetchMock = buildFetchMock();
    vi.stubGlobal("fetch", fetchMock);
    renderWiki("/wiki?key=global%2Fsuperstore-analysis-playbook.md");

    fireEvent.click(await screen.findByTestId("wiki-move-button"));
    const dialog = await screen.findByTestId("wiki-move-document-dialog");
    await waitFor(() => {
      expect(within(dialog).getByTestId("wiki-move-target-key-preview")).toHaveTextContent(
        "wiki/global/superstore-analysis-playbook.md"
      );
    });

    // UX-WIKI-023: "目标目录" appears exactly once (the section title),
    // not duplicated as a separate field label.
    expect(within(dialog).getAllByText("目标目录")).toHaveLength(1);
    // UX-WIKI-024: moving a document does not need a content Diff.
    expect(within(dialog).queryByTestId("wiki-move-diff")).not.toBeInTheDocument();
    expect(dialog).not.toHaveTextContent("文档内容");

    // Pick a new target directory.
    const targetInput = within(dialog).getByTestId("wiki-move-target-directory-input");
    fireEvent.change(targetInput, { target: { value: "ops/playbooks" } });

    await waitFor(() => {
      const previewCall = fetchMock.mock.calls
        .filter(
          (call) =>
            typeof call[0] === "string" &&
            call[0].endsWith("/global%2Fsuperstore-analysis-playbook.md/move/preview")
        )
        .at(-1);
      expect(previewCall).toBeTruthy();
      const body = JSON.parse(String(previewCall?.[1]?.body));
      expect(body.targetDirectory).toBe("ops/playbooks");
    });

    await waitFor(() => {
      expect(within(dialog).getByTestId("wiki-move-target-key-preview")).toHaveTextContent(
        "wiki/ops/playbooks/superstore-analysis-playbook.md"
      );
    });

    fireEvent.click(within(dialog).getByTestId("wiki-move-confirm"));

    await waitFor(() => {
      const commitCall = fetchMock.mock.calls.find(
        (call) =>
          typeof call[0] === "string" &&
          call[0].endsWith("/global%2Fsuperstore-analysis-playbook.md/move")
      );
      expect(commitCall).toBeTruthy();
      const body = JSON.parse(String(commitCall?.[1]?.body));
      expect(body.targetDirectory).toBe("ops/playbooks");
    });
    await waitFor(() => {
      expect(screen.getByTestId("current-location")).toHaveTextContent(
        "/wiki?key=ops%2Fplaybooks%2Fsuperstore-analysis-playbook.md"
      );
    });
  });

  it("surfaces source file name, target key and titles in the upload preflight (UX-WIKI-013)", async () => {
    const fetchMock = buildFetchMock();
    vi.stubGlobal("fetch", fetchMock);
    renderWiki("/wiki");

    fireEvent.click(await screen.findByTestId("wiki-upload-button"));
    const input = screen.getByTestId("wiki-upload-input") as HTMLInputElement;
    const file = new File(["# Body\n"], "本地导入.md", { type: "text/markdown" });
    fireEvent.change(input, { target: { files: [file] } });

    const dialog = await screen.findByTestId("wiki-upload-preflight");
    await waitFor(() => {
      expect(within(dialog).getByTestId("wiki-upload-summary-source")).toHaveTextContent(
        "本地导入.md"
      );
      expect(within(dialog).getByTestId("wiki-upload-summary-target")).toHaveTextContent(
        "wiki/global/本地导入.md"
      );
      expect(within(dialog).getByTestId("wiki-upload-summary-title")).toHaveTextContent(
        "Uploaded"
      );
    });
    expect(within(dialog).queryByTestId("wiki-upload-warnings")).not.toBeInTheDocument();
  });

  it("search matches title, tag, and sl_ref", async () => {
    vi.stubGlobal("fetch", buildFetchMock());
    renderWiki("/wiki");

    const tree = await screen.findByTestId("wiki-tree");
    const search = within(tree).getByTestId("wiki-tree-search");
    // Search by tag
    fireEvent.change(search, { target: { value: "playbook" } });
    await waitFor(() => {
      expect(within(tree).queryByRole("button", { name: /Superstore guide/ })).not.toBeInTheDocument();
    });
    expect(within(tree).getByRole("button", { name: /Financial playbook/ })).toBeInTheDocument();

    // Search by linked table.
    fireEvent.change(search, { target: { value: "finance_orders" } });
    expect(within(tree).getByRole("button", { name: /Financial playbook/ })).toBeInTheDocument();
    expect(within(tree).queryByRole("button", { name: /POC active/ })).not.toBeInTheDocument();

    // Reset search: UX-WIKI-020 hides document rows again once the
    // search term is cleared and no document is active.
    fireEvent.change(search, { target: { value: "" } });
    expect(within(tree).queryByRole("button", { name: /POC active/ })).not.toBeInTheDocument();
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

  it("renders a 查看关联的 业务 Wiki action for rows with Wiki refs", async () => {
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
    expect(wikiLink).toHaveTextContent("查看关联的 业务 Wiki");
    expect(wikiLink).toHaveAttribute(
      "href",
      "/wiki?sl_ref=mysql-aliyun%2Fdataforai%2Fsuperstore_orders"
    );
  });
});

describe("Wiki home and tree visual clarity (M64)", () => {
  it("collapses the /wiki home hero to the statistics summary and renders a Markdown document list (M64)", async () => {
    vi.stubGlobal("fetch", buildFetchMock());
    renderWiki("/wiki");

    const home = await screen.findByTestId("wiki-library-home");
    // spec §7.1：去掉 hero 大标题文案，但保留"Markdown 文档库"作为 aria-label
    expect(home).not.toHaveTextContent("按目录管理业务口径文档");
    // 统计摘要文案仍然存在。React Query 在第一次 render 时仍是 loading 状态，
    // summary 此时显示「0 篇 Markdown 文档，全部位于根目录」；我们要等到列表
    // 拉回来之后再断言「个目录中」。`waitFor` 会反复重试直到数据落到 DOM。
    await waitFor(() => {
      expect(home).toHaveTextContent("3 篇 Markdown 文档");
    });
    expect(home).toHaveTextContent("个目录中");

    // spec §7.2 + plan §Phase 5：右侧改为 Markdown 文档列表
    const documents = await screen.findByTestId("wiki-library-documents");
    expect(documents).toBeInTheDocument();
    // 旧 testid 不再渲染
    expect(screen.queryByTestId("wiki-library-groups")).not.toBeInTheDocument();

    // 每一篇 Markdown 文档应有可见标题 + 完整 Wiki 路径 metadata
    const items = within(documents).getAllByTestId("wiki-library-document");
    expect(items.length).toBeGreaterThan(0);
    const firstItem = items[0];
    expect(within(firstItem).getByTestId("wiki-library-document-title").textContent).toMatch(
      /\S+/
    );
    const path = within(firstItem).getByTestId("wiki-library-document-path");
    expect(path.textContent).toMatch(/^wiki\/.+/);
    // 翻译防御
    expect(path).toHaveAttribute("translate", "no");
    expect(path.className).toContain("notranslate");
  });

  it("does not render triangle or chevron glyphs anywhere in the /wiki home or sidebar (M64)", async () => {
    vi.stubGlobal("fetch", buildFetchMock(NESTED_WIKI_PAGES));
    renderWiki("/wiki");

    const tree = await screen.findByTestId("wiki-tree");
    // 等 fetch mock 完成的实际目录组渲染
    await waitFor(() => {
      expect(within(tree).getAllByTestId("wiki-tree-group").length).toBeGreaterThan(0);
    });

    const body = document.body;
    const text = body.textContent ?? "";
    for (const glyph of ["▼", "▶", "▾", "▸"]) {
      expect(text).not.toContain(glyph);
    }

    // 目录 row 仍然有可访问展开状态
    const group = within(tree).getAllByTestId("wiki-tree-group")[0];
    expect(group).toHaveAttribute("aria-expanded");
    // toggle 行仍然可点击，且可聚焦按钮本身也暴露展开状态与可读名称
    const toggle = within(group).getByTestId("wiki-tree-group-toggle");
    expect(toggle.tagName).toBe("BUTTON");
    expect(toggle).toHaveAttribute("aria-expanded", group.getAttribute("aria-expanded"));
    expect(toggle).toHaveAccessibleName(/.+\s+\d+\s+篇，(收起目录|展开目录)/);
  });

  it("separates 目标目录 / 目标 Wiki 路径 / status badge in the upload preflight (M64)", async () => {
    vi.stubGlobal("fetch", buildFetchMock());
    renderWiki("/wiki");

    fireEvent.click(await screen.findByTestId("wiki-upload-button"));
    const input = screen.getByTestId("wiki-upload-input") as HTMLInputElement;
    const file = new File(
      ["# Body\n"],
      "smoke.md",
      { type: "text/markdown" }
    );
    fireEvent.change(input, { target: { files: [file] } });

    const dialog = await screen.findByTestId("wiki-upload-preflight");
    const target = within(dialog).getByTestId("wiki-upload-target");

    // 1) 目标 section 仍能区分 目标目录 input + 目标 Wiki 路径 preview
    expect(within(target).getByTestId("wiki-upload-directory-input")).toBeInTheDocument();
    expect(within(target).getByTestId("wiki-upload-target-path")).toBeInTheDocument();
    expect(within(target).getByTestId("wiki-upload-target-path").textContent).toContain("wiki/");

    // 2) 新建 / 覆盖状态使用稳定 badge testid
    expect(within(target).getByTestId("wiki-upload-target-status")).toBeInTheDocument();

    // 3) 解析摘要里 label / value class contract
    const summary = within(dialog).getByTestId("wiki-upload-summary");
    const summaryRows = ["source", "target", "existing", "title", "refs"] as const;
    for (const key of summaryRows) {
      const row = within(summary).getByTestId(`wiki-upload-summary-${key}`);
      const dt = row.querySelector("dt");
      const dd = row.querySelector("dd");
      expect(dt).not.toBeNull();
      expect(dd).not.toBeNull();
      expect(dt!.className).toContain("pl-wiki-preflight-summary-label");
      expect(dd!.className).toContain("pl-wiki-preflight-summary-value");
    }

    // 4) 关联表纳入 summary row，旧的游离 <p> 已移除
    const refsRow = within(summary).getByTestId("wiki-upload-summary-refs");
    expect(refsRow).toHaveTextContent("关联表");
  });
});

describe("Wiki home directory count (M65)", () => {
  // M65：summary 只统计顶层目录 + 含 md 的目录。
  // 旧实现递归统计所有节点，ops/playbooks 等嵌套目录会被错误计入；
  // 没有任何 md 的目录（含空目录）也不应再被计入。

  it("counts only top-level directories that contain Markdown documents", async () => {
    vi.stubGlobal("fetch", buildFetchMock(NESTED_WIKI_PAGES));
    renderWiki("/wiki");

    const summary = await screen.findByTestId("wiki-library-summary");
    await waitFor(() => {
      expect(summary).toHaveTextContent("5 篇 Markdown 文档");
    });
    // NESTED_WIKI_PAGES = global/, poc/, kx/, ops/playbooks/, ops/runbooks/
    // 顶层目录 4 个：global / poc / kx / ops。ops/playbooks 与 ops/runbooks
    // 是嵌套目录，不再独立计入。
    expect(summary).toHaveTextContent("4 个目录中");
    expect(summary).not.toHaveTextContent("全部位于根目录");
  });

  it("collapses the summary copy to `全部位于根目录` when no directories have content", async () => {
    // 一篇根目录 md（key 不含 `/`），没有其它目录 → directoryCount = 0
    const rootOnly = [
      {
        key: "welcome.md",
        summary: "Welcome",
        tags: [],
        slRefs: []
      }
    ];
    vi.stubGlobal("fetch", buildFetchMock(rootOnly, SOURCES, []));
    renderWiki("/wiki");

    const summary = await screen.findByTestId("wiki-library-summary");
    await waitFor(() => {
      expect(summary).toHaveTextContent("1 篇 Markdown 文档");
    });
    expect(summary).toHaveTextContent("全部位于根目录");
    expect(summary).not.toHaveTextContent("个目录中");
  });

  it("skips explicit empty directories so they don't inflate the count", async () => {
    // 一篇真实 md 在 `global/`，另声明一个空目录 `archive`。
    // 旧实现会把 archive 也算 1，新实现应忽略。
    const directories: WikiDirectorySummary[] = [
      { path: "global", name: "global", documentCount: 1, explicit: true, empty: false },
      { path: "archive", name: "archive", documentCount: 0, explicit: true, empty: true }
    ];
    vi.stubGlobal("fetch", buildFetchMock(WIKI_PAGES, SOURCES, directories));
    renderWiki("/wiki");

    const summary = await screen.findByTestId("wiki-library-summary");
    await waitFor(() => {
      expect(summary).toHaveTextContent("3 篇 Markdown 文档");
    });
    expect(summary).toHaveTextContent("3 个目录中");
  });
});
