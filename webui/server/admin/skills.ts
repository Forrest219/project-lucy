import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { loadAllSkills, getSkillByUri, getSkillByName, parseSkillMarkdown, invalidateSkillsCache } from "../skills/loader.js";
import { validateSkill } from "../skills/validator.js";
import { exportSkillPackage } from "../skills/exporter.js";
import {
  createSkillFile,
  deleteSkillFile,
  SkillWriteError,
  updateSkillFile,
  type SkillWriteInput
} from "../skills/writer.js";
import { resolveProjectRoot } from "../project.js";
import { resolveMcpEndpoint } from "../runtime-config.js";
import type { SkillClientTarget, SkillWithValidation } from "../skills/types.js";

function advertisedMcpUrl(override?: string): string | null {
  const trimmed = override?.trim();
  if (trimmed) return trimmed;
  return resolveMcpEndpoint().url;
}

function writeErrorReply(reply: FastifyReply, err: unknown) {
  if (err instanceof SkillWriteError) {
    return reply.status(err.statusCode).send({ ok: false, error: err.message });
  }
  return reply.status(500).send({
    ok: false,
    error: err instanceof Error ? err.message : String(err)
  });
}

export function registerSkillsRoutes(app: FastifyInstance): void {
  app.get("/api/skills", async (_req: FastifyRequest, reply: FastifyReply) => {
    try {
      const skills = await loadAllSkills();
      const withValidation: SkillWithValidation[] = await Promise.all(
        skills.map(async (skill) => {
          const validation = await validateSkill(skill);
          return { ...skill, validation };
        })
      );
      return reply.send({ ok: true, count: withValidation.length, skills: withValidation });
    } catch (err) {
      return reply.status(500).send({
        ok: false,
        error: err instanceof Error ? err.message : String(err)
      });
    }
  });

  app.post("/api/skills", async (req: FastifyRequest<{ Body: SkillWriteInput }>, reply: FastifyReply) => {
    try {
      const projectRoot = await resolveProjectRoot();
      const skill = await createSkillFile(projectRoot, req.body ?? {});
      return reply.status(201).send({ ok: true, skill });
    } catch (err) {
      return writeErrorReply(reply, err);
    }
  });

  app.post(
    "/api/skills/validate",
    async (req: FastifyRequest<{ Body: { rawContent?: string; filePath?: string } }>, reply: FastifyReply) => {
      const rawContent = req.body?.rawContent;
      if (typeof rawContent !== "string") {
        return reply.status(400).send({ ok: false, error: "rawContent must be a string" });
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
                message: "Failed to parse YAML frontmatter or missing required 'name' field"
              }
            ]
          });
        }
        const validation = await validateSkill(parsed);
        return reply.send({
          ok: true,
          valid: validation.valid,
          issues: validation.issues,
          skill: parsed
        });
      } catch (err) {
        return reply.status(500).send({
          ok: false,
          error: err instanceof Error ? err.message : String(err)
        });
      }
    }
  );

  app.get(
    "/api/skills/export",
    async (req: FastifyRequest<{ Querystring: { target?: string; proxyUrl?: string } }>, reply: FastifyReply) => {
      const target = (req.query.target as SkillClientTarget) || "all";
      const proxyUrl = advertisedMcpUrl(req.query.proxyUrl);
      if (!proxyUrl) {
        return reply.status(400).send({
          ok: false,
          error: "Lucy MCP endpoint is unavailable. Configure LUCY_PUBLIC_MCP_URL or pass proxyUrl."
        });
      }
      try {
        const skills = await loadAllSkills();
        return reply.send({ ok: true, bundle: exportSkillPackage(skills, target, { proxyUrl }) });
      } catch (err) {
        return reply.status(500).send({
          ok: false,
          error: err instanceof Error ? err.message : String(err)
        });
      }
    }
  );

  app.post(
    "/api/skills/export",
    async (
      req: FastifyRequest<{ Body: { target?: string; proxyUrl?: string; skills?: string[] } }>,
      reply: FastifyReply
    ) => {
      const target = (req.body?.target as SkillClientTarget) || "all";
      const proxyUrl = advertisedMcpUrl(req.body?.proxyUrl);
      if (!proxyUrl) {
        return reply.status(400).send({
          ok: false,
          error: "Lucy MCP endpoint is unavailable. Configure LUCY_PUBLIC_MCP_URL or pass proxyUrl."
        });
      }
      try {
        let skills = await loadAllSkills();
        const requestedNames = req.body?.skills;
        if (Array.isArray(requestedNames) && requestedNames.length > 0) {
          const nameSet = new Set(requestedNames.map((n) => n.toLowerCase()));
          skills = skills.filter(
            (s) => nameSet.has(s.name.toLowerCase()) || nameSet.has(s.uri.toLowerCase())
          );
        }
        return reply.send({ ok: true, bundle: exportSkillPackage(skills, target, { proxyUrl }) });
      } catch (err) {
        return reply.status(500).send({
          ok: false,
          error: err instanceof Error ? err.message : String(err)
        });
      }
    }
  );

  app.post("/api/skills/reload", async (_req: FastifyRequest, reply: FastifyReply) => {
    try {
      invalidateSkillsCache();
      const skills = await loadAllSkills();
      return reply.send({ ok: true, reloadedCount: skills.length });
    } catch (err) {
      return reply.status(500).send({
        ok: false,
        error: err instanceof Error ? err.message : String(err)
      });
    }
  });

  app.get(
    "/api/skills/:domain/:name",
    async (req: FastifyRequest<{ Params: { domain: string; name: string } }>, reply: FastifyReply) => {
      const { domain, name } = req.params;
      try {
        let skill = await getSkillByUri(`lucy-skill://${domain}/${name}`);
        if (!skill) skill = await getSkillByName(name);
        if (!skill) {
          return reply.status(404).send({
            ok: false,
            error: `Skill "${name}" in domain "${domain}" not found`
          });
        }
        return reply.send({ ok: true, skill: { ...skill, validation: await validateSkill(skill) } });
      } catch (err) {
        return reply.status(500).send({
          ok: false,
          error: err instanceof Error ? err.message : String(err)
        });
      }
    }
  );

  app.put(
    "/api/skills/:domain/:name",
    async (
      req: FastifyRequest<{ Params: { domain: string; name: string }; Body: SkillWriteInput }>,
      reply: FastifyReply
    ) => {
      try {
        const projectRoot = await resolveProjectRoot();
        const skill = await updateSkillFile(projectRoot, req.params.domain, req.params.name, req.body ?? {});
        return reply.send({ ok: true, skill });
      } catch (err) {
        return writeErrorReply(reply, err);
      }
    }
  );

  app.delete(
    "/api/skills/:domain/:name",
    async (req: FastifyRequest<{ Params: { domain: string; name: string } }>, reply: FastifyReply) => {
      try {
        const projectRoot = await resolveProjectRoot();
        const result = await deleteSkillFile(projectRoot, req.params.domain, req.params.name);
        return reply.send({ ok: true, ...result });
      } catch (err) {
        return writeErrorReply(reply, err);
      }
    }
  );
}
