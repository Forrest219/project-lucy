import { QueryClient } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ApiError,
  GATEWAY_UNAVAILABLE,
  apiGet,
  apiPost,
  isGatewayHtmlResponse,
  isRetryableDisplayReadError,
  userFacingApiErrorMessage
} from "../lib/apiClient";
import {
  DISPLAY_READ_RETRY_BUDGET_MS,
  adminAgentsQueryOptions,
  adminRolesQueryOptions
} from "../lib/displayQueryOptions";

afterEach(() => {
  vi.unstubAllGlobals();
});

function jsonEnvelope(payload: unknown, status: number, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json", ...headers }
  });
}

describe("P1-58 SC-09 — HTML gateway vs JSON application errors", () => {
  it("classifies HTML 502/503 by status and content-type", () => {
    expect(isGatewayHtmlResponse(502, "text/html; charset=utf-8")).toBe(true);
    expect(isGatewayHtmlResponse(503, "text/html")).toBe(true);
    expect(isGatewayHtmlResponse(503, "application/json")).toBe(false);
  });

  it("maps HTML 502 to GATEWAY_UNAVAILABLE without surfacing raw HTML", async () => {
    const html = "<html><body>502 Bad Gateway</body></html>";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(html, { status: 502, headers: { "Content-Type": "text/html", "x-request-id": "edge-502" } }))
    );
    const error = await apiGet("/api/admin/agents").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).code).toBe(GATEWAY_UNAVAILABLE);
    const message = userFacingApiErrorMessage(error);
    expect(message).toContain("服务暂不可用");
    expect(message).toContain("edge-502");
    expect(message).not.toContain("<html>");
    expect(message).not.toContain("Unexpected token");
  });

  it("keeps JSON 503 DISPLAY_SNAPSHOT_BUSY distinct from HTML gateway", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonEnvelope(
          { ok: false, error: { code: "DISPLAY_SNAPSHOT_BUSY", message: "页面数据暂时无法完成刷新，请稍后重试。" } },
          503,
          { "Retry-After": "1" }
        )
      )
    );
    const error = await apiGet("/api/admin/roles").catch((e: unknown) => e);
    expect((error as ApiError).code).toBe("DISPLAY_SNAPSHOT_BUSY");
    expect((error as ApiError).code).not.toBe(GATEWAY_UNAVAILABLE);
    expect(isRetryableDisplayReadError(error)).toBe(true);
  });

  it("does not treat 401/403/409 JSON as retryable display reads", async () => {
    const cases: Array<{ status: number; body: unknown }> = [
      { status: 401, body: { ok: false, error: { code: "AUTH_REQUIRED", message: "需要登录" } } },
      { status: 403, body: { ok: false, error: { code: "FORBIDDEN", message: "无权限" } } },
      { status: 409, body: { ok: false, error: { code: "VERSION_CONFLICT", message: "配置已被他人修改" } } }
    ];
    for (const sample of cases) {
      vi.stubGlobal("fetch", vi.fn(async () => jsonEnvelope(sample.body, sample.status)));
      const error = await apiGet("/api/admin/agents").catch((e: unknown) => e);
      expect(isRetryableDisplayReadError(error)).toBe(false);
    }
  });

  it("does not classify unrelated HTML 503 as login loss", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("503 Service Unavailable", { status: 503, headers: { "Content-Type": "text/html" } }))
    );
    const error = await apiGet("/api/admin/agents").catch((e: unknown) => e);
    expect((error as ApiError).code).toBe(GATEWAY_UNAVAILABLE);
    expect(userFacingApiErrorMessage(error)).not.toMatch(/登录|别处/);
  });
});

describe("P1-58 SC-09 — bounded read retry and write no replay", () => {
  it("display list queries retry at most once for BUSY or gateway", async () => {
    let calls = 0;
    vi.stubGlobal("fetch", vi.fn(async () => {
      calls += 1;
      if (calls === 1) {
        return jsonEnvelope(
          { ok: false, error: { code: "DISPLAY_SNAPSHOT_BUSY", message: "页面数据暂时无法完成刷新，请稍后重试。" } },
          503,
          { "Retry-After": "1" }
        );
      }
      return jsonEnvelope({ ok: true, data: { agents: [] } }, 200);
    }));

    const options = adminAgentsQueryOptions<{ agents: unknown[] }>();
    const client = new QueryClient({ defaultOptions: { queries: { retryDelay: 0 } } });
    await client.fetchQuery({
      ...options,
      retry: options.retry,
      retryDelay: () => 0
    });
    expect(calls).toBe(2);
  });

  it("write requests never auto-replay on gateway failure", async () => {
    const fetchMock = vi.fn(
      async () => new Response("<html>502</html>", { status: 502, headers: { "Content-Type": "text/html" } })
    );
    vi.stubGlobal("fetch", fetchMock);
    await expect(apiPost("/api/admin/agents/a1", { dryRun: false, enabled: true })).rejects.toMatchObject({
      code: GATEWAY_UNAVAILABLE
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("caps automatic retry delay within the 5s display budget", () => {
    const options = adminRolesQueryOptions();
    expect(DISPLAY_READ_RETRY_BUDGET_MS).toBe(5000);
    const delay = (options.retryDelay as (count: number, error: unknown) => number)(0, {
      retryAfterSeconds: 120
    } as ApiError);
    expect(delay).toBeLessThanOrEqual(DISPLAY_READ_RETRY_BUDGET_MS);
  });
});

describe("P1-58 SC-09 — roles list query wiring", () => {
  it("adminRolesQueryOptions uses display read retry settings", () => {
    const options = adminRolesQueryOptions<{ roles: unknown[] }>();
    expect(options.staleTime).toBeGreaterThan(0);
    expect(options.retry(0, new ApiError({ code: "DISPLAY_SNAPSHOT_BUSY", message: "busy" }))).toBe(true);
    const forbidden = new ApiError({ code: "FORBIDDEN", message: "无权限" });
    forbidden.httpStatus = 403;
    expect(options.retry(0, forbidden)).toBe(false);
  });

  it("adminRolesQueryOptions fetches through displayRead", async () => {
    let calls = 0;
    vi.stubGlobal("fetch", vi.fn(async () => {
      calls += 1;
      return jsonEnvelope({ ok: true, data: { roles: [] } }, 200);
    }));
    const client = new QueryClient();
    await client.fetchQuery(adminRolesQueryOptions<{ roles: unknown[] }>());
    expect(calls).toBe(1);
  });
});