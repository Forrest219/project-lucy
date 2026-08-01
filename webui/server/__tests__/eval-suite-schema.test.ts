import { describe, expect, it } from "vitest";
import {
  canonicalizeSuite,
  classifyEvalYaml,
  computeSuiteHash,
  isSafeDomain,
  isSafeId,
  MAX_CASES_PER_IMPORT,
  MAX_SUITE_BYTES,
  parseEvalResultImport,
  parseEvalSuite,
  parseLegacyEvalCases
} from "../eval/suite-schema";
import type { EvalSuite, EvalSuiteCase } from "../../src/lib/types";

const baseCase: EvalSuiteCase = {
  id: "kx-financial-income-001",
  case_type: "single_turn",
  question: "查询 2024 年营业收入",
  expected_source: "semantic_layer"
};

const baseSuite = (): EvalSuite => ({
  lucy_eval_schema_version: 1,
  kind: "lucy_eval_suite",
  suite_id: "kx_financial_v2026_08",
  domain: "kx_financial",
  title: "KX Financial Eval Suite",
  cases: [baseCase]
});

describe("isSafeId", () => {
  it("accepts canonical ids", () => {
    expect(isSafeId("kx-financial-income-001")).toBe(true);
    expect(isSafeId("a")).toBe(true);
    expect(isSafeId("0")).toBe(true);
    expect(isSafeId("superstore_ordercount_009")).toBe(true);
  });
  it("rejects path traversal / shell chars / uppercase", () => {
    expect(isSafeId("../etc/passwd")).toBe(false);
    expect(isSafeId("kx financial")).toBe(false);
    expect(isSafeId("Foo")).toBe(false);
    expect(isSafeId("kx_financial/evil")).toBe(false);
    expect(isSafeId("")).toBe(false);
    expect(isSafeId("中文")).toBe(false);
  });
});

describe("isSafeDomain", () => {
  it("accepts known domains", () => {
    expect(isSafeDomain("superstore")).toBe(true);
    expect(isSafeDomain("kx_financial")).toBe(true);
    expect(isSafeDomain("data_agent_poc")).toBe(true);
  });
  it("rejects path-like or non-ascii domains", () => {
    expect(isSafeDomain("../")).toBe(false);
    expect(isSafeDomain("kx financial")).toBe(false);
    expect(isSafeDomain("")).toBe(false);
  });
});

describe("classifyEvalYaml", () => {
  it("detects canonical suite", () => {
    const yaml = `lucy_eval_schema_version: 1\nkind: lucy_eval_suite\nsuite_id: x\ndomain: x\ntitle: x\ncases: []\n`;
    expect(classifyEvalYaml(yaml)).toBe("canonical");
  });
  it("detects legacy eval file (cases at root)", () => {
    const yaml = `# legacy header\ncases:\n  - id: x\n`;
    expect(classifyEvalYaml(yaml)).toBe("legacy");
  });
});

describe("parseEvalSuite — canonical happy path", () => {
  it("parses a minimal valid suite", () => {
    const yaml = `lucy_eval_schema_version: 1\nkind: lucy_eval_suite\nsuite_id: kx_financial_v2026_08\ndomain: kx_financial\ntitle: KX Financial\ncases:\n  - id: kx-financial-income-001\n    case_type: single_turn\n    question: 查询 2024 年营业收入\n    expected_source: semantic_layer\n`;
    const result = parseEvalSuite(yaml);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.suite.domain).toBe("kx_financial");
      expect(result.suite.cases).toHaveLength(1);
      expect(result.suite.cases[0].id).toBe("kx-financial-income-001");
    } else {
      throw new Error("expected suite to be parsed");
    }
  });
});

describe("parseEvalSuite — error localization", () => {
  function errorsFor(yaml: string) {
    const out = parseEvalSuite(yaml);
    expect(out.ok).toBe(false);
    if (!out.ok) return out.errors;
    throw new Error("expected errors");
  }
  it("reports missing lucy_eval_schema_version", () => {
    const yaml = `kind: lucy_eval_suite\nsuite_id: x\ndomain: x\ntitle: x\ncases: [{id: a, case_type: single_turn, question: q, expected_source: semantic_layer}]\n`;
    const errors = errorsFor(yaml);
    expect(errors.some((e) => e.path === "lucy_eval_schema_version" && e.code === "REQUIRED_FIELD_MISSING")).toBe(true);
  });
  it("reports SCHEMA_VERSION_MISMATCH for v2", () => {
    const yaml = `lucy_eval_schema_version: 2\nkind: lucy_eval_suite\nsuite_id: x\ndomain: x\ntitle: x\ncases: [{id: a, case_type: single_turn, question: q, expected_source: semantic_layer}]\n`;
    const errors = errorsFor(yaml);
    expect(errors.some((e) => e.code === "SCHEMA_VERSION_MISMATCH")).toBe(true);
  });
  it("reports kind mismatch", () => {
    const yaml = `lucy_eval_schema_version: 1\nkind: lucy_eval\nsuite_id: x\ndomain: x\ntitle: x\ncases: [{id: a, case_type: single_turn, question: q, expected_source: semantic_layer}]\n`;
    const errors = errorsFor(yaml);
    expect(errors.some((e) => e.path === "kind" && e.code === "KIND_MISMATCH")).toBe(true);
  });
  it("reports bad domain (path-like)", () => {
    const yaml = `lucy_eval_schema_version: 1\nkind: lucy_eval_suite\nsuite_id: x\ndomain: "../oops"\ntitle: x\ncases: [{id: a, case_type: single_turn, question: q, expected_source: semantic_layer}]\n`;
    const errors = errorsFor(yaml);
    expect(errors.some((e) => e.path === "domain" && e.code === "INVALID_SAFE_ID")).toBe(true);
  });
  it("reports missing question for single_turn", () => {
    const yaml = `lucy_eval_schema_version: 1\nkind: lucy_eval_suite\nsuite_id: x\ndomain: x\ntitle: x\ncases: [{id: a, case_type: single_turn, expected_source: semantic_layer}]\n`;
    const errors = errorsFor(yaml);
    expect(errors.some((e) => e.path === "cases[0].question" && e.code === "MISSING_QUESTION")).toBe(true);
  });
  it("reports empty turns for multi_turn", () => {
    const yaml = `lucy_eval_schema_version: 1\nkind: lucy_eval_suite\nsuite_id: x\ndomain: x\ntitle: x\ncases:\n  - id: a\n    case_type: multi_turn\n    expected_source: semantic_layer\n    turns: []\n`;
    const errors = errorsFor(yaml);
    expect(errors.some((e) => e.path === "cases[0].turns" && e.code === "MISSING_TURNS")).toBe(true);
  });
  it("reports duplicate case id with index", () => {
    const yaml = `lucy_eval_schema_version: 1\nkind: lucy_eval_suite\nsuite_id: x\ndomain: x\ntitle: x\ncases:\n  - id: a\n    case_type: single_turn\n    question: q\n    expected_source: semantic_layer\n  - id: a\n    case_type: single_turn\n    question: q2\n    expected_source: semantic_layer\n`;
    const errors = errorsFor(yaml);
    expect(errors.some((e) => e.path === "cases[1].id" && e.code === "DUPLICATE_CASE_ID")).toBe(true);
  });
  it("reports invalid case_type with the offending case index", () => {
    const yaml = `lucy_eval_schema_version: 1\nkind: lucy_eval_suite\nsuite_id: x\ndomain: x\ntitle: x\ncases:\n  - id: a\n    case_type: triple_turn\n    question: q\n    expected_source: semantic_layer\n`;
    const errors = errorsFor(yaml);
    expect(errors.some((e) => e.path === "cases[0].case_type" && e.code === "INVALID_CASE_TYPE")).toBe(true);
  });
  it("enforces MAX_CASES_PER_IMPORT", () => {
    const bigCases = Array.from({ length: MAX_CASES_PER_IMPORT + 1 }).map((_, i) => ({
      id: `kx-financial-bulk-${String(i).padStart(4, "0")}`,
      case_type: "single_turn" as const,
      question: `Q ${i}`,
      expected_source: "semantic_layer" as const
    }));
    const yaml = `lucy_eval_schema_version: 1\nkind: lucy_eval_suite\nsuite_id: x\ndomain: x\ntitle: x\ncases:\n${bigCases.map((c) => `  - id: ${c.id}\n    case_type: ${c.case_type}\n    question: ${c.question}\n    expected_source: ${c.expected_source}`).join("\n")}\n`;
    const errors = errorsFor(yaml);
    expect(errors.some((e) => e.code === "TOO_MANY_CASES")).toBe(true);
  });
  it("rejects suite above MAX_SUITE_BYTES", () => {
    const padding = "x".repeat(MAX_SUITE_BYTES);
    const errors = errorsFor(padding);
    expect(errors.some((e) => e.code === "INVALID_YAML" && /exceeds/.test(e.message))).toBe(true);
  });
  it("reports malformed YAML syntax", () => {
    const errors = errorsFor("cases: [unterminated");
    expect(errors.some((e) => e.code === "INVALID_YAML")).toBe(true);
  });
});

describe("parseLegacyEvalCases", () => {
  it("reads legacy header + cases", () => {
    const yaml = `metadata:\n  version: v1.4\ncases:\n  - id: superstore-ordercount-001\n    case_type: single_turn\n    question: 统计订单数\n    expected_source: semantic_layer\n`;
    const { cases, metadata, errors } = parseLegacyEvalCases(yaml);
    expect(errors).toEqual([]);
    expect(metadata).toEqual({ version: "v1.4" });
    expect(cases.map((c) => c.id)).toEqual(["superstore-ordercount-001"]);
  });
  it("reports invalid legacy ids", () => {
    const yaml = `cases:\n  - id: "../bad"\n    case_type: single_turn\n    question: q\n    expected_source: semantic_layer\n`;
    const { errors } = parseLegacyEvalCases(yaml);
    expect(errors.some((e) => e.path === "cases[0].id" && e.code === "INVALID_SAFE_ID")).toBe(true);
  });
});

describe("canonicalizeSuite + computeSuiteHash stability", () => {
  it("produces identical hash for semantically equal suites regardless of key order", () => {
    const a = baseSuite();
    const b: EvalSuite = {
      // intentionally shuffled keys
      title: "KX Financial Eval Suite",
      kind: "lucy_eval_suite",
      domain: "kx_financial",
      cases: [baseCase],
      suite_id: "kx_financial_v2026_08",
      lucy_eval_schema_version: 1
    };
    expect(computeSuiteHash(a)).toBe(computeSuiteHash(b));
  });
  it("excludes suite_hash from the canonical input", () => {
    const without = baseSuite();
    const withHash: EvalSuite = { ...without, suite_hash: "sha256:should-be-ignored" };
    expect(computeSuiteHash(without)).toBe(computeSuiteHash(withHash));
  });
  it("changes hash when suite_id changes", () => {
    const a = baseSuite();
    const b = { ...a, suite_id: "kx_financial_v2026_09" };
    expect(computeSuiteHash(a)).not.toBe(computeSuiteHash(b));
  });
  it("changes hash when a case is added", () => {
    const a = baseSuite();
    const b: EvalSuite = {
      ...a,
      cases: [
        ...a.cases,
        { id: "kx-financial-net-001", case_type: "single_turn", question: "q", expected_source: "semantic_layer" }
      ]
    };
    expect(computeSuiteHash(a)).not.toBe(computeSuiteHash(b));
  });
  it("returns sha256:<64-hex>", () => {
    const h = computeSuiteHash(baseSuite());
    expect(h).toMatch(/^sha256:[a-f0-9]{64}$/);
  });
  it("canonicalizeSuite strips suite_hash", () => {
    const suite = { ...baseSuite(), suite_hash: "sha256:abc" } as EvalSuite;
    const canonical = canonicalizeSuite(suite) as Record<string, unknown>;
    expect("suite_hash" in canonical).toBe(false);
  });
});

describe("parseEvalResultImport", () => {
  const validResult = {
    lucy_eval_result_version: 1,
    suite_id: "kx_financial_v2026_08",
    suite_hash: "sha256:" + "a".repeat(64),
    domain: "kx_financial",
    runner: { kind: "hermes", version: "0.0.0", model: "claude-sonnet-4-6" },
    started_at: "2026-08-01T10:00:00.000Z",
    finished_at: "2026-08-01T10:05:00.000Z",
    results: [
      { case_id: "kx-financial-income-001", status: "PASS", duration_ms: 12000 }
    ]
  };
  it("accepts a valid result", () => {
    const out = parseEvalResultImport(JSON.stringify(validResult));
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.result.results[0].case_id).toBe("kx-financial-income-001");
    } else {
      throw new Error("expected result to be parsed");
    }
  });
  function resultErrors(json: unknown) {
    const out = parseEvalResultImport(JSON.stringify(json));
    expect(out.ok).toBe(false);
    if (!out.ok) return out.errors;
    throw new Error("expected errors");
  }
  it("rejects bad version", () => {
    const r = { ...validResult, lucy_eval_result_version: 99 };
    const errors = resultErrors(r);
    expect(errors.some((e) => e.code === "RESULT_VERSION_MISMATCH")).toBe(true);
  });
  it("rejects malformed suite_hash", () => {
    const r = { ...validResult, suite_hash: "sha1:abc" };
    const errors = resultErrors(r);
    expect(errors.some((e) => e.code === "RESULT_REQUIRED_FIELD" && e.path === "suite_hash")).toBe(true);
  });
  it("rejects malformed timestamp", () => {
    const r = { ...validResult, started_at: "yesterday" };
    const errors = resultErrors(r);
    expect(errors.some((e) => e.code === "RESULT_INVALID_TIMESTAMP")).toBe(true);
  });
  it("requires failures[] or error_message for FAIL", () => {
    const r = {
      ...validResult,
      results: [{ case_id: "kx-financial-income-001", status: "FAIL" }]
    };
    const errors = resultErrors(r);
    expect(errors.some((e) => e.code === "RESULT_REQUIRED_FIELD")).toBe(true);
  });
  it("flags duplicate case_id", () => {
    const r = {
      ...validResult,
      results: [
        { case_id: "kx-financial-income-001", status: "PASS" },
        { case_id: "kx-financial-income-001", status: "PASS" }
      ]
    };
    const errors = resultErrors(r);
    expect(errors.some((e) => e.code === "RESULT_DUPLICATE_CASE_ID")).toBe(true);
  });
  it("rejects empty results array", () => {
    const r = { ...validResult, results: [] };
    const errors = resultErrors(r);
    expect(errors.some((e) => e.code === "RESULT_EMPTY")).toBe(true);
  });
  it("rejects invalid status", () => {
    const r = {
      ...validResult,
      results: [{ case_id: "kx-financial-income-001", status: "MAYBE" }]
    };
    const errors = resultErrors(r);
    expect(errors.some((e) => e.code === "RESULT_INVALID_STATUS")).toBe(true);
  });
  it("flags unsafe suite_id", () => {
    const r = { ...validResult, suite_id: "../escape" };
    const errors = resultErrors(r);
    expect(errors.some((e) => e.code === "RESULT_SUITE_ID_SUSPICIOUS")).toBe(true);
  });
});