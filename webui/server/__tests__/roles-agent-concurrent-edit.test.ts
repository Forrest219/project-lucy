import { describe, expect, it } from "vitest";
import type { YamlAccessConfig, YamlRole, YamlUser } from "../admin/access-config.js";
import {
  assertAgentObjectBaseline,
  assertPreviewTokenMatches,
  assertRoleObjectBaseline,
  buildRolesAgentRacsReceipt,
  computeRoleAgentPreviewBinding,
  mergeConfigWithAgent,
  mergeConfigWithRole,
  mintRolesAgentPreviewToken,
  MIXED_VERSION_PROTOCOL_CODE,
  MixedVersionProtocolError,
  PREVIEW_INPUT_CHANGED_CODE,
  PreviewInputChangedError,
  resolveAccessWriteVersionMode,
  resolveCompileInputsDigest,
  resolveRolesAgentRacsOperation,
  rolesAgentRequestDigest,
  serializeBaseObjectVersion
} from "../admin/access-roles-agent-concurrent-edit.js";
import {
  computeAgentBaseObjectVersion,
  computeAgentObjectDigest,
  computeRoleBaseObjectVersion,
  computeRoleObjectDigest
} from "../admin/access-object-version.js";
import { evaluateAccessGovernanceGate } from "../access-governance-gate.js";

const COMPILE = resolveCompileInputsDigest("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");

function role(overrides: Partial<YamlRole> = {}): YamlRole {
  return {
    description: "r",
    permission_model_version: 2,
    allow: { tools: ["lucy_query"], connections: ["doris-main"] },
    ...overrides
  };
}

function agent(overrides: Partial<YamlUser> = {}): YamlUser {
  return {
    id: "agent_a",
    name: "A",
    enabled: true,
    roles: ["role_a"],
    tokens: [{ hash: "sha256:x", label: "t", created: "2026-01-01T00:00:00.000Z" }],
    ...overrides
  };
}

function config(roles: Record<string, YamlRole>, users: YamlUser[]): YamlAccessConfig {
  return { roles, users, defaults: {} };
}

const gate = evaluateAccessGovernanceGate({
  targetKind: "role",
  targetId: "role_a",
  oldValue: role(),
  newValue: role({ description: "r2" })
});

describe("resolveAccessWriteVersionMode", () => {
  it("requires an operation id for an object save, preserving legacy writes", () => {
    const mode = resolveAccessWriteVersionMode({ baseObjectVersion: serializeBaseObjectVersion(computeRoleBaseObjectVersion("role_a", role())) });
    expect(resolveRolesAgentRacsOperation(mode, undefined)).toMatchObject({ kind: "reject", code: "OPERATION_ID_REQUIRED" });
    expect(resolveRolesAgentRacsOperation({ mode: "legacy" }, undefined)).toEqual({ kind: "legacy" });
  });

  it("binds the original patch as well as its preview so an operation cannot be reused for another payload", () => {
    const original = { baseObjectVersion: "role:a:baseline", previewToken: "preview", patch: { description: "first" } };
    expect(rolesAgentRequestDigest(original)).not.toBe(rolesAgentRequestDigest({ ...original, patch: { description: "second" } }));
    expect(rolesAgentRequestDigest(original)).toBe(rolesAgentRequestDigest({ ...original, operationId: "another" }));
  });
  it("legacy when only version is present", () => {
    expect(resolveAccessWriteVersionMode({ version: "1-hash" }).mode).toBe("legacy");
  });

  it("object when only baseObjectVersion is present", () => {
    const base = computeRoleBaseObjectVersion("role_a", role());
    const mode = resolveAccessWriteVersionMode({ baseObjectVersion: serializeBaseObjectVersion(base) });
    expect(mode.mode).toBe("object");
    if (mode.mode === "object") {
      expect(mode.baseObjectVersion.canonicalWritableObjectDigest).toBe(base.canonicalWritableObjectDigest);
    }
  });

  it("rejects mixed protocol (SC legacy + object)", () => {
    const base = serializeBaseObjectVersion(computeRoleBaseObjectVersion("role_a", role()));
    expect(() => resolveAccessWriteVersionMode({ version: "1", baseObjectVersion: base })).toThrow(MixedVersionProtocolError);
    try {
      resolveAccessWriteVersionMode({ version: "1", baseObjectVersion: base });
    } catch (error) {
      expect((error as MixedVersionProtocolError).code).toBe(MIXED_VERSION_PROTOCOL_CODE);
    }
  });
});

describe("SC-01 unrelated object edits", () => {
  it("SC09: agent preview depends on assigned role permissions", () => {
    const user = agent();
    const preview = (assigned: YamlRole) => computeRoleAgentPreviewBinding({
      kind: "agent", objectId: user.id, baseObjectVersion: computeAgentBaseObjectVersion(user.id, user),
      config: config({ role_a: assigned }, [user]), patch: { name: "renamed" },
      compileInputsDigest: COMPILE, gate
    });
    expect(preview(role()).previewDependenciesDigest).not.toBe(preview(role({
      allow: { tools: ["lucy_query", "lucy_catalog"], connections: ["doris-main"] }
    })).previewDependenciesDigest);
  });

  it("SC09: role preview binds referenced template and access defaults", () => {
    const assigned = role({ allow: { tableSelectors: [{
      connection: "doris-main", schema: "chatbi", names: ["orders"], row_access: "scoped",
      row_policy: { template: "region_scope" }
    }] } });
    const preview = (value: string, defaultRole: string) => {
      const candidate = {
        ...config({ role_a: assigned }, [agent()]), defaults: { deny_tools: [defaultRole] },
        row_policy_templates: { region_scope: { predicates: [{ field: "region", op: "eq", value }] } }
      };
      return computeRoleAgentPreviewBinding({
        kind: "role", objectId: "role_a", baseObjectVersion: computeRoleBaseObjectVersion("role_a", assigned),
        config: candidate,
        patch: { description: "edited" }, compileInputsDigest: COMPILE, gate
      });
    };
    const first = preview("east", "role_a");
    expect(first.previewDependenciesDigest).not.toBe(preview("west", "role_a").previewDependenciesDigest);
    expect(first.previewDependenciesDigest).not.toBe(preview("east", "role_b").previewDependenciesDigest);
  });

  it("allows role patch binding when another role description changes (DEP-04)", () => {
    const baseConfig = config({ role_a: role(), role_b: role({ description: "b1" }) }, [agent()]);
    const baseVersion = computeRoleBaseObjectVersion("role_a", baseConfig.roles!.role_a);
    const patch = { description: "r2" };
    const previewBefore = computeRoleAgentPreviewBinding({
      kind: "role",
      objectId: "role_a",
      baseObjectVersion: baseVersion,
      config: mergeConfigWithRole(baseConfig, "role_a", role({ description: "r2" })),
      patch,
      compileInputsDigest: COMPILE,
      gate
    });

    const unrelatedMutated = config(
      { role_a: role(), role_b: role({ description: "b2" }) },
      [agent()]
    );
    const latestWithPatch = mergeConfigWithRole(unrelatedMutated, "role_a", role({ description: "r2" }));
    assertRoleObjectBaseline(unrelatedMutated, "role_a", baseVersion);

    const previewAfter = computeRoleAgentPreviewBinding({
      kind: "role",
      objectId: "role_a",
      baseObjectVersion: baseVersion,
      config: latestWithPatch,
      patch,
      compileInputsDigest: COMPILE,
      gate
    });
    expect(previewAfter.previewEffectDigest).toBe(previewBefore.previewEffectDigest);
    assertPreviewTokenMatches(previewBefore.previewToken, previewAfter.previewEffectDigest);
  });

  it("allows agent patch when unrelated role changes", () => {
    const baseConfig = config({ role_a: role(), role_b: role({ description: "b1" }) }, [agent({ name: "A1" })]);
    const user = baseConfig.users[0]!;
    const baseVersion = computeAgentBaseObjectVersion(user.id, user);
    const patch = { name: "A2" };
    const gateAgent = evaluateAccessGovernanceGate({
      targetKind: "agent",
      targetId: user.id,
      oldValue: user,
      newValue: agent({ name: "A2" })
    });
    const previewBefore = computeRoleAgentPreviewBinding({
      kind: "agent",
      objectId: user.id,
      baseObjectVersion: baseVersion,
      config: mergeConfigWithAgent(baseConfig, agent({ name: "A2" })),
      patch,
      compileInputsDigest: COMPILE,
      gate: gateAgent
    });

    const mutated = config({ role_a: role(), role_b: role({ description: "changed" }) }, [agent({ name: "A1" })]);
    assertAgentObjectBaseline(mutated, user.id, baseVersion);
    const merged = mergeConfigWithAgent(mutated, agent({ name: "A2" }));
    const previewAfter = computeRoleAgentPreviewBinding({
      kind: "agent",
      objectId: user.id,
      baseObjectVersion: baseVersion,
      config: merged,
      patch,
      compileInputsDigest: COMPILE,
      gate: gateAgent
    });
    assertPreviewTokenMatches(previewBefore.previewToken, previewAfter.previewEffectDigest);
  });
});

describe("SC-02 same-object conflict", () => {
  it("detects role target mutation", () => {
    const cfg = config({ role_a: role() }, []);
    const stale = computeRoleBaseObjectVersion("role_a", role());
    const cfg2 = config({ role_a: role({ description: "other" }) }, []);
    expect(() => assertRoleObjectBaseline(cfg2, "role_a", stale)).toThrow();
  });

  it("preview token fails when compileInputsDigest changes (DEP-03)", () => {
    const base = config({ role_a: role(), role_b: role() }, [agent()]);
    const user = base.users[0]!;
    const baseVersion = computeAgentBaseObjectVersion(user.id, user);
    const binding = computeRoleAgentPreviewBinding({
      kind: "agent",
      objectId: user.id,
      baseObjectVersion: baseVersion,
      config: mergeConfigWithAgent(base, agent({ name: "A2" })),
      patch: { name: "A2" },
      compileInputsDigest: COMPILE,
      gate: evaluateAccessGovernanceGate({
        targetKind: "agent",
        targetId: user.id,
        oldValue: user,
        newValue: agent({ name: "A2" })
      })
    });
    const token = binding.previewToken;
    const changedInputs = computeRoleAgentPreviewBinding({
      kind: "agent",
      objectId: user.id,
      baseObjectVersion: baseVersion,
      config: mergeConfigWithAgent(base, agent({ name: "A2" })),
      patch: { name: "A2" },
      compileInputsDigest: resolveCompileInputsDigest("bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"),
      gate: evaluateAccessGovernanceGate({
        targetKind: "agent",
        targetId: user.id,
        oldValue: user,
        newValue: agent({ name: "A2" })
      })
    });
    expect(changedInputs.previewEffectDigest).not.toBe(binding.previewEffectDigest);
    expect(() => assertPreviewTokenMatches(token, changedInputs.previewEffectDigest)).toThrow(PreviewInputChangedError);
    try {
      assertPreviewTokenMatches(token, changedInputs.previewEffectDigest);
    } catch (error) {
      expect((error as PreviewInputChangedError).code).toBe(PREVIEW_INPUT_CHANGED_CODE);
    }
  });
});

describe("RACS receipt binding", () => {
  it("binds previewEffectDigest as the durable requestDigest", () => {
    const baseConfig = config({ role_a: role() }, [agent()]);
    const baseVersion = computeRoleBaseObjectVersion("role_a", baseConfig.roles!.role_a);
    const merged = mergeConfigWithRole(baseConfig, "role_a", role({ description: "r2" }));
    const binding = computeRoleAgentPreviewBinding({
      kind: "role",
      objectId: "role_a",
      baseObjectVersion: baseVersion,
      config: merged,
      patch: { description: "r2" },
      compileInputsDigest: COMPILE,
      gate
    });
    const receipt = buildRolesAgentRacsReceipt({
      actor: {
        actorId: "admin-a", actorType: "ui_admin", accountUid: "uid-a", role: "owner",
        authMode: "required", sessionId: null, requestId: null, actorIp: null
      },
      objectKind: "role",
      objectId: "role_a",
      previewEffectDigest: binding.previewEffectDigest,
      baseObjectVersionSerialized: serializeBaseObjectVersion(baseVersion),
      candidateConfig: merged
    });
    expect(receipt.requestDigest).toBe(binding.previewEffectDigest.toLowerCase());
    expect(receipt.candidateConfigDigest).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("object digests stay independent from whole-file churn", () => {
  it("unrelated role change does not change agent object digest", () => {
    const user = agent();
    const d1 = computeAgentObjectDigest(user);
    const d2 = computeAgentObjectDigest(user);
    expect(d1).toBe(d2);
  });
});
