import { apiGet, apiPost } from "./apiClient";
import type {
  SemanticAssetExportRequest,
  SemanticAssetExportResponse,
  SemanticAssetPublishRequest,
  SemanticAssetPublishResponse,
  SemanticAssetReleasesResponse,
  SemanticAssetReleaseStatusResponse,
  SemanticAssetValidateRequest,
  SemanticAssetValidateResponse,
  SemanticBatchCheckAccepted,
  SemanticBatchOperation,
  SemanticMaintenanceExportResponse,
  SemanticScopeResponse,
  SemanticTableIdentity
} from "./types";

// Thin wrappers around the M19 self-service publish / export endpoints.
// The backend is the source of truth for target paths, overwrite protection,
// staging validation, and redaction. We only assemble the JSON payload.

export async function validateSemanticAssets(
  input: SemanticAssetValidateRequest
): Promise<SemanticAssetValidateResponse> {
  return apiPost<SemanticAssetValidateResponse>("/api/semantic-assets/validate", input);
}

export async function publishSemanticAssets(
  input: SemanticAssetPublishRequest
): Promise<SemanticAssetPublishResponse> {
  return apiPost<SemanticAssetPublishResponse>("/api/semantic-assets/publish", input);
}

export async function fetchSemanticAssetReleases(): Promise<SemanticAssetReleasesResponse> {
  return apiGet<SemanticAssetReleasesResponse>("/api/semantic-assets/releases");
}

export async function fetchSemanticAssetReleaseStatus(
  releaseId: string
): Promise<SemanticAssetReleaseStatusResponse> {
  return apiGet<SemanticAssetReleaseStatusResponse>(
    `/api/semantic-assets/releases/${encodeURIComponent(releaseId)}/status`
  );
}

export async function exportSemanticAssetPackage(
  input: SemanticAssetExportRequest
): Promise<SemanticAssetExportResponse> {
  return apiPost<SemanticAssetExportResponse>("/api/semantic-assets/export", input);
}

// ─── Lucy v0.25 / L25-11: the semantic batch loop ───────────────────────────

/**
 * Resolve a selection into an immutable scope snapshot.
 *
 * The client sends FULL table identities — never a target path. The server
 * computes every target and refuses an ambiguous or missing identity.
 */
export async function createSemanticScope(input: {
  refs: SemanticTableIdentity[];
}): Promise<SemanticScopeResponse> {
  return apiPost<SemanticScopeResponse>("/api/semantic-assets/scopes", input);
}

/** Start an independent batch validation. The task runs in the background. */
export async function startSemanticBatchCheck(input: {
  scopeId: string;
}): Promise<SemanticBatchCheckAccepted> {
  return apiPost<SemanticBatchCheckAccepted>("/api/semantic-assets/check", input);
}

/** Poll a batch operation. This never re-runs the check. */
export async function fetchSemanticBatchOperation(
  operationId: string
): Promise<SemanticBatchOperation> {
  return apiGet<SemanticBatchOperation>(
    `/api/semantic-assets/operations/${encodeURIComponent(operationId)}`
  );
}

/** Cancel a running batch check. The completed results are kept. */
export async function cancelSemanticBatchOperation(
  operationId: string
): Promise<SemanticBatchOperation> {
  return apiPost<SemanticBatchOperation>(
    `/api/semantic-assets/operations/${encodeURIComponent(operationId)}/cancel`,
    {}
  );
}

/** Build a `semantic-maintenance-package/v1` from a scope snapshot. */
export async function exportSemanticMaintenancePackage(input: {
  scopeId: string;
}): Promise<SemanticMaintenanceExportResponse> {
  return apiPost<SemanticMaintenanceExportResponse>("/api/semantic-assets/export", {
    packageKind: "semantic-maintenance-package/v1",
    scopeId: input.scopeId
  });
}
