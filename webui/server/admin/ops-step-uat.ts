import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import {
  createOpsStepId,
  getOpsStepJournal,
  type OpsStepName
} from "../runtime/ops-step-journal.js";
import { setOpsStepReadInjector } from "./ops-steps.js";

export type OpsStepUatDiagnosticInput = {
  steps: OpsStepName[];
  holdMs: number;
  lifecycle: "production" | "isolated";
};

export type OpsStepUatDependencies = {
  startDiagnostic: (input: OpsStepUatDiagnosticInput) => { opId: string };
  setBackgroundEnabled: (enabled: boolean) => void | Promise<void>;
  waitForIdle?: () => Promise<void>;
};

type ReadFault = { mode: "delay"; delayMs: number; token: string } | { mode: "error"; token: string };

let readFault: ReadFault | undefined;

export function isOpsStepUatEnabled(): boolean {
  return process.env.LUCY_OPS_STEP_UAT === "1";
}

export async function applyOpsStepReadFaultForUat(token: string | undefined): Promise<void> {
  if (!isOpsStepUatEnabled() || !readFault || !token || readFault.token !== token) return;
  const fault = readFault;
  readFault = undefined;
  if (fault.mode === "delay") {
    await new Promise<void>((resolve) => setTimeout(resolve, fault.delayMs));
    return;
  }
  throw Object.assign(new Error("运维步骤读取失败，请刷新重试"), {
    code: "OPS_STEP_READ_FAILED",
    statusCode: 500
  });
}

export function resetOpsStepUatStateForTests(): void {
  readFault = undefined;
}

function integerInRange(value: unknown, min: number, max: number): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max;
}

function badRequest(message: string) {
  return Object.assign(new Error(message), { code: "BAD_REQUEST", statusCode: 400 });
}

export function opsStepUatBusyError(message: string) {
  return Object.assign(new Error(message), { code: "OPS_STEP_UAT_BUSY", statusCode: 409 });
}

export function registerOpsStepUatRoutes(
  app: FastifyInstance,
  dependencies: OpsStepUatDependencies
): void {
  if (!isOpsStepUatEnabled()) return;

  setOpsStepReadInjector(async (token) => {
    await applyOpsStepReadFaultForUat(token);
  });

  app.post("/api/admin/ops-step-uat/reset", async () => {
    readFault = undefined;
    await getOpsStepJournal().resetForUat();
    return { ok: true };
  });

  app.post<{ Body: Partial<OpsStepUatDiagnosticInput> }>(
    "/api/admin/ops-step-uat/diagnostic",
    async (request, reply) => {
      const steps = request.body?.steps;
      const holdMs = request.body?.holdMs;
      const lifecycle = request.body?.lifecycle ?? "production";
      if (!Array.isArray(steps) || steps.length === 0 || new Set(steps).size !== steps.length) {
        throw badRequest("steps 必须是非空且不重复的已登记步骤");
      }
      const allowed = new Set<OpsStepName>([
        "read_project",
        "read_ktx_yaml",
        "read_catalog_reloads",
        "read_reload_state",
        "probe_execution"
      ]);
      if (!steps.every((step): step is OpsStepName => typeof step === "string" && allowed.has(step as OpsStepName))) {
        throw badRequest("steps 含未登记诊断步骤");
      }
      if (!integerInRange(holdMs, 0, 3_700_000)) throw badRequest("holdMs 超出挡板范围");
      if (lifecycle !== "production" && lifecycle !== "isolated") throw badRequest("lifecycle 无效");
      const result = dependencies.startDiagnostic({ steps, holdMs, lifecycle });
      return reply.code(202).send({ ok: true, data: result });
    }
  );

  app.post<{ Body: { holdMs?: number } }>(
    "/api/admin/ops-step-uat/sync-section",
    async (request, reply) => {
      const holdMs = request.body?.holdMs ?? 10_000;
      if (!integerInRange(holdMs, 0, 10_000)) throw badRequest("holdMs 超出同步段挡板范围");
      const opId = createOpsStepId();
      const flushed = new Promise<void>((resolve) => {
        reply.raw.once("finish", () => resolve());
        reply.raw.once("close", () => resolve());
      });
      reply.code(202).send({ ok: true, data: { opId } });
      await flushed;
      setImmediate(() => {
        void getOpsStepJournal().runStep({
          op: "sync_section",
          opId,
          step: "uat_sync_section",
          body: () => {
            if (holdMs > 0) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, holdMs);
          }
        }).catch(() => undefined);
      });
    }
  );

  app.post<{ Body: { enabled?: boolean } }>(
    "/api/admin/ops-step-uat/background",
    async (request) => {
      if (typeof request.body?.enabled !== "boolean") throw badRequest("enabled 必须是布尔值");
      await dependencies.setBackgroundEnabled(request.body.enabled);
      if (!request.body.enabled) {
        await dependencies.waitForIdle?.();
      }
      return { ok: true };
    }
  );

  app.post<{ Body: { mode?: "error" | "short" } }>(
    "/api/admin/ops-step-uat/stdout-failure",
    async (request) => {
      const mode = request.body?.mode;
      if (mode !== "error" && mode !== "short") throw badRequest("mode 必须是 error 或 short");
      getOpsStepJournal().armStdoutFailureForUat(mode);
      return { ok: true };
    }
  );

  app.post<{ Body: { mode?: "delay" | "error"; delayMs?: number } }>(
    "/api/admin/ops-step-uat/read-failure",
    async (request) => {
      const mode = request.body?.mode;
      const token = randomUUID();
      if (mode === "error") {
        readFault = { mode, token };
      } else if (mode === "delay" && integerInRange(request.body?.delayMs, 1, 10_000)) {
        readFault = { mode, delayMs: request.body.delayMs, token };
      } else {
        throw badRequest("管理读故障参数无效");
      }
      return { ok: true, data: { token } };
    }
  );

  app.post("/api/admin/ops-step-uat/console-probe", async () => {
    console.info("[ops-step-uat] ordinary console probe");
    return { ok: true };
  });
}
