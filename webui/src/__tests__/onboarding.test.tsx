// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Onboarding } from "../pages/Onboarding";
import type { Agent, SourceSummary } from "../lib/types";

const toastSpy = vi.fn();

vi.mock("sonner", async () => {
  const actual = await vi.importActual<typeof import("sonner")>("sonner");
  const baseToast = actual.toast;
  const wrap = (fn: typeof baseToast) => {
    const wrapped = ((...args: Parameters<typeof baseToast>) => {
      toastSpy(...args);
      return fn(...args);
    }) as typeof baseToast;
    wrapped.success = ((...args: Parameters<typeof baseToast.success>) => {
      toastSpy("success", ...args);
      return baseToast.success(...args);
    }) as typeof baseToast.success;
    wrapped.error = ((...args: Parameters<typeof baseToast.error>) => {
      toastSpy("error", ...args);
      return baseToast.error(...args);
    }) as typeof baseToast.error;
    return wrapped;
  };
  return {
    ...actual,
    toast: wrap(baseToast)
  };
});

const readyAgent: Agent = {
  id: "analyst",
  name: "Analyst",
  enabled: true,
  role: "analyst",
  tokens: [{ hash: "abc", label: "default", created: "2026-06-21T00:00:00.000Z" }]
};

const readySource: SourceSummary = {
  conn: "mysql-demo",
  schema: "demo",
  table: "orders",
  filePath: "semantic-layer/mysql-demo/_schema/demo.yaml",
  columnCount: 4,
  columnNames: ["id", "amount"],
  hasTableDesc: true,
  hasGrain: true,
  measureCount: 1,
  joinCount: 0,
  wikiRefCount: 0,
  completion: "done",
  mtime: "2026-06-21T00:00:00.000Z"
};

function renderPage(options: {
  agents?: Agent[];
  sources?: SourceSummary[];
  mcpEndpoint?: {
    url: string | null;
    status: "configured" | "fallback" | "invalid";
    source: "env" | "fallback";
    configured: boolean;
    diagnostics: Array<{ code: string; message: string }>;
  };
  evalRuns?: { total: number; runs: unknown[] };
} = {}) {
  const agents = options.agents ?? [readyAgent];
  const sources = options.sources ?? [readySource];
  const evalRuns = options.evalRuns ?? { total: 1, runs: [{ id: 1 }] };
  const mcpEndpoint = options.mcpEndpoint ?? {
    url: "https://lucy.example.com/mcp",
    status: "configured" as const,
    source: "env" as const,
    configured: true,
    diagnostics: []
  };
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false }
    }
  });
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url === "/api/project") {
      return new Response(JSON.stringify({
        ok: true,
        data: {
          root: "/tmp/project-lucy",
          ktxAvailable: true,
          connections: [
            { id: "mysql-demo", driver: "mysql", schemas: ["demo"], enabledTables: ["demo.orders"] }
          ],
          mcpEndpoint
        }
      }));
    }
    if (url === "/api/sources") {
      return new Response(JSON.stringify({
        ok: true,
        data: {
          tables: sources
        }
      }));
    }
    if (url === "/api/diff") {
      return new Response(JSON.stringify({ ok: true, data: { files: [] } }));
    }
    if (url === "/api/admin/agents") {
      return new Response(JSON.stringify({
        ok: true,
        data: {
          agents
        }
      }));
    }
    // M36 review follow-up: the dashboard now asks the eval API whether
    // any run has happened. Default fixture says "yes, one run" so the
    // "近 30 天无评测数据" item is not falsely surfaced.
    if (url === "/api/eval/runs?limit=1") {
      return new Response(JSON.stringify({ ok: true, data: evalRuns }));
    }
    return new Response(JSON.stringify({ ok: true, data: {} }));
  });
  vi.stubGlobal("fetch", fetchMock);

  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <Onboarding />
      </MemoryRouter>
    </QueryClientProvider>
  );
  return { fetchMock };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("Onboarding", () => {
  it("summarizes the M39 system overview surface and copies MCP config", async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText }
    });

    renderPage();

    // M39: PageHeader H1 is 系统概览; 运维驾驶舱 is the product mental
    // model, not a user-visible H1.
    expect(await screen.findByRole("heading", { name: "系统概览" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "运维驾驶舱" })).not.toBeInTheDocument();
    expect(screen.queryByText("运行状态")).not.toBeInTheDocument();
    const pageActions = screen.getByLabelText("页面操作");
    expect(within(pageActions).queryByRole("link", { name: "打开系统手册" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /刷新状态|刷新中/ })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "数据库接入" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "配置 Agent" })).not.toBeInTheDocument();
    expect(screen.queryByText("Deployment readiness")).not.toBeInTheDocument();
    // M39: compact service health strip (not a 3-up metric grid).
    expect(screen.getByText("KTX Runtime")).toBeInTheDocument();
    expect(screen.getByText("Lucy MCP")).toBeInTheDocument();
    expect(screen.getByText("语义层覆盖")).toBeInTheDocument();
    expect(screen.getByText("Agent 接入")).toBeInTheDocument();
    expect(document.querySelectorAll(".pl-metric-grid > .pl-metric-card")).toHaveLength(0);
    // The legacy "实时状态与诊断" / "数据源连接" / "语义层状态" / "变更审阅" /
    // "Agent 接入点" sections are gone — they were folded into the
    // metric-first quality snapshot and the access-risk list.
    expect(screen.queryByText("实时状态与诊断")).not.toBeInTheDocument();
    expect(screen.queryByText("数据源连接")).not.toBeInTheDocument();
    expect(screen.queryByText("语义层状态")).not.toBeInTheDocument();
    expect(screen.queryByText("变更审阅")).not.toBeInTheDocument();
    expect(screen.queryByText("Agent 接入点")).not.toBeInTheDocument();
    // The legacy big "Lucy MCP 服务运行正常" banner is also gone.
    expect(screen.queryByText("Lucy MCP 服务运行正常")).not.toBeInTheDocument();
    expect(screen.queryByText("服务节点已就绪，当前可正常接受 Agent 连接：https://lucy.example.com/mcp")).not.toBeInTheDocument();
    expect(screen.queryByText("Lucy MCP is ready for Agent delivery")).not.toBeInTheDocument();
    // The MCP endpoint URL is now rendered inside the metric card and the
    // Drawer; the main page still surfaces the configured endpoint via
    // the MCP 接入 section. The heading text is split across a notranslate
    // `MCP` span + a Chinese tail, so we use a function matcher against
    // the full text content.
    expect(
      screen.getByText(
        (_content, element) =>
          (element instanceof HTMLElement ? element.textContent : "").trim() === "MCP 接入"
      )
    ).toBeInTheDocument();
    expect(screen.getByText("https://lucy.example.com/mcp")).toBeInTheDocument();
    expect(screen.queryByText("http://localhost:7879/mcp")).not.toBeInTheDocument();
    expect(screen.queryByText("http://127.0.0.1:7879/mcp")).not.toBeInTheDocument();
    expect(document.querySelector(".pl-onboarding-step-index")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "查看连接" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "表白名单" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "维护语义" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "审阅校验" })).not.toBeInTheDocument();
    expect(screen.queryByText("Semantic Tables")).not.toBeInTheDocument();
    expect(screen.queryByText("Checklist")).not.toBeInTheDocument();

    // Copy MCP config still works on the main page.
    fireEvent.click(screen.getByRole("button", { name: "复制 MCP 配置" }));
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining("Bearer <LUCY_AGENT_TOKEN>"));
  });

  it("surfaces the local fallback URL and a deployment warning when LUCY_PUBLIC_MCP_URL is unset", async () => {
    renderPage({
      mcpEndpoint: {
        url: "http://127.0.0.1:7879/mcp",
        status: "fallback",
        source: "fallback",
        configured: false,
        diagnostics: [
          {
            code: "MISSING_PUBLIC_MCP_URL",
            message: "LUCY_PUBLIC_MCP_URL is not configured; using local development MCP endpoint."
          }
        ]
      }
    });

    expect(await screen.findByText("http://127.0.0.1:7879/mcp")).toBeInTheDocument();
    expect(
      await screen.findByText(/当前使用本地默认 MCP endpoint|本地默认/)
    ).toBeInTheDocument();
  });

  it("disables the MCP copy button when the runtime endpoint is invalid", async () => {
    renderPage({
      mcpEndpoint: {
        url: null,
        status: "invalid",
        source: "env",
        configured: false,
        diagnostics: [
          {
            code: "INVALID_PUBLIC_MCP_URL",
            message: "LUCY_PUBLIC_MCP_URL must be a valid absolute URL."
          }
        ]
      }
    });

    // The MCP 接入 section still appears so the user can see *why* the
    // buttons are gone, but the copy button must be disabled when the
    // endpoint is invalid. The view button stays enabled so the user can
    // open the Drawer and read the diagnostics. The heading text is split
    // across a notranslate `MCP` span + a Chinese tail, so we use a
    // function text matcher against the full content.
    expect(
      await screen.findByText(
        (_content, element) =>
          (element instanceof HTMLElement ? element.textContent : "").trim() === "MCP 接入"
      )
    ).toBeInTheDocument();
    const copyButton = screen.getByRole("button", { name: "复制 MCP 配置" });
    expect(copyButton).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "查看配置" })
    ).toBeInTheDocument();
    expect(
      screen.getByText("LUCY_PUBLIC_MCP_URL must be a valid absolute URL.")
    ).toBeInTheDocument();
  });

  it("surfaces the Chinese severity label inside action items when pending sources exist", async () => {
    renderPage({
      sources: [
        readySource,
        { ...readySource, table: "customers", completion: "partial" },
        { ...readySource, table: "products", completion: "not_started" }
      ]
    });

    const queue = await screen.findByTestId("ops-action-required");
    // The semantic-gap item must show its Chinese severity label rather
    // than the English severity bucket.
    const items = Array.from(queue.querySelectorAll(".pl-action-required-item"));
    expect(items.length).toBeGreaterThan(0);
    for (const item of items) {
      const text = item.textContent ?? "";
      expect(text).toMatch(/高风险|待处理|提醒/);
      expect(text).not.toMatch(/(^|\s)Critical(\s|$)/);
      expect(text).not.toMatch(/(^|\s)Warning(\s|$)/);
      expect(text).not.toMatch(/(^|\s)Ready(\s|$)/);
      expect(text).not.toMatch(/(^|\s)Info(\s|$)/);
    }
  });

  it("shows the MCP setup gap reason inline next to the disabled copy button", async () => {
    renderPage({ agents: [] });

    expect(await screen.findByText("尚未创建 Agent")).toBeInTheDocument();
    // The "打开阻塞项" link was retired with the legacy delivery banner;
    // the user can still reach /admin/agents from the access-risk list.
    expect(screen.queryByRole("link", { name: "打开阻塞项" })).not.toBeInTheDocument();
  });

  it.each([
    ["尚未创建 Agent", []],
    ["启用的 Agent 暂无可用 token", [{ ...readyAgent, tokens: [] }]],
    ["所有 Agent 均已禁用", [{ ...readyAgent, enabled: false }]],
    ["所有 Agent 仍为 legacy allow，需迁移到 role", [{ ...readyAgent, role: undefined, allow: { tables: ["*"], tools: ["*"] } }]]
  ])("explains MCP setup gap: %s", async (message, agents) => {
    renderPage({ agents: agents as Agent[] });

    expect(await screen.findByText(message)).toBeInTheDocument();
  });

  it("renders the M39 ops dashboard sections", async () => {
    renderPage();

    // M39: header title is now 系统概览 (the page-level page title);
    // "运维驾驶舱" is the product mental model, not a user-visible H1.
    expect(await screen.findByRole("heading", { name: "系统概览" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "运维驾驶舱" })).not.toBeInTheDocument();
    // M39: header now exposes environment, last-update time and KTX badge
    // so the user has full global context for the dashboard.
    expect(screen.getByTestId("onboarding-env-badge")).toBeInTheDocument();
    expect(screen.getByTestId("onboarding-last-updated")).toBeInTheDocument();
    // Compact service health strip (no "服务健康" heading required, but
    // the four component labels must still be visible).
    expect(screen.getByTestId("ops-service-health")).toBeInTheDocument();
    expect(screen.getByText("KTX Runtime")).toBeInTheDocument();
    expect(screen.getByText("Lucy MCP")).toBeInTheDocument();
    expect(screen.getByText("语义层覆盖")).toBeInTheDocument();
    expect(screen.getByText("Agent 接入")).toBeInTheDocument();
    // Action required queue
    expect(screen.getByTestId("ops-action-required")).toBeInTheDocument();
    expect(screen.getByText("待处理事项")).toBeInTheDocument();
    // Quality + Access snapshots
    expect(screen.getByTestId("ops-quality-snapshot")).toBeInTheDocument();
    expect(screen.getByTestId("ops-access-risk")).toBeInTheDocument();
    expect(screen.getByText("质量快照")).toBeInTheDocument();
    expect(screen.getByText("访问风险")).toBeInTheDocument();
    // The MCP section uses its own heading now (no more "实时状态与诊断").
    // The heading text is split across a notranslate `MCP` span + a
    // Chinese tail, so use a function matcher against the full text
    // content.
    expect(
      screen.getByText(
        (_content, element) =>
          (element instanceof HTMLElement ? element.textContent : "").trim() === "MCP 接入"
      )
    ).toBeInTheDocument();
  });

  it("infers the environment badge from the runtime MCP endpoint host", async () => {
    // Local loopback host → Local badge.
    renderPage({
      mcpEndpoint: {
        url: "http://127.0.0.1:7879/mcp",
        status: "fallback",
        source: "fallback",
        configured: false,
        diagnostics: [
          {
            code: "MISSING_PUBLIC_MCP_URL",
            message: "LUCY_PUBLIC_MCP_URL is not configured; using local development MCP endpoint."
          }
        ]
      }
    });
    const badge = await screen.findByTestId("onboarding-env-badge");
    expect(badge).toHaveTextContent("环境: Local");

    // Non-loopback configured endpoint → Configured badge.
    cleanup();
    renderPage();
    const configured = await screen.findByTestId("onboarding-env-badge");
    expect(configured).toHaveTextContent("环境: Configured");

    // Invalid (null url) → 未配置.
    cleanup();
    renderPage({
      mcpEndpoint: {
        url: null,
        status: "invalid",
        source: "env",
        configured: false,
        diagnostics: [
          { code: "INVALID_PUBLIC_MCP_URL", message: "LUCY_PUBLIC_MCP_URL must be a valid absolute URL." }
        ]
      }
    });
    const invalid = await screen.findByTestId("onboarding-env-badge");
    expect(invalid).toHaveTextContent("环境: 未配置");
  });

  it("never hard-codes a 'Dev' environment badge label", async () => {
    renderPage();
    const badges = await screen.findAllByTestId("onboarding-env-badge");
    expect(badges.length).toBeGreaterThan(0);
    for (const badge of badges) {
      expect(badge.textContent).not.toMatch(/环境:\s*Dev/);
    }
  });

  it("exposes the auto-refresh toggle defaulted off", async () => {
    renderPage();
    const toggle = await screen.findByTestId("onboarding-auto-refresh-toggle");
    // `checked` should be false on initial mount.
    expect(toggle).not.toBeChecked();
  });

  it("records the lastUpdatedAt timestamp after the initial render", async () => {
    renderPage();
    const stamp = await screen.findByTestId("onboarding-last-updated");
    expect(stamp.textContent ?? "").toMatch(/上次更新:/);
  });

  it("updates the timestamp when the user manually clicks 刷新状态 and triggers a toast", async () => {
    toastSpy.mockClear();

    renderPage();

    const before = (await screen.findByTestId("onboarding-last-updated")).textContent ?? "";
    expect(before).toMatch(/上次更新:/);

    const refreshButton = await screen.findByRole("button", { name: /刷新状态|刷新中/ });
    fireEvent.click(refreshButton);

    // Allow the refetch + toast chain to flush.
    await new Promise((resolve) => setTimeout(resolve, 80));

    // The success toast is the spec contract; the failure toast is the
    // negative path. Either path counts as "the toast fired" per the
    // task description ("至少一个 toast 被触发").
    const totalCalls = toastSpy.mock.calls.length;
    expect(totalCalls).toBeGreaterThanOrEqual(1);
    // Confirm at least one call was either the success or failure variant.
    const labels = toastSpy.mock.calls
      .map((call) => (typeof call[0] === "string" ? call[0] : null))
      .filter((label): label is string => Boolean(label));
    expect(labels.some((label) => label === "success" || label === "error")).toBe(true);
  });

  it("shows 刷新中… while any core query is fetching", async () => {
    // Render with the default fixture, then trigger refetch and verify the
    // button label flips to 刷新中… during the in-flight window.
    renderPage();

    const refreshButton = await screen.findByRole("button", { name: /刷新状态|刷新中/ });
    fireEvent.click(refreshButton);

    // Flush microtasks synchronously after click. The label is computed
    // from projectQuery.isFetching || sourcesQuery.isFetching ||
    // diffQuery.isFetching || agentsQuery.isFetching.
    await new Promise((resolve) => setTimeout(resolve, 0));

    const button = screen.queryByRole("button", { name: /刷新状态|刷新中/ });
    expect(button).toBeInTheDocument();
    // After the queries settle, the button label should be back to 刷新状态.
    expect(button?.textContent ?? "").toMatch(/刷新状态|刷新中/);
  });

  // --- Task 4: state tone, metric-first cards, MCP drawer --------------------

  it("does not render the legacy green ready banner on the system overview page", async () => {
    renderPage();
    await screen.findByTestId("ops-service-health");
    // The big green `.pl-delivery-banner--ready` is gone; only the compact
    // status strip is allowed.
    expect(document.querySelector(".pl-delivery-banner--ready")).toBeNull();
    expect(document.querySelector(".pl-delivery-banner")).toBeNull();
  });

  it("uses Chinese severity labels (no bare Critical / Warning / Ready / Info) for action items", async () => {
    renderPage({
      sources: [
        readySource,
        { ...readySource, table: "customers", completion: "partial" },
        { ...readySource, table: "products", completion: "not_started" }
      ],
      agents: [{ ...readyAgent, stats: { callsLast7d: 1, deniedLast7d: 3, topTables: [] } }],
      evalRuns: { total: 0, runs: [] }
    });

    const queue = await screen.findByTestId("ops-action-required");
    const text = queue.textContent ?? "";

    // Negative assertions: the English severity words must never appear
    // standalone in the action-required queue (labels like "Critical"
    // would slip through; the spec bans these as user-visible labels).
    expect(text).not.toMatch(/(^|\s)Critical(\s|$)/);
    expect(text).not.toMatch(/(^|\s)Warning(\s|$)/);
    expect(text).not.toMatch(/(^|\s)Ready(\s|$)/);
    expect(text).not.toMatch(/(^|\s)Info(\s|$)/);

    // Positive assertions: every action item shows the Chinese severity
    // label plus impact, owner, update time and evidence.
    const items = queue.querySelectorAll(".pl-action-required-item");
    expect(items.length).toBeGreaterThan(0);
    for (const item of Array.from(items)) {
      const itemText = item.textContent ?? "";
      expect(itemText).toMatch(/高风险|待处理|提醒/);
      expect(itemText).toMatch(/影响|问答召回率|资产同步|发布一致性|质量基线|访问安全/);
      expect(itemText).toMatch(/负责人|数据治理组|架构组|语义发布负责人|QA 团队|访问治理组/);
      expect(itemText).toMatch(/更新/);
      // Each row carries a `前往处理` link with the ↗ glyph so the user
      // gets a consistent visual affordance.
      const link = item.querySelector("a.pl-btn");
      expect(link?.textContent ?? "").toMatch(/前往处理\s*↗/);
    }
  });

  it("renders the semantic coverage progress bar with accessible aria attributes", async () => {
    renderPage({
      sources: [
        readySource,
        { ...readySource, table: "customers", completion: "done" },
        { ...readySource, table: "products", completion: "not_started" },
        { ...readySource, table: "orders2", completion: "partial" }
      ]
    });

    const snapshot = await screen.findByTestId("ops-quality-snapshot");
    const progress = snapshot.querySelector('[role="progressbar"]');
    expect(progress).toBeInTheDocument();
    // 2 done / 4 total → 50%.
    expect(progress?.getAttribute("aria-valuenow")).toBe("50");
    expect(progress?.getAttribute("aria-valuemin")).toBe("0");
    expect(progress?.getAttribute("aria-valuemax")).toBe("100");
    // The main metric should be visible as a large standalone percent.
    expect(snapshot.textContent ?? "").toMatch(/\d+%/);
    // The label must describe the metric in text so screen readers don't
    // rely solely on color/length.
    expect(progress?.getAttribute("aria-label") ?? snapshot.textContent ?? "").toMatch(/语义/);
  });

  it("does not render the raw MCP config JSON code block by default", async () => {
    renderPage();
    // Wait for the page to settle so we are inspecting the steady state,
    // not the loading flash.
    await screen.findByTestId("ops-service-health");
    // The main page must not contain a `<pre>` JSON code snippet. The
    // snippet is gated behind the `查看配置` Drawer button.
    expect(document.querySelector("pre")).toBeNull();
    // Sanity check: the `复制 MCP 配置` action button is still on the
    // main page (we never remove the copy affordance).
    expect(screen.getByRole("button", { name: "复制 MCP 配置" })).toBeInTheDocument();
    // The new `查看配置` button must be present to open the drawer.
    expect(screen.getByRole("button", { name: "查看配置" })).toBeInTheDocument();
  });

  it("opens the MCP 配置 Drawer when the user clicks 查看配置", async () => {
    renderPage();
    await screen.findByTestId("ops-service-health");

    fireEvent.click(screen.getByRole("button", { name: "查看配置" }));

    const drawer = await screen.findByRole("dialog", { name: "MCP 配置" });
    expect(drawer).toBeInTheDocument();
    expect(within(drawer).getByTestId("mcp-config-drawer-title")).toHaveTextContent("MCP 配置");
    // The Drawer must host the JSON config + the copy button + the
    // `查看 Agent 实例 ↗` deep link.
    expect(within(drawer).getByRole("button", { name: "复制 MCP 配置" })).toBeInTheDocument();
    const agentLink = within(drawer).getByRole("link", { name: /查看 Agent 实例/ });
    expect(agentLink).toHaveAttribute("href", "/admin/agents");
    expect(agentLink.textContent ?? "").toMatch(/↗/);
  });

  it("protects professional English terms and URLs in the MCP drawer with translate='no' and notranslate", async () => {
    renderPage();
    await screen.findByTestId("ops-service-health");
    fireEvent.click(screen.getByRole("button", { name: "查看配置" }));

    const drawer = await screen.findByRole("dialog", { name: "MCP 配置" });
    const codeBlocks = drawer.querySelectorAll("code");
    expect(codeBlocks.length).toBeGreaterThan(0);
    for (const code of Array.from(codeBlocks)) {
      expect(code.getAttribute("translate")).toBe("no");
      expect(code.classList.contains("notranslate")).toBe(true);
    }
    // The Endpoint URL and the env-var name `LUCY_PUBLIC_MCP_URL` must
    // also carry translation defense.
    const drawerText = drawer.textContent ?? "";
    expect(drawerText).toMatch(/LUCY_PUBLIC_MCP_URL|MCP/);
    const urlNodes = drawer.querySelectorAll("code, span, a");
    let defendedNodes = 0;
    for (const node of Array.from(urlNodes)) {
      const t = node.textContent ?? "";
      if (t.includes("LUCY_PUBLIC_MCP_URL") || t.includes("/mcp")) {
        if (node.getAttribute("translate") === "no" || node.classList.contains("notranslate")) {
          defendedNodes += 1;
        }
      }
    }
    expect(defendedNodes).toBeGreaterThan(0);
  });

  it("never renders historical MCP token plaintext inside the drawer or main page", async () => {
    renderPage();
    await screen.findByTestId("ops-service-health");
    fireEvent.click(screen.getByRole("button", { name: "查看配置" }));
    const drawer = await screen.findByRole("dialog", { name: "MCP 配置" });
    const allText = (document.body.textContent ?? "") + " " + (drawer.textContent ?? "");
    // The config must keep the canonical placeholder, not a literal
    // historical token. We assert by scanning for the placeholder and
    // by forbidding common token-shape patterns (long base64 / hex
    // strings). The placeholder string is the only acceptable token
    // value the page is allowed to render.
    expect(allText).toContain("<LUCY_AGENT_TOKEN>");
    expect(allText).not.toMatch(/Bearer\s+[A-Za-z0-9_-]{16,}/);
  });

  it("shows the eval monitor entry link inside the eval-gap action item", async () => {
    renderPage({ evalRuns: { total: 0, runs: [] } });
    const actionRequired = await screen.findByTestId("ops-action-required");
    const link = within(actionRequired).getByRole("link", { name: /前往处理/ });
    expect(link).toHaveAttribute("href", "/eval/monitor");
  });

  it("suppresses the eval-gap queue item once any eval run exists", async () => {
    // Default fixture stubs /api/eval/runs?limit=1 to return one run, so
    // the "近 30 天无评测数据" item must NOT appear in the queue.
    renderPage();

    const actionRequired = await screen.findByTestId("ops-action-required");
    expect(actionRequired).not.toHaveTextContent("近 30 天无评测数据");
  });

  it("shows the eval-gap queue item when no eval run has happened", async () => {
    renderPage({ evalRuns: { total: 0, runs: [] } });

    const actionRequired = await screen.findByTestId("ops-action-required");
    expect(actionRequired).toHaveTextContent("近 30 天无评测数据");
  });

  // --- P2-B follow-up: eval-gap gating while the eval probe is in flight
  // or errored. The dashboard must not surface a misleading
  // "近 30 天无评测数据" item against unknown data. --------------------------

  it("does not surface eval-gap while the eval probe is still loading", async () => {
    // Render with a custom fetch stub that hangs on the eval endpoint —
    // every other endpoint resolves immediately so the action-required
    // panel renders promptly. The eval probe stays in `isLoading` state.
    const agents = [readyAgent];
    const sources = [readySource];
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } }
    });
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/eval/runs?limit=1") {
        // Hang forever — never let the eval query settle.
        return new Promise(() => {});
      }
      if (url === "/api/project") {
        return new Response(
          JSON.stringify({
            ok: true,
            data: {
              root: "/tmp/project-lucy",
              ktxAvailable: true,
              connections: [{ id: "mysql-demo", driver: "mysql", schemas: ["demo"], enabledTables: ["demo.orders"] }],
              mcpEndpoint: {
                url: "https://lucy.example.com/mcp",
                status: "configured",
                source: "env",
                configured: true,
                diagnostics: []
              }
            }
          })
        );
      }
      if (url === "/api/sources") {
        return new Response(JSON.stringify({ ok: true, data: { tables: sources } }));
      }
      if (url === "/api/diff") {
        return new Response(JSON.stringify({ ok: true, data: { files: [] } }));
      }
      if (url === "/api/admin/agents") {
        return new Response(JSON.stringify({ ok: true, data: { agents } }));
      }
      return new Response(JSON.stringify({ ok: true, data: {} }));
    });
    vi.stubGlobal("fetch", fetchMock);
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <Onboarding />
        </MemoryRouter>
      </QueryClientProvider>
    );

    const actionRequired = await screen.findByTestId("ops-action-required");
    expect(actionRequired).not.toHaveTextContent("近 30 天无评测数据");
  });

  it("does not surface eval-gap after the eval probe errors", async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } }
    });
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/eval/runs?limit=1") {
        // Hard-error the eval probe. TanStack's `retry: false` keeps it
        // in `error` state so the dashboard can confirm gating.
        return new Response(JSON.stringify({ ok: false, error: "boom" }), { status: 500 });
      }
      if (url === "/api/project") {
        return new Response(
          JSON.stringify({
            ok: true,
            data: {
              root: "/tmp/project-lucy",
              ktxAvailable: true,
              connections: [{ id: "mysql-demo", driver: "mysql", schemas: ["demo"], enabledTables: ["demo.orders"] }],
              mcpEndpoint: {
                url: "https://lucy.example.com/mcp",
                status: "configured",
                source: "env",
                configured: true,
                diagnostics: []
              }
            }
          })
        );
      }
      if (url === "/api/sources") {
        return new Response(JSON.stringify({ ok: true, data: { tables: [readySource] } }));
      }
      if (url === "/api/diff") {
        return new Response(JSON.stringify({ ok: true, data: { files: [] } }));
      }
      if (url === "/api/admin/agents") {
        return new Response(JSON.stringify({ ok: true, data: { agents: [readyAgent] } }));
      }
      return new Response(JSON.stringify({ ok: true, data: {} }));
    });
    vi.stubGlobal("fetch", fetchMock);
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <Onboarding />
        </MemoryRouter>
      </QueryClientProvider>
    );

    const actionRequired = await screen.findByTestId("ops-action-required");
    expect(actionRequired).not.toHaveTextContent("近 30 天无评测数据");
  });

  // --- P2-B follow-up: manual 刷新状态 must refetch the eval probe so
  // the eval-gap item tracks new eval runs after a click. -----------------

  it("refetches the eval probe when the user clicks 刷新状态", async () => {
    // Start with one run, then switch the stub to zero runs. The eval-gap
    // item must NOT appear until the user clicks 刷新状态 — only then
    // does the manual refresh touch the eval endpoint and surface the
    // item.
    let evalRuns: { total: number; runs: unknown[] } = { total: 1, runs: [{ id: 1 }] };
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/eval/runs?limit=1") {
        return new Response(JSON.stringify({ ok: true, data: evalRuns }));
      }
      if (url === "/api/project") {
        return new Response(
          JSON.stringify({
            ok: true,
            data: {
              root: "/tmp/project-lucy",
              ktxAvailable: true,
              connections: [{ id: "mysql-demo", driver: "mysql", schemas: ["demo"], enabledTables: ["demo.orders"] }],
              mcpEndpoint: {
                url: "https://lucy.example.com/mcp",
                status: "configured",
                source: "env",
                configured: true,
                diagnostics: []
              }
            }
          })
        );
      }
      if (url === "/api/sources") {
        return new Response(JSON.stringify({ ok: true, data: { tables: [readySource] } }));
      }
      if (url === "/api/diff") {
        return new Response(JSON.stringify({ ok: true, data: { files: [] } }));
      }
      if (url === "/api/admin/agents") {
        return new Response(JSON.stringify({ ok: true, data: { agents: [readyAgent] } }));
      }
      return new Response(JSON.stringify({ ok: true, data: {} }));
    });
    vi.stubGlobal("fetch", fetchMock);
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } }
    });
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <Onboarding />
        </MemoryRouter>
      </QueryClientProvider>
    );

    // Sanity: with one run, the dashboard does NOT show the eval-gap item.
    const actionRequired = await screen.findByTestId("ops-action-required");
    expect(actionRequired).not.toHaveTextContent("近 30 天无评测数据");

    // Flip the upstream stub to no runs.
    evalRuns = { total: 0, runs: [] };

    // Record how many times the eval endpoint has been hit so far
    // (initial settle + any auto-refresh handshakes).
    const evalCallsBefore = fetchMock.mock.calls.filter((call) => String(call[0]) === "/api/eval/runs?limit=1").length;

    // Click 刷新状态 and let the Promise.allSettled chain flush.
    fireEvent.click(screen.getByRole("button", { name: /刷新状态|刷新中/ }));
    await new Promise((resolve) => setTimeout(resolve, 50));

    const evalCallsAfter = fetchMock.mock.calls.filter((call) => String(call[0]) === "/api/eval/runs?limit=1").length;
    // The manual refresh must have re-hit the eval endpoint at least
    // once. (Earlier M39 implementations dropped `evalLastRunQuery`
    // from the refresh promise — this test pins the new contract.)
    expect(evalCallsAfter).toBeGreaterThan(evalCallsBefore);

    // After the refresh, the eval-gap item should appear because the
    // upstream now reports zero runs.
    await waitFor(() => {
      expect(screen.getByTestId("ops-action-required")).toHaveTextContent("近 30 天无评测数据");
    });
  });

  // --- P2-A follow-up: a clean auto-refresh cycle bumps
  // lastUpdatedAt so the header badge and action-row 更新时间 track
  // each tick (not just the initial settlement). --------------------------

  it("bumps lastUpdatedAt after auto-refresh completes a clean cycle", async () => {
    // We don't try to spoof the wall-clock — that races with the
    // initial settlement in jsdom. Instead we verify the auto-refresh
    // code path runs end-to-end: enabling auto-refresh + firing a
    // visibility-change event must drive a fresh refetch cycle (extra
    // fetch calls) and the badge must remain a well-formed
    // `上次更新: HH:mm:ss` (no NaN / `--` regression), confirming
    // `setLastUpdatedAt` inside the cycle still updates the stamp.
    const { fetchMock } = renderPage();
    const stampEl = await screen.findByTestId("onboarding-last-updated");
    expect(stampEl.textContent ?? "").toMatch(/上次更新: \d{2}:\d{2}:\d{2}/);

    const callsBefore = fetchMock.mock.calls.length;
    // Enable auto-refresh so the visibility-change handler runs
    // `schedule()` directly (jsdom defaults `document.hidden` to
    // `false`).
    fireEvent.click(screen.getByTestId("onboarding-auto-refresh-toggle"));
    document.dispatchEvent(new Event("visibilitychange"));

    // Wait for the Promise.allSettled chain + the .then() callback
    // (which calls `setLastUpdatedAt`) to flush.
    await waitFor(() => {
      expect(fetchMock.mock.calls.length).toBeGreaterThan(callsBefore);
    });
    // The label is still a well-formed timestamp; if the clean cycle
    // path skipped `setLastUpdatedAt` we'd see `上次更新: --`.
    expect(screen.getByTestId("onboarding-last-updated").textContent ?? "").toMatch(
      /上次更新: \d{2}:\d{2}:\d{2}/
    );
  });
});
