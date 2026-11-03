import { SESSION_VISIT_SUMMARY_PREFIX } from "../proxy/audit.js";

export type InquiryKind = "real" | "unreported_query" | "session_visit";

export type InquiryKindFilter = "management" | "real" | "unreported_query" | "session_visit" | "all";

const INQUIRY_KIND_FILTERS = new Set<InquiryKindFilter>([
  "management",
  "real",
  "unreported_query",
  "session_visit",
  "all"
]);

const REPORTED_QUESTION_SOURCES = new Set(["reported", "reported_tool"]);

export function inquiryKindOfTurn(turn: {
  source: "reported" | "inferred";
  questionSource?: string | null;
  questionSummary?: string | null;
}): InquiryKind {
  if (turn.source === "reported" || (turn.questionSource != null && REPORTED_QUESTION_SOURCES.has(turn.questionSource))) {
    return "real";
  }
  if ((turn.questionSummary ?? "").startsWith(SESSION_VISIT_SUMMARY_PREFIX)) return "session_visit";
  return "unreported_query";
}

export function parseInquiryKindFilter(raw: string | null | undefined): InquiryKindFilter {
  const value = raw?.trim() ?? "";
  if (INQUIRY_KIND_FILTERS.has(value as InquiryKindFilter)) return value as InquiryKindFilter;
  return "management";
}

export function inquiryKindMatches(kind: InquiryKind, filter: InquiryKindFilter): boolean {
  if (filter === "all") return true;
  if (filter === "management") return kind !== "session_visit";
  return kind === filter;
}

export function inquiryKindLabelZh(kind: InquiryKind): string {
  if (kind === "real") return "真实问询";
  if (kind === "unreported_query") return "未上报问询";
  return "会话访问";
}
