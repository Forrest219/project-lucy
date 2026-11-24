// @vitest-environment jsdom
//
// P1-42 — a download button must say so when the file could not be fetched.
// A plain `<a href download>` hides every HTTP failure inside the browser's own
// download bar; `downloadApiFile` fetches once, checks the result, and only then
// saves, so the UI can report a failure honestly.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { downloadApiFile, LARGE_DOWNLOAD_BYTES } from "../lib/downloadApiFile";

type Click = { href: string; download: string };

let clicks: Click[];
let revoked: string[];

beforeEach(() => {
  clicks = [];
  revoked = [];
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
    clicks.push({ href: this.href, download: this.download });
  });
  vi.stubGlobal("URL", Object.assign(URL, {
    createObjectURL: vi.fn(() => "blob:mock-1"),
    revokeObjectURL: vi.fn((url: string) => revoked.push(url))
  }));
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("downloadApiFile", () => {
  it("reports the server's own message when the endpoint refuses", async () => {
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response(JSON.stringify({ ok: false, error: { code: "RECONCILIATION_AS_OF_S_UNPROVABLE", message: "正式对账读取失败" } }), {
        status: 409,
        headers: { "content-type": "application/json" }
      })
    ));

    const result = await downloadApiFile("/api/admin/audit/reconciliation/export?hours=24", "export.zip");

    expect(result).toEqual({ ok: false, message: "正式对账读取失败", status: 409 });
    expect(clicks).toEqual([]);
  });

  it("falls back to the HTTP status when the failure body is not an error envelope", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("boom", { status: 502 })));

    const result = await downloadApiFile("/api/x", "x.csv");

    expect(result).toMatchObject({ ok: false, status: 502 });
    expect((result as { message: string }).message).toContain("502");
    expect(clicks).toEqual([]);
  });

  it("reports a network failure instead of throwing", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    }));

    const result = await downloadApiFile("/api/x", "x.csv");

    expect(result.ok).toBe(false);
    expect(clicks).toEqual([]);
  });

  it("does not save an empty body as a successful download", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 200 })));

    const result = await downloadApiFile("/api/x", "x.csv");

    expect(result).toMatchObject({ ok: false });
    expect((result as { message: string }).message).toContain("空");
    expect(clicks).toEqual([]);
  });

  it("saves the file under the server-provided filename and releases the blob URL", async () => {
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response("a,b\n1,2\n", {
        status: 200,
        headers: { "content-disposition": "attachment; filename=\"audit-turns-1.csv\"" }
      })
    ));

    const result = await downloadApiFile("/api/x", "fallback.csv");

    expect(result).toEqual({ ok: true, filename: "audit-turns-1.csv", size: 8 });
    expect(clicks).toEqual([{ href: "blob:mock-1", download: "audit-turns-1.csv" }]);
    expect(revoked).toEqual(["blob:mock-1"]);
  });

  it("decodes an RFC 5987 filename*", async () => {
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response("x", {
        status: 200,
        headers: { "content-disposition": "attachment; filename*=UTF-8''%E5%AE%A1%E8%AE%A1.csv" }
      })
    ));

    const result = await downloadApiFile("/api/x", "fallback.csv");

    expect(result).toMatchObject({ ok: true, filename: "审计.csv" });
  });

  it("uses the fallback filename when the server sends none", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("x", { status: 200 })));

    const result = await downloadApiFile("/api/x", "fallback.csv");

    expect(result).toMatchObject({ ok: true, filename: "fallback.csv" });
  });

  // Main-path escape: a very large export must not be held in browser memory.
  it("hands very large files to the browser's native download instead of buffering them", async () => {
    const body = vi.fn();
    vi.stubGlobal("fetch", vi.fn(async () => {
      const response = new Response("x", {
        status: 200,
        headers: { "content-length": String(LARGE_DOWNLOAD_BYTES + 1) }
      });
      Object.defineProperty(response, "blob", { value: body });
      return response;
    }));

    const result = await downloadApiFile("/api/big", "big.zip");

    expect(result).toMatchObject({ ok: true, native: true });
    expect(body).not.toHaveBeenCalled();
    expect(clicks).toHaveLength(1);
    expect(clicks[0]?.href).toContain("/api/big");
  });
});
