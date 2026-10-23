// @vitest-environment jsdom
/**
 * T05d ReadonlySqlRowset 组件测试
 */
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { ReadonlySqlRowset } from "../../components/audit-trust/ReadonlySqlRowset";

describe("T05d ReadonlySqlRowset", () => {
  it("renders rows/cols/bytes + status label with data-status", () => {
    const { container } = render(
      <ReadonlySqlRowset rows={5} cols={4} bytes={2048} status="unknown" />
    );
    expect(container.querySelector('[data-testid="readonly-sql-rows"]')?.textContent).toBe("行数5");
    expect(container.querySelector('[data-testid="readonly-sql-cols"]')?.textContent).toBe("列数4");
    expect(container.querySelector('[data-testid="readonly-sql-bytes"]')?.textContent).toContain("KB");
    expect(container.querySelector('[data-testid="readonly-sql-status"]')?.textContent).toBe("未知");
    expect(container.querySelector('[data-testid="readonly-sql-rowset"]')?.getAttribute("data-status")).toBe("unknown");
  });

  it("renders em-dash for null rows/cols/bytes (per Contract: do NOT invent 0)", () => {
    const { container } = render(
      <ReadonlySqlRowset rows={null} cols={null} bytes={null} status="not_collected" />
    );
    expect(container.querySelector('[data-testid="readonly-sql-rows"]')?.textContent).toContain("—");
    expect(container.querySelector('[data-testid="readonly-sql-cols"]')?.textContent).toContain("—");
    expect(container.querySelector('[data-testid="readonly-sql-bytes"]')?.textContent).toContain("—");
  });

  it("formats bytes as B / KB / MB", () => {
    const { container: c1 } = render(<ReadonlySqlRowset rows={0} cols={0} bytes={500} status="unknown" />);
    expect(c1.textContent).toContain("500 B");
    const { container: c2 } = render(<ReadonlySqlRowset rows={0} cols={0} bytes={2048} status="unknown" />);
    expect(c2.textContent).toMatch(/2\.0 KB/);
    const { container: c3 } = render(<ReadonlySqlRowset rows={0} cols={0} bytes={2 * 1024 * 1024} status="unknown" />);
    expect(c3.textContent).toMatch(/2\.00 MB/);
  });

  it("renders all 5 status labels + palette classes", () => {
    const cases = [
      { status: "not_applicable" as const, label: "不适用", palette: "pl-status-neutral" },
      { status: "not_collected" as const, label: "未采集", palette: "pl-status-warning" },
      { status: "redacted" as const, label: "已脱敏", palette: "pl-status-warning" },
      { status: "parse_failed" as const, label: "解析失败", palette: "pl-status-error" },
      { status: "unknown" as const, label: "未知", palette: "pl-status-neutral" }
    ];
    for (const c of cases) {
      const { container } = render(
        <ReadonlySqlRowset rows={1} cols={1} bytes={10} status={c.status} />
      );
      const status = container.querySelector('[data-testid="readonly-sql-status"]');
      expect(status?.textContent).toBe(c.label);
      expect(status?.className).toContain(c.palette);
    }
  });

  it("renders alongside the existing generated SQL cell (does not replace it)", () => {
    // Per Contract §2 (existing rules): "保留既有 生成 SQL 列, 默认可发现
    // 入口与选列, 不必每个空单元格常驻占宽". This component coexists
    // with the existing SQL cell in the Audit page; this test only
    // asserts it can be rendered (Audit.tsx integration is the sibling's job).
    const { container } = render(
      <>
        <span data-testid="legacy-sql-cell">SELECT 1</span>
        <ReadonlySqlRowset rows={1} cols={1} bytes={32} status="unknown" />
      </>
    );
    expect(container.querySelector('[data-testid="legacy-sql-cell"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="readonly-sql-rowset"]')).not.toBeNull();
  });
});