export type LicenseTier = "trial" | "standard" | "enterprise";

export type LicenseMode = "off" | "enforce" | "warn";

export type LicenseStatusCode = "inactive" | "active" | "expired" | "invalid";

export type LicenseSnapshot = {
  mode: LicenseMode;
  status: LicenseStatusCode;
  activatedAt: string | null;
  entitlement: {
    customer_id: string;
    tier: LicenseTier;
    max_agents: number;
    issued_at: string;
    expires_at: string | null;
    features: string[];
  } | null;
  usage: {
    agents: number;
    maxAgents: number | null;
  };
  expiresAt: string | null;
  daysRemaining: number | null;
  verifySecretConfigured: boolean;
};

export const LICENSE_QUERY_KEY = ["admin", "license"] as const;

export function licenseStatusLabel(status: LicenseStatusCode, mode: LicenseMode): string {
  if (mode === "off") return "未启用 enforcement";
  if (status === "active") return "已激活";
  if (status === "expired") return "已过期";
  return "未激活";
}

export function licenseTierLabel(tier: LicenseTier): string {
  if (tier === "trial") return "试用";
  if (tier === "standard") return "标准";
  return "企业";
}
