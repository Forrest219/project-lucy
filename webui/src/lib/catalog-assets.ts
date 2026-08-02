import { apiGet, apiPost } from "./apiClient";
import type {
  CatalogAssetUploadsResponse,
  CatalogAssetUploadRequest,
  CatalogAssetUploadResponse,
  CatalogSchemaManifestReadResponse,
  CatalogAssetValidateRequest,
  CatalogAssetValidateResponse
} from "./types";

// Thin wrappers around the controlled YAML upload endpoints. The backend is
// the source of truth for target paths, overwrite protection, and the static
// catalog reload; we only assemble the JSON payload.

export async function validateCatalogAsset(
  input: CatalogAssetValidateRequest
): Promise<CatalogAssetValidateResponse> {
  return apiPost<CatalogAssetValidateResponse>("/api/catalog/assets/validate", input);
}

export async function uploadCatalogAsset(
  input: CatalogAssetUploadRequest
): Promise<CatalogAssetUploadResponse> {
  return apiPost<CatalogAssetUploadResponse>("/api/catalog/assets/upload", input);
}

export async function fetchCatalogAssetUploads(): Promise<CatalogAssetUploadsResponse> {
  return apiGet<CatalogAssetUploadsResponse>("/api/catalog/assets/uploads");
}

export async function fetchCatalogSchemaManifest(
  connectionId: string,
  schema: string
): Promise<CatalogSchemaManifestReadResponse> {
  const params = new URLSearchParams({ connectionId, schema });
  return apiGet<CatalogSchemaManifestReadResponse>(
    `/api/catalog/assets/schema-manifest?${params.toString()}`
  );
}
