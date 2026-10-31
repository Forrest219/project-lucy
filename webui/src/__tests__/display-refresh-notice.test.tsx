// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DisplayRefreshNotice, formatLastSuccessfulRead } from "../components/DisplayRefreshNotice";

afterEach(() => {
  cleanup();
});

describe("Spec 195 §7 / SI-13 — refresh failure keeps the current data on screen", () => {
  it("shows nothing while the first load has not produced data", () => {
    const { container } = render(
      <DisplayRefreshNotice query={{ data: undefined, isError: true, dataUpdatedAt: 0 }} />
    );
    expect(container.firstChild).toBeNull();
  });

  it("shows nothing while the query is healthy", () => {
    const { container } = render(
      <DisplayRefreshNotice query={{ data: { rows: [] }, isError: false, dataUpdatedAt: 1 }} />
    );
    expect(container.firstChild).toBeNull();
  });

  it("states the failure, the last successful read and offers a retry", () => {
    const refetch = vi.fn();
    render(
      <DisplayRefreshNotice
        query={{
          data: { rows: [1] },
          isError: true,
          dataUpdatedAt: Date.parse("2026-10-30T10:00:00Z"),
          refetch
        }}
      />
    );
    const notice = screen.getByTestId("display-refresh-notice");
    expect(notice).toHaveTextContent("刷新失败，当前显示上次成功读取的数据。");
    expect(screen.getByTestId("display-refresh-notice-time")).toHaveTextContent("上次成功读取：");
    fireEvent.click(screen.getByTestId("display-refresh-retry"));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it("uses the last successful read time, never the cached build time", () => {
    const builtAt = Date.parse("2020-01-01T00:00:00Z");
    const readAt = Date.parse("2026-10-30T10:00:00Z");
    render(
      <DisplayRefreshNotice
        query={{
          data: { meta: { generatedAt: new Date(builtAt).toISOString() } },
          isError: true,
          dataUpdatedAt: readAt,
          refetch: vi.fn()
        }}
      />
    );
    const time = screen.getByTestId("display-refresh-notice-time").textContent ?? "";
    expect(time).toContain(formatLastSuccessfulRead(readAt));
    expect(time).not.toContain(formatLastSuccessfulRead(builtAt));
    expect(time).not.toContain("2020");
  });

  it("disables the retry button while a refetch is running", () => {
    render(
      <DisplayRefreshNotice
        query={{ data: { rows: [] }, isError: true, isFetching: true, dataUpdatedAt: 1, refetch: vi.fn() }}
      />
    );
    expect(screen.getByTestId("display-refresh-retry")).toBeDisabled();
  });

  it("clears the notice once the refresh succeeds", async () => {
    const { rerender } = render(
      <DisplayRefreshNotice query={{ data: { rows: [] }, isError: true, dataUpdatedAt: 1, refetch: vi.fn() }} />
    );
    expect(screen.getByTestId("display-refresh-notice")).toBeInTheDocument();
    rerender(
      <DisplayRefreshNotice query={{ data: { rows: [] }, isError: false, dataUpdatedAt: 2, refetch: vi.fn() }} />
    );
    await waitFor(() => expect(screen.queryByTestId("display-refresh-notice")).not.toBeInTheDocument());
  });

  it("reports an unknown time instead of inventing one", () => {
    expect(formatLastSuccessfulRead(undefined)).toBe("未知");
    expect(formatLastSuccessfulRead(0)).toBe("未知");
    expect(formatLastSuccessfulRead(Number.NaN)).toBe("未知");
  });
});
