// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Step1ConnectDb } from "../components/onboarding/Step1ConnectDb";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("Step1ConnectDb endpoint gate", () => {
  it("reuses an existing connection and advances with its id", async () => {
    const onSuccess = vi.fn();
    const requests: Array<{ method: string; url: string; body?: unknown }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const method = init?.method ?? "GET";
        const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
        requests.push({ method, url, body });
        if (method === "POST" && url === "/api/connections/probe") {
          return new Response(JSON.stringify({ ok: true, data: { status: "ok", latencyMs: 4 } }));
        }
        if (method === "POST" && url === "/api/connections") {
          return new Response(
            JSON.stringify({
              ok: false,
              error: {
                code: "ENDPOINT_ALREADY_CONNECTED",
                message: "主机端口已有连接。添加 Schema 将使用已有凭据，新输入的密码不会保存。",
                detail: {
                  reason: "reuse_existing_credentials",
                  schema: "test_db",
                  matches: [
                    {
                      id: "existing-mysql",
                      driver: "mysql",
                      host: "127.0.0.1",
                      port: "3306",
                      database: "dataforai",
                      username: "root",
                      schemas: ["dataforai"]
                    }
                  ]
                }
              }
            }),
            { status: 409, headers: { "content-type": "application/json" } }
          );
        }
        if (method === "GET" && url === "/api/connections/existing-mysql/live-schemas?refresh=1") {
          return new Response(
            JSON.stringify({
              ok: true,
              data: {
                status: "ok",
                connectionId: "existing-mysql",
                schemas: [{ schema: "test_db", tableCount: 2 }],
                fetchedAt: "2026-09-28T00:00:00.000Z",
                cached: false,
                wireProtocol: "mysql"
              }
            })
          );
        }
        if (method === "POST" && url === "/api/connections/existing-mysql/schemas") {
          return new Response(JSON.stringify({ ok: true, data: { written: true } }));
        }
        return new Response(
          JSON.stringify({ ok: false, error: { code: "NOT_FOUND", message: `${method} ${url}` } }),
          { status: 404 }
        );
      })
    );

    const client = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } }
    });
    render(
      <QueryClientProvider client={client}>
        <Step1ConnectDb onSuccess={onSuccess} />
      </QueryClientProvider>
    );

    fireEvent.change(screen.getByTestId("setup-conn-id"), { target: { value: "test-conn" } });
    fireEvent.change(screen.getByTestId("setup-host"), { target: { value: "127.0.0.1" } });
    fireEvent.change(screen.getByTestId("setup-database"), { target: { value: "test_db" } });
    fireEvent.change(screen.getByTestId("setup-username"), { target: { value: "root" } });
    fireEvent.change(screen.getByTestId("setup-password"), { target: { value: "secret123" } });
    fireEvent.click(screen.getByTestId("setup-probe-btn"));
    await screen.findByText(/连通测试成功/);
    fireEvent.click(screen.getByTestId("setup-step1-next"));
    fireEvent.click(await screen.findByTestId("endpoint-gate-add-schema"));

    await waitFor(() =>
      expect(onSuccess).toHaveBeenCalledWith({ connectionId: "existing-mysql", schema: "test_db" })
    );
    expect(requests).toContainEqual({
      method: "GET",
      url: "/api/connections/existing-mysql/live-schemas?refresh=1",
      body: undefined
    });
    const addRequest = requests.find(
      (item) => item.method === "POST" && item.url === "/api/connections/existing-mysql/schemas"
    );
    expect(addRequest?.body).toEqual({ schema: "test_db", dryRun: false });
  });

  it("keeps a SelectDB catalog in the database field and uses the name after the dot as Schema", async () => {
    const bodies: unknown[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const method = init?.method ?? "GET";
        const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
        if (method === "POST" && url === "/api/connections/probe") {
          return new Response(JSON.stringify({ ok: true, data: { status: "ok", latencyMs: 4 } }));
        }
        if (method === "POST" && url === "/api/connections") {
          bodies.push(body);
          return new Response(
            JSON.stringify({
              ok: true,
              data: {
                written: true,
                connection: { id: "hive-jd", driver: "mysql", schemas: ["app"], enabledTables: [] },
                test: { status: "ok" }
              }
            })
          );
        }
        return new Response(JSON.stringify({ ok: false, error: { code: "NOT_FOUND", message: url } }), { status: 404 });
      })
    );
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } }
    });
    render(
      <QueryClientProvider client={client}>
        <Step1ConnectDb onSuccess={vi.fn()} />
      </QueryClientProvider>
    );

    fireEvent.change(screen.getByTestId("setup-driver"), { target: { value: "doris" } });
    fireEvent.change(screen.getByTestId("setup-conn-id"), { target: { value: "hive-jd" } });
    fireEvent.change(screen.getByTestId("setup-host"), { target: { value: "172.16.19.21" } });
    fireEvent.change(screen.getByTestId("setup-database"), { target: { value: "hive_jd.app" } });
    fireEvent.change(screen.getByTestId("setup-username"), { target: { value: "chatbi" } });
    fireEvent.change(screen.getByTestId("setup-password"), { target: { value: "sim-secret" } });

    expect(screen.getByTestId("setup-schema")).toHaveValue("app");
    expect(screen.getByTestId("setup-catalog-database-hint")).toHaveTextContent("hive_jd.app");
    fireEvent.click(screen.getByTestId("setup-probe-btn"));
    await screen.findByText(/连通测试成功/);
    fireEvent.click(screen.getByTestId("setup-step1-next"));

    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(bodies[0]).toMatchObject({
      id: "hive-jd",
      driver: "mysql",
      engine: "doris",
      database: "hive_jd.app",
      schemas: ["app"],
      port: 9030
    });
  });
});
