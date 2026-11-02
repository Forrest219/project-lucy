// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EditConnectionDrawer } from "../components/connections/EditConnectionDrawer";
import type { ConnectionInfo } from "../lib/types";

const { apiPost, MockApiError } = vi.hoisted(() => {
  class MockApiError extends Error {
    code: string;
    detail?: unknown;
    constructor(error: { message: string; code: string; detail?: unknown }) {
      super(error.message);
      this.code = error.code;
      this.detail = error.detail;
    }
  }
  return { apiPost: vi.fn(), MockApiError };
});

vi.mock("../lib/apiClient", () => ({
  apiPost: (...args: unknown[]) => apiPost(...args),
  ApiError: MockApiError
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));

const connection: ConnectionInfo = {
  id: "mysql-aliyun",
  driver: "mysql",
  host: "db-prod.internal",
  port: "3306",
  database: "dataforai",
  schemas: ["dataforai"],
  enabledTables: ["dataforai.superstore_orders"]
};

function renderDrawer() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <EditConnectionDrawer open connection={connection} onClose={vi.fn()} />
    </QueryClientProvider>
  );
}

describe("EditConnectionDrawer", () => {
  beforeEach(() => {
    apiPost.mockReset();
    apiPost.mockResolvedValue({
      diff: "",
      proposedYaml: "",
      current: { host: "db-prod.internal", port: 3306, username: "sc" },
      passwordAction: "keep"
    });
  });

  it("SC-11 exposes edit fields with read-only connection id and hydrate current", async () => {
    renderDrawer();
    expect(screen.getByTestId("edit-connection-drawer")).toBeInTheDocument();
    expect(screen.getByTestId("edit-connection-id")).toHaveValue("mysql-aliyun");
    await waitFor(() => expect(screen.getByTestId("edit-connection-username")).toHaveValue("sc"));
    expect(screen.getByTestId("edit-connection-preview-btn")).toHaveClass("pl-btn--primary");
  });

  it("SC-12 preview then confirm posts dryRun false without password when keep", async () => {
    apiPost
      .mockResolvedValueOnce({
        diff: "",
        proposedYaml: "",
        current: { host: "db-prod.internal", port: 3306, username: "sc" },
        passwordAction: "keep"
      })
      .mockResolvedValueOnce({
        diff: "- host: db-prod\n+ host: db-test",
        proposedYaml: "host: db-test",
        current: { host: "db-prod.internal", port: 3306, username: "sc" },
        passwordAction: "keep"
      })
      .mockResolvedValueOnce({
        written: true,
        current: { host: "db-test.internal", port: 3306, username: "sc" },
        test: { status: "ok" },
        presence: { status: "ok", missingEnabledTables: [] },
        executionRuntimePending: true
      });

    renderDrawer();
    await waitFor(() => expect(screen.getByTestId("edit-connection-username")).toHaveValue("sc"));
    fireEvent.change(screen.getByTestId("edit-connection-host"), {
      target: { value: "db-test.internal" }
    });
    fireEvent.click(screen.getByTestId("edit-connection-preview-btn"));
    await waitFor(() => expect(screen.getByTestId("edit-connection-preview")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("edit-connection-confirm-btn"));
    await waitFor(() => {
      const commit = apiPost.mock.calls.find(
        (call) => call[1] && (call[1] as { dryRun?: boolean }).dryRun === false
      );
      expect(commit?.[1]).toMatchObject({
        host: "db-test.internal",
        dryRun: false
      });
      expect(commit?.[1]).not.toHaveProperty("password");
    });
    expect(screen.queryByText(/问数已切/)).not.toBeInTheDocument();
  });

  it("SC-22 conflict uses 仍要改到相同端点 not 仍要新建连接", async () => {
    apiPost
      .mockResolvedValueOnce({
        diff: "",
        proposedYaml: "",
        current: { host: "db-prod.internal", port: 3306, username: "sc" },
        passwordAction: "keep"
      })
      .mockRejectedValueOnce(
        new MockApiError({
          message: "冲突",
          code: "ENDPOINT_EDIT_CONFLICT",
          detail: { reason: "shared_endpoint", matches: [] }
        })
      );

    renderDrawer();
    await waitFor(() => expect(screen.getByTestId("edit-connection-username")).toHaveValue("sc"));
    fireEvent.click(screen.getByTestId("edit-connection-preview-btn"));
    await waitFor(() => expect(screen.getByTestId("edit-connection-conflict")).toBeInTheDocument());
    expect(screen.getByText("仍要改到相同端点")).toBeInTheDocument();
    expect(screen.queryByText("仍要新建连接")).not.toBeInTheDocument();
    expect(screen.queryByText("添加 Schema")).not.toBeInTheDocument();
  });
});
