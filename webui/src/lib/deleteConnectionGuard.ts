/** Spec 179: kinds that can block deleting a connection. */
export const CONNECTION_DELETE_BLOCKER_KINDS = [
  "role_connection",
  "role_selector",
  "identity",
  "wiki",
  "semantic_asset"
] as const;

export type ConnectionDeleteBlockerKind = (typeof CONNECTION_DELETE_BLOCKER_KINDS)[number];

export type ConnectionDeleteBlocker = {
  kind: ConnectionDeleteBlockerKind;
  id: string;
};

const HARD_LABELS: Record<Exclude<ConnectionDeleteBlockerKind, "semantic_asset">, string> = {
  role_connection: "角色",
  role_selector: "角色",
  identity: "用户",
  wiki: "业务 Wiki"
};

const LABEL_ORDER = ["角色", "用户", "业务 Wiki"];

export function isConnectionDeleteBlocker(value: unknown): value is ConnectionDeleteBlocker {
  if (!value || typeof value !== "object") return false;
  const kind = (value as { kind?: unknown }).kind;
  const id = (value as { id?: unknown }).id;
  return (
    typeof kind === "string" &&
    (CONNECTION_DELETE_BLOCKER_KINDS as readonly string[]).includes(kind) &&
    typeof id === "string"
  );
}

type ConnectionDeleteImpactLike = {
  blockers?: ConnectionDeleteBlocker[] | null;
  aclRoleIds?: string[];
  wikiRefCount?: number;
  wikiSamplePaths?: string[];
  yamlAssetPaths?: string[];
};

/**
 * Prefer the Spec 179 blocker list. Older previews only have the flat summaries;
 * those still block confirmation, without inventing identity rows the server did not send.
 */
export function resolveConnectionDeleteBlockers(impact: ConnectionDeleteImpactLike): ConnectionDeleteBlocker[] {
  if (Array.isArray(impact.blockers)) return impact.blockers.filter(isConnectionDeleteBlocker);
  const blockers: ConnectionDeleteBlocker[] = [];
  for (const id of impact.aclRoleIds ?? []) {
    blockers.push({ kind: "role_connection", id });
  }
  const wikiCount = impact.wikiRefCount ?? 0;
  if (wikiCount > 0) {
    const paths = (impact.wikiSamplePaths ?? []).filter((id) => id.length > 0);
    if (paths.length === 0) blockers.push({ kind: "wiki", id: "" });
    else for (const id of paths) blockers.push({ kind: "wiki", id });
  }
  for (const id of impact.yamlAssetPaths ?? []) {
    blockers.push({ kind: "semantic_asset", id });
  }
  return blockers;
}

export function activeConnectionDeleteBlockers(
  blockers: ConnectionDeleteBlocker[],
  deleteAssets: boolean
): ConnectionDeleteBlocker[] {
  return blockers.filter((blocker) => blocker.kind !== "semantic_asset" || !deleteAssets);
}

export function connectionDeleteIsBlocked(blockers: ConnectionDeleteBlocker[], deleteAssets: boolean): boolean {
  return activeConnectionDeleteBlockers(blockers, deleteAssets).length > 0;
}

function joinLabels(labels: string[]): string {
  if (labels.length <= 1) return labels[0] ?? "";
  if (labels.length === 2) return `${labels[0]}和${labels[1]}`;
  return `${labels.slice(0, -1).join("、")}和${labels[labels.length - 1]}`;
}

/** Sentences after 「无法删除连接 <id>。」. Empty means confirmation may proceed. */
export function connectionDeleteBlockSentences(
  blockers: ConnectionDeleteBlocker[],
  deleteAssets: boolean
): string[] {
  const active = activeConnectionDeleteBlockers(blockers, deleteAssets);
  if (active.length === 0) return [];
  const labels = LABEL_ORDER.filter((label) =>
    active.some((blocker) => blocker.kind !== "semantic_asset" && HARD_LABELS[blocker.kind] === label)
  );
  const sentences: string[] = [];
  if (labels.length > 0) {
    sentences.push(`它仍被${joinLabels(labels)} 引用，需要先改掉这些引用。`);
  } else if (active.some((blocker) => blocker.kind !== "semantic_asset")) {
    sentences.push("它仍有引用，需要先改掉这些引用。");
  }
  if (active.some((blocker) => blocker.kind === "semantic_asset")) {
    sentences.push("本地语义文件可勾选「同时删除本地 YAML 资产」后一并删除。");
  }
  return sentences;
}

export function connectionDeleteBlockText(
  connectionId: string,
  blockers: ConnectionDeleteBlocker[],
  deleteAssets: boolean
): string | null {
  const sentences = connectionDeleteBlockSentences(blockers, deleteAssets);
  if (sentences.length === 0) return null;
  return `无法删除连接 ${connectionId}。${sentences.join("")}`;
}

export function connectionDeleteBlockersFromDetail(detail: unknown): ConnectionDeleteBlocker[] {
  if (!detail || typeof detail !== "object" || !("blockers" in detail)) return [];
  const blockers = (detail as { blockers?: unknown }).blockers;
  if (!Array.isArray(blockers)) return [];
  return blockers.filter(isConnectionDeleteBlocker);
}

export function messageForConnectionReferences(
  connectionId: string,
  detail: unknown,
  deleteAssets: boolean
): string {
  const fromDetail = connectionDeleteBlockText(
    connectionId,
    connectionDeleteBlockersFromDetail(detail),
    deleteAssets
  );
  if (fromDetail) return fromDetail;
  return `无法删除连接 ${connectionId}。它仍被角色、用户或业务 Wiki 引用，需要先改掉这些引用。本地语义文件可勾选「同时删除本地 YAML 资产」后一并删除。`;
}
