import { describe, expect, it, vi } from "vitest";
import { CHUNK_RELOAD_SESSION_KEY, isChunkLoadError, loadWithChunkRecovery } from "../lib/routeChunkRecovery";

function memorySession() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
    removeItem: (key: string) => void values.delete(key),
    values
  };
}

const chunkError = () => new TypeError("Failed to fetch dynamically imported module: http://x/assets/Catalog-abc.js");

describe("Spec 174 T4 — route chunk recovery (SC-12)", () => {
  it("recognises chunk load failures only", () => {
    expect(isChunkLoadError(chunkError())).toBe(true);
    expect(isChunkLoadError(new Error("Unable to preload CSS for /assets/x.css"))).toBe(true);
    expect(isChunkLoadError(new Error("Cannot read properties of undefined"))).toBe(false);
  });

  it("reloads once per session, then surfaces the error instead of looping", async () => {
    const session = memorySession();
    const reload = vi.fn();
    const pending = loadWithChunkRecovery(() => Promise.reject(chunkError()), { reload, session });
    await Promise.resolve();
    await Promise.resolve();
    expect(reload).toHaveBeenCalledTimes(1);
    expect(session.getItem(CHUNK_RELOAD_SESSION_KEY)).not.toBeNull();
    void pending;

    await expect(loadWithChunkRecovery(() => Promise.reject(chunkError()), { reload, session })).rejects.toThrow(/dynamically imported/);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("does not reload for non-chunk errors and re-arms after a successful load", async () => {
    const session = memorySession();
    const reload = vi.fn();
    await expect(loadWithChunkRecovery(() => Promise.reject(new Error("boom")), { reload, session })).rejects.toThrow("boom");
    expect(reload).not.toHaveBeenCalled();
    session.setItem(CHUNK_RELOAD_SESSION_KEY, "1");
    await expect(loadWithChunkRecovery(() => Promise.resolve({ ok: true }), { reload, session })).resolves.toEqual({ ok: true });
    expect(session.getItem(CHUNK_RELOAD_SESSION_KEY)).toBeNull();
  });
});
