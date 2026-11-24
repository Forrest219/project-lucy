// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiDownloadLink } from "../components/ApiDownloadLink";

let anchorClicks: Array<{ download: string }>;

beforeEach(() => {
  anchorClicks = [];
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
    anchorClicks.push({ download: this.download });
  });
  vi.stubGlobal("URL", Object.assign(URL, {
    createObjectURL: vi.fn(() => "blob:mock"),
    revokeObjectURL: vi.fn()
  }));
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function renderLink() {
  render(
    <ApiDownloadLink href="/api/admin/audit/export" fallbackFilename="audit.csv" data-testid="dl" className="pl-btn">
      导出
    </ApiDownloadLink>
  );
  return screen.getByTestId("dl");
}

describe("ApiDownloadLink", () => {
  it("keeps a real download anchor so open-in-new-tab and no-JS still work", () => {
    const link = renderLink();
    expect(link.tagName).toBe("A");
    expect(link).toHaveAttribute("href", "/api/admin/audit/export");
    expect(link).toHaveAttribute("download");
  });

  it("tells the user when the endpoint refuses, instead of staying silent", async () => {
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response(JSON.stringify({ ok: false, error: { code: "X", message: "正式对账读取失败" } }), { status: 409 })
    ));
    const errorSpy = vi.spyOn(toast, "error").mockImplementation(() => "");

    const link = renderLink();
    const notPrevented = fireEvent.click(link);

    expect(notPrevented).toBe(false);
    await waitFor(() => expect(errorSpy).toHaveBeenCalledTimes(1));
    expect(String(errorSpy.mock.calls[0]?.[0])).toContain("正式对账读取失败");
    expect(anchorClicks).toEqual([]);
  });

  it("saves the file and shows no error when the endpoint succeeds", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("a,b\n", { status: 200 })));
    const errorSpy = vi.spyOn(toast, "error").mockImplementation(() => "");

    fireEvent.click(renderLink());

    await waitFor(() => expect(anchorClicks).toEqual([{ download: "audit.csv" }]));
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("lets the browser handle modified clicks (new tab / save-as) natively", () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const link = renderLink();
    const notPrevented = fireEvent.click(link, { ctrlKey: true });

    expect(notPrevented).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("ignores a second click while the first download is still running", async () => {
    let release: (value: Response) => void = () => {};
    const fetchSpy = vi.fn(() => new Promise<Response>((resolve) => { release = resolve; }));
    vi.stubGlobal("fetch", fetchSpy);

    const link = renderLink();
    fireEvent.click(link);
    fireEvent.click(link);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(link).toHaveAttribute("aria-busy", "true");

    release(new Response("x", { status: 200 }));
    await waitFor(() => expect(link).not.toHaveAttribute("aria-busy", "true"));
  });
});
