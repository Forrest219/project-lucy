import { describe, it, expect, beforeEach } from "vitest";
import { parseSkillMarkdown, loadAllSkills, getSkillByUri, getSkillByName, invalidateSkillsCache } from "../skills/loader.js";
import { validateSkill } from "../skills/validator.js";
import { exportSkillPackage } from "../skills/exporter.js";
import type { SkillAsset } from "../skills/types.js";

describe("Skill Loader & Validator & Exporter", () => {
  beforeEach(() => {
    invalidateSkillsCache();
  });

  it("parses valid skill markdown with frontmatter", () => {
    const raw = `---
name: test-skill
title: Test Governed Skill
domain: test_domain
version: 1.2.0
status: published
roles_allowed:
  - analyst
  - admin
prerequisites:
  sources:
    - mysql-aliyun.superstore_orders
  wiki_docs:
    - test.md
triggers:
  - test query
eval_cases:
  - evals/test.yaml
description: A test skill description
---
# Test Content
This is the markdown body.
`;

    const skill = parseSkillMarkdown(raw, "/workspace/skills/domains/test_domain/test-skill.skill.md", "/workspace");
    expect(skill).not.toBeNull();
    expect(skill?.name).toBe("test-skill");
    expect(skill?.title).toBe("Test Governed Skill");
    expect(skill?.domain).toBe("test_domain");
    expect(skill?.version).toBe("1.2.0");
    expect(skill?.status).toBe("published");
    expect(skill?.roles_allowed).toEqual(["analyst", "admin"]);
    expect(skill?.triggers).toEqual(["test query"]);
    expect(skill?.uri).toBe("lucy-skill://test_domain/test-skill");
    expect(skill?.content).toBe("# Test Content\nThis is the markdown body.");
  });

  it("returns null for invalid markdown without frontmatter", () => {
    const raw = `# Just a title\nNo frontmatter here`;
    const skill = parseSkillMarkdown(raw, "/workspace/skills/readme.md", "/workspace");
    expect(skill).toBeNull();
  });

  it("validates missing required fields and slug format", async () => {
    const invalidSkill: SkillAsset = {
      name: "invalid name with spaces!",
      title: "",
      domain: "",
      version: "1.0.0",
      status: "published",
      roles_allowed: ["*"],
      prerequisites: {
        sources: [],
        measures: [],
        wiki_docs: ["non_existent_doc_12345.md"],
      },
      triggers: [],
      eval_cases: [],
      description: "",
      uri: "lucy-skill://invalid",
      relativePath: "skills/invalid.md",
      filePath: "/workspace/skills/invalid.md",
      content: "content",
      raw: "raw",
    };

    const res = await validateSkill(invalidSkill);
    expect(res.valid).toBe(false);
    const fields = res.issues.map((i) => i.field);
    expect(fields).toContain("name");
    expect(fields).toContain("title");
    expect(fields).toContain("domain");
    expect(fields).toContain("prerequisites.wiki_docs");
    expect(fields).toContain("eval_cases");
  });

  it("loads actual repository skills and finds superstore-profit-breakdown", async () => {
    const skills = await loadAllSkills();
    expect(skills.length).toBeGreaterThanOrEqual(1);

    const superstoreSkill = await getSkillByName("superstore-profit-breakdown");
    expect(superstoreSkill).not.toBeNull();
    expect(superstoreSkill?.domain).toBe("superstore");

    const uriSkill = await getSkillByUri("lucy-skill://superstore/superstore-profit-breakdown");
    expect(uriSkill).not.toBeNull();
    expect(uriSkill?.name).toBe("superstore-profit-breakdown");
  });

  it("exports skills package for claude-code, cursor and mcp-json", async () => {
    const skills = await loadAllSkills();
    const bundleAll = exportSkillPackage(skills, "all", { proxyUrl: "http://localhost:7879/mcp" });
    expect(bundleAll.count).toBe(skills.length);
    expect(bundleAll.mcpConfig).toBeDefined();
    expect(Object.keys(bundleAll.files).length).toBeGreaterThan(0);

    const bundleClaude = exportSkillPackage(skills, "claude-code");
    expect(bundleClaude.target).toBe("claude-code");
    expect(Object.keys(bundleClaude.files)[0]).toMatch(/\/SKILL\.md$/);
  });
});
