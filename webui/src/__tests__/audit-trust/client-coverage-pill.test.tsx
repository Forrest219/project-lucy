// @vitest-environment jsdom
/**
 * T05c ClientCoveragePill 组件测试
 * - 禁用 '未外发' (per Contract §5)
 * - observed / gap / unknown 三态
 */
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { ClientCoveragePill } from "../../components/audit-trust/ClientCoveragePill";

describe("T05c ClientCoveragePill", () => {
  it("renders '客户端已采集' when observed=true", () => {
    const { container } = render(<ClientCoveragePill observed={true} />);
    const pill = container.querySelector('[data-testid="client-coverage-pill"]');
    expect(pill?.getAttribute("data-state")).toBe("observed");
    expect(pill?.getAttribute("data-observed")).toBe("true");
    expect(pill?.textContent).toContain("客户端已采集");
    expect(pill?.className).toContain("pl-status-success");
  });

  it("renders '采集缺口' with gap window when provided", () => {
    const { container } = render(
      <ClientCoveragePill
        observed={false}
        gapWindow={{ from: "2026-10-19T10:00:00Z", to: "2026-10-19T11:00:00Z" }}
      />
    );
    const pill = container.querySelector('[data-testid="client-coverage-pill"]');
    expect(pill?.getAttribute("data-state")).toBe("gap");
    expect(pill?.getAttribute("data-gap-from")).toBe("2026-10-19T10:00:00Z");
    expect(pill?.getAttribute("data-gap-to")).toBe("2026-10-19T11:00:00Z");
    expect(pill?.textContent).toContain("采集缺口");
    expect(pill?.className).toContain("pl-status-warning");
  });

  it("renders '后续动作不可见' (not '未外发') when observed=false + no gapWindow", () => {
    const { container } = render(<ClientCoveragePill observed={false} />);
    const pill = container.querySelector('[data-testid="client-coverage-pill"]');
    expect(pill?.getAttribute("data-state")).toBe("unknown");
    expect(pill?.textContent).toContain("后续动作不可见");
    expect(pill?.textContent).not.toContain("未外发");
  });

  it("renders reason suffix when provided", () => {
    const { container } = render(<ClientCoveragePill observed={false} reason="no_controlled_client" />);
    const pill = container.querySelector('[data-testid="client-coverage-pill"]');
    expect(pill?.textContent).toContain("no_controlled_client");
    expect(pill?.getAttribute("data-reason")).toBe("no_controlled_client");
  });

  it("never contains the forbidden '未外发' wording in any state", () => {
    const variants = [
      { observed: true },
      { observed: false, gapWindow: { from: "t1", to: "t2" } },
      { observed: false, reason: "r1" },
      { observed: false }
    ] as const;
    for (const v of variants) {
      const { container } = render(<ClientCoveragePill {...v} />);
      expect(container.textContent).not.toContain("未外发");
    }
  });
});