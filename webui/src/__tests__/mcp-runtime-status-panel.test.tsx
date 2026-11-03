// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { McpRuntimeStatusPanel } from "../components/McpRuntimeStatusPanel";
import type { McpRuntimeReloadResult, McpRuntimeStatus } from "../lib/types";

function makeStatus(overrides: Partial<McpRuntimeStatus["execution"]> = {}): McpRuntimeStatus {
  return {
    endpoint: { upstreamHost: "127.0.0.1", upstreamPort: 7878 },
    config: {
      projectRoot: "/data/lucy",
      ktxYamlDigest: "a".repeat(64),
      connectionIds: ["zijin"],
      updatedAt: "2026-10-27T00:00:00.000Z"
    },
    catalog: { connectionIds: [], lastByConnection: {} },
    policy: { policyVersion: "v1", healthy: true } as McpRuntimeStatus["policy"],
    execution: {
      status: "unknown",
      lastCheckedAt: "2026-10-27T00:00:00.000Z",
      activation: "current",
      reload: { state: "idle" },
      verification: { state: "unverified" },
      ...overrides
    }
  };
}

afterEach(() => {
  cleanup();
});

describe("McpRuntimeStatusPanel — Spec 191 执行层重载", () => {
  it("offers 「重新检测执行层」 and 「重载执行层」 as two different actions", () => {
    render(
      <McpRuntimeStatusPanel
        status={makeStatus()}
        connectionId="zijin"
        onRecheck={() => {}}
        onReload={() => {}}
      />
    );

    expect(screen.getByRole("button", { name: "重新检测执行层" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "重载执行层" })).toBeInTheDocument();
  });

  it("calls the reload action and not the recheck action when 「重载执行层」 is pressed", () => {
    const onReload = vi.fn();
    const onRecheck = vi.fn();
    render(
      <McpRuntimeStatusPanel
        status={makeStatus()}
        connectionId="zijin"
        onRecheck={onRecheck}
        onReload={onReload}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "重载执行层" }));
    expect(onReload).toHaveBeenCalledTimes(1);
    expect(onRecheck).not.toHaveBeenCalled();
  });

  it("disables the reload button and shows 「重载中...」 while a reload is running", () => {
    render(
      <McpRuntimeStatusPanel
        status={makeStatus({ reload: { state: "running" } })}
        connectionId="zijin"
        onRecheck={() => {}}
        onReload={() => {}}
        reloadPending
      />
    );

    const button = screen.getByRole("button", { name: "重载中..." });
    expect(button).toBeDisabled();
  });

  it("tells the user that the configuration is pending and points at the reload action", () => {
    render(
      <McpRuntimeStatusPanel
        status={makeStatus({ activation: "reload_required" })}
        connectionId="zijin"
        onRecheck={() => {}}
        onReload={() => {}}
      />
    );

    const notice = screen.getByTestId("mcp-runtime-remediation");
    expect(notice).toHaveTextContent("配置已写入，执行层尚未加载");
    expect(notice).toHaveTextContent("重载执行层");
    // The old wording pointed at a manual restart of the execution process.
    expect(notice).not.toHaveTextContent("重启");
  });

  it("reports the reload result as separate facts", () => {
    const result: McpRuntimeReloadResult = {
      requestId: "req-1",
      reloadStatus: "succeeded",
      configVerification: "failed",
      requestedDigest: "digest-a",
      actualDigest: "digest-b",
      startedAt: "2026-10-27T00:00:00.000Z"
    };
    render(
      <McpRuntimeStatusPanel
        status={makeStatus()}
        connectionId="zijin"
        onRecheck={() => {}}
        onReload={() => {}}
        reloadResult={result}
      />
    );

    const outcome = screen.getByTestId("mcp-runtime-reload-outcome");
    expect(outcome).toHaveTextContent("执行层已重启");
    expect(outcome).toHaveTextContent("未通过连接级验证");
  });

  it("hides the reload action when the deployment does not offer it", () => {
    render(
      <McpRuntimeStatusPanel
        status={makeStatus()}
        connectionId="zijin"
        onRecheck={() => {}}
      />
    );

    expect(screen.queryByRole("button", { name: "重载执行层" })).not.toBeInTheDocument();
  });
});
