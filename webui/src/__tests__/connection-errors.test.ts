import { describe, expect, it } from "vitest";
import {
  classifyConnectionError,
  formatConnectionProbeMessage
} from "../lib/connectionErrors";
import { connectionReadinessLabel } from "../lib/connectionHealth";

describe("connectionErrors (client)", () => {
  it("classifies max_execution_time for probe UI", () => {
    const g = classifyConnectionError("Unknown system variable 'max_execution_time'");
    expect(g.category).toBe("starrocks_max_execution_time");
  });

  it("formatConnectionProbeMessage is user-facing", () => {
    const msg = formatConnectionProbeMessage("Unknown system variable 'max_execution_time'");
    expect(msg).toContain("StarRocks");
  });
});

describe("connectionReadinessLabel", () => {
  it("maps probe failure to 不可用", () => {
    const r = connectionReadinessLabel({
      healthPending: false,
      healthFailed: true,
      healthOk: false
    });
    expect(r.readiness).toBe("probe_failed");
    expect(r.label).toBe("不可用");
  });

  it("maps probe ok to 可用 when latency normal", () => {
    const r = connectionReadinessLabel({
      healthPending: false,
      healthFailed: false,
      healthOk: true,
      latencyMs: 120
    });
    expect(r.readiness).toBe("probe_ok");
    expect(r.label).toBe("可用");
  });
});
