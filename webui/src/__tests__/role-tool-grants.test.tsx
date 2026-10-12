// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { RoleToolGrants } from "../components/RoleToolGrants";
import type { McpToolInfo } from "../lib/types";

// ─── Fixture ──────────────────────────────────────────────────────────────────
//
// Must include sl_query (globalDenied: true) and lucy_query (globalDenied: false)
// plus all 6 READONLY_QA_PRESET tools so "已选 6 个" is reachable after clicking
// the preset. sl_validate is included so the assertion that it is NOT selected
// after the preset is meaningful.

const FIXTURE_TOOLS: McpToolInfo[] = [
  { name: "sl_query", description: "legacy sql query", globalDenied: true },
  { name: "lucy_query", description: "通过 Lucy guardrail 执行受控语义查询", globalDenied: false },
  { name: "lucy_catalog", description: "列出可访问数据资产目录", globalDenied: false },
  { name: "lucy_read_source", description: "读取语义定义", globalDenied: false },
  { name: "lucy_explain_query", description: "解释查询权限判断", globalDenied: false },
  { name: "lucy_freshness", description: "查询新鲜度元数据", globalDenied: false },
  { name: "lucy_begin_question", description: "记录业务问题", globalDenied: false },
  { name: "sl_validate", description: "验证语义层定义", globalDenied: false },
  { name: "lucy_skill_search", description: "检索已发布的业务 Skill", globalDenied: false },
  { name: "lucy_skill_read", description: "读取业务 Skill 的操作规范", globalDenied: false },
  { name: "custom_probe", description: "ungrouped probe", globalDenied: false },
];

// ─── Controlled wrapper ──────────────────────────────────────────────────────

function Controlled({
  initial = [] as string[],
  tools = FIXTURE_TOOLS,
}: {
  initial?: string[];
  tools?: McpToolInfo[];
}) {
  const [value, setValue] = useState<string[]>(initial);
  return (
    <>
      <div data-testid="selected-value">{JSON.stringify(value)}</div>
      <RoleToolGrants candidates={tools} value={value} onChange={setValue} />
    </>
  );
}

afterEach(() => cleanup());

describe("RoleToolGrants", () => {
  it("no sl_query checkbox (globalDenied: true prevents render)", () => {
    render(<Controlled />);
    expect(screen.getByTestId("role-custom-tools")).toHaveAttribute("open");
    expect(screen.queryByRole("checkbox", { name: /sl_query/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: /lucy_skill_search/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: /lucy_skill_read/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "只读问答 + 知识库" })).not.toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: /custom_probe/ })).toBeInTheDocument();
  });

  it("全选 grants every visible tool and leaves denied tools out", () => {
    render(<Controlled initial={["sl_query"]} />);
    fireEvent.click(screen.getByRole("button", { name: "全选" }));
    const selected = JSON.parse(screen.getByTestId("selected-value").textContent ?? "[]") as string[];
    expect(selected).toEqual(expect.arrayContaining([
      "lucy_query",
      "custom_probe",
      "sl_validate",
    ]));
    expect(selected).not.toContain("sl_query");
    expect(selected).not.toContain("lucy_skill_search");
    expect(selected).not.toContain("lucy_skill_read");
    expect(screen.getByRole("button", { name: "全选" })).toBeDisabled();
  });

  it("clicking 只读问答: sl_validate not in selected set, count 已选 6 个, no /16, bottom sentence", () => {
    // Start with sl_validate selected — verifies stampPreset replaces rather than merges
    render(<Controlled initial={["sl_validate"]} />);

    const custom = screen.getByTestId("role-custom-tools");
    expect(custom).toHaveAttribute("open");

    // No sl_query checkbox before or after preset click
    expect(screen.queryByRole("checkbox", { name: /sl_query/ })).not.toBeInTheDocument();

    // Click 只读问答 preset
    fireEvent.click(screen.getByRole("button", { name: "只读问答" }));

    // sl_validate must NOT be in selected set after preset
    const selected = JSON.parse(
      screen.getByTestId("selected-value").textContent ?? "[]"
    ) as string[];
    expect(selected).not.toContain("sl_validate");

    // Count: exactly 6 grantable tools selected (READONLY_QA_PRESET members)
    expect(screen.getByText(/已选 6 个/)).toBeInTheDocument();

    // Must NOT contain a denominator fraction like "/16"
    expect(document.body.textContent ?? "").not.toMatch(/\/\d+/);

    // Bottom system-denied static sentence (no checkbox)
    expect(document.body.textContent ?? "").toContain("由系统禁止，不能授予");
  });

  it("shows 当前与只读问答一致 when value matches READONLY_QA_PRESET", () => {
    render(
      <Controlled
        initial={[
          "lucy_catalog",
          "lucy_read_source",
          "lucy_query",
          "lucy_explain_query",
          "lucy_freshness",
          "lucy_begin_question",
        ]}
      />
    );
    expect(screen.getByText("当前与只读问答一致")).toBeInTheDocument();
  });

  it("ignores the four context tools when matching 只读问答 and does not offer them as grants", () => {
    render(
      <Controlled
        initial={[
          "lucy_catalog",
          "lucy_read_source",
          "lucy_query",
          "lucy_explain_query",
          "lucy_freshness",
          "lucy_begin_question",
          "wiki_search",
          "lucy_skill_read",
        ]}
        tools={[
          ...FIXTURE_TOOLS,
          { name: "wiki_search", description: "搜索业务 Wiki", globalDenied: false },
          { name: "wiki_read", description: "读取业务 Wiki", globalDenied: false },
        ]}
      />
    );
    expect(screen.getByText("当前与只读问答一致")).toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: /wiki_search/ })).not.toBeInTheDocument();
    const chips = screen.getByRole("list", { name: "当前选择的 MCP 工具" });
    expect(chips.textContent).not.toContain("wiki_search");
    expect(chips.textContent).not.toContain("lucy_skill_read");
    expect(chips.textContent).toContain("lucy_query");
  });

  it("候选加载成功时不渲染标签输入 (no TagInput when candidates present)", () => {
    render(<Controlled />);
    // No input with placeholder 输入工具名后回车 (TagInput default placeholder)
    expect(
      screen.queryByPlaceholderText("输入工具名后回车")
    ).not.toBeInTheDocument();
  });
});
