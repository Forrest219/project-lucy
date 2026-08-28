#!/usr/bin/env node
/**
 * Issue Lucy deployment activation codes (vendor-side only).
 *
 * Usage:
 *   LUCY_LICENSE_SIGNING_SECRET=<hex> node scripts/license-issue.mjs \
 *     --customer acme-corp --tier enterprise --max-agents 50 --expires 2027-12-31
 *
 * Omit --expires for perpetual licenses.
 */

import { createHmac } from "node:crypto";

const ACTIVATION_PREFIX = "LUCY-1";

function base64UrlEncode(input) {
  return Buffer.from(input, "utf8").toString("base64url");
}

function signPayload(payloadB64, secret) {
  return createHmac("sha256", secret).update(`${ACTIVATION_PREFIX}.${payloadB64}`).digest("base64url");
}

function encodeActivationCode(payload, signingSecret) {
  const payloadB64 = base64UrlEncode(JSON.stringify(payload));
  const sigB64 = signPayload(payloadB64, signingSecret);
  return `${ACTIVATION_PREFIX}.${payloadB64}.${sigB64}`;
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      args[key] = true;
      continue;
    }
    args[key] = next;
    i += 1;
  }
  return args;
}

function usage() {
  console.error(`Usage: LUCY_LICENSE_SIGNING_SECRET=<secret> node scripts/license-issue.mjs \\
  --customer <id> --tier trial|standard|enterprise --max-agents <n> [--expires YYYY-MM-DD] [--features a,b]`);
  process.exit(1);
}

const args = parseArgs(process.argv.slice(2));
const signingSecret = process.env.LUCY_LICENSE_SIGNING_SECRET?.trim();
if (!signingSecret) {
  console.error("LUCY_LICENSE_SIGNING_SECRET is required");
  usage();
}

const customer = String(args.customer ?? "").trim();
const tier = String(args.tier ?? "").trim();
const maxAgents = Number(args["max-agents"]);
if (!customer || !["trial", "standard", "enterprise"].includes(tier) || !Number.isInteger(maxAgents) || maxAgents < 1) {
  usage();
}

let expiresAt = null;
if (args.expires) {
  const dateOnly = String(args.expires);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateOnly)) {
    console.error("--expires must be YYYY-MM-DD");
    process.exit(1);
  }
  expiresAt = `${dateOnly}T23:59:59.999Z`;
}

const features = args.features
  ? String(args.features)
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean)
  : [];

const payload = {
  v: 1,
  customer_id: customer,
  tier,
  max_agents: maxAgents,
  issued_at: new Date().toISOString(),
  expires_at: expiresAt,
  features
};

const activationCode = encodeActivationCode(payload, signingSecret);
console.log(JSON.stringify({ payload, activationCode }, null, 2));
