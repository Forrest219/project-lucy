import Fastify from "fastify";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { registerSkillsRoutes } from "../admin/skills.js";
import { access, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
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
    expect(json.skill.file_version).toMatch(/^[a-f0-9]{64}$/);
  });

  it("GET detail never falls back to a matching name in another domain", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/skills/not-superstore/superstore-profit"
    });
    expect(res.statusCode).toBe(404);
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
    expect(json.skill.roles_allowed).toEqual([]);
    const { readFile } = await import("node:fs/promises");
    const text = await readFile(path.join(projectRoot, "skills", "acceptance", "new-skill.md"), "utf8");
    expect(text).toContain("name: new-skill");
    expect(text).toContain("roles_allowed: []");
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

  it("PUT preserves the original entry path and rejects identity changes", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/api/skills",
      payload: { name: "rename-me", domain: "acceptance", status: "draft", content: "# A\n" }
    });
    expect(created.statusCode).toBe(201);

    const createdSkill = created.json().skill;
    const updated = await app.inject({
      method: "PUT",
      url: "/api/skills/acceptance/rename-me",
      payload: {
        name: "rename-me",
        domain: "acceptance",
        expected_version: createdSkill.file_version,
        status: "draft",
        content: "# B\n"
      }
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json().skill.name).toBe("rename-me");
    expect(updated.json().skill.relativePath).toBe(createdSkill.relativePath);
    expect(await readFile(path.join(projectRoot, createdSkill.relativePath), "utf8")).toContain("# B");

    const rename = await app.inject({
      method: "PUT",
      url: "/api/skills/acceptance/rename-me",
      payload: {
        name: "renamed",
        domain: "acceptance",
        expected_version: updated.json().skill.file_version,
        content: "# C\n"
      }
    });
    expect(rename.statusCode).toBe(409);
    expect(rename.json().error).toContain("skill_identity_immutable");
    await access(path.join(projectRoot, "skills", "acceptance", "rename-me.md"));
  });

  it("updates an underscore domain SKILL.md without moving it", async () => {
    const dir = path.join(projectRoot, "skills", "legacy_domain");
    await mkdir(dir, { recursive: true });
    const entry = path.join(dir, "SKILL.md");
    await writeFile(entry, `---\nname: legacy-skill\ntitle: Legacy\ndomain: legacy_domain\nstatus: draft\nroles_allowed: []\n---\nOld\n`);
    invalidateSkillsCache();
    const detail = await app.inject({ method: "GET", url: "/api/skills/legacy_domain/legacy-skill" });
    const updated = await app.inject({
      method: "PUT",
      url: "/api/skills/legacy_domain/legacy-skill",
      payload: {
        name: "legacy-skill",
        domain: "legacy_domain",
        expected_version: detail.json().skill.file_version,
        content: "New"
      }
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json().skill.relativePath).toBe("skills/legacy_domain/SKILL.md");
    expect(await readFile(entry, "utf8")).toContain("New");
    await expect(access(path.join(dir, "legacy-skill.md"))).rejects.toThrow();
  });

  it("does not overwrite a malformed file at the canonical create path", async () => {
    const dir = path.join(projectRoot, "skills", "acceptance");
    await mkdir(dir, { recursive: true });
    const target = path.join(dir, "occupied.md");
    await writeFile(target, "not frontmatter\n");
    invalidateSkillsCache();
    const res = await app.inject({
      method: "POST",
      url: "/api/skills",
      payload: { name: "occupied", domain: "acceptance", content: "# replacement\n" }
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toContain("skill_path_conflict");
    expect(await readFile(target, "utf8")).toBe("not frontmatter\n");
  });

  it("rejects stale updates and raw frontmatter identity mismatches", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/api/skills",
      payload: { name: "versioned", domain: "acceptance", content: "# A\n" }
    });
    const version = created.json().skill.file_version;
    const first = await app.inject({
      method: "PUT",
      url: "/api/skills/acceptance/versioned",
      payload: { expected_version: version, content: "# B\n" }
    });
    expect(first.statusCode).toBe(200);
    const stale = await app.inject({
      method: "PUT",
      url: "/api/skills/acceptance/versioned",
      payload: { expected_version: version, content: "# C\n" }
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().error).toContain("skill_write_conflict");

    const mismatchedRaw = `---\nname: other\ntitle: Other\ndomain: acceptance\nstatus: draft\nroles_allowed: []\n---\nBody\n`;
    const mismatch = await app.inject({
      method: "PUT",
      url: "/api/skills/acceptance/versioned",
      payload: { expected_version: first.json().skill.file_version, rawContent: mismatchedRaw }
    });
    expect(mismatch.statusCode).toBe(409);
    expect(mismatch.json().error).toContain("skill_identity_immutable");
  });

  it("DELETE removes skill (SC-147-04)", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/api/skills",
      payload: { name: "to-delete", domain: "acceptance", status: "draft", content: "# D\n" }
    });
    const del = await app.inject({
      method: "DELETE",
      url: "/api/skills/acceptance/to-delete",
      payload: { expected_version: created.json().skill.file_version }
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
