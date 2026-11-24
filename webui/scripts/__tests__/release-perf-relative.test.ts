import { describe, expect, it } from "vitest";
import {
  evaluateRelativeRegression,
  metricId,
  overallReleaseStatus,
  type MetricSnapshot
} from "../release-perf-relative.mts";
import { FIXTURE_TIER_FLOORS, parseReleaseCli } from "../release-perf-baseline.mts";

describe("REQ-030-034 D6 relative gate", () => {
  const current: MetricSnapshot[] = [
    { id: metricId("api-warm", "roles", "httpTotalMs"), scenario: "api-warm", route: "roles", metric: "httpTotalMs", p95: 180 }
  ];

  it("seeds when there is no previous baseline", () => {
    const verdicts = evaluateRelativeRegression(current, null);
    expect(verdicts).toEqual([
      expect.objectContaining({ id: current[0]!.id, status: "baseline-seed", previousP95: null })
    ]);
    expect(overallReleaseStatus({ absoluteFailed: false, relative: verdicts, hasPrevious: false })).toBe("baseline-seed");
  });

  it("fails only when both >+50ms and >+20%", () => {
    const previous: MetricSnapshot[] = [
      { id: current[0]!.id, scenario: "api-warm", route: "roles", metric: "httpTotalMs", p95: 100 }
    ];
    const fail = evaluateRelativeRegression([{ ...current[0]!, p95: 160 }], previous);
    expect(fail[0]!.status).toBe("fail");

    // +60ms but only +15% vs 400 → absolute hits, ratio does not → warn
    const warnAbsOnly = evaluateRelativeRegression(
      [{ ...current[0]!, p95: 460 }],
      [{ ...previous[0]!, p95: 400 }]
    );
    expect(warnAbsOnly[0]!.status).toBe("warn");
    expect(warnAbsOnly[0]!.note).toMatch(/single-sided/);

    // +30ms and +30% → ratio hits, absolute does not → warn
    const warnRatioOnly = evaluateRelativeRegression(
      [{ ...current[0]!, p95: 130 }],
      [{ ...previous[0]!, p95: 100 }]
    );
    expect(warnRatioOnly[0]!.status).toBe("warn");

    const pass = evaluateRelativeRegression([{ ...current[0]!, p95: 110 }], previous);
    expect(pass[0]!.status).toBe("pass");
  });

  it("honours accepted regression ids as warn", () => {
    const previous: MetricSnapshot[] = [
      { id: current[0]!.id, scenario: "api-warm", route: "roles", metric: "httpTotalMs", p95: 100 }
    ];
    const verdicts = evaluateRelativeRegression([{ ...current[0]!, p95: 200 }], previous, {
      acceptedIds: new Set([current[0]!.id])
    });
    expect(verdicts[0]!.status).toBe("warn");
    expect(verdicts[0]!.note).toMatch(/accepted/);
  });
});

describe("release-perf CLI / fixture tiers", () => {
  it("parses ci-small defaults and requires output", () => {
    expect(() => parseReleaseCli([])).toThrow(/--output/);
    const opts = parseReleaseCli(["--tier", "ci-small", "--output", "inbox/perf-baselines/x"]);
    expect(opts.tier).toBe("ci-small");
    expect(opts.iterations).toBe(FIXTURE_TIER_FLOORS["ci-small"].defaultIterations);
  });

  it("documents ci-small vs release-medium floors", () => {
    expect(FIXTURE_TIER_FLOORS["ci-small"].minAuditEvents).toBe(0);
    expect(FIXTURE_TIER_FLOORS["release-medium"].minAuditEvents).toBeGreaterThanOrEqual(2000);
    expect(FIXTURE_TIER_FLOORS["ci-small"].scenarios).toContain("mcp-hotpath");
    expect(FIXTURE_TIER_FLOORS["release-medium"].scenarios).toContain("roles-api");
  });
});
