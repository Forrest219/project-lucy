import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  activationCodeFingerprint,
  decodeActivationCode,
  encodeActivationCode,
  isActivationPayloadExpired
} from "../license/codec.js";
import { assertLicenseAllowsAgentCreate, assertLicenseAllowsMcp, loadLicenseSnapshot } from "../license/entitlement.js";
import { readLicenseRecord, resetLicenseCache, writeLicenseRecord } from "../license/store.js";
import type { LicensePayload } from "../license/types.js";

const TEST_SECRET = "test-license-secret-for-unit-tests";

function samplePayload(overrides: Partial<LicensePayload> = {}): LicensePayload {
  return {
    v: 1,
    customer_id: "acme-corp",
    tier: "enterprise",
    max_agents: 5,
    issued_at: "2026-08-27T00:00:00.000Z",
    expires_at: "2027-08-27T23:59:59.999Z",
    features: ["governance"],
    ...overrides
  };
}

describe("license codec", () => {
  it("round-trips activation codes with HMAC verification", () => {
    const payload = samplePayload();
    const code = encodeActivationCode(payload, TEST_SECRET);
    const decoded = decodeActivationCode(code, TEST_SECRET);
    expect(decoded.payload).toEqual(payload);
    expect(decoded.normalized).toBe(code);
  });

  it("rejects tampered signatures", () => {
    const code = encodeActivationCode(samplePayload(), TEST_SECRET);
    const tampered = `${code}x`;
    expect(() => decodeActivationCode(tampered, TEST_SECRET)).toThrow(/INVALID_ACTIVATION/);
  });

  it("detects expired payloads", () => {
    const payload = samplePayload({ expires_at: "2020-01-01T00:00:00.000Z" });
    expect(isActivationPayloadExpired(payload, Date.parse("2026-08-27T00:00:00.000Z"))).toBe(true);
  });

  it("creates stable fingerprints", () => {
    const code = encodeActivationCode(samplePayload(), TEST_SECRET);
    expect(activationCodeFingerprint(code)).toMatch(/^sha256:[a-f0-9]{64}$/);
  });
});

describe("license store + entitlement", () => {
  let tempRoot: string;
  const previousProjectRoot = process.env.KTX_PROJECT_ROOT;
  const previousMode = process.env.LUCY_LICENSE_MODE;
  const previousVerifySecret = process.env.LUCY_LICENSE_VERIFY_SECRET;

  beforeEach(async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), "lucy-license-"));
    process.env.KTX_PROJECT_ROOT = tempRoot;
    process.env.LUCY_LICENSE_MODE = "enforce";
    process.env.LUCY_LICENSE_VERIFY_SECRET = TEST_SECRET;
    resetLicenseCache();
    await mkdir(path.join(tempRoot, "webui/config"), { recursive: true });
    await mkdir(path.join(tempRoot, ".ktx-ui"), { recursive: true });
    await writeFile(path.join(tempRoot, "ktx.yaml"), "version: \"1\"\n", "utf8");
    await writeFile(
      path.join(tempRoot, "webui/config/access.yaml"),
      "version: \"1\"\nusers: []\n",
      "utf8"
    );
  });

  afterEach(async () => {
    process.env.KTX_PROJECT_ROOT = previousProjectRoot;
    process.env.LUCY_LICENSE_MODE = previousMode;
    process.env.LUCY_LICENSE_VERIFY_SECRET = previousVerifySecret;
    resetLicenseCache();
    await rm(tempRoot, { recursive: true, force: true });
  });

  it("blocks MCP when enforce mode has no activated license", async () => {
    const snapshot = await loadLicenseSnapshot();
    const decision = assertLicenseAllowsMcp(snapshot);
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) {
      expect(decision.code).toBe("LICENSE_REQUIRED");
      expect(decision.decisionReason).toBe("license_missing");
    }
  });

  it("allows MCP after activation and enforces seat limits", async () => {
    const payload = samplePayload({ max_agents: 2 });
    const code = encodeActivationCode(payload, TEST_SECRET);
    const decoded = decodeActivationCode(code, TEST_SECRET);
    await writeLicenseRecord({
      payload: decoded.payload,
      normalizedActivationCode: decoded.normalized
    });

    const record = await readLicenseRecord(tempRoot);
    expect(record?.entitlement.customer_id).toBe("acme-corp");

    const snapshot = await loadLicenseSnapshot();
    expect(snapshot.status).toBe("active");
    expect(assertLicenseAllowsMcp(snapshot).allowed).toBe(true);

    const seatDecision = assertLicenseAllowsAgentCreate(snapshot, 3);
    expect(seatDecision.allowed).toBe(false);
    if (!seatDecision.allowed) {
      expect(seatDecision.code).toBe("LICENSE_SEAT_LIMIT");
    }
  });

  it("treats off mode as unrestricted", async () => {
    process.env.LUCY_LICENSE_MODE = "off";
    resetLicenseCache();
    const snapshot = await loadLicenseSnapshot();
    expect(snapshot.status).toBe("inactive");
    expect(assertLicenseAllowsMcp(snapshot).allowed).toBe(true);
  });
});
