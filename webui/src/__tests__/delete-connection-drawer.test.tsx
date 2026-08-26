// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DeleteConnectionDrawer } from "../components/DeleteConnectionDrawer";
import type { ConnectionInfo, DeleteConnectionPreview } from "../lib/types";

function makeConn(overrides: Partial<ConnectionInfo> = {}): ConnectionInfo {
  return {
    id: "mysql-aliyun",
    driver: "mysql",
    engine: "mysql",
    wireProtocol: "mysql",
    schemas: ["dataforai"],
    enabledTables: ["dataforai.superstore_orders"],
    ...overrides
  };
}

function makePreview(overrides: Partial<DeleteConnectionPreview> = {}): DeleteConnectionPreview {
  return {
    diff: "@@ -1 +1 @@\n-mysql-aliyun\n",
    proposedYaml: "connections:\n  keep-me: {}\n",
    connectionId: "mysql-aliyun",
    schemas: ["dataforai"],
    enabledTables: ["dataforai.superstore_orders"],
    impact: {
      canDeleteSecret: false,
      secretRelPath: null,
      yamlAssetPaths: [],
      aclRoleIds: [],
      wikiRefCount: 0,
      wikiSamplePaths: []
    },
    ...overrides
  };
}

function renderDrawer(conn: ConnectionInfo, onClose = vi.fn()) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } }
  });
  render(
    <QueryClientProvider client={client}>
      <DeleteConnectionDrawer connection={conn} open onClose={onClose} />
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

describe("DeleteConnectionDrawer", () => {
  it("auto-triggers dryRun preview and keeps confirm disabled until the connection ID is typed", async () => {
    stubFetch({
      "POST /api/connections/mysql-aliyun/remove": () =>
        new Response(JSON.stringify({ ok: true, data: makePreview() }))
    });

    renderDrawer(makeConn());

    await waitFor(() =>
      expect(screen.getByTestId("delete-connection-enabled-count")).toHaveTextContent("1 张")
    );
    expect(screen.getByTestId("delete-connection-id")).toHaveTextContent("mysql-aliyun");
    expect(screen.getByTestId("delete-connection-confirm-id")).toHaveAttribute("placeholder", "mysql-aliyun");
    expect(screen.getByTestId("delete-connection-confirm-btn")).toBeDisabled();

    fireEvent.change(screen.getByTestId("delete-connection-confirm-id"), {
      target: { value: "mysql-aliyun" }
    });
    expect(screen.getByTestId("delete-connection-confirm-btn")).toBeEnabled();
  });

  it("checkboxes default to unchecked and secret is disabled when not eligible", async () => {
    stubFetch({
      "POST /api/connections/mysql-aliyun/remove": () =>
        new Response(
          JSON.stringify({
            ok: true,
            data: makePreview({
              impact: {
                canDeleteSecret: false,
                secretRelPath: null,
                yamlAssetPaths: ["semantic-layer/mysql-aliyun/_schema/dataforai.yaml"],
                aclRoleIds: ["finance_readonly"],
                wikiRefCount: 2,
                wikiSamplePaths: ["wiki/global/playbook.md"]
              }
            })
          })
        )
    });

    renderDrawer(makeConn());

    await waitFor(() =>
      expect(screen.getByTestId("delete-connection-acl-count")).toHaveTextContent("1 个")
    );
    expect(screen.getByTestId("delete-connection-secret-checkbox")).toBeDisabled();
    expect(screen.getByTestId("delete-connection-assets-checkbox")).not.toBeChecked();
    expect(screen.getByTestId("delete-connection-wiki-count")).toHaveTextContent("2");
  });

  it("shows success after confirmed delete", async () => {
    let callCount = 0;
    stubFetch({
      "POST /api/connections/mysql-aliyun/remove": (body) => {
        callCount++;
        const parsed = body as { dryRun?: boolean };
        if (parsed.dryRun !== false) {
          return new Response(JSON.stringify({ ok: true, data: makePreview() }));
        }
        return new Response(
          JSON.stringify({
            ok: true,
            data: { written: true, auditId: 1, connectionId: "mysql-aliyun", deletedFiles: [] }
          })
        );
      }
    });

    renderDrawer(makeConn());
    await waitFor(() => expect(screen.getByTestId("delete-connection-confirm-btn")).toBeInTheDocument());
    fireEvent.change(screen.getByTestId("delete-connection-confirm-id"), {
      target: { value: "mysql-aliyun" }
    });
    fireEvent.click(screen.getByTestId("delete-connection-confirm-btn"));

    await waitFor(() =>
      expect(screen.getByTestId("delete-connection-success-message")).toBeInTheDocument()
    );
    expect(callCount).toBeGreaterThanOrEqual(2);
  });
});
