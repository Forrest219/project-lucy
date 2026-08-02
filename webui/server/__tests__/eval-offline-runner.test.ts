import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseEvalResultImport } from "../eval/suite-schema";

const SUITE = `lucy_eval_schema_version: 1
kind: lucy_eval_suite
suite_id: kx_financial_v1
domain: kx_financial
title: KX Financial Eval Suite
suite_hash: sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
cases:
  - id: kx-income-001
    case_type: single_turn
    question: 查询 2024 年营业收入
    expected_source: semantic_layer
`;

function runNode(args: string[], cwd: string): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile("node", args, { cwd }, (error, stdout, stderr) => {
      if (error) {
        reject(Object.assign(error, { stdout, stderr }));
        return;
      }
      resolve({ stdout: stdout.toString(), stderr: stderr.toString() });
    });
  });
}

describe("scripts/lucy-eval-runner.mjs", () => {
  it("generates Result JSON accepted by the import parser", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "lucy-offline-runner-"));
    try {
      const suitePath = path.join(dir, "kx_financial.yaml");
      const resultPath = path.join(dir, "result.json");
      await writeFile(suitePath, SUITE, "utf8");

      await runNode(["scripts/lucy-eval-runner.mjs", "--suite", suitePath, "--output", resultPath], path.resolve(".."));

      const resultText = await readFile(resultPath, "utf8");
      const parsed = parseEvalResultImport(resultText);
      expect(parsed.ok).toBe(true);
      if (parsed.ok) {
        expect(parsed.result).toMatchObject({
          lucy_eval_result_version: 1,
          suite_id: "kx_financial_v1",
          suite_hash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          domain: "kx_financial",
          runner: { kind: "noop" }
        });
        expect(parsed.result.results[0]).toMatchObject({
          case_id: "kx-income-001",
          status: "SKIPPED"
        });
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
