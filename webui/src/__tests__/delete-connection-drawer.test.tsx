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
    expect(screen.getByTestId("delete-connection-block-reason")).toHaveTextContent(
      "无法删除连接 mysql-aliyun。它仍被角色和业务 Wiki 引用，需要先改掉这些引用。本地语义文件可勾选「同时删除本地 YAML 资产」后一并删除。"
    );
    expect(screen.getByTestId("delete-connection-block-reason")).not.toHaveTextContent("connection_references_remain");

    fireEvent.change(screen.getByTestId("delete-connection-confirm-id"), {
      target: { value: "mysql-aliyun" }
    });
    expect(screen.getByTestId("delete-connection-confirm-btn")).toBeDisabled();
    expect(screen.getByTestId("delete-connection-confirm-btn")).toHaveAttribute(
      "aria-describedby",
      "delete-connection-block-reason"
    );

    fireEvent.click(screen.getByTestId("delete-connection-assets-checkbox"));
    expect(screen.getByTestId("delete-connection-confirm-btn")).toBeDisabled();
    expect(screen.getByTestId("delete-connection-block-reason")).toHaveTextContent(
      "它仍被角色和业务 Wiki 引用，需要先改掉这些引用。"
    );
    expect(screen.getByTestId("delete-connection-block-reason")).not.toHaveTextContent("本地语义文件");
  });

  it("allows confirm after the only remaining semantic files are included in the delete", async () => {
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
                aclRoleIds: [],
                wikiRefCount: 0,
                wikiSamplePaths: [],
                blocked: true,
                blockers: [
                  {
                    kind: "semantic_asset",
                    id: "semantic-layer/mysql-aliyun/_schema/dataforai.yaml"
                  }
                ]
              },
              blocked: true
            })
          })
        )
    });

    renderDrawer(makeConn());
    await waitFor(() =>
      expect(screen.getByTestId("delete-connection-block-reason")).toHaveTextContent(
        "无法删除连接 mysql-aliyun。本地语义文件可勾选「同时删除本地 YAML 资产」后一并删除。"
      )
    );
    expect(screen.getByText("semantic-layer/mysql-aliyun/_schema/dataforai.yaml")).toBeInTheDocument();

    fireEvent.change(screen.getByTestId("delete-connection-confirm-id"), {
      target: { value: "mysql-aliyun" }
    });
    expect(screen.getByTestId("delete-connection-confirm-btn")).toBeDisabled();

    fireEvent.click(screen.getByTestId("delete-connection-assets-checkbox"));
    expect(screen.queryByTestId("delete-connection-block-reason")).not.toBeInTheDocument();
    expect(screen.getByTestId("delete-connection-confirm-btn")).toBeEnabled();
  });

  it("names the remaining role and user when confirmation is rejected", async () => {
    stubFetch({
      "POST /api/connections/mysql-aliyun/remove": (body) => {
        const parsed = body as { dryRun?: boolean };
        if (parsed.dryRun !== false) {
          return new Response(JSON.stringify({ ok: true, data: makePreview() }));
        }
        return new Response(
          JSON.stringify({
            ok: false,
            error: {
              code: "connection_references_remain",
              message: "Connection 'mysql-aliyun' still has references; update or remove them before deleting",
              detail: {
                blockers: [
                  { kind: "role_connection", id: "finance_readonly" },
                  { kind: "identity", id: "demo_agent" }
                ]
              }
            }
          }),
          { status: 409 }
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
      expect(screen.getByTestId("delete-connection-write-error")).toHaveTextContent(
        "无法删除连接 mysql-aliyun。它仍被角色和用户 引用，需要先改掉这些引用。"
      )
    );
    expect(screen.getByTestId("delete-connection-write-error")).not.toHaveTextContent(
      "connection_references_remain"
    );
    expect(screen.getByTestId("delete-connection-write-error")).not.toHaveTextContent("still has references");
  });

  it("lists users that inherit a role reference", async () => {
    stubFetch({
      "POST /api/connections/mysql-aliyun/remove": () =>
        new Response(
          JSON.stringify({
            ok: true,
            data: makePreview({
              impact: {
                canDeleteSecret: false,
                secretRelPath: null,
                yamlAssetPaths: [],
                aclRoleIds: ["finance_readonly"],
                wikiRefCount: 0,
                wikiSamplePaths: [],
                blocked: true,
                blockers: [
                  { kind: "role_selector", id: "finance_readonly" },
                  { kind: "identity", id: "demo_agent" }
                ]
              },
              blocked: true
            })
          })
        )
    });

    renderDrawer(makeConn());
    await waitFor(() =>
      expect(screen.getByTestId("delete-connection-user-count")).toHaveTextContent("1 个")
    );
    expect(screen.getByText("demo_agent")).toBeInTheDocument();
    expect(screen.getByTestId("delete-connection-block-reason")).toHaveTextContent(
      "它仍被角色和用户 引用，需要先改掉这些引用。"
    );
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
