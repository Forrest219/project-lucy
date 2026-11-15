/**
 * P1-32 / P1-33 — registry guard. Every finding fixed by REQ-030-053/054 keeps a frozen oracle
 * (legacy copy or pre-fix golden) AND a test that uses it. Deleting an oracle, or "fixing" a
 * failing equivalence test by regenerating its golden, must show up here and in review.
 *
 * To change a golden on purpose: the behaviour change needs the 委托人's approval recorded in the
 * Spec changelog first; then regenerate with UPDATE_EQUIVALENCE_GOLDEN=1 and bump `goldenRevision`.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(path.join(HERE, rel), "utf8");

type Finding = {
  id: string;
  oracle: { kind: "legacy" | "golden" | "sql-derived"; files: string[] };
  test: string;
  /** Bump together with an approved golden change. */
  goldenRevision?: number;
};

export const FINDINGS: Finding[] = [
  { id: "F-1", oracle: { kind: "legacy", files: ["legacy/inquiry-pack-rows.legacy.ts"] }, test: "inquiry-pack-rows.equivalence.test.ts" },
  { id: "F-2", oracle: { kind: "sql-derived", files: [] }, test: "access-map-rebuild-trigger.test.ts" },
  { id: "F-3", oracle: { kind: "golden", files: ["golden/daily-question-kpi-24h.json", "golden/daily-question-kpi-168h.json", "golden/daily-question-kpi-720h.json"] }, test: "daily-question-kpi.equivalence.test.ts", goldenRevision: 1 },
  { id: "F-4", oracle: { kind: "legacy", files: ["legacy/audit-local-timestamp.legacy.ts"] }, test: "audit-local-timestamp.equivalence.test.ts" },
  { id: "F-5", oracle: { kind: "golden", files: ["golden/ui-usage-overview-24h.json", "golden/ui-usage-overview-168h.json"] }, test: "ui-usage-overview.equivalence.test.ts", goldenRevision: 1 },
  { id: "F-6", oracle: { kind: "legacy", files: ["legacy/audit-as-of-proof.legacy.ts"] }, test: "audit-as-of-proof.equivalence.test.ts" },
  { id: "F-7", oracle: { kind: "legacy", files: ["legacy/inquiry-where.legacy.ts"] }, test: "inquiry-where.equivalence.test.ts" },
  { id: "F-yield", oracle: { kind: "sql-derived", files: [] }, test: "export-yielding.equivalence.test.ts" },
  { id: "F-idx", oracle: { kind: "sql-derived", files: [] }, test: "audit-schema-indexes.test.ts" }
];

describe("equivalence registry", () => {
  for (const finding of FINDINGS) {
    it(`${finding.id}: oracle files and their test are present and wired`, () => {
      expect(existsSync(path.join(HERE, finding.test)), `${finding.test} missing`).toBe(true);
      const testSource = read(finding.test);
      for (const file of finding.oracle.files) {
        expect(existsSync(path.join(HERE, file)), `${file} missing`).toBe(true);
        const body = read(file);
        if (finding.oracle.kind === "legacy") expect(body, `${file} lost its FROZEN REFERENCE marker`).toMatch(/FROZEN REFERENCE/);
        if (finding.oracle.kind === "golden") {
          expect(() => JSON.parse(body), `${file} is not JSON`).not.toThrow();
          expect(body.length, `${file} is empty`).toBeGreaterThan(200);
        }
        // The test must actually consume the oracle (legacy import or golden name).
        const stem = path.basename(file).replace(/\.(legacy\.ts|json)$/, "").replace(/-(\d+h)$/, "");
        expect(testSource, `${finding.test} no longer uses ${file}`).toContain(stem.replace(/\.legacy$/, ""));
      }
    });
  }

  it("no unregistered frozen oracle exists (every legacy/golden file belongs to a finding)", () => {
    const registered = new Set(FINDINGS.flatMap((f) => f.oracle.files));
    for (const dir of ["legacy", "golden"]) {
      for (const name of readdirSync(path.join(HERE, dir))) expect(registered.has(`${dir}/${name}`), `${dir}/${name} is not registered`).toBe(true);
    }
  });
});
