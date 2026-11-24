import { describe, expect, it } from "vitest";
import type { YamlAccessConfig, YamlRole, YamlUser } from "../admin/access-config.js";
import {
  baseObjectVersionForAbsence,
  canonicalizeRoleWritable,
  canonicalizeWritableValue,
  collectAgentPreviewDependencies,
  collectRolePreviewDependencies,
  computeAgentObjectDigest,
  computeCandidateConfigDigest,
  computePreviewDependenciesDigest,
  computePreviewEffectDigest,
  computeRoleObjectDigest,
  digestGovernanceEffectFacts,
  digestNormalizedPatch,
  stripAgentDisplayOnlyFields,
  unrelatedRoleChangeDoesNotAlterAgentDependencies
} from "../admin/access-object-version.js";

function baseRole(overrides: Partial<YamlRole> = {}): YamlRole {
  return {
    description: "demo",
    permission_model_version: 2,
    allow: {
      tools: ["lucy_query", "wiki_read"],
      connections: ["doris-main"],
      tableSelectors: [
        {
          schema: "chatbi",
          names: ["ai_intl_ad_daily"],
          row_access: "scoped",
          row_policy: {
            predicates: [{ field: "chatbi.ai_intl_ad_daily.country_abbr", op: "eq", value: "US" }]
          }
        }
      ]
    },
    ...overrides
  };
}

function baseAgent(overrides: Partial<YamlUser> = {}): YamlUser {
  return {
    id: "agent_a",
    name: "Agent A",
    enabled: true,
    roles: ["demo_role"],
    tokens: [{ hash: "sha256:aa", label: "primary", created: "2026-01-01T00:00:00.000Z" }],
    ...overrides
  };
}

function baseConfig(overrides: Partial<YamlAccessConfig & { row_policy_templates?: Record<string, unknown> }> = {}) {
  return {
    roles: {
      demo_role: baseRole(),
      other_role: baseRole({ description: "other" })
    },
    users: [baseAgent()],
    defaults: { deny_tools: ["danger_tool"] },
    row_policy_templates: {
      us_only: { predicates: [{ field: "x", op: "eq", value: "US" }] }
    },
    ...overrides
  };
}

const COMPILE_INPUTS = "compile-inputs-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

describe("object digest gold samples (§3.4)", () => {
  it("positive: object key order does not change role digest", () => {
    const a = baseRole();
    const b = {
      allow: a.allow,
      description: a.description,
      permission_model_version: a.permission_model_version
    } as YamlRole;
    expect(computeRoleObjectDigest(a)).toBe(computeRoleObjectDigest(b));
  });

  it("positive: tools reorder does not change role digest", () => {
    const r1 = baseRole({ allow: { ...baseRole().allow!, tools: ["wiki_read", "lucy_query"] } });
    const r2 = baseRole({ allow: { ...baseRole().allow!, tools: ["lucy_query", "wiki_read"] } });
    expect(computeRoleObjectDigest(r1)).toBe(computeRoleObjectDigest(r2));
  });

  it("negative: unknown field value changes digest", () => {
    const r1 = baseRole();
    const r2 = { ...baseRole(), future_flag: true } as YamlRole;
    expect(computeRoleObjectDigest(r1)).not.toBe(computeRoleObjectDigest(r2));
  });

  it("negative: unknown nested array order changes digest", () => {
    const r1 = { ...baseRole(), custom_list: ["a", "b"] } as YamlRole;
    const r2 = { ...baseRole(), custom_list: ["b", "a"] } as YamlRole;
    expect(computeRoleObjectDigest(r1)).not.toBe(computeRoleObjectDigest(r2));
  });

  it("negative: row policy predicate value change changes digest", () => {
    const selectors = baseRole().allow!.tableSelectors!;
    const r1 = baseRole({
      allow: {
        ...baseRole().allow!,
        tableSelectors: [{ ...selectors[0]!, row_policy: { predicates: [{ field: "f", op: "eq", value: "US" }] } }]
      }
    });
    const r2 = baseRole({
      allow: {
        ...baseRole().allow!,
        tableSelectors: [{ ...selectors[0]!, row_policy: { predicates: [{ field: "f", op: "eq", value: "KR" }] } }]
      }
    });
    expect(computeRoleObjectDigest(r1)).not.toBe(computeRoleObjectDigest(r2));
  });

  it("negative: ordered predicates reorder changes digest", () => {
    const selectors = baseRole().allow!.tableSelectors!;
    const r1 = baseRole({
      allow: {
        ...baseRole().allow!,
        tableSelectors: [
          {
            ...selectors[0]!,
            row_policy: {
              predicates: [
                { field: "f1", op: "eq", value: "a" },
                { field: "f2", op: "eq", value: "b" }
              ]
            }
          }
        ]
      }
    });
    const r2 = baseRole({
      allow: {
        ...baseRole().allow!,
        tableSelectors: [
          {
            ...selectors[0]!,
            row_policy: {
              predicates: [
                { field: "f2", op: "eq", value: "b" },
                { field: "f1", op: "eq", value: "a" }
              ]
            }
          }
        ]
      }
    });
    expect(computeRoleObjectDigest(r1)).not.toBe(computeRoleObjectDigest(r2));
  });

  it("role vs roles runtime equivalence for agents", () => {
    const byList = baseAgent({ roles: ["demo_role"], role: undefined });
    const bySingle = baseAgent({ role: "demo_role", roles: undefined });
    expect(computeAgentObjectDigest(byList)).toBe(computeAgentObjectDigest(bySingle));
  });
});

describe("previewEffectDigest is not candidateConfigDigest", () => {
  it("unrelated role edit changes candidate digest but not preview effect binding", () => {
    const config = baseConfig();
    const agent = config.users[0]!;
    const patchDigest = digestNormalizedPatch({ name: "Agent A" });
    const deps = computePreviewDependenciesDigest(
      collectAgentPreviewDependencies(config, agent.id, agent, COMPILE_INPUTS)
    );
    const baseVersion = {
      vocabulary: "racs-v1-object-1",
      kind: "agent" as const,
      objectId: agent.id,
      canonicalWritableObjectDigest: computeAgentObjectDigest(agent)
    };
    const effectBefore = computePreviewEffectDigest({
      baseObjectVersion: baseVersion,
      normalizedPatchDigest: patchDigest,
      previewDependenciesDigest: deps
    });

    const mutated = baseConfig({
      roles: {
        ...config.roles,
        other_role: baseRole({ description: "changed elsewhere" })
      }
    });
    const candidateBefore = computeCandidateConfigDigest(config);
    const candidateAfter = computeCandidateConfigDigest(mutated);
    expect(candidateAfter).not.toBe(candidateBefore);
    expect(effectBefore).toBe(
      computePreviewEffectDigest({
        baseObjectVersion: baseVersion,
        normalizedPatchDigest: patchDigest,
        previewDependenciesDigest: computePreviewDependenciesDigest(
          collectAgentPreviewDependencies(mutated, agent.id, agent, COMPILE_INPUTS)
        )
      })
    );
  });
});

describe("DEP-01–11 dependency matrix (digest oracle)", () => {
  it("DEP-01: writable or unknown field change alters object digest", () => {
    const before = baseRole();
    const after = { ...baseRole(), experimental: { nested: 1 } } as YamlRole;
    expect(computeRoleObjectDigest(before)).not.toBe(computeRoleObjectDigest(after));
    const preserved = canonicalizeRoleWritable(after);
    expect(preserved.experimental).toEqual({ nested: 1 });
  });

  it("DEP-02: referenced role definition change alters agent dependencies", () => {
    const config = baseConfig();
    const agent = config.users[0]!;
    const before = computePreviewDependenciesDigest(
      collectAgentPreviewDependencies(config, agent.id, agent, COMPILE_INPUTS)
    );
    const changed = baseConfig({
      roles: { ...config.roles, demo_role: baseRole({ description: "changed role body" }) }
    });
    const after = computePreviewDependenciesDigest(
      collectAgentPreviewDependencies(changed, agent.id, agent, COMPILE_INPUTS)
    );
    expect(after).not.toBe(before);
  });

  it("DEP-03: compile inputs digest change alters dependencies", () => {
    const config = baseConfig();
    const agent = config.users[0]!;
    const d1 = computePreviewDependenciesDigest(
      collectAgentPreviewDependencies(config, agent.id, agent, COMPILE_INPUTS)
    );
    const d2 = computePreviewDependenciesDigest(
      collectAgentPreviewDependencies(config, agent.id, agent, "b".repeat(64))
    );
    expect(d1).not.toBe(d2);
  });

  it("DEP-04: unrelated role change does not alter agent dependency digest", () => {
    const config = baseConfig();
    const agent = config.users[0]!;
    const mutated = baseConfig({
      roles: { ...config.roles, other_role: baseRole({ description: "unrelated" }) }
    });
    expect(
      unrelatedRoleChangeDoesNotAlterAgentDependencies({
        before: config,
        after: mutated,
        agentId: agent.id,
        compileInputsDigest: COMPILE_INPUTS
      })
    ).toBe(true);
  });

  it("DEP-05: template id referenced by role participates in role dependencies", () => {
    const role = baseRole({
      allow: {
        ...baseRole().allow!,
        tableSelectors: [
          {
            schema: "chatbi",
            names: ["ai_intl_ad_daily"],
            row_access: "scoped",
            row_policy: { template: "us_only" }
          }
        ]
      }
    });
    const config = baseConfig({ roles: { demo_role: role } });
    const deps = collectRolePreviewDependencies(config, "demo_role", role, COMPILE_INPUTS);
    expect(deps.rowPolicyTemplates?.us_only).toMatch(/^[0-9a-f]{64}$/);
    const mutatedTemplate = baseConfig({
      row_policy_templates: {
        us_only: { predicates: [{ field: "x", op: "eq", value: "CA" }] }
      }
    });
    const before = computePreviewDependenciesDigest(
      collectRolePreviewDependencies(config, "demo_role", role, COMPILE_INPUTS)
    );
    const after = computePreviewDependenciesDigest(
      collectRolePreviewDependencies(mutatedTemplate, "demo_role", role, COMPILE_INPUTS)
    );
    expect(after).not.toBe(before);
  });

  it("DEP-06: governance raw call count alone does not change effect digest", () => {
    const low = digestGovernanceEffectFacts({
      decision: "allow",
      riskLevel: "low",
      requiresConfirmation: false,
      rawCallCount: 1
    });
    const high = digestGovernanceEffectFacts({
      decision: "allow",
      riskLevel: "low",
      requiresConfirmation: false,
      rawCallCount: 99
    });
    expect(low).toBe(high);
  });

  it("DEP-07: governance sensitive set change alters effect digest", () => {
    const a = digestGovernanceEffectFacts({
      decision: "allow",
      riskLevel: "medium",
      requiresConfirmation: true,
      sensitiveSourceKeys: ["hive-1.dim.city"]
    });
    const b = digestGovernanceEffectFacts({
      decision: "allow",
      riskLevel: "medium",
      requiresConfirmation: true,
      sensitiveSourceKeys: ["hive-1.dim.city", "hive-1.dim.region"]
    });
    expect(a).not.toBe(b);
  });

  it("DEP-09: display-only agent stats do not enter object digest", () => {
    const clean = baseAgent();
    const withStats = {
      ...baseAgent(),
      usageCallsLast7d: 42,
      lastSeen: "2026-11-19T00:00:00.000Z"
    } as YamlUser & { usageCallsLast7d: number; lastSeen: string };
    expect(computeAgentObjectDigest(clean)).toBe(computeAgentObjectDigest(withStats));
    expect(stripAgentDisplayOnlyFields(withStats)).not.toHaveProperty("lastSeen");
  });

  it("DEP-10: canonicalizeWritableValue keeps unknown fields", () => {
    const value = { z: 1, m: { keep: true, list: [2, 1] } };
    const out = canonicalizeWritableValue(value, "unknown") as Record<string, unknown>;
    expect(out).toHaveProperty("m");
    expect((out.m as { list: number[] }).list).toEqual([2, 1]);
  });

  it("DEP-11: absent marker differs from present object version", () => {
    const absent = baseObjectVersionForAbsence("role", "new_role");
    const present = {
      vocabulary: "racs-v1-object-1",
      kind: "role" as const,
      objectId: "new_role",
      canonicalWritableObjectDigest: computeRoleObjectDigest(baseRole())
    };
    expect(absent.canonicalWritableObjectDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(absent.canonicalWritableObjectDigest).not.toBe(present.canonicalWritableObjectDigest);
    expect(baseObjectVersionForAbsence("role", "new_role").canonicalWritableObjectDigest).toBe(
      absent.canonicalWritableObjectDigest
    );
    const copyDepsChanged = computePreviewDependenciesDigest({
      compileInputsDigest: COMPILE_INPUTS,
      copySourceObjectVersion: present
    });
    const copyDepsOther = computePreviewDependenciesDigest({
      compileInputsDigest: COMPILE_INPUTS,
      copySourceObjectVersion: {
        ...present,
        canonicalWritableObjectDigest: computeRoleObjectDigest(baseRole({ description: "other source" }))
      }
    });
    expect(copyDepsChanged).not.toBe(copyDepsOther);
  });
});