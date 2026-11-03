/**
 * L25-16 S1 — 委托语义（Spec §3.2.2 规则 6–8，R04）。
 *
 * 委托人必须存在于 `admins.yaml`、是 owner 且已启用；任一不满足都返回同一个稳定原因码
 * `ops_owner_delegation_required`，不泄露委托人是否存在。
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const loadAdminsConfig = vi.fn();

vi.mock("../../auth/admins-store", () => ({
  loadAdminsConfig: () => loadAdminsConfig(),
  findAdmin: (config: { admins: Array<Record<string, unknown>> }, id: string) =>
    config.admins.find((admin) => admin.id === id)
}));

async function loadDelegation() {
  vi.resetModules();
  return import("../ops-delegation");
}

function admins(...list: Array<Record<string, unknown>>) {
  loadAdminsConfig.mockResolvedValue({ admins: list });
}

beforeEach(() => {
  loadAdminsConfig.mockReset();
});

describe("L25-16 S1 resolveDelegatingPrincipal", () => {
  it("委托人是启用的 owner → 放行", async () => {
    admins({ id: "owner_1", role: "owner", enabled: true });
    const { resolveDelegatingPrincipal } = await loadDelegation();

    const result = await resolveDelegatingPrincipal("owner_1");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.principal.id).toBe("owner_1");
  });

  it("缺委托 → ops_owner_delegation_required", async () => {
    const { resolveDelegatingPrincipal } = await loadDelegation();
    await expect(resolveDelegatingPrincipal(undefined)).resolves.toEqual({
      ok: false,
      reason: "ops_owner_delegation_required"
    });
    await expect(resolveDelegatingPrincipal("  ")).resolves.toEqual({
      ok: false,
      reason: "ops_owner_delegation_required"
    });
  });

  it("委托人不存在 → ops_owner_delegation_required", async () => {
    admins({ id: "owner_1", role: "owner", enabled: true });
    const { resolveDelegatingPrincipal } = await loadDelegation();
    await expect(resolveDelegatingPrincipal("ghost")).resolves.toEqual({
      ok: false,
      reason: "ops_owner_delegation_required"
    });
  });

  it("委托人不是 owner → ops_owner_delegation_required", async () => {
    admins({ id: "op_1", role: "operator", enabled: true });
    const { resolveDelegatingPrincipal } = await loadDelegation();
    await expect(resolveDelegatingPrincipal("op_1")).resolves.toEqual({
      ok: false,
      reason: "ops_owner_delegation_required"
    });
  });

  it("委托人已停用 → ops_owner_delegation_required", async () => {
    admins({ id: "owner_1", role: "owner", enabled: false });
    const { resolveDelegatingPrincipal } = await loadDelegation();
    await expect(resolveDelegatingPrincipal("owner_1")).resolves.toEqual({
      ok: false,
      reason: "ops_owner_delegation_required"
    });
  });

  it("admins.yaml 不可读 → fail-closed", async () => {
    loadAdminsConfig.mockRejectedValue(new Error("admins.yaml unreadable"));
    const { resolveDelegatingPrincipal } = await loadDelegation();
    await expect(resolveDelegatingPrincipal("owner_1")).resolves.toEqual({
      ok: false,
      reason: "ops_owner_delegation_required"
    });
  });
});

describe("L25-16 S1 enforceOwnerOnly", () => {
  it("非 owner-only 工具直接放行，不需要委托", async () => {
    const { enforceOwnerOnly } = await loadDelegation();
    await expect(enforceOwnerOnly(false, undefined)).resolves.toEqual({ ok: true, required: false });
  });

  it("owner-only 工具 + 有效委托 → 放行并带出委托人", async () => {
    admins({ id: "owner_1", role: "owner", enabled: true });
    const { enforceOwnerOnly } = await loadDelegation();

    const result = await enforceOwnerOnly(true, "owner_1");
    expect(result.ok).toBe(true);
    if (!result.ok || !result.required) return;
    expect(result.principal.id).toBe("owner_1");
  });

  it("owner-only 工具 + 无有效委托 → 拒绝", async () => {
    const { enforceOwnerOnly } = await loadDelegation();
    await expect(enforceOwnerOnly(true, undefined)).resolves.toEqual({
      ok: false,
      required: true,
      reason: "ops_owner_delegation_required"
    });
  });
});
