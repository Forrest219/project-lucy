// Lucy v0.25 / L25-11 — P0-3 production routes for the semantic batch loop.
//
// Authority: docs/specs/lucy-20261020-v2p5-semantic-batch-operations-spec.md §8
//
// These routes are the production wiring for the base modules that already
// exist (`semantic-scopes`, `semantic-identity`, `semantic-batch-tasks`).
//
// Every route:
//   - re-reads the actor's permission (the global `requireWebuiAuthHook`),
//   - binds the scope / operation to the acting user AND to this instance,
//   - re-checks freshness on every poll, download and commit,
//   - returns ZERO effects when anything is refused.

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat } from "node:fs/promises";
import path from "node:path";
import { actorIdFromRequest } from "./auth/guard.js";
import { resolveProjectRoot } from "./project.js";
import {
  buildSemanticModelIndex,
  semanticIdentityKey,
  type SemanticTableIdentity
} from "./semantic-identity.js";
import {
  resolveSemanticScope,
  resolveSemanticInstanceId,
  requireFreshSemanticScope
} from "./semantic-scopes.js";
import {
  readSemanticBatchTask,
  runSemanticBatchTask,
  type SemanticBatchTask
} from "./semantic-batch-tasks.js";
import { runSemanticTableCheck } from "./semantic-checks.js";
import {
  SemanticBatchError,
  toSemanticBatchError,
  type SemanticBatchErrorCode
} from "./semantic-batch-service.js";
import {
  buildSemanticBatchAuditPayload,
  buildSemanticBatchAuditRecord
} from "./semantic-batch-audit.js";
import { recordConfigChange } from "./admin/audit.js";
import { readPublishPendingSnapshot } from "./publish-workbench-state.js";
import { buildPublishImpact } from "./publish-impact.js";
import {
  describeSemanticBatchPlan,
  SemanticAssetValidationError
} from "./semantic-assets.js";

// ─── Error mapping ──────────────────────────────────────────────────────────

const ERROR_STATUS: Record<SemanticBatchErrorCode, number> = {
  INVALID_REQUEST_SHAPE: 400,
  SCOPE_NOT_FOUND: 409,
  SCOPE_EXPIRED: 409,
  SCOPE_ACTOR_MISMATCH: 409,
  SCOPE_INSTANCE_MISMATCH: 409,
  IDENTITY_AMBIGUOUS: 409,
  IDENTITY_NOT_FOUND: 409,
  MAINTENANCE_PACKAGE_INVALID: 400,
  PACKAGE_BASELINE_UNKNOWN: 409,
  PACKAGE_BASELINE_MISMATCH: 409,
  PACKAGE_INSTANCE_MISMATCH: 409,
  PLAN_DIGEST_MISMATCH: 409,
  IDEMPOTENCY_KEY_CONFLICT: 409,
  BATCH_TASK_NOT_FOUND: 404,
  LIMIT_EXCEEDED: 413,
  BATCH_NO_CHANGE: 200
};

/** Send a batch error with its documented status code. */
export function sendSemanticBatchError(reply: FastifyReply, error: unknown): FastifyReply {
  const batchError = toSemanticBatchError(error);
  const status = ERROR_STATUS[batchError.code] ?? batchError.statusCode ?? 400;
  reply.status(status);
  return reply.send({
    ok: false,
    error: { code: batchError.code, message: batchError.message },
    data: {
      errors: batchError.errors,
      ...(batchError.details ? { details: batchError.details } : {})
    }
  });
}

// ─── Request shape helpers ──────────────────────────────────────────────────

function parseRef(value: unknown): SemanticTableIdentity | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const connectionId = typeof record.connectionId === "string" ? record.connectionId : "";
  const schema = typeof record.schema === "string" ? record.schema : "";
  const table = typeof record.table === "string" ? record.table : "";
  if (!connectionId || !schema || !table) return null;
  return { connectionId, schema, table };
}

/**
 * Parse the `refs` selector.
 *
 * The client may send an explicit list of full identities. A partial identity
 * (only a table name, for instance) is NOT accepted: the full triple is the
 * only unambiguous form (Spec §4.1).
 */
export function parseSemanticRefs(value: unknown): SemanticTableIdentity[] {
  if (!Array.isArray(value)) {
    throw new SemanticBatchError("INVALID_REQUEST_SHAPE", "refs 必须是数组。", {
      statusCode: 400,
      errors: [{ field: "refs", message: "refs 必须是数组。" }]
    });
  }
  const problems: Array<{ field?: string; index?: number; message: string }> = [];
  const refs: SemanticTableIdentity[] = [];
  value.forEach((entry, index) => {
    const parsed = parseRef(entry);
    if (!parsed) {
      problems.push({
        field: "refs",
        index,
        message: `refs[${index}] 必须包含完整的 connectionId / schema / table 三元身份。`
      });
      return;
    }
    refs.push(parsed);
  });
  if (problems.length > 0) {
    throw new SemanticBatchError(
      "INVALID_REQUEST_SHAPE",
      `refs 结构不合法（${problems.length} 项），请提供完整的 connectionId / schema / table。`,
      { statusCode: 400, errors: problems }
    );
  }
  return refs;
}

// ─── Operation registry (cancel + poll) ─────────────────────────────────────

/**
 * The in-process registry of running batch operations.
 *
 * The task RESULT is persisted on disk (so a poll after a restart still finds
 * it); only the CANCEL HANDLE lives in memory — a cancel signal cannot
 * survive a restart, and pretending otherwise would let a client believe a
 * cancelled task was actually cancelled.
 */
const runningOperations = new Map<string, AbortController>();

function operationId(): string {
  return `op_${randomUUID()}`;
}

/** Look up a persisted task and prove it belongs to the caller. */
async function requireOwnedOperation(
  projectRoot: string,
  taskId: string,
  context: { actor: string; instanceId: string }
): Promise<SemanticBatchTask> {
  const task = await readSemanticBatchTask(projectRoot, taskId);
  if (!task) {
    throw new SemanticBatchError("BATCH_TASK_NOT_FOUND", `批量任务 ${taskId} 不存在或已过期清理。`, {
      statusCode: 404
    });
  }
  if (task.actor !== context.actor) {
    throw new SemanticBatchError(
      "SCOPE_ACTOR_MISMATCH",
      `批量任务 ${taskId} 属于其他操作者，不能直接消费。`,
      { statusCode: 409 }
    );
  }
  if (task.instanceId !== context.instanceId) {
    throw new SemanticBatchError(
      "SCOPE_INSTANCE_MISMATCH",
      `批量任务 ${taskId} 属于其他实例，不能直接消费。`,
      { statusCode: 409 }
    );
  }
  return task;
}

function taskStatusView(task: SemanticBatchTask): {
  operationId: string;
  taskId: string;
  scopeId: string;
  status: string;
  cancelled: boolean;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  baselineDigest: string;
  summary: unknown;
  results: unknown[];
  reportJsonUrl?: string;
  reportCsvUrl?: string;
} {
  return {
    operationId: task.taskId,
    taskId: task.taskId,
    scopeId: task.scopeId,
    status: task.status,
    cancelled: task.cancelled,
    createdAt: task.createdAt,
    ...(task.startedAt ? { startedAt: task.startedAt } : {}),
    ...(task.finishedAt ? { finishedAt: task.finishedAt } : {}),
    baselineDigest: task.baselineDigest,
    summary: task.summary,
    results: task.results,
    ...(task.reportJsonPath ? { reportJsonUrl: task.reportJsonPath } : {}),
    ...(task.reportCsvPath ? { reportCsvUrl: task.reportCsvPath } : {})
  };
}

// ─── Route registration ─────────────────────────────────────────────────────

export function registerSemanticBatchRoutes(app: FastifyInstance): void {
  /**
   * POST /api/semantic-assets/scopes
   *
   * Resolve a selection into an immutable scope snapshot. The server computes
   * every target; the client never sends a path (Spec §4.1 / §4.2).
   */
  app.post<{
    Body: { refs?: unknown };
  }>("/api/semantic-assets/scopes", async (request, reply) => {
    try {
      const projectRoot = await resolveProjectRoot();
      const actor = actorIdFromRequest(request);
      const instanceId = await resolveSemanticInstanceId(projectRoot);
      const refs = parseSemanticRefs((request.body ?? {}).refs);

      const resolved = await resolveSemanticScope(projectRoot, { actor, instanceId, refs });
      return reply.send({
        ok: true,
        data: {
          scopeId: resolved.scope.scopeId,
          createdAt: resolved.scope.createdAt,
          expiresAt: resolved.scope.expiresAt,
          baselineDigest: resolved.scope.baseline.digest,
          refs: resolved.scope.refs.map(semanticIdentityKey),
          dependencies: resolved.scope.dependencies.map(semanticIdentityKey),
          targets: resolved.scope.baseline.targets.map((target) => ({
            path: target.path,
            digest: target.digest,
            identity: target.identity ?? null
          })),
          dependencyTargets: resolved.scope.baseline.dependencies.map((target) => ({
            path: target.path,
            digest: target.digest,
            identity: target.identity ?? null
          }))
        }
      });
    } catch (error) {
      return sendSemanticBatchError(reply, error);
    }
  });

  /**
   * POST /api/semantic-assets/check
   *
   * Start an independent batch validation. The task runs in the background and
   * its report is persisted, so leaving the page does not lose the result
   * (Spec §6 / §8).
   */
  app.post<{
    Body: { scopeId?: unknown };
  }>("/api/semantic-assets/check", async (request, reply) => {
    try {
      const projectRoot = await resolveProjectRoot();
      const actor = actorIdFromRequest(request);
      const instanceId = await resolveSemanticInstanceId(projectRoot);
      const scopeId = typeof (request.body ?? {}).scopeId === "string"
        ? ((request.body as { scopeId: string }).scopeId)
        : "";

      const scope = await requireFreshSemanticScope(projectRoot, scopeId, { actor, instanceId });
      const index = await buildSemanticModelIndex(projectRoot);
      const taskId = operationId();
      const controller = new AbortController();
      runningOperations.set(taskId, controller);

      // ★ L25-11 §7.3 (D22): a batch validation is audited as "validated" —
      // NEVER as a publish. The audit is persisted before the task starts.
      const auditPayload = buildSemanticBatchAuditPayload({
        actor,
        actorType: "ui_admin",
        operationId: `check_${taskId}`,
        outcome: "validated",
        scopeId: scope.scopeId,
        baselineDigest: scope.baseline.digest,
        objectCount: scope.refs.length,
        recovery: { recoveryRequired: false, activationStatus: "unknown" },
        details: { taskId, dependencyCount: scope.dependencies.length }
      });
      await recordConfigChange(buildSemanticBatchAuditRecord(auditPayload));

      // Kick the task off in the background; the client polls the operation.
      void runSemanticBatchTask({
        projectRoot,
        taskId,
        scopeId: scope.scopeId,
        actor,
        instanceId,
        baselineDigest: scope.baseline.digest,
        identities: scope.refs,
        dependencyIdentities: scope.dependencies,
        signal: controller.signal,
        check: async (identity) =>
          runSemanticTableCheck({
            projectRoot,
            index,
            identity,
            signal: controller.signal
          })
      })
        .catch(() => undefined)
        .finally(() => {
          runningOperations.delete(taskId);
        });

      reply.status(202);
      return reply.send({
        ok: true,
        data: {
          operationId: taskId,
          taskId,
          scopeId: scope.scopeId,
          status: "queued",
          selectedCount: scope.refs.length,
          dependencyCount: scope.dependencies.length
        }
      });
    } catch (error) {
      return sendSemanticBatchError(reply, error);
    }
  });

  /**
   * GET /api/semantic-assets/plans/:validationId
   *
   * The COMPLETE publish plan of a staged batch: this batch's candidates PLUS
   * the pending disk changes that would be indexed together with them
   * (Spec §3.2 / §7.2, D13).
   */
  app.get<{
    Params: { validationId: string };
  }>("/api/semantic-assets/plans/:validationId", async (request, reply) => {
    try {
      const projectRoot = await resolveProjectRoot();
      const actor = actorIdFromRequest(request);
      const instanceId = await resolveSemanticInstanceId(projectRoot);
      const plan = await describeSemanticBatchPlan(
        projectRoot,
        request.params.validationId,
        { actor, instanceId }
      );
      // Spec §6 — the plan carries the SAME impact model the workbench's
      // confirm side panel uses, so a staged batch and a plain disk sync
      // explain their scope with one set of rules.
      const pending = await readPublishPendingSnapshot(projectRoot);
      const impact = await buildPublishImpact({
        projectRoot,
        snapshot: pending,
        planDigest: plan.planDigest
      });
      return reply.send({ ok: true, data: { ...plan, impact } });
    } catch (error) {
      if (error instanceof SemanticAssetValidationError) {
        reply.status(error.statusCode);
        return reply.send({
          ok: false,
          error: { code: error.code, message: error.message },
          data: { errors: error.errors }
        });
      }
      return sendSemanticBatchError(reply, error);
    }
  });

  /**
   * GET /api/semantic-assets/operations/:id
   *
   * Poll a batch operation. This NEVER re-runs the check (Spec §8).
   */
  app.get<{
    Params: { id: string };
  }>("/api/semantic-assets/operations/:id", async (request, reply) => {
    try {
      const projectRoot = await resolveProjectRoot();
      const actor = actorIdFromRequest(request);
      const instanceId = await resolveSemanticInstanceId(projectRoot);
      const task = await requireOwnedOperation(projectRoot, request.params.id, { actor, instanceId });
      return reply.send({ ok: true, data: taskStatusView(task) });
    } catch (error) {
      return sendSemanticBatchError(reply, error);
    }
  });

  /**
   * POST /api/semantic-assets/operations/:id/cancel
   *
   * Cancel a running batch check. Cancelling does NOT revoke the report of
   * the checks that already completed (Spec §6).
   */
  app.post<{
    Params: { id: string };
  }>("/api/semantic-assets/operations/:id/cancel", async (request, reply) => {
    try {
      const projectRoot = await resolveProjectRoot();
      const actor = actorIdFromRequest(request);
      const instanceId = await resolveSemanticInstanceId(projectRoot);
      const task = await requireOwnedOperation(projectRoot, request.params.id, { actor, instanceId });

      if (task.status !== "queued" && task.status !== "running") {
        return reply.send({
          ok: true,
          data: { ...taskStatusView(task), cancelled: task.cancelled, alreadyTerminal: true }
        });
      }

      const controller = runningOperations.get(request.params.id);
      if (controller) {
        controller.abort();
      }
      return reply.send({
        ok: true,
        data: { ...taskStatusView(task), cancelRequested: true }
      });
    } catch (error) {
      return sendSemanticBatchError(reply, error);
    }
  });

  /**
   * GET /api/semantic-assets/operations/:id/report.csv
   *
   * The persisted CSV report. The download re-checks the operation owner.
   */
  app.get<{
    Params: { id: string };
  }>("/api/semantic-assets/operations/:id/report.csv", async (request, reply) => {
    try {
      const projectRoot = await resolveProjectRoot();
      const actor = actorIdFromRequest(request);
      const instanceId = await resolveSemanticInstanceId(projectRoot);
      const task = await requireOwnedOperation(projectRoot, request.params.id, { actor, instanceId });
      if (!task.reportCsvPath) {
        throw new SemanticBatchError("BATCH_TASK_NOT_FOUND", "该批量任务尚无 CSV 报告。", {
          statusCode: 404
        });
      }
      const csvPath = path.resolve(projectRoot, task.reportCsvPath);
      let exists = false;
      try {
        const info = await lstat(csvPath);
        exists = info.isFile() && !info.isSymbolicLink();
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      if (!exists) {
        throw new SemanticBatchError("BATCH_TASK_NOT_FOUND", "该批量任务的 CSV 报告不存在。", {
          statusCode: 404
        });
      }
      reply.type("text/csv; charset=utf-8");
      reply.header("Content-Disposition", `attachment; filename="semantic-batch-${task.taskId}.csv"`);
      return reply.send(createReadStream(csvPath));
    } catch (error) {
      return sendSemanticBatchError(reply, error);
    }
  });
}

/** Exposed for the in-process publish flow (plan building). */
export type { FastifyRequest };
