// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DecisionReasonCell } from "../components/DecisionReasonCell";

describe("DecisionReasonCell", () => {
  it("renders Chinese primary label and mono code secondary line", () => {
    render(<DecisionReasonCell code="tool_forbidden" />);
    expect(screen.getByTestId("decision-reason-label")).toHaveTextContent("Role 未授权该工具");
    expect(screen.getByTestId("decision-reason-code")).toHaveTextContent("tool_forbidden");
  });

  it("prefers API label when provided", () => {
    render(<DecisionReasonCell code="tool_forbidden" label="自定义文案" />);
    expect(screen.getByTestId("decision-reason-label")).toHaveTextContent("自定义文案");
  });

  it.each([
    ["invalid_arguments:lucy_query:filters_serialized_json_invalid", "筛选条件格式无效"],
    ["invalid_arguments:lucy_query:order_by_conflict", "排序条件互相冲突"],
    ["invalid_arguments:lucy_query:query_shape_required", "工具参数不符合要求"]
  ])("renders a stable Chinese label for %s", (code, label) => {
    render(<DecisionReasonCell code={code} />);
    expect(screen.getByTestId("decision-reason-label")).toHaveTextContent(label);
    expect(screen.getByTestId("decision-reason-code")).toHaveTextContent(code);
  });
});
