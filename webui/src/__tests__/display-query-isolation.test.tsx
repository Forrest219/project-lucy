// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ApiError,
  apiGet,
  apiPost,
  apiPut,
  bumpAuthEpoch,
  currentDisplayWriteEpoch,
  isStaleResponseError,
  setDisplayWriteSettledHandler
} from "../lib/apiClient";
import { AuthProvider, useAuth } from "../lib/auth";
import { adminAgentsQueryOptions, DISPLAY_STALE_TIME_MS, projectQueryOptions, sourcesQueryOptions } from "../lib/displayQueryOptions";

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(status === 200 ? { ok: true, data } : data), { status, headers: { "Content-Type": "application/json" } });
}

function deferredResponse() {
  let resolve!: (value: Response) => void;
  const promise = new Promise<Response>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

afterEach(() => {
  vi.unstubAllGlobals();
  setDisplayWriteSettledHandler(null);
});

describe("Spec 174 T3 — client freshness guards (SC-08/18, DI-14)", () => {
  it("passes the React Query AbortSignal to fetch", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      return json({ ok: 1 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const controller = new AbortController();
    await apiGet("/api/project", { signal: controller.signal });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("rejects a response from a previous auth epoch even if the request ignored abort", async () => {
    const pending = deferredResponse();
    vi.stubGlobal("fetch", vi.fn(() => pending.promise));
    const request = apiGet("/api/sources");
    bumpAuthEpoch();
    pending.resolve(json({ tables: [{ table: "old_account_table" }] }));
    const error = await request.catch((e) => e);
    expect(isStaleResponseError(error)).toBe(true);
  });

  it("re-reads display data that straddled a write and never returns the pre-write payload", async () => {
    const first = deferredResponse();
    let calls = 0;
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/enabled-tables")) return Promise.resolve(json({ written: true }));
      calls += 1;
      return calls === 1 ? first.promise : Promise.resolve(json({ tables: ["after"] }));
    }));
    const options = sourcesQueryOptions();
    const read = options.queryFn({ signal: new AbortController().signal } as never);
    await apiPut("/api/connections/c1/enabled-tables", { dryRun: false, enabledTables: [] });
    first.resolve(json({ tables: ["before"] }));
    await expect(read).resolves.toEqual({ tables: ["after"] });
    expect(calls).toBe(2);
  });

  it("tracks only confirmed display writes and settles on failure too", async () => {
    const settled = vi.fn();
    setDisplayWriteSettledHandler(settled);
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/fail")) return json({ ok: false, error: { code: "AUDIT_FAILED", message: "after write" } }, 500);
      return json({ ok: true });
    }));
    const start = currentDisplayWriteEpoch("sources");
    await apiPut("/api/connections/c1/enabled-tables", { dryRun: true, enabledTables: [] });
    await apiPost("/api/connections/c1/test", {});
    await apiPost("/api/admin/ui-usage/page-view", { path: "/catalog" });
    expect(currentDisplayWriteEpoch("sources")).toBe(start);
    expect(settled).not.toHaveBeenCalled();
    await expect(apiPost("/api/catalog/reload/fail", { dryRun: false })).rejects.toBeInstanceOf(ApiError);
    expect(currentDisplayWriteEpoch("sources")).toBe(start + 2);
    expect(settled).toHaveBeenCalledWith(["project", "sources"]);
  });

  it("uses 30 s freshness for project/sources and keeps Agent statistics at staleTime 0", () => {
    expect(projectQueryOptions().staleTime).toBe(DISPLAY_STALE_TIME_MS);
    expect(sourcesQueryOptions().gcTime).toBe(300_000);
    expect("staleTime" in adminAgentsQueryOptions()).toBe(false);
    const retry = sourcesQueryOptions().retry;
    expect(retry(0, new ApiError({ code: "DISPLAY_SNAPSHOT_BUSY", message: "" }))).toBe(true);
    expect(retry(1, new ApiError({ code: "DISPLAY_SNAPSHOT_BUSY", message: "" }))).toBe(false);
    expect(retry(0, new Error("AbortError"))).toBe(false);
  });

  it("drops protected queries (keeps public Help / branding) when the identity changes or a 401 arrives", async () => {
    let me: { id: string } | null = { id: "alice" };
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/api/auth/status")) return json({ mode: "required", authEnabled: true, me: me ? { ...me, displayName: me.id, role: "owner", enabled: true, createdAt: null } : null });
      if (url.endsWith("/api/auth/logout")) return json({});
      if (url.endsWith("/api/sources")) return json({ ok: false, error: { code: "AUTH_REQUIRED", message: "需要登录" } }, 401);
      return json({});
    }));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(["sources"], { tables: ["alice-only"] });
    client.setQueryData(["admin", "agents"], { agents: [] });
    client.setQueryData(["help", "handbook"], { sections: [] });
    client.setQueryData(["branding"], { productTitle: "Lucy" });
    let auth: ReturnType<typeof useAuth> | null = null;
    function Probe() {
      auth = useAuth();
      return <span data-testid="me">{auth.status?.me?.id ?? "none"}</span>;
    }
    render(
      <QueryClientProvider client={client}>
        <AuthProvider>
          <Probe />
        </AuthProvider>
      </QueryClientProvider>
    );
    await waitFor(() => expect(screen.getByTestId("me")).toHaveTextContent("alice"));
    me = { id: "bob" };
    await act(async () => {
      await auth!.refresh();
    });
    expect(client.getQueryData(["sources"])).toBeUndefined();
    expect(client.getQueryData(["admin", "agents"])).toBeUndefined();
    expect(client.getQueryData(["help", "handbook"])).toEqual({ sections: [] });
    expect(client.getQueryData(["branding"])).toEqual({ productTitle: "Lucy" });

    client.setQueryData(["sources"], { tables: ["bob-only"] });
    me = null;
    await act(async () => {
      await apiGet("/api/sources").catch(() => undefined);
    });
    await waitFor(() => expect(screen.getByTestId("me")).toHaveTextContent("none"));
    expect(client.getQueryData(["sources"])).toBeUndefined();
  });
});
