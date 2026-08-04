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
  mtime: "2026-06-21T00:00:00.000Z",
  authorizedAgentCount: 1,
  semanticUpdatedAt: "2026-06-21T00:00:00.000Z",
  semanticUpdatedAtSource: "manifest"
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
  project?: { ktxAvailable?: boolean };
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
  const projectOverride = options.project ?? {};
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
          ktxAvailable: projectOverride.ktxAvailable ?? true,
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
  it("summarizes the M41 system overview surface and copies MCP config", async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText }
    });

    renderPage();

    // M41: PageHeader H1 is 系统概览; 运维驾驶舱 is the product mental
    // model, not a user-visible H1.
    expect(await screen.findByRole("heading", { name: "系统概览" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "运维驾驶舱" })).not.toBeInTheDocument();
    expect(screen.queryByText("运行状态")).not.toBeInTheDocument();
    const pageActions = screen.getByLabelText("页面操作");
    expect(within(pageActions).queryByRole("link", { name: "打开系统手册" })).not.toBeInTheDocument();
    // M41: the refresh action is a single secondary button, not a dropdown menu.
    expect(screen.getByTestId("onboarding-refresh-button")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /刷新状态/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "数据库接入" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "配置 Agent" })).not.toBeInTheDocument();
    expect(screen.queryByText("Deployment readiness")).not.toBeInTheDocument();
    // M41: top of the page must be free of the legacy badges.
    const header = screen.getByTestId("page-header");
    expect(within(header).queryByText(/环境:/)).not.toBeInTheDocument();
    // "上次更新" badge is intentionally present in the header actions row,
    // paired with the refresh button — tests below pin this contract.
    expect(within(header).queryByText(/上次更新/)).toBeInTheDocument();
    expect(within(header).queryByText(/KTX\s*(可用|不可用)/)).not.toBeInTheDocument();
    expect(within(header).queryByText(/语义完成/)).not.toBeInTheDocument();
    expect(within(header).queryByText(/自动刷新/)).not.toBeInTheDocument();
    expect(within(header).queryByText(/活跃\s*Token/)).not.toBeInTheDocument();
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
    // the MCP 接入 section.
    expect(screen.getByRole("heading", { name: "MCP 接入" })).toBeInTheDocument();
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

    // M41: ready / warning renders a single summary line; danger renders
    // a high-weight alert. With the default fixture the page is ready.
    expect(await screen.findByTestId("ops-service-health-summary")).toBeInTheDocument();
    expect(document.querySelector('[data-testid="ops-service-health"]')).toBeNull();
    // 访问风险区使用「可用 Token」；MCP 接入区只保留 Endpoint 固定配置。
    const accessRisk = await screen.findByTestId("ops-access-risk");
    expect(accessRisk.textContent ?? "").toContain("可用");
    expect(accessRisk.textContent ?? "").toContain("Token");
    const mcpSection = screen.getByRole("heading", { name: "MCP 接入" }).closest("section");
    expect(mcpSection?.textContent ?? "").not.toMatch(/Agent:\s*\d+/);
    expect(mcpSection?.textContent ?? "").not.toMatch(/Token:\s*\d+/);
    expect(screen.queryByText(/活跃\s*Token/)).not.toBeInTheDocument();

    // Copy MCP config still works on the main page.
    fireEvent.click(screen.getByRole("button", { name: "复制 MCP 配置" }));
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining("Bearer <LUCY_AGENT_TOKEN>"));
  });

  it("surfaces the local fallback URL without deployment guidance when LUCY_PUBLIC_MCP_URL is unset", async () => {
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
    expect(screen.queryByText(/当前使用本地默认|本地默认 MCP Endpoint|客户部署请配置/)).not.toBeInTheDocument();
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

    // The MCP 接入 section still appears so the user can see the fixed
    // Endpoint state, but the copy button must be disabled when the
    // endpoint is invalid. The view button stays enabled so the user can
    // open the Drawer and read the diagnostics.
    expect(await screen.findByRole("heading", { name: "MCP 接入" })).toBeInTheDocument();
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

  it("keeps MCP 接入 focused on Endpoint when Agent setup is incomplete", async () => {
    renderPage({ agents: [] });

    const mcpSection = (await screen.findByRole("heading", { name: "MCP 接入" })).closest("section");
    expect(mcpSection?.textContent ?? "").toContain("https://lucy.example.com/mcp");
    expect(mcpSection?.textContent ?? "").not.toContain("尚未创建 Agent");
    expect(mcpSection?.textContent ?? "").not.toMatch(/Agent:\s*\d+/);
    expect(mcpSection?.textContent ?? "").not.toMatch(/Token:\s*\d+/);
    expect(screen.getByRole("button", { name: "复制 MCP 配置" })).toBeEnabled();
    expect(screen.queryByRole("link", { name: "打开阻塞项" })).not.toBeInTheDocument();
  });

  it.each([
    ["尚未创建 Agent", []],
    ["启用的 Agent 暂无可用 token", [{ ...readyAgent, tokens: [] }]],
    ["所有 Agent 均已禁用", [{ ...readyAgent, enabled: false }]],
    ["所有 Agent 仍为 legacy allow，需迁移到 role", [{ ...readyAgent, role: undefined, allow: { tables: ["*"], tools: ["*"] } }]]
  ])("does not explain Agent setup gaps inside MCP 接入: %s", async (message, agents) => {
    renderPage({ agents: agents as Agent[] });

    const mcpSection = (await screen.findByRole("heading", { name: "MCP 接入" })).closest("section");
    expect(mcpSection?.textContent ?? "").not.toContain(message);
  });

  it("renders the M39 ops dashboard sections", async () => {
    renderPage();

    // M39: header title is now 系统概览 (the page-level page title);
    // "运维驾驶舱" is the product mental model, not a user-visible H1.
    expect(await screen.findByRole("heading", { name: "系统概览" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "运维驾驶舱" })).not.toBeInTheDocument();
    // M41: top of the page is intentionally clean — only the title, the
    // description, a single "刷新首页数据" button, and a "上次更新" badge
    // sitting next to it. The legacy env / KTX / semantic badges are gone;
    // tests below pin this.
    const header = screen.getByTestId("page-header");
    expect(within(header).queryByText(/环境:/)).not.toBeInTheDocument();
    // "上次更新" badge is intentionally in the header actions row.
    expect(within(header).queryByText(/上次更新/)).toBeInTheDocument();
    expect(within(header).queryByText(/KTX\s*(可用|不可用)/)).not.toBeInTheDocument();
    expect(within(header).queryByText(/语义完成/)).not.toBeInTheDocument();
    expect(within(header).queryByText(/自动刷新/)).not.toBeInTheDocument();
    expect(within(header).queryByText(/活跃\s*Token/)).not.toBeInTheDocument();
    // The single refresh button must NOT carry dropdown affordance.
    const refreshButton = within(header).getByTestId("onboarding-refresh-button");
    expect(refreshButton).toBeInstanceOf(HTMLButtonElement);
    expect(refreshButton).not.toHaveAttribute("aria-haspopup");
    expect(refreshButton).not.toHaveTextContent("▾");
    expect(["刷新首页数据", "刷新首页数据中..."]).toContain(refreshButton.textContent?.trim());
    // M41: ready / warning now renders a one-line summary instead of the
    // legacy 4-up strip.
    expect(await screen.findByTestId("ops-service-health-summary")).toBeInTheDocument();
    expect(document.querySelector('[data-testid="ops-service-health"]')).toBeNull();
    // Action required queue
    expect(screen.getByTestId("ops-action-required")).toBeInTheDocument();
    expect(screen.getByText("待处理事项")).toBeInTheDocument();
    // Quality + Access snapshots
    expect(screen.getByTestId("ops-quality-snapshot")).toBeInTheDocument();
    expect(screen.getByTestId("ops-access-risk")).toBeInTheDocument();
    expect(screen.getByText("质量快照")).toBeInTheDocument();
    expect(screen.getByText("访问风险")).toBeInTheDocument();
    // 质量快照只覆盖语义 / 发布 / 评测；访问风险负责 Agent / ACL / Token。
    const qualitySnapshot = screen.getByTestId("ops-quality-snapshot");
    const accessRisk = screen.getByTestId("ops-access-risk");
    expect(qualitySnapshot.textContent ?? "").toContain("语义覆盖率");
    expect(qualitySnapshot.textContent ?? "").toContain("待发布变更");
    expect(qualitySnapshot.textContent ?? "").toContain("评测数据");
    expect(qualitySnapshot.textContent ?? "").not.toContain("Agent 启用");
    expect(qualitySnapshot.textContent ?? "").not.toContain("ACL 拒绝");
    expect(accessRisk.textContent ?? "").toContain("Agent 启用与禁用");
    expect(accessRisk.textContent ?? "").toContain("近 7 天 ACL 拒绝");
    expect(accessRisk.textContent ?? "").toContain("可用");
    expect(accessRisk.textContent ?? "").toContain("Token");
    expect(screen.queryByText(/活跃\s*Token/)).not.toBeInTheDocument();
    // The MCP section uses its own heading now (no more "实时状态与诊断").
    expect(screen.getByRole("heading", { name: "MCP 接入" })).toBeInTheDocument();
  });

  it("shows 刷新中… while any core query is fetching and 刷新 when idle", async () => {
    renderPage();
    const refreshButton = await screen.findByTestId("onboarding-refresh-button");
    expect(refreshButton.textContent?.trim()).toBe("刷新首页数据");

    // Slow down the refetch so the in-flight label is observable in jsdom.
    const realFetch = globalThis.fetch;
    let resolveRefetch: () => void = () => {};
    const slowRefetch = new Promise<void>((resolve) => {
      resolveRefetch = resolve;
    });
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/eval/runs?limit=1") {
        await slowRefetch;
      }
      return realFetch(input);
    }));

    // Trigger a manual refresh. The label flips to "刷新首页数据中..." while at
    // least one core query is in-flight.
    fireEvent.click(refreshButton);
    // Flush microtasks + one macrotask so React commits the in-flight state.
    await new Promise((resolve) => setTimeout(resolve, 10));
    const fetchingButton = screen.getByTestId("onboarding-refresh-button");
    expect(fetchingButton.textContent?.trim()).toBe("刷新首页数据中...");
    expect(fetchingButton).toBeDisabled();

    // Release the slow refetch and verify the label returns to 刷新.
    resolveRefetch();
    await waitFor(() => {
      expect(screen.getByTestId("onboarding-refresh-button").textContent?.trim()).toBe("刷新首页数据");
    });
  });

  it("does not expose an auto-refresh control anywhere on the page", async () => {
    renderPage();
    // Wait for the page to settle so the refresh button is in the DOM.
    const refreshButton = await screen.findByTestId("onboarding-refresh-button");
    expect(document.querySelector('[data-testid="onboarding-refresh-menu"]')).toBeNull();
    expect(document.querySelector('[data-testid="onboarding-refresh-menu-auto"]')).toBeNull();
    expect(document.querySelector('[data-testid="onboarding-refresh-menu-manual"]')).toBeNull();
    // No aria-haspopup on the refresh button means no dropdown menu.
    expect(refreshButton).not.toHaveAttribute("aria-haspopup");
    // No "自动刷新" text in the document (header + page).
    expect(screen.queryByText(/自动刷新/)).not.toBeInTheDocument();
  });

  it("renders a 上次更新 badge in the description row, paired with the refresh button", async () => {
    renderPage();
    const badge = await screen.findByTestId("onboarding-last-updated");
    // UX-OVERVIEW-004: badge lives in the PageHeader description row, not
    // in the actions row, so widening the button no longer squeezes the
    // description's wrap points at <1280px viewports.
    const descriptionRow = await screen.findByTestId("onboarding-last-updated-row");
    expect(descriptionRow).toContainElement(badge);
    expect(screen.getByTestId("onboarding-refresh-controls")).not.toContainElement(badge);
    expect(screen.queryByTestId("onboarding-env-badge")).toBeNull();
    // Once the page settles, the label must move off the "未知" sentinel.
    await waitFor(() => {
      expect(badge.textContent ?? "").not.toMatch(/未知/);
    });
    expect(badge.textContent ?? "").toMatch(/上次更新[：:]/);
  });

  it("decouples the visual ticker from the a11y announce channel", async () => {
    // UX-OVERVIEW-003: the visual badge must NOT carry aria-live (otherwise
    // screen readers would announce every second). The announce channel is
    // a separate sr-only span that only writes on real state changes.
    renderPage();
    const badge = await screen.findByTestId("onboarding-last-updated");
    expect(badge).toHaveAttribute("aria-hidden", "true");
    expect(badge).not.toHaveAttribute("aria-live");

    const announce = await screen.findByTestId("onboarding-last-updated-announce");
    expect(announce).toHaveAttribute("aria-live", "polite");
    expect(announce).toHaveAttribute("role", "status");
    // Announce text is set on first successful mount; the channel should
    // carry at least one non-empty value after the page settles.
    await waitFor(() => {
      expect(announce.textContent ?? "").not.toBe("");
    });
  });

  it("updates the 上次更新 label after a successful manual refresh click", async () => {
    // We need a real 5+s wall-clock window to escape the "刚刚" bucket, so
    // give this single case a longer timeout than the global 5s default.
    renderPage();
    const badge = await screen.findByTestId("onboarding-last-updated");
    await waitFor(() => {
      expect(badge.textContent ?? "").not.toMatch(/未知/);
    });
    // Wait past the "刚刚" window (<5s) so the pre-click label is observably
    // older than zero — that way a successful click must reset the label
    // back into the fresh bucket, and we can assert the transition.
    await new Promise((resolve) => setTimeout(resolve, 5_200));
    const beforeLabel = badge.textContent ?? "";
    expect(beforeLabel).not.toMatch(/^.*刚刚.*$/);

    fireEvent.click(screen.getByTestId("onboarding-refresh-button"));
    await waitFor(() => {
      const current = badge.textContent ?? "";
      // After a successful click the timestamp resets to "刚刚" (or any
      // freshly-rendered relative/absolute label that isn't the stale one).
      expect(current).not.toBe(beforeLabel);
      expect(current).toMatch(/刚刚|秒前|分钟前|\d{2}:\d{2}:\d{2}/);
    });
  }, 15_000);

  it("shows an inline failure indicator when a refresh fails, and clears it on success", async () => {
    // UX-OVERVIEW-005: a refresh failure must surface inline so the user
    // can tell the badge timestamp is stale, without relying on a
    // transient toast. The badge keeps the last successful timestamp AND
    // appends a failure suffix that escalates at >= 3 consecutive
    // failures. A subsequent successful refresh clears everything.
    //
    // Strategy: hand-roll a fetch stub that fails the first three refresh
    // clicks and then succeeds. The mount wave always hits the happy
    // path so we don't trip Onboarding's "全页替换为错误页" branch and
    // can observe the badge state machine — see the `phase` comment in
    // the stub for the rationale.
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } }
    });
    // Phase model:
    //   - "mount": the very first fetch wave (initial page load) must
    //     succeed so we get past the `<p className="pl-error">` early-
    //     return and into the badge-rendered tree. Mount always hits the
    //     default happy-path stub regardless of the failure budget.
    //   - "failing": once the user clicks refresh, the stub returns 500s
    //     for every fetch inside that click wave. The 5 fetch calls in
    //     each click are concurrent (Promise.allSettled), so we count by
    //     click number rather than per-fetch.
    //   - "ok": budget exhausted (after 3 failing clicks), stub returns
    //     to happy path so the "clears on success" half of the assertion
    //     has something to observe.
    type Phase = "mount" | "failing" | "ok";
    let phase: Phase = "mount";
    let clickCount = 0;
    const failingFetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (phase === "failing" && clickCount <= 3) {
        return new Response(JSON.stringify({ ok: false, error: "boom" }), { status: 500 });
      }
      return defaultStub(input);
    });
    vi.stubGlobal("fetch", failingFetch);
    function defaultStub(input: RequestInfo | URL) {
      const url = String(input);
      if (url === "/api/project") {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              ok: true,
              data: {
                root: "/tmp/lucy",
                ktxAvailable: true,
                connections: [
                  {
                    id: "mysql-demo",
                    driver: "mysql",
                    schemas: ["demo"],
                    enabledTables: ["demo.orders"]
                  }
                ],
                mcpEndpoint: {
                  url: "https://lucy.example.com/mcp",
                  status: "configured",
                  source: "env",
                  configured: true,
                  diagnostics: []
                }
              }
            })
          )
        );
      }
      if (url === "/api/sources") {
        return Promise.resolve(new Response(JSON.stringify({ ok: true, data: { tables: [readySource] } })));
      }
      if (url === "/api/diff") {
        return Promise.resolve(new Response(JSON.stringify({ ok: true, data: { files: [] } })));
      }
      if (url === "/api/admin/agents") {
        return Promise.resolve(new Response(JSON.stringify({ ok: true, data: { agents: [readyAgent] } })));
      }
      if (url === "/api/eval/runs?limit=1") {
        return Promise.resolve(new Response(JSON.stringify({ ok: true, data: { total: 1, runs: [{ id: 1 }] } })));
      }
      return Promise.resolve(new Response(JSON.stringify({ ok: true, data: {} })));
    }
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <Onboarding />
        </MemoryRouter>
      </QueryClientProvider>
    );
    // Mount must settle into the happy path before we start failing.
    const badge = await screen.findByTestId("onboarding-last-updated");
    const announce = await screen.findByTestId("onboarding-last-updated-announce");
    await waitFor(() => {
      expect(badge.textContent ?? "").not.toMatch(/未知/);
    });
    expect(badge.getAttribute("data-state")).toBe("ok");

    // Switch into the failing regime and burn through three attempts.
    phase = "failing";
    for (let i = 0; i < 3; i += 1) {
      clickCount += 1;
      fireEvent.click(screen.getByTestId("onboarding-refresh-button"));
      // Allow the Promise.allSettled chain to flush.
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    await waitFor(() => {
      expect(badge.getAttribute("data-state")).toBe("danger");
      expect(badge.textContent ?? "").toMatch(/连续\s*3/);
      expect(announce.textContent ?? "").toMatch(/刷新失败/);
    });

    // Fourth attempt: phase flips to "ok" once budget is gone → success.
    phase = "ok";
    fireEvent.click(screen.getByTestId("onboarding-refresh-button"));
    await waitFor(() => {
      expect(badge.getAttribute("data-state")).toBe("ok");
      expect(badge.textContent ?? "").not.toMatch(/刷新失败/);
      expect(announce.textContent ?? "").toMatch(/系统概览已刷新/);
    });
  });

  it("excludes revoked and expired tokens from the 可用 Token count", async () => {
    const now = new Date("2026-08-01T00:00:00Z");
    const future = new Date("2027-01-01T00:00:00Z").toISOString();
    const past = new Date("2026-06-24T00:00:00Z").toISOString();

    renderPage({
      agents: [
        {
          ...readyAgent,
          id: "agent-enabled",
          name: "enabled-agent",
          enabled: true,
          tokens: [
            { hash: "h1", label: "fresh", created: now.toISOString(), expires_at: future }, // counts
            { hash: "h2", label: "expired", created: now.toISOString(), expires_at: past, revoked: true }, // revoked + expired
            { hash: "h3", label: "past", created: now.toISOString(), expires_at: past } // expired
            // unparseable expires_at → unparseable strings need explicit fixture; see next test
          ]
        },
        {
          ...readyAgent,
          id: "agent-disabled",
          name: "disabled-agent",
          enabled: false,
          tokens: [
            { hash: "h4", label: "future", created: now.toISOString(), expires_at: future }
          ]
        }
      ]
    });

    // 访问风险区显示「可用 Token：1 个」
    const accessRisk = await screen.findByTestId("ops-access-risk");
    expect(accessRisk.textContent ?? "").toMatch(/1/);
    expect(accessRisk.textContent ?? "").toContain("可用");
    expect(accessRisk.textContent ?? "").toContain("Token");
    expect(accessRisk.textContent ?? "").not.toContain("活跃");
    // MCP 接入区不再同步显示 Token / Agent 汇总。
    const mcpSection = screen.getByRole("heading", { name: "MCP 接入" }).closest("section");
    expect(mcpSection?.textContent ?? "").not.toMatch(/Token:\s*1\s*可用/);
    expect(mcpSection?.textContent ?? "").not.toMatch(/Agent:\s*\d+/);
  });

  it("treats unparseable expires_at as NOT available", async () => {
    renderPage({
      agents: [
        {
          ...readyAgent,
          id: "agent-bad-expires",
          name: "bad-expires-agent",
          enabled: true,
          tokens: [
            { hash: "h5", label: "no-expires", created: "2026-01-01T00:00:00Z", expires_at: null }, // counts (永不过期)
            { hash: "h6", label: "bad-string", created: "2026-01-01T00:00:00Z", expires_at: "not-a-date" } // ignored
          ]
        }
      ]
    });
    const accessRisk = await screen.findByTestId("ops-access-risk");
    expect(accessRisk.textContent ?? "").toMatch(/1/);
    expect(accessRisk.textContent ?? "").toContain("可用");
  });

  it("renders the danger alert with component-specific copy when KTX is unavailable", async () => {
    renderPage({
      project: {
        ktxAvailable: false
      }
    });
    const alert = await screen.findByTestId("ops-service-health-critical");
    expect(alert.textContent ?? "").toContain("KTX Runtime 不可用，请检查运行时配置。");
    // danger 态不渲染摘要行
    expect(document.querySelector('[data-testid="ops-service-health-summary"]')).toBeNull();
  });

  it("renders the danger alert with component-specific copy when Lucy MCP is unavailable", async () => {
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
    const alert = await screen.findByTestId("ops-service-health-critical");
    expect(alert.textContent ?? "").toContain("Lucy MCP 未就绪，请检查 Endpoint 配置。");
    expect(document.querySelector('[data-testid="ops-service-health-summary"]')).toBeNull();
  });

  // --- Task 4: state tone, metric-first cards, MCP drawer --------------------

  it("does not render the legacy green ready banner on the system overview page", async () => {
    renderPage();
    await screen.findByTestId("ops-service-health-summary");
    // The big green `.pl-delivery-banner--ready` is gone; only the
    // one-line summary is shown in ready / warning states.
    expect(document.querySelector(".pl-delivery-banner--ready")).toBeNull();
    expect(document.querySelector(".pl-delivery-banner")).toBeNull();
    // The legacy 4-up strip is gone as well.
    expect(document.querySelector('[data-testid="ops-service-health"]')).toBeNull();
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

    // Positive assertions: every action item shows a Chinese severity label,
    // a fact-based description and a lightweight action link. Fabricated
    // workflow fields must not come back as layout filler.
    const items = queue.querySelectorAll(".pl-action-required-item");
    expect(items.length).toBeGreaterThan(0);
    for (const item of Array.from(items)) {
      const itemText = item.textContent ?? "";
      expect(itemText).toMatch(/高风险|待处理|提醒/);
      expect(itemText).toMatch(/语义覆盖|Catalog 同步|语义变更|评测运行|访问日志/);
      expect(itemText).not.toMatch(/负责人|数据治理组|架构组|语义发布负责人|QA 团队|访问治理组/);
      expect(itemText).not.toMatch(/更新时间|证据/);
      // Each row carries a lightweight link with the ↗ glyph so the user
      // gets a consistent visual affordance without button chrome.
      // v1.9.x 收口：CTA 链接样式从 pl-btn 改为蓝色文本链接。
      const link = item.querySelector("a.pl-action-required-item-cta");
      expect(link?.textContent ?? "").toMatch(/↗/);
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
    await screen.findByTestId("ops-service-health-summary").catch(async () => { await screen.findByTestId("ops-service-health-critical"); });
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
    await screen.findByTestId("ops-service-health-summary").catch(async () => { await screen.findByTestId("ops-service-health-critical"); });

    fireEvent.click(screen.getByRole("button", { name: "查看配置" }));

    const drawer = await screen.findByRole("dialog", { name: "MCP 配置" });
    expect(drawer).toBeInTheDocument();
    expect(within(drawer).getByTestId("mcp-config-drawer-title")).toHaveTextContent("MCP 配置");
    // The Drawer hosts the JSON config + the `查看 Agent 实例 ↗` deep link.
    // The duplicate copy button and env / diagnostic hints stay out of
    // the Drawer; the main page already has the primary copy action.
    expect(within(drawer).queryByRole("button", { name: "复制 MCP 配置" })).not.toBeInTheDocument();
    expect(drawer).not.toHaveTextContent("诊断信息");
    expect(drawer).not.toHaveTextContent("LUCY_PUBLIC_MCP_URL");
    const agentLink = within(drawer).getByRole("link", { name: /查看 Agent 实例/ });
    expect(agentLink).toHaveAttribute("href", "/admin/agents");
    expect(agentLink.textContent ?? "").toMatch(/↗/);
  });

  it("protects professional English terms and URLs in the MCP drawer with translate='no' and notranslate", async () => {
    renderPage();
    await screen.findByTestId("ops-service-health-summary").catch(async () => { await screen.findByTestId("ops-service-health-critical"); });
    fireEvent.click(screen.getByRole("button", { name: "查看配置" }));

    const drawer = await screen.findByRole("dialog", { name: "MCP 配置" });
    const codeBlocks = drawer.querySelectorAll("code");
    expect(codeBlocks.length).toBeGreaterThan(0);
    for (const code of Array.from(codeBlocks)) {
      expect(code.getAttribute("translate")).toBe("no");
      expect(code.classList.contains("notranslate")).toBe(true);
    }
    // The Endpoint URL must also carry translation defense. The env-var
    // note is intentionally absent from the simplified Drawer.
    const drawerText = drawer.textContent ?? "";
    expect(drawerText).toMatch(/MCP/);
    expect(drawerText).not.toMatch(/LUCY_PUBLIC_MCP_URL/);
    const urlNodes = drawer.querySelectorAll("code, span, a");
    let defendedNodes = 0;
    for (const node of Array.from(urlNodes)) {
      const t = node.textContent ?? "";
      if (t.includes("/mcp")) {
        if (node.getAttribute("translate") === "no" || node.classList.contains("notranslate")) {
          defendedNodes += 1;
        }
      }
    }
    expect(defendedNodes).toBeGreaterThan(0);
  });

  it("never renders historical MCP token plaintext inside the drawer or main page", async () => {
    renderPage();
    await screen.findByTestId("ops-service-health-summary").catch(async () => { await screen.findByTestId("ops-service-health-critical"); });
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
    const link = within(actionRequired).getByRole("link", { name: /查看趋势监控/ });
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

    // Click the single 刷新 button and let the Promise.allSettled chain flush.
    // M41: there is no longer a dropdown menu — the button itself triggers the
    // refetch.
    fireEvent.click(screen.getByTestId("onboarding-refresh-button"));
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

  // --- P2-A follow-up (M41): the auto-refresh interval / visibility-change
  // toggle is gone. The page is now driven only by manual clicks on the
  // single 刷新 button. The test below pins that contract by counting
  // fetch calls before / after a click.

  it("M41: a manual 刷新 click refetches core + eval queries without auto-refresh", async () => {
    const { fetchMock } = renderPage();
    // Wait for the page to settle so the refresh button is in the DOM.
    const refreshButton = await screen.findByTestId("onboarding-refresh-button");
    const callsBefore = fetchMock.mock.calls.length;
    fireEvent.click(refreshButton);
    // Allow the Promise.allSettled chain + the .then() callback to flush.
    await new Promise((resolve) => setTimeout(resolve, 50));
    const callsAfter = fetchMock.mock.calls.length;
    // Manual click drives at least one fresh refetch cycle.
    expect(callsAfter).toBeGreaterThan(callsBefore);
    // And there is no setInterval timer in the document — the cleanest way
    // to check is to confirm the auto-refresh testid never appears.
    expect(document.querySelector('[data-testid="onboarding-refresh-menu-auto"]')).toBeNull();
    // The 上次更新 badge is now present (intentional reversal of the prior
    // "M41 removed last-updated" contract) and carries a freshly rendered
    // relative label after the click — proving refreshStatus wrote to
    // lastUpdatedAt and the ticker re-rendered.
    const lastUpdated = await waitFor(() => {
      const el = document.querySelector('[data-testid="onboarding-last-updated"]');
      expect(el).not.toBeNull();
      return el as HTMLElement;
    });
    await waitFor(() => {
      expect(lastUpdated.textContent ?? "").toMatch(/刚刚|秒前|分钟前|\d{2}:\d{2}:\d{2}/);
    });

    // Wait for the Promise.allSettled chain + the .then() callback to flush.
    await waitFor(() => {
      expect(fetchMock.mock.calls.length).toBeGreaterThan(callsBefore);
    });
    // Toast still fires as the success-side feedback.
    expect(toastSpy.mock.calls.length).toBeGreaterThanOrEqual(1);
  });
});
