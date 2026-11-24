import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OpsGroupContext, OpsPlanTarget } from "../ops/ops-batch.js";

const state = vi.hoisted(() => ({
  events: [] as Array<Record<string, unknown>>,
  reloadCatalog: vi.fn(),
  commitEffectivePolicy: vi.fn(),
  safeWriteAtomic: vi.fn()
}));

type StepCall = {
  op: string;
  opId: string;
  step: string;
  body: () => Promise<unknown>;
  classifyReturn?: (value: any) => { ok: true } | { ok: false; reasonCode: string };
};

const runStep = vi.hoisted(() => vi.fn());

vi.mock("../runtime/ops-step-journal.js", () => ({
  createOpsStepId: () => "ops_0123456789abcdef0123456789abcdef",
  getOpsStepJournal: () => ({ runStep, writeStep: vi.fn() }),
  opsStepReasonFromError: () => "unreadable"
}));

vi.mock("../catalog-reload.js", () => ({ reloadCatalog: state.reloadCatalog }));
vi.mock("../proxy/acl.js", () => ({ commitEffectivePolicy: state.commitEffectivePolicy }));
vi.mock("../fs-safe.js", () => ({ safeWriteAtomic: state.safeWriteAtomic }));
vi.mock("node:fs/promises", async () => {
  const actual = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
  return {
    ...actual,
    readFile: vi.fn((...args: any[]) => {
      if (String(args[0]).endsWith("ktx.yaml")) state.events.push({ marker: "read:ktx" });
      return (actual.readFile as any)(...args);
    })
  };
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

import { OpsConnectionTablesAdapter } from "../ops/ops-ktx-batch.js";

let projectRoot: string;

function member(connectionId: string): OpsPlanTarget {
  return {
    id: `tables:${connectionId}`,
    groupId: "ktx",
    connectionId,
    payload: {
      connectionId,
      enabledTables: ["s1.orders"],
      baseline: { connectionId, enabledTables: ["s1.orders"], schemas: ["s1"] }
    },
    before: null,
    after: { enabledTables: ["s1.orders"] },
    blockers: [],
    writeSet: ["ktx.yaml"],
    audit: {
      changeType: "enabled_tables_update",
      assetKind: "governance",
      targetId: connectionId,
      filePath: "ktx.yaml"
    }
  };
}

function context(connectionIds: string[]): OpsGroupContext {
  return {
    projectRoot,
    group: { id: "ktx", memberIds: connectionIds.map((id) => `tables:${id}`), sharedFiles: ["ktx.yaml"] },
    members: connectionIds.map(member),
    actor: "ops_agent",
    delegatedFrom: null,
    executionId: "execution-1",
    setEffectPhase: vi.fn()
  };
}

beforeEach(async () => {
  projectRoot = await mkdtemp(path.join(os.tmpdir(), "lucy-ops-step-ktx-"));
  await writeFile(
    path.join(projectRoot, "ktx.yaml"),
    `connections:\n  conn_a:\n    driver: duckdb\n    schemas: [s1]\n    enabled_tables: [s1.orders]\n  conn_b:\n    driver: duckdb\n    schemas: [s1]\n    enabled_tables: [s1.orders]\n`,
    "utf8"
  );
  state.events.length = 0;
  state.reloadCatalog.mockReset().mockResolvedValue({ status: "success", warnings: [] });
  state.commitEffectivePolicy.mockReset().mockResolvedValue({ policyVersion: "v1" });
  state.safeWriteAtomic.mockReset().mockResolvedValue(undefined);
});

afterEach(async () => {
  await rm(projectRoot, { recursive: true, force: true });
});

describe("runtime_reload ops steps", () => {
  it("enters write_config inside the lock before the read and awaits the atomic write", async () => {
    let releaseWrite!: () => void;
    state.safeWriteAtomic.mockImplementationOnce(async () => {
      state.events.push({ marker: "write:start" });
      await new Promise<void>((resolve) => { releaseWrite = resolve; });
      state.events.push({ marker: "write:end" });
    });

    const executing = new OpsConnectionTablesAdapter().executeGroup(context(["conn_a"]));
    await vi.waitFor(() => expect(state.safeWriteAtomic).toHaveBeenCalledTimes(1));
    expect(state.events[0]).toMatchObject({ step: "write_config", phase: "enter" });
    expect(state.events.findIndex((event) => event.marker === "read:ktx")).toBeGreaterThan(0);
    expect(state.events.findIndex((event) => event.marker === "write:start")).toBeGreaterThan(
      state.events.findIndex((event) => event.marker === "read:ktx")
    );
    expect(state.events.some((event) => event.step === "write_config" && event.phase !== "enter")).toBe(false);

    releaseWrite();
    await executing;
    expect(state.events.filter((event) => event.marker !== "read:ktx").map((event) => `${String(event.step ?? event.marker)}:${String(event.phase ?? "")}`)).toEqual([
      "write_config:enter",
      "write:start:",
      "write:end:",
      "write_config:leave",
      "catalog_reload:enter",
      "catalog_reload:leave",
      "policy_commit:enter",
      "policy_commit:leave"
    ]);
  });

  it("pairs each catalog_reload iteration, including a pending second connection", async () => {
    let releaseSecond!: () => void;
    state.reloadCatalog
      .mockResolvedValueOnce({ status: "success", warnings: [] })
      .mockImplementationOnce(async () => {
        await new Promise<void>((resolve) => { releaseSecond = resolve; });
        return { status: "success", warnings: [] };
      });

    const executing = new OpsConnectionTablesAdapter().executeGroup(context(["conn_a", "conn_b"]));
    await vi.waitFor(() => expect(state.reloadCatalog).toHaveBeenCalledTimes(2));
    expect(state.events.filter((event) => event.step === "catalog_reload").map((event) => event.phase)).toEqual([
      "enter",
      "leave",
      "enter"
    ]);
    expect(state.events.some((event) => event.step === "policy_commit")).toBe(false);

    releaseSecond();
    await executing;
    expect(state.events.filter((event) => event.step === "catalog_reload").map((event) => event.phase)).toEqual([
      "enter",
      "leave",
      "enter",
      "leave"
    ]);
    expect(new Set(state.events.filter((event) => event.opId).map((event) => event.opId)).size).toBe(1);
  });

  it("fails catalog_reload and does not enter policy_commit", async () => {
    state.reloadCatalog.mockRejectedValueOnce(new Error("driver text must not become a step field"));

    await expect(new OpsConnectionTablesAdapter().executeGroup(context(["conn_a"]))).rejects.toThrow("catalog 重载失败");

    expect(state.events.at(-1)).toMatchObject({ step: "catalog_reload", phase: "fail", reasonCode: "unreadable" });
    expect(state.events.some((event) => event.step === "policy_commit")).toBe(false);
    expect(JSON.stringify(state.events)).not.toContain("driver text");
    expect(JSON.stringify(state.events)).not.toContain("conn_a");
  });
});
