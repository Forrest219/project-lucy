/**
 * P1-35 v0.4（D10–D15）— 选表歧义容错三档：
 *   ① allow（单来源在命中内，或已声明 join 连通）
 *   ② allow + 披露 + 审计（钉选在命中外／多来源未连通／未确认）
 *   ③ deny（跨连接、来源数 > SOURCE_COUNT_CAP；其余硬线由门闩主流程承担）
 *
 * 权威合同：docs/specs/lucy-20261116-source-ambiguity-mcp-escape-spec.md §4.5
 */
import { createHash } from "node:crypto";
import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { canonicalSourceKeyEquals } from "./acl.js";
import { sourceAmbiguityStateDir, type SourceIdentity } from "./source-ambiguity-journey.js";

export const SOURCE_COUNT_CAP = 4;
const DISCLOSURE_TERM_HITS_MAX = 8;
export const TOLERATED_EVENTS_FILE = "tolerated-events.jsonl";

export type ToleratedReason =
  | "multi_hit_unconfirmed"
  | "pin_outside_hits"
  | "unjoined_multi_source";

export type SourceSelection = {
  status: "tolerated";
  reason: ToleratedReason;
  usedSources: SourceIdentity[];
  termHits: SourceIdentity[];
};

export type SelectionDecision =
  | { kind: "allow" }
  | { kind: "tolerate"; reason: ToleratedReason }
  | { kind: "deny"; detail: "cross_connection" | "source_count_over_cap" };

/**
 * keys≥1 的纯判定。termHits＜2 视为「无歧义」（keys 视作在命中内）。
 * `connected`＝请求内全部来源被已声明 join 连通（单来源恒真）。
 */
export function decideSourceSelection(input: {
  keys: readonly SourceIdentity[];
  termHits: readonly SourceIdentity[];
  connected: boolean;
}): SelectionDecision {
  const { keys, termHits, connected } = input;
  if (new Set(keys.map((k) => k.connectionId)).size > 1) {
    return { kind: "deny", detail: "cross_connection" };
  }
  if (keys.length > SOURCE_COUNT_CAP) {
    return { kind: "deny", detail: "source_count_over_cap" };
  }
  const inHits =
    termHits.length < 2 || keys.every((k) => termHits.some((h) => canonicalSourceKeyEquals(h, k)));
  if (keys.length === 1) {
    return inHits ? { kind: "allow" } : { kind: "tolerate", reason: "pin_outside_hits" };
  }
  if (!connected) return { kind: "tolerate", reason: "unjoined_multi_source" };
  return inHits ? { kind: "allow" } : { kind: "tolerate", reason: "multi_hit_unconfirmed" };
}

type SourceBrief = { connectionId: string; sourceName: string; table: string };

function brief(key: SourceIdentity): SourceBrief {
  return { connectionId: key.connectionId, sourceName: key.sourceName, table: key.physicalTable };
}

/** answer_verifiability.sourceSelection 的披露形态（不含取值、凭据）。 */
export type SourceSelectionDisclosure = {
  status: "tolerated";
  reason: ToleratedReason;
  usedSources: SourceBrief[];
  termHits: SourceBrief[];
  termHitsTruncated?: true;
};

export function toSelectionDisclosure(selection: SourceSelection): SourceSelectionDisclosure {
  const hits = selection.termHits.slice(0, DISCLOSURE_TERM_HITS_MAX).map(brief);
  return {
    status: "tolerated",
    reason: selection.reason,
    usedSources: selection.usedSources.map(brief),
    termHits: hits,
    ...(selection.termHits.length > DISCLOSURE_TERM_HITS_MAX ? { termHitsTruncated: true as const } : {})
  };
}

/** D14：只记录，无阈值、无告警。写失败不得影响放行（审计是旁路）。 */
export async function appendToleratedEvent(input: {
  selection: SourceSelection;
  tool: string;
  identityKey: string;
  sessionId: string | null | undefined;
}): Promise<void> {
  try {
    const base = await sourceAmbiguityStateDir();
    await mkdir(base, { recursive: true });
    const line = JSON.stringify({
      ts: new Date().toISOString(),
      reason: input.selection.reason,
      tool: input.tool,
      session: createHash("sha256")
        .update(`${input.identityKey}:${input.sessionId ?? "-"}`)
        .digest("hex")
        .slice(0, 12),
      usedSources: input.selection.usedSources.map(brief),
      termHits: input.selection.termHits.slice(0, DISCLOSURE_TERM_HITS_MAX).map(brief)
    });
    await appendFile(path.join(base, TOLERATED_EVENTS_FILE), `${line}\n`, "utf8");
  } catch {
    // 审计旁路：失败不阻断主路径。
  }
}
