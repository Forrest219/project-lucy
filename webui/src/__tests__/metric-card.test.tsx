// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MetricCard } from "../components/MetricCard";

function renderCard(props: Partial<Parameters<typeof MetricCard>[0]> & { helpId?: string } = {}) {
  render(
    <MetricCard
      label="测试指标"
      value={42}
      help="口径说明"
      helpId={props.helpId ?? "test-metric"}
      testId="test-card"
      {...props}
    />
  );
}

describe("MetricCard", () => {
  describe("state=ok (default)", () => {
    it("renders the numeric value as main display", () => {
      renderCard({ value: 99, state: "ok" });
      const strong = screen.getByTestId("test-card-value");
      expect(strong).toHaveTextContent("99");
    });

    it("renders subValue when provided", () => {
      renderCard({ value: 5, subValue: "近 7 天" });
      expect(screen.getByText("近 7 天")).toBeInTheDocument();
    });

    it("renders ReactNode help without error", () => {
      renderCard({ help: <span data-testid="react-help">复杂说明</span> });
      // The tooltip content is rendered via portal; just confirm no crash
      expect(screen.getByTestId("test-card")).toBeInTheDocument();
    });
  });

  describe("state=no_data", () => {
    it("renders — as main value (never numeric)", () => {
      renderCard({ value: 0, state: "no_data" });
      const strong = screen.getByTestId("test-card-value");
      expect(strong).toHaveTextContent("—");
      expect(strong).not.toHaveTextContent("0");
    });

    it("shows 所选范围内无数据 as subValue", () => {
      renderCard({ state: "no_data" });
      expect(screen.getByText(/所选范围内无数据/)).toBeInTheDocument();
    });

    it("sets data-metric-state attribute", () => {
      renderCard({ state: "no_data" });
      expect(screen.getByTestId("test-card")).toHaveAttribute("data-metric-state", "no_data");
    });
  });

  describe("state=unavailable", () => {
    it("renders — as main value (Spec 128 D3 — never numeric primary for unavailable)", () => {
      renderCard({ value: 999, state: "unavailable" });
      const strong = screen.getByTestId("test-card-value");
      expect(strong).toHaveTextContent("—");
      expect(strong).not.toHaveTextContent("999");
    });

    it("shows 数据源不可用 by default", () => {
      renderCard({ state: "unavailable" });
      expect(screen.getByText(/数据源不可用/)).toBeInTheDocument();
    });

    it("shows custom unavailableReason when provided", () => {
      renderCard({ state: "unavailable", unavailableReason: "audit DB 连接失败" });
      expect(screen.getByText(/audit DB 连接失败/)).toBeInTheDocument();
    });
  });

  describe("state=partial", () => {
    it("renders — as main value (Spec 128 D3 — partial must never show numeric estimate)", () => {
      renderCard({ value: 7, state: "partial" });
      const strong = screen.getByTestId("test-card-value");
      expect(strong).toHaveTextContent("—");
      expect(strong).not.toHaveTextContent("7");
    });

    it("shows warning prefix ⚠ in subValue", () => {
      renderCard({ state: "partial", unavailableReason: "prefix 映射不唯一" });
      expect(screen.getByText(/⚠/)).toBeInTheDocument();
      expect(screen.getByText(/prefix 映射不唯一/)).toBeInTheDocument();
    });

    it("sets data-metric-state=partial", () => {
      renderCard({ state: "partial" });
      expect(screen.getByTestId("test-card")).toHaveAttribute("data-metric-state", "partial");
    });
  });

  describe("state=ok does NOT set data-metric-state", () => {
    it("no data-metric-state attribute when state is ok", () => {
      renderCard({ state: "ok" });
      expect(screen.getByTestId("test-card")).not.toHaveAttribute("data-metric-state");
    });

    it("no data-metric-state when state is omitted (default ok)", () => {
      renderCard({});
      expect(screen.getByTestId("test-card")).not.toHaveAttribute("data-metric-state");
    });
  });
});
