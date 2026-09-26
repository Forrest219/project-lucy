import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { canAccessSkill, filterAccessibleSkills, summarizeRoleSkillAccess } from "../proxy/skill-acl.js";
import type { SkillAsset } from "../skills/types.js";
import type { Identity } from "../proxy/identity.js";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { invalidateAccessConfigCache } from "../proxy/identity.js";
import { resetEffectivePolicyForTests } from "../proxy/acl.js";

const TOKEN = "skill-acl-test-token";
function tokenHash(token: string): string {
  return "sha256:" + createHash("sha256").update(token).digest("hex");
}

const mockIdentity: Identity = {
  userId: "acl_test_user",
  tokenLabel: "test-token",
  tokenHashPrefix: tokenHash(TOKEN).slice(0, 16),
};

const ACCESS_YAML = `users:
  - id: acl_test_user
    name: ACL Test User
    enabled: true
    roles:
      - analyst_role
    tokens:
      - hash: "${tokenHash(TOKEN)}"
        label: test-token
        created: 2026-08-29

roles:
  analyst_role:
    description: Data Analyst
    allow:
      connections:
        - mysql-aliyun
      tables:
        - dataforai.superstore_orders
      tools:
        - lucy_catalog
        - lucy_skill_search
        - lucy_skill_read
`;

describe("Skill ACL", () => {
  let projectRoot: string;
  let previousRoot: string | undefined;

  const publicSkill: SkillAsset = {
    name: "public-skill",
    title: "Public Skill",
    version: "1.0.0",
    domain: "public",
    status: "published",
    roles_allowed: ["*"],
    prerequisites: {},
    triggers: [],
    eval_cases: ["test.yaml"],
    description: "Public skill",
    uri: "lucy-skill://public/public-skill",
    relativePath: "skills/public.md",
    filePath: "/workspace/skills/public.md",
    content: "Body",
    raw: "Raw",
    file_version: "v1",
  };

  const matchingRoleSkill: SkillAsset = {
    name: "analyst-skill",
    title: "Analyst Skill",
    version: "1.0.0",
    domain: "superstore",
    status: "published",
    roles_allowed: ["analyst_role", "admin"],
    prerequisites: {},
    triggers: [],
    eval_cases: ["test.yaml"],
    description: "Analyst skill",
    uri: "lucy-skill://superstore/analyst-skill",
    relativePath: "skills/analyst.md",
    filePath: "/workspace/skills/analyst.md",
    content: "Body",
    raw: "Raw",
    file_version: "v1",
  };

  const restrictedSkill: SkillAsset = {
    name: "finance-audit",
    title: "Finance Audit Skill",
    version: "1.0.0",
    domain: "finance",
    status: "published",
    roles_allowed: ["finance_admin", "cfo"],
    prerequisites: {},
    triggers: [],
    eval_cases: ["test.yaml"],
    description: "Restricted skill",
    uri: "lucy-skill://finance/finance-audit",
    relativePath: "skills/finance.md",
    filePath: "/workspace/skills/finance.md",
    content: "Body",
    raw: "Raw",
    file_version: "v1",
  };

  const deprecatedSkill: SkillAsset = {
    ...publicSkill,
    name: "deprecated-skill",
    uri: "lucy-skill://public/deprecated-skill",
    status: "deprecated",
  };

  const draftSkill: SkillAsset = {
    ...publicSkill,
    name: "draft-skill",
    uri: "lucy-skill://public/draft-skill",
    status: "draft",
  };

  beforeEach(async () => {
    previousRoot = process.env.KTX_PROJECT_ROOT;
    projectRoot = await mkdtemp(path.join(os.tmpdir(), "skill-acl-test-"));
    process.env.KTX_PROJECT_ROOT = projectRoot;

    await mkdir(path.join(projectRoot, "webui", "config"), { recursive: true });
    await mkdir(path.join(projectRoot, ".ktx-ui"), { recursive: true });
    await writeFile(path.join(projectRoot, "webui", "config", "access.yaml"), ACCESS_YAML);
    await writeFile(path.join(projectRoot, "ktx.yaml"), "connections:\n  mysql-aliyun:\n    type: mysql\n");

    invalidateAccessConfigCache();
    resetEffectivePolicyForTests();
  });

  afterEach(async () => {
    if (previousRoot === undefined) delete process.env.KTX_PROJECT_ROOT;
    else process.env.KTX_PROJECT_ROOT = previousRoot;
    await rm(projectRoot, { recursive: true, force: true });
  });

  it("allows wildcard roles_allowed for any identity", async () => {
    const decision = await canAccessSkill(mockIdentity, publicSkill);
    expect(decision.allowed).toBe(true);
  });

  it("allows matching role from roles_allowed", async () => {
    const decision = await canAccessSkill(mockIdentity, matchingRoleSkill, "read");
    expect(decision.allowed).toBe(true);
    expect(decision.matchedRoleId).toBe("analyst_role");
  });

  it("treats an empty roles_allowed list as deny-all", async () => {
    const decision = await canAccessSkill(mockIdentity, { ...publicSkill, roles_allowed: [] }, "read");
    expect(decision).toMatchObject({ allowed: false, reason: "skill_no_roles_allowed" });
  });

  it("requires the action-specific channel tool", async () => {
    await writeFile(
      path.join(projectRoot, "webui", "config", "access.yaml"),
      ACCESS_YAML.replace("        - lucy_skill_read\n", "")
    );
    invalidateAccessConfigCache();
    resetEffectivePolicyForTests();
    expect((await canAccessSkill(mockIdentity, matchingRoleSkill, "discover")).allowed).toBe(true);
    expect(await canAccessSkill(mockIdentity, matchingRoleSkill, "read")).toMatchObject({
      allowed: false,
      reason: "skill_channel_forbidden:read"
    });
  });

  it("does not combine a role match with another role's channel tool", async () => {
    await writeFile(
      path.join(projectRoot, "webui", "config", "access.yaml"),
      `users:
  - id: acl_test_user
    enabled: true
    roles: [audience_role, reader_role]
    tokens: []
roles:
  audience_role:
    allow:
      tools: [lucy_skill_search]
  reader_role:
    allow:
      tools: [lucy_skill_read]
`
    );
    invalidateAccessConfigCache();
    resetEffectivePolicyForTests();
    const skill = { ...matchingRoleSkill, roles_allowed: ["audience_role"] };
    expect((await canAccessSkill(mockIdentity, skill, "discover")).allowed).toBe(true);
    expect(await canAccessSkill(mockIdentity, skill, "read")).toMatchObject({
      allowed: false,
      reason: "skill_channel_forbidden:read"
    });
  });

  it("blocks non-matching role from roles_allowed", async () => {
    const decision = await canAccessSkill(mockIdentity, restrictedSkill);
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toContain("skill_role_mismatch");
  });

  it("keeps unknown role ids fail-closed", async () => {
    expect(await canAccessSkill(mockIdentity, { ...publicSkill, roles_allowed: ["deleted_role"] }, "read"))
      .toMatchObject({ allowed: false, reason: "skill_role_mismatch" });
  });

  it("allows a legacy direct identity only through wildcard plus the action tool", async () => {
    await writeFile(
      path.join(projectRoot, "webui", "config", "access.yaml"),
      `users:
  - id: acl_test_user
    enabled: true
    tokens: []
    allow:
      tools: [lucy_skill_read]
`
    );
    invalidateAccessConfigCache();
    resetEffectivePolicyForTests();

    expect(await canAccessSkill(mockIdentity, publicSkill, "read")).toMatchObject({
      allowed: true,
      matchedRoleId: "__legacy__"
    });
    expect(await canAccessSkill(mockIdentity, publicSkill, "discover")).toMatchObject({
      allowed: false,
      reason: "skill_channel_forbidden:discover"
    });
    expect(await canAccessSkill(mockIdentity, matchingRoleSkill, "read")).toMatchObject({
      allowed: false,
      reason: "skill_role_required"
    });
  });

  it("builds a read-only Role summary from object declarations and channel tools", () => {
    expect(summarizeRoleSkillAccess(
      "analyst_role",
      ["lucy_skill_search"],
      [publicSkill, matchingRoleSkill, restrictedSkill, draftSkill]
    )).toEqual({
      discoverEnabled: true,
      readEnabled: false,
      declared: [publicSkill.uri, matchingRoleSkill.uri, draftSkill.uri].sort(),
      discoverable: [publicSkill.uri, matchingRoleSkill.uri].sort(),
      readable: [],
      declaredWithoutChannel: [publicSkill.uri, matchingRoleSkill.uri].sort()
    });
  });

  it("blocks deprecated skills", async () => {
    const decision = await canAccessSkill(mockIdentity, deprecatedSkill);
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe("skill_deprecated");
  });

  it("blocks draft skills with skill_not_published (Spec 144)", async () => {
    const decision = await canAccessSkill(mockIdentity, draftSkill);
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe("skill_not_published");
  });

  it("filters accessible skills according to role permissions", async () => {
    const skills = [publicSkill, matchingRoleSkill, restrictedSkill, deprecatedSkill, draftSkill];
    const accessible = await filterAccessibleSkills(mockIdentity, skills);
    const names = accessible.map((s) => s.name);
    expect(names).toContain("public-skill");
    expect(names).toContain("analyst-skill");
    expect(names).not.toContain("finance-audit");
    expect(names).not.toContain("deprecated-skill");
    expect(names).not.toContain("draft-skill");
  });
});
