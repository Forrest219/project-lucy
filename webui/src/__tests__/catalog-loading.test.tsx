// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactElement } from "react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Catalog } from "../pages/Catalog";
import { ConnectionOverview } from "../pages/connections/ConnectionOverview";
import { AsyncRegion } from "../components/AsyncRegion";
import type { SourceSummary } from "../lib/types";
import { apiPut, setDisplayWriteBeginHandler, setDisplayWriteSettledHandler } from "../lib/apiClient";
import { DISPLAY_SCOPE_QUERY_KEYS } from "../lib/displayQueryOptions";
import { queryKeys } from "../lib/queryKeys";

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

function renderWith(node: ReactElement, client = new QueryClient({ defaultOptions: { queries: { retry: false } } }), path = "/") {
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>{node}</MemoryRouter>
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
  setDisplayWriteBeginHandler(null);
  setDisplayWriteSettledHandler(null);
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function LocationProbe() {
  return <output data-testid="catalog-test-location">{useLocation().pathname}</output>;
}

describe("Spec 174 R4 closure — Catalog fact-dependent navigation", () => {
  function syncWrites(client: QueryClient) {
    setDisplayWriteBeginHandler((scopes) => {
      for (const scope of scopes) void client.cancelQueries({ queryKey: DISPLAY_SCOPE_QUERY_KEYS[scope] });
    });
    setDisplayWriteSettledHandler((scopes) => {
      for (const scope of scopes) void client.invalidateQueries({ queryKey: DISPLAY_SCOPE_QUERY_KEYS[scope] });
    });
  }

  for (const outcome of ["success", "rollback", "fresh-read-failure"] as const) {
    it(`blocks row navigation and open menus until fresh facts after ${outcome}`, async () => {
      sourcesBody = () => json({ tables: [summary("orders", { wikiRefCount: 1 }), summary("refunds", { enabled: false })], manifestSchemas: [] });
      const client = renderWith(<><Catalog /><LocationProbe /></>, undefined, "/catalog?scope=all");
      syncWrites(client);
      await act(async () => sources.resolve(new Response()));
      await screen.findByTestId("catalog-row-orders");
      fireEvent.click(screen.getByTestId("row-more-trigger"));
      expect(screen.getByTestId("catalog-row-wiki-orders")).toBeInTheDocument();
      const write = deferred();
      sources = deferred();
      const ordinaryFetch = globalThis.fetch;
      vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL, init?: RequestInit) => String(input).endsWith("/enabled-tables") ? write.promise : ordinaryFetch(input, init)));
      let mutation!: Promise<unknown>;
      try {
        act(() => { mutation = apiPut("/api/connections/perf-conn/enabled-tables", { enabledTables: [] }).catch(() => null); });
        for (const id of ["catalog-row-edit-orders", "catalog-row-maintain-orders", "catalog-row-edit-refunds", "catalog-row-enable-scope-refunds"]) {
          const action = screen.getByTestId(id);
          expect(action).toHaveAttribute("aria-disabled", "true");
          expect(action).not.toHaveAttribute("href");
          fireEvent.click(action);
        }
        expect(screen.getByTestId("catalog-test-location")).toHaveTextContent(/^\/catalog$/);
        expect(screen.getByTestId("row-more-trigger")).toBeDisabled();
        expect(screen.queryByTestId("catalog-row-wiki-orders")).not.toBeInTheDocument();
        expect(screen.getByPlaceholderText("搜索表名或字段名...")).toBeEnabled();
        expect(screen.getByTestId("catalog-row-orders")).toBeInTheDocument();
        await act(async () => { write.resolve(outcome === "rollback" ? json({ ok: false, error: { code: "INTERNAL", message: "rolled back" } }, 500) : json({})); await mutation; });
        expect(screen.getByTestId("catalog-row-edit-orders")).toHaveAttribute("aria-disabled", "true");
        const finalEnabled = outcome === "rollback";
        sourcesBody = () => outcome === "fresh-read-failure"
          ? json({ ok: false, error: { code: "INTERNAL", message: "refresh failed" } }, 500)
          : json({ tables: [summary("orders", { enabled: finalEnabled, wikiRefCount: 1 })], manifestSchemas: [] });
        await act(async () => sources.resolve(new Response()));
        if (outcome === "fresh-read-failure") {
          await waitFor(() => expect(client.getQueryState(queryKeys.sources)?.status).toBe("error"));
          expect(screen.getByTestId("catalog-row-edit-orders")).not.toHaveAttribute("href");
          sourcesBody = () => json({ tables: [summary("orders", { enabled: false })], manifestSchemas: [] });
          await act(async () => { await client.refetchQueries({ queryKey: queryKeys.sources }); });
        }
        await waitFor(() => expect(screen.getByTestId("catalog-row-edit-orders")).toHaveAttribute("href", finalEnabled ? "/catalog/perf-conn/sales/orders" : "/connections/enabled-tables?connection=perf-conn&schema=sales"));
      } finally {
        write.resolve(json({}));
        sources.resolve(new Response());
        if (mutation) await mutation;
        client.clear();
      }
    });
  }

  it("does not unlock cached Catalog actions when only one overlapping write settles", async () => {
    const client = renderWith(<Catalog />, undefined, "/catalog");
    syncWrites(client);
    await act(async () => sources.resolve(new Response()));
    await screen.findByTestId("catalog-row-orders");
    const first = deferred();
    const second = deferred();
    sources = deferred();
    const ordinaryFetch = globalThis.fetch;
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL, init?: RequestInit) => String(input).endsWith("/a/enabled-tables") ? first.promise : String(input).endsWith("/b/enabled-tables") ? second.promise : ordinaryFetch(input, init)));
    let a!: Promise<unknown>;
    let b!: Promise<unknown>;
    try {
      act(() => { a = apiPut("/api/connections/a/enabled-tables", {}); b = apiPut("/api/connections/b/enabled-tables", {}); });
      await act(async () => { first.resolve(json({})); await a; });
      expect(screen.getByTestId("catalog-row-edit-orders")).not.toHaveAttribute("href");
      await act(async () => { second.resolve(json({})); await b; });
      expect(screen.getByTestId("catalog-row-edit-orders")).not.toHaveAttribute("href");
      await act(async () => sources.resolve(new Response()));
      await waitFor(() => expect(screen.getByTestId("catalog-row-edit-orders")).toHaveAttribute("href"));
    } finally {
      first.resolve(json({})); second.resolve(json({})); sources.resolve(new Response());
      if (a) await a; if (b) await b;
      client.clear();
    }
  });

  it("blocks the enabled-scope empty-state link while its facts are pending", async () => {
    sourcesBody = () => json({ tables: [summary("orders", { enabled: false })], manifestSchemas: [] });
    const client = renderWith(<Catalog />, undefined, "/catalog");
    syncWrites(client);
    await act(async () => sources.resolve(new Response()));
    await screen.findByText("当前没有已启用的语义资产");
    const write = deferred();
    const ordinaryFetch = globalThis.fetch;
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL, init?: RequestInit) => String(input).endsWith("/enabled-tables") ? write.promise : ordinaryFetch(input, init)));
    let mutation!: Promise<unknown>;
    try {
      act(() => { mutation = apiPut("/api/connections/perf-conn/enabled-tables", {}); });
      expect(screen.getByRole("link", { name: "启用表范围" })).toHaveAttribute("aria-disabled", "true");
      expect(screen.getByRole("link", { name: "启用表范围" })).not.toHaveAttribute("href");
    } finally {
      await act(async () => { write.resolve(json({})); if (mutation) await mutation; });
      client.clear();
    }
  });
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

describe("Spec 174 R4 — a write start blocks Manifest-dependent actions until fresh facts (SC-15/18)", () => {
  for (const outcome of ["success", "rollback"] as const) {
    it(`keeps old content, hides fact-dependent actions during the write, and restores them only after a fresh read (${outcome})`, async () => {
      const { apiPut, setDisplayWriteSettledHandler } = await import("../lib/apiClient");
      const client = renderWith(<ConnectionOverview />);
      setDisplayWriteSettledHandler((scopes) => {
        for (const scope of scopes) if (scope === "sources") void client.invalidateQueries({ queryKey: ["sources"] });
      });
      await act(async () => sources.resolve(new Response()));
      expect(await screen.findByTestId("view-manifest-perf-conn-sales")).toBeInTheDocument();

      const write = deferred();
      const base = globalThis.fetch;
      vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL, init?: RequestInit) =>
        String(input).endsWith("/enabled-tables") ? write.promise : base(input, init)
      ));
      sources = deferred();
      let saving!: Promise<unknown>;
      act(() => {
        saving = apiPut("/api/connections/perf-conn/enabled-tables", { dryRun: false, enabledTables: [] }).catch(() => undefined);
      });
      expect(await screen.findByTestId("schema-actions-pending-perf-conn-sales")).toBeInTheDocument();
      expect(screen.queryByTestId("view-manifest-perf-conn-sales")).not.toBeInTheDocument();
      expect(screen.getByTestId("schema-asset-status-perf-conn-sales")).toHaveTextContent("已存在");

      await act(async () => {
        write.resolve(outcome === "success" ? json({ written: true }) : json({ ok: false, error: { code: "POLICY_COMMIT_FAILED", message: "rolled back" } }, 500));
        await saving;
      });
      expect(screen.getByTestId("schema-actions-pending-perf-conn-sales")).toBeInTheDocument();
      await act(async () => sources.resolve(new Response()));
      expect(await screen.findByTestId("view-manifest-perf-conn-sales")).toBeInTheDocument();
      setDisplayWriteSettledHandler(null);
    });
  }
});

describe("Spec 174 R5 — decorations never gate the cards; probes start after the cards paint (SC-06/10)", () => {
  function stubWithDecorations(options: { runtime?: Deferred; reloads?: Deferred }) {
    const probeCalls: Array<{ url: string; cardPresent: boolean; armedMark: boolean }> = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/api/sources")) return sources.promise.then(() => sourcesBody());
      if (url.endsWith("/api/project")) return json(project);
      if (url.endsWith("/api/catalog/reloads")) return options.reloads ? options.reloads.promise : json({ runs: [], last: null, lastByConnection: {} });
      if (url.endsWith("/api/admin/mcp-runtime/status")) return options.runtime ? options.runtime.promise : json({ execution: { status: "unknown" } });
      if (url.includes("/live-schemas") || url.endsWith("/test")) {
        probeCalls.push({
          url,
          cardPresent: Boolean(document.querySelector('[data-testid="connection-card-perf-conn"]')),
          armedMark: performance.getEntriesByName("lucy-connections-probes-armed").length > 0
        });
        return url.endsWith("/test")
          ? json({ status: "ok", latencyMs: 5, command: "ktx", args: [], exitCode: 0, stdout: "", stderr: "" })
          : json({ status: "ok", connectionId: "perf-conn", schemas: [], fetchedAt: "", cached: false });
      }
      return json({ recorded: true });
    }));
    return probeCalls;
  }

  it("shows cards as soon as project is ready while runtime status and reload history are still pending", async () => {
    const runtime = deferred();
    const reloads = deferred();
    stubWithDecorations({ runtime, reloads });
    renderWith(<ConnectionOverview />);
    expect(await screen.findByTestId("connection-card-perf-conn", {}, { timeout: 150 })).toBeInTheDocument();
    expect(screen.getByTestId("add-schema-perf-conn")).toBeInTheDocument();
    expect(screen.getByTestId("execution-runtime-slot")).toBeInTheDocument();
    expect(screen.getByTestId("catalog-reload-status-perf-conn")).toHaveTextContent("正在读取配置同步状态...");
    await act(async () => {
      runtime.resolve(json({ execution: { status: "stale" } }));
      reloads.resolve(json({ runs: [], last: null, lastByConnection: { "perf-conn": { id: "r1", connectionId: "perf-conn", status: "succeeded", startedAt: "2026-10-01T00:00:00.000Z", finishedAt: "2026-10-01T00:00:01.000Z", tables: 1, warnings: [] } } }));
    });
    expect(await screen.findByTestId("execution-runtime-notice")).toBeInTheDocument();
    expect(screen.queryByTestId("execution-runtime-slot")).not.toBeInTheDocument();
    expect(await screen.findByTestId("connection-last-reload-perf-conn")).toBeInTheDocument();
    expect(screen.getByTestId("connection-card-perf-conn")).toBeInTheDocument();
  });

  it("runtime / reload request errors keep the cards and add no runtime notice", async () => {
    const runtime = deferred();
    const reloads = deferred();
    stubWithDecorations({ runtime, reloads });
    renderWith(<ConnectionOverview />);
    expect(await screen.findByTestId("connection-card-perf-conn", {}, { timeout: 150 })).toBeInTheDocument();
    await act(async () => {
      runtime.resolve(json({ ok: false, error: { code: "INTERNAL", message: "runtime down" } }, 500));
      reloads.resolve(json({ ok: false, error: { code: "INTERNAL", message: "history down" } }, 500));
    });
    await waitFor(() => expect(screen.getByTestId("catalog-reload-status-perf-conn")).toHaveTextContent("配置同步状态加载失败"));
    expect(screen.queryByTestId("execution-runtime-notice")).not.toBeInTheDocument();
    expect(screen.getByTestId("execution-runtime-slot")).toBeInTheDocument();
    expect(screen.getByTestId("connection-card-perf-conn")).toBeInTheDocument();
  });

  it("automatic test / live-schemas requests start only after the cards committed and painted", async () => {
    performance.clearMarks();
    const probeCalls = stubWithDecorations({});
    renderWith(<ConnectionOverview />);
    await screen.findByTestId("connection-card-perf-conn");
    await waitFor(() => expect(probeCalls.length).toBeGreaterThanOrEqual(2));
    expect(probeCalls.every((call) => call.cardPresent && call.armedMark)).toBe(true);
    const commit = performance.getEntriesByName("lucy-connections-cards-commit")[0]!;
    const armed = performance.getEntriesByName("lucy-connections-probes-armed")[0]!;
    expect(armed.startTime).toBeGreaterThanOrEqual(commit.startTime);
  });
});
