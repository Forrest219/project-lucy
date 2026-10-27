import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { apiPost } from "./apiClient";
import type { TableGrant } from "./rolePermissionDraft";

/**
 * Lucy v0.25 (L25-14 §3.2 / §14.2) — the final-row-constraint preview (R2).
 *
 * Authority: docs/specs/lucy-20261022-v2p5-row-permission-management-spec.md
 *   §3.2, §14.2.1 (预览确认合同), §9 (V08–V13).
 *
 * The preview is read-only. It is the ONE place the Admin and the save entry
 * point get their confirmation from, so both use the SAME query key: React Query
 * de-duplicates them into a single request and the confirmation can never drift
 * away from the preview the user actually saw.
 */

/** The DNF predicate shape the preview returns. */
export type RowPolicyPreviewPredicate = {
  field: string;
  op: "eq" | "in";
  value?: string | number | boolean;
  values?: Array<string | number | boolean>;
};

/** The DNF grant shape the preview returns. */
export type RowPolicyPreviewGrant =
  | { kind: "all" }
  | { kind: "scoped"; digest?: string; orArms?: RowPolicyPreviewPredicate[][] }
  | null
  | undefined;

export type RowPolicyPreviewEntry = {
  requested: { connection: string; schema: string; name: string };
  catalog: {
    status: string;
    catalogLoaded: boolean;
    stage?: string;
    reason?: string;
    manifestPathDigest?: string;
    manifestContentDigest?: string;
    overlayContentDigest?: string;
    catalogCapability?: string;
    catalogCapabilityReason?: string;
  };
  preview?: {
    effectiveRowGrant?: RowPolicyPreviewGrant;
    roleIds?: string[];
    finalRowsByAgent?: Array<{ agentId: string; finalRows: RowPolicyPreviewGrant }>;
    displayShape?: string;
  };
  error?: { code: string; message: string; reason: string };
};

/**
 * Spec §14.2.1 — the save confirmation.
 *
 * It is signed only when EVERY affected table produced its final row
 * constraints, and it binds five independent digests that must never be
 * compared across levels.
 */
export type RowPolicyPreviewConfirmation = {
  vocabularyVersion: string;
  candidateDigest: string;
  baseAccessVersion: string;
  basePolicyVersion: string;
  compileInputsDigest: string;
  impactDigest: string;
  affectedTables: Array<{ connectionId: string; schema: string; sourceName: string }>;
  affectedAgentIds: string[];
};

export type RowPolicyPreviewResponse = {
  /** False when at least one table could not be previewed. */
  ok: boolean;
  /** Digest of the in-memory candidate the preview was computed from. */
  candidateDigest: string;
  /** The policy version the preview was based on. */
  basePolicyVersion: string;
  /** The save confirmation — present only when every affected table succeeded. */
  confirmation?: RowPolicyPreviewConfirmation;
  tables: RowPolicyPreviewEntry[];
};

/**
 * The preview query.
 *
 * It is shared by the row-policy panel (which renders the result) and the save
 * entry point (which has to carry the confirmation). Both use the same key, so
 * exactly one request is made.
 */
export function useRowPolicyPreview(params: {
  roleId?: string;
  /** The candidate Role (draft). The preview never reads the committed Role. */
  previewRole?: unknown;
  tables: TableGrant[];
}) {
  const { roleId, previewRole, tables } = params;
  const previewTables = useMemo(
    () => tables.map((table) => ({ connection: table.connection, schema: table.schema, name: table.name })),
    [tables]
  );
  return useQuery<RowPolicyPreviewResponse>({
    queryKey: ["row-policy-preview", roleId ?? "", previewRole ?? null, previewTables],
    queryFn: () =>
      apiPost<RowPolicyPreviewResponse>("/api/admin/roles/preview-row-policy", {
        roleId,
        role: previewRole,
        tables: previewTables
      }),
    enabled: Boolean(roleId) && previewTables.length > 0
  });
}
