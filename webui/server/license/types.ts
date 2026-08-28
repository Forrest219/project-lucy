export type LicenseTier = "trial" | "standard" | "enterprise";

export type LicenseMode = "off" | "enforce" | "warn";

export type LicensePayload = {
  v: 1;
  customer_id: string;
  tier: LicenseTier;
  max_agents: number;
  issued_at: string;
  expires_at: string | null;
  features?: string[];
};

export type StoredEntitlement = {
  customer_id: string;
  tier: LicenseTier;
  max_agents: number;
  issued_at: string;
  expires_at: string | null;
  features: string[];
};

export type LicenseRecord = {
  version: "1";
  activated_at: string;
  activation_code_fingerprint: string;
  entitlement: StoredEntitlement;
};

export type LicenseStatusCode = "inactive" | "active" | "expired" | "invalid";

export type LicenseSnapshot = {
  mode: LicenseMode;
  status: LicenseStatusCode;
  activatedAt: string | null;
  entitlement: StoredEntitlement | null;
  usage: {
    agents: number;
    maxAgents: number | null;
  };
  expiresAt: string | null;
  daysRemaining: number | null;
  verifySecretConfigured: boolean;
};

export type LicenseEnforcementDecision =
  | { allowed: true }
  | {
      allowed: false;
      code: "LICENSE_REQUIRED" | "LICENSE_EXPIRED" | "LICENSE_SEAT_LIMIT" | "LICENSE_VERIFY_SECRET_MISSING";
      message: string;
      httpStatus: 403;
      decisionReason?: "license_missing" | "license_expired";
    };
