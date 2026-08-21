import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeEach, afterEach, describe, expect, it } from "vitest";
import { listCases, addCase, updateCase, deleteCase, getCase, listDomains, CaseNotFoundError, CaseIdTakenError } from "../eval/cases";
import { parse as parseYaml } from "yaml";
import { resetAuditDbForTests } from "../admin/audit";

const SAMPLE_YAML = `# eval cases for superstore domain
# This comment must be preserved
metadata:
  version: v1.3
  runner_schema_version: v1.3
  document_name: Superstore Eval Cases

cases:
  - id: superstore-discount-001
    case_type: single_turn
    question: What is the weighted discount?
    domain: superstore
    expected_source: semantic_layer
    expected_measures:
      - weighted_discount
    sql_assertions:
      - type: measure_lineage
        value: weighted_discount
        normalize: true
        reason: Must use semantic layer
    result_assertions:
      - value_type: scalar
        data:
          weighted_discount: 0.1398
        compare_mode: approx
    snapshot_date: "2026-06-17"

  - id: superstore-discount-002
    case_type: single_turn
    question: Discount by category?
    domain: superstore
    expected_source: semantic_layer
    expected_measures:
      - weighted_discount
    sql_assertions:
      - type: measure_lineage
        value: weighted_discount
        normalize: true
        reason: Must use semantic layer
    result_assertions:
      - value_type: dataframe
        data:
          rows: []
        compare_mode: schema_only
    snapshot_date: "2026-06-17"
`;

let projectRoot: string;
let previousRoot: string | undefined;

beforeEach(async () => {
  projectRoot = await mkdtemp(path.join(os.tmpdir(), "ktx-eval-cases-"));
  // Need ktx.yaml for project detection in fs-safe tests / config audit
  await writeFile(path.join(projectRoot, "ktx.yaml"), "connections: {}\n", "utf8");
  await mkdir(path.join(projectRoot, ".ktx-ui"), { recursive: true });
  await mkdir(path.join(projectRoot, "evals", "superstore", "eval"), { recursive: true });
  await writeFile(
    path.join(projectRoot, "evals", "superstore", "eval", "superstore-eval-cases.yaml"),
    SAMPLE_YAML,
    "utf8"
  );
  previousRoot = process.env.KTX_PROJECT_ROOT;
  process.env.KTX_PROJECT_ROOT = projectRoot;
  resetAuditDbForTests();
});

afterEach(async () => {
  resetAuditDbForTests();
  if (previousRoot === undefined) delete process.env.KTX_PROJECT_ROOT;
  else process.env.KTX_PROJECT_ROOT = previousRoot;
  await rm(projectRoot, { recursive: true, force: true });
});

describe("eval-cases: read", () => {
  it("lists cases from yaml", async () => {
    const cases = await listCases(projectRoot, "superstore");
    expect(cases).toHaveLength(2);
    expect(cases[0].id).toBe("superstore-discount-001");
    expect(cases[1].id).toBe("superstore-discount-002");
  });

  it("getCase returns correct case", async () => {
    const c = await getCase(projectRoot, "superstore", "superstore-discount-001");
    expect(c.question).toBe("What is the weighted discount?");
    expect(c.expected_measures).toEqual(["weighted_discount"]);
  });

  it("getCase throws CaseNotFoundError for missing id", async () => {
    await expect(getCase(projectRoot, "superstore", "nonexistent-case")).rejects.toBeInstanceOf(CaseNotFoundError);
  });

  it("listDomains returns domain info", async () => {
    const domains = await listDomains(projectRoot);
    expect(domains).toHaveLength(1);
    expect(domains[0].domain).toBe("superstore");
    expect(domains[0].caseCount).toBe(2);
  });
});

describe("eval-cases: yaml round-trip (comment preservation)", () => {
  it("preserves comments after update", async () => {
    const updatedCase = await getCase(projectRoot, "superstore", "superstore-discount-001");
    updatedCase.notes = "Updated note";
    await updateCase(projectRoot, "superstore", "superstore-discount-001", updatedCase, false);

    const written = await readFile(
      path.join(projectRoot, "evals", "superstore", "eval", "superstore-eval-cases.yaml"),
      "utf8"
    );
    // Comment should still be present
    expect(written).toContain("# eval cases for superstore domain");
    expect(written).toContain("# This comment must be preserved");
  });

  it("round-trips without data loss", async () => {
    const before = await listCases(projectRoot, "superstore");
    // Update a case and re-read
    const c = { ...before[0], notes: "round-trip test" };
    await updateCase(projectRoot, "superstore", c.id, c, false);
    const after = await listCases(projectRoot, "superstore");
    expect(after).toHaveLength(2);
    expect(after[0].id).toBe(before[0].id);
    expect(after[1].id).toBe(before[1].id);
  });

  it("dryRun returns diff without writing", async () => {
    const c = await getCase(projectRoot, "superstore", "superstore-discount-001");
    c.notes = "dry run change";
    const result = await updateCase(projectRoot, "superstore", "superstore-discount-001", c, true);
    expect("diff" in result).toBe(true);
    expect("proposedYaml" in result).toBe(true);

    // File should NOT have the dry-run change
    const written = await readFile(
      path.join(projectRoot, "evals", "superstore", "eval", "superstore-eval-cases.yaml"),
      "utf8"
    );
    expect(written).not.toContain("dry run change");
  });

  it("dryRun diff contains expected changes", async () => {
    const c = await getCase(projectRoot, "superstore", "superstore-discount-001");
    c.notes = "new note for diff";
    const result = await updateCase(projectRoot, "superstore", "superstore-discount-001", c, true);
    if ("diff" in result) {
      expect(result.diff).toContain("new note for diff");
    }
  });
});

describe("eval-cases: add case", () => {
  it("appends new case", async () => {
    const newCase = {
      id: "superstore-edge-001",
      case_type: "single_turn" as const,
      question: "Edge case test",
      domain: "superstore",
      expected_source: "semantic_layer" as const,
      expected_measures: ["profit_margin"],
      sql_assertions: [{ type: "measure_lineage" as const, value: "profit_margin", normalize: true, reason: "test" }],
      result_assertions: [{ value_type: "scalar" as const, compare_mode: "approx", data: { profit_margin: 0.1 } }],
      snapshot_date: "2026-06-19"
    };

    await addCase(projectRoot, "superstore", newCase);
    const cases = await listCases(projectRoot, "superstore");
    expect(cases).toHaveLength(3);
    expect(cases.find((c) => c.id === "superstore-edge-001")).toBeTruthy();
  });

  it("rejects duplicate case id", async () => {
    const existing = await getCase(projectRoot, "superstore", "superstore-discount-001");
    await expect(addCase(projectRoot, "superstore", existing)).rejects.toBeInstanceOf(CaseIdTakenError);
  });

  it("new case does not break existing cases", async () => {
    const newCase = {
      id: "superstore-new-999",
      case_type: "single_turn" as const,
      question: "test?",
      domain: "superstore",
      expected_source: "semantic_layer" as const,
      sql_assertions: [],
      result_assertions: [],
      snapshot_date: "2026-06-19"
    };
    await addCase(projectRoot, "superstore", newCase);
    const after = await listCases(projectRoot, "superstore");
    // Original cases untouched
    expect(after[0].question).toBe("What is the weighted discount?");
    expect(after[1].question).toBe("Discount by category?");
  });
});

describe("eval-cases: delete case", () => {
  it("removes case from yaml", async () => {
    await deleteCase(projectRoot, "superstore", "superstore-discount-001");
    const cases = await listCases(projectRoot, "superstore");
    expect(cases).toHaveLength(1);
    expect(cases[0].id).toBe("superstore-discount-002");
  });

  it("throws CaseNotFoundError for missing id", async () => {
    await expect(deleteCase(projectRoot, "superstore", "nonexistent")).rejects.toBeInstanceOf(CaseNotFoundError);
  });
});
