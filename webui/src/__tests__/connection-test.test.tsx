// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConnectionTest } from "../pages/connections/ConnectionTest";
import type { ConnectionInfo } from "../lib/types";
import { assertNoForbiddenTerms } from "./forbidden-terms";

const TEST_CONN: ConnectionInfo = {
  id: "mysql-aliyun",
  driver: "mysql",
  engine: "mysql",
  wireProtocol: "mysql",
  readOnlyExpected: true,
  schemas: ["dataforai"],
  enabledTables: ["dataforai.superstore_orders"]
};

type Handler = (body: unknown, init?: RequestInit) => Response | Promise<Response>;
type HandlerMap = Record<string, Handler>;

function stubConnTestFetch(handlers: HandlerMap = {}) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
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
    const key = `${method} ${url.replace(/^http:\/\/[^/]+/, "")}`;
    const handler = handlers[key] ?? handlers[`${method} ${url}`];
    if (!handler) {
      return new Response(
        JSON.stringify({ ok: false, error: { code: "NOT_FOUND", message: key } }),
        { status: 404 }
      );
    }
    return handler(body, init);
  });
  vi.stubGlobal("fetch", fetchMock);
  return { fetchMock, handlers };
}

function defaultHandlers(opts: {
  connection?: ConnectionInfo;
  testResult?: {
    status: "ok" | "error";
    latencyMs?: number;
    detail?: string;
    reason?: string;
    stdout?: string;
    stderr?: string;
  };
  testDelayMs?: number;
} = {}): HandlerMap {
  const conn = opts.connection ?? TEST_CONN;
  const result = opts.testResult;
  const delay = opts.testDelayMs ?? 0;
  return {
    "GET /api/connections": () =>
      new Response(JSON.stringify({ ok: true, data: { connections: [conn] } })),
    "GET /api/project": () =>
      new Response(
        JSON.stringify({
          ok: true,
          data: { root: "/tmp/project-lucy", ktxAvailable: true, connections: [conn] }
        })
      ),
    [`POST /api/connections/${conn.id}/test`]: async () => {
      if (delay > 0) {
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
      return new Response(
        JSON.stringify({
          ok: true,
          data: result ?? { status: "ok", latencyMs: 100, detail: "ok", stdout: "ok", stderr: "" }
        })
      );
    }
  };
}

function renderConnectionTest() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } }
  });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <ConnectionTest />
      </MemoryRouter>
    </QueryClientProvider>
  );
  return { client };
}

beforeEach(() => {
  vi.resetAllMocks();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("ConnectionTest", () => {
  it("renders the initial Not-tested state without a green banner", async () => {
    stubConnTestFetch(defaultHandlers());
    renderConnectionTest();

    expect(await screen.findByRole("heading", { name: "连通测试" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "选择连接" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "重新测试连接" })).toBeInTheDocument();
    expect(screen.getByText("尚未测试")).toBeInTheDocument();
    expect(screen.queryByText("连接成功 (Connection Passed)")).not.toBeInTheDocument();
  });

  it("shows success state with structured latency, metadata, and visible logs", async () => {
    stubConnTestFetch(
      defaultHandlers({
        testResult: {
          status: "ok",
          latencyMs: 504,
          detail: "Status: ok\nDriver: mysql",
          stdout: "Status: ok\nDriver: mysql",
          stderr: ""
        }
      })
    );
    renderConnectionTest();

    await screen.findByText("尚未测试");
    fireEvent.click(screen.getByRole("button", { name: "重新测试连接" }));

    expect(await screen.findByText("连接成功 (Connection Passed)")).toBeInTheDocument();
    expect(screen.getByText("响应延时: 504 ms")).toBeInTheDocument();
    expect(screen.getByText("偏慢")).toBeInTheDocument();
    expect(screen.getByText("数据库驱动")).toBeInTheDocument();
    expect(screen.getByText("MySQL")).toBeInTheDocument();
    expect(screen.getByText("传输协议")).toBeInTheDocument();
    expect(screen.getByText("MySQL Wire")).toBeInTheDocument();
    expect(screen.getByText("访问模式")).toBeInTheDocument();
    expect(screen.getByText("Read-Only (受控访问)")).toBeInTheDocument();

    const toggle = screen.getByRole("button", { name: /原始诊断日志/ });
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByTestId("connection-test-raw-log-frame")).toBeInTheDocument();
    expect(screen.getByTestId("connection-test-stdout")).toHaveTextContent("Status: ok");
  });

  it("can collapse and re-expand the raw log block", async () => {
    stubConnTestFetch(
      defaultHandlers({
        testResult: {
          status: "ok",
          latencyMs: 120,
          stdout: "Status: ok\nDriver: mysql",
          stderr: ""
        }
      })
    );
    renderConnectionTest();

    const button = await screen.findByRole("button", { name: "重新测试连接" });
    fireEvent.click(button);
    await screen.findByText("连接成功 (Connection Passed)");

    const toggle = screen.getByRole("button", { name: /原始诊断日志/ });
    fireEvent.click(toggle);

    await waitFor(() =>
      expect(toggle).toHaveAttribute("aria-expanded", "false")
    );
    expect(screen.queryByTestId("connection-test-raw-log-frame")).not.toBeInTheDocument();

    fireEvent.click(toggle);
    await waitFor(() => expect(toggle).toHaveAttribute("aria-expanded", "true"));
    expect(
      await screen.findByTestId("connection-test-stdout")
    ).toHaveTextContent("Status: ok");
  });

  it("shows failure state with the access-denied reason in the visible log", async () => {
    stubConnTestFetch(
      defaultHandlers({
        testResult: {
          status: "error",
          latencyMs: 1200,
          reason: "Access denied",
          stdout: "",
          stderr: "Access denied"
        }
      })
    );
    renderConnectionTest();

    const button = await screen.findByRole("button", { name: "重新测试连接" });
    fireEvent.click(button);

    expect(await screen.findByText("连接失败 (Connection Failed)")).toBeInTheDocument();
    expect(screen.getByText("需关注")).toBeInTheDocument();

    expect(screen.getByRole("button", { name: /原始诊断日志/ })).toHaveAttribute("aria-expanded", "true");
    expect(
      await screen.findByTestId("connection-test-stderr")
    ).toHaveTextContent("Access denied");
  });

  it("shows a placeholder when the connection test returns no raw log text", async () => {
    stubConnTestFetch(
      defaultHandlers({
        testResult: {
          status: "ok",
          latencyMs: 88,
          stdout: "",
          stderr: ""
        }
      })
    );
    renderConnectionTest();

    const button = await screen.findByRole("button", { name: "重新测试连接" });
    fireEvent.click(button);

    expect(await screen.findByText("连接成功 (Connection Passed)")).toBeInTheDocument();
    expect(screen.getByTestId("connection-test-log-empty")).toHaveTextContent("暂无原始日志输出");
  });

  it("renders an empty state link when no connection is configured", async () => {
    stubConnTestFetch({
      "GET /api/connections": () =>
        new Response(JSON.stringify({ ok: true, data: { connections: [] } })),
      "GET /api/project": () =>
        new Response(JSON.stringify({ ok: true, data: { root: "/tmp/project-lucy", ktxAvailable: true, connections: [] } }))
    });
    renderConnectionTest();
    expect(await screen.findByText(/暂无连接配置/)).toBeInTheDocument();
    // Multiple 连接概览 links are now expected (sidebar nav + empty-state CTA);
    // assert the one inside the empty state.
    const empty = screen.getByText(/暂无连接配置/).parentElement;
    expect(within(empty as HTMLElement).getByRole("link", { name: "连接概览" })).toHaveAttribute(
      "href",
      "/connections"
    );
  });

  it("disables the test button while a request is pending", async () => {
    stubConnTestFetch(defaultHandlers({ testDelayMs: 100 }));
    renderConnectionTest();

    await screen.findByText("尚未测试");
    const button = await screen.findByRole("button", { name: "重新测试连接" });
    fireEvent.click(button);
    await waitFor(() => expect(button).toBeDisabled());
  });

  it("M21: page heading and nav use 连通测试 and there are no machine-translation artifacts", async () => {
    stubConnTestFetch(defaultHandlers());
    renderConnectionTest();

    expect(await screen.findByRole("heading", { name: "连通测试" })).toBeInTheDocument();
    expect(screen.queryByText("替代测试")).not.toBeInTheDocument();
    expect(screen.queryByText("财政部舱单")).not.toBeInTheDocument();
    expect(screen.queryByText("上传报价包")).not.toBeInTheDocument();
    expect(screen.queryByText("添加架构")).not.toBeInTheDocument();
    expect(screen.queryByText("目标架构")).not.toBeInTheDocument();
    assertNoForbiddenTerms(document.body);
  });

  it("M21: also surfaces a hint that 测试连接 can be triggered from a connection card on the overview", async () => {
    stubConnTestFetch(defaultHandlers());
    renderConnectionTest();

    expect(await screen.findByRole("heading", { name: "连通测试" })).toBeInTheDocument();
    const hint = screen.getByTestId("connection-test-overview-hint");
    expect(hint).toHaveTextContent(/对单个连接执行测试/);
    expect(within(hint).getByRole("link", { name: "连接概览" })).toHaveAttribute(
      "href",
      "/connections"
    );
  });
});
