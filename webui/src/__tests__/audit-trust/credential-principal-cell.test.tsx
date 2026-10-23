// @vitest-environment jsdom
/**
 * T05b audit-trust 组件测试：CredentialPrincipalCell
 * - userId 渲染 + notranslate
 * - 复制按钮存在 + click 不抛
 * - hint 可选
 * - 数据属性（data-user-id）方便测试钩子
 */
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { CredentialPrincipalCell } from "../../components/audit-trust/CredentialPrincipalCell";

describe("T05b CredentialPrincipalCell", () => {
  it("renders userId with notranslate + data-user-id", () => {
    const { container } = render(<CredentialPrincipalCell userId="agent-007" />);
    const value = container.querySelector('[data-testid="credential-principal-value"]');
    expect(value?.textContent).toBe("agent-007");
    expect(value?.getAttribute("translate")).toBe("no");
    expect(value?.className).toContain("notranslate");
    expect(container.querySelector('[data-testid="credential-principal-cell"]')?.getAttribute("data-user-id")).toBe(
      "agent-007"
    );
  });

  it("renders copy button", () => {
    const { container } = render(<CredentialPrincipalCell userId="agent-007" />);
    const copy = container.querySelector('[data-testid="credential-principal-copy"]');
    expect(copy?.textContent).toBe("复制");
    expect(copy?.getAttribute("aria-label")).toBe("复制凭证主体");
  });

  it("renders hint when provided", () => {
    const { container } = render(<CredentialPrincipalCell userId="agent-007" hint="lucy_admin" />);
    const hint = container.querySelector('[data-testid="credential-principal-hint"]');
    expect(hint?.textContent).toBe("lucy_admin");
  });

  it("does not render hint when not provided", () => {
    const { container } = render(<CredentialPrincipalCell userId="agent-007" />);
    expect(container.querySelector('[data-testid="credential-principal-hint"]')).toBeNull();
  });
});