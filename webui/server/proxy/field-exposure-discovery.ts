/**
 * REQ-030-012 — Discovery-face helpers for mcp-proxy (keep mcp-proxy diffs local).
 *
 * 并行 P0-2 可能同改 mcp-proxy.ts：本模块承接裁剪逻辑，proxy 只做薄调用。
 */

import {
  admitSourceForDiscovery,
  applyDiscoveryTrim,
  FIELD_EXPOSURE_UNAVAILABLE,
  loadServingGeneration,
  rewriteExamples,
  type ActivatedSnapshot,
  type SourceRef
} from "./field-exposure.js";

export type DiscoveryAdmitResult =
  | { allow: true; snapshot: ActivatedSnapshot; source: SourceRef }
  | { allow: false; reason: typeof FIELD_EXPOSURE_UNAVAILABLE };

export async function admitReadSourceDiscovery(args: {
  connectionId?: string;
  schema?: string;
  sourceName?: string;
}): Promise<DiscoveryAdmitResult> {
  const snapshot = await loadServingGeneration();
  const connectionId = args.connectionId?.trim() ?? "";
  const schema = args.schema?.trim() ?? "";
  const sourceName = args.sourceName?.trim() ?? "";
  if (!connectionId || !schema || !sourceName) {
    // Incomplete identity: only fail if instance has trimmed／fault (conservative).
    const { snapshotHasAnyTrimmedOrExpectedFault } = await import("./field-exposure.js");
    if (snapshotHasAnyTrimmedOrExpectedFault(snapshot)) {
      return { allow: false, reason: FIELD_EXPOSURE_UNAVAILABLE };
    }
    return {
      allow: true,
      snapshot,
      source: { connectionId, schema, sourceName }
    };
  }
  const admitted = admitSourceForDiscovery(
    { connectionId, schema, sourceName },
    snapshot,
    "lucy_read_source"
  );
  if (!admitted.allow) {
    return { allow: false, reason: admitted.reason };
  }
  return {
    allow: true,
    snapshot,
    source: { connectionId, schema, sourceName }
  };
}

/**
 * Downlink trim for lucy_read_source / Hive column payloads.
 * On failure: returns denial body — NEVER the original full payload (D22／SC-22).
 */
export async function trimDiscoveryPayload(options: {
  toolName: string;
  payload: unknown;
  connectionId?: string;
  schema?: string;
  sourceName?: string;
  carrierKind?: "read_source_columns" | "hive_columns";
}): Promise<
  | { ok: true; payload: unknown; exposureDigest: string | null }
  | { ok: false; reason: typeof FIELD_EXPOSURE_UNAVAILABLE }
> {
  const snapshot = await loadServingGeneration();
  const connectionId = options.connectionId?.trim() ?? "";
  const schema = options.schema?.trim() ?? "";
  const sourceName = options.sourceName?.trim() ?? "";
  if (!connectionId || !sourceName) {
    // Incomplete identity: fail-closed when instance has trimmed／期望故障（D22／SC-21）。
    const { snapshotHasAnyTrimmedOrExpectedFault } = await import("./field-exposure.js");
    if (snapshotHasAnyTrimmedOrExpectedFault(snapshot)) {
      return { ok: false, reason: FIELD_EXPOSURE_UNAVAILABLE };
    }
    return { ok: true, payload: options.payload, exposureDigest: null };
  }
  const admitted = admitSourceForDiscovery(
    { connectionId, schema: schema || "_", sourceName },
    snapshot,
    options.toolName
  );
  if (!admitted.allow) {
    return { ok: false, reason: admitted.reason };
  }
  if (admitted.decision.fullInventory) {
    return {
      ok: true,
      payload: options.payload,
      exposureDigest: admitted.exposure.digest
    };
  }
  const trimmed = applyDiscoveryTrim(
    options.payload,
    admitted.decision,
    options.carrierKind ?? "read_source_columns"
  );
  if (!trimmed.ok) {
    return { ok: false, reason: trimmed.reason };
  }
  return {
    ok: true,
    payload: trimmed.payload,
    exposureDigest: admitted.exposure.digest
  };
}

export async function rewriteCatalogExamplesForExposure(
  examples: string[]
): Promise<string[]> {
  const snapshot = await loadServingGeneration();
  return rewriteExamples(examples, snapshot);
}
