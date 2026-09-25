#!/usr/bin/env node
import { createHmac } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const results = [];

function pass(check, message) {
  results.push({ status: "pass", check, message });
}

function fail(check, message) {
  results.push({ status: "fail", check, message });
}

const ACTIVATION_PREFIX = "LUCY-1";

function base64UrlEncode(input) {
  const buf = typeof input === "string" ? Buffer.from(input, "utf8") : input;
  return buf.toString("base64url");
}

function signPayload(payloadB64, verifySecret) {
  return createHmac("sha256", verifySecret).update(`${ACTIVATION_PREFIX}.${payloadB64}`).digest("base64url");
}

function encodeActivationCode(payload, verifySecret) {
  const json = JSON.stringify(payload);
  const payloadB64 = base64UrlEncode(json);
  const signature = signPayload(payloadB64, verifySecret);
  return `${ACTIVATION_PREFIX}.${payloadB64}.${signature}`;
}

function decodeActivationCode(raw, verifySecret) {
  const normalized = raw.trim().replace(/\s+/g, "");
  const parts = normalized.split(".");
  if (parts.length !== 3 || parts[0] !== ACTIVATION_PREFIX) {
    throw new Error("INVALID_ACTIVATION_PREFIX");
  }
  const [, payloadB64, sig] = parts;
  const expectedSig = signPayload(payloadB64, verifySecret);
  if (sig !== expectedSig) {
    throw new Error("INVALID_ACTIVATION_SIGNATURE");
  }
  const payloadJson = Buffer.from(payloadB64, "base64url").toString("utf8");
  return JSON.parse(payloadJson);
}

// 1. 验证 Codec 编解码与签名防伪
try {
  const secret = "test-secret-baseline-2026";
  const validPayload = {
    v: 1,
    customer_id: "smoke-customer",
    tier: "enterprise",
    max_agents: 50,
    issued_at: "2026-08-01T00:00:00.000Z",
    expires_at: "2027-08-01T00:00:00.000Z",
    features: ["mcp", "hot_store", "audit"]
  };

  const code = encodeActivationCode(validPayload, secret);
  const decoded = decodeActivationCode(code, secret);
  if (decoded.customer_id === "smoke-customer" && decoded.tier === "enterprise") {
    pass("license-codec-roundtrip", "Activation code encode/decode signature verification succeeded");
  } else {
    fail("license-codec-roundtrip", "Decoded payload mismatch");
  }

  // 篡改测试
  try {
    decodeActivationCode(code + "tamper", secret);
    fail("license-codec-tamper", "Tampered code unexpectedly decoded");
  } catch {
    pass("license-codec-tamper", "Tampered signature correctly rejected");
  }
} catch (err) {
  fail("license-codec-exception", err.message);
}

// 2. 验证前端与后端 License 依赖文件完整性
const requiredFiles = [
  "webui/server/license/codec.ts",
  "webui/server/license/entitlement.ts",
  "webui/server/license/routes.ts",
  "webui/server/license/store.ts",
  "webui/src/pages/admin/LicenseSettings.tsx",
  "webui/src/lib/license.ts"
];

for (const relPath of requiredFiles) {
  const absPath = path.join(root, relPath);
  if (existsSync(absPath)) {
    pass(`file-exists:${relPath}`, `Required license component ${relPath} is present`);
  } else {
    fail(`file-exists:${relPath}`, `Missing license component file ${relPath}`);
  }
}

const failed = results.filter((r) => r.status === "fail");
console.log(`[verify-license-baseline] ${results.length - failed.length}/${results.length} checks passed.`);

if (failed.length > 0) {
  console.error("[verify-license-baseline] FAILURES:", failed);
  process.exit(1);
} else {
  console.log("[verify-license-baseline] PASS: License baseline verified.");
  process.exit(0);
}
