import { afterEach, describe, expect, it } from "vitest";
import {
  bindInferredTurnMaintainer,
  inferredRebuildStatus,
  isInferredMaintainerPaused
} from "../admin/inferred-turn-maintainer.js";

/**
 * P1-47 暂停开关：LUCY_INFERRED_MAINTAINER=off。
 * 默认开启；只有明确 off 才暂停；暂停时状态如实标 paused，不得报「补算完成」。
 */
describe("inferred maintainer pause switch", () => {
  const saved = process.env.LUCY_INFERRED_MAINTAINER;
  afterEach(() => {
    if (saved === undefined) delete process.env.LUCY_INFERRED_MAINTAINER;
    else process.env.LUCY_INFERRED_MAINTAINER = saved;
    bindInferredTurnMaintainer(null);
  });

  it("is not paused by default or by other values", () => {
    expect(isInferredMaintainerPaused({})).toBe(false);
    expect(isInferredMaintainerPaused({ LUCY_INFERRED_MAINTAINER: "" })).toBe(false);
    expect(isInferredMaintainerPaused({ LUCY_INFERRED_MAINTAINER: "on" })).toBe(false);
    expect(isInferredMaintainerPaused({ LUCY_INFERRED_MAINTAINER: "0" })).toBe(false);
  });

  it("pauses only on an explicit off (case/space tolerant)", () => {
    expect(isInferredMaintainerPaused({ LUCY_INFERRED_MAINTAINER: "off" })).toBe(true);
    expect(isInferredMaintainerPaused({ LUCY_INFERRED_MAINTAINER: " OFF " })).toBe(true);
  });

  it("default status without a maintainer is unchanged (complete)", () => {
    delete process.env.LUCY_INFERRED_MAINTAINER;
    expect(inferredRebuildStatus()).toEqual({ complete: true, pendingUsers: 0, lastCompletedAt: null });
  });

  it("paused status never reports complete", () => {
    process.env.LUCY_INFERRED_MAINTAINER = "off";
    expect(inferredRebuildStatus()).toEqual({ complete: false, pendingUsers: 0, lastCompletedAt: null, paused: true });
  });
});
