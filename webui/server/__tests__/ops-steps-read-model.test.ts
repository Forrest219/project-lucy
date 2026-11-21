import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetAdminsCache } from "../auth/admins-store.js";
import { requireWebuiAuthHook } from "../auth/guard.js";
import { registerOpsStepRoutes } from "../admin/ops-steps.js";

const { readOpsStepJournal } = vi.hoisted(() => ({
  readOpsStepJournal: vi.fn()
}));

vi.mock("../runtime/ops-step-journal.js", () => ({
  getOpsStepJournal: () => ({ read: readOpsStepJournal })
}));

type OpsStepView = {
  key: string;
  op: string;
  opId: string;
  step: string;
  phase: "enter" | "leave" | "fail";
  ts: string;
  elapsedMs: number;
  result: "running" | "ok" | "error";
  reasonCode: string;
  state: string;
  enteredAt: string | null;
  durationMs: number | null;
};

function stepView(key: string, overrides: Partial<OpsStepView> = {}): OpsStepView {
  return {
    key,
    op: "runtime_reload",
    opId: "ops_a",
    step: "write_config",
    phase: "leave",
    ts: "2026-11-20T08:00:01.000Z",
    elapsedMs: 1000,
    result: "ok",
    reasonCode: "",
    state: "ended",
    enteredAt: "2026-11-20T08:00:00.000Z",
    durationMs: 1000,
    ...overrides
  };
}

function readModelFixture() {
  return {
    history: [
      stepView("history-1"),
      stepView("history-2", {
        op: "diagnostic_collect",
        step: "read_project",
        phase: "fail",
        result: "error",
        reasonCode: "io_error",
        state: "ended",
        durationMs: 800
      }),
      stepView("history-3", {
        step: "catalog_reload",
        elapsedMs: 1200,
        durationMs: 200
      }),
      stepView("history-4", {
        step: "catalog_reload",
        elapsedMs: 2400,
        durationMs: 300
      }),
      stepView("history-5", {
        op: "diagnostic_collect",
        opId: "ops_previous",
        step: "read_ktx_yaml",
        phase: "enter",
        result: "running",
        state: "previous_incomplete",
        durationMs: null
      }),
      stepView("history-6", {
        opId: "ops_b",
        step: "policy_commit",
        state: "start_truncated",
        enteredAt: null,
        durationMs: null
      })
    ],
    inFlight: [
      stepView("in-flight-1", {
        op: "diagnostic_collect",
        step: "read_ktx_yaml",
        phase: "enter",
        result: "running",
        state: "running",
        durationMs: 5000
      }),
      stepView("in-flight-2", {
        step: "catalog_reload",
        phase: "enter",
        result: "running",
        state: "running",
        elapsedMs: 3000,
        durationMs: 600
      })
    ],
    historyTruncated: true,
    truncationReasons: ["row_limit", "age_limit"],
    stdoutWriteFailed: true,
    stdoutDroppedCount: 2,
    fileWritable: "error",
    fileDroppedCount: 3,
    formatDroppedCount: 4,
    fileWriteReason: "queue_full",
    historyResidual: true
  };
}

let tempRoot: string;
let adminsPath: string;
let previousAdminsPath: string | undefined;
let previousAuth: string | undefined;
let previousDeploymentMode: string | undefined;
const apps: FastifyInstance[] = [];

beforeEach(async () => {
  tempRoot = await mkdtemp(path.join(os.tmpdir(), "lucy-ops-steps-read-model-"));
  adminsPath = path.join(tempRoot, "admins.yaml");
  await writeFile(adminsPath, 'version: "1"\nadmins: []\n', "utf8");
  previousAdminsPath = process.env.LUCY_ADMINS_CONFIG_PATH;
  previousAuth = process.env.LUCY_WEBUI_AUTH;
  previousDeploymentMode = process.env.LUCY_DEPLOYMENT_MODE;
  process.env.LUCY_ADMINS_CONFIG_PATH = adminsPath;
  process.env.LUCY_WEBUI_AUTH = "off";
  process.env.LUCY_DEPLOYMENT_MODE = "development";
  resetAdminsCache();
  readOpsStepJournal.mockReset();
  readOpsStepJournal.mockReturnValue(readModelFixture());
});

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
  if (previousAdminsPath === undefined) delete process.env.LUCY_ADMINS_CONFIG_PATH;
  else process.env.LUCY_ADMINS_CONFIG_PATH = previousAdminsPath;
  if (previousAuth === undefined) delete process.env.LUCY_WEBUI_AUTH;
  else process.env.LUCY_WEBUI_AUTH = previousAuth;
  if (previousDeploymentMode === undefined) delete process.env.LUCY_DEPLOYMENT_MODE;
  else process.env.LUCY_DEPLOYMENT_MODE = previousDeploymentMode;
  resetAdminsCache();
  await rm(tempRoot, { recursive: true, force: true });
});

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify();
  app.addHook("onRequest", requireWebuiAuthHook);
  registerOpsStepRoutes(app);
  await app.ready();
  apps.push(app);
  return app;
}

async function requireLogin(): Promise<void> {
  process.env.LUCY_DEPLOYMENT_MODE = "customer";
  delete process.env.LUCY_WEBUI_AUTH;
  await writeFile(adminsPath, [
    'version: "1"',
    "admins:",
    "  - id: owner-one",
    "    display_name: Owner",
    '    password_hash: "not-used-here"',
    "    role: owner",
    "    enabled: true",
    '    created_at: "2026-11-20T00:00:00.000Z"'
  ].join("\n") + "\n", "utf8");
  resetAdminsCache();
}

describe("GET /api/admin/ops-steps", () => {
  it("uses the existing admin authentication hook for anonymous requests", async () => {
    await requireLogin();
    const app = await buildApp();
    const response = await app.inject({ method: "GET", url: "/api/admin/ops-steps" });

    expect(response.statusCode).toBe(401);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.json()).toEqual({
      ok: false,
      error: { code: "AUTH_REQUIRED", message: "需要登录" }
    });
    expect(readOpsStepJournal).not.toHaveBeenCalled();
  });

  it("keeps mixed terminals and repeated step instances in their own partitions", async () => {
    const app = await buildApp();
    const response = await app.inject({ method: "GET", url: "/api/admin/ops-steps" });
    const body = response.json();

    expect(response.statusCode).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.data.history.map((view: OpsStepView) => view.key)).toEqual([
      "history-1", "history-2", "history-3", "history-4", "history-5", "history-6"
    ]);
    expect(body.data.inFlight.map((view: OpsStepView) => view.key)).toEqual([
      "in-flight-1", "in-flight-2"
    ]);
    expect(body.data.history.find((view: OpsStepView) => view.key === "history-2")).toMatchObject({
      phase: "fail",
      result: "error",
      reasonCode: "io_error"
    });
    expect(body.data.history.filter((view: OpsStepView) => view.step === "catalog_reload")).toHaveLength(2);
    expect(body.data.inFlight.find((view: OpsStepView) => view.key === "in-flight-2")).toMatchObject({
      opId: "ops_a",
      step: "catalog_reload",
      phase: "enter",
      state: "running"
    });
  });

  it("applies exact opId, op, step, and state filters to both partitions", async () => {
    const app = await buildApp();
    const cases = [
      { query: "opId=ops_b", history: ["history-6"], inFlight: [] },
      { query: "op=diagnostic_collect", history: ["history-2", "history-5"], inFlight: ["in-flight-1"] },
      { query: "step=catalog_reload", history: ["history-3", "history-4"], inFlight: ["in-flight-2"] },
      { query: "state=running", history: [], inFlight: ["in-flight-1", "in-flight-2"] },
      {
        query: "opId=ops_a&op=runtime_reload&step=catalog_reload&state=ended",
        history: ["history-3", "history-4"],
        inFlight: []
      },
      { query: "opId=ops_", history: [], inFlight: [] }
    ];

    for (const testCase of cases) {
      const response = await app.inject({ method: "GET", url: `/api/admin/ops-steps?${testCase.query}` });
      expect(response.statusCode).toBe(200);
      expect(response.json().data.history.map((view: OpsStepView) => view.key)).toEqual(testCase.history);
      expect(response.json().data.inFlight.map((view: OpsStepView) => view.key)).toEqual(testCase.inFlight);
    }
  });

  it("preserves previous_incomplete and start_truncated history without inventing timestamps or durations", async () => {
    const app = await buildApp();
    const response = await app.inject({ method: "GET", url: "/api/admin/ops-steps" });
    const data = response.json().data;

    expect(data.history.find((view: OpsStepView) => view.key === "history-5")).toMatchObject({
      state: "previous_incomplete",
      phase: "enter",
      durationMs: null
    });
    expect(data.history.find((view: OpsStepView) => view.key === "history-6")).toMatchObject({
      state: "start_truncated",
      enteredAt: null,
      durationMs: null
    });
    expect(data.inFlight.map((view: OpsStepView) => view.key)).not.toContain("history-5");
  });

  it("keeps independent inFlight rows and all truncation reasons after filtering", async () => {
    const app = await buildApp();
    const response = await app.inject({ method: "GET", url: "/api/admin/ops-steps?state=running" });
    const data = response.json().data;

    expect(data.history).toEqual([]);
    expect(data.inFlight.map((view: OpsStepView) => view.key)).toEqual(["in-flight-1", "in-flight-2"]);
    expect(data.historyTruncated).toBe(true);
    expect(data.truncationReasons).toEqual(["row_limit", "age_limit"]);
    expect(data.historyResidual).toBe(true);
  });

  it("returns every write-health field unchanged and no raw error or path", async () => {
    const app = await buildApp();
    const response = await app.inject({
      method: "GET",
      url: "/api/admin/ops-steps?step=not-present&raw=secret-driver-text&path=/private/ops-steps.jsonl"
    });
    const data = response.json().data;

    expect(data).toMatchObject({
      stdoutWriteFailed: true,
      stdoutDroppedCount: 2,
      fileWritable: "error",
      fileDroppedCount: 3,
      formatDroppedCount: 4,
      fileWriteReason: "queue_full",
      historyResidual: true
    });
    expect(response.payload).not.toContain("secret-driver-text");
    expect(response.payload).not.toContain("/private/ops-steps.jsonl");
    expect(Object.keys(data).sort()).toEqual([
      "fileDroppedCount",
      "fileWritable",
      "fileWriteReason",
      "formatDroppedCount",
      "history",
      "historyResidual",
      "historyTruncated",
      "inFlight",
      "stdoutDroppedCount",
      "stdoutWriteFailed",
      "truncationReasons"
    ]);
  });
});
