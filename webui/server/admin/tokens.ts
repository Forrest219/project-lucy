import { createHash, randomBytes } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { stringify, parse } from "yaml";
import type { FastifyInstance } from "fastify";
import { safeWrite } from "../fs-safe.js";
import { resolveProjectRoot } from "../project.js";
import { getAuditDb } from "./audit.js";
import type { YamlAccessConfig } from "./agents.js";

const ACCESS_YAML_REL = "webui/config/access.yaml";

function hashToken(token: string): string {
  return "sha256:" + createHash("sha256").update(token).digest("hex");
}

export function registerTokenRoutes(app: FastifyInstance) {
  // POST /api/admin/agents/:userId/tokens
  app.post<{
    Params: { userId: string };
    Body: { label: string; expires_at?: string | null };
  }>("/api/admin/agents/:userId/tokens", async (request, reply) => {
    const { userId } = request.params;
    const { label, expires_at } = request.body ?? {};

    if (!label || typeof label !== "string" || label.trim().length === 0) {
      return reply.status(400).send({ ok: false, error: { code: "BAD_REQUEST", message: "label is required" } });
    }

    const projectRoot = await resolveProjectRoot();
    const filePath = path.join(projectRoot, ACCESS_YAML_REL);
    const raw = await readFile(filePath, "utf-8");
    const config = parse(raw) as YamlAccessConfig;
    if (!config.users) config.users = [];

    const userIndex = config.users.findIndex((u) => u.id === userId);
    if (userIndex === -1) {
      return reply.status(404).send({ ok: false, error: { code: "AGENT_NOT_FOUND", message: `Agent '${userId}' not found` } });
    }

    const user = config.users[userIndex];
    if (user.tokens.some((t) => t.label === label)) {
      return reply.status(409).send({ ok: false, error: { code: "TOKEN_LABEL_TAKEN", message: `Token label '${label}' already exists for this agent` } });
    }

    // Generate token — plaintext never written anywhere except the HTTP response
    const plainToken = randomBytes(32).toString("hex");
    const tokenHash = hashToken(plainToken);
    const created = new Date().toISOString().slice(0, 10);

    const newToken = {
      hash: tokenHash,
      label,
      created,
      ...(expires_at !== undefined ? { expires_at: expires_at ?? null } : {})
    };

    const updatedUser = { ...user, tokens: [...user.tokens, newToken] };
    const newUsers = [...config.users];
    newUsers[userIndex] = updatedUser;
    const newConfig: YamlAccessConfig = { ...config, users: newUsers };
    const content = stringify(newConfig, { lineWidth: 0 });
    await safeWrite(projectRoot, ACCESS_YAML_REL, content);

    return {
      ok: true,
      data: {
        token: plainToken,
        hash: tokenHash,
        label,
        created,
        expires_at: expires_at ?? null
      }
    };
  });

  // DELETE /api/admin/agents/:userId/tokens/:label
  app.delete<{
    Params: { userId: string; label: string };
  }>("/api/admin/agents/:userId/tokens/:label", async (request, reply) => {
    const { userId, label } = request.params;
    const projectRoot = await resolveProjectRoot();
    const filePath = path.join(projectRoot, ACCESS_YAML_REL);
    const raw = await readFile(filePath, "utf-8");
    const config = parse(raw) as YamlAccessConfig;
    if (!config.users) config.users = [];

    const userIndex = config.users.findIndex((u) => u.id === userId);
    if (userIndex === -1) {
      return reply.status(404).send({ ok: false, error: { code: "AGENT_NOT_FOUND", message: `Agent '${userId}' not found` } });
    }

    const user = config.users[userIndex];
    const token = user.tokens.find((t) => t.label === label);
    if (!token) {
      return reply.status(404).send({ ok: false, error: { code: "TOKEN_NOT_FOUND", message: `Token '${label}' not found` } });
    }

    const revokedAt = new Date().toISOString();

    // Write revoked_tokens to sqlite — must succeed before yaml is updated
    const db = await getAuditDb();
    db.prepare("INSERT OR REPLACE INTO revoked_tokens (token_hash, revoked_at, reason) VALUES (?, ?, ?)").run(
      token.hash, revokedAt, "manual_revoke"
    );

    const updatedUser = { ...user, tokens: user.tokens.filter((t) => t.label !== label) };
    const newUsers = [...config.users];
    newUsers[userIndex] = updatedUser;
    const newConfig: YamlAccessConfig = { ...config, users: newUsers };
    const content = stringify(newConfig, { lineWidth: 0 });
    await safeWrite(projectRoot, ACCESS_YAML_REL, content);

    return { ok: true, data: { written: true, revokedAt } };
  });
}
