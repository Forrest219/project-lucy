import { useQuery } from "@tanstack/react-query";
import { apiGet } from "./apiClient";
import { BRANDING_QUERY_KEY, type BrandingInfo } from "./branding";

const FALLBACK: BrandingInfo = {
  productTitle: "Lucy WebUI",
  tagline: "Data Agent MCP",
  productTitleOverride: "",
  taglineOverride: "",
  hasCustomLogo: false,
  logoUrl: null,
  logoContentType: null,
  logoWidth: null,
  logoHeight: null,
  updatedAt: null,
  defaults: {
    productTitle: "Lucy WebUI",
    tagline: "Data Agent MCP"
  }
};

export function useBranding() {
  return useQuery({
    queryKey: BRANDING_QUERY_KEY,
    queryFn: () => apiGet<BrandingInfo>("/api/branding"),
    staleTime: 30_000,
    placeholderData: FALLBACK
  });
}

export function brandingMarkLetter(productTitle: string): string {
  const trimmed = productTitle.trim();
  if (!trimmed) return "L";
  return [...trimmed][0]?.toUpperCase() ?? "L";
}
