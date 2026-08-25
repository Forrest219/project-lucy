export type BrandingDefaults = {
  productTitle: string;
  tagline: string;
};

export type BrandingInfo = {
  productTitle: string;
  tagline: string;
  productTitleOverride: string;
  taglineOverride: string;
  hasCustomLogo: boolean;
  logoUrl: string | null;
  logoContentType: string | null;
  logoWidth: number | null;
  logoHeight: number | null;
  updatedAt: string | null;
  defaults: BrandingDefaults;
};

export const BRANDING_QUERY_KEY = ["branding"] as const;
