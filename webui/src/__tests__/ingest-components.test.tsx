// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  IngestActionButton,
  IngestDiagnosticsDrawer,
  IngestLastRunBadge
} from "../components/ingest";
import type { IngestRun } from "../lib/types";

function makeRun(overrides: Partial<IngestRun> = {}): IngestRun {
  return {
    id: "ing_20260728_183000_demo_mysql",
    connectionId: "demo-mysql",
    requestedScope: "connection",
    executedScope: "connection",
    schemaScopedSupported: false,
    status: "success",
    startedAt: "2026-07-28T10:30:00.000Z",
    finishedAt: "2026-07-28T10:30:01.245Z",
    durationMs: 1245,
    exitCode: 0,
    stdout: "scanned 3 tables",
    stderr: "",
    command: ["ktx", "ingest", "demo-mysql"],
    scannedTableCount: 3,
    scannedSchemas: ["dataforai"],
    ...overrides
  };
}

function renderWithClient(node: React.ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } }
  });
  render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
  return client;
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
      const handler = handlers[key] ?? handlers[url];
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
  // default toast spy
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("IngestActionButton", () => {
  it("POSTs to the connection ingest endpoint with empty body when no schema is given", async () => {
    const onRunComplete = vi.fn();
    stubFetch({
      "POST /api/connections/demo-mysql/ingest": (body) =>
        new Response(
          JSON.stringify({ ok: true, data: makeRun({ status: "success" }) })
        )
    });
    const client = renderWithClient(
      <IngestActionButton connectionId="demo-mysql" onRunComplete={onRunComplete} />
    );
    const invalidate = vi.spyOn(client, "invalidateQueries");

    fireEvent.click(screen.getByTestId("ingest-action-demo-mysql"));

    await waitFor(() => expect(onRunComplete).toHaveBeenCalled());
    expect(screen.getByTestId("ingest-action-demo-mysql")).toHaveTextContent(/完成|成功/);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["project"] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["sources"] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["connections"] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["connections", "demo-mysql", "tables"] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["connections", "ingest-runs"] });
  });

  it("includes the schema in the request body when a schema is provided", async () => {
    stubFetch({
      "POST /api/connections/demo-mysql/ingest": (body) =>
        new Response(
          JSON.stringify({
            ok: true,
            data: makeRun({
              schema: "openclaw_db",
              requestedScope: "schema",
              executedScope: "connection",
              schemaScopedSupported: false,
              status: "failed",
              exitCode: 1,
              stderr: "Unknown database 'openclaw_db'",
              hint: "物理库或 schema 名不存在，或当前账号缺少访问权限，请确认 ktx.yaml 中的 schemas 与实际数据库一致。"
            })
          })
        )
    });
    const fetchMock = vi.fn().mockImplementation(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        expect(init?.body).toBe(JSON.stringify({ schema: "openclaw_db" }));
        return new Response(
          JSON.stringify({
            ok: true,
            data: makeRun({
              schema: "openclaw_db",
              requestedScope: "schema",
              executedScope: "connection",
              schemaScopedSupported: false,
              status: "failed",
              exitCode: 1,
              stderr: "Unknown database 'openclaw_db'",
              hint: "物理库或 schema 名不存在"
            })
          })
        );
      }
    );
    vi.stubGlobal("fetch", fetchMock);
    renderWithClient(
      <IngestActionButton connectionId="demo-mysql" schema="openclaw_db" label="重新扫描" />
    );

    fireEvent.click(screen.getByTestId("ingest-action-demo-mysql-openclaw_db"));

    expect(await screen.findByText(/重新扫描/)).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/connections/demo-mysql/ingest",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ schema: "openclaw_db" })
      })
    );
  });

  it("opens the diagnostics drawer automatically when ingest fails and surfaces stderr/stdout", async () => {
    stubFetch({
      "POST /api/connections/demo-mysql/ingest": () =>
        new Response(
          JSON.stringify({
            ok: true,
            data: makeRun({
              status: "failed",
              exitCode: 1,
              stdout: "ktx ingest: starting scan",
              stderr: "Connection \"demo-mysql\" is not configured in ktx.yaml",
              hint: "ktx.yaml 中没有配置连接 demo-mysql"
            })
          })
        )
    });
    renderWithClient(<IngestActionButton connectionId="demo-mysql" />);

    fireEvent.click(screen.getByTestId("ingest-action-demo-mysql"));

    const dialog = await screen.findByRole("dialog", { name: /Ingest 失败/ });
    expect(dialog).toBeInTheDocument();
    expect(dialog).toHaveTextContent("demo-mysql");
    expect(dialog).toHaveTextContent("退出码 1");
    expect(dialog).toHaveTextContent("Connection \"demo-mysql\" is not configured in ktx.yaml");
    expect(dialog).toHaveTextContent("ktx.yaml 中没有配置连接 demo-mysql");
  });

  it("renders the schema-scoped support copy when the backend reports schemaScopedSupported=false", async () => {
    stubFetch({
      "POST /api/connections/demo-mysql/ingest": () =>
        new Response(
          JSON.stringify({
            ok: true,
            data: makeRun({
              schema: "openclaw_db",
              requestedScope: "schema",
              executedScope: "connection",
              schemaScopedSupported: false,
              status: "success",
              scannedTableCount: 3,
              scannedSchemas: ["dataforai"]
            })
          })
        )
    });
    renderWithClient(
      <IngestActionButton connectionId="demo-mysql" schema="openclaw_db" label="重新扫描" />
    );

    fireEvent.click(screen.getByTestId("ingest-action-demo-mysql-openclaw_db"));

    expect(
      await screen.findByText(/当前 KTX 仅支持连接级 ingest，将扫描整个连接/)
    ).toBeInTheDocument();
  });
});

describe("IngestDiagnosticsDrawer", () => {
  it("does not render when closed", () => {
    renderWithClient(
      <IngestDiagnosticsDrawer
        run={makeRun({ status: "failed", exitCode: 2 })}
        open={false}
        onClose={vi.fn()}
      />
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("renders the exit code, hint, command, stdout, and stderr when open", () => {
    const run = makeRun({
      status: "failed",
      exitCode: 3,
      stdout: "ktx ingest started",
      stderr: "Permission denied for user 'sc'",
      hint: "数据库账号可能缺少访问权限"
    });
    renderWithClient(<IngestDiagnosticsDrawer run={run} open onClose={vi.fn()} />);

    const dialog = screen.getByRole("dialog", { name: /Ingest 失败/ });
    expect(dialog).toHaveTextContent("退出码 3");
    expect(dialog).toHaveTextContent("ktx ingest demo-mysql");
    expect(dialog).toHaveTextContent("Permission denied for user 'sc'");
    expect(dialog).toHaveTextContent("ktx ingest started");
    expect(dialog).toHaveTextContent("数据库账号可能缺少访问权限");
  });

  it("invokes onRetry when the retry button is clicked", () => {
    const onRetry = vi.fn();
    renderWithClient(
      <IngestDiagnosticsDrawer
        run={makeRun({ status: "failed", exitCode: 1 })}
        open
        onClose={vi.fn()}
        onRetry={onRetry}
      />
    );
    fireEvent.click(screen.getByTestId("ingest-diagnostics-retry"));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("invokes onClose when the close button is clicked", () => {
    const onClose = vi.fn();
    renderWithClient(
      <IngestDiagnosticsDrawer
        run={makeRun({ status: "failed", exitCode: 1 })}
        open
        onClose={onClose}
      />
    );
    fireEvent.click(screen.getByTestId("ingest-diagnostics-close"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe("IngestLastRunBadge", () => {
  it("renders the never-run copy when no run is supplied", () => {
    renderWithClient(<IngestLastRunBadge />);
    expect(screen.getByText(/上次 Ingest：未运行/)).toBeInTheDocument();
  });

  it("renders the success copy with table count when the run succeeded", () => {
    const run = makeRun({
      status: "success",
      scannedTableCount: 5,
      startedAt: "2026-07-28T10:30:00.000Z"
    });
    renderWithClient(<IngestLastRunBadge run={run} />);
    expect(screen.getByText(/上次 Ingest/)).toHaveTextContent("成功");
    expect(screen.getByText(/上次 Ingest/)).toHaveTextContent("5 张表");
  });

  it("renders the failed copy with the exit code when the run failed", () => {
    const run = makeRun({ status: "failed", exitCode: 2 });
    renderWithClient(<IngestLastRunBadge run={run} />);
    expect(screen.getByText(/上次 Ingest/)).toHaveTextContent("失败");
    expect(screen.getByText(/上次 Ingest/)).toHaveTextContent("退出码 2");
  });
});
