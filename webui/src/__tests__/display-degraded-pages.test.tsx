// @vitest-environment jsdom
/**
 * P1-75 X5 — pages consume the degraded carrier: pending is loading (never an empty list),
 * grace/stale keep the data with a notice, 刷新 re-reads the covered region.
 */
import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactElement } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Catalog } from "../pages/Catalog";
import { RoleList } from "../pages/admin/RoleList";
import { TableWhitelist } from "../pages/connections/TableWhitelist";
import { clearDisplayInfo } from "../lib/displayState";
import type { ConnectionInfo, SourceSummary } from "../lib/types";

vi.mock("sonner", () => ({ toast: { message: vi.fn(), error: vi.fn(), success: vi.fn() } }));

const STALE = { "X-Lucy-Display-State": "stale", "X-Lucy-Display-Age-Ms": "150000", "X-Lucy-Display-Generation": "L4" };
const PENDING = { "X-Lucy-Display-State": "pending", "X-Lucy-Display-Generation": "L4", "X-Lucy-Display-Pending-Ms": "2000" };
const pendingBody = { ok: true, data: null, display: { state: "pending", generation: "L4", pendingMs: 2000 } };
const FORBIDDEN = /degraded|grace|stale|pending|busyReason|DISPLAY_|毫秒|服务繁忙|暂无数据/i;

function reply(body: unknown, headers: Record<string, string> = {}, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });
}

function summary(table: string): SourceSummary {
  return {
    conn: "c1", schema: "sales", table, qualifiedName: `sales.${table}`, filePath: "x.yaml", columnCount: 1,
    columnNames: ["id"], hasTableDesc: true, hasGrain: true, measureCount: 0, joinCount: 0, wikiRefCount: 0,
    completion: "done", mtime: "", enabled: true, authorizedAgentCount: 1,
    semanticUpdatedAt: "2026-10-01T00:00:00.000Z", semanticUpdatedAtSource: "manifest"
  };
}

const sourcesData = { tables: [summary("orders")], manifestSchemas: [] };
const project = { root: "/f", ktxAvailable: true, connections: [], mcpEndpoint: { url: null, status: "fallback", source: "fallback", configured: false, diagnostics: [] } };

let sourcesResponses: Array<() => Response>;
let sourcesCalls: number;

function stubFetch(extra: (url: string) => Response | undefined = () => undefined) {
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    const custom = extra(url);
    if (custom) return custom;
    if (url.endsWith("/api/sources")) {
      sourcesCalls += 1;
      const next = sourcesResponses.length > 1 ? sourcesResponses.shift()! : sourcesResponses[0]!;
      return next();
    }
    if (url.endsWith("/api/project")) return reply({ ok: true, data: project });
    return reply({ ok: true, data: {} });
  }));
}

/** The refresh entry is usable between pending polls; click it once it is enabled. */
async function clickRefresh(testId: string) {
  await waitFor(() => expect(screen.getByTestId(testId)).toBeEnabled());
  await act(async () => { fireEvent.click(screen.getByTestId(testId)); });
}

function renderPage(node: ReactElement, path = "/") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>{node}</MemoryRouter>
    </QueryClientProvider>
  );
  return client;
}

beforeEach(() => {
  sourcesCalls = 0;
  sourcesResponses = [() => reply({ ok: true, data: sourcesData })];
  clearDisplayInfo();
});

afterEach(() => {
  cleanup();
  clearDisplayInfo();
  vi.unstubAllGlobals();
});

describe("Catalog (语义资产)", () => {
  it("stale: keeps the rows, shows 数据可能不是最新 + age, refresh clears it once fresh", async () => {
    sourcesResponses = [() => reply({ ok: true, data: sourcesData }, STALE), () => reply({ ok: true, data: sourcesData })];
    stubFetch();
    renderPage(<Catalog />, "/catalog?scope=all");
    expect(await screen.findByTestId("catalog-row-orders")).toBeInTheDocument();
    const notice = await screen.findByTestId("catalog-display-degraded-notice");
    expect(notice).toHaveTextContent("数据可能不是最新");
    expect(notice).toHaveTextContent("约 2 分钟前更新");
    expect(notice.textContent ?? "").not.toMatch(FORBIDDEN);

    await clickRefresh("catalog-display-degraded-notice-refresh");
    await waitFor(() => expect(screen.queryByTestId("catalog-display-degraded-notice")).not.toBeInTheDocument());
    expect(screen.getByTestId("catalog-row-orders")).toBeInTheDocument();
  });

  it("pending: shows 正在加载… and a placeholder — never an empty state or zero rows", async () => {
    sourcesResponses = [() => reply(pendingBody, PENDING), () => reply({ ok: true, data: sourcesData })];
    stubFetch();
    renderPage(<Catalog />, "/catalog?scope=all");
    const notice = await screen.findByTestId("catalog-display-degraded-notice");
    expect(notice).toHaveTextContent("正在加载…");
    expect(notice.textContent ?? "").not.toMatch(FORBIDDEN);
    expect(screen.queryByTestId("catalog-empty-state")).not.toBeInTheDocument();
    expect(screen.queryByTestId("async-region-error")).not.toBeInTheDocument();
    expect(document.querySelectorAll('tr[data-testid^="catalog-row-"]')).toHaveLength(0);
    expect(screen.getAllByTestId("async-region-pending").length).toBeGreaterThan(0);

    await clickRefresh("catalog-display-degraded-notice-refresh");
    expect(await screen.findByTestId("catalog-row-orders")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByTestId("catalog-display-degraded-notice")).not.toBeInTheDocument());
    expect(sourcesCalls).toBeGreaterThanOrEqual(2);
  });

  it("prolonged: 长时间未更新, still a status line (not an error)", async () => {
    sourcesResponses = [() => reply({ ok: true, data: sourcesData }, { ...STALE, "X-Lucy-Display-Age-Ms": "400000", "X-Lucy-Display-Prolonged": "1" })];
    stubFetch();
    renderPage(<Catalog />, "/catalog?scope=all");
    const notice = await screen.findByTestId("catalog-display-degraded-notice");
    expect(notice).toHaveTextContent("长时间未更新");
    expect(notice).toHaveTextContent("约 6 分钟前更新");
    expect(notice).toHaveAttribute("role", "status");
    expect(await screen.findByTestId("catalog-row-orders")).toBeInTheDocument();
  });
});

describe("RoleList (角色权限)", () => {
  it("pending: loading notice instead of an empty role list, then the roles after refresh", async () => {
    let calls = 0;
    stubFetch((url) => {
      if (!url.includes("/api/admin/roles")) return undefined;
      calls += 1;
      return calls === 1
        ? reply(pendingBody, PENDING)
        : reply({ ok: true, data: { roles: [{ id: "analyst", description: "d", source: "yaml", tools: [], connections: [], sourceNames: [], sourceCount: 0, invalid: false, warnings: [], usageCount: 0, users: [], configUpdatedAt: "2026-08-04T06:32:00.000Z" }] } });
    });
    renderPage(<RoleList />, "/admin/roles");
    const notice = await screen.findByTestId("role-list-display-degraded-notice");
    expect(notice).toHaveTextContent("正在加载…");
    expect(screen.queryByTestId("role-row-analyst")).not.toBeInTheDocument();
    expect(screen.queryByTestId("role-list-load-error")).not.toBeInTheDocument();

    await clickRefresh("role-list-display-degraded-notice-refresh");
    expect(await screen.findByTestId("role-row-analyst")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByTestId("role-list-display-degraded-notice")).not.toBeInTheDocument());
  });
});

describe("TableWhitelist (启用表范围, P1-80)", () => {
  const conn: ConnectionInfo = {
    id: "c1", driver: "mysql", engine: "mysql", wireProtocol: "mysql", readOnlyExpected: true,
    schemas: ["sales"], enabledTables: ["sales.orders", "sales.ghost"]
  };

  function stubWhitelist() {
    stubFetch((url) => {
      if (url.endsWith("/api/connections")) return reply({ ok: true, data: { connections: [conn] } });
      if (url.endsWith("/api/connections/c1/tables")) return reply({ ok: true, data: { tables: ["sales.orders"], physicalNames: {} } });
      return undefined;
    });
  }

  it("stale sources: notice with the page's own copy path, 移出无效启用 stays unreachable", async () => {
    sourcesResponses = [() => reply({ ok: true, data: sourcesData }, STALE)];
    stubWhitelist();
    renderPage(<TableWhitelist />);
    const notice = await screen.findByTestId("whitelist-display-degraded-notice");
    expect(notice).toHaveTextContent("数据可能不是最新");
    const remove = await screen.findByTestId("whitelist-remove-invalid-enabled");
    expect(remove).toBeDisabled();
  });

  it("pending sources: 正在读取表清单… instead of the generic loading copy; dangerous action disabled", async () => {
    sourcesResponses = [() => reply(pendingBody, PENDING)];
    stubWhitelist();
    renderPage(<TableWhitelist />);
    const notice = await screen.findByTestId("whitelist-display-degraded-notice");
    expect(notice).toHaveTextContent("正在读取表清单…");
    expect(notice).not.toHaveTextContent("正在加载…");
    const remove = await screen.findByTestId("whitelist-remove-invalid-enabled");
    expect(remove).toBeDisabled();
  });

  it("fresh sources: the same action is enabled (主路径仍可用)", async () => {
    stubWhitelist();
    renderPage(<TableWhitelist />);
    expect(await screen.findByTestId("whitelist-remove-invalid-enabled")).toBeEnabled();
    expect(screen.queryByTestId("whitelist-display-degraded-notice")).not.toBeInTheDocument();
  });
});
