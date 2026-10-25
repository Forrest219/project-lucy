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

  it("defaults missing or unknown status to draft (fail-closed, Spec 144)", () => {
    const raw = `---
name: no-status-skill
domain: test_domain
---
# Body
`;
    const skill = parseSkillMarkdown(raw, "/workspace/skills/domains/test_domain/no-status.skill.md", "/workspace");
    expect(skill).not.toBeNull();
    expect(skill?.status).toBe("draft");
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
      owner: "",
      uri: "lucy-skill://invalid",
      relativePath: "skills/invalid.md",
      filePath: "/workspace/skills/invalid.md",
      content: "content",
      raw: "raw",
      file_version: "v1",
    };

    const res = validateSkill(invalidSkill);
    expect(res.valid).toBe(false);
    const fields = res.issues.map((i) => i.field);
    expect(fields).toContain("name");
    expect(fields).toContain("title");
    expect(fields).toContain("domain");
    expect(fields).not.toContain("prerequisites.wiki_docs");
    expect(fields).not.toContain("eval_cases");
  });

  it("accepts a published public skill without eval, wiki, or semantic sources", () => {
    const skill: SkillAsset = {
      name: "shared-sop",
      title: "共享 SOP",
      domain: "global",
      version: "1.0.0",
      status: "published",
      roles_allowed: ["*"],
      prerequisites: {
        sources: ["mysql-aliyun.missing_table"],
        measures: [],
        wiki_docs: ["missing-playbook.md"],
      },
      triggers: [],
      eval_cases: [],
      description: "public skill",
      owner: "",
      uri: "lucy-skill://global/shared-sop",
      relativePath: "skills/global/shared-sop.md",
      filePath: "/workspace/skills/global/shared-sop.md",
      content: "# Body",
      raw: "raw",
      file_version: "v1",
    };

    const res = validateSkill(skill);
    expect(res.valid).toBe(true);
    expect(res.issues).toEqual([]);
  });

  it("loads actual repository skills and finds answer-style", async () => {
    // Spec 170 retired several warehouse/analysis built-ins; answer-style remains published.
    // Pass repo skills/ explicitly: default content root is <project>/config/skills (may be empty locally).
    const { fileURLToPath } = await import("node:url");
    const { dirname, resolve } = await import("node:path");
    const repoSkills = resolve(dirname(fileURLToPath(import.meta.url)), "../../../skills");
    const skills = await loadAllSkills(repoSkills);
    expect(skills.length).toBeGreaterThanOrEqual(1);

    const answerStyle = await getSkillByName("answer-style", repoSkills);
    expect(answerStyle).not.toBeNull();
    expect(answerStyle?.domain).toBe("answer-style");

    const uriSkill = await getSkillByUri("lucy-skill://answer-style/answer-style", repoSkills);
    expect(uriSkill).not.toBeNull();
    expect(uriSkill?.name).toBe("answer-style");
  });

  it("exports skills package for claude-code, cursor and mcp-json", async () => {
    const { fileURLToPath } = await import("node:url");
    const { dirname, resolve } = await import("node:path");
    const repoSkills = resolve(dirname(fileURLToPath(import.meta.url)), "../../../skills");
    const skills = await loadAllSkills(repoSkills);
    const bundleAll = exportSkillPackage(skills, "all", { proxyUrl: "https://lucy.example.com/mcp" });
    expect(bundleAll.count).toBe(skills.length);
    expect(bundleAll.mcpConfig).toBeDefined();
    expect(Object.keys(bundleAll.files).length).toBeGreaterThan(0);

    const bundleClaude = exportSkillPackage(skills, "claude-code");
    expect(bundleClaude.target).toBe("claude-code");
    expect(Object.keys(bundleClaude.files)[0]).toMatch(/\/SKILL\.md$/);
  });
});
