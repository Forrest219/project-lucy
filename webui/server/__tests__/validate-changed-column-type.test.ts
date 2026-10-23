/**
 * SC-24 — column type contract on the workbench validate-changed path.
 *
 * Fixtures live in a temp content root. Nothing is written under the repo
 * semantic-layer directory.
 */
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { applyColumnTypeContractToValidation } from "../publish-gate.js";
import { invalidateContentPathsCache } from "../paths.js";
import { readChangedSourceColumnContracts } from "../semantic-layer.js";

let projectRoot: string;
let previousRoot: string | undefined;
let previousContentRoot: string | undefined;

beforeEach(async () => {
  projectRoot = await mkdtemp(path.join(os.tmpdir(), "lucy-column-type-"));
  await mkdir(path.join(projectRoot, "semantic-layer", "demo", "_schema"), { recursive: true });
  await writeFile(path.join(projectRoot, "ktx.yaml"), "connections: {}\n", "utf8");
  await writeFile(
    path.join(projectRoot, "semantic-layer", "demo", "_schema", "dataforai.yaml"),
    `tables:
  orders:
    table: demo.orders
    columns:
      - name: amount
        type: float
      - name: name
        type: string
`,
    "utf8"
  );
  await writeFile(
    path.join(projectRoot, "semantic-layer", "demo", "orders.yaml"),
    `name: orders
columns:
  - name: rate
    type: float
`,
    "utf8"
  );
  previousRoot = process.env.KTX_PROJECT_ROOT;
  previousContentRoot = process.env.LUCY_CONTENT_ROOT;
  process.env.KTX_PROJECT_ROOT = projectRoot;
  process.env.LUCY_CONTENT_ROOT = ".";
  invalidateContentPathsCache();
});

afterEach(async () => {
  if (previousRoot === undefined) delete process.env.KTX_PROJECT_ROOT;
  else process.env.KTX_PROJECT_ROOT = previousRoot;
  if (previousContentRoot === undefined) delete process.env.LUCY_CONTENT_ROOT;
  else process.env.LUCY_CONTENT_ROOT = previousContentRoot;
  invalidateContentPathsCache();
  await rm(projectRoot, { recursive: true, force: true });
});

describe("validate-changed column type contract", () => {
  it("turns a float column on a changed source into a blocking validation issue", async () => {
    const contracts = await readChangedSourceColumnContracts(projectRoot, "demo", "dataforai", "orders");
    expect(contracts.map((contract) => contract.filePath)).toEqual([
      "semantic-layer/demo/orders.yaml",
      "semantic-layer/demo/_schema/dataforai.yaml"
    ]);

    const validation = applyColumnTypeContractToValidation(
      { ok: true, exitCode: 0, stdout: "", stderr: "", issues: [] },
      contracts
    );
    expect(validation.ok).toBe(false);
    expect(validation.exitCode).not.toBe(0);
    const messages = (validation.issues ?? []).map((issue) => issue.message);
    expect(messages).toHaveLength(2);
    for (const message of messages) {
      expect(message).toContain("columns.0.type");
      expect(message).toContain("float");
    }

    const source = await readFile(new URL("../index.ts", import.meta.url), "utf8");
    const handlerAt = source.indexOf('app.post("/api/validate-changed"');
    const applyAt = source.indexOf("applyColumnTypeContractToValidation(", handlerAt);
    const nextRouteAt = source.indexOf('app.get("/api/wiki"', handlerAt);
    expect(handlerAt).toBeGreaterThan(0);
    expect(applyAt).toBeGreaterThan(handlerAt);
    expect(applyAt).toBeLessThan(nextRouteAt);
    expect(source.slice(handlerAt, nextRouteAt)).toContain("readChangedSourceColumnContracts(");
    expect(source.slice(handlerAt + 'app.post("/api/validate-changed"'.length, nextRouteAt)).not.toContain('app.post("/api/');
  });

  it("leaves a passing validation unchanged when every column type is allowed", () => {
    const validation = applyColumnTypeContractToValidation(
      { ok: true, exitCode: 0, stdout: "ok", stderr: "", issues: [] },
      [{
        filePath: "semantic-layer/demo/orders.yaml",
        columns: [{ name: "amount", type: "number" }, { name: "flag", type: "boolean" }]
      }]
    );
    expect(validation).toEqual({ ok: true, exitCode: 0, stdout: "ok", stderr: "", issues: [] });
  });
});
