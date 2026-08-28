import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { loadAllSkills, getSkillByUri, getSkillByName, parseSkillMarkdown, invalidateSkillsCache } from "../skills/loader.js";
import { validateSkill } from "../skills/validator.js";
import { exportSkillPackage } from "../skills/exporter.js";
import { resolveProjectRoot } from "../project.js";
import type { SkillAsset, SkillClientTarget, SkillWithValidation } from "../skills/types.js";

export function registerSkillsRoutes(app: FastifyInstance): void {
  // 1. List all skills with validation status
  app.get("/api/skills", async (_req: FastifyRequest, reply: FastifyReply) => {
    try {
      const skills = await loadAllSkills();
      const withValidation: SkillWithValidation[] = await Promise.all(
        skills.map(async (skill) => {
          const validation = await validateSkill(skill);
          return {
            ...skill,
            validation,
          };
        })
      );
      return reply.send({
        ok: true,
        count: withValidation.length,
        skills: withValidation,
      });
    } catch (err) {
      return reply.status(500).send({
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  // 2. Get single skill by domain and name
  app.get("/api/skills/:domain/:name", async (req: FastifyRequest<{ Params: { domain: string; name: string } }>, reply: FastifyReply) => {
    const { domain, name } = req.params;
    const uri = `lucy-skill://${domain}/${name}`;
    try {
      let skill = await getSkillByUri(uri);
      if (!skill) {
        skill = await getSkillByName(name);
      }
      if (!skill) {
        return reply.status(404).send({
          ok: false,
          error: `Skill "${name}" in domain "${domain}" not found`,
        });
      }
      const validation = await validateSkill(skill);
      return reply.send({
        ok: true,
        skill: {
          ...skill,
          validation,
        },
      });
    } catch (err) {
      return reply.status(500).send({
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  // 3. Online validate raw skill markdown
  app.post("/api/skills/validate", async (req: FastifyRequest<{ Body: { rawContent?: string; filePath?: string } }>, reply: FastifyReply) => {
    const rawContent = req.body?.rawContent;
    if (typeof rawContent !== "string") {
      return reply.status(400).send({
        ok: false,
        error: "rawContent must be a string",
      });
    }
    try {
      const projectRoot = await resolveProjectRoot();
      const filePath = req.body?.filePath || "skills/custom/temp.skill.md";
      const parsed = parseSkillMarkdown(rawContent, filePath, projectRoot);
      if (!parsed) {
        return reply.send({
          ok: true,
          valid: false,
          issues: [
            {
              type: "error",
              field: "frontmatter",
              message: "Failed to parse YAML frontmatter or missing required 'name' field",
            },
          ],
        });
      }
      const validation = await validateSkill(parsed);
      return reply.send({
        ok: true,
        valid: validation.valid,
        issues: validation.issues,
        skill: parsed,
      });
    } catch (err) {
      return reply.status(500).send({
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  // 4. Export skill bundle
  app.get("/api/skills/export", async (req: FastifyRequest<{ Querystring: { target?: string; proxyUrl?: string } }>, reply: FastifyReply) => {
    const target = (req.query.target as SkillClientTarget) || "all";
    const proxyUrl = req.query.proxyUrl || "http://127.0.0.1:7879/mcp";
    try {
      const skills = await loadAllSkills();
      const bundle = exportSkillPackage(skills, target, { proxyUrl });
      return reply.send({
        ok: true,
        bundle,
      });
    } catch (err) {
      return reply.status(500).send({
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  app.post("/api/skills/export", async (req: FastifyRequest<{ Body: { target?: string; proxyUrl?: string; skills?: string[] } }>, reply: FastifyReply) => {
    const target = (req.body?.target as SkillClientTarget) || "all";
    const proxyUrl = req.body?.proxyUrl || "http://127.0.0.1:7879/mcp";
    const requestedNames = req.body?.skills;
    try {
      let skills = await loadAllSkills();
      if (Array.isArray(requestedNames) && requestedNames.length > 0) {
        const nameSet = new Set(requestedNames.map((n) => n.toLowerCase()));
        skills = skills.filter((s) => nameSet.has(s.name.toLowerCase()) || nameSet.has(s.uri.toLowerCase()));
      }
      const bundle = exportSkillPackage(skills, target, { proxyUrl });
      return reply.send({
        ok: true,
        bundle,
      });
    } catch (err) {
      return reply.status(500).send({
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  // 5. Invalidate skills cache
  app.post("/api/skills/reload", async (_req: FastifyRequest, reply: FastifyReply) => {
    try {
      invalidateSkillsCache();
      const skills = await loadAllSkills();
      return reply.send({
        ok: true,
        reloadedCount: skills.length,
      });
    } catch (err) {
      return reply.status(500).send({
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });
}
