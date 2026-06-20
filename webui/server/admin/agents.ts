import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { stringify, parse } from "yaml";
import type { FastifyInstance } from "fastify";
import { safeWrite } from "../fs-safe.js";
import { resolveProjectRoot } from "../project.js";
import { getAuditDb } from "./audit.js";

const ACCESS_YAML_REL = "webui/config/access.yaml";
const AGENT_ID_RE = /^[A-Za-z0-9_-]{1,32}$/;

export interface YamlToken {
  hash: string;
  label: string;
  created: string;
  expires_at?: string | null;
}

export interface YamlUser {
  id: string;
  name: string;
  note?: string;
  enabled?: boolean;
  tokens: YamlToken[];
  allow: {
    tables: string[];
    tools: string[];
  };
}

export interface YamlAccessConfig {
  users: YamlUser[];
  defaults?: {
    deny_tools?: string[];
    known_tools?: string[];
    table_touching_tools?: string[];
    sensitive_metadata_tools?: string[];
    sensitive_table_prefixes?: string[];
  };
}

async function readAccessYaml(projectRoot: string): Promise<{ config: YamlAccessConfig; raw: string; version: string }> {
  const filePath = path.join(projectRoot, ACCESS_YAML_REL);
  const raw = await readFile(filePath, "utf-8");
  const s = await stat(filePath);
  const hash = createHash("sha256").update(raw).digest("hex").slice(0, 16);
  const version = `${s.mtimeMs.toFixed(0)}-${hash}`;
  const config = parse(raw) as YamlAccessConfig;
  if (!config.users) config.users = [];
  return { config, raw, version };
}

async function writeAccessYaml(projectRoot: string, config: YamlAccessConfig): Promise<void> {
  // Strip derived last_used before writing
  const toWrite: YamlAccessConfig = {
    ...config,
    users: config.users.map((u) => ({
      ...u,
      tokens: u.tokens.map(({ ...t }) => {
        // last_used is never in yaml
        return t;
      })
    }))
  };
  const content = stringify(toWrite, { lineWidth: 0 });
  await safeWrite(projectRoot, ACCESS_YAML_REL, content);
}

function computeVersion(raw: string, mtimeMs: number): string {
  const hash = createHash("sha256").update(raw).digest("hex").slice(0, 16);
  return `${mtimeMs.toFixed(0)}-${hash}`;
}

async function getStats(userId: string): Promise<{
  callsLast7d: number;
  deniedLast7d: number;
  lastSeen?: string;
  topTables: Array<{ table: string; calls: number }>;
}> {
  try {
    const db = await getAuditDb();
    const row = db
      .prepare(
        `SELECT COUNT(*) AS calls7, SUM(CASE WHEN outcome='denied' THEN 1 ELSE 0 END) AS denied7, MAX(ts) AS last_seen
         FROM access_log WHERE user_id = ? AND ts >= datetime('now','-7 days')`
      )
      .get(userId) as { calls7: number; denied7: number; last_seen: string | null } | undefined;

    const topRows = db
      .prepare(
        `SELECT tables, COUNT(*) AS cnt FROM access_log
         WHERE user_id = ? AND ts >= datetime('now','-7 days') AND tables IS NOT NULL
         GROUP BY tables ORDER BY cnt DESC LIMIT 10`
      )
      .all(userId) as Array<{ tables: string; cnt: number }>;

    // Parse table JSON arrays and aggregate
    const tableCounts = new Map<string, number>();
    for (const r of topRows) {
      try {
        const parsed = JSON.parse(r.tables) as string[];
        for (const t of parsed) {
          tableCounts.set(t, (tableCounts.get(t) ?? 0) + r.cnt);
        }
      } catch {
        // skip
      }
    }
    const topTables = [...tableCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([table, calls]) => ({ table, calls }));

    return {
      callsLast7d: row?.calls7 ?? 0,
      deniedLast7d: row?.denied7 ?? 0,
      lastSeen: row?.last_seen ?? undefined,
      topTables
    };
  } catch {
    return { callsLast7d: 0, deniedLast7d: 0, topTables: [] };
  }
}

async function getLastUsedMap(userIds: string[]): Promise<Map<string, Map<string, string>>> {
  // Returns: userId -> (tokenHash -> lastUsed)
  const result = new Map<string, Map<string, string>>();
  if (userIds.length === 0) return result;
  // We can't easily query per-token last_used from access_log (no token hash in log, only userId)
  // So last_used per token is not available; we return per-user last_seen instead
  return result;
}

function userToAgent(user: YamlUser, stats?: Awaited<ReturnType<typeof getStats>>) {
  return {
    id: user.id,
    name: user.name,
    note: user.note,
    enabled: user.enabled !== false,
    tokens: user.tokens.map((t) => ({
      hash: t.hash,
      label: t.label,
      created: t.created,
      expires_at: t.expires_at ?? null
    })),
    allow: {
      tables: user.allow?.tables ?? [],
      tools: user.allow?.tools ?? []
    },
    stats
  };
}

function makeDiff(oldYaml: string, newYaml: string): string {
  const oldLines = oldYaml.split("\n");
  const newLines = newYaml.split("\n");
  const lines: string[] = [];
  const maxLen = Math.max(oldLines.length, newLines.length);
  for (let i = 0; i < maxLen; i++) {
    const o = oldLines[i];
    const n = newLines[i];
    if (o === undefined) {
      lines.push(`+${n}`);
    } else if (n === undefined) {
      lines.push(`-${o}`);
    } else if (o !== n) {
      lines.push(`-${o}`);
      lines.push(`+${n}`);
    } else {
      lines.push(` ${o}`);
    }
  }
  return lines.join("\n");
}

export function registerAgentRoutes(app: FastifyInstance) {
  // GET /api/admin/agents
  app.get("/api/admin/agents", async () => {
    const projectRoot = await resolveProjectRoot();
    const { config, version } = await readAccessYaml(projectRoot);
    const agents = await Promise.all(
      config.users.map(async (user) => {
        const stats = await getStats(user.id);
        return userToAgent(user, stats);
      })
    );
    return { ok: true, data: { agents, version } };
  });

  // POST /api/admin/agents
  app.post<{
    Body: { dryRun?: boolean; agent: { id: string; name: string; note?: string; allow: { tables: string[]; tools: string[] } } };
  }>("/api/admin/agents", async (request, reply) => {
    const dryRun = request.body?.dryRun !== false;
    const agentInput = request.body?.agent;
    if (!agentInput || !agentInput.id || !agentInput.name) {
      return reply.status(400).send({ ok: false, error: { code: "BAD_REQUEST", message: "agent.id and agent.name are required" } });
    }
    if (!AGENT_ID_RE.test(agentInput.id)) {
      return reply.status(400).send({ ok: false, error: { code: "BAD_REQUEST", message: "agent.id must match ^[A-Za-z0-9_-]{1,32}$" } });
    }
    const projectRoot = await resolveProjectRoot();
    const { config, raw } = await readAccessYaml(projectRoot);

    if (config.users.some((u) => u.id === agentInput.id)) {
      return reply.status(409).send({ ok: false, error: { code: "AGENT_ID_TAKEN", message: `Agent id '${agentInput.id}' already exists` } });
    }

    const newUser: YamlUser = {
      id: agentInput.id,
      name: agentInput.name,
      note: agentInput.note,
      enabled: true,
      tokens: [],
      allow: {
        tables: agentInput.allow?.tables ?? [],
        tools: agentInput.allow?.tools ?? []
      }
    };
    const newConfig: YamlAccessConfig = { ...config, users: [...config.users, newUser] };
    const proposedYaml = stringify(newConfig, { lineWidth: 0 });
    const diff = makeDiff(raw, proposedYaml);

    if (dryRun) {
      return { ok: true, data: { diff, proposedYaml } };
    }

    await writeAccessYaml(projectRoot, newConfig);
    return { ok: true, data: { written: true, agent: userToAgent(newUser) } };
  });

  // GET /api/admin/agents/:userId
  app.get<{ Params: { userId: string } }>("/api/admin/agents/:userId", async (request, reply) => {
    const projectRoot = await resolveProjectRoot();
    const { config, version } = await readAccessYaml(projectRoot);
    const user = config.users.find((u) => u.id === request.params.userId);
    if (!user) {
      return reply.status(404).send({ ok: false, error: { code: "AGENT_NOT_FOUND", message: `Agent '${request.params.userId}' not found` } });
    }
    const stats = await getStats(user.id);
    return { ok: true, data: { agent: userToAgent(user, stats), version } };
  });

  // PATCH /api/admin/agents/:userId
  app.patch<{
    Params: { userId: string };
    Body: { dryRun?: boolean; version?: string; patch: { name?: string; note?: string; enabled?: boolean; allow?: { tables?: string[]; tools?: string[] } } };
  }>("/api/admin/agents/:userId", async (request, reply) => {
    const dryRun = request.body?.dryRun !== false;
    const projectRoot = await resolveProjectRoot();
    const filePath = path.join(projectRoot, ACCESS_YAML_REL);
    const raw = await readFile(filePath, "utf-8");
    const s = await stat(filePath);
    const currentVersion = computeVersion(raw, s.mtimeMs);

    if (request.body?.version && request.body.version !== currentVersion) {
      return reply.status(409).send({ ok: false, error: { code: "VERSION_CONFLICT", message: "yaml has been modified by another source, please refresh" } });
    }

    const config = parse(raw) as YamlAccessConfig;
    if (!config.users) config.users = [];
    const userIndex = config.users.findIndex((u) => u.id === request.params.userId);
    if (userIndex === -1) {
      return reply.status(404).send({ ok: false, error: { code: "AGENT_NOT_FOUND", message: `Agent '${request.params.userId}' not found` } });
    }

    const patch = request.body?.patch ?? {};
    const existingUser = config.users[userIndex];
    const updatedUser: YamlUser = {
      ...existingUser,
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.note !== undefined ? { note: patch.note } : {}),
      ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
      allow: {
        tables: patch.allow?.tables !== undefined ? patch.allow.tables : existingUser.allow?.tables ?? [],
        tools: patch.allow?.tools !== undefined ? patch.allow.tools : existingUser.allow?.tools ?? []
      }
    };
    const newUsers = [...config.users];
    newUsers[userIndex] = updatedUser;
    const newConfig: YamlAccessConfig = { ...config, users: newUsers };
    const proposedYaml = stringify(newConfig, { lineWidth: 0 });
    const diff = makeDiff(raw, proposedYaml);

    if (dryRun) {
      return { ok: true, data: { diff, proposedYaml } };
    }

    await writeAccessYaml(projectRoot, newConfig);
    return { ok: true, data: { written: true, agent: userToAgent(updatedUser) } };
  });

  // DELETE /api/admin/agents/:userId
  app.delete<{ Params: { userId: string } }>("/api/admin/agents/:userId", async (request, reply) => {
    const projectRoot = await resolveProjectRoot();
    const { config } = await readAccessYaml(projectRoot);
    const user = config.users.find((u) => u.id === request.params.userId);
    if (!user) {
      return reply.status(404).send({ ok: false, error: { code: "AGENT_NOT_FOUND", message: `Agent '${request.params.userId}' not found` } });
    }

    // Revoke all tokens in sqlite — must succeed before yaml is updated
    const db = await getAuditDb();
    const revokedAt = new Date().toISOString();
    for (const token of user.tokens) {
      db.prepare("INSERT OR REPLACE INTO revoked_tokens (token_hash, revoked_at, reason) VALUES (?, ?, ?)").run(
        token.hash, revokedAt, "agent_deleted"
      );
    }

    const newConfig: YamlAccessConfig = { ...config, users: config.users.filter((u) => u.id !== request.params.userId) };
    await writeAccessYaml(projectRoot, newConfig);
    return { ok: true, data: { written: true } };
  });
}
