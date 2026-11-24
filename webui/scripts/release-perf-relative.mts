/**
 * REQ-030-034 / Spec D6 — relative regression gate for release-perf baselines.
 *
 * Fail only when BOTH:
 *   deltaP95 > 50ms  AND  deltaP95 / previousP95 > 0.20
 * One-sided noise → warn, not fail. Missing previous → baseline-seed (not a green relative pass).
 */

export const RELEASE_PERF_RUNNER_VERSION = "release-perf-baseline/0.1.0";

export type MetricSnapshot = {
  id: string;
  scenario: string;
  route: string;
  metric: string;
  p95: number | null;
};

export type RelativeVerdict = {
  id: string;
  status: "pass" | "fail" | "warn" | "baseline-seed" | "skip";
  previousP95: number | null;
  currentP95: number | null;
  deltaMs: number | null;
  deltaRatio: number | null;
  note?: string;
};

export type ReleasePerfReport = {
  schema: "lucy-release-perf-baseline/v1";
  runnerVersion: string;
  lucyVersion: string;
  gitSha: string;
  gitShaShort: string;
  fixtureTier: "ci-small" | "release-medium";
  machine: {
    os: string;
    arch: string;
    cpuModelHash: string;
    cpuCount: number;
    totalMemBytes: number;
    node: string;
  };
  relativeMode: "compared" | "baseline-seed";
  previousBaselinePath: string | null;
  metrics: Array<MetricSnapshot & { n: number; p50: number | null; max: number | null }>;
  absolute: Array<{ id: string; passed: boolean; limit: number; actual: number | null; note?: string }>;
  relative: RelativeVerdict[];
  counters: Record<string, number | boolean | string | null>;
  acceptedRegressions: Array<{ id: string; reason: string; acceptor: string }>;
  status: "pass" | "fail" | "baseline-seed";
  secretsScan: { offenders: number };
};

/** Spec D6 dual-condition relative gate. */
export function evaluateRelativeRegression(
  current: MetricSnapshot[],
  previous: MetricSnapshot[] | null,
  options: { acceptedIds?: ReadonlySet<string> } = {}
): RelativeVerdict[] {
  if (!previous) {
    return current.map((metric) => ({
      id: metric.id,
      status: "baseline-seed" as const,
      previousP95: null,
      currentP95: metric.p95,
      deltaMs: null,
      deltaRatio: null,
      note: "no previous formal baseline"
    }));
  }
  const prevById = new Map(previous.map((item) => [item.id, item]));
  const accepted = options.acceptedIds ?? new Set<string>();
  return current.map((metric) => {
    const prior = prevById.get(metric.id);
    if (!prior || prior.p95 == null || metric.p95 == null || prior.p95 <= 0) {
      return {
        id: metric.id,
        status: "skip" as const,
        previousP95: prior?.p95 ?? null,
        currentP95: metric.p95,
        deltaMs: null,
        deltaRatio: null,
        note: "missing comparable p95"
      };
    }
    const deltaMs = metric.p95 - prior.p95;
    const deltaRatio = deltaMs / prior.p95;
    if (deltaMs <= 0) {
      return { id: metric.id, status: "pass", previousP95: prior.p95, currentP95: metric.p95, deltaMs, deltaRatio };
    }
    const absoluteHit = deltaMs > 50;
    const relativeHit = deltaRatio > 0.2;
    if (absoluteHit && relativeHit) {
      if (accepted.has(metric.id)) {
        return {
          id: metric.id,
          status: "warn",
          previousP95: prior.p95,
          currentP95: metric.p95,
          deltaMs,
          deltaRatio,
          note: "accepted regression"
        };
      }
      return {
        id: metric.id,
        status: "fail",
        previousP95: prior.p95,
        currentP95: metric.p95,
        deltaMs,
        deltaRatio,
        note: `>+20% and >+50ms vs previous`
      };
    }
    if (absoluteHit || relativeHit) {
      return {
        id: metric.id,
        status: "warn",
        previousP95: prior.p95,
        currentP95: metric.p95,
        deltaMs,
        deltaRatio,
        note: "single-sided noise (D6)"
      };
    }
    return { id: metric.id, status: "pass", previousP95: prior.p95, currentP95: metric.p95, deltaMs, deltaRatio };
  });
}

export function overallReleaseStatus(input: {
  absoluteFailed: boolean;
  relative: RelativeVerdict[];
  hasPrevious: boolean;
}): ReleasePerfReport["status"] {
  if (input.absoluteFailed || input.relative.some((item) => item.status === "fail")) return "fail";
  if (!input.hasPrevious) return "baseline-seed";
  return "pass";
}

export function metricId(scenario: string, route: string, metric: string): string {
  return `${scenario}/${route}/${metric}`;
}
