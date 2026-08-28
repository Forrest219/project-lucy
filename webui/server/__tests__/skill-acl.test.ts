import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { canAccessSkill, filterAccessibleSkills } from "../proxy/skill-acl.js";
import type { SkillAsset } from "../skills/types.js";
import type { Identity } from "../proxy/identity.js";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { invalidateAccessConfigCache } from "../proxy/identity.js";

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
  };

  const deprecatedSkill: SkillAsset = {
    ...publicSkill,
    name: "deprecated-skill",
    status: "deprecated",
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
    const decision = await canAccessSkill(mockIdentity, matchingRoleSkill);
    expect(decision.allowed).toBe(true);
  });

  it("blocks non-matching role from roles_allowed", async () => {
    const decision = await canAccessSkill(mockIdentity, restrictedSkill);
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toContain("skill_role_mismatch");
  });

  it("blocks deprecated skills", async () => {
    const decision = await canAccessSkill(mockIdentity, deprecatedSkill);
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe("skill_deprecated");
  });

  it("filters accessible skills according to role permissions", async () => {
    const skills = [publicSkill, matchingRoleSkill, restrictedSkill, deprecatedSkill];
    const accessible = await filterAccessibleSkills(mockIdentity, skills);
    const names = accessible.map((s) => s.name);
    expect(names).toContain("public-skill");
    expect(names).toContain("analyst-skill");
    expect(names).not.toContain("finance-audit");
    expect(names).not.toContain("deprecated-skill");
  });
});
