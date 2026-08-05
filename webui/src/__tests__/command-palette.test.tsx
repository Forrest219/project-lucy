// @vitest-environment jsdom
// M60 Sidebar Brand Navigation Polish — Command Palette MVP coverage.
// M61 Sidebar Brand Navigation Follow-up — refine the initial state to a
// search-style prompt (no full list dump), cap results at 7, and surface
// the ESC keycap so the palette mirrors a system search dialog.

import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppFrame } from "../app/App";

function StubPage({ name }: { name: string }) {
  return <div data-testid="route-page">{name}</div>;
}

vi.mock("../pages/Catalog", () => ({ Catalog: () => <StubPage name="Catalog" /> }));
vi.mock("../pages/JoinEditor", () => ({ JoinEditor: () => <StubPage name="JoinEditor" /> }));
vi.mock("../pages/Onboarding", () => ({ Onboarding: () => <StubPage name="Onboarding" /> }));
vi.mock("../pages/publish/PublishWorkbench", () => ({ PublishWorkbench: () => <StubPage name="PublishWorkbench" /> }));
vi.mock("../pages/publish/PublishHistory", () => ({ PublishHistory: () => <StubPage name="PublishHistory" /> }));
vi.mock("../pages/TableEditor", () => ({ TableEditor: () => <StubPage name="TableEditor" /> }));
vi.mock("../pages/WikiEditor", () => ({ WikiEditor: () => <StubPage name="WikiEditor" /> }));
vi.mock("../pages/admin/AgentList", () => ({ AgentList: () => <StubPage name="AgentList" /> }));
vi.mock("../pages/admin/AgentDetail", () => ({ AgentDetail: () => <StubPage name="AgentDetail" /> }));
vi.mock("../pages/admin/NewToken", () => ({ NewToken: () => <StubPage name="NewToken" /> }));
vi.mock("../pages/admin/Audit", () => ({ Audit: () => <StubPage name="Audit" /> }));
vi.mock("../pages/admin/AuditSources", () => ({ AuditSources: () => <StubPage name="AuditSources" /> }));
vi.mock("../pages/admin/McpPlayground", () => ({ McpPlayground: () => <StubPage name="McpPlayground" /> }));
vi.mock("../pages/admin/ConfigAudit", () => ({ ConfigAudit: () => <StubPage name="ConfigAudit" /> }));
vi.mock("../pages/admin/RoleList", () => ({ RoleList: () => <StubPage name="RoleList" /> }));
vi.mock("../pages/admin/RoleDetail", () => ({ RoleDetail: () => <StubPage name="RoleDetail" /> }));
vi.mock("../pages/eval/CaseList", () => ({ CaseList: () => <StubPage name="CaseList" /> }));
vi.mock("../pages/eval/CaseEditor", () => ({ CaseEditor: () => <StubPage name="CaseEditor" /> }));
vi.mock("../pages/eval/RunList", () => ({ RunList: () => <StubPage name="RunList" /> }));
vi.mock("../pages/eval/RunDetail", () => ({ RunDetail: () => <StubPage name="RunDetail" /> }));
vi.mock("../pages/eval/Monitor", () => ({ Monitor: () => <StubPage name="Monitor" /> }));
vi.mock("../pages/connections/ConnectionOverview", () => ({ ConnectionOverview: () => <StubPage name="ConnectionOverview" /> }));
vi.mock("../pages/connections/TableWhitelist", () => ({ TableWhitelist: () => <StubPage name="TableWhitelist" /> }));
vi.mock("../pages/connections/ConnectionTest", () => ({ ConnectionTest: () => <StubPage name="ConnectionTest" /> }));
vi.mock("../pages/HelpCenter", () => ({ HelpCenter: () => <StubPage name="HelpCenter" /> }));

function renderAt(path: string) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } }
  });
  const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true, data: {} })));
  vi.stubGlobal("fetch", fetchMock);
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <AppFrame />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

beforeEach(() => {
  window.localStorage.clear();
});

describe("CommandPalette", () => {
  it("does not render the palette by default", () => {
    renderAt("/overview");
    expect(screen.queryByTestId("command-palette")).not.toBeInTheDocument();
  });

  it("opens when the sidebar search entry is clicked and autofocuses the input", () => {
    renderAt("/overview");
    fireEvent.click(screen.getByTestId("sidebar-search-trigger"));
    expect(screen.getByTestId("command-palette")).toBeInTheDocument();
    expect(screen.getByTestId("command-palette-input")).toHaveFocus();
  });

  it("opens when ⌘ K (Meta+K) is pressed and toggles closed on a second press", () => {
    renderAt("/overview");
    fireEvent.keyDown(window, { key: "k", metaKey: true });
    expect(screen.getByTestId("command-palette")).toBeInTheDocument();

    fireEvent.keyDown(window, { key: "k", metaKey: true });
    expect(screen.queryByTestId("command-palette")).not.toBeInTheDocument();
  });

  it("also opens on Ctrl+K for non-Mac platforms", () => {
    renderAt("/overview");
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    expect(screen.getByTestId("command-palette")).toBeInTheDocument();
  });

  it("does not list any options before the user types", () => {
    // M61: default state is a search-style prompt — no full sidebar dump.
    // M70: hint copy was promoted from "输入页面或导航名称" to the page-search
    // framing "搜索页面、流程或配置对象" (spec §7).
    renderAt("/overview");
    fireEvent.click(screen.getByTestId("sidebar-search-trigger"));
    expect(within(screen.getByTestId("command-palette-list")).queryAllByRole("option"))
      .toHaveLength(0);
    expect(screen.getByTestId("command-palette-hint")).toHaveTextContent("搜索页面、流程或配置对象");
  });

  it("does not navigate when Enter is pressed before the user types", () => {
    renderAt("/connections");
    fireEvent.click(screen.getByTestId("sidebar-search-trigger"));
    fireEvent.keyDown(screen.getByTestId("command-palette-input"), { key: "Enter" });
    expect(screen.getByTestId("command-palette")).toBeInTheDocument();
    expect(screen.getByTestId("route-page")).toHaveTextContent("ConnectionOverview");
  });

  it("surfaces an ESC keycap in the palette header", () => {
    renderAt("/overview");
    fireEvent.click(screen.getByTestId("sidebar-search-trigger"));
    expect(screen.getByTestId("command-palette-esc-keycap")).toHaveTextContent("ESC");
  });

  it("filters results by label and group title", () => {
    renderAt("/overview");
    fireEvent.click(screen.getByTestId("sidebar-search-trigger"));
    const input = screen.getByTestId("command-palette-input");
    fireEvent.change(input, { target: { value: "wiki" } });
    const list = screen.getByTestId("command-palette-list");
    const options = within(list).getAllByRole("option");
    expect(options.length).toBe(1);
    expect(options[0]).toHaveTextContent("业务 Wiki");
  });

  it("supports Chinese substring filtering against the label or group title", () => {
    renderAt("/overview");
    fireEvent.click(screen.getByTestId("sidebar-search-trigger"));
    fireEvent.change(screen.getByTestId("command-palette-input"), {
      target: { value: "评测" }
    });
    const list = screen.getByTestId("command-palette-list");
    const options = within(list).getAllByRole("option");
    // The 评测 group has 4 entries after the 202608 security candidate
    // workflow joined the quality surface, and the
    // search term "评测" matches the group title "质量评测" rather than any
    // individual label.
    expect(options.length).toBe(4);
    const labels = options.map((option) => option.querySelector(".pl-command-palette-item-label")?.textContent);
    expect(labels).toEqual(["评测用例", "运行历史", "趋势监控", "安全候选"]);
    // M70: the matching group title now lives inside the breadcrumb line.
    // Use a regex match because the highlight helper may split the matched
    // substring ("评测") into its own <mark> node while leaving the rest
    // ("质量") as plain text — getAllByText still walks the full subtree.
    const breadcrumbTexts = options
      .map((option) => option.querySelector(".pl-command-palette-breadcrumb")?.textContent ?? "");
    for (const text of breadcrumbTexts) {
      expect(text).toMatch(/质量评测/);
    }
  });

  it("caps the visible result count at 7 even when more entries match", () => {
    // M61: the system search dialog stays compact; the empty-prompt and
    // the 7-cap both matter because dumping 14+ rows makes the dialog feel
    // like a settings panel.
    renderAt("/overview");
    fireEvent.click(screen.getByTestId("sidebar-search-trigger"));
    // 'e' matches most of the 14 sidebar labels (`connections`, `overview`,
    // `webhook`, etc.) so the cap has to bite.
    fireEvent.change(screen.getByTestId("command-palette-input"), {
      target: { value: "e" }
    });
    const options = within(screen.getByTestId("command-palette-list")).getAllByRole("option");
    expect(options.length).toBeLessThanOrEqual(7);
    expect(options.length).toBeGreaterThan(0);
  });

  it("shows an empty-state message when nothing matches", () => {
    renderAt("/overview");
    fireEvent.click(screen.getByTestId("sidebar-search-trigger"));
    fireEvent.change(screen.getByTestId("command-palette-input"), {
      target: { value: "no-such-entry-please" }
    });
    expect(screen.getByTestId("command-palette-empty")).toBeInTheDocument();
    expect(
      within(screen.getByTestId("command-palette-list")).queryAllByRole("option")
    ).toHaveLength(0);
  });

  it("renders results with the label as the primary text and the group title as the secondary text", () => {
    // M61 baseline (label as primary, URL never as primary): the path must
    // not be promoted into the option's accessible name. M70 (spec §6.2 +
    // phase 5 §4) extends the accessible name to label + breadcrumb + description
    // — we still assert the path does not lead the name and is hidden via
    // aria-hidden on the route hint span.
    renderAt("/overview");
    fireEvent.click(screen.getByTestId("sidebar-search-trigger"));
    fireEvent.change(screen.getByTestId("command-palette-input"), {
      target: { value: "wiki" }
    });
    const option = screen.getByTestId("command-palette-option-semantic-wiki");
    const accessibleName = option.getAttribute("aria-label") ?? "";
    // The label leads the accessible name.
    expect(accessibleName.startsWith("业务 Wiki")).toBe(true);
    // The route path must NOT be promoted into the accessible name.
    expect(accessibleName).not.toMatch(/\/wiki/);
    // The visible route hint span must be aria-hidden so screen readers don't
    // repeat it after the description.
    const routeHint = option.querySelector(".pl-command-palette-route-hint");
    expect(routeHint?.getAttribute("aria-hidden")).toBe("true");
  });

  it("navigates to the selected route and closes the palette on click", () => {
    renderAt("/overview");
    fireEvent.click(screen.getByTestId("sidebar-search-trigger"));
    fireEvent.change(screen.getByTestId("command-palette-input"), {
      target: { value: "发布" }
    });
    fireEvent.click(screen.getByTestId("command-palette-option-publish-history"));
    expect(screen.queryByTestId("command-palette")).not.toBeInTheDocument();
    expect(screen.getByTestId("route-page")).toHaveTextContent("PublishHistory");
  });

  it("supports ArrowDown / ArrowUp navigation and Enter to commit", () => {
    renderAt("/overview");
    fireEvent.click(screen.getByTestId("sidebar-search-trigger"));
    fireEvent.change(screen.getByTestId("command-palette-input"), {
      target: { value: "wiki" }
    });
    const input = screen.getByTestId("command-palette-input");

    // With the test query `wiki` only one entry matches, so Enter can commit
    // without an explicit arrow confirmation. ArrowDown still wraps on the
    // single row after the first keypress locks the preview.
    const wikiOption = screen.getByTestId("command-palette-option-semantic-wiki");
    expect(wikiOption).toHaveAttribute("data-active", "true");
    expect(screen.getByTestId("command-palette-enter-hint")).toBeInTheDocument();

    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(wikiOption).toHaveAttribute("data-active", "true");

    fireEvent.keyDown(input, { key: "Enter" });
    expect(screen.queryByTestId("command-palette")).not.toBeInTheDocument();
    expect(screen.getByTestId("route-page")).toHaveTextContent("WikiEditor");
  });

  it("moves the highlight with ArrowDown / ArrowUp across multiple results", () => {
    // "评测" matches the entries inside 质量评测. Use it to verify that
    // the active highlight tracks ArrowDown / ArrowUp across multiple rows
    // (the wiki-query case above only ever has a single match).
    // First ArrowDown/ArrowUp locks the previewed row without moving so the
    // default first match can still be opened via Enter after confirmation.
    renderAt("/overview");
    fireEvent.click(screen.getByTestId("sidebar-search-trigger"));
    fireEvent.change(screen.getByTestId("command-palette-input"), {
      target: { value: "评测" }
    });
    const input = screen.getByTestId("command-palette-input");
    const list = screen.getByTestId("command-palette-list");
    const options = within(list).getAllByRole("option");
    expect(options.length).toBe(4);
    expect(options[0]).toHaveAttribute("data-active", "true");
    expect(screen.queryByTestId("command-palette-enter-hint")).not.toBeInTheDocument();
    expect(screen.getByTestId("command-palette-footer")).toHaveTextContent(
      "用方向键选择后回车"
    );

    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(options[0]).toHaveAttribute("data-active", "true");
    expect(screen.getByTestId("command-palette-enter-hint")).toBeInTheDocument();
    expect(screen.getByTestId("command-palette-footer")).toHaveTextContent("Enter 打开");

    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(options[1]).toHaveAttribute("data-active", "true");

    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(options[2]).toHaveAttribute("data-active", "true");

    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(options[3]).toHaveAttribute("data-active", "true");

    // Wraps back to the first.
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(options[0]).toHaveAttribute("data-active", "true");

    // ArrowUp wraps to the last.
    fireEvent.keyDown(input, { key: "ArrowUp" });
    expect(options[3]).toHaveAttribute("data-active", "true");
  });

  it("does not navigate on Enter when multiple results are still only previewed", () => {
    renderAt("/overview");
    fireEvent.click(screen.getByTestId("sidebar-search-trigger"));
    fireEvent.change(screen.getByTestId("command-palette-input"), {
      target: { value: "token" }
    });
    const input = screen.getByTestId("command-palette-input");
    const options = within(screen.getByTestId("command-palette-list")).getAllByRole("option");
    expect(options.length).toBeGreaterThan(1);
    expect(options[0]).toHaveAttribute("data-active", "true");

    fireEvent.keyDown(input, { key: "Enter" });
    expect(screen.getByTestId("command-palette")).toBeInTheDocument();
    expect(screen.getByTestId("route-page")).toHaveTextContent("Onboarding");
  });

  it("navigates on Enter after Arrow confirmation when multiple results match", () => {
    renderAt("/overview");
    fireEvent.click(screen.getByTestId("sidebar-search-trigger"));
    fireEvent.change(screen.getByTestId("command-palette-input"), {
      target: { value: "token" }
    });
    const input = screen.getByTestId("command-palette-input");
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(screen.queryByTestId("command-palette")).not.toBeInTheDocument();
    expect(screen.getByTestId("route-page")).toHaveTextContent("AgentList");
  });

  it("ignores Enter while an IME composition is active", () => {
    renderAt("/overview");
    fireEvent.click(screen.getByTestId("sidebar-search-trigger"));
    fireEvent.change(screen.getByTestId("command-palette-input"), {
      target: { value: "wiki" }
    });
    // jsdom KeyboardEvent init does not reliably surface isComposing on the
    // React synthetic event; keyCode 229 is the IME composition sentinel the
    // handler also guards against.
    fireEvent.keyDown(screen.getByTestId("command-palette-input"), {
      key: "Enter",
      keyCode: 229
    });
    expect(screen.getByTestId("command-palette")).toBeInTheDocument();
    expect(screen.getByTestId("route-page")).toHaveTextContent("Onboarding");
  });

  it("wraps ArrowDown at the end of the list", () => {
    renderAt("/overview");
    fireEvent.click(screen.getByTestId("sidebar-search-trigger"));
    fireEvent.change(screen.getByTestId("command-palette-input"), {
      target: { value: "wiki" }
    });
    const input = screen.getByTestId("command-palette-input");
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(
      screen.getByTestId("command-palette-option-semantic-wiki")
    ).toHaveAttribute("data-active", "true");
  });

  it("closes on Escape", () => {
    renderAt("/overview");
    fireEvent.click(screen.getByTestId("sidebar-search-trigger"));
    expect(screen.getByTestId("command-palette")).toBeInTheDocument();
    fireEvent.keyDown(screen.getByTestId("command-palette"), { key: "Escape" });
    expect(screen.queryByTestId("command-palette")).not.toBeInTheDocument();
  });

  // M70 command palette result context: each result is a page-search-result
  // row with breadcrumb + title + description, not a navigation menu row.
  it("renders search-result context (breadcrumb / title / description) for the 语义 query", () => {
    renderAt("/overview");
    fireEvent.click(screen.getByTestId("sidebar-search-trigger"));
    fireEvent.change(screen.getByTestId("command-palette-input"), {
      target: { value: "语义" }
    });
    const list = screen.getByTestId("command-palette-list");
    // 语义资产 and 业务 Wiki both live under 语义建模; both must surface
    // the page-search-result layout, not just the label + group title.
    const semanticCatalog = screen.getByTestId("command-palette-option-semantic-catalog");
    expect(semanticCatalog.querySelector(".pl-command-palette-breadcrumb")).not.toBeNull();
    expect(semanticCatalog.querySelector(".pl-command-palette-title-row")).not.toBeNull();
    expect(semanticCatalog.querySelector(".pl-command-palette-item-description")).not.toBeNull();
    // 语义资产's breadcrumb must reference its owning group so users see
    // why a 语义 modeling entry shows up.
    expect(semanticCatalog.textContent).toContain("语义建模");
    expect(semanticCatalog.textContent).toContain("维护表级语义资产");
    // 业务 Wiki lives in the same group, so its breadcrumb must also surface.
    const wikiOption = screen.getByTestId("command-palette-option-semantic-wiki");
    expect(wikiOption.querySelector(".pl-command-palette-breadcrumb")).not.toBeNull();
    expect(wikiOption.textContent).toContain("管理业务 Markdown 文档");
    // No result row may render the legacy right-side group label as the
    // primary visual (M61's `.pl-command-palette-item-meta` was promoted to
    // the secondary breadcrumb line in M70).
    for (const option of within(list).getAllByRole("option")) {
      expect(option.querySelector(".pl-command-palette-item-meta")).toBeNull();
    }
  });

  // M70: direct label hits must rank above same-group hits that only match
  // through the group title. 语义资产 starts with 语义 (score 100) while
  // 业务 Wiki only matches through its parent group 语义建模 (score 40),
  // so 语义资产 must come first.
  it("ranks direct label hits above same-group title-only hits", () => {
    renderAt("/overview");
    fireEvent.click(screen.getByTestId("sidebar-search-trigger"));
    fireEvent.change(screen.getByTestId("command-palette-input"), {
      target: { value: "语义" }
    });
    const list = screen.getByTestId("command-palette-list");
    const options = within(list).getAllByRole("option");
    expect(options.length).toBeGreaterThanOrEqual(2);
    const ids = options.map((option) => option.getAttribute("data-testid"));
    const semanticCatalogIndex = ids.indexOf("command-palette-option-semantic-catalog");
    const semanticWikiIndex = ids.indexOf("command-palette-option-semantic-wiki");
    expect(semanticCatalogIndex).toBeGreaterThanOrEqual(0);
    expect(semanticWikiIndex).toBeGreaterThanOrEqual(0);
    expect(semanticCatalogIndex).toBeLessThan(semanticWikiIndex);
  });

  // M70: matched query text must be wrapped in a highlight node so the user
  // can see "why" this row matched. Highlight must NOT replace the visible
  // layout (no dangerouslySetInnerHTML, no full-row color block).
  it("wraps matched query substrings in a highlight node", () => {
    renderAt("/overview");
    fireEvent.click(screen.getByTestId("sidebar-search-trigger"));
    fireEvent.change(screen.getByTestId("command-palette-input"), {
      target: { value: "wiki" }
    });
    const wikiOption = screen.getByTestId("command-palette-option-semantic-wiki");
    const highlights = wikiOption.querySelectorAll(".pl-command-palette-highlight");
    expect(highlights.length).toBeGreaterThan(0);
    // The highlight must contain the original substring (case-insensitive
    // normalization is the only transformation allowed).
    const highlightedText = Array.from(highlights)
      .map((node) => node.textContent ?? "")
      .join("");
    expect(highlightedText.toLowerCase()).toContain("wiki");
  });

  it("protects professional English terms inside result text from browser translation", () => {
    renderAt("/overview");
    fireEvent.click(screen.getByTestId("sidebar-search-trigger"));
    fireEvent.change(screen.getByTestId("command-palette-input"), {
      target: { value: "connection" }
    });
    const connectionOption = screen.getByTestId("command-palette-option-connections-overview");
    const description = connectionOption.querySelector(".pl-command-palette-item-description");
    expect(description).not.toBeNull();
    const protectedTerms = Array.from(description!.querySelectorAll(".notranslate"))
      .map((node) => ({
        text: node.textContent,
        translate: node.getAttribute("translate")
      }));
    expect(protectedTerms).toEqual(
      expect.arrayContaining([
        { text: "Connection", translate: "no" },
        { text: "Schema", translate: "no" },
        { text: "Manifest", translate: "no" }
      ])
    );
  });

  it("keeps translation defense on protected terms even when the term is highlighted", () => {
    renderAt("/overview");
    fireEvent.click(screen.getByTestId("sidebar-search-trigger"));
    fireEvent.change(screen.getByTestId("command-palette-input"), {
      target: { value: "mcp" }
    });
    const overviewOption = screen.getByTestId("command-palette-option-overview");
    const highlightedProtectedTerm = Array.from(
      overviewOption.querySelectorAll(".pl-command-palette-highlight.notranslate")
    ).find((node) => node.textContent === "MCP");
    expect(highlightedProtectedTerm).toBeTruthy();
    expect(highlightedProtectedTerm?.getAttribute("translate")).toBe("no");
  });

  it("protects professional English terms in labels and breadcrumbs", () => {
    renderAt("/overview");
    fireEvent.click(screen.getByTestId("sidebar-search-trigger"));
    fireEvent.change(screen.getByTestId("command-palette-input"), {
      target: { value: "wiki" }
    });
    const wikiOption = screen.getByTestId("command-palette-option-semantic-wiki");
    const labelTerm = Array.from(
      wikiOption.querySelectorAll(".pl-command-palette-item-label .notranslate")
    ).find((node) => node.textContent === "Wiki");
    const brandTerm = Array.from(
      wikiOption.querySelectorAll(".pl-command-palette-breadcrumb .notranslate")
    ).find((node) => node.textContent === "Lucy WebUI");
    expect(labelTerm?.getAttribute("translate")).toBe("no");
    expect(brandTerm?.getAttribute("translate")).toBe("no");
  });

  // M70: optional route hint must be visually muted, use monospace, and carry
  // translation defense so Chrome/Edge don't translate the path on users.
  it("renders the optional route hint as muted monospace with translation defense", () => {
    renderAt("/overview");
    fireEvent.click(screen.getByTestId("sidebar-search-trigger"));
    fireEvent.change(screen.getByTestId("command-palette-input"), {
      target: { value: "wiki" }
    });
    const wikiOption = screen.getByTestId("command-palette-option-semantic-wiki");
    const routeHint = wikiOption.querySelector(".pl-command-palette-route-hint");
    expect(routeHint).not.toBeNull();
    expect(routeHint?.getAttribute("translate")).toBe("no");
    expect(routeHint?.className).toContain("notranslate");
    // route hint must NOT be the primary visual: it lives in the title row,
    // not before the title.
    const titleRow = wikiOption.querySelector(".pl-command-palette-title-row");
    expect(titleRow?.contains(routeHint)).toBe(true);
    // The title still leads the row visually.
    expect(titleRow?.firstElementChild?.classList.contains("pl-command-palette-item-label")).toBe(true);
  });

  // M70: empty initial state (no query) must still show only the search-style
  // hint and zero options — the redesign must not regress the M61 baseline.
  it("keeps the M61 search-style empty state after the result context redesign", () => {
    renderAt("/overview");
    fireEvent.click(screen.getByTestId("sidebar-search-trigger"));
    expect(within(screen.getByTestId("command-palette-list")).queryAllByRole("option"))
      .toHaveLength(0);
    expect(screen.getByTestId("command-palette-hint")).toBeInTheDocument();
  });

  // M70: clicking a result must still navigate and close the palette. This
  // is the same M61 contract verified with the new layout.
  it("navigates on click after the result context redesign", () => {
    renderAt("/overview");
    fireEvent.click(screen.getByTestId("sidebar-search-trigger"));
    fireEvent.change(screen.getByTestId("command-palette-input"), {
      target: { value: "wiki" }
    });
    fireEvent.click(screen.getByTestId("command-palette-option-semantic-wiki"));
    expect(screen.queryByTestId("command-palette")).not.toBeInTheDocument();
    expect(screen.getByTestId("route-page")).toHaveTextContent("WikiEditor");
  });
});
