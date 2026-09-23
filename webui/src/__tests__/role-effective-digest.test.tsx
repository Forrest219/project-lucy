// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { RoleEffectiveDigest } from "../components/RoleEffectiveDigest";
import type { EffectiveCapabilityPreview } from "../lib/types";

afterEach(cleanup);

const BASE_PROPS = {
  effectiveToolCount: 3,
  connections: ["kc-starrocks"],
  tableCount: 2,
  publishedMeasureCount: null as number | null,
  mode: "names" as const,
  rowPolicies: [],
  capabilities: [] as EffectiveCapabilityPreview[],
};

describe("RoleEffectiveDigest", () => {
  it("工具数来自 effectiveToolCount，摘要含「生效 N 个 MCP 工具」", () => {
    // effectiveToolCount=3，即使假设表单还勾了 sl_query，也只数 3
    render(<RoleEffectiveDigest {...BASE_PROPS} effectiveToolCount={3} />);
    const digestEl = screen.getByTestId("role-effective-digest-text");
    expect(digestEl.textContent).toContain("生效 3 个 MCP 工具");
  });

  it("publishedMeasureCount: null 时摘要不含「已发布指标」", () => {
    render(<RoleEffectiveDigest {...BASE_PROPS} publishedMeasureCount={null} />);
    const digestEl = screen.getByTestId("role-effective-digest-text");
    expect(digestEl.textContent).not.toContain("已发布指标");
  });

  it("publishedMeasureCount: 12 时摘要含「对应 12 个已发布指标」，且组件内无可勾选指标控件", () => {
    render(<RoleEffectiveDigest {...BASE_PROPS} publishedMeasureCount={12} />);
    const digestEl = screen.getByTestId("role-effective-digest-text");
    expect(digestEl.textContent).toContain("对应 12 个已发布指标");
    // 不得有 checkbox（T7 明确：没有可勾选的指标控件）
    expect(screen.queryByRole("checkbox")).toBeNull();
  });

  it("有 region = East 行策略时摘要含「lucy_query 强制注入过滤」和「解释查询不取数」", () => {
    render(
      <RoleEffectiveDigest
        {...BASE_PROPS}
        tableCount={1}
        rowPolicies={[{ table: "orders", field: "region", value: "East" }]}
      />
    );
    const digestEl = screen.getByTestId("role-effective-digest-text");
    expect(digestEl.textContent).toContain("lucy_query 强制注入过滤");
    expect(digestEl.textContent).toContain("解释查询不取数");
  });

  it("能力元组默认不可见，展开 <details> 后可见 rowGrant", () => {
    const capabilities: EffectiveCapabilityPreview[] = [
      {
        tool: "lucy_query",
        connectionId: "kc-starrocks",
        schema: "public",
        sourceName: "orders",
        physicalTable: "orders",
        sourceKey: "kc-starrocks.public.orders",
        rowGrant: { kind: "scoped", digest: "abc123" },
      },
    ];

    render(<RoleEffectiveDigest {...BASE_PROPS} capabilities={capabilities} />);

    const capRow = screen.getByTestId("capability-row");
    // <details> 未展开时，内部元素不可见
    expect(capRow).not.toBeVisible();

    // 点击 <summary> 展开 <details>
    fireEvent.click(screen.getByText("Data Capability Preview"));

    expect(capRow).toBeVisible();
  });
});
