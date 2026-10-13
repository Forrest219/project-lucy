import { afterEach, describe, expect, it, vi } from "vitest";
import { apiGet, apiPost } from "../lib/apiClient";

afterEach(() => vi.unstubAllGlobals());

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
