import { describe, expect, it } from "vitest";
import { SESSION_VISIT_SUMMARY_PREFIX } from "../proxy/audit";
import {
  inquiryKindLabelZh,
  inquiryKindMatches,
  inquiryKindOfTurn,
  parseInquiryKindFilter
} from "../admin/audit-inquiry-kind";

describe("inquiryKindOfTurn", () => {
  it("classifies reported rows as real even when the summary looks like a session visit", () => {
    expect(inquiryKindOfTurn({
      source: "reported",
      questionSource: "reported_tool",
      questionSummary: `${SESSION_VISIT_SUMMARY_PREFIX}cursor`
    })).toBe("real");
    expect(inquiryKindOfTurn({
      source: "inferred",
      questionSource: "reported",
      questionSummary: "未上报问询原文"
    })).toBe("real");
  });

  it("classifies a displayed session-visit prefix before any other inferred row", () => {
    expect(inquiryKindOfTurn({
      source: "inferred",
      questionSummary: `${SESSION_VISIT_SUMMARY_PREFIX}workbuddy`
    })).toBe("session_visit");
  });

  it("classifies every other inferred row as an unreported inquiry", () => {
    expect(inquiryKindOfTurn({
      source: "inferred",
      questionSummary: "未上报问询原文"
    })).toBe("unreported_query");
    expect(inquiryKindOfTurn({
      source: "inferred",
      questionSummary: null
    })).toBe("unreported_query");
  });
});

describe("parseInquiryKindFilter", () => {
  it("uses management for a missing or illegal value", () => {
    expect(parseInquiryKindFilter(undefined)).toBe("management");
    expect(parseInquiryKindFilter(null)).toBe("management");
    expect(parseInquiryKindFilter("")).toBe("management");
    expect(parseInquiryKindFilter("nope")).toBe("management");
  });

  it("accepts the five documented filters", () => {
    expect(parseInquiryKindFilter("management")).toBe("management");
    expect(parseInquiryKindFilter("real")).toBe("real");
    expect(parseInquiryKindFilter("unreported_query")).toBe("unreported_query");
    expect(parseInquiryKindFilter("session_visit")).toBe("session_visit");
    expect(parseInquiryKindFilter("all")).toBe("all");
  });
});

describe("inquiryKindMatches", () => {
  it("keeps real and unreported inquiries in the management set", () => {
    expect(inquiryKindMatches("real", "management")).toBe(true);
    expect(inquiryKindMatches("unreported_query", "management")).toBe(true);
    expect(inquiryKindMatches("session_visit", "management")).toBe(false);
  });

  it("matches one kind or every kind", () => {
    expect(inquiryKindMatches("session_visit", "session_visit")).toBe(true);
    expect(inquiryKindMatches("real", "session_visit")).toBe(false);
    expect(inquiryKindMatches("session_visit", "all")).toBe(true);
  });
});

describe("inquiryKindLabelZh", () => {
  it("uses the management labels and does not call an unreported inquiry a query", () => {
    expect(inquiryKindLabelZh("real")).toBe("真实问询");
    expect(inquiryKindLabelZh("unreported_query")).toBe("未上报问询");
    expect(inquiryKindLabelZh("session_visit")).toBe("会话访问");
    expect(inquiryKindLabelZh("unreported_query")).not.toContain("查数");
  });
});
