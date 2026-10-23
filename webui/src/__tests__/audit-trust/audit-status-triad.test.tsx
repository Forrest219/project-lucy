// @vitest-environment jsdom
/**
 * T05a audit-trust 组件测试：
 * - AuditStatusTriad 三轴独立展示 (succeeded execution + legacy_unverified
 *   association + unknown coverage 同时显示, 不折叠成单一成功状态)
 * - 禁用 "未外发" 措辞 (per Contract §5: coverage 永远不写 "未外发")
 * - 各轴 palette + status data 属性正确
 * - 可读筛选器标签 (data-testid)
 */
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import {
  AuditStatusTriad,
  type AssociationAxis,
  type CoverageAxis,
  type ExecutionAxis
} from "../../components/audit-trust/AuditStatusTriad";

function getStatusBadge(testid: string, container: HTMLElement) {
  return container.querySelector(`[data-testid="${testid}"]`);
}

describe("T05a AuditStatusTriad", () => {
  it("renders three independent badges with status data-attributes", () => {
    const { container } = render(
      <AuditStatusTriad
        execution="succeeded"
        association="confirmed"
        coverage="observed"
      />
    );
    expect(getStatusBadge("audit-status-execution", container)?.getAttribute("data-status")).toBe(
      "succeeded"
    );
    expect(getStatusBadge("audit-status-association", container)?.getAttribute("data-status")).toBe(
      "confirmed"
    );
    expect(getStatusBadge("audit-status-coverage", container)?.getAttribute("data-status")).toBe(
      "observed"
    );
  });

  it("never collapses to a single success badge when axes disagree", () => {
    // succeeded execution + legacy_unverified association + gap coverage
    const { container } = render(
      <AuditStatusTriad
        execution="succeeded"
        association="legacy_unverified"
        coverage="gap"
      />
    );
    const exec = getStatusBadge("audit-status-execution", container);
    const assoc = getStatusBadge("audit-status-association", container);
    const cov = getStatusBadge("audit-status-coverage", container);
    expect(exec?.textContent).toContain("执行成功");
    expect(assoc?.textContent).toContain("归属待核验");
    expect(cov?.textContent).toContain("采集缺口");
    // Confirm we render three distinct badges, not one merged.
    const badgeTestIds = ["audit-status-execution", "audit-status-association", "audit-status-coverage"];
    for (const testId of badgeTestIds) {
      expect(container.querySelector(`[data-testid="${testId}"]`)).not.toBeNull();
    }
    expect(container.querySelectorAll("[data-testid^='audit-status-']")).toHaveLength(4); // 3 badges + 1 wrapper
  });

  it("never shows the forbidden '未外发' wording on coverage (per Contract §5)", () => {
    // Coverage should say "后续动作不可见" / "采集缺口" / "客户端已采集"
    const forbidden = "未外发";
    const labels: CoverageAxis[] = ["observed", "gap", "unknown"];
    for (const cov of labels) {
      const { container } = render(
        <AuditStatusTriad
          execution="succeeded"
          association="confirmed"
          coverage={cov}
        />
      );
      const text = container.textContent ?? "";
      expect(text).not.toContain(forbidden);
    }
  });

  it("uses semantic palette classes (no new design tokens introduced)", () => {
    const { container } = render(
      <AuditStatusTriad
        execution="failed"
        association="conflict"
        coverage="unknown"
      />
    );
    expect(getStatusBadge("audit-status-execution", container)?.className).toContain(
      "pl-status-error"
    );
    expect(getStatusBadge("audit-status-association", container)?.className).toContain(
      "pl-status-error"
    );
    expect(getStatusBadge("audit-status-coverage", container)?.className).toContain(
      "pl-status-neutral"
    );
  });

  it("accepts label overrides for i18n", () => {
    const { container } = render(
      <AuditStatusTriad
        execution="succeeded"
        association="confirmed"
        coverage="observed"
        executionLabel="OK"
        associationLabel="linked"
        coverageLabel="captured"
      />
    );
    expect(container.textContent).toContain("OK");
    expect(container.textContent).toContain("linked");
    expect(container.textContent).toContain("captured");
  });

  it("renders candidate association with info palette", () => {
    const { container } = render(
      <AuditStatusTriad
        execution="succeeded"
        association="candidate"
        coverage="observed"
      />
    );
    const assoc = getStatusBadge("audit-status-association", container);
    expect(assoc?.className).toContain("pl-status-info");
    expect(assoc?.textContent).toContain("候选关联");
  });

  it("renders conflict association as error (not just warning)", () => {
    const { container } = render(
      <AuditStatusTriad
        execution="not_executed"
        association="conflict"
        coverage="unknown"
      />
    );
    expect(getStatusBadge("audit-status-association", container)?.className).toContain(
      "pl-status-error"
    );
    expect(getStatusBadge("audit-status-execution", container)?.className).toContain(
      "pl-status-warning"
    );
  });

  it("renders unknown / unassigned without forcing a single verdict", () => {
    const axes: Array<[ExecutionAxis, AssociationAxis, CoverageAxis]> = [
      ["unknown", "unassigned", "unknown"],
      ["interrupted", "candidate", "gap"],
      ["failed", "conflict", "observed"]
    ];
    for (const [execution, association, coverage] of axes) {
      const { container } = render(
        <AuditStatusTriad execution={execution} association={association} coverage={coverage} />
      );
      const exec = getStatusBadge("audit-status-execution", container);
      const assoc = getStatusBadge("audit-status-association", container);
      const cov = getStatusBadge("audit-status-coverage", container);
      expect(exec?.getAttribute("data-status")).toBe(execution);
      expect(assoc?.getAttribute("data-status")).toBe(association);
      expect(cov?.getAttribute("data-status")).toBe(coverage);
    }
  });
});