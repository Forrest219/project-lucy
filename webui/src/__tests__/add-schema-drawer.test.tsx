// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AddSchemaDrawer } from "../components/AddSchemaDrawer";
import type { ConnectionInfo } from "../lib/types";

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

function renderDrawer(conn: ConnectionInfo, onClose = vi.fn()) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } }
  });
  render(
    <QueryClientProvider client={client}>
      <AddSchemaDrawer connection={conn} open onClose={onClose} />
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
        return new Response(JSON.stringify({ ok: false, error: { code: "NOT_FOUND", message: key } }), { status: 404 });
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

describe("AddSchemaDrawer", () => {
  it("blocks and explains an empty schema name", () => {
    renderDrawer(makeConn());

    expect(screen.getByTestId("add-schema-preview-btn")).toBeDisabled();
    expect(screen.getByTestId("add-schema-input-error")).toHaveTextContent("Schema 名不能为空");
  });

  it("blocks invalid schema names before sending the dryRun request", async () => {
    renderDrawer(makeConn());

    const input = screen.getByTestId("add-schema-input") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "1bad" } });

    const next = screen.getByTestId("add-schema-preview-btn") as HTMLButtonElement;
    expect(next).toBeDisabled();
    expect(screen.getByTestId("add-schema-input-error")).toBeInTheDocument();

    fireEvent.change(input, { target: { value: "finance_mart" } });
    await waitFor(() => expect(next).not.toBeDisabled());
  });

  it("shows the diff and confirm step on a successful dryRun", async () => {
    stubFetch({
      "POST /api/connections/mysql-aliyun/schemas": (body) => {
        if ((body as { dryRun?: boolean }).dryRun === false) {
          return new Response(
            JSON.stringify({
              ok: true,
              data: { written: true, auditId: 7, oldSchemas: ["dataforai"], newSchemas: ["dataforai", "finance_mart"] }
            })
          );
        }
        return new Response(
          JSON.stringify({
            ok: true,
            data: {
              diff: "@@ -1 +1 @@\n-    - dataforai\n+    - finance_mart\n",
              proposedYaml: "connections:\n  mysql-aliyun:\n    schemas:\n      - dataforai\n      - finance_mart\n",
              oldSchemas: ["dataforai"],
              newSchemas: ["dataforai", "finance_mart"]
            }
          })
        );
      }
    });

    renderDrawer(makeConn());

    fireEvent.change(screen.getByTestId("add-schema-input"), { target: { value: "finance_mart" } });
    fireEvent.click(screen.getByTestId("add-schema-preview-btn"));

    // The "确认写入" CTA only appears once we are in the preview step.
    await waitFor(() => {
      expect(screen.getByTestId("add-schema-confirm-btn")).toBeInTheDocument();
    });
    // The diff viewer should show the new schema name at least once.
    expect(screen.getAllByText(/finance_mart/).length).toBeGreaterThan(0);

    fireEvent.click(screen.getByTestId("add-schema-confirm-btn"));

    await waitFor(() => {
      expect(screen.getByText(/已添加 schema/)).toBeInTheDocument();
    });
  });

  it("surfaces SCHEMA_ALREADY_EXISTS and never shows a success message", async () => {
    stubFetch({
      "POST /api/connections/mysql-aliyun/schemas": () =>
        new Response(
          JSON.stringify({ ok: false, error: { code: "SCHEMA_ALREADY_EXISTS", message: "duplicate" } }),
          { status: 409 }
        )
    });

    renderDrawer(makeConn());

    fireEvent.change(screen.getByTestId("add-schema-input"), { target: { value: "dataforai" } });
    fireEvent.click(screen.getByTestId("add-schema-preview-btn"));

    await waitFor(() => {
      expect(screen.getByText(/SCHEMA_ALREADY_EXISTS/)).toBeInTheDocument();
    });
    expect(screen.queryByText(/已添加 schema/)).not.toBeInTheDocument();
  });

  it("renders CONNECTION_TEST_FAILED detail when the write path rejects", async () => {
    stubFetch({
      "POST /api/connections/mysql-aliyun/schemas": (body) => {
        if ((body as { dryRun?: boolean }).dryRun === false) {
          return new Response(
            JSON.stringify({
              ok: false,
              error: {
                code: "CONNECTION_TEST_FAILED",
                message: "ktx connection test failed",
                detail: { stdout: "", stderr: "auth failed", reason: "auth failed" }
              }
            }),
            { status: 400 }
          );
        }
        return new Response(
          JSON.stringify({
            ok: true,
            data: {
              diff: "@@ -1 +1 @@\n-    - dataforai\n+    - finance_mart\n",
              proposedYaml: "schemas:\n  - dataforai\n  - finance_mart\n",
              oldSchemas: ["dataforai"],
              newSchemas: ["dataforai", "finance_mart"]
            }
          })
        );
      }
    });

    renderDrawer(makeConn());

    fireEvent.change(screen.getByTestId("add-schema-input"), { target: { value: "finance_mart" } });
    fireEvent.click(screen.getByTestId("add-schema-preview-btn"));

    await waitFor(() => screen.getByTestId("add-schema-confirm-btn"));
    fireEvent.click(screen.getByTestId("add-schema-confirm-btn"));

    await waitFor(() => {
      expect(screen.getByText(/CONNECTION_TEST_FAILED/)).toBeInTheDocument();
    });
    expect(screen.queryByText(/已添加 schema/)).not.toBeInTheDocument();
  });

  it("collapses CONNECTION_TEST_FAILED ktx output behind a toggle button", async () => {
    stubFetch({
      "POST /api/connections/mysql-aliyun/schemas": (body) => {
        if ((body as { dryRun?: boolean }).dryRun === false) {
          return new Response(
            JSON.stringify({
              ok: false,
              error: {
                code: "CONNECTION_TEST_FAILED",
                message: "ktx connection test failed",
                detail: { stdout: "", stderr: "auth failed", reason: "auth failed" }
              }
            }),
            { status: 400 }
          );
        }
        return new Response(
          JSON.stringify({
            ok: true,
            data: {
              diff: "@@ -1 +1 @@\n-    - dataforai\n+    - finance_mart\n",
              proposedYaml: "schemas:\n  - dataforai\n  - finance_mart\n",
              oldSchemas: ["dataforai"],
              newSchemas: ["dataforai", "finance_mart"]
            }
          })
        );
      }
    });

    renderDrawer(makeConn());

    fireEvent.change(screen.getByTestId("add-schema-input"), { target: { value: "finance_mart" } });
    fireEvent.click(screen.getByTestId("add-schema-preview-btn"));
    await waitFor(() => screen.getByTestId("add-schema-confirm-btn"));
    fireEvent.click(screen.getByTestId("add-schema-confirm-btn"));

    const toggle = await screen.findByRole("button", { name: /Show ktx output|查看 ktx 输出/ });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByTestId("ktx-output-detail")).not.toBeInTheDocument();

    fireEvent.click(toggle);
    expect(await screen.findByTestId("ktx-output-detail")).toBeInTheDocument();
    expect(toggle).toHaveAttribute("aria-expanded", "true");
  });

  it("renders as a right-side slide-over drawer instead of a centered modal", () => {
    renderDrawer(makeConn());

    const drawer = screen.getByTestId("add-schema-drawer");
    expect(drawer).toHaveClass("pl-drawer-panel");
    expect(drawer).not.toHaveClass("pl-modal-panel");
    const backdrop = screen.getByTestId("add-schema-drawer-backdrop");
    expect(backdrop).toHaveClass("pl-drawer-backdrop");
    expect(backdrop).not.toHaveClass("pl-modal-backdrop");
  });

  it("labels the three steps with side-effect names", () => {
    renderDrawer(makeConn());

    expect(screen.getByText("1. 输入 Schema")).toBeInTheDocument();
    expect(screen.getByText("2. 测试并预览")).toBeInTheDocument();
    expect(screen.getByText("3. 确认并 ingest")).toBeInTheDocument();
  });

  it("uses the postgres-aware field label", () => {
    renderDrawer(makeConn({ engine: "postgres", id: "pg-main" }));
    expect(screen.getByText(/^Schema 名$/)).toBeInTheDocument();
  });

  it("invalidates catalog caches after a successful ingest", async () => {
    stubFetch({
      "POST /api/connections/mysql-aliyun/schemas": (body) => {
        if ((body as { dryRun?: boolean }).dryRun === false) {
          return new Response(JSON.stringify({
            ok: true,
            data: {
              written: true,
              auditId: 7,
              oldSchemas: ["dataforai"],
              newSchemas: ["dataforai", "finance_mart"]
            }
          }));
        }
        return new Response(JSON.stringify({
          ok: true,
          data: {
            diff: "+      - finance_mart\n",
            proposedYaml: "schemas:\n  - dataforai\n  - finance_mart\n",
            oldSchemas: ["dataforai"],
            newSchemas: ["dataforai", "finance_mart"]
          }
        }));
      },
      "POST /api/connections/mysql-aliyun/ingest": () =>
        new Response(JSON.stringify({
          ok: true,
          data: { exitCode: 0, stdout: "ok", stderr: "" }
        }))
    });

    const { client } = renderDrawer(makeConn());
    const invalidate = vi.spyOn(client, "invalidateQueries");
    fireEvent.change(screen.getByTestId("add-schema-input"), { target: { value: "finance_mart" } });
    fireEvent.click(screen.getByTestId("add-schema-preview-btn"));
    await waitFor(() => screen.getByTestId("add-schema-confirm-btn"));
    fireEvent.click(screen.getByTestId("add-schema-confirm-btn"));
    await waitFor(() => screen.getByText("现在 ingest"));
    invalidate.mockClear();
    fireEvent.click(screen.getByText("现在 ingest"));

    await waitFor(() => {
      expect(invalidate).toHaveBeenCalledWith({ queryKey: ["project"] });
      expect(invalidate).toHaveBeenCalledWith({ queryKey: ["connections"] });
      expect(invalidate).toHaveBeenCalledWith({ queryKey: ["sources"] });
      expect(invalidate).toHaveBeenCalledWith({
        queryKey: ["connections", "mysql-aliyun", "tables"]
      });
    });
  });

  it("uses the MySQL/Doris/StarRocks-aware field label", () => {
    renderDrawer(makeConn({ engine: "mysql" }));
    expect(screen.getByText(/Schema 或 database 名/)).toBeInTheDocument();
  });
});
