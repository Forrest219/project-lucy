/**
 * Lucy v0.25 P1-2 — 授权摘要只读路由。
 *
 * Authority:
 *   - docs/specs/lucy-20261025-v0p25-access-authorization-summary-spec.md §4（页面与 API 合同）、
 *     §4.3（API 复用）、§5（核心流程）、§6（一致性与降级）、§8（ASV-08／ASV-09／ASV-13）
 *   - docs/plans/2026-10-25-lucy-v0.25-p1-implementation-plan.md §5（B1、B6）、§2.1
 *
 * 这些端点是**只读**的：
 *
 *   - 不写 access.yaml、不换入策略、不写审计事件；
 *   - 不返回 Token 明文、数据库口令或任何超授权内容（ASV-13）；
 *   - `preview` 端点只在内存里叠加草稿，返回的候选摘要必须由调用方标为
 *     「候选预览，尚未生效」（Spec §2.1／§4.2）。
 *
 * 路由挂载由 W6 负责（`webui/server/index.ts` 不在本波次的文件所有权内）：
 *
 *   import { registerAuthorizationSummaryRoutes } from "./admin/routes/authorization-summary.js";
 *   registerAuthorizationSummaryRoutes(app);
 */
import type { FastifyInstance } from "fastify";
import { computeCandidateDigest } from "../../config-digest.js";
import { resolveProjectRoot } from "../../project.js";
import { readAccessSnapshot } from "../permission-display.js";
import { validateRoleShape } from "../roles.js";
import {
  buildAuthorizationSummary,
  overlayAgentDraft,
  overlayRoleDraft
} from "../authorization-summary.js";

/**
 * Register the authorization-summary Admin routes.
 *
 * Wiring (owned by W6, `webui/server/index.ts`):
 *
 *   import { registerAuthorizationSummaryRoutes } from "./admin/routes/authorization-summary.js";
 *   registerAuthorizationSummaryRoutes(app);
 */
export function registerAuthorizationSummaryRoutes(app: FastifyInstance): void {
  // GET /api/admin/authorization-summary/agent/:userId — the committed Agent summary.
  app.get<{ Params: { userId: string } }>(
    "/api/admin/authorization-summary/agent/:userId",
    async (request, reply) => {
      const projectRoot = await resolveProjectRoot();
      const snapshot = await readAccessSnapshot(projectRoot);
      if (!snapshot.runtimeConfig?.users?.some((user) => user.id === request.params.userId)) {
        return reply.status(404).send({
          ok: false,
          error: { code: "AGENT_NOT_FOUND", message: `Agent '${request.params.userId}' not found` }
        });
      }
      const summary = await buildAuthorizationSummary({
        subject: { kind: "agent", id: request.params.userId },
        basis: "committed",
        snapshot,
        projectRoot
      });
      return { ok: true, data: { summary, candidateDigest: null } };
    }
  );

  // GET /api/admin/authorization-summary/role/:roleId — the committed Role summary.
  app.get<{ Params: { roleId: string } }>(
    "/api/admin/authorization-summary/role/:roleId",
    async (request, reply) => {
      const projectRoot = await resolveProjectRoot();
      const snapshot = await readAccessSnapshot(projectRoot);
      if (!snapshot.runtimeConfig?.roles?.[request.params.roleId]) {
        return reply.status(404).send({
          ok: false,
          error: { code: "ROLE_NOT_FOUND", message: `Role '${request.params.roleId}' not found` }
        });
      }
      const summary = await buildAuthorizationSummary({
        subject: { kind: "role", id: request.params.roleId },
        basis: "committed",
        snapshot,
        projectRoot
      });
      return { ok: true, data: { summary, candidateDigest: null } };
    }
  );

  // POST /api/admin/authorization-summary/agent/:userId/preview — candidate Agent summary.
  //
  // The draft is overlaid on the committed configuration IN MEMORY. Nothing is
  // written and the committed policy is never swapped in. The returned
  // `candidateDigest` is the invalidation token: when the draft changes, the
  // previous candidate summary is stale and must not be used to confirm the new
  // draft (Spec §5／§6, ASV-09).
  app.post<{
    Params: { userId: string };
    Body: {
      name?: string;
      enabled?: boolean;
      role?: string;
      roles?: string[];
      constraints?: unknown;
    };
  }>("/api/admin/authorization-summary/agent/:userId/preview", async (request, reply) => {
    const projectRoot = await resolveProjectRoot();
    const snapshot = await readAccessSnapshot(projectRoot);
    const committed = snapshot.runtimeConfig;
    if (!committed) {
      // The configuration itself is unreadable — the summary model carries that
      // degradation. Do NOT answer with an empty permission set.
      const summary = await buildAuthorizationSummary({
        subject: { kind: "agent", id: request.params.userId },
        basis: "committed",
        snapshot,
        projectRoot
      });
      return { ok: true, data: { summary, candidateDigest: null } };
    }
    const draft = request.body ?? {};
    const declaredRoleIds = Array.isArray(draft.roles)
      ? draft.roles.filter((value): value is string => typeof value === "string")
      : typeof draft.role === "string" && draft.role.trim()
        ? [draft.role.trim()]
        : [];
    const unknownRole = declaredRoleIds.find((roleId) => !committed.roles?.[roleId]);
    if (unknownRole) {
      return reply.status(400).send({
        ok: false,
        error: { code: "ROLE_NOT_FOUND", message: `Role '${unknownRole}' not found` }
      });
    }
    const candidate = overlayAgentDraft(committed, request.params.userId, draft);
    const candidateDigest = computeCandidateDigest(candidate);
    const summary = await buildAuthorizationSummary({
      subject: { kind: "agent", id: request.params.userId },
      basis: "draft",
      snapshot,
      projectRoot,
      candidate,
      candidateDigest
    });
    return { ok: true, data: { summary, candidateDigest } };
  });

  // POST /api/admin/authorization-summary/role/:roleId/preview — candidate Role summary.
  app.post<{
    Params: { roleId: string };
    Body: { role?: unknown };
  }>("/api/admin/authorization-summary/role/:roleId/preview", async (request, reply) => {
    const projectRoot = await resolveProjectRoot();
    const snapshot = await readAccessSnapshot(projectRoot);
    const committed = snapshot.runtimeConfig;
    if (!committed) {
      const summary = await buildAuthorizationSummary({
        subject: { kind: "role", id: request.params.roleId },
        basis: "committed",
        snapshot,
        projectRoot
      });
      return { ok: true, data: { summary, candidateDigest: null } };
    }
    if (request.body?.role === undefined || request.body?.role === null) {
      return reply.status(400).send({
        ok: false,
        error: { code: "BAD_REQUEST", message: "role is required" }
      });
    }
    const shape = validateRoleShape(request.body.role);
    if (!shape.ok) {
      return reply.status(400).send({
        ok: false,
        error: { code: "INVALID_ROLE", message: shape.reason }
      });
    }
    const candidate = overlayRoleDraft(committed, request.params.roleId, shape.value);
    const candidateDigest = computeCandidateDigest(candidate);
    const summary = await buildAuthorizationSummary({
      subject: { kind: "role", id: request.params.roleId },
      basis: "draft",
      snapshot,
      projectRoot,
      candidate,
      candidateDigest
    });
    return { ok: true, data: { summary, candidateDigest } };
  });
}
