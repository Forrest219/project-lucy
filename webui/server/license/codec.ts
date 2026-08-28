import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { LicensePayload } from "./types.js";

const ACTIVATION_PREFIX = "LUCY-1";

function base64UrlEncode(input: Buffer | string): string {
  const buf = typeof input === "string" ? Buffer.from(input, "utf8") : input;
  return buf.toString("base64url");
}

function base64UrlDecode(input: string): Buffer {
  return Buffer.from(input, "base64url");
}

function normalizeActivationCode(raw: string): string {
  return raw.trim().replace(/\s+/g, "");
}

function signPayload(payloadB64: string, verifySecret: string): string {
  return createHmac("sha256", verifySecret).update(`${ACTIVATION_PREFIX}.${payloadB64}`).digest("base64url");
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

function parsePayloadJson(raw: string): LicensePayload {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("INVALID_ACTIVATION_PAYLOAD");
  }
  if (!parsed || typeof parsed !== "object") {
    throw new Error("INVALID_ACTIVATION_PAYLOAD");
  }
  const obj = parsed as Record<string, unknown>;
  if (obj.v !== 1) throw new Error("INVALID_ACTIVATION_VERSION");
  if (typeof obj.customer_id !== "string" || !obj.customer_id.trim()) {
    throw new Error("INVALID_ACTIVATION_CUSTOMER");
  }
  if (obj.tier !== "trial" && obj.tier !== "standard" && obj.tier !== "enterprise") {
    throw new Error("INVALID_ACTIVATION_TIER");
  }
  if (!Number.isInteger(obj.max_agents) || (obj.max_agents as number) < 1) {
    throw new Error("INVALID_ACTIVATION_MAX_AGENTS");
  }
  if (typeof obj.issued_at !== "string" || Number.isNaN(Date.parse(obj.issued_at))) {
    throw new Error("INVALID_ACTIVATION_ISSUED_AT");
  }
  if (obj.expires_at !== null) {
    if (typeof obj.expires_at !== "string" || Number.isNaN(Date.parse(obj.expires_at))) {
      throw new Error("INVALID_ACTIVATION_EXPIRES_AT");
    }
  }
  const features =
    Array.isArray(obj.features) && obj.features.every((item) => typeof item === "string")
      ? (obj.features as string[])
      : [];
  return {
    v: 1,
    customer_id: obj.customer_id.trim(),
    tier: obj.tier,
    max_agents: obj.max_agents as number,
    issued_at: obj.issued_at,
    expires_at: obj.expires_at as string | null,
    features
  };
}

export function decodeActivationCode(raw: string, verifySecret: string): {
  normalized: string;
  payload: LicensePayload;
} {
  if (!verifySecret.trim()) {
    throw new Error("LICENSE_VERIFY_SECRET_MISSING");
  }
  const normalized = normalizeActivationCode(raw);
  const parts = normalized.split(".");
  if (parts.length !== 3 || parts[0] !== ACTIVATION_PREFIX) {
    throw new Error("INVALID_ACTIVATION_FORMAT");
  }
  const payloadB64 = parts[1]!;
  const sigB64 = parts[2]!;
  const expectedSig = signPayload(payloadB64, verifySecret);
  if (!safeEqual(sigB64, expectedSig)) {
    throw new Error("INVALID_ACTIVATION_SIGNATURE");
  }
  let payloadRaw: string;
  try {
    payloadRaw = base64UrlDecode(payloadB64).toString("utf8");
  } catch {
    throw new Error("INVALID_ACTIVATION_PAYLOAD");
  }
  const payload = parsePayloadJson(payloadRaw);
  return { normalized, payload };
}

export function encodeActivationCode(payload: LicensePayload, signingSecret: string): string {
  if (!signingSecret.trim()) {
    throw new Error("LICENSE_SIGNING_SECRET_MISSING");
  }
  const payloadB64 = base64UrlEncode(JSON.stringify(payload));
  const sigB64 = signPayload(payloadB64, signingSecret);
  return `${ACTIVATION_PREFIX}.${payloadB64}.${sigB64}`;
}

export function activationCodeFingerprint(normalizedCode: string): string {
  return `sha256:${createHash("sha256").update(normalizedCode, "utf8").digest("hex")}`;
}

export function isActivationPayloadExpired(payload: LicensePayload, nowMs = Date.now()): boolean {
  if (payload.expires_at === null) return false;
  return Date.parse(payload.expires_at) <= nowMs;
}
