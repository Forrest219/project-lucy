/**
 * Lucy publish workbench — the impact model (Spec
 * `docs/specs/lucy-20261030-publish-workbench-three-column-spec.md` §5.5).
 *
 * ONE RULE GOVERNS THIS MODULE
 * ----------------------------
 * The impact is computed on the SERVER from the same pending snapshot the
 * list, the validation, the confirmation and the submission use. The browser
 * never re-derives a table name from a file basename, and the count of
 * affected tables is never a guess.
 *
 * Consequences that are enforced here, not merely documented:
 *
 *   - A table's identity is `connectionId + schema + table`. Two tables that
 *     share a name in different connections are TWO entries, never merged.
 *   - A table that changed in both its overlay and its Schema Manifest is ONE
 *     entry with TWO reasons. It is counted once.
 *   - A Manifest counts only the tables that actually changed inside it. A
 *     Manifest that only changed at schema level is reported as a schema-level
 *     change, not inflated into a table count.
 *   - Wiki changes, schema-level changes and pure reference/validation
 *     dependencies are separate sections. They are not table changes.
 *   - When the range cannot be fully resolved, `complete` is false. An
 *     incomplete range is never dressed up as an exact confirmation.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { parse } from "yaml";
import { resolveContentPaths } from "./paths";
import {
  buildSemanticModelIndex,
  readSemanticJoinReferences,
  resolveSemanticDependencyClosure,
  semanticIdentityKey,
  type SemanticIdentityEntry,
  type SemanticModelIndex,
  type SemanticTableIdentity
} from "./semantic-identity";
import {
  readPublishBlob,
  readPublishBaseline,
  scanPublishContent,
  type PublishBaseline,
  type PublishContentFile,
  type PublishPendingSnapshot
} from "./publish-workbench-state";

// ─── Types ──────────────────────────────────────────────────────────────────

export type PublishImpactReasonKind =
  | "overlay_change"
  | "manifest_table_change"
  | "first_verification";

export type PublishImpactSource = "staged_candidate" | "pending_disk_change";

export interface PublishImpactReason {
  kind: PublishImpactReasonKind;
  /**
   * The reason this table is in this batch — evidence-supported, never a
   * generated business motive. "为了提升准确率" is not an acceptable value.
   */
  summary: string;
  source: PublishImpactSource;
  /** The logical (content-root relative) path of the file the reason comes from. */
  filePath: string;
  /** A server-constrained reference into the SAME snapshot. Never a client path. */
  evidenceRef: string;
}

export interface PublishImpactTable {
  identity: SemanticTableIdentity;
  reasons: PublishImpactReason[];
}

export interface PublishImpactWikiChange {
  filePath: string;
  title?: string;
  changeType: string;
}

export interface PublishImpactSchemaChange {
  connectionId: string;
  schema: string;
  evidenceRef: string;
}

export interface PublishImpactRelatedScope {
  identity: SemanticTableIdentity;
  relationKind: string;
  evidenceRef: string;
}

/**
 * A pending file that belongs to no table, no Schema Manifest and no business
 * Wiki. It is still part of the synced range and is still counted in
 * `counts.files` — it simply has no table identity.
 */
export interface PublishImpactOtherChange {
  filePath: string;
  changeType: string;
}

export interface PublishImpactUnresolved {
  filePath: string;
  reason: string;
  /**
   * True when the missing evidence makes the ACTUAL SYNC RANGE unknowable.
   * A blocking entry disables the submission. A non-blocking entry is
   * disclosed but does not block — a broken join reference, for example,
   * concerns the RELATED scope, not the range that will be synced.
   */
  blocking: boolean;
}

export interface PublishImpact {
  pendingDigest: string;
  planDigest?: string;
  /** False when the actual sync range could not be fully resolved. */
  complete: boolean;
  counts: { files: number; tables: number; manifests: number; wikiPages: number };
  tables: PublishImpactTable[];
  wikiChanges: PublishImpactWikiChange[];
  schemaChanges: PublishImpactSchemaChange[];
  relatedScope: PublishImpactRelatedScope[];
  otherChanges: PublishImpactOtherChange[];
  unresolved: PublishImpactUnresolved[];
}

// ─── Evidence references ────────────────────────────────────────────────────

export const EVIDENCE_PREFIX_DIFF = "diff:";
export const EVIDENCE_PREFIX_SNAPSHOT = "snapshot:";
export const EVIDENCE_PREFIX_BASELINE = "baseline:";

export function evidenceRefFor(logicalPath: string, kind: "diff" | "snapshot" | "baseline"): string {
  const prefix =
    kind === "diff" ? EVIDENCE_PREFIX_DIFF : kind === "snapshot" ? EVIDENCE_PREFIX_SNAPSHOT : EVIDENCE_PREFIX_BASELINE;
  return `${prefix}${logicalPath}`;
}

export type PublishEvidence =
  | { kind: "diff"; logicalPath: string; content: string }
  | { kind: "snapshot"; logicalPath: string; content: string }
  | { kind: "baseline"; logicalPath: string; content: string };

/**
 * Resolve an evidence reference against the CURRENT snapshot and baseline.
 *
 * The reference names a logical path that must be inside the current pending
 * set (or the current baseline). An unknown path resolves to `null` — the
 * server never reads an arbitrary path from a client-supplied string.
 */
export async function readPublishEvidence(
  projectRoot: string,
  reference: string
): Promise<PublishEvidence | null> {
  let kind: "diff" | "snapshot" | "baseline";
  let logicalPath: string;
  if (reference.startsWith(EVIDENCE_PREFIX_DIFF)) {
    kind = "diff";
    logicalPath = reference.slice(EVIDENCE_PREFIX_DIFF.length);
  } else if (reference.startsWith(EVIDENCE_PREFIX_SNAPSHOT)) {
    kind = "snapshot";
    logicalPath = reference.slice(EVIDENCE_PREFIX_SNAPSHOT.length);
  } else if (reference.startsWith(EVIDENCE_PREFIX_BASELINE)) {
    kind = "baseline";
    logicalPath = reference.slice(EVIDENCE_PREFIX_BASELINE.length);
  } else {
    return null;
  }
  if (!logicalPath || logicalPath.includes("..") || path.isAbsolute(logicalPath)) return null;

  const baseline = await readPublishBaseline(projectRoot);
  const baselineDigest = baseline?.files[logicalPath] ?? null;

  if (kind === "baseline") {
    if (!baselineDigest) return null;
    const bytes = await readPublishBlob(projectRoot, baselineDigest);
    if (!bytes) return null;
    return { kind, logicalPath, content: bytes.toString("utf8") };
  }

  const scan = await scanPublishContent(projectRoot);
  const current = scan.files.find((file) => file.logicalPath === logicalPath);

  if (kind === "snapshot") {
    if (!current) return null;
    const bytes = await readCurrentContent(projectRoot, logicalPath);
    if (!bytes) return null;
    return { kind, logicalPath, content: bytes.toString("utf8") };
  }

  const baselineBytes = baselineDigest ? await readPublishBlob(projectRoot, baselineDigest) : null;
  const currentBytes = current ? await readCurrentContent(projectRoot, logicalPath) : null;

  if (!currentBytes) {
    // The file is gone. The previous version still exists, so the honest
    // answer is what was removed — not an empty diff.
    if (!baselineBytes) return null;
    return {
      kind: "diff",
      logicalPath,
      content: buildUnifiedDiff(logicalPath, baselineBytes.toString("utf8"), "")
    };
  }

  if (!baselineBytes) {
    // No trustworthy previous version: the honest answer is "no comparable
    // previous version", not a diff against an empty string.
    return {
      kind: "diff",
      logicalPath,
      content: "暂无可比较的生效版本。\n"
    };
  }
  return {
    kind: "diff",
    logicalPath,
    content: buildUnifiedDiff(logicalPath, baselineBytes.toString("utf8"), currentBytes.toString("utf8"))
  };
}

async function readCurrentContent(
  projectRoot: string,
  logicalPath: string
): Promise<Buffer | null> {
  const paths = await resolveContentPaths(projectRoot);
  const roots: Array<[string, string]> = [
    ["semantic-layer/", paths.semanticLayer],
    ["wiki/", paths.wiki]
  ];
  for (const [prefix, root] of roots) {
    if (!logicalPath.startsWith(prefix)) continue;
    try {
      return await readFile(path.join(root, logicalPath.slice(prefix.length)));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }
  return null;
}

function buildUnifiedDiff(filePath: string, before: string, after: string): string {
  const beforeLines = before.split("\n");
  const afterLines = after.split("\n");
  const lines: string[] = [`--- ${filePath}（生效版本）`, `+++ ${filePath}（当前内容）`];
  const max = Math.max(beforeLines.length, afterLines.length);
  for (let index = 0; index < max; index += 1) {
    const oldLine = beforeLines[index];
    const newLine = afterLines[index];
    if (oldLine === newLine) {
      if (oldLine !== undefined) lines.push(` ${oldLine}`);
      continue;
    }
    if (oldLine !== undefined) lines.push(`-${oldLine}`);
    if (newLine !== undefined) lines.push(`+${newLine}`);
  }
  return `${lines.join("\n")}\n`;
}

// ─── YAML diffing ───────────────────────────────────────────────────────────

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function parseYamlOrNull(text: string | null): Record<string, unknown> | null {
  if (text === null) return null;
  try {
    const parsed = parse(text);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

interface NamedItem {
  name: string;
  body: unknown;
}

function namedItems(value: unknown): Map<string, NamedItem> {
  const map = new Map<string, NamedItem>();
  if (!Array.isArray(value)) return map;
  for (const raw of value) {
    const record = asRecord(raw);
    const name = typeof record.name === "string" ? record.name : "";
    if (!name) continue;
    map.set(name, { name, body: record });
  }
  return map;
}

function stableJson(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
    .join(",")}}`;
}

/**
 * Summarize what actually changed in a named list (measures / columns /
 * segments / joins). The summary names the concrete items; it never invents a
 * business motive.
 */
export function diffNamedList(
  before: unknown,
  after: unknown,
  labels: { added: string; removed: string; changed: string }
): string[] {
  const beforeItems = namedItems(before);
  const afterItems = namedItems(after);
  const summaries: string[] = [];

  for (const [name, item] of afterItems) {
    const previous = beforeItems.get(name);
    if (!previous) {
      summaries.push(`${labels.added} ${name}`);
      continue;
    }
    if (stableJson(previous.body) !== stableJson(item.body)) {
      summaries.push(`${labels.changed} ${name}`);
    }
  }
  for (const name of beforeItems.keys()) {
    if (!afterItems.has(name)) summaries.push(`${labels.removed} ${name}`);
  }
  return summaries;
}

const OVERLAY_SECTIONS: Array<{
  key: string;
  added: string;
  removed: string;
  changed: string;
}> = [
  { key: "measures", added: "新增指标", removed: "删除指标", changed: "指标定义变更" },
  { key: "columns", added: "新增维度", removed: "删除维度", changed: "维度定义变更" },
  { key: "segments", added: "新增筛选", removed: "删除筛选", changed: "筛选定义变更" },
  { key: "joins", added: "新增关联", removed: "删除关联", changed: "关联定义变更" }
];

/** Summarize the concrete changes inside one overlay file. */
export function diffOverlay(
  beforeText: string | null,
  afterText: string | null
): { summaries: string[]; parseFailed: boolean } {
  const before = parseYamlOrNull(beforeText);
  const after = parseYamlOrNull(afterText);
  if (!before || !after) {
    return { summaries: [], parseFailed: true };
  }
  const summaries: string[] = [];
  for (const section of OVERLAY_SECTIONS) {
    summaries.push(
      ...diffNamedList(before[section.key], after[section.key], {
        added: section.added,
        removed: section.removed,
        changed: section.changed
      })
    );
  }
  const beforeGrain = stableJson(before.grain);
  const afterGrain = stableJson(after.grain);
  if (beforeGrain !== afterGrain) summaries.push("粒度定义变更");
  return { summaries, parseFailed: false };
}

/** Summarize the concrete changes inside one Schema Manifest table entry. */
export function diffManifestTable(
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null
): string[] {
  const summaries: string[] = [];
  if (!before && !after) return summaries;
  if (!before) return ["新增表"];
  if (!after) return ["已删除表"];

  if (before.table !== after.table) {
    summaries.push(`物理表名变更（${String(before.table ?? "")} → ${String(after.table ?? "")}）`);
  }

  const beforeColumns = namedItems(before.columns);
  const afterColumns = namedItems(after.columns);
  for (const [name, item] of afterColumns) {
    const previous = beforeColumns.get(name);
    if (!previous) {
      summaries.push(`新增字段 ${name}`);
      continue;
    }
    const previousRecord = asRecord(previous.body);
    const currentRecord = asRecord(item.body);
    if (previousRecord.type !== currentRecord.type) {
      summaries.push(`字段类型变更 ${name}`);
    }
    if (Boolean(previousRecord.pk) !== Boolean(currentRecord.pk)) {
      summaries.push(`主键标记变更 ${name}`);
    }
    if (previousRecord.nullable !== currentRecord.nullable) {
      summaries.push(`可空性变更 ${name}`);
    }
    if (stableJson(previousRecord.descriptions) !== stableJson(currentRecord.descriptions)) {
      summaries.push(`字段描述变更 ${name}`);
    }
  }
  for (const name of beforeColumns.keys()) {
    if (!afterColumns.has(name)) summaries.push(`删除字段 ${name}`);
  }
  return summaries;
}

// ─── Path helpers ───────────────────────────────────────────────────────────

const OVERLAY_PATH_RE = /^semantic-layer\/([^/]+)\/([^/]+)\.ya?ml$/i;
const MANIFEST_PATH_RE = /^semantic-layer\/([^/]+)\/_schema\/([^/]+)\.ya?ml$/i;

export function isManifestLogicalPath(logicalPath: string): boolean {
  return MANIFEST_PATH_RE.test(logicalPath);
}

export function isWikiLogicalPath(logicalPath: string): boolean {
  return logicalPath.startsWith("wiki/");
}

export function isOverlayLogicalPath(logicalPath: string): boolean {
  if (isManifestLogicalPath(logicalPath)) return false;
  return OVERLAY_PATH_RE.test(logicalPath);
}

function wikiTitle(filePath: string, content: string | null): string | undefined {
  if (content) {
    const heading = content.split("\n").find((line) => /^#\s+\S/.test(line));
    if (heading) return heading.replace(/^#\s+/, "").trim();
  }
  const name = filePath.split("/").pop() ?? filePath;
  return name.replace(/\.md$/i, "");
}

// ─── Builder ────────────────────────────────────────────────────────────────

export interface PublishImpactOptions {
  projectRoot: string;
  snapshot: PublishPendingSnapshot;
  /** The proven baseline. `null` on first verification. */
  baseline?: PublishBaseline | null;
  /** Pre-built model index; built from disk when omitted. */
  modelIndex?: SemanticModelIndex;
  /** The staged batch plan digest, when this impact belongs to a staged batch. */
  planDigest?: string;
  /** Logical paths that came from a staged import rather than from disk changes. */
  stagedPaths?: ReadonlySet<string>;
}

interface ReasonBucket {
  identity: SemanticTableIdentity;
  reasons: PublishImpactReason[];
}

export async function buildPublishImpact(
  options: PublishImpactOptions
): Promise<PublishImpact> {
  const { projectRoot, snapshot } = options;
  const baseline = options.baseline === undefined ? await readPublishBaseline(projectRoot) : options.baseline;
  const modelIndex = options.modelIndex ?? (await buildSemanticModelIndex(projectRoot));
  const stagedPaths = options.stagedPaths ?? new Set<string>();

  const unresolvedEntries: PublishImpactUnresolved[] = [];
  const buckets = new Map<string, ReasonBucket>();
  const wikiChanges: PublishImpactWikiChange[] = [];
  const schemaChanges: PublishImpactSchemaChange[] = [];
  const otherChanges: PublishImpactOtherChange[] = [];
  const manifestPaths = new Set<string>();
  const wikiPaths = new Set<string>();

  const firstVerification = snapshot.baselineState === "uninitialized";

  const addReason = (
    identity: SemanticTableIdentity,
    reason: PublishImpactReason
  ): void => {
    const key = semanticIdentityKey(identity);
    const bucket = buckets.get(key) ?? { identity, reasons: [] };
    const duplicate = bucket.reasons.some(
      (existing) =>
        existing.kind === reason.kind &&
        existing.filePath === reason.filePath &&
        existing.summary === reason.summary
    );
    if (!duplicate) bucket.reasons.push(reason);
    buckets.set(key, bucket);
  };

  const sourceFor = (logicalPath: string): PublishImpactSource =>
    stagedPaths.has(logicalPath) ? "staged_candidate" : "pending_disk_change";

  // ── Wiki ──────────────────────────────────────────────────────────────────
  for (const change of snapshot.changes) {
    if (!isWikiLogicalPath(change.logicalPath)) continue;
    wikiPaths.add(change.logicalPath);
    const content = await readCurrentContent(projectRoot, change.logicalPath);
    wikiChanges.push({
      filePath: change.logicalPath,
      title: wikiTitle(change.logicalPath, content ? content.toString("utf8") : null),
      changeType: change.changeType
    });
  }

  // ── Overlays ──────────────────────────────────────────────────────────────
  for (const change of snapshot.changes) {
    if (!isOverlayLogicalPath(change.logicalPath)) continue;
    const owners = modelIndex.overlayOwners.get(change.logicalPath) ?? [];
    if (owners.length === 0) {
      unresolvedEntries.push({
        filePath: change.logicalPath,
        reason: "该语义文件未在 Schema Manifest 中登记，无法解析完整表身份，需人工核对。",
        blocking: true
      });
      continue;
    }
    if (owners.length > 1) {
      unresolvedEntries.push({
        filePath: change.logicalPath,
        reason: `该语义文件对应多个表身份（${owners.join("、")}），无法确定归属，需人工核对。`,
        blocking: true
      });
      continue;
    }
    const entry = modelIndex.byKey.get(owners[0]!);
    if (!entry) {
      unresolvedEntries.push({
        filePath: change.logicalPath,
        reason: "模型索引缺少该表身份，无法解析完整表身份，需人工核对。",
        blocking: true
      });
      continue;
    }

    let summary: string;
    if (firstVerification) {
      summary = "首次核对：尚无完整生效基线，本次为该表的首次发布核对。";
    } else {
      const beforeText = change.baselineDigest
        ? (await readPublishBlob(projectRoot, change.baselineDigest))?.toString("utf8") ?? null
        : null;
      const afterText = (await readCurrentContent(projectRoot, change.logicalPath))?.toString("utf8") ?? null;
      const diff = diffOverlay(beforeText, afterText);
      if (diff.parseFailed) {
        // The file cannot be parsed at all. A generic "content changed" note
        // would hide an unreadable file behind a plausible-looking reason, so
        // the range stays unresolved and the submission is blocked.
        unresolvedEntries.push({
          filePath: change.logicalPath,
          reason: "表语义文件无法解析，无法给出有证据的纳入原因，影响范围待核对。",
          blocking: true
        });
        continue;
      }
      summary = diff.summaries.length > 0 ? diff.summaries.join("；") : "表语义文件内容变更";
    }

    addReason(entry.identity, {
      kind: firstVerification ? "first_verification" : "overlay_change",
      summary,
      source: sourceFor(change.logicalPath),
      filePath: change.logicalPath,
      evidenceRef: evidenceRefFor(change.logicalPath, "diff")
    });
  }

  // ── Schema Manifests ──────────────────────────────────────────────────────
  for (const change of snapshot.changes) {
    if (!isManifestLogicalPath(change.logicalPath)) continue;
    manifestPaths.add(change.logicalPath);
    const match = MANIFEST_PATH_RE.exec(change.logicalPath);
    if (!match) {
      unresolvedEntries.push({
        filePath: change.logicalPath,
        reason: "Schema Manifest 路径无法解析连接与 Schema。",
        blocking: true
      });
      continue;
    }
    const [, connectionId, schema] = match;

    if (firstVerification) {
      schemaChanges.push({
        connectionId,
        schema,
        evidenceRef: evidenceRefFor(change.logicalPath, "snapshot")
      });
      continue;
    }

    const beforeText = change.baselineDigest
      ? (await readPublishBlob(projectRoot, change.baselineDigest))?.toString("utf8") ?? null
      : null;
    const afterText = (await readCurrentContent(projectRoot, change.logicalPath))?.toString("utf8") ?? null;
    const beforeDoc = parseYamlOrNull(beforeText);
    const afterDoc = parseYamlOrNull(afterText);
    if (!beforeDoc || !afterDoc) {
      unresolvedEntries.push({
        filePath: change.logicalPath,
        reason: "Schema Manifest 无法解析，无法逐表比较，影响范围待核对。",
        blocking: true
      });
      continue;
    }

    const beforeTables = asRecord(beforeDoc.tables);
    const afterTables = asRecord(afterDoc.tables);
    const tableNames = new Set([...Object.keys(beforeTables), ...Object.keys(afterTables)]);
    let perTableChanged = false;

    for (const tableName of [...tableNames].sort()) {
      const beforeTable = tableName in beforeTables ? asRecord(beforeTables[tableName]) : null;
      const afterTable = tableName in afterTables ? asRecord(afterTables[tableName]) : null;
      const summaries = diffManifestTable(beforeTable, afterTable);
      if (summaries.length === 0) continue;
      perTableChanged = true;

      const identity = modelIndex.entries.find(
        (entry) =>
          entry.identity.connectionId === connectionId &&
          entry.identity.schema === schema &&
          entry.identity.table === tableName
      );
      if (!identity) {
        unresolvedEntries.push({
          filePath: change.logicalPath,
          reason: `Manifest 中的表 ${tableName} 无法在模型中解析出完整身份，需人工核对。`,
          blocking: true
        });
        continue;
      }
      addReason(identity.identity, {
        kind: "manifest_table_change",
        summary: summaries.join("；"),
        source: sourceFor(change.logicalPath),
        filePath: change.logicalPath,
        evidenceRef: evidenceRefFor(change.logicalPath, "diff")
      });
    }

    if (!perTableChanged) {
      // The Manifest changed, but not any single table inside it. Report it as
      // a schema-level change instead of inflating the table count.
      schemaChanges.push({
        connectionId,
        schema,
        evidenceRef: evidenceRefFor(change.logicalPath, "diff")
      });
    }
  }

  // ── Anything else ─────────────────────────────────────────────────────────
  for (const change of snapshot.changes) {
    if (
      isWikiLogicalPath(change.logicalPath) ||
      isOverlayLogicalPath(change.logicalPath) ||
      isManifestLogicalPath(change.logicalPath)
    ) {
      continue;
    }
    otherChanges.push({ filePath: change.logicalPath, changeType: change.changeType });
  }

  // ── Related scope (references / validation dependencies) ─────────────────
  const relatedScope: PublishImpactRelatedScope[] = [];
  const relatedSeen = new Set<string>();
  const selected = [...buckets.values()].map((bucket) => bucket.identity);
  if (selected.length > 0) {
    try {
      const closure = await resolveSemanticDependencyClosure(projectRoot, modelIndex, selected);
      for (const dependency of closure.dependencies) {
        const key = semanticIdentityKey(dependency.identity);
        if (buckets.has(key)) continue;
        if (relatedSeen.has(key)) continue;
        relatedSeen.add(key);
        relatedScope.push({
          identity: dependency.identity,
          relationKind: dependency.relation,
          evidenceRef: evidenceRefFor(
            `semantic-layer/${dependency.referencedFrom.connectionId}/${dependency.referencedFrom.table}.yaml`,
            "snapshot"
          )
        });
      }
    } catch (error) {
      // A broken join reference concerns the RELATED scope, not the range that
      // will be synced. It is disclosed but does not block the submission.
      unresolvedEntries.push({
        filePath: "",
        reason:
          error instanceof Error
            ? `关联与校验范围解析失败：${error.message}`
            : "关联与校验范围解析失败，需人工核对。",
        blocking: false
      });
    }
  }

  const tables = [...buckets.values()]
    .map((bucket) => ({ identity: bucket.identity, reasons: bucket.reasons }))
    .sort((a, b) => semanticIdentityKey(a.identity).localeCompare(semanticIdentityKey(b.identity)));

  const complete =
    snapshot.complete && !unresolvedEntries.some((entry) => entry.blocking);

  return {
    pendingDigest: snapshot.pendingDigest,
    ...(options.planDigest ? { planDigest: options.planDigest } : {}),
    complete,
    counts: {
      files: snapshot.changes.length,
      tables: tables.length,
      manifests: manifestPaths.size,
      wikiPages: wikiPaths.size
    },
    tables,
    wikiChanges,
    schemaChanges,
    relatedScope,
    otherChanges,
    unresolved: unresolvedEntries
  };
}

/**
 * The join references declared by one table, used by the UI to explain why a
 * table appears under 「关联与校验范围」.
 */
export async function readImpactJoinReferences(
  projectRoot: string,
  modelIndex: SemanticModelIndex,
  identity: SemanticTableIdentity
): Promise<string[]> {
  const key = semanticIdentityKey(identity);
  const entry: SemanticIdentityEntry | undefined = modelIndex.byKey.get(key);
  if (!entry) return [];
  try {
    return await readSemanticJoinReferences(projectRoot, entry);
  } catch {
    return [];
  }
}

export type { PublishContentFile };
