/** Read-only diagnostics in an OS process that the owner can actually terminate. */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readMcpRuntimeStatus, type DiagnosticStepObserver } from "../admin/mcp-runtime.js";
import { collectContentLayout } from "../content-layout.js";
import { recordExecutionRuntimeObservation } from "../mcp-runtime-state.js";
import { resolveContentPaths } from "../paths.js";
import { resolveProjectRoot } from "../project.js";
import { opsStepReasonFromError, type OpsReasonCode, type OpsStepName } from "./ops-step-journal.js";
import type {
  DiagnosticCollectorInput,
  DiagnosticCollectorResult,
  DiagnosticStepAck,
  DiagnosticStepEvent,
  DiagnosticStepHold
} from "./diagnostic-collector.js";

type DiagnosticWorkerChannel = {
  send(message: unknown, callback?: (error: Error | null) => void): boolean;
  on(event: "message", listener: (message: unknown) => void): unknown;
};

export function createDiagnosticStepObserver(
  opId: string,
  channel: DiagnosticWorkerChannel,
  uatHold?: DiagnosticStepHold
): DiagnosticStepObserver {
  const pendingAcks = new Map<OpsStepName, {
    resolve: () => void;
    reject: (error: Error) => void;
  }>();

  channel.on("message", (message: unknown) => {
    if (!message || typeof message !== "object" || Array.isArray(message)) return;
    const ack = message as Partial<DiagnosticStepAck>;
    if (ack.type !== "diagnostic-ops-step-ack" || ack.phase !== "enter" || ack.opId !== opId || !ack.step) return;
    const pending = pendingAcks.get(ack.step);
    if (!pending) return;
    pendingAcks.delete(ack.step);
    pending.resolve();
  });

  const sendEvent = (
    step: OpsStepName,
    phase: "enter" | "leave" | "fail",
    reasonCode?: OpsReasonCode
  ): Promise<void> => {
    const event: DiagnosticStepEvent = {
      type: "diagnostic-ops-step",
      op: "diagnostic_collect",
      opId,
      step,
      phase,
      ...(reasonCode ? { reasonCode } : {})
    };
    if (phase !== "enter") {
      try { channel.send(event, () => undefined); } catch { /* IPC teardown owns collection failure. */ }
      return Promise.resolve();
    }

    return new Promise((resolve, reject) => {
      pendingAcks.set(step, { resolve, reject });
      const failSend = (error: Error | null) => {
        if (!error) return;
        pendingAcks.delete(step);
        reject(error);
      };
      try {
        channel.send(event, failSend);
      } catch (error) {
        failSend(error instanceof Error ? error : new Error(String(error)));
      }
    });
  };

  return {
    async runStep<T>(step: OpsStepName, body: () => Promise<T>): Promise<T> {
      await sendEvent(step, "enter");
      if (uatHold?.steps.includes(step)) {
        await new Promise<void>((resolve) => setTimeout(resolve, uatHold.holdMs));
      }
      let value: T;
      try {
        value = await body();
      } catch (error) {
        await sendEvent(step, "fail", opsStepReasonFromError(error));
        throw error;
      }
      await sendEvent(step, "leave");
      return value;
    }
  };
}

function startWorker(): void {
  process.once("disconnect", () => process.exit(1));
  process.once("message", async (input: DiagnosticCollectorInput) => {
    try {
      if (!input.opId) throw new Error("diagnostic collector requires opId");
      for (const observation of input.observations) recordExecutionRuntimeObservation(observation);
      const observer = createDiagnosticStepObserver(input.opId, {
        send: (message, callback) => {
          if (!process.send) {
            callback?.(new Error("diagnostic IPC unavailable"));
            return false;
          }
          return process.send(message, callback ?? (() => undefined));
        },
        on: (event, listener) => process.on(event, listener)
      }, input.uatHold);
      const projectRoot = await resolveProjectRoot();
      const contentLayout = input.contentLayout ?? await collectContentLayout(projectRoot, await resolveContentPaths(projectRoot)).catch(() => undefined);
      // The existing bounded runtime refresh owns CLI checks; do not duplicate
      // it in each short-lived reader, nor invent readiness before it completes.
      const ktxRuntime = input.ktxRuntime;
      const mcp = await readMcpRuntimeStatus(async () => input.probe ?? {
        status: "reachable", checkedAt: new Date().toISOString()
      }, observer);
      const data: DiagnosticCollectorResult = { contentLayout, ktxRuntime, execution: mcp.execution };
      process.send?.({ ok: true, data }, () => process.exit(0));
    } catch {
      process.send?.({ ok: false }, () => process.exit(1));
    }
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) startWorker();
