// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RemoveSchemaDrawer } from "../components/RemoveSchemaDrawer";
import type { ConnectionInfo, RemoveSchemaPreview } from "../lib/types";

function makeConn(overrides: Partial<ConnectionInfo> = {}): ConnectionInfo {
  return {
    id: "mysql-aliyun",
    driver: "mysql",
    engine: "mysql",
    wireProtocol: "mysql",
    schemas: ["dataforai", "finance_mart"],
    enabledTables: ["dataforai.superstore_orders", "finance_mart.sales"],
    ...overrides
  };
}

function makePreview(overrides: Partial<RemoveSchemaPreview> = {}): RemoveSchemaPreview {
  return {
    diff: "@@ -1 +1 @@\n-finance_mart\n",
    proposedYaml: "connections:\n  mysql-aliyun:\n    schemas:\n      - dataforai\n",
    oldSchemas: ["dataforai", "finance_mart"],
    newSchemas: ["dataforai"],
    removedEnabledTables: ["finance_mart.sales"],
    impact: {
      hasManifest: false,
      manifestPath: null,
      overlayPaths: [],
      wikiRefCount: 0,
      wikiSamplePaths: []
    },
    ...overrides
  };
}

function renderDrawer(conn: ConnectionInfo, schema: string, onClose = vi.fn()) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } }
  });
  render(
    <QueryClientProvider client={client}>
      <RemoveSchemaDrawer connection={conn} schema={schema} open onClose={onClose} />
    </QueryClientProvider>
  );
  return { client, onClose };
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
      const handler =
        handlers[key] ??
        handlers[url] ??
        handlers[`${method} ${url.replace(/^http:\/\/[^/]+/, "")}`];
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
  vi.resetAllMocks();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("RemoveSchemaDrawer", () => {
  it("auto-triggers dryRun preview on open and shows enabled count", async () => {
    stubFetch({
      "POST /api/connections/mysql-aliyun/schemas/remove": () =>
        new Response(JSON.stringify({ ok: true, data: makePreview() }))
    });

    renderDrawer(makeConn(), "finance_mart");

    await waitFor(() =>
      expect(screen.getByTestId("remove-schema-enabled-count")).toHaveTextContent("1 张")
    );
    expect(screen.getByTestId("remove-schema-confirm-btn")).toBeInTheDocument();
  });

  it("shows 'no enabled tables' when removedEnabledTables is empty", async () => {
    stubFetch({
      "POST /api/connections/mysql-aliyun/schemas/remove": () =>
        new Response(
          JSON.stringify({
            ok: true,
            data: makePreview({ removedEnabledTables: [] })
          })
        )
    });

    renderDrawer(makeConn(), "finance_mart");

    await waitFor(() =>
      expect(screen.getByTestId("remove-schema-enabled-count")).toHaveTextContent("无")
    );
  });

  it("shows wiki ref count from impact", async () => {
    stubFetch({
      "POST /api/connections/mysql-aliyun/schemas/remove": () =>
        new Response(
          JSON.stringify({
            ok: true,
            data: makePreview({
              impact: {
                hasManifest: false,
                manifestPath: null,
                overlayPaths: [],
                wikiRefCount: 3,
                wikiSamplePaths: ["wiki/page1.md", "wiki/page2.md", "wiki/page3.md"]
              }
            })
          })
        )
    });

    renderDrawer(makeConn(), "finance_mart");

    await waitFor(() =>
      expect(screen.getByTestId("remove-schema-wiki-count")).toHaveTextContent("3")
    );
  });

  it("shows success state and toast message after confirmed removal", async () => {
    let callCount = 0;
    stubFetch({
      "POST /api/connections/mysql-aliyun/schemas/remove": (body) => {
        callCount++;
        const b = body as { dryRun?: boolean };
        if (b.dryRun !== false) {
          return new Response(JSON.stringify({ ok: true, data: makePreview() }));
        }
        return new Response(
          JSON.stringify({
            ok: true,
            data: {
              written: true,
              auditId: 1,
              oldSchemas: ["dataforai", "finance_mart"],
              newSchemas: ["dataforai"],
              removedEnabledTables: ["finance_mart.sales"],
              deletedFiles: []
            }
          })
        );
      },
      "GET /api/catalog/reloads": () =>
        new Response(JSON.stringify({ ok: true, data: { runs: [], lastByConnection: {} } }))
    });

    renderDrawer(makeConn(), "finance_mart");

    await waitFor(() => expect(screen.getByTestId("remove-schema-confirm-btn")).toBeInTheDocument());

    screen.getByTestId("remove-schema-confirm-btn").click();

    await waitFor(() =>
      expect(screen.getByTestId("remove-schema-success-message")).toBeInTheDocument()
    );
    expect(callCount).toBeGreaterThanOrEqual(2);
  });

  it("shows error panel when preview fails", async () => {
    stubFetch({
      "POST /api/connections/mysql-aliyun/schemas/remove": () =>
        new Response(
          JSON.stringify({
            ok: false,
            error: { code: "SCHEMA_NOT_FOUND", message: "schema not found" }
          }),
          { status: 404 }
        )
    });

    renderDrawer(makeConn(), "no_such_schema");

    await waitFor(() =>
      expect(screen.getByRole("alert")).toBeInTheDocument()
    );
  });

  it("checkboxes default to unchecked", async () => {
    stubFetch({
      "POST /api/connections/mysql-aliyun/schemas/remove": () =>
        new Response(
          JSON.stringify({
            ok: true,
            data: makePreview({
              impact: {
                hasManifest: true,
                manifestPath: "semantic-layer/mysql-aliyun/_schema/finance_mart.yaml",
                overlayPaths: ["semantic-layer/mysql-aliyun/sales.yaml"],
                wikiRefCount: 0,
                wikiSamplePaths: []
              }
            })
          })
        )
    });

    renderDrawer(makeConn(), "finance_mart");

    await waitFor(() =>
      expect(screen.getByTestId("remove-schema-delete-manifest-checkbox")).toBeInTheDocument()
    );
    expect(screen.getByTestId("remove-schema-delete-manifest-checkbox")).not.toBeChecked();
    expect(screen.getByTestId("remove-schema-delete-overlays-checkbox")).not.toBeChecked();
  });

  it("drawer has data-testid remove-schema-drawer", async () => {
    stubFetch({
      "POST /api/connections/mysql-aliyun/schemas/remove": () =>
        new Response(JSON.stringify({ ok: true, data: makePreview() }))
    });

    renderDrawer(makeConn(), "finance_mart");
    expect(screen.getByTestId("remove-schema-drawer")).toBeInTheDocument();
  });
});
