/**
 * Lucy v0.25 (L25-14 §14.2) — the row-policy save confirmation contract (R2).
 *
 * Authority: docs/specs/lucy-20261022-v2p5-row-permission-management-spec.md
 *   §14.2.1 (预览确认合同), §14.2.2 (规范性预览与保存流程), §14.6 (V08–V13),
 *   §3.2 (R2 最终行约束预览).
 *
 * Contract:
 * - A standalone preview signs a confirmation ONLY when every affected table
 *   produced its final row constraints. A failed table may be reported as a
 *   diagnostic, but never as material a save could accept.
 * - The confirmation binds FIVE independent digests. They live on different
 *   levels and must never be compared across levels:
 *   · `candidateDigest`      — the whole in-memory access candidate,
 *   · `baseAccessVersion`    — the access.yaml CAS baseline,
 *   · `basePolicyVersion`    — the runtime policy input baseline,
 *   · `compileInputsDigest`  — every non-access compile input,
 *   · `impactDigest`         — the normalized affected table / Agent sets.
 * - A write entry point that can change a row policy MUST consume the
 *   confirmation and must re-derive every digest INSIDE the shared publish
 *   window. The server never trusts the table / Agent list the client echoes
 *   back — it recomputes and compares all of them.
 * - A missing confirmation, a failed preview, a changed candidate, a changed
 *   baseline or a changed impact surface is rejected with HTTP 409 /
 *   `ROW_POLICY_PREVIEW_REQUIRED`, and the rejection happens BEFORE the durable
 *   intent and before any configuration write: zero configuration write, zero
 *   row-policy intent.
 */
import { sha256Hex, stableJson } from "../config-digest.js";

/**
 * Version of the confirmation vocabulary.
 *
 * Bumped when the SHAPE of the confirmation changes in a way that invalidates an
 * already-issued confirmation.
 */
export const ROW_POLICY_CONFIRMATION_VOCABULARY_VERSION = "v0.25-row-policy-confirmation-1";

/** The table a preview / impact is computed for: connection / schema / table. */
export interface RowPolicyConfirmationTable {
  connectionId: string;
  schema: string;
  sourceName: string;
}

export interface RowPolicyPreviewConfirmation {
  vocabularyVersion: string;
  /** Digest of the draft-overlaid in-memory access candidate. */
  candidateDigest: string;
  /** The access.yaml version the preview was based on (the CAS baseline). */
  baseAccessVersion: string;
  /** The runtime policy input baseline the preview was based on. */
  basePolicyVersion: string;
  /** Digest of every non-access compile input that took part. */
  compileInputsDigest: string;
  /** Digest of the normalized affected table / Agent sets. */
  impactDigest: string;
  /** The COMPLETE affected table set, sorted and de-duplicated. */
  affectedTables: RowPolicyConfirmationTable[];
  /** The COMPLETE affected Agent set, sorted and de-duplicated. */
  affectedAgentIds: string[];
}

/**
 * The rejection reasons the save path may report.
 *
 * `detail.reason` distinguishes them so the Admin UI can say what to do next.
 */
export type RowPolicyPreviewRejectionReason =
  | "missing"
  | "preview_failed"
  | "candidate_mismatch"
  | "baseline_changed"
  | "compile_inputs_changed"
  | "impact_changed";

export const ROW_POLICY_PREVIEW_REQUIRED_CODE = "ROW_POLICY_PREVIEW_REQUIRED";

export interface RowPolicyPreviewRejection {
  reason: RowPolicyPreviewRejectionReason;
  message: string;
  /** Optional extra facts (the expected / actual digest, the failing table). */
  detail?: Record<string, unknown>;
}

/**
 * Canonical table identity key. The table identity is normalized, so the same
 * table always produces the same key no matter how the caller spelled it.
 */
export function rowPolicyTableKey(table: RowPolicyConfirmationTable): string {
  return `${table.connectionId.trim().toLowerCase()}\u0000${table.schema.trim().toLowerCase()}\u0000${table.sourceName
    .trim()
    .toLowerCase()}`;
}

/** Sort + de-duplicate a table set into its canonical form. */
export function normalizeAffectedTables(
  tables: RowPolicyConfirmationTable[]
): RowPolicyConfirmationTable[] {
  const byKey = new Map<string, RowPolicyConfirmationTable>();
  for (const table of tables) {
    const connectionId = table.connectionId.trim().toLowerCase();
    const schema = table.schema.trim().toLowerCase();
    const sourceName = table.sourceName.trim().toLowerCase();
    if (!connectionId || !schema || !sourceName) continue;
    const normalized: RowPolicyConfirmationTable = { connectionId, schema, sourceName };
    byKey.set(rowPolicyTableKey(normalized), normalized);
  }
  return [...byKey.values()].sort((a, b) => rowPolicyTableKey(a).localeCompare(rowPolicyTableKey(b)));
}

/** Sort + de-duplicate an Agent id set into its canonical form. */
export function normalizeAffectedAgentIds(agentIds: string[]): string[] {
  return [...new Set(agentIds.map((id) => id.trim()).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b)
  );
}

/**
 * The impact digest.
 *
 * It binds the SORTED, DE-DUPLICATED affected table set AND the affected Agent
 * set. The table / Agent list is derived from the before / after configuration
 * and the Agent Role Sets — never from what the client echoed back.
 */
export function digestImpact(impact: {
  tables: RowPolicyConfirmationTable[];
  agentIds: string[];
}): string {
  return sha256Hex(
    stableJson({
      vocabulary: ROW_POLICY_CONFIRMATION_VOCABULARY_VERSION,
      tables: normalizeAffectedTables(impact.tables),
      agentIds: normalizeAffectedAgentIds(impact.agentIds)
    })
  );
}

/**
 * The compile-inputs digest.
 *
 * It must cover EVERY non-access input that took part in the compilation:
 * the source map and its version, the enabled-table set and its digest, the tool
 * classification version, the ACTUAL CONTENT digest of each affected table's
 * Schema Manifest, the ACTUAL CONTENT digest of the overlay that took part in
 * the compilation, and the server-resolved catalog capability.
 *
 * A path digest is not enough: the file may have been rewritten in place.
 */
export function digestCompileInputs(inputs: {
  sourceMapVersion: string;
  enabledTablesDigest: string;
  toolClassificationVersion: string;
  tables: Array<{
    connectionId: string;
    schema: string;
    sourceName: string;
    manifestContentDigest: string;
    overlayContentDigest?: string;
    catalogCapability: string;
    catalogCapabilityReason: string;
  }>;
}): string {
  const tables = inputs.tables
    .map((table) => ({
      connectionId: table.connectionId.trim().toLowerCase(),
      schema: table.schema.trim().toLowerCase(),
      sourceName: table.sourceName.trim().toLowerCase(),
      manifestContentDigest: table.manifestContentDigest,
      overlayContentDigest: table.overlayContentDigest ?? "",
      catalogCapability: table.catalogCapability,
      catalogCapabilityReason: table.catalogCapabilityReason
    }))
    .sort((a, b) =>
      `${a.connectionId}\u0000${a.schema}\u0000${a.sourceName}`.localeCompare(
        `${b.connectionId}\u0000${b.schema}\u0000${b.sourceName}`
      )
    );
  return sha256Hex(
    stableJson({
      vocabulary: ROW_POLICY_CONFIRMATION_VOCABULARY_VERSION,
      sourceMapVersion: inputs.sourceMapVersion,
      enabledTablesDigest: inputs.enabledTablesDigest,
      toolClassificationVersion: inputs.toolClassificationVersion,
      tables
    })
  );
}

/**
 * Parse an untrusted confirmation off the wire.
 *
 * Returns `undefined` when the payload is missing or does not carry every
 * required field — the save path then rejects with `missing`.
 */
export function parseRowPolicyConfirmation(raw: unknown): RowPolicyPreviewConfirmation | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const record = raw as Record<string, unknown>;
  const vocabularyVersion = record.vocabularyVersion;
  const candidateDigest = record.candidateDigest;
  const baseAccessVersion = record.baseAccessVersion;
  const basePolicyVersion = record.basePolicyVersion;
  const compileInputsDigest = record.compileInputsDigest;
  const impactDigest = record.impactDigest;
  const affectedTables = record.affectedTables;
  const affectedAgentIds = record.affectedAgentIds;

  if (typeof vocabularyVersion !== "string" || !vocabularyVersion.trim()) return undefined;
  if (typeof candidateDigest !== "string" || !candidateDigest.trim()) return undefined;
  if (typeof baseAccessVersion !== "string" || !baseAccessVersion.trim()) return undefined;
  if (typeof basePolicyVersion !== "string" || !basePolicyVersion.trim()) return undefined;
  if (typeof compileInputsDigest !== "string" || !compileInputsDigest.trim()) return undefined;
  if (typeof impactDigest !== "string" || !impactDigest.trim()) return undefined;
  if (!Array.isArray(affectedTables)) return undefined;
  if (!Array.isArray(affectedAgentIds)) return undefined;
  if (!affectedAgentIds.every((id) => typeof id === "string")) return undefined;

  const tables: RowPolicyConfirmationTable[] = [];
  for (const item of affectedTables) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return undefined;
    const entry = item as Record<string, unknown>;
    if (typeof entry.connectionId !== "string") return undefined;
    if (typeof entry.schema !== "string") return undefined;
    if (typeof entry.sourceName !== "string") return undefined;
    tables.push({
      connectionId: entry.connectionId,
      schema: entry.schema,
      sourceName: entry.sourceName
    });
  }

  return {
    vocabularyVersion,
    candidateDigest,
    baseAccessVersion,
    basePolicyVersion,
    compileInputsDigest,
    impactDigest,
    affectedTables: tables,
    affectedAgentIds: affectedAgentIds as string[]
  };
}

/** Human-readable explanation for each rejection reason. */
export function describeRowPolicyPreviewRejection(reason: RowPolicyPreviewRejectionReason): string {
  switch (reason) {
    case "missing":
      return "保存前必须先取得最终行约束预览确认；缺少确认，本次未写入任何配置。";
    case "preview_failed":
      return "最终行约束预览未通过，保存已被拒绝；本次未写入任何配置。";
    case "candidate_mismatch":
      return "待保存的角色与预览时的候选不一致，请重新预览后再保存。";
    case "baseline_changed":
      return "预览基线已变化（access.yaml 或运行策略输入），请重新预览后再保存。";
    case "compile_inputs_changed":
      return "编译输入已变化（源映射／启用表／清单／overlay／工具分类／目录能力），请重新预览后再保存。";
    case "impact_changed":
      return "受影响表或 Agent 集合已变化，请重新预览后再保存。";
  }
}
