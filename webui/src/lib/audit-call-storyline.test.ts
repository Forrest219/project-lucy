import { describe, expect, it } from "vitest";
import {
  buildCallStoryLine,
  intentFromArgs,
  resultSummary,
  stepHint
} from "./audit-call-storyline";

/** Inquiry 376-shaped chain (exclude connect): begin → wide fail → narrow ok. */
const begin = {
  tool: "lucy_begin_question",
  accessGrade: "ask" as const,
  outcome: "ok",
  argsSummary: {
    entities: ["Lucy MCP", "mysql-aliyun", "ai_intl_ad_daily", "ai_intl_retention_daily"]
  }
};

const wideFailAd = {
  tool: "lucy_query",
  accessGrade: "query" as const,
  outcome: "error",
  decisionReason: "upstream_error",
  tables: ["chatbi.ai_intl_ad_daily"],
  argsSummary: {
    connectionId: "mysql-aliyun",
    source: "ai_intl_ad_daily",
    dimensions: [
      { field: "ai_intl_ad_daily.country_region", name: "country" },
      { field: "ai_intl_ad_daily.platform", name: "platform" }
    ],
    measures: ["ai_intl_ad_daily.spend", "ai_intl_ad_daily.new_users_af", "ai_intl_ad_daily.cac"]
  },
  errorDetail: '[{"type":"text","text":"Invalid use of group function"}]'
};

const narrowOkAd = {
  tool: "lucy_query",
  accessGrade: "query" as const,
  outcome: "ok",
  tables: ["chatbi.ai_intl_ad_daily"],
  argsSummary: {
    connectionId: "mysql-aliyun",
    source: "ai_intl_ad_daily",
    dimensions: [
      { field: "ai_intl_ad_daily.country_region", name: "country" },
      { field: "ai_intl_ad_daily.platform", name: "platform" }
    ],
    measures: ["ai_intl_ad_daily.spend"]
  },
  responseRowCount: 16
};

describe("audit-call-storyline", () => {
  it("SC-02 — lucy_begin_question action is 问询登记", () => {
    expect(buildCallStoryLine(begin).action).toBe("问询登记");
  });

  it("SC-03 — failed lucy_query surfaces group-function phrase", () => {
    const story = buildCallStoryLine(wideFailAd);
    expect(story.action).toBe("查数");
    expect(story.resultSummary).toContain("Invalid use of group function");
    expect(resultSummary(wideFailAd)).toMatch(/^失败 ·/);
  });

  it("SC-04 — successful query includes row count", () => {
    expect(buildCallStoryLine(narrowOkAd).resultSummary).toBe("成功 · 16 行");
  });

  it("SC-05 — true measure subset after failure → 缩指标重试", () => {
    expect(stepHint(wideFailAd, narrowOkAd)).toBe("缩指标重试");
    expect(buildCallStoryLine(narrowOkAd, wideFailAd).stepHint).toBe("缩指标重试");
  });

  it("SC-13 — 376-shaped visible chain: intents differ between wide fail and narrow ok", () => {
    const failIntent = intentFromArgs(wideFailAd.tool, wideFailAd.argsSummary, wideFailAd.tables);
    const okIntent = intentFromArgs(narrowOkAd.tool, narrowOkAd.argsSummary, narrowOkAd.tables);
    expect(failIntent).toContain("cac");
    expect(okIntent).toContain("spend");
    expect(okIntent).not.toContain("cac");
    expect(failIntent).not.toEqual(okIntent);

    const stories = [begin, wideFailAd, narrowOkAd].map((call, index, arr) =>
      buildCallStoryLine(call, index === 0 ? null : arr[index - 1])
    );
    expect(stories[0].action).toBe("问询登记");
    expect(stories[1].resultSummary).toContain("失败");
    expect(stories[2].resultSummary).toContain("16 行");
    expect(stories[2].stepHint).toBe("缩指标重试");
  });
});
