import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  events: [] as Array<Record<string, unknown>>,
  reloadCatalog: vi.fn(),
  commitEffectivePolicy: vi.fn(),
  runMcpRuntimeCanary: vi.fn(),
  reloadKtxMcpAfterConfigWrite: vi.fn(),
  auditedWriteFile: vi.fn()
}));

type StepCall = {
  op: string;
  opId: string;
  step: string;
  body: () => Promise<unknown>;
  classifyReturn?: (value: any) => { ok: true } | { ok: false; reasonCode: string };
};

const runStep = vi.hoisted(() => vi.fn());
const writeStep = vi.hoisted(() => vi.fn());

vi.mock("../runtime/ops-step-journal.js", () => ({
  createOpsStepId: () => "ops_0123456789abcdef0123456789abcdef",
  getOpsStepJournal: () => ({ runStep, writeStep }),
  opsStepReasonFromError: () => "unreadable"
}));

vi.mock("../enabled-tables.js", async () => {
  const actual = await vi.importActual<typeof import("../enabled-tables.js")>("../enabled-tables.js");
  return {
    ...actual,
    patchConnectionEnabledTablesYaml: vi.fn((...args: Parameters<typeof actual.patchConnectionEnabledTablesYaml>) => {
      state.events.push({ marker: "patch" });
      return actual.patchConnectionEnabledTablesYaml(...args);
    })
  };
});
vi.mock("../catalog-reload.js", async () => {
  const actual = await vi.importActual<typeof import("../catalog-reload.js")>("../catalog-reload.js");
  return { ...actual, reloadCatalog: state.reloadCatalog };
});
vi.mock("../proxy/acl.js", async () => {
  const actual = await vi.importActual<typeof import("../proxy/acl.js")>("../proxy/acl.js");
  return { ...actual, commitEffectivePolicy: state.commitEffectivePolicy };
});
vi.mock("../admin/mcp-runtime.js", async () => {
  const actual = await vi.importActual<typeof import("../admin/mcp-runtime.js")>("../admin/mcp-runtime.js");
  return { ...actual, runMcpRuntimeCanary: state.runMcpRuntimeCanary };
});
vi.mock("../ktx-mcp-reload.js", () => ({
  reloadKtxMcpAfterConfigWrite: state.reloadKtxMcpAfterConfigWrite,
  reloadKtxMcpExecutionRuntime: state.reloadKtxMcpAfterConfigWrite
}));
vi.mock("../admin/config-audit-write.js", async () => {
  const actual = await vi.importActual<typeof import("../admin/config-audit-write.js")>("../admin/config-audit-write.js");
  return {
    ...actual,
    auditedWriteFile: vi.fn(async (...args: Parameters<typeof actual.auditedWriteFile>) => {
      state.events.push({ marker: "audit-write:start" });
      const result = await state.auditedWriteFile(...args);
      state.events.push({ marker: "audit-write:end" });
      return result;
    })
  };
});

writeStep.mockImplementation((event: Record<string, unknown>) => {
  state.events.push(event);
});
runStep.mockImplementation(async (call: StepCall) => {
  state.events.push({ op: call.op, opId: call.opId, step: call.step, phase: "enter" });
  try {
    const value = await call.body();
    const outcome = call.classifyReturn?.(value) ?? { ok: true };
    state.events.push({
      op: call.op,
      opId: call.opId,
      step: call.step,
      phase: outcome.ok ? "leave" : "fail",
      ...("reasonCode" in outcome ? { reasonCode: outcome.reasonCode } : {})
    });
    return value;
  } catch (error) {
    state.events.push({ op: call.op, opId: call.opId, step: call.step, phase: "fail", reasonCode: "unreadable" });
    throw error;
  }
});

import { buildServer } from "../index.js";

let projectRoot: string;
let previousRoot: string | undefined;
let previousContentRoot: string | undefined;

async function makeProject() {
  projectRoot = await mkdtemp(path.join(os.tmpdir(), "lucy-ops-step-enabled-"));
  await mkdir(path.join(projectRoot, "semantic-layer", "demo", "_schema"), { recursive: true });
  await writeFile(
    path.join(projectRoot, "ktx.yaml"),
    `connections:\n  demo:\n    driver: mysql\n    enabled_tables: [dataforai.orders]\n`,
    "utf8"
  );
  await writeFile(
    path.join(projectRoot, "semantic-layer", "demo", "_schema", "dataforai.yaml"),
    `tables:\n  orders:\n    table: dataforai.orders\n    columns:\n      - name: id\n        type: number\n`,
    "utf8"
  );
  process.env.KTX_PROJECT_ROOT = projectRoot;
  process.env.LUCY_CONTENT_ROOT = ".";
}

async function save(dryRun = false) {
  const app = buildServer();
  await app.ready();
  state.events.length = 0;
  try {
    return await request(app.server)
      .put("/api/connections/demo/enabled-tables")
      .send({ dryRun, enabledTables: ["dataforai.orders"] });
  } finally {
    await app.close();
  }
}

beforeEach(async () => {
  previousRoot = process.env.KTX_PROJECT_ROOT;
  previousContentRoot = process.env.LUCY_CONTENT_ROOT;
  state.events.length = 0;
  state.reloadCatalog.mockReset().mockResolvedValue({ status: "success", warnings: [] });
  state.commitEffectivePolicy.mockReset().mockResolvedValue({ policyVersion: "v1", degradedGlobal: false, issues: [] });
  state.runMcpRuntimeCanary.mockReset().mockResolvedValue({
    executionRuntimeAck: true,
    decisionReason: "ok",
    checks: [{ name: "execution_query", status: "pass", detail: "ok" }]
  });
  state.reloadKtxMcpAfterConfigWrite.mockReset().mockResolvedValue({ status: "reloaded", detail: "ok" });
  state.auditedWriteFile.mockReset().mockResolvedValue({ auditId: 1 });
  await makeProject();
});

afterEach(async () => {
  if (previousRoot === undefined) delete process.env.KTX_PROJECT_ROOT;
  else process.env.KTX_PROJECT_ROOT = previousRoot;
  if (previousContentRoot === undefined) delete process.env.LUCY_CONTENT_ROOT;
  else process.env.LUCY_CONTENT_ROOT = previousContentRoot;
  await rm(projectRoot, { recursive: true, force: true });
});

describe("enabled_tables_save ops steps", () => {
  it("does not write steps for dryRun", async () => {
    const response = await save(true);
    expect(response.status).toBe(200);
    expect(state.events).toEqual([{ marker: "patch" }]);
    expect(runStep).not.toHaveBeenCalled();
    expect(writeStep).not.toHaveBeenCalled();
  });

  it("enters before the shared patch and leaves only after the awaited write", async () => {
    let releaseWrite!: () => void;
    state.auditedWriteFile.mockImplementationOnce(async () => {
      await new Promise<void>((resolve) => { releaseWrite = resolve; });
      return { auditId: 1 };
    });
    const app = buildServer();
    await app.ready();
    state.events.length = 0;
    const pending = request(app.server)
      .put("/api/connections/demo/enabled-tables")
      .send({ dryRun: false, enabledTables: ["dataforai.orders"] })
      .then((response) => response);

    await vi.waitFor(() => expect(state.auditedWriteFile).toHaveBeenCalledTimes(1));
    expect(state.events).toEqual([
      expect.objectContaining({ step: "write_config", phase: "enter" }),
      { marker: "patch" },
      { marker: "audit-write:start" }
    ]);

    releaseWrite();
    const response = await pending;
    expect(response.status).toBe(200);
    expect(state.events.map((event) => `${String(event.step ?? event.marker)}:${String(event.phase ?? "")}`)).toEqual([
      "write_config:enter",
      "patch:",
      "audit-write:start:",
      "audit-write:end:",
      "write_config:leave",
      "catalog_reload:enter",
      "catalog_reload:leave",
      "policy_commit:enter",
      "policy_commit:leave",
      "execution_reload:enter",
      "execution_reload:leave",
      "execution_ack:enter",
      "execution_ack:leave"
    ]);
    await app.close();
  });

  it("marks false Catalog/Policy/Execution acks as fail and continues without changing HTTP 200", async () => {
    state.reloadCatalog.mockResolvedValueOnce({ status: "failed", warnings: [] });
    state.commitEffectivePolicy.mockResolvedValueOnce({ policyVersion: "", degradedGlobal: true, issues: [] });
    state.runMcpRuntimeCanary.mockResolvedValueOnce({
      executionRuntimeAck: false,
      decisionReason: "execution_runtime_unavailable",
      checks: []
    });

    const response = await save();
    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({
      written: true,
      catalogRuntimeAck: false,
      policyRuntimeAck: false,
      executionRuntimeAck: false
    });
    expect(state.events.filter((event) => ["catalog_reload", "policy_commit", "execution_ack"].includes(String(event.step)))).toEqual([
      expect.objectContaining({ step: "catalog_reload", phase: "enter" }),
      expect.objectContaining({ step: "catalog_reload", phase: "fail", reasonCode: "unreadable" }),
      expect.objectContaining({ step: "policy_commit", phase: "enter" }),
      expect.objectContaining({ step: "policy_commit", phase: "fail", reasonCode: "unreadable" }),
      expect.objectContaining({ step: "execution_ack", phase: "enter" }),
      expect.objectContaining({ step: "execution_ack", phase: "fail", reasonCode: "unreadable" })
    ]);
    expect(state.events.some((event) => event.step === "execution_reload" && event.phase === "leave")).toBe(true);
  });

  it("uses the original catches after Catalog/Policy throw and still enters execution steps", async () => {
    state.reloadCatalog.mockRejectedValueOnce(new Error("catalog sentinel"));
    state.commitEffectivePolicy.mockRejectedValueOnce(new Error("policy sentinel"));

    const response = await save();
    expect(response.status).toBe(200);
    expect(response.body.data.catalogRuntimeAck).toBe(false);
    expect(response.body.data.policyRuntimeAck).toBe(false);
    expect(state.events.filter((event) => event.step).map((event) => `${String(event.step)}:${String(event.phase)}`)).toEqual([
      "write_config:enter",
      "write_config:leave",
      "catalog_reload:enter",
      "catalog_reload:fail",
      "policy_commit:enter",
      "policy_commit:fail",
      "execution_reload:enter",
      "execution_reload:leave",
      "execution_ack:enter",
      "execution_ack:leave"
    ]);
  });

  it("records write_config as failed when the shared patch throws", async () => {
    const { patchConnectionEnabledTablesYaml } = await import("../enabled-tables.js");
    vi.mocked(patchConnectionEnabledTablesYaml).mockImplementationOnce(() => {
      throw new Error("patch sentinel");
    });

    const response = await save();
    expect(response.status).toBe(500);
    expect(state.events.filter((event) => event.step).map((event) => `${String(event.step)}:${String(event.phase)}`)).toEqual([
      "write_config:enter",
      "write_config:fail"
    ]);
    expect(state.events.some((event) => event.step === "catalog_reload")).toBe(false);
  });

  it("stops before execution_ack when execution_reload throws", async () => {
    state.reloadKtxMcpAfterConfigWrite.mockResolvedValueOnce({ status: "failed", detail: "not loaded" });

    const response = await save();
    expect(response.status).toBe(503);
    expect(state.events.at(-1)).toMatchObject({ step: "execution_reload", phase: "fail" });
    expect(state.events.some((event) => event.step === "execution_ack")).toBe(false);
  });
});
