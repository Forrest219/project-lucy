// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { RoleToolGrants } from "../components/RoleToolGrants";
import { BUSINESS_QA_PRESET, READONLY_QA_PRESET } from "../lib/rolePermissionDraft";
import type { McpToolInfo } from "../lib/types";

const FIXTURE_TOOLS: McpToolInfo[] = [
  { name: "sl_query", description: "legacy sql query", globalDenied: true },
  { name: "lucy_query", description: "通过 Lucy guardrail 执行受控语义查询", globalDenied: false },
  { name: "lucy_catalog", description: "列出可访问数据资产目录", globalDenied: false },
  { name: "lucy_read_source", description: "读取语义定义", globalDenied: false },
  { name: "lucy_explain_query", description: "解释查询权限判断", globalDenied: false },
  { name: "lucy_freshness", description: "查询新鲜度元数据", globalDenied: false },
  { name: "lucy_begin_question", description: "记录业务问题", globalDenied: false },
  { name: "lucy_continue_question", description: "问询预算用尽后继续", globalDenied: false },
  { name: "wiki_search", description: "搜索业务 Wiki", globalDenied: false },
  { name: "wiki_read", description: "读取业务 Wiki", globalDenied: false },
  { name: "lucy_skill_search", description: "检索已发布的业务 Skill", globalDenied: false },
  { name: "lucy_skill_read", description: "读取业务 Skill 的操作规范", globalDenied: false },
  { name: "sl_validate", description: "验证语义层定义", globalDenied: false },
  { name: "custom_probe", description: "ungrouped probe", globalDenied: false },
];

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
    expect(screen.getByRole("checkbox", { name: /lucy_skill_search/ })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: /lucy_skill_read/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "只读问答 + 知识库" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "业务问答" })).toBeInTheDocument();
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
      "lucy_skill_search",
      "lucy_skill_read",
    ]));
    expect(selected).not.toContain("sl_query");
    expect(screen.getByRole("button", { name: "全选" })).toBeDisabled();
  });

  it("clicking 只读问答: sl_validate not selected, count matches READONLY_QA_PRESET", () => {
    render(<Controlled initial={["sl_validate"]} />);
    fireEvent.click(screen.getByRole("button", { name: "只读问答" }));
    const selected = JSON.parse(screen.getByTestId("selected-value").textContent ?? "[]") as string[];
    expect(selected).not.toContain("sl_validate");
    expect(selected.sort()).toEqual([...READONLY_QA_PRESET].sort());
    expect(screen.getByText(new RegExp(`已选 ${READONLY_QA_PRESET.length} 个`))).toBeInTheDocument();
    expect(screen.getByText("当前与只读问答一致")).toBeInTheDocument();
    expect(document.body.textContent ?? "").toContain(
      "角色只能授予受控查数与知识能力；不能授予直接执行 SQL，也不能绕过 Lucy 的权限与审计通道。"
    );
  });

  it("clicking 业务问答 stamps full BUSINESS_QA_PRESET without sl_validate", () => {
    render(<Controlled initial={["sl_validate", "custom_probe"]} />);
    fireEvent.click(screen.getByRole("button", { name: "业务问答" }));
    const selected = JSON.parse(screen.getByTestId("selected-value").textContent ?? "[]") as string[];
    expect(selected.sort()).toEqual([...BUSINESS_QA_PRESET].sort());
    expect(selected).not.toContain("sl_validate");
    expect(selected).not.toContain("custom_probe");
    expect(screen.getByText("当前与业务问答一致")).toBeInTheDocument();
    expect(screen.getByText(new RegExp(`已选 ${BUSINESS_QA_PRESET.length} 个`))).toBeInTheDocument();
  });

  it("shows 当前与业务问答一致 when value matches BUSINESS_QA_PRESET", () => {
    render(<Controlled initial={[...BUSINESS_QA_PRESET]} />);
    expect(screen.getByText("当前与业务问答一致")).toBeInTheDocument();
  });

  it("partial channel tools do not match 只读问答 or 业务问答", () => {
    render(
      <Controlled
        initial={[
          ...READONLY_QA_PRESET,
          "wiki_search",
        ]}
      />
    );
    expect(screen.queryByText("当前与只读问答一致")).not.toBeInTheDocument();
    expect(screen.queryByText("当前与业务问答一致")).not.toBeInTheDocument();
  });

  it("候选加载成功时不渲染标签输入 (no TagInput when candidates present)", () => {
    render(<Controlled />);
    expect(
      screen.queryByPlaceholderText("输入工具名后回车")
    ).not.toBeInTheDocument();
  });
});
