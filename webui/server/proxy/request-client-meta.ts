import type { IncomingMessage } from "node:http";

const USER_AGENT_MAX = 256;
const DEVICE_NAME_MAX = 128;

function firstHeaderValue(value: string | string[] | undefined): string | undefined {
  if (!value) return undefined;
  const raw = Array.isArray(value) ? value[0] : value;
  const trimmed = raw?.trim();
  return trimmed ? trimmed : undefined;
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : value.slice(0, max);
}

/**
 * Whether reverse-proxy headers may be trusted for client IP.
 * Default off so forged X-Forwarded-For cannot spoof audit rows.
 */
export function trustProxyEnabled(): boolean {
  const raw = (process.env.LUCY_TRUST_PROXY ?? "").trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes";
}

export function extractClientIp(req: IncomingMessage): string | undefined {
  if (trustProxyEnabled()) {
    const xff = firstHeaderValue(req.headers["x-forwarded-for"]);
    if (xff) {
      const first = xff.split(",")[0]?.trim();
      if (first) return first;
    }
    const realIp = firstHeaderValue(req.headers["x-real-ip"]);
    if (realIp) return realIp;
  }
  const remote = req.socket?.remoteAddress;
  return remote || undefined;
}

export function extractUserAgent(req: IncomingMessage): string | undefined {
  const ua = firstHeaderValue(req.headers["user-agent"]);
  return ua ? truncate(ua, USER_AGENT_MAX) : undefined;
}

export function extractDeviceName(req: IncomingMessage): string | undefined {
  const name = firstHeaderValue(req.headers["x-lucy-device-name"]);
  return name ? truncate(name, DEVICE_NAME_MAX) : undefined;
}

export type RequestClientMeta = {
  clientIp?: string;
  userAgent?: string;
  deviceName?: string;
};

export function extractRequestClientMeta(req: IncomingMessage): RequestClientMeta {
  return {
    clientIp: extractClientIp(req),
    userAgent: extractUserAgent(req),
    deviceName: extractDeviceName(req)
  };
}
