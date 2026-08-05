import type { FastifyInstance } from "fastify";
import { allowedToolNames, check, effectivePermissions } from "../proxy/acl.js";
import type { Identity } from "../proxy/identity.js";
import { getAccessConfig } from "../proxy/identity.js";
import { resolveProjectRoot } from "../project.js";
import { decisionReasonDetail, decisionReasonLabel } from "./decision-reason-labels.js";

const TABLE_SAMPLE_LIMIT = 12;
/** Reserved `x-lucy-platform` / `lucy_platform` value for MCP 调试台受控试调. */
export const MCP_PLAYGROUND_PLATFORM = "mcp-playground";
let liveSmokeInFlight = false;

function playgroundIdentity(agentId: string): Identity {
  return {
    userId: agentId,
    tokenLabel: "mcp-playground",
    tokenHashPrefix: "playground"
  };
}

function auditDeniedHref(agentId: string): string {
  return `/admin/audit?view=calls&range=7d&outcome=denied&user=${encodeURIComponent(agentId)}`;
}

function auditCallsHref(agentId: string): string {
  return `/admin/audit?view=calls&range=7d&user=${encodeURIComponent(agentId)}&callSource=playground`;
}

export function registerMcpPlaygroundRoutes(app: FastifyInstance) {
  app.post<{
    Body: { agentId?: string; tool?: string; arguments?: unknown };
  }>("/api/admin/mcp-playground/acl-preview", async (request, reply) => {
    const agentId = typeof request.body?.agentId === "string" ? request.body.agentId.trim() : "";
    const tool = typeof request.body?.tool === "string" ? request.body.tool.trim() : "";
    const args =
      request.body?.arguments === undefined || request.body?.arguments === null
        ? {}
        : request.body.arguments;

    if (!agentId) {
      return reply.code(400).send({ ok: false, error: { code: "bad_request", message: "缺少 agentId" } });
    }
    if (!tool) {
      return reply.code(400).send({ ok: false, error: { code: "bad_request", message: "缺少 tool" } });
    }
    if (typeof args !== "object" || Array.isArray(args)) {
      return reply.code(400).send({
        ok: false,
        error: { code: "bad_request", message: "arguments 必须是 JSON 对象" }
      });
    }

    const config = await getAccessConfig({ fresh: true });
    const user = config.users.find((u) => u.id === agentId);
    if (!user) {
      return reply.code(404).send({ ok: false, error: { code: "not_found", message: `Agent 不存在：${agentId}` } });
    }

    const identity = playgroundIdentity(agentId);
    const decision = await check(identity, tool, args);
    const decisionReason = decision.allowed ? "allowed" : (decision.reason ?? "tool_forbidden");
    const label = decisionReasonLabel(decisionReason);
    const detail = decisionReasonDetail(decisionReason);

    const roleIds = user.role ? [user.role] : [];
    const resolved = await effectivePermissions(identity);
    const tools = resolved.ok ? resolved.permissions.tools : [];
    const connections = resolved.ok ? resolved.permissions.connections : [];
    const tables = resolved.ok ? resolved.permissions.tables : [];
    const tableSample = tables.slice(0, TABLE_SAMPLE_LIMIT);

    const primary =
      roleIds.length > 0
        ? {
            label: "编辑 Role 表范围",
            href: `/admin/roles/${encodeURIComponent(roleIds[0]!)}?tab=permissions`
          }
        : {
            label: "打开 Agent",
            href: `/admin/agents/${encodeURIComponent(agentId)}`
          };

    return {
      ok: true,
      data: {
        allowed: decision.allowed,
        decisionReason,
        decisionReasonLabel: label,
        decisionReasonDetail: detail,
        roleIds,
        remediation: {
          primary,
          secondary: [
            { label: "打开 Agent", href: `/admin/agents/${encodeURIComponent(agentId)}` },
            { label: "查看近 7 天同类拒绝", href: auditDeniedHref(agentId) }
          ]
        },
        effectivePermissions: {
          tools: tools.includes("*") ? await allowedToolNames(identity) : tools,
          connections,
          tableSample,
          tableSampleTruncated: tables.length > TABLE_SAMPLE_LIMIT
        }
      }
    };
  });

  app.post<{
    Body: {
      agentId?: string;
      tool?: string;
      method?: string;
      arguments?: unknown;
      bearerToken?: string;
    };
  }>("/api/admin/mcp-playground/live-smoke", async (request, reply) => {
    if (liveSmokeInFlight) {
      return reply.code(429).send({
        ok: false,
        error: { code: "too_many_requests", message: "已有受控试调进行中，请稍候" }
      });
    }

    const agentId = typeof request.body?.agentId === "string" ? request.body.agentId.trim() : "";
    const tool = typeof request.body?.tool === "string" ? request.body.tool.trim() : "";
    const method = typeof request.body?.method === "string" ? request.body.method.trim() : "";
    const bearerToken = typeof request.body?.bearerToken === "string" ? request.body.bearerToken.trim() : "";

    const rpcMethod = method || (tool === "tools/list" ? "tools/list" : "");
    if (rpcMethod !== "tools/list") {
      return reply.code(400).send({
        ok: false,
        error: { code: "bad_request", message: "受控试调仅允许 tools/list" }
      });
    }
    if (!agentId) {
      return reply.code(400).send({ ok: false, error: { code: "bad_request", message: "缺少 agentId" } });
    }
    if (!bearerToken) {
      return reply.code(400).send({ ok: false, error: { code: "bad_request", message: "缺少 Bearer Token" } });
    }

    const config = await getAccessConfig({ fresh: true });
    if (!config.users.some((u) => u.id === agentId)) {
      return reply.code(404).send({ ok: false, error: { code: "not_found", message: `Agent 不存在：${agentId}` } });
    }

    // Resolve loopback MCP URL only — never accept client-supplied hosts (SSRF).
    const projectRoot = await resolveProjectRoot();
    const { readProject } = await import("../project.js");
    const project = await readProject(projectRoot);
    const endpoint = project.mcpEndpoint?.url;
    if (!endpoint || typeof endpoint !== "string") {
      return reply.code(503).send({
        ok: false,
        error: { code: "unavailable", message: "本机 MCP Endpoint 不可用" }
      });
    }
    let parsed: URL;
    try {
      parsed = new URL(endpoint);
    } catch {
      return reply.code(503).send({
        ok: false,
        error: { code: "unavailable", message: "MCP Endpoint 无效" }
      });
    }
    if (!["127.0.0.1", "localhost", "::1"].includes(parsed.hostname)) {
      return reply.code(400).send({
        ok: false,
        error: { code: "bad_request", message: "受控试调仅允许本机 MCP Endpoint" }
      });
    }

    const body = {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list",
      params: {}
    };

    liveSmokeInFlight = true;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30_000);
    try {
      const response = await fetch(parsed.toString(), {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
          authorization: `Bearer ${bearerToken}`,
          // Attribution only — identity still comes from Bearer Token; Proxy copies into lucy_platform.
          "x-lucy-platform": MCP_PLAYGROUND_PLATFORM
        },
        body: JSON.stringify(body),
        signal: controller.signal
      });
      const text = await response.text();
      let json: unknown = null;
      try {
        json = JSON.parse(text);
      } catch {
        json = { raw: text.slice(0, 2000) };
      }
      return {
        ok: true,
        data: {
          httpStatus: response.status,
          decisionReason: response.status === 401 ? "token_revoked" : "allowed",
          decisionReasonLabel: decisionReasonLabel(response.status === 401 ? "token_revoked" : "allowed"),
          result: json,
          auditHref: auditCallsHref(agentId)
        }
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "live smoke failed";
      return reply.code(502).send({
        ok: false,
        error: { code: "upstream_error", message }
      });
    } finally {
      clearTimeout(timer);
      liveSmokeInFlight = false;
    }
  });
}
