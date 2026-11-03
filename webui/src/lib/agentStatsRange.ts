export type AgentStatsRange = "7d" | "14d" | "30d";

export const AGENT_STATS_RANGES: readonly AgentStatsRange[] = ["7d", "14d", "30d"];

export const AGENT_STATS_RANGE_HOURS: Record<AgentStatsRange, number> = {
  "7d": 168,
  "14d": 336,
  "30d": 720
};

export const DEFAULT_AGENT_STATS_RANGE: AgentStatsRange = "30d";

export function parseAgentStatsRange(raw: string | null | undefined): AgentStatsRange {
  if (raw === "7d" || raw === "14d" || raw === "30d") return raw;
  if (raw === "90d") return "30d";
  return DEFAULT_AGENT_STATS_RANGE;
}

export function agentStatsRangeNoun(range: AgentStatsRange): string {
  if (range === "7d") return "7 天";
  if (range === "14d") return "14 天";
  return "30 天";
}

export function agentStatsRangeLabel(range: AgentStatsRange): string {
  return `近 ${agentStatsRangeNoun(range)}`;
}
