import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, apiDelete, apiGet, apiPatch, apiPost, apiPut, bumpAuthEpoch, isStaleResponseError, setAuthLostHandler } from "../lib/apiClient";
import { fetchSkills } from "../lib/skills";

afterEach(() => {
  vi.unstubAllGlobals();
  setAuthLostHandler(null);
});

describe("Spec 174 T5 — request AbortSignal pass-through", () => {
  it("passes the signal through apiGet / apiPost and keeps the legacy call shape", async () => {
    const calls: Array<RequestInit | undefined> = [];
    vi.stubGlobal("fetch", vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      calls.push(init);
      return new Response(JSON.stringify({ ok: true, data: { status: "ok" } }));
    }));
    const controller = new AbortController();
    await apiPost("/api/connections/c1/test", { purpose: "automatic" }, { signal: controller.signal });
    await apiGet("/api/connections/c1/live-schemas?purpose=automatic", { signal: controller.signal });
    await apiPost("/api/connections/c1/test", {});
    expect(calls[0]?.signal).toBe(controller.signal);
    expect(JSON.parse(String(calls[0]?.body))).toEqual({ purpose: "automatic" });
    expect(calls[1]?.signal).toBe(controller.signal);
    expect(calls[2]?.signal).toBeUndefined();
  });

  it("rejects with AbortError when the caller aborts", async () => {
    vi.stubGlobal("fetch", vi.fn((_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
    })));
    const controller = new AbortController();
    const pending = apiPost("/api/connections/c1/test", { purpose: "automatic" }, { signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  });
});

type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
const METHODS: Method[] = ["GET", "POST", "PUT", "PATCH", "DELETE"];
/** Real consumer endpoints per method (POST covers test / preview / Token creation). */
const PATHS: Record<Method, string[]> = {
  GET: ["/api/admin/agents/a1"],
  POST: ["/api/connections/c1/test", "/api/admin/roles/r1/preview", "/api/admin/agents/a1/tokens"],
  PUT: ["/api/connections/c1/enabled-tables"],
  PATCH: ["/api/admin/agents/a1"],
  DELETE: ["/api/admin/agents/a1/tokens/laptop"]
};

function call(method: Method, path: string, signal?: AbortSignal): Promise<unknown> {
  const body = { dryRun: false };
  switch (method) {
    case "GET":
      return apiGet(path, { signal });
    case "POST":
      return apiPost(path, body, { signal });
    case "PUT":
      return apiPut(path, body, { signal });
    case "PATCH":
      return apiPatch(path, body, { signal });
    case "DELETE":
      return apiDelete(path, body, { signal });
  }
}

function envelope(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), { status, headers: { "Content-Type": "application/json" } });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe("Spec 174 R2 — every protected method shares the account epoch and 401 boundary (SC-08/18)", () => {
  for (const method of METHODS) {
    for (const path of PATHS[method]) {
      describe(`${method} ${path}`, () => {
        it("A→B: an old-account success (fetch ignored abort) is rejected, not returned as data", async () => {
          const pending = deferred<Response>();
          const fetchMock = vi.fn((_input: RequestInfo | URL, _init?: RequestInit) => pending.promise);
          vi.stubGlobal("fetch", fetchMock);
          const controller = new AbortController();
          const request = call(method, path, controller.signal);
          bumpAuthEpoch();
          controller.abort();
          pending.resolve(envelope(200, { ok: true, data: { token: "old-account-secret", result: "ok" } }));
          const error = await request.catch((e: unknown) => e);
          expect(isStaleResponseError(error)).toBe(true);
          expect(String((error as Error).message)).not.toContain("old-account-secret");
          expect(fetchMock).toHaveBeenCalledTimes(1);
          expect(fetchMock.mock.calls[0]?.[1]?.signal).toBe(controller.signal);
        });

        it("an old-account error envelope is stale (no old Toast message)", async () => {
          const pending = deferred<Response>();
          vi.stubGlobal("fetch", vi.fn(() => pending.promise));
          const request = call(method, path);
          bumpAuthEpoch();
          pending.resolve(envelope(400, { ok: false, error: { code: "BAD_REQUEST", message: "旧账户错误" } }));
          const error = await request.catch((e: unknown) => e);
          expect(isStaleResponseError(error)).toBe(true);
        });

        it("logout while response.json() is still being read rejects the result", async () => {
          const body = deferred<unknown>();
          const response = { status: 200, json: () => body.promise } as unknown as Response;
          vi.stubGlobal("fetch", vi.fn(async () => response));
          const request = call(method, path);
          await new Promise((resolve) => setTimeout(resolve, 0));
          bumpAuthEpoch();
          body.resolve({ ok: true, data: { token: "late" } });
          expect(isStaleResponseError(await request.catch((e: unknown) => e))).toBe(true);
        });

        it("a current protected AUTH_REQUIRED 401 runs the auth-lost cleanup", async () => {
          const authLost = vi.fn();
          setAuthLostHandler(authLost);
          vi.stubGlobal("fetch", vi.fn(async () => envelope(401, { ok: false, error: { code: "AUTH_REQUIRED", message: "需要登录" } })));
          const error = await call(method, path).catch((e: unknown) => e);
          expect(error).toBeInstanceOf(ApiError);
          expect((error as ApiError).code).toBe("AUTH_REQUIRED");
          expect(authLost).toHaveBeenCalledTimes(1);
        });

        it("an old-account 401 does not log out the new session", async () => {
          const authLost = vi.fn();
          setAuthLostHandler(authLost);
          const pending = deferred<Response>();
          vi.stubGlobal("fetch", vi.fn(() => pending.promise));
          const request = call(method, path);
          bumpAuthEpoch();
          pending.resolve(envelope(401, { ok: false, error: { code: "AUTH_REQUIRED", message: "需要登录" } }));
          expect(isStaleResponseError(await request.catch((e: unknown) => e))).toBe(true);
          expect(authLost).not.toHaveBeenCalled();
        });

        it("403 keeps the permission error semantics", async () => {
          const authLost = vi.fn();
          setAuthLostHandler(authLost);
          vi.stubGlobal("fetch", vi.fn(async () => envelope(403, { ok: false, error: { code: "FORBIDDEN", message: "无权限" } })));
          const error = await call(method, path).catch((e: unknown) => e);
          expect((error as ApiError).code).toBe("FORBIDDEN");
          expect(authLost).not.toHaveBeenCalled();
        });
      });
    }
  }

  it("login failure (AUTH_INVALID) does not trigger the auth-lost cleanup", async () => {
    const authLost = vi.fn();
    setAuthLostHandler(authLost);
    vi.stubGlobal("fetch", vi.fn(async () => envelope(401, { ok: false, error: { code: "AUTH_INVALID", message: "管理员 id 或密码不正确" } })));
    await expect(apiPost("/api/auth/login", { adminId: "a", password: "b" })).rejects.toMatchObject({ code: "AUTH_INVALID" });
    expect(authLost).not.toHaveBeenCalled();
  });

  it("direct-fetch Skill reads reject an old-account response", async () => {
    const pending = deferred<Response>();
    vi.stubGlobal("fetch", vi.fn(() => pending.promise));
    const request = fetchSkills();
    bumpAuthEpoch();
    pending.resolve(envelope(200, { ok: true, skills: [{ name: "old-account-skill" }] }));
    expect(isStaleResponseError(await request.catch((e: unknown) => e))).toBe(true);
  });
});
