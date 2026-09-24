import Fastify from "fastify";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { registerSkillsRoutes } from "../admin/skills.js";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { invalidateSkillsCache } from "../skills/loader.js";

describe("Skills Admin REST API", () => {
  let app: ReturnType<typeof Fastify>;
  let projectRoot: string;
  let previousRoot: string | undefined;

  beforeEach(async () => {
    previousRoot = process.env.KTX_PROJECT_ROOT;
    projectRoot = await mkdtemp(path.join(os.tmpdir(), "skills-api-test-"));
    process.env.KTX_PROJECT_ROOT = projectRoot;

    await mkdir(path.join(projectRoot, "skills", "domains", "superstore"), { recursive: true });
    await mkdir(path.join(projectRoot, "wiki", "global"), { recursive: true });
    await mkdir(path.join(projectRoot, "evals", "superstore"), { recursive: true });

    await writeFile(path.join(projectRoot, "ktx.yaml"), "connections:\n  mysql-aliyun:\n    type: mysql\n");

    await writeFile(
      path.join(projectRoot, "skills", "domains", "superstore", "profit.skill.md"),
      `---
name: superstore-profit
title: Superstore Profit SOP
version: 1.0.0
domain: superstore
status: published
roles_allowed: ["*"]
prerequisites:
  wiki_docs: ["test-playbook.md"]
triggers: ["profit"]
eval_cases: ["evals/superstore/test.yaml"]
description: Profit analysis
---
# Profit SOP
Body content
`
    );

    invalidateSkillsCache();
    app = Fastify();
    registerSkillsRoutes(app);
    await app.ready();
  });

  afterEach(async () => {
    if (previousRoot === undefined) delete process.env.KTX_PROJECT_ROOT;
    else process.env.KTX_PROJECT_ROOT = previousRoot;
    await app.close();
    await rm(projectRoot, { recursive: true, force: true });
  });

  it("GET /api/skills lists all skills with validation", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/skills",
    });
    expect(res.statusCode).toBe(200);
    const json = res.json();
    expect(json.ok).toBe(true);
    expect(json.count).toBeGreaterThanOrEqual(1);
    expect(json.skills[0].name).toBe("superstore-profit");
    expect(json.skills[0].validation).toBeDefined();
  });

  it("GET /api/skills/:domain/:name returns single skill details", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/skills/superstore/superstore-profit",
    });
    expect(res.statusCode).toBe(200);
    const json = res.json();
    expect(json.ok).toBe(true);
    expect(json.skill.name).toBe("superstore-profit");
    expect(json.skill.content).toContain("# Profit SOP");
  });

  it("POST /api/skills/validate validates arbitrary markdown", async () => {
    const validRaw = `---
name: online-skill
title: Online Validated Skill
domain: custom
version: 1.0.0
status: draft
---
# Body
`;
    const resValid = await app.inject({
      method: "POST",
      url: "/api/skills/validate",
      payload: { rawContent: validRaw },
    });
    expect(resValid.statusCode).toBe(200);
    const jsonValid = resValid.json();
    expect(jsonValid.ok).toBe(true);
    expect(jsonValid.valid).toBe(true);

    const invalidRaw = `# No Frontmatter`;
    const resInvalid = await app.inject({
      method: "POST",
      url: "/api/skills/validate",
      payload: { rawContent: invalidRaw },
    });
    expect(resInvalid.statusCode).toBe(200);
    const jsonInvalid = resInvalid.json();
    expect(jsonInvalid.valid).toBe(false);
  });

  it("GET /api/skills/export and POST /api/skills/export generate bundle", async () => {
    const prevPublic = process.env.LUCY_PUBLIC_MCP_URL;
    process.env.LUCY_PUBLIC_MCP_URL = "https://lucy.example.com/mcp";
    try {
      const resGet = await app.inject({
        method: "GET",
        url: "/api/skills/export?target=cursor",
      });
      expect(resGet.statusCode).toBe(200);
      const jsonGet = resGet.json();
      expect(jsonGet.ok).toBe(true);
      expect(jsonGet.bundle.target).toBe("cursor");

      const resPost = await app.inject({
        method: "POST",
        url: "/api/skills/export",
        payload: {
          target: "mcp-json",
          skills: ["superstore-profit"],
        },
      });
      expect(resPost.statusCode).toBe(200);
      const jsonPost = resPost.json();
      expect(jsonPost.bundle.target).toBe("mcp-json");
      expect(jsonPost.bundle.mcpConfig).toBeDefined();
      expect(JSON.stringify(jsonPost.bundle.mcpConfig)).toContain("https://lucy.example.com/mcp");
      expect(JSON.stringify(jsonPost.bundle.mcpConfig)).not.toContain("localhost");
    } finally {
      if (prevPublic === undefined) delete process.env.LUCY_PUBLIC_MCP_URL;
      else process.env.LUCY_PUBLIC_MCP_URL = prevPublic;
    }
  });

  it("POST /api/skills creates a skill file (SC-147-02)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/skills",
      payload: {
        name: "new-skill",
        domain: "acceptance",
        title: "New Skill",
        status: "draft",
        content: "# Hello\n"
      }
    });
    expect(res.statusCode).toBe(201);
    const json = res.json();
    expect(json.ok).toBe(true);
    expect(json.skill.uri).toBe("lucy-skill://acceptance/new-skill");
    const { readFile } = await import("node:fs/promises");
    const text = await readFile(path.join(projectRoot, "skills", "acceptance", "new-skill.md"), "utf8");
    expect(text).toContain("name: new-skill");
  });

  it("rejects create with path traversal or missing name (SC-147-02)", async () => {
    const badPath = await app.inject({
      method: "POST",
      url: "/api/skills",
      payload: { name: "../evil", domain: "acceptance", content: "# x\n" }
    });
    expect(badPath.statusCode).toBe(400);

    const missing = await app.inject({
      method: "POST",
      url: "/api/skills",
      payload: { name: "", domain: "acceptance", content: "# x\n" }
    });
    expect(missing.statusCode).toBe(400);
  });

  it("PUT renames skill and removes old path (SC-147-03)", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/api/skills",
      payload: { name: "rename-me", domain: "acceptance", status: "draft", content: "# A\n" }
    });
    expect(created.statusCode).toBe(201);

    const updated = await app.inject({
      method: "PUT",
      url: "/api/skills/acceptance/rename-me",
      payload: { name: "renamed", domain: "acceptance", status: "draft", content: "# B\n" }
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json().skill.name).toBe("renamed");

    const { access } = await import("node:fs/promises");
    await expect(access(path.join(projectRoot, "skills", "acceptance", "rename-me.md"))).rejects.toThrow();
    await access(path.join(projectRoot, "skills", "acceptance", "renamed.md"));
  });

  it("DELETE removes skill (SC-147-04)", async () => {
    await app.inject({
      method: "POST",
      url: "/api/skills",
      payload: { name: "to-delete", domain: "acceptance", status: "draft", content: "# D\n" }
    });
    const del = await app.inject({
      method: "DELETE",
      url: "/api/skills/acceptance/to-delete"
    });
    expect(del.statusCode).toBe(200);
    const get = await app.inject({
      method: "GET",
      url: "/api/skills/acceptance/to-delete"
    });
    expect(get.statusCode).toBe(404);
  });

  it("allows save of published skill without eval_cases and returns validation false (SC-147-06)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/skills",
      payload: {
        name: "pub-no-eval",
        domain: "acceptance",
        status: "published",
        content: "# Body\n"
      }
    });
    expect(res.statusCode).toBe(201);
    const json = res.json();
    expect(json.skill.validation.valid).toBe(false);
    expect(json.skill.validation.issues.some((i: { field: string }) => i.field === "eval_cases")).toBe(true);
  });

  it("rejects broken frontmatter on create (SC-147-06)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/skills",
      payload: { rawContent: "# No Frontmatter\n" }
    });
    expect(res.statusCode).toBe(400);
  });
});
