// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UI_PAGE_VIEW_DEBOUNCE_MS, useUiPageViewBeacon } from "../app/ui-usage-beacon";

function Probe() {
  const location = useLocation();
  const navigate = useNavigate();
  useUiPageViewBeacon(location.pathname, { mode: "open", me: null, authEnabled: false });
  return (
    <button type="button" onClick={() => navigate("/wiki?from=palette")}>
      去 Wiki
    </button>
  );
}

function HelpProbe() {
  const location = useLocation();
  useUiPageViewBeacon(location.pathname, { mode: "required", me: null, authEnabled: true });
  return <div>help</div>;
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

beforeEach(() => {
  vi.useFakeTimers();
});

describe("ui page view beacon", () => {
  it("posts the pathname once and ignores query-only changes", async () => {
    const posts: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/admin/ui-usage/page-view") {
        posts.push(String(init?.body));
      }
      return new Response(JSON.stringify({ ok: true, data: { recorded: true, mode: "open", me: null, authEnabled: false } }));
    }));

    render(
      <MemoryRouter initialEntries={["/catalog?hours=24"]}>
        <Routes>
          <Route path="*" element={<Probe />} />
        </Routes>
      </MemoryRouter>
    );

    await vi.advanceTimersByTimeAsync(UI_PAGE_VIEW_DEBOUNCE_MS);
    expect(posts).toEqual([JSON.stringify({ pathname: "/catalog" })]);

    fireEvent.click(screen.getByRole("button", { name: "去 Wiki" }));
    await vi.advanceTimersByTimeAsync(UI_PAGE_VIEW_DEBOUNCE_MS);
    expect(posts).toEqual([
      JSON.stringify({ pathname: "/catalog" }),
      JSON.stringify({ pathname: "/wiki" })
    ]);
  });

  it("keeps only the settled path when navigation happens before the debounce", async () => {
    const posts: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/admin/ui-usage/page-view") posts.push(String(init?.body));
      return new Response(JSON.stringify({ ok: true, data: { recorded: true } }));
    }));

    function Hopper() {
      const location = useLocation();
      const navigate = useNavigate();
      useUiPageViewBeacon(location.pathname, { mode: "open", me: null, authEnabled: false });
      return <button type="button" onClick={() => navigate("/admin/usage")}>settle</button>;
    }

    render(
      <MemoryRouter initialEntries={["/admin/governance"]}>
        <Routes>
          <Route path="*" element={<Hopper />} />
        </Routes>
      </MemoryRouter>
    );
    fireEvent.click(screen.getByRole("button", { name: "settle" }));
    await vi.advanceTimersByTimeAsync(UI_PAGE_VIEW_DEBOUNCE_MS);
    expect(posts).toEqual([JSON.stringify({ pathname: "/admin/usage" })]);
  });

  it("does not record help while logged out", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      void input;
      return new Response(JSON.stringify({ ok: true, data: {} }));
    });
    vi.stubGlobal("fetch", fetchMock);
    render(
      <MemoryRouter initialEntries={["/help"]}>
        <HelpProbe />
      </MemoryRouter>
    );
    await vi.advanceTimersByTimeAsync(UI_PAGE_VIEW_DEBOUNCE_MS);
    const urls = fetchMock.mock.calls.map(([input]) => String(input));
    expect(urls.some((url) => url.includes("/api/admin/ui-usage/page-view"))).toBe(false);
  });
});
