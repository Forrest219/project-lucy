import { apiGet, apiPost } from "./apiClient";
import type {
  SemanticAssetExportRequest,
  SemanticAssetExportResponse,
  SemanticAssetPublishRequest,
  SemanticAssetPublishResponse,
  SemanticAssetReleasesResponse,
  SemanticAssetReleaseStatusResponse,
  SemanticAssetValidateRequest,
  SemanticAssetValidateResponse
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
