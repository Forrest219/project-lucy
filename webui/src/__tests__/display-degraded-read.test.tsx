// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider, QueryObserver } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ApiError,
  DISPLAY_PENDING,
  DisplayPendingError,
  apiGet,
  bumpAuthEpoch,
  isDisplayPendingError,
  isRetryableDisplayReadError
} from "../lib/apiClient";
import {
  DISPLAY_READ_REQUEST_TIMEOUT_MS,
  DISPLAY_REGION_PATHS,
  adminRolesQueryOptions,
  sourcesQueryOptions
} from "../lib/displayQueryOptions";
import {
  DISPLAY_DEGRADED_POLL_MS,
  clearDisplayInfo,
  displayPollInterval,
  getDisplayInfo,
  parseDisplayEnvelope,
  parseDisplayHeaders,
  setDisplayInfo,
  worstDisplayInfo
} from "../lib/displayState";
import {
  DEGRADED_COPY,
  DisplayDegradedNotice,
  degradedMainText,
  formatDisplayAge
} from "../components/DisplayDegradedNotice";

afterEach(() => {
  cleanup();
  clearDisplayInfo();
  vi.unstubAllGlobals();
});

function reply(body: unknown, headers: Record<string, string> = {}, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });
}

const testClient = new QueryClient();
const wrap = (node: ReactElement) => <QueryClientProvider client={testClient}>{node}</QueryClientProvider>;

const PENDING_HEADERS = {
  "X-Lucy-Display-State": "pending",
  "X-Lucy-Display-Generation": "L7",
  "X-Lucy-Display-Pending-Ms": "1500"
};
const pendingBody = { ok: true, data: null, display: { state: "pending", generation: "L7", pendingMs: 1500 } };

describe("P1-75 X5 — response header / envelope parsing", () => {
  it("reads the frozen headers; no state header means fresh", () => {
    const stale = parseDisplayHeaders(
      new Headers({
        "X-Lucy-Display-State": "stale",
        "X-Lucy-Display-Age-Ms": "125000",
        "X-Lucy-Display-Generation": "L3",
        "X-Lucy-Display-Prolonged": "1"
      })
    );
    expect(stale).toEqual({ state: "stale", ageMs: 125000, generation: "L3", pendingMs: undefined, prolonged: true });
    expect(parseDisplayHeaders(new Headers())).toBeNull();
    expect(parseDisplayHeaders(new Headers({ "X-Lucy-Display-State": "weird" }))).toBeNull();
    expect(parseDisplayHeaders(undefined)).toBeNull();
  });

  it("falls back to the pending envelope when headers are stripped", () => {
    expect(parseDisplayEnvelope(pendingBody.display)).toMatchObject({ state: "pending", pendingMs: 1500, prolonged: false });
    expect(parseDisplayEnvelope({ state: "stale", ageMs: 1, prolonged: true })?.prolonged).toBe(true);
    expect(parseDisplayEnvelope(undefined)).toBeNull();
  });
});

describe("P1-75 X5 — apiGet consumes the degraded carrier", () => {
  it("pending: never returns data:null — throws DisplayPendingError and records the state", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => reply(pendingBody, PENDING_HEADERS)));
    const error = await apiGet("/api/sources?x=1", { displayRead: "sources" }).catch((e: unknown) => e);
    expect(isDisplayPendingError(error)).toBe(true);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as DisplayPendingError).code).toBe(DISPLAY_PENDING);
    expect(getDisplayInfo(DISPLAY_REGION_PATHS.sources)).toMatchObject({ state: "pending", pendingMs: 1500 });
  });

  it("pending without headers is still recognised from the body", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => reply(pendingBody)));
    await expect(apiGet("/api/project", { displayRead: "project" })).rejects.toBeInstanceOf(DisplayPendingError);
    expect(getDisplayInfo(DISPLAY_REGION_PATHS.project)?.state).toBe("pending");
  });

  it("grace/stale: normal business data is returned and the marker is recorded; a fresh read clears it", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(reply({ ok: true, data: { tables: [1] } }, { "X-Lucy-Display-State": "stale", "X-Lucy-Display-Age-Ms": "200000" }))
      .mockResolvedValueOnce(reply({ ok: true, data: { tables: [2] } }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(apiGet("/api/sources", { displayRead: "sources" })).resolves.toEqual({ tables: [1] });
    expect(getDisplayInfo("/api/sources")).toMatchObject({ state: "stale", ageMs: 200000 });
    await expect(apiGet("/api/sources", { displayRead: "sources" })).resolves.toEqual({ tables: [2] });
    expect(getDisplayInfo("/api/sources")).toBeNull();
  });

  it("an auth boundary drops every recorded marker", () => {
    setDisplayInfo("/api/sources", { state: "grace", prolonged: false });
    bumpAuthEpoch();
    expect(getDisplayInfo("/api/sources")).toBeNull();
  });
});

describe("P1-75 X5 — query layer: pending stays loading and polls until fresh", () => {
  it("pending → retried without surfacing data:null or an error, then fresh data", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(reply(pendingBody, PENDING_HEADERS))
      .mockResolvedValueOnce(reply(pendingBody, PENDING_HEADERS))
      .mockResolvedValueOnce(reply({ ok: true, data: { tables: [{ id: "t" }] } }));
    vi.stubGlobal("fetch", fetchMock);
    const client = new QueryClient();
    const observer = new QueryObserver(client, { ...sourcesQueryOptions(), retryDelay: 0 });
    const results: Array<{ status: string; data: unknown }> = [];
    const done = new Promise<void>((resolve) => {
      const off = observer.subscribe((result) => {
        results.push({ status: result.status, data: result.data });
        if (result.status === "success") {
          off();
          resolve();
        }
      });
    });
    await done;
    // Until a real view exists the query is loading with no data: never an error, never data:null.
    const beforeSuccess = results.slice(0, -1);
    expect(beforeSuccess.length).toBeGreaterThan(0);
    expect(beforeSuccess.every((r) => r.status === "pending" && r.data === undefined)).toBe(true);
    expect(results.at(-1)?.data).toEqual({ tables: [{ id: "t" }] });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(getDisplayInfo(DISPLAY_REGION_PATHS.sources)).toBeNull();
  });

  it("pending is never an error: it keeps retrying past the bounded retry used for 503", async () => {
    const fetchMock = vi.fn(async () => reply(pendingBody, PENDING_HEADERS));
    vi.stubGlobal("fetch", fetchMock);
    const retry = sourcesQueryOptions().retry as (count: number, error: unknown) => boolean;
    expect(retry(0, new DisplayPendingError({ state: "pending", prolonged: false }))).toBe(true);
    expect(retry(40, new DisplayPendingError({ state: "pending", prolonged: true }))).toBe(true);
  });

  it("I-1: a pending answered at the server's 10 s build wait is pending, never a read timeout", async () => {
    vi.useFakeTimers();
    try {
      // Server holds the request to its 10 s budget (+ margin), then answers pending; honors abort like fetch.
      const fetchMock = vi.fn(
        (_input: RequestInfo | URL, init?: RequestInit) =>
          new Promise<Response>((resolve, reject) => {
            const timer = setTimeout(() => resolve(reply(pendingBody, PENDING_HEADERS)), 10_500);
            init?.signal?.addEventListener("abort", () => {
              clearTimeout(timer);
              reject(new DOMException("aborted", "AbortError"));
            });
          })
      );
      vi.stubGlobal("fetch", fetchMock);
      expect(DISPLAY_READ_REQUEST_TIMEOUT_MS).toBeGreaterThan(10_000);
      const outcome = new QueryClient().fetchQuery({ ...sourcesQueryOptions(), retry: false }).then(
        () => "resolved" as const,
        (error: unknown) => (isDisplayPendingError(error) ? ("pending" as const) : (error as { code?: string }).code ?? "other")
      );
      await vi.advanceTimersByTimeAsync(10_600);
      expect(await outcome).toBe("pending");
    } finally {
      vi.useRealTimers();
    }
  });

  it("503 retry is narrowed: write_pending / unknown BUSY once, A-class reasons and C never", () => {
    const busy = (reason?: string) => Object.assign(new ApiError({ code: "DISPLAY_SNAPSHOT_BUSY", message: "x" }), { httpStatus: 503, busyReason: reason });
    expect(isRetryableDisplayReadError(busy("write_pending"))).toBe(true);
    expect(isRetryableDisplayReadError(busy())).toBe(true);
    expect(isRetryableDisplayReadError(busy("build_wait_timeout"))).toBe(false);
    expect(isRetryableDisplayReadError(busy("metadata_overdue"))).toBe(false);
    expect(
      isRetryableDisplayReadError(Object.assign(new ApiError({ code: "DISPLAY_RECONCILIATION_FAILED", message: "x" }), { httpStatus: 503 }))
    ).toBe(false);
    const retry = adminRolesQueryOptions().retry as (count: number, error: unknown) => boolean;
    expect(retry(0, busy("write_pending"))).toBe(true);
    expect(retry(1, busy("write_pending"))).toBe(false);
  });

  it("503 carries X-Lucy-Busy-Reason onto the error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        reply({ ok: false, error: { code: "DISPLAY_SNAPSHOT_BUSY", message: "忙" } }, { "X-Lucy-Busy-Reason": "write_pending" }, 503)
      )
    );
    const error = (await apiGet("/api/admin/roles").catch((e: unknown) => e)) as ApiError;
    expect(error.busyReason).toBe("write_pending");
  });

  it("self-polls only while the region is stale or pending", () => {
    const interval = displayPollInterval("/api/sources");
    expect(interval()).toBe(false);
    setDisplayInfo("/api/sources", { state: "grace", prolonged: false });
    expect(interval()).toBe(false);
    setDisplayInfo("/api/sources", { state: "stale", ageMs: 1, prolonged: false });
    expect(interval()).toBe(DISPLAY_DEGRADED_POLL_MS);
    setDisplayInfo("/api/sources", { state: "pending", prolonged: false });
    expect(interval()).toBe(DISPLAY_DEGRADED_POLL_MS);
    expect(DISPLAY_DEGRADED_POLL_MS).toBeGreaterThanOrEqual(2000);
    expect(DISPLAY_DEGRADED_POLL_MS).toBeLessThanOrEqual(5000);
    setDisplayInfo("/api/sources", null);
    expect(interval()).toBe(false);
    expect(sourcesQueryOptions().refetchInterval).toBeTypeOf("function");
  });
});

describe("P1-75 交互合同 §3 — DisplayDegradedNotice copy", () => {
  const FORBIDDEN = /degraded|grace|stale|pending|busyReason|D_max|DISPLAY_|\d+\s*ms|毫秒|服务繁忙|系统异常|读取失败|服务故障|已是最新|暂无数据/i;

  it("renders nothing while fresh", () => {
    const { container } = render(wrap(<DisplayDegradedNotice paths={["/api/sources"]} />));
    expect(container.firstChild).toBeNull();
  });

  it("grace and stale: 数据可能不是最新 (+ 约 N 分钟前更新 only from one minute)", () => {
    setDisplayInfo("/api/sources", { state: "grace", ageMs: 30_000, prolonged: false });
    const { rerender } = render(wrap(<DisplayDegradedNotice paths={["/api/sources"]} onRefresh={vi.fn()} />));
    expect(screen.getByTestId("display-degraded-notice-text")).toHaveTextContent("数据可能不是最新");
    expect(screen.queryByTestId("display-degraded-notice-age")).toBeNull();
    act(() => setDisplayInfo("/api/sources", { state: "stale", ageMs: 185_000, prolonged: false }));
    rerender(wrap(<DisplayDegradedNotice paths={["/api/sources"]} onRefresh={vi.fn()} />));
    expect(screen.getByTestId("display-degraded-notice-age")).toHaveTextContent("约 3 分钟前更新");
    expect(screen.getByTestId("display-degraded-notice")).toHaveAttribute("role", "status");
  });

  it("pending: 正在加载… with no age; page may keep its own pending copy (P1-80)", () => {
    setDisplayInfo("/api/sources", { state: "pending", pendingMs: 4000, prolonged: false });
    const { rerender } = render(wrap(<DisplayDegradedNotice paths={["/api/sources"]} />));
    expect(screen.getByTestId("display-degraded-notice")).toHaveTextContent("正在加载…");
    expect(screen.queryByTestId("display-degraded-notice-age")).toBeNull();
    rerender(wrap(<DisplayDegradedNotice paths={["/api/sources"]} pendingText="正在读取表清单…" />));
    expect(screen.getByTestId("display-degraded-notice")).toHaveTextContent("正在读取表清单…");
  });

  it("prolonged replaces the main sentence, keeps the age and the refresh entry, and is not an error", () => {
    setDisplayInfo("/api/sources", { state: "stale", ageMs: 240_000, prolonged: true });
    render(wrap(<DisplayDegradedNotice paths={["/api/sources"]} onRefresh={vi.fn()} />));
    const notice = screen.getByTestId("display-degraded-notice");
    expect(notice).toHaveTextContent("长时间未更新");
    expect(notice).not.toHaveTextContent("数据可能不是最新");
    expect(notice).toHaveTextContent("约 4 分钟前更新");
    expect(notice).not.toHaveAttribute("role", "alert");
    expect(notice.className).not.toMatch(/error|danger|validation_failed/);
  });

  it("refresh runs the page refetch and is disabled while refreshing", async () => {
    setDisplayInfo("/api/sources", { state: "stale", ageMs: 90_000, prolonged: false });
    const onRefresh = vi.fn();
    const { rerender } = render(wrap(<DisplayDegradedNotice paths={["/api/sources"]} onRefresh={onRefresh} />));
    const button = screen.getByTestId("display-degraded-notice-refresh");
    expect(button).toHaveTextContent(DEGRADED_COPY.refresh);
    fireEvent.click(button);
    await waitFor(() => expect(onRefresh).toHaveBeenCalledTimes(1));
    rerender(wrap(<DisplayDegradedNotice paths={["/api/sources"]} onRefresh={onRefresh} refreshing />));
    expect(screen.getByTestId("display-degraded-notice-refresh")).toBeDisabled();
  });

  it("appears and clears reactively; covers several regions with the worst state", () => {
    setDisplayInfo("/api/project", { state: "grace", ageMs: 10, prolonged: false });
    render(wrap(<DisplayDegradedNotice paths={["/api/project", "/api/sources"]} />));
    expect(screen.getByTestId("display-degraded-notice")).toHaveAttribute("data-display-state", "grace");
    act(() => setDisplayInfo("/api/sources", { state: "pending", prolonged: false }));
    expect(screen.getByTestId("display-degraded-notice")).toHaveAttribute("data-display-state", "pending");
    expect(worstDisplayInfo(["/api/project", "/api/sources"])?.state).toBe("pending");
    act(() => {
      setDisplayInfo("/api/project", null);
      setDisplayInfo("/api/sources", null);
    });
    expect(screen.queryByTestId("display-degraded-notice")).toBeNull();
  });

  it("user-visible text never contains internal state words, codes, milliseconds or forbidden copy", () => {
    const states = [
      { state: "grace", ageMs: 61_000, prolonged: false },
      { state: "stale", ageMs: 600_000, generation: "L9", prolonged: true },
      { state: "pending", pendingMs: 12_345, generation: "L9", prolonged: false }
    ] as const;
    for (const info of states) {
      clearDisplayInfo();
      setDisplayInfo("/api/sources", { ...info });
      const { unmount, container } = render(wrap(<DisplayDegradedNotice paths={["/api/sources"]} onRefresh={vi.fn()} />));
      expect(container.textContent ?? "").not.toMatch(FORBIDDEN);
      unmount();
    }
    expect(formatDisplayAge(59_999)).toBeNull();
    expect(formatDisplayAge(undefined)).toBeNull();
    expect(degradedMainText({ state: "stale", prolonged: false })).toBe("数据可能不是最新");
  });
});
