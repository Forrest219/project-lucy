/** Read-only diagnostics in an OS process that the owner can actually terminate. */
import { readMcpRuntimeStatus } from "../admin/mcp-runtime.js";
import { collectContentLayout } from "../content-layout.js";
import { recordExecutionRuntimeObservation } from "../mcp-runtime-state.js";
import { resolveContentPaths } from "../paths.js";
import { resolveProjectRoot } from "../project.js";
import type { DiagnosticCollectorInput, DiagnosticCollectorResult } from "./diagnostic-collector.js";

process.once("disconnect", () => process.exit(1));
process.once("message", async (input: DiagnosticCollectorInput) => {
  try {
    for (const observation of input.observations) recordExecutionRuntimeObservation(observation);
    process.send?.({ stage: "reading" });
    const projectRoot = await resolveProjectRoot();
    const contentLayout = input.contentLayout ?? await collectContentLayout(projectRoot, await resolveContentPaths(projectRoot)).catch(() => undefined);
    // The existing bounded runtime refresh owns CLI checks; do not duplicate
    // it in each short-lived reader, nor invent readiness before it completes.
    const ktxRuntime = input.ktxRuntime;
    const mcp = await readMcpRuntimeStatus(async () => input.probe ?? {
      status: "reachable", checkedAt: new Date().toISOString()
    });
    const data: DiagnosticCollectorResult = { contentLayout, ktxRuntime, execution: mcp.execution };
    process.send?.({ ok: true, data }, () => process.exit(0));
  } catch {
    process.send?.({ ok: false }, () => process.exit(1));
  }
});
