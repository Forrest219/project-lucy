// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CatalogReloadButton,
  CatalogReloadLastRunBadge,
  CatalogReloadResultPanel
} from "../components/catalog";
import type { CatalogReloadRun } from "../lib/types";

function makeRun(overrides: Partial<CatalogReloadRun> = {}): CatalogReloadRun {
  return {
    id: "rel_20260729_103000_001",
    status: "success",
    startedAt: "2026-07-29T02:30:00.000Z",
    finishedAt: "2026-07-29T02:30:00.045Z",
    durationMs: 45,
    requestedConnectionId: "demo-mysql",
    connectionIds: ["demo-mysql"],
    connections: 1,
    configuredSchemas: 2,
    manifestSchemas: 1,
    tables: 3,
    enabledTables: 3,
    warnings: [],
    source: "static-yaml",
    ...overrides
  };
}

function renderWithClient(node: React.ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } }
  });
  render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
  return client;
}

function stubFetch(handlers: Record<string, (body: unknown) => Response>) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      let body: unknown = undefined;
      if (typeof init?.body === "string") {
        try {
          body = JSON.parse(init.body);
        } catch {
          body = init.body;
        }
      }
      const key = `${method} ${url}`;
      const handler = handlers[key] ?? handlers[url];
      if (!handler) {
        return new Response(
          JSON.stringify({ ok: false, error: { code: "NOT_FOUND", message: key } }),
          { status: 404 }
        );
      }
      return handler(body);
    })
  );
}

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("CatalogReloadButton", () => {
  it("POSTs to /api/catalog/reload with empty body when no connectionId is given", async () => {
    const onReloadComplete = vi.fn();
    stubFetch({
      "POST /api/catalog/reload": (body) => {
        expect(body).toEqual({});
        return new Response(JSON.stringify({ ok: true, data: makeRun() }));
      }
    });
    const client = renderWithClient(
      <CatalogReloadButton onReloadComplete={onReloadComplete} />
    );
    const invalidate = vi.spyOn(client, "invalidateQueries");

    fireEvent.click(screen.getByTestId("catalog-reload"));
    await waitFor(() => expect(onReloadComplete).toHaveBeenCalled());
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["project"] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["connections"] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["sources"] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["catalog", "reloads"] });
  });

  it("forwards connectionId and schema in the request body when provided", async () => {
    stubFetch({
      "POST /api/catalog/reload": (body) => {
        expect(body).toEqual({ connectionId: "demo-mysql", schema: "openclaw_db" });
        return new Response(JSON.stringify({ ok: true, data: makeRun() }));
      }
    });
    renderWithClient(
      <CatalogReloadButton connectionId="demo-mysql" schema="openclaw_db" />
    );

    fireEvent.click(screen.getByTestId("catalog-reload"));
    await waitFor(() => screen.getByText(/完成/));
  });

  it("invalidates connectionTables for the targeted connection", async () => {
    stubFetch({
      "POST /api/catalog/reload": () =>
        new Response(JSON.stringify({ ok: true, data: makeRun() }))
    });
    const client = renderWithClient(
      <CatalogReloadButton connectionId="demo-mysql" />
    );
    const invalidate = vi.spyOn(client, "invalidateQueries");

    fireEvent.click(screen.getByTestId("catalog-reload"));
    await waitFor(() => {
      expect(invalidate).toHaveBeenCalledWith({
        queryKey: ["connections", "demo-mysql", "tables"]
      });
    });
  });

  it("renders warning list when the run returns warnings", async () => {
    stubFetch({
      "POST /api/catalog/reload": () =>
        new Response(
          JSON.stringify({
            ok: true,
            data: makeRun({
              warnings: [
                {
                  code: "SCHEMA_MANIFEST_MISSING",
                  connectionId: "demo-mysql",
                  schema: "openclaw_db",
                  filePath: "semantic-layer/demo-mysql/_schema/openclaw_db.yaml",
                  message: "openclaw_db 未在本地 manifest 中。"
                }
              ]
            })
          })
        )
    });
    renderWithClient(<CatalogReloadButton connectionId="demo-mysql" />);

    fireEvent.click(screen.getByTestId("catalog-reload"));

    expect(
      await screen.findByTestId("catalog-reload-warnings")
    ).toHaveTextContent("openclaw_db");
    expect(screen.getByText(/1 个提示/)).toBeInTheDocument();
  });

  it("uses a custom label and testId when provided", async () => {
    stubFetch({
      "POST /api/catalog/reload": () =>
        new Response(JSON.stringify({ ok: true, data: makeRun() }))
    });
    renderWithClient(
      <CatalogReloadButton
        connectionId="demo-mysql"
        label="刷新本地表目录"
        testId="whitelist-reload-catalog"
      />
    );

    expect(screen.getByTestId("whitelist-reload-catalog")).toHaveTextContent("刷新本地表目录");
  });

  it("defaults the label to 重新加载本地资产 when no label is provided", () => {
    stubFetch({});
    renderWithClient(<CatalogReloadButton />);
    expect(screen.getByTestId("catalog-reload")).toHaveTextContent("重新加载本地资产");
  });
});

describe("CatalogReloadResultPanel", () => {
  it("renders counts and the requested scope", () => {
    const run = makeRun({
      tables: 5,
      enabledTables: 4,
      configuredSchemas: 3,
      manifestSchemas: 2,
      warnings: [
        {
          code: "SCHEMA_MANIFEST_MISSING",
          connectionId: "demo-mysql",
          schema: "openclaw_db",
          message: "openclaw_db manifest missing"
        }
      ]
    });
    renderWithClient(<CatalogReloadResultPanel run={run} />);

    expect(screen.getByTestId("catalog-reload-result-success")).toHaveTextContent("5 张表");
    expect(screen.getByTestId("catalog-reload-result-success")).toHaveTextContent("4 已启用");
    expect(screen.getByTestId("catalog-reload-result-success")).toHaveTextContent("2 / 3 schemas");
    expect(screen.getByText("openclaw_db manifest missing")).toBeInTheDocument();
  });

  it("does not render when the run is missing", () => {
    renderWithClient(<CatalogReloadResultPanel run={null} />);
    expect(screen.queryByTestId("catalog-reload-result")).toBeNull();
  });
});

describe("CatalogReloadLastRunBadge", () => {
  it("renders the never-run copy when no run is supplied", () => {
    renderWithClient(<CatalogReloadLastRunBadge />);
    expect(screen.getByText(/上次 Reload：未运行/)).toBeInTheDocument();
  });

  it("renders the success copy with table count when the run succeeded without warnings", () => {
    const run = makeRun({ status: "success", tables: 5 });
    renderWithClient(<CatalogReloadLastRunBadge run={run} />);
    expect(screen.getByText(/上次 Reload/)).toHaveTextContent("成功");
    expect(screen.getByText(/上次 Reload/)).toHaveTextContent("5 张表");
  });

  it("renders a warning copy when the run has warnings", () => {
    const run = makeRun({
      status: "success",
      tables: 2,
      warnings: [
        {
          code: "SCHEMA_MANIFEST_MISSING",
          connectionId: "demo-mysql",
          schema: "openclaw_db",
          message: "missing"
        },
        {
          code: "ENABLED_TABLE_NOT_SCANNED",
          connectionId: "demo-mysql",
          table: "dataforai.unknown",
          message: "enabled table not scanned"
        }
      ]
    });
    renderWithClient(<CatalogReloadLastRunBadge run={run} />);
    expect(screen.getByText(/上次 Reload/)).toHaveTextContent("2 个提示");
  });
});
