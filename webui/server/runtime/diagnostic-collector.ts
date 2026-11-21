import { fork } from "node:child_process";
import { fileURLToPath } from "node:url";
import type { ContentLayoutStatus } from "../content-layout.js";
import type { KtxRuntimeStatus } from "../ktx-runtime.js";
import type { ExecutionProbeResult, readMcpRuntimeStatus } from "../admin/mcp-runtime.js";
import type { ExecutionRuntimeObservation } from "../mcp-runtime-state.js";
import {
  createOpsStepId,
  getOpsStepJournal,
  type OpsOperation,
  type OpsReasonCode,
  type OpsStepName
} from "./ops-step-journal.js";

export type DiagnosticStepHold = {
  steps: OpsStepName[];
  holdMs: number;
};

export type DiagnosticCollectorInput = {
  opId?: string;
  probe?: ExecutionProbeResult;
  observations: ExecutionRuntimeObservation[];
  ktxRuntime: KtxRuntimeStatus;
  contentLayout?: ContentLayoutStatus;
  uatHold?: DiagnosticStepHold;
};

export type DiagnosticCollectorResult = {
  contentLayout?: ContentLayoutStatus;
  ktxRuntime: KtxRuntimeStatus;
  execution: Awaited<ReturnType<typeof readMcpRuntimeStatus>>["execution"];
};

export type DiagnosticStepEvent = {
  type: "diagnostic-ops-step";
  op: OpsOperation;
  opId: string;
  step: OpsStepName;
  phase: "enter" | "leave" | "fail";
  reasonCode?: OpsReasonCode;
};

export type DiagnosticStepAck = {
  type: "diagnostic-ops-step-ack";
  opId: string;
  step: OpsStepName;
  phase: "enter";
};

export type DiagnosticCollectorDependencies = {
  fork?: typeof fork;
  journal?: ReturnType<typeof getOpsStepJournal>;
  createOpId?: typeof createOpsStepId;
};

const DIAGNOSTIC_STEPS = new Set<OpsStepName>([
  "read_project",
  "read_ktx_yaml",
  "read_catalog_reloads",
  "read_reload_state",
  "probe_execution"
]);
const OPS_REASON_CODES = new Set<OpsReasonCode>([
  "timeout",
  "io_error",
  "aborted",
  "missing",
  "unreadable",
  "too_large",
  "permission",
  "ambiguous"
]);

function asStepEvent(message: unknown): DiagnosticStepEvent | undefined {
  if (!message || typeof message !== "object" || Array.isArray(message)) return undefined;
  const record = message as Partial<DiagnosticStepEvent>;
  if (record.type !== "diagnostic-ops-step") return undefined;
  if (record.op !== "diagnostic_collect" || typeof record.opId !== "string") return undefined;
  if (!record.step || !DIAGNOSTIC_STEPS.has(record.step)) return undefined;
  if (record.phase !== "enter" && record.phase !== "leave" && record.phase !== "fail") return undefined;
  return record as DiagnosticStepEvent;
}

/** The permit's Promise settles on child close, never merely on abort/message. */
export function collectDiagnosticIo(
  signal: AbortSignal,
  input: DiagnosticCollectorInput,
  dependencies: DiagnosticCollectorDependencies = {}
): Promise<DiagnosticCollectorResult> {
  signal.throwIfAborted();
  const opId = input.opId ?? (dependencies.createOpId ?? createOpsStepId)();
  const journal = dependencies.journal ?? getOpsStepJournal();
  const forkProcess = dependencies.fork ?? fork;
  return new Promise((resolve, reject) => {
    const child = forkProcess(fileURLToPath(new URL("./diagnostic-collector-worker.ts", import.meta.url)), [], {
      execArgv: ["--import", import.meta.resolve("tsx")],
      detached: process.platform !== "win32",
      stdio: ["ignore", "ignore", "ignore", "ipc"]
    });
    const steps = new Map<OpsStepName, "entered" | "terminal">();
    let result: DiagnosticCollectorResult | undefined;
    let failed = false;
    let aborted = false;
    let closed = false;

    const writeStep = (
      step: OpsStepName,
      phase: "enter" | "leave" | "fail",
      reasonCode?: OpsReasonCode
    ) => {
      try {
        journal.writeStep({
          op: "diagnostic_collect",
          opId,
          step,
          phase,
          ...(reasonCode ? { reasonCode } : {})
        });
      } catch {
        // Journal failures must not change diagnostic collection.
      }
    };

    const abortOpenSteps = (): boolean => {
      let abortedAny = false;
      for (const [step, state] of steps) {
        if (state !== "entered") continue;
        steps.set(step, "terminal");
        abortedAny = true;
        writeStep(step, "fail", "aborted");
      }
      return abortedAny;
    };

    const stop = () => {
      aborted = true;
      // Kill the private process group too: no orphaned CLI descendants.
      if (child.pid && process.platform !== "win32") {
        try { process.kill(-child.pid, "SIGKILL"); } catch { child.kill("SIGKILL"); }
      } else child.kill("SIGKILL");
    };
    const failAndStop = () => {
      failed = true;
      abortOpenSteps();
      stop();
    };
    const sendEnterAck = (step: OpsStepName) => {
      const ack: DiagnosticStepAck = { type: "diagnostic-ops-step-ack", opId, step, phase: "enter" };
      try {
        child.send(ack, (error) => { if (error) failAndStop(); });
      } catch {
        failAndStop();
      }
    };

    const onAbort = () => {
      abortOpenSteps();
      stop();
    };
    signal.addEventListener("abort", onAbort, { once: true });
    child.on("error", failAndStop);
    child.on("disconnect", () => {
      const hasOpenSteps = [...steps.values()].some((state) => state === "entered");
      if (!result || hasOpenSteps) failAndStop();
    });
    child.on("message", (message: unknown) => {
      if (closed) return;
      const event = asStepEvent(message);
      if (event) {
        if (event.opId !== opId) return;
        const state = steps.get(event.step);
        if (event.phase === "enter") {
          if (state || aborted || signal.aborted) return;
          steps.set(event.step, "entered");
          writeStep(event.step, "enter");
          sendEnterAck(event.step);
          return;
        }
        if (state !== "entered") return;
        steps.set(event.step, "terminal");
        const reasonCode = event.phase === "fail"
          ? event.reasonCode && OPS_REASON_CODES.has(event.reasonCode) ? event.reasonCode : "unreadable"
          : undefined;
        writeStep(event.step, event.phase, reasonCode);
        return;
      }

      const record = message as { ok?: boolean; data?: DiagnosticCollectorResult; stage?: string };
      if (record.stage) console.info(`[diagnostic-collector] stage=${record.stage} pid=${child.pid}`);
      else if (record.ok && record.data) result = record.data;
      else failed = true;
    });
    child.once("close", (code, terminationSignal) => {
      closed = true;
      if (abortOpenSteps()) failed = true;
      signal.removeEventListener("abort", onAbort);
      console.info(`[diagnostic-collector] closed pid=${child.pid} aborted=${aborted} code=${code} signal=${terminationSignal}`);
      if (aborted || signal.aborted) reject(new Error("diagnostic collection aborted after process exit"));
      else if (failed || code !== 0 || !result) reject(new Error("diagnostic collection failed"));
      else resolve(result);
    });
    // A parent crash/disconnect is also terminal for this detached reader.
    child.send({ ...input, opId }, (error) => { if (error) failAndStop(); });
    if (signal.aborted) {
      abortOpenSteps();
      stop();
    }
  });
}
