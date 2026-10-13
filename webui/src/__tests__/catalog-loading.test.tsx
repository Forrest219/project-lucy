// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactElement } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Catalog } from "../pages/Catalog";
import { ConnectionOverview } from "../pages/connections/ConnectionOverview";
import { AsyncRegion } from "../components/AsyncRegion";
import type { SourceSummary } from "../lib/types";

function summary(table: string, overrides: Partial<SourceSummary> = {}): SourceSummary {
  return {
    conn: "perf-conn",
    schema: "sales",
    table,
    qualifiedName: `sales.${table}`,
    filePath: "semantic-layer/perf-conn/_schema/sales.yaml",
    columnCount: 3,
    columnNames: ["id"],
    hasTableDesc: true,
    hasGrain: true,
    measureCount: 1,
    joinCount: 0,
    wikiRefCount: 0,
    completion: "done",
    mtime: "2026-10-01T00:00:00.000Z",
    enabled: true,
    authorizedAgentCount: 4,
    semanticUpdatedAt: "2026-10-01T00:00:00.000Z",
    semanticUpdatedAtSource: "manifest",
    ...overrides
  };
}

type Deferred = { resolve: (value: Response) => void; promise: Promise<Response> };
function deferred(): Deferred {
  let resolve!: (value: Response) => void;
  const promise = new Promise<Response>((r) => {
    resolve = r;
  });
  return { resolve, promise };
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(status === 200 ? { ok: true, data } : data), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

const project = {
  root: "/fixture",
  ktxAvailable: true,
  connections: [{ id: "perf-conn", driver: "mysql", host: "db.invalid", schemas: ["sales"], enabledTables: ["sales.orders"] }],
  mcpEndpoint: { url: null, status: "fallback", source: "fallback", configured: false, diagnostics: [] }
};

let sources: Deferred;
let sourcesBody: () => Response;

function stubFetch() {
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith("/api/sources")) return sources.promise.then(() => sourcesBody());
    if (url.endsWith("/api/project")) return json(project);
    if (url.endsWith("/api/catalog/reloads")) return json({ runs: [], last: null, lastByConnection: {} });
    if (url.endsWith("/api/admin/mcp-runtime/status")) return json({ execution: { status: "unknown" } });
    if (url.includes("/live-schemas")) return json({ status: "ok", connectionId: "perf-conn", schemas: [], fetchedAt: "", cached: false });
    if (url.endsWith("/test")) return json({ status: "ok", latencyMs: 5, command: "ktx", args: [], exitCode: 0, stdout: "", stderr: "" });
    return json({ recorded: true });
  }));
}

function renderWith(node: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>{node}</MemoryRouter>
    </QueryClientProvider>
  );
  return client;
}

beforeEach(() => {
  sources = deferred();
  sourcesBody = () => json({ tables: [summary("orders"), summary("refunds", { enabled: false })], manifestSchemas: [], meta: { snapshotVersion: "v1", generatedAt: "", authorizedCountsState: "ok", runtimeConsistency: "matched" } });
  stubFetch();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("Spec 174 T2 — Catalog partitioned loading (SC-06/07)", () => {
  it("renders the header and toolbar immediately and rows only with real data", async () => {
    renderWith(<Catalog />);
    expect(screen.getByRole("heading", { name: "语义资产" })).toBeInTheDocument();
    expect(screen.getByPlaceholderText("搜索表名或字段名...")).toBeEnabled();
    expect(screen.queryByTestId("catalog-result-count")).not.toBeInTheDocument();
    expect(document.querySelectorAll('tr[data-testid^="catalog-row-"]')).toHaveLength(0);
    expect(screen.getAllByTestId("async-region-pending")[0]).toHaveAttribute("aria-busy", "true");
    await act(async () => sources.resolve(new Response()));
    expect(await screen.findByTestId("catalog-row-orders")).toBeInTheDocument();
    expect(screen.getByTestId("catalog-result-count")).toHaveTextContent("1 条结果");
    expect(screen.queryByTestId("async-region-pending")).not.toBeInTheDocument();
  });

  it("separates first-load failure (local retry) from an empty success", async () => {
    sourcesBody = () => json({ ok: false, error: { code: "INTERNAL", message: "boom" } }, 500);
    renderWith(<Catalog />);
    await act(async () => sources.resolve(new Response()));
    expect((await screen.findAllByTestId("async-region-error"))[0]).toHaveTextContent("语义资产加载失败：boom");
    expect(screen.getByPlaceholderText("搜索表名或字段名...")).toBeInTheDocument();
    expect(screen.queryByTestId("catalog-empty-state")).not.toBeInTheDocument();

    sources = deferred();
    sourcesBody = () => json({ tables: [], manifestSchemas: [] });
    fireEvent.click(screen.getByTestId("async-region-retry"));
    await act(async () => sources.resolve(new Response()));
    expect(await screen.findByTestId("catalog-empty-state")).toBeInTheDocument();
  });

  it("shows unknown Agent reference counts when counts are partial / unavailable", async () => {
    sourcesBody = () => json({ tables: [summary("orders", { authorizedAgentCount: 0 })], manifestSchemas: [], meta: { snapshotVersion: "v1", generatedAt: "", authorizedCountsState: "partial", runtimeConsistency: "unconfirmed" } });
    renderWith(<Catalog />);
    await act(async () => sources.resolve(new Response()));
    expect(await screen.findByTestId("catalog-row-agents-orders")).toHaveTextContent("—");
  });

  it("R3 shows 权限生效状态待确认 while unconfirmed and clears it once matched, without unknown counts becoming 0", async () => {
    sourcesBody = () => json({ tables: [summary("orders", { authorizedAgentCount: 0 })], manifestSchemas: [], meta: { snapshotVersion: "v1", generatedAt: "", authorizedCountsState: "partial", runtimeConsistency: "unconfirmed" } });
    const client = renderWith(<Catalog />);
    await act(async () => sources.resolve(new Response()));
    expect(await screen.findByTestId("catalog-runtime-unconfirmed")).toHaveTextContent("权限生效状态待确认");
    expect(screen.getByTestId("catalog-row-agents-orders")).toHaveTextContent("—");
    sources = deferred();
    sourcesBody = () => json({ tables: [summary("orders", { authorizedAgentCount: 1 })], manifestSchemas: [], meta: { snapshotVersion: "v2", generatedAt: "", authorizedCountsState: "ok", runtimeConsistency: "matched" } });
    void client.invalidateQueries({ queryKey: ["sources"] });
    await act(async () => sources.resolve(new Response()));
    await waitFor(() => expect(screen.queryByTestId("catalog-runtime-unconfirmed")).not.toBeInTheDocument());
  });

  it("keeps rows on screen during a background refetch", async () => {
    const client = renderWith(<Catalog />);
    await act(async () => sources.resolve(new Response()));
    await screen.findByTestId("catalog-row-orders");
    sources = deferred();
    void client.invalidateQueries({ queryKey: ["sources"] });
    await waitFor(() => expect(client.isFetching({ queryKey: ["sources"] })).toBe(1));
    expect(screen.getByTestId("catalog-row-orders")).toBeInTheDocument();
    expect(screen.queryByTestId("async-region-pending")).not.toBeInTheDocument();
    await act(async () => sources.resolve(new Response()));
  });
});

describe("Spec 174 T2 — AsyncRegion timing", () => {
  it("shows a static placeholder at once and the loading text only after 120 ms", () => {
    vi.useFakeTimers();
    render(<AsyncRegion status="pending" label="连接列表" minHeight={100} />);
    const region = screen.getByTestId("async-region-pending");
    expect(region).toHaveStyle({ minHeight: "100px" });
    expect(screen.queryByText("正在加载连接列表…")).not.toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(119);
    });
    expect(screen.queryByText("正在加载连接列表…")).not.toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(2);
    });
    expect(screen.getByText("正在加载连接列表…")).toBeInTheDocument();
  });
});

describe("Spec 174 T2 — ConnectionOverview with project ready and sources pending (SC-06/21)", () => {
  it("shows connection cards and page actions while Manifest facts stay unknown", async () => {
    renderWith(<ConnectionOverview />);
    expect(await screen.findByTestId("connection-card-perf-conn")).toBeInTheDocument();
    expect(screen.getByTestId("create-connection-btn")).toBeEnabled();
    expect(screen.getByTestId("add-schema-perf-conn")).toBeInTheDocument();
    const values = screen.getAllByTestId("connection-metric-value").map((node) => node.textContent);
    expect(values).toEqual(["1", "—", "—", "—"]);
    expect(screen.getByTestId("schema-asset-status-perf-conn-sales")).toHaveTextContent("—");
    expect(screen.queryByText("缺失 Manifest")).not.toBeInTheDocument();
    expect(screen.queryByTestId("read-structure-perf-conn-sales")).not.toBeInTheDocument();
    expect(screen.queryByTestId("resume-assistant-perf-conn")).not.toBeInTheDocument();

    await act(async () => sources.resolve(new Response()));
    await waitFor(() => expect(screen.getAllByTestId("connection-metric-value")[2]).toHaveTextContent("2"));
    expect(screen.getByTestId("schema-asset-status-perf-conn-sales")).toHaveTextContent("已存在");
  });
});
