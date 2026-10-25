// The `ktx-upstream` capability must be PROVEN, never declared.
//
// Lucy's MCP proxy forwards every data-plane call to a KTX upstream
// (`LUCY_PROXY_UPSTREAM_HOST` / `LUCY_PROXY_UPSTREAM_PORT`, default
// 127.0.0.1:7878). When nothing listens there, every query answers empty —
// which reads like a product defect and is not one. So the capability is granted
// only when the run really answered on the port the proxy forwards to.
//
// This module is the single source of that rule for the e2e harness (the spec
// side has its own reader of the runner's verified flag, because a Playwright
// spec cannot await a port probe in a synchronous capability check).

import { portOpen } from "./instance.mjs";

/** The capability name. */
export const UPSTREAM_CAPABILITY = "ktx-upstream";

/** The upstream the proxy forwards to, from the environment. */
export function upstreamTarget(env = process.env) {
  const host = env.LUCY_PROXY_UPSTREAM_HOST ?? "127.0.0.1";
  const port = Number(env.LUCY_PROXY_UPSTREAM_PORT ?? 7878);
  return { host, port: Number.isInteger(port) && port > 0 ? port : 0 };
}

/** Is the upstream actually answering? */
export async function upstreamReachable(env = process.env) {
  const { host, port } = upstreamTarget(env);
  if (!port) return false;
  return portOpen(host, port, 1000);
}

/** The capabilities the operator declared in the environment. */
export function declaredCapabilities(env = process.env) {
  return (env.LUCY_REAL_E2E_CAPABILITIES ?? "")
    .split(",")
    .map((cap) => cap.trim())
    .filter(Boolean);
}

/**
 * The capability set with `ktx-upstream` granted ONLY by proof.
 *
 * A local run proves it by starting its own upstream and seeing it answer; an
 * external run cannot probe the in-cluster upstream, so the operator's
 * attestation is the only signal there — and it is recorded as such.
 */
export function withProvenUpstream(
  capabilities,
  { external = false, upstreamOk = false, env = process.env } = {}
) {
  const out = new Set(capabilities);
  if (external) {
    if (declaredCapabilities(env).includes(UPSTREAM_CAPABILITY)) out.add(UPSTREAM_CAPABILITY);
  } else if (upstreamOk) {
    out.add(UPSTREAM_CAPABILITY);
  } else {
    out.delete(UPSTREAM_CAPABILITY);
  }
  return out;
}
