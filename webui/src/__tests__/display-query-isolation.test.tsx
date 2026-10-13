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
  displayFactsPending,
  hasPendingDisplayWrite,
  isStaleResponseError,
  isWriteStaleResponseError,
  setDisplayWriteBeginHandler,
  setDisplayWriteSettledHandler
} from "../lib/apiClient";
import { AuthProvider, useAuth } from "../lib/auth";
import { adminAgentsQueryOptions, DISPLAY_SCOPE_QUERY_KEYS, DISPLAY_STALE_TIME_MS, projectQueryOptions, sourcesQueryOptions } from "../lib/displayQueryOptions";

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

  it("R4 a read that resolves while the write is still pending is rejected and re-read only after settle", async () => {
    const write = deferredResponse();
    const first = deferredResponse();
    let reads = 0;
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL) => {
      if (String(input).endsWith("/enabled-tables")) return write.promise;
      reads += 1;
      return reads === 1 ? first.promise : Promise.resolve(json({ tables: ["after"] }));
    }));
    const read = sourcesQueryOptions().queryFn({ signal: new AbortController().signal } as never);
    const saving = apiPut("/api/connections/c1/enabled-tables", { dryRun: false, enabledTables: [] });
    first.resolve(json({ tables: ["before"] }));
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(reads).toBe(1);
    write.resolve(json({ written: true }));
    await saving;
    await expect(read).resolves.toEqual({ tables: ["after"] });
    expect(reads).toBe(2);
  });

  it("R4 a display read started during a pending write does not hit the network until the write settles", async () => {
    const write = deferredResponse();
    let reads = 0;
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL) => {
      if (String(input).endsWith("/enabled-tables")) return write.promise;
      reads += 1;
      return Promise.resolve(json({ tables: ["final"] }));
    }));
    const saving = apiPut("/api/connections/c1/enabled-tables", { dryRun: false, enabledTables: [] });
    expect(hasPendingDisplayWrite("sources")).toBe(true);
    const direct = await apiGet("/api/sources", { displayRead: "sources" }).catch((e: unknown) => e);
    expect(isWriteStaleResponseError(direct)).toBe(true);
    const read = sourcesQueryOptions().queryFn({ signal: new AbortController().signal } as never);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(reads).toBe(0);
    write.resolve(json({ written: true }));
    await saving;
    await expect(read).resolves.toEqual({ tables: ["final"] });
    expect(reads).toBe(1);
  });

  it("R4 nested / parallel writes: the first to finish does not unlock; one failing still settles; mutations submit once", async () => {
    const settled = vi.fn();
    const begun = vi.fn();
    setDisplayWriteSettledHandler(settled);
    setDisplayWriteBeginHandler(begun);
    const a = deferredResponse();
    const b = deferredResponse();
    const posts: string[] = [];
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      posts.push(url);
      if (url.endsWith("/a/enabled-tables")) return a.promise;
      if (url.endsWith("/b/enabled-tables")) return b.promise;
      return Promise.resolve(json({ tables: ["fresh"] }));
    }));
    const first = apiPut("/api/connections/a/enabled-tables", { dryRun: false, enabledTables: [] });
    const second = apiPut("/api/connections/b/enabled-tables", { dryRun: false, enabledTables: [] });
    expect(begun).toHaveBeenCalledTimes(2);
    expect(displayFactsPending("sources")).toBe(true);
    a.resolve(json({ written: true }));
    await first;
    expect(hasPendingDisplayWrite("sources")).toBe(true);
    expect(settled).not.toHaveBeenCalled();
    b.resolve(json({ ok: false, error: { code: "POLICY_COMMIT_FAILED", message: "rolled back" } }, 500));
    await expect(second).rejects.toBeInstanceOf(ApiError);
    expect(hasPendingDisplayWrite("sources")).toBe(false);
    expect(settled).toHaveBeenCalledTimes(1);
    expect(settled).toHaveBeenCalledWith(["project", "sources", "agents"]);
    expect(displayFactsPending("sources")).toBe(true);
    await sourcesQueryOptions().queryFn({ signal: new AbortController().signal } as never);
    expect(displayFactsPending("sources")).toBe(false);
    expect(posts.filter((url) => url.endsWith("/enabled-tables"))).toHaveLength(2);
    setDisplayWriteBeginHandler(null);
  });

  it("R4 auth stale is not retried as write stale, even when a write settles at the same time", async () => {
    const write = deferredResponse();
    const read = deferredResponse();
    let reads = 0;
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL) => {
      if (String(input).endsWith("/enabled-tables")) return write.promise;
      reads += 1;
      return read.promise;
    }));
    const query = sourcesQueryOptions().queryFn({ signal: new AbortController().signal } as never);
    const saving = apiPut("/api/connections/c1/enabled-tables", { dryRun: false, enabledTables: [] });
    bumpAuthEpoch();
    write.resolve(json({ written: true }));
    read.resolve(json({ tables: ["old-account"] }));
    const error = await query.catch((e: unknown) => e);
    await saving.catch(() => undefined);
    expect(isStaleResponseError(error)).toBe(true);
    expect(isWriteStaleResponseError(error)).toBe(false);
    expect(reads).toBe(1);
  });

  it("R4 public reads are not deferred by display writes", async () => {
    const write = deferredResponse();
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL) => (String(input).endsWith("/enabled-tables") ? write.promise : Promise.resolve(json({ sections: [] })))));
    const saving = apiPut("/api/connections/c1/enabled-tables", { dryRun: false, enabledTables: [] });
    await expect(apiGet("/api/help/handbook")).resolves.toEqual({ sections: [] });
    write.resolve(json({ written: true }));
    await saving;
  });

  it("R4 the shared display query keys are the ones the write sync invalidates", () => {
    expect(DISPLAY_SCOPE_QUERY_KEYS.sources).toEqual(sourcesQueryOptions().queryKey);
    expect(DISPLAY_SCOPE_QUERY_KEYS.project).toEqual(projectQueryOptions().queryKey);
    expect(DISPLAY_SCOPE_QUERY_KEYS.agents).toEqual(adminAgentsQueryOptions().queryKey);
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
