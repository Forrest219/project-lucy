// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CreateConnectionDrawer } from "../components/CreateConnectionDrawer";
import { TableWhitelist } from "../pages/connections/TableWhitelist";
import type { ConnectionInfo, SourceSummary } from "../lib/types";

/**
 * P1-64／REQ-030-085 Task 5 / SC-10 — WebUI must not toast unconditional success
 * when runtimeAck !== true (incl. missing) after enabled-tables or connection create.
 */

const toastMocks = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  warning: vi.fn()
}));

vi.mock("sonner", () => ({
  toast: {
    success: toastMocks.success,
    error: toastMocks.error,
    warning: toastMocks.warning
  }
}));

const TEST_CONN: ConnectionInfo = {
  id: "mysql-aliyun",
  driver: "mysql",
  engine: "mysql",
  wireProtocol: "mysql",
  readOnlyExpected: true,
  schemas: ["dataforai"],
  enabledTables: ["dataforai.superstore_orders", "dataforai.superstore_people"]
};

const TEST_TABLES = [
  "dataforai.superstore_orders",
  "dataforai.superstore_people",
  "dataforai.superstore_returns"
];

function makeSource(table: string): SourceSummary {
  return {
    conn: "mysql-aliyun",
    schema: "dataforai",
    table,
    qualifiedName: `dataforai.${table}`,
    filePath: "",
    columnCount: 1,
    columnNames: [],
    hasTableDesc: false,
    hasGrain: false,
    measureCount: 0,
    joinCount: 0,
    wikiRefCount: 0,
    completion: "not_started",
    mtime: "",
    enabled: true,
    authorizedAgentCount: 0,
    semanticUpdatedAt: "2026-06-15T08:00:00.000Z",
    semanticUpdatedAtSource: "manifest"
  };
}

type Handler = (body: unknown) => Response;

function stubFetch(handlers: Record<string, Handler>) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input).replace(/^http:\/\/[^/]+/, "");
      const method = init?.method ?? "GET";
      let body: unknown;
      if (typeof init?.body === "string") {
        try {
          body = JSON.parse(init.body);
        } catch {
          body = init.body;
        }
      }
      const key = `${method} ${url}`;
      const handler = handlers[key];
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

function whitelistHandlers(writeOverride?: Record<string, unknown>): Record<string, Handler> {
  const persisted = [...TEST_CONN.enabledTables];
  return {
    "GET /api/connections": () =>
      new Response(JSON.stringify({ ok: true, data: { connections: [TEST_CONN] } })),
    "GET /api/project": () =>
      new Response(
        JSON.stringify({
          ok: true,
          data: { root: "/tmp/project-lucy", ktxAvailable: true, connections: [TEST_CONN] }
        })
      ),
    "GET /api/sources": () =>
      new Response(
        JSON.stringify({
          ok: true,
          data: {
            tables: [
              makeSource("superstore_orders"),
              makeSource("superstore_people"),
              makeSource("superstore_returns")
            ]
          }
        })
      ),
    "GET /api/connections/mysql-aliyun/tables": () =>
      new Response(JSON.stringify({ ok: true, data: { tables: TEST_TABLES, physicalNames: {} } })),
    "PUT /api/connections/mysql-aliyun/enabled-tables": (body) => {
      const b = body as { dryRun?: boolean; enabledTables?: string[] };
      if (b.dryRun === true) {
        return new Response(
          JSON.stringify({
            ok: true,
            data: {
              diff: "+ dataforai.superstore_returns\n",
              proposedYaml: "connections:\n  mysql-aliyun:\n    enabled_tables: []\n",
              oldEnabledTables: persisted,
              newEnabledTables: b.enabledTables ?? [],
              warnings: []
            }
          })
        );
      }
      return new Response(
        JSON.stringify({
          ok: true,
          data: {
            written: true,
            oldEnabledTables: persisted,
            newEnabledTables: b.enabledTables ?? [],
            warnings: [],
            ...writeOverride
          }
        })
      );
    },
    "POST /api/catalog/reload": () =>
      new Response(
        JSON.stringify({
          ok: true,
          data: {
            id: "rel_1",
            status: "success",
            tables: 3,
            enabledTables: 3,
            warnings: [],
            connectionIds: ["mysql-aliyun"]
          }
        })
      )
  };
}

function renderWhitelist() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } }
  });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <TableWhitelist />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

function fillCreateFields() {
  fireEvent.change(screen.getByTestId("create-connection-id"), { target: { value: "demo-mysql" } });
  fireEvent.change(screen.getByTestId("create-connection-host"), { target: { value: "127.0.0.1" } });
  fireEvent.change(screen.getByTestId("create-connection-port"), { target: { value: "3306" } });
  fireEvent.change(screen.getByTestId("create-connection-database"), {
    target: { value: "analytics" }
  });
  fireEvent.change(screen.getByTestId("create-connection-username"), {
    target: { value: "lucy_ro" }
  });
  fireEvent.change(screen.getByTestId("create-connection-password"), {
    target: { value: "s3cret" }
  });
}

function renderDrawer() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } }
  });
  render(
    <QueryClientProvider client={client}>
      <CreateConnectionDrawer open onClose={vi.fn()} existingIds={[]} />
    </QueryClientProvider>
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  toastMocks.success.mockReset();
  toastMocks.error.mockReset();
  toastMocks.warning.mockReset();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("TableWhitelist runtimeAck (SC-10)", () => {
  it("does not toast success when written=true but runtimeAck=false with Source Map issues", async () => {
    stubFetch(
      whitelistHandlers({
        runtimeAck: false,
        policyRuntimeAck: false,
        policyRuntimeIssues: [
          {
            agentId: "analyst_agent",
            reason: "source_map_compile_failed:duplicate_source_name:mysql-aliyun:city"
          }
        ]
      })
    );
    renderWhitelist();

    const row = await screen.findByTestId("whitelist-row-dataforai.superstore_returns");
    fireEvent.click(within(row).getByRole("checkbox", { name: "选择 superstore_returns" }));
    fireEvent.click(screen.getByRole("button", { name: "保存变更" }));

    await waitFor(() => {
      const warnOrError =
        toastMocks.error.mock.calls.length > 0 || toastMocks.warning.mock.calls.length > 0;
      expect(warnOrError).toBe(true);
    });
    expect(toastMocks.success).not.toHaveBeenCalled();
    const messages = [
      ...toastMocks.error.mock.calls.map(([m]) => String(m)),
      ...toastMocks.warning.mock.calls.map(([m]) => String(m))
    ].join(" ");
    expect(messages).toMatch(/source_map_compile_failed|Source Map|短名|编译/);
    expect(messages).not.toMatch(/已生效|运行态已确认|已可用/);
  });

  it("keeps success toast when runtimeAck===true", async () => {
    stubFetch(
      whitelistHandlers({
        runtimeAck: true,
        policyRuntimeAck: true,
        policyRuntimeIssues: []
      })
    );
    renderWhitelist();

    const row = await screen.findByTestId("whitelist-row-dataforai.superstore_returns");
    fireEvent.click(within(row).getByRole("checkbox", { name: "选择 superstore_returns" }));
    fireEvent.click(screen.getByRole("button", { name: "保存变更" }));

    await waitFor(() => {
      expect(
        toastMocks.success.mock.calls.some(([message]) =>
          String(message).includes("启用表范围已保存")
        )
      ).toBe(true);
    });
  });
});

describe("CreateConnectionDrawer runtimeAck (SC-10)", () => {
  it("does not treat create as fully available when runtimeAck=false", async () => {
    stubFetch({
      "POST /api/connections": (body) => {
        if ((body as { dryRun?: boolean }).dryRun === false) {
          return new Response(
            JSON.stringify({
              ok: true,
              data: {
                written: true,
                secretRelPath: ".ktx/secrets/demo-mysql-password",
                connection: {
                  id: "demo-mysql",
                  driver: "mysql",
                  schemas: [],
                  enabledTables: []
                },
                test: { status: "ok", durationMs: 12 },
                runtimeAck: false,
                policyRuntimeAck: false,
                policyRuntimeIssues: [
                  {
                    agentId: "analyst_agent",
                    reason: "source_map_compile_failed:duplicate_source_name:demo-mysql:city"
                  }
                ],
                executionRuntimeAck: true,
                executionRuntimeStatus: "ok",
                executionDecisionReason: "ok"
              }
            })
          );
        }
        return new Response(
          JSON.stringify({
            ok: true,
            data: {
              diff: "+demo-mysql",
              proposedYaml: "connections:\n  demo-mysql: {}\n",
              secretRelPath: ".ktx/secrets/demo-mysql-password",
              connection: { id: "demo-mysql", driver: "mysql", schemas: [], enabledTables: [] }
            }
          })
        );
      }
    });

    renderDrawer();
    fillCreateFields();
    fireEvent.click(screen.getByTestId("create-connection-preview-btn"));
    await waitFor(() => {
      expect(screen.getByTestId("create-connection-confirm-btn")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId("create-connection-confirm-btn"));

    await waitFor(() => {
      const warnOrError =
        toastMocks.error.mock.calls.length > 0 || toastMocks.warning.mock.calls.length > 0;
      expect(warnOrError).toBe(true);
    });
    expect(toastMocks.success).not.toHaveBeenCalled();
    const messages = [
      ...toastMocks.error.mock.calls.map(([m]) => String(m)),
      ...toastMocks.warning.mock.calls.map(([m]) => String(m))
    ].join(" ");
    expect(messages).toMatch(/source_map_compile_failed|Source Map|短名|编译/);
    expect(await screen.findByTestId("create-connection-policy-runtime")).toBeInTheDocument();
    expect(screen.getByTestId("create-connection-policy-runtime")).toHaveTextContent(
      /source_map_compile_failed|未确认/
    );
  });

  it("keeps success path when runtimeAck===true", async () => {
    stubFetch({
      "POST /api/connections": (body) => {
        if ((body as { dryRun?: boolean }).dryRun === false) {
          return new Response(
            JSON.stringify({
              ok: true,
              data: {
                written: true,
                secretRelPath: ".ktx/secrets/demo-mysql-password",
                connection: {
                  id: "demo-mysql",
                  driver: "mysql",
                  schemas: [],
                  enabledTables: []
                },
                test: { status: "ok", durationMs: 12 },
                runtimeAck: true,
                policyRuntimeAck: true,
                policyRuntimeIssues: [],
                executionRuntimeAck: true,
                executionRuntimeStatus: "ok",
                executionDecisionReason: "ok"
              }
            })
          );
        }
        return new Response(
          JSON.stringify({
            ok: true,
            data: {
              diff: "+demo-mysql",
              proposedYaml: "connections:\n  demo-mysql: {}\n",
              secretRelPath: ".ktx/secrets/demo-mysql-password",
              connection: { id: "demo-mysql", driver: "mysql", schemas: [], enabledTables: [] }
            }
          })
        );
      }
    });

    renderDrawer();
    fillCreateFields();
    fireEvent.click(screen.getByTestId("create-connection-preview-btn"));
    await waitFor(() => {
      expect(screen.getByTestId("create-connection-confirm-btn")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId("create-connection-confirm-btn"));

    await waitFor(() => {
      expect(toastMocks.success).toHaveBeenCalledWith("连接已创建：demo-mysql");
    });
    expect(screen.getByTestId("create-connection-success")).toBeInTheDocument();
  });
});
