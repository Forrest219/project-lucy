// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RouteChunkBoundary } from "../app/App";

function Boom({ error }: { error: unknown }): never {
  throw error;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("RouteChunkBoundary — 渲染异常不得伪装成版本更新（错题 2026-11-18-audit-calls-render-crash-misreported）", () => {
  it("普通渲染 TypeError 显示「本页出错」与错误类别，不显示版本文案", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    render(
      <RouteChunkBoundary resetKey="/admin/audit">
        <Boom error={new TypeError("Cannot read properties of undefined (reading 'startsWith')")} />
      </RouteChunkBoundary>
    );
    expect(screen.getByTestId("route-render-error")).toBeInTheDocument();
    expect(screen.getByTestId("route-render-error-kind")).toHaveTextContent("TypeError");
    expect(screen.queryByText(/版本已更新/)).not.toBeInTheDocument();
    expect(screen.queryByTestId("route-chunk-error")).not.toBeInTheDocument();
  });

  it("重试只重置边界，不刷新整页", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const reload = vi.fn();
    Object.defineProperty(window, "location", { configurable: true, value: { ...window.location, reload } });
    let shouldThrow = true;
    function Flaky() {
      if (shouldThrow) throw new RangeError("transient");
      return <p>恢复后的内容</p>;
    }
    render(
      <RouteChunkBoundary resetKey="/admin/audit">
        <Flaky />
      </RouteChunkBoundary>
    );
    shouldThrow = false;
    fireEvent.click(screen.getByTestId("route-render-retry"));
    expect(screen.getByText("恢复后的内容")).toBeInTheDocument();
    expect(reload).not.toHaveBeenCalled();
  });

  it("chunk 加载失败仍显示版本文案与刷新重试", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    render(
      <RouteChunkBoundary resetKey="/catalog">
        <Boom error={new TypeError("Failed to fetch dynamically imported module: http://x/assets/Catalog-abc.js")} />
      </RouteChunkBoundary>
    );
    expect(screen.getByTestId("route-chunk-error")).toBeInTheDocument();
    expect(screen.getByTestId("route-chunk-error")).toHaveTextContent("版本已更新");
    expect(screen.getByTestId("route-chunk-retry")).toBeInTheDocument();
    expect(screen.queryByTestId("route-render-error")).not.toBeInTheDocument();
  });
});
