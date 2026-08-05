// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
  it("blocks an empty schema name without showing an immediate error", () => {
    renderDrawer(makeConn());

    expect(screen.getByTestId("add-schema-preview-btn")).toBeDisabled();
    expect(screen.queryByTestId("add-schema-input-error")).not.toBeInTheDocument();
  });

  it("explains an empty schema name after the field is touched", () => {
    renderDrawer(makeConn());

    fireEvent.blur(screen.getByTestId("add-schema-input"));
    expect(screen.getByTestId("add-schema-input-error")).toHaveTextContent("Schema 名不能为空");
  });

  it("blocks invalid schema names before sending the dryRun request", async () => {
    renderDrawer(makeConn());

    const input = screen.getByTestId("add-schema-input") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "1bad" } });

    const next = screen.getByTestId("add-schema-preview-btn") as HTMLButtonElement;
    expect(next).toBeDisabled();
    expect(screen.queryByTestId("add-schema-input-error")).not.toBeInTheDocument();
    fireEvent.blur(input);
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
      expect(screen.getByText(/已添加 Schema/)).toBeInTheDocument();
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
    expect(screen.getByTestId("add-schema-close")).toHaveClass("pl-drawer-close");
    expect(screen.getByRole("list", { name: "步骤" })).toHaveClass("pl-steps");
    expect(screen.getByText("输入 Schema").closest("li")).toHaveAttribute("aria-current", "step");
  });

  it("M47: keeps the first Add Schema step concise without repeated connection-test copy", () => {
    renderDrawer(makeConn());

    expect(
      screen.getByText((_, element) =>
        Boolean(
          element &&
            element.classList?.contains("pl-notice") &&
            element.textContent?.includes("添加后会写入") &&
            element.textContent?.includes("下一步将先验证连接权限")
        )
      )
    ).toBeInTheDocument();
    expect(screen.queryByText("数据接入")).not.toBeInTheDocument();
    expect(screen.queryByText(/添加前会自动调用/)).not.toBeInTheDocument();
    expect(screen.queryByText(/ktx connection test mysql-aliyun/)).not.toBeInTheDocument();
    expect(screen.queryByText(/不会扫描物理数据库/)).not.toBeInTheDocument();
    expect(screen.queryByText(/不会触碰凭据/)).not.toBeInTheDocument();
  });

  it("uses a stable Schema label and Postgres helper text", () => {
    renderDrawer(makeConn({ engine: "postgres", id: "pg-main" }));
    expect(screen.getByText("Schema 名称")).toBeInTheDocument();
    expect(screen.queryByText(/Schema 或 database 名/)).not.toBeInTheDocument();
    expect(screen.getByText(/PostgreSQL 中请填写 schema，不是 database/)).toBeInTheDocument();
  });

  it("after a successful add, surfaces the static loading hint and the reload-catalog button, no ingest CTA", async () => {
    const fetchMock = vi.fn();
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
      "POST /api/catalog/reload": () => {
        fetchMock("/api/catalog/reload");
        return new Response(JSON.stringify({
          ok: true,
          data: {
            id: "rel_20260729_103000_001",
            status: "success",
            startedAt: "2026-07-29T02:30:00.000Z",
            finishedAt: "2026-07-29T02:30:00.045Z",
            durationMs: 45,
            requestedConnectionId: "mysql-aliyun",
            requestedSchema: "finance_mart",
            connectionIds: ["mysql-aliyun"],
            connections: 1,
            configuredSchemas: 2,
            manifestSchemas: 1,
            tables: 4,
            enabledTables: 4,
            warnings: [],
            source: "static-yaml"
          }
        }));
      }
    });
    // Re-stub with the spy after stubFetch so we also count calls.
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
          {
            "POST /api/connections/mysql-aliyun/schemas": () => {
              if ((body as { dryRun?: boolean }).dryRun === false) {
                return new Response(JSON.stringify({
                  ok: true,
                  data: { written: true, auditId: 7, oldSchemas: ["dataforai"], newSchemas: ["dataforai", "finance_mart"] }
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
            "POST /api/catalog/reload": () => {
              fetchMock(url, init);
              return new Response(JSON.stringify({
                ok: true,
                data: {
                  id: "rel_20260729_103000_001",
                  status: "success",
                  startedAt: "2026-07-29T02:30:00.000Z",
                  finishedAt: "2026-07-29T02:30:00.045Z",
                  durationMs: 45,
                  requestedConnectionId: "mysql-aliyun",
                  requestedSchema: "finance_mart",
                  connectionIds: ["mysql-aliyun"],
                  connections: 1,
                  configuredSchemas: 2,
                  manifestSchemas: 1,
                  tables: 4,
                  enabledTables: 4,
                  warnings: [],
                  source: "static-yaml"
                }
              }));
            }
          }[key] ?? (() => new Response(JSON.stringify({ ok: false, error: { code: "NOT_FOUND", message: key } }), { status: 404 }));
        return handler();
      })
    );

    const { client } = renderDrawer(makeConn());
    const invalidate = vi.spyOn(client, "invalidateQueries");
    fireEvent.change(screen.getByTestId("add-schema-input"), { target: { value: "finance_mart" } });
    fireEvent.click(screen.getByTestId("add-schema-preview-btn"));
    await waitFor(() => screen.getByTestId("add-schema-confirm-btn"));
    fireEvent.click(screen.getByTestId("add-schema-confirm-btn"));

    // Static loading hint and reload button appear; no ingest wording.
    await waitFor(() => screen.getByTestId("add-schema-reload-catalog"));
    expect(screen.getByTestId("add-schema-static-loading-hint")).toHaveTextContent(/semantic-layer/);
    expect(screen.queryByText(/现在 ingest/)).not.toBeInTheDocument();
    expect(screen.queryByText(/ingest 中/)).not.toBeInTheDocument();
    // M25: success step surfaces the Schema Manifest upload next step + the "added"
    // copy in the prescribed format.
    expect(
      screen.getByText(/已添加 Schema：finance_mart/)
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "上传 Schema Manifest" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "同步配置变更" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /ingest/i })).not.toBeInTheDocument();

    // No request to /ingest at any point.
    const ingestCalls = (await vi.mocked(global.fetch).mock.calls).filter((call) =>
      String(call[0]).includes("/ingest")
    );
    expect(ingestCalls).toHaveLength(0);

    // Click reload and verify it posts to /api/catalog/reload with the
    // connectionId + schema.
    fireEvent.click(screen.getByTestId("add-schema-reload-catalog"));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const reloadCall = fetchMock.mock.calls[0];
    expect(String(reloadCall?.[0])).toBe("/api/catalog/reload");
    expect(reloadCall?.[1]?.body).toBe(
      JSON.stringify({ connectionId: "mysql-aliyun", schema: "finance_mart" })
    );

    // Catalog cache keys invalidated.
    await waitFor(() => {
      expect(invalidate).toHaveBeenCalledWith({ queryKey: ["catalog", "reloads"] });
      expect(invalidate).toHaveBeenCalledWith({ queryKey: ["project"] });
      expect(invalidate).toHaveBeenCalledWith({ queryKey: ["connections"] });
      expect(invalidate).toHaveBeenCalledWith({ queryKey: ["sources"] });
      expect(invalidate).toHaveBeenCalledWith({
        queryKey: ["connections", "mysql-aliyun", "tables"]
      });
    });
  });

  it("uses a stable Schema label and MySQL helper text", () => {
    renderDrawer(makeConn({ engine: "mysql" }));
    expect(screen.getByText("Schema 名称")).toBeInTheDocument();
    expect(screen.queryByText(/Schema 或 database 名/)).not.toBeInTheDocument();
    expect(screen.getByText(/MySQL 中通常对应 database 名/)).toBeInTheDocument();
  });

  it("Spec 107: prefers selecting a live Schema candidate over typing", async () => {
    stubFetch({
      "GET /api/connections/mysql-aliyun/live-schemas": () =>
        new Response(
          JSON.stringify({
            ok: true,
            data: {
              status: "ok",
              connectionId: "mysql-aliyun",
              schemas: [
                { schema: "dataforai", tableCount: 28 },
                { schema: "openclaw_db", tableCount: 9 },
                { schema: "finance_mart", tableCount: 3 }
              ],
              fetchedAt: "2026-08-06T00:00:00.000Z",
              cached: false,
              wireProtocol: "mysql"
            }
          })
        )
    });
    renderDrawer(makeConn());

    const select = await screen.findByTestId("add-schema-select");
    expect(select).toBeInTheDocument();
    expect(screen.queryByTestId("add-schema-input")).not.toBeInTheDocument();
    expect(screen.getByText("选择 Schema")).toBeInTheDocument();
    expect(within(select).getByRole("option", { name: "openclaw_db（9 张表）" })).toBeInTheDocument();
    expect(within(select).queryByRole("option", { name: /dataforai/ })).not.toBeInTheDocument();

    fireEvent.change(select, { target: { value: "openclaw_db" } });
    expect(screen.getByTestId("add-schema-preview-btn")).not.toBeDisabled();

    fireEvent.click(screen.getByTestId("add-schema-manual-toggle"));
    expect(screen.getByTestId("add-schema-input")).toBeInTheDocument();
    expect(screen.getByTestId("add-schema-select-toggle")).toBeInTheDocument();
  });
});

