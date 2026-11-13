// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EditConnectionDialog } from "../components/connections/EditConnectionDialog";
import type { ConnectionInfo } from "../lib/types";
import { toast } from "sonner";

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

const appCssPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../app/app.css");

function modalBackdropRule(css: string): string {
  const match = css.match(/\.pl-modal-backdrop\s*\{[^}]*\}/);
  if (!match) throw new Error("missing .pl-modal-backdrop rule");
  return match[0];
}

function renderDialog(onClose = vi.fn()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return {
    onClose,
    ...render(
      <QueryClientProvider client={client}>
        <div data-testid="connection-list-shell">
          <EditConnectionDialog open connection={connection} onClose={onClose} />
        </div>
      </QueryClientProvider>
    )
  };
}

describe("EditConnectionDialog", () => {
  beforeEach(() => {
    apiPost.mockReset();
    vi.mocked(toast.success).mockClear();
    vi.mocked(toast.error).mockClear();
    vi.mocked(toast.warning).mockClear();
    apiPost.mockResolvedValue({
      diff: "",
      proposedYaml: "",
      current: { host: "db-prod.internal", port: 3306, username: "sc" },
      passwordAction: "keep"
    });
  });

  it("SC-24/25 uses modal classes and production CSS layout contract", () => {
    renderDialog();
    const dialog = screen.getByTestId("edit-connection-dialog");
    const panel = screen.getByTestId("edit-connection-dialog-panel");
    expect(dialog).toHaveClass("pl-modal-backdrop");
    expect(panel).toHaveClass("pl-modal-panel");
    expect(dialog).toHaveAttribute("role", "dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog.className).not.toMatch(/pl-drawer-root|pl-drawer-backdrop|(^|\s)pl-drawer(\s|$)/);
    expect(document.querySelector(".pl-drawer-root")).toBeNull();

    const rule = modalBackdropRule(readFileSync(appCssPath, "utf8"));
    for (const token of ["fixed", "inset-0", "flex", "items-center", "justify-center"]) {
      expect(rule).toContain(token);
    }
    // Fixture: removing flex must fail the layout-mode contract even if align classes remain.
    const withoutFlex = rule.replace(/\bflex\b/, "");
    expect(withoutFlex).toContain("items-center");
    expect(withoutFlex).toContain("justify-center");
    expect(/\bflex\b/.test(withoutFlex)).toBe(false);
  });

  it("SC-11/26 hydrates current and keeps editable fields inside the panel only", async () => {
    renderDialog();
    expect(screen.getByTestId("edit-connection-id")).toHaveValue("mysql-aliyun");
    await waitFor(() => expect(screen.getByTestId("edit-connection-username")).toHaveValue("sc"));
    const panel = screen.getByTestId("edit-connection-dialog-panel");
    const hosts = screen.getAllByTestId("edit-connection-host");
    expect(hosts).toHaveLength(1);
    expect(panel.contains(hosts[0])).toBe(true);
    expect(panel.querySelectorAll("[data-testid='edit-connection-port']")).toHaveLength(1);
    expect(panel.querySelectorAll("[data-testid='edit-connection-username']")).toHaveLength(1);
    expect(panel.querySelectorAll("[data-testid='edit-connection-password']")).toHaveLength(1);
    expect(document.activeElement && panel.contains(document.activeElement)).toBe(true);
  });

  it("form fields use stacked connection-field + pl-input layout (not bare pl-field)", () => {
    renderDialog();
    const panel = screen.getByTestId("edit-connection-dialog-panel");
    const fieldIds = [
      "edit-connection-id",
      "edit-connection-host",
      "edit-connection-port",
      "edit-connection-username",
      "edit-connection-password"
    ] as const;
    for (const id of fieldIds) {
      const input = screen.getByTestId(id);
      expect(input).toHaveClass("pl-input");
      const field = input.closest("label");
      expect(field).toHaveClass("pl-connection-field");
      expect(field).not.toHaveClass("pl-field");
      expect(field?.querySelector(".pl-connection-field-control")).not.toBeNull();
      expect(panel.contains(field)).toBe(true);
    }
    expect(panel.querySelectorAll("label.pl-field")).toHaveLength(0);
  });

  it("SC-13 dialog action group has a single primary labeled 预览变更 then 保存", async () => {
    apiPost
      .mockResolvedValueOnce({
        diff: "",
        proposedYaml: "",
        current: { host: "db-prod.internal", port: 3306, username: "sc" },
        passwordAction: "keep"
      })
      .mockResolvedValueOnce({
        diff: "- host: a\n+ host: b",
        proposedYaml: "host: b",
        current: { host: "db-prod.internal", port: 3306, username: "sc" },
        passwordAction: "keep"
      });

    renderDialog();
    await waitFor(() => expect(screen.getByTestId("edit-connection-username")).toHaveValue("sc"));
    const actions = screen.getByTestId("edit-connection-actions");
    expect(actions.querySelectorAll(".pl-btn--primary")).toHaveLength(1);
    expect(screen.getByTestId("edit-connection-preview-btn")).toHaveTextContent("预览变更");

    fireEvent.click(screen.getByTestId("edit-connection-preview-btn"));
    await waitFor(() => expect(screen.getByTestId("edit-connection-preview")).toBeInTheDocument());
    expect(actions.querySelectorAll(".pl-btn--primary")).toHaveLength(1);
    expect(screen.getByTestId("edit-connection-confirm-btn")).toHaveTextContent("保存");
  });

  it("SC-12 preview then save asserts toast copy bans", async () => {
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
        executionRuntimePending: false,
        executionRuntimeAck: true,
        executionDecisionReason: "ok"
      });

    renderDialog();
    await waitFor(() => expect(screen.getByTestId("edit-connection-username")).toHaveValue("sc"));
    fireEvent.change(screen.getByTestId("edit-connection-host"), {
      target: { value: "db-test.internal" }
    });
    fireEvent.click(screen.getByTestId("edit-connection-preview-btn"));
    await waitFor(() => expect(screen.getByTestId("edit-connection-preview")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("edit-connection-confirm-btn"));
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    const successMsg = String(vi.mocked(toast.success).mock.calls[0]?.[0] ?? "");
    expect(successMsg).not.toMatch(/问数已切到新库|权限已恢复|已全部生效/);
    expect(toast.error).not.toHaveBeenCalled();
    const execFace = await screen.findByTestId("edit-connection-execution-runtime");
    expect(execFace).toHaveTextContent("已加载新连接");
    expect(screen.getByTestId("edit-connection-success")).toBeInTheDocument();
  });

  it("edit success face shows pending execution reload guidance when ack is false", async () => {
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
        executionRuntimePending: false,
        executionRuntimeAck: false,
        executionDecisionReason: "execution_connection_not_loaded",
        executionRuntimeError: "connection missing from daemon"
      });

    const { onClose } = renderDialog();
    await waitFor(() => expect(screen.getByTestId("edit-connection-username")).toHaveValue("sc"));
    fireEvent.click(screen.getByTestId("edit-connection-preview-btn"));
    await waitFor(() => expect(screen.getByTestId("edit-connection-preview")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("edit-connection-confirm-btn"));
    const execFace = await screen.findByTestId("edit-connection-execution-runtime");
    expect(execFace).toHaveTextContent("尚未确认加载");
    expect(execFace).toHaveTextContent("重载执行层");
    expect(execFace).not.toHaveTextContent("已全部生效");
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("edit-connection-done-btn"));
    expect(onClose).toHaveBeenCalled();
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

    renderDialog();
    await waitFor(() => expect(screen.getByTestId("edit-connection-username")).toHaveValue("sc"));
    fireEvent.click(screen.getByTestId("edit-connection-preview-btn"));
    await waitFor(() => expect(screen.getByTestId("edit-connection-conflict")).toBeInTheDocument());
    expect(screen.getByText("仍要改到相同端点")).toBeInTheDocument();
    expect(screen.queryByText("仍要新建连接")).not.toBeInTheDocument();
    expect(screen.queryByText("添加 Schema")).not.toBeInTheDocument();
  });

  it("SC-27 blocks all close paths while submitting and restores after failure", async () => {
    let resolveCommit: (value: EndpointOk) => void = () => undefined;
    type EndpointOk = {
      written: true;
      current: { host: string; port: number; username: string };
      test: { status: "ok" };
      presence: { status: "ok"; missingEnabledTables: [] };
      executionRuntimePending: boolean;
      executionRuntimeAck: boolean;
    };

    apiPost
      .mockResolvedValueOnce({
        diff: "",
        proposedYaml: "",
        current: { host: "db-prod.internal", port: 3306, username: "sc" },
        passwordAction: "keep"
      })
      .mockResolvedValueOnce({
        diff: "x",
        proposedYaml: "x",
        current: { host: "db-prod.internal", port: 3306, username: "sc" },
        passwordAction: "keep"
      })
      .mockImplementationOnce(
        () =>
          new Promise<EndpointOk>((resolve, reject) => {
            resolveCommit = resolve;
            void reject;
          })
      );

    const { onClose } = renderDialog();
    await waitFor(() => expect(screen.getByTestId("edit-connection-username")).toHaveValue("sc"));
    fireEvent.click(screen.getByTestId("edit-connection-preview-btn"));
    await waitFor(() => expect(screen.getByTestId("edit-connection-confirm-btn")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("edit-connection-confirm-btn"));
    await waitFor(() => expect(screen.getByTestId("edit-connection-confirm-btn")).toHaveTextContent("保存中"));

    fireEvent.click(screen.getByTestId("edit-connection-dialog"));
    fireEvent.click(screen.getByTestId("edit-connection-close"));
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();

    resolveCommit({
      written: true,
      current: { host: "db-test.internal", port: 3306, username: "sc" },
      test: { status: "ok" },
      presence: { status: "ok", missingEnabledTables: [] },
      executionRuntimePending: false,
      executionRuntimeAck: true
    });
    await waitFor(() => expect(screen.getByTestId("edit-connection-done-btn")).toBeInTheDocument());
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("edit-connection-done-btn"));
    expect(onClose).toHaveBeenCalled();
  });

  it("SC-14 terminology includes Edit Connection Preview row", () => {
    const terminology = readFileSync(
      path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../docs/00-product-terminology-standard.md"),
      "utf8"
    );
    expect(terminology).toMatch(/Edit Connection Preview/);
    expect(terminology).toMatch(/编辑预览/);
  });
});
