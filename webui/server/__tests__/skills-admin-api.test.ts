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
  });
});
