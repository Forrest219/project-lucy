// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WikiEditor } from "../pages/WikiEditor";

const WIKI_PAGES = [
  {
    key: "global/superstore-analysis-playbook.md",
    summary: "Superstore guide",
    tags: ["analysis"],
    slRefs: ["mysql-aliyun/dataforai/superstore_orders"]
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
              ? `@@\n+summary: draft\n+sl_refs:\n+  - ${(body.frontmatter?.sl_refs ?? []).join("\n  - ")}\n`
              : "",
            proposedMarkdown: body.dryRun
              ? `---\nsummary: draft\nsl_refs:\n  - ${(body.frontmatter?.sl_refs ?? []).join("\n  - ")}\n---\n# Draft\n`
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

describe("WikiEditor M10 object handoff", () => {
  it("auto-selects a matching Wiki page when sl_ref resolves to an existing slRefs entry", async () => {
    vi.stubGlobal("fetch", buildFetchMock());
    renderWiki("/wiki?sl_ref=mysql-aliyun/dataforai/superstore_orders");

    // The matched page button should be marked active
    const matchedButton = await screen.findByRole("button", { name: /superstore-analysis-playbook\.md/ });
    expect(matchedButton).toHaveClass("pl-file-button--active");

    // Page detail should be loaded; the markdown textarea should be filled
    const markdownTextarea = await screen.findByDisplayValue(/# Superstore guide/);
    expect(markdownTextarea).toBeInTheDocument();
    // The summary textarea (frontmatter) should be filled too
    const summaryTextarea = screen.getByDisplayValue("Superstore guide");
    expect(summaryTextarea).toBeInTheDocument();
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

    // The draft key should be derived from the table segment
    const keyInput = await screen.findByDisplayValue("global/unknown_table.md");
    expect(keyInput).toBeInTheDocument();

    // The sl_refs chip should be visible for the unmatched but still saveable ref
    const chip = await screen.findByLabelText(/移除关联语义对象/);
    expect(chip).toBeInTheDocument();

    // No PUT save should have been issued yet (only PUT dry-runs for the preview are allowed)
    const putCalls = fetchMock.mock.calls.filter(
      (call) => call[1]?.method === "PUT"
    );
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

    expect(await screen.findByDisplayValue("global/foo-wiki-2.md")).toBeInTheDocument();
  });

  it("keeps unsaved content when the page path field is committed to a new draft key", async () => {
    vi.stubGlobal("fetch", buildFetchMock());
    renderWiki("/wiki?key=global%2Fsuperstore-analysis-playbook.md");

    const markdownTextarea = await screen.findByDisplayValue(/# Superstore guide/);
    fireEvent.change(markdownTextarea, { target: { value: "# Edited\n\nStill here." } });

    const keyInput = screen.getByDisplayValue("global/superstore-analysis-playbook.md");
    fireEvent.change(keyInput, { target: { value: "global/superstore-copy.md" } });
    fireEvent.blur(keyInput);

    await waitFor(() => {
      expect(screen.getByDisplayValue("global/superstore-copy.md")).toBeInTheDocument();
      expect(markdownTextarea).toHaveValue("# Edited\n\nStill here.");
    });
  });

  it("renders the page list, the new-document button and a draft when a key is empty", async () => {
    vi.stubGlobal("fetch", buildFetchMock());
    renderWiki("/wiki");

    // The new-document button is present in the sidebar
    expect(screen.getByRole("button", { name: /新建 Wiki/ })).toBeInTheDocument();
    // The matched list still works
    expect(
      await screen.findByRole("button", { name: /superstore-analysis-playbook\.md/ })
    ).toBeInTheDocument();
  });

  it("removes an sl_ref chip and updates the dry-run payload", async () => {
    const fetchMock = buildFetchMock();
    vi.stubGlobal("fetch", fetchMock);
    renderWiki("/wiki?key=global%2Fsuperstore-analysis-playbook.md");

    // Wait for page load so the sl_refs chip from the existing page is rendered
    const removeButton = await screen.findByLabelText(
      /移除关联语义对象 mysql-aliyun\/dataforai\/superstore_orders/
    );
    fireEvent.click(removeButton);

    // After removal the chip should no longer be in the document
    await waitFor(() => {
      expect(
        screen.queryByLabelText(/移除关联语义对象 mysql-aliyun\/dataforai\/superstore_orders/)
      ).not.toBeInTheDocument();
    });

    // The next dry-run PUT should no longer contain the removed ref
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

  it("links a known sl_ref chip to the table editor", async () => {
    vi.stubGlobal("fetch", buildFetchMock());
    renderWiki("/wiki?key=global%2Fsuperstore-analysis-playbook.md");

    const link = await screen.findByLabelText(/打开 superstore_orders 表语义编辑器/);
    expect(link).toHaveAttribute(
      "href",
      "/sources/mysql-aliyun/dataforai/superstore_orders"
    );
  });

  it("marks an unknown sl_ref as warning chip but still keeps it saveable", async () => {
    vi.stubGlobal("fetch", buildFetchMock());
    renderWiki("/wiki?sl_ref=mysql-aliyun/dataforai/ghost_table");

    // The chip container carries the unknown state attribute
    const container = await screen.findByLabelText(/移除关联语义对象 mysql-aliyun\/dataforai\/ghost_table/);
    expect(container).toHaveAttribute("data-sl-ref-state", "unknown");
    // The label inside shows schema.table
    expect(screen.getByText("dataforai.ghost_table")).toBeInTheDocument();
  });

  it("normalizes manually entered sl_refs before adding them to frontmatter", async () => {
    vi.stubGlobal("fetch", buildFetchMock());
    renderWiki("/wiki?sl_ref=mysql-aliyun/dataforai/ghost_table");

    const input = await screen.findByLabelText("添加关联语义对象");
    fireEvent.change(input, { target: { value: " mysql-aliyun//dataforai / second_ghost " } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(
      await screen.findByLabelText(/移除关联语义对象 mysql-aliyun\/dataforai\/second_ghost/)
    ).toBeInTheDocument();
  });

  it("collapses 'refs' and 'usage_mode' under 更多元信息 but preserves their values", async () => {
    vi.stubGlobal("fetch", buildFetchMock());
    renderWiki("/wiki?key=global%2Fsuperstore-analysis-playbook.md");

    // The collapsed disclosure toggle is present
    const toggle = screen.getByRole("button", { name: /更多元信息/ });
    expect(toggle).toBeInTheDocument();

    // The preserved fields are accessible via the disclosure
    fireEvent.click(toggle);
    expect(screen.getByLabelText(/外部引用/)).toBeInTheDocument();
    expect(screen.getByLabelText(/使用方式/)).toBeInTheDocument();
  });

  it("switches the right inspector between rendered preview and diff tabs", async () => {
    vi.stubGlobal("fetch", buildFetchMock());
    renderWiki("/wiki?key=global%2Fsuperstore-analysis-playbook.md");

    // Default tab is the rendered preview
    const previewTab = await screen.findByRole("tab", { name: "渲染预览" });
    const diffTab = screen.getByRole("tab", { name: "Diff" });
    expect(previewTab).toHaveAttribute("aria-selected", "true");

    // Switch to diff
    fireEvent.click(diffTab);
    expect(diffTab).toHaveAttribute("aria-selected", "true");
    expect(previewTab).toHaveAttribute("aria-selected", "false");

    // Switch back to preview
    fireEvent.click(previewTab);
    expect(previewTab).toHaveAttribute("aria-selected", "true");
  });

  it("renders headings, lists, inline code and code blocks in the markdown preview", async () => {
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
      return new Response(
        JSON.stringify({ ok: false, error: { code: "NOT_FOUND", message: url } }),
        { status: 404 }
      );
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

  it("does not write to the server on Cmd/Ctrl+S; only triggers a dry-run and switches to the diff tab", async () => {
    const fetchMock = buildFetchMock();
    vi.stubGlobal("fetch", fetchMock);
    renderWiki("/wiki?key=global%2Fsuperstore-analysis-playbook.md");

    // The preview tab should be default-selected
    const previewTab = await screen.findByRole("tab", { name: "渲染预览" });
    expect(previewTab).toHaveAttribute("aria-selected", "true");

    // Simulate Cmd+S
    const event = new KeyboardEvent("keydown", { key: "s", metaKey: true, bubbles: true });
    document.body.dispatchEvent(event);

    // Switch to the diff tab
    await waitFor(() => {
      const diffTab = screen.getByRole("tab", { name: "Diff" });
      expect(diffTab).toHaveAttribute("aria-selected", "true");
    });

    // Save mutation (dryRun:false) must not have been called
    const saveCall = fetchMock.mock.calls.find((call) => {
      if (call[1]?.method !== "PUT") return false;
      const body = JSON.parse(String(call[1]?.body));
      return body.dryRun === false;
    });
    expect(saveCall).toBeUndefined();
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

    const wikiLink = await screen.findByRole("link", { name: /打开 dataforai\.superstore_orders 的业务 Wiki/ });
    expect(wikiLink).toHaveAttribute(
      "href",
      "/wiki?sl_ref=mysql-aliyun%2Fdataforai%2Fsuperstore_orders"
    );
  });
});
