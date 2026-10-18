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

/**
 * Spec 162 §8 / WO-14 T3 / SC-22 — forwarded peer chain, recorded separately.
 *
 * This is display evidence only and never participates in ACL: `client_ip`
 * stays the socket peer. Absent header ⇒ empty, never a guessed office range.
 */
export function extractForwardedFor(req: IncomingMessage): string | undefined {
  const xff = firstHeaderValue(req.headers["x-forwarded-for"]);
  if (xff) return truncate(xff, USER_AGENT_MAX);
  return firstHeaderValue(req.headers["x-real-ip"]);
}

export type KnownClientFamily = {
  client: string;
  clientVersion?: string;
};

type FamilyPattern = { client: string; pattern: RegExp; versionGroup?: number };

/**
 * Spec 162 §8 / SC-22 — known User-Agent families.
 *
 * Only these are recognized. An unknown or absent User-Agent leaves
 * `client` empty rather than guessing from the string.
 */
const KNOWN_CLIENT_FAMILIES: FamilyPattern[] = [
  { client: "kscc-code", pattern: /^(kscc-code)\/([\w.\-]+)/i },
  { client: "codex-mcp-client", pattern: /^(codex-mcp-client)\/([\w.\-]+)/i },
  { client: "workbuddy", pattern: /^(workbuddy)[\s/]*([\w.\-]+)?/i, versionGroup: 2 },
  { client: "opencode", pattern: /^(opencode)\/([\w.\-]+)/i },
  { client: "claude-code", pattern: /^([\w.\-]*claude-code)\/([\w.\-]+)/i }
];

/** MCP `clientInfo.name` values that name Lucy itself, not the product in use. */
const LUCY_SELF_NAMES = new Set(["lucy", "lucy-mcp-proxy"]);

function isLucySelfName(name: string | undefined): boolean {
  return Boolean(name && LUCY_SELF_NAMES.has(name.trim().toLowerCase()));
}

export function userAgentParsingEnabled(): boolean {
  return process.env.LUCY_USER_AGENT_PARSE !== "off";
}

/**
 * Spec 162 §8 / SC-22 — parse a known client family out of a User-Agent.
 * Returns null when the family is unknown or parsing is switched off, so the
 * caller keeps an empty `client` instead of inventing one.
 */
export function parseKnownClientFamily(userAgent: string | null | undefined): KnownClientFamily | null {
  if (!userAgentParsingEnabled()) return null;
  const raw = userAgent?.trim();
  if (!raw) return null;
  for (const family of KNOWN_CLIENT_FAMILIES) {
    const match = family.pattern.exec(raw);
    if (!match) continue;
    const version = family.versionGroup !== undefined
      ? match[family.versionGroup]
      : match[2];
    return {
      client: family.client,
      clientVersion: version ? String(version).trim() || undefined : undefined
    };
  }
  return null;
}

export type ResolvedClientIdentity = {
  client?: string;
  clientVersion?: string;
  /** MCP `clientInfo` name, kept when it differs from the product shown in `client`. */
  reportedClient?: string;
  reportedClientVersion?: string;
};

/**
 * A known User-Agent product wins when the MCP client reports nothing, or only
 * Lucy's own placeholder (`lucy` / `lucy-mcp-proxy`). Any other self-reported
 * name wins, including `hermes`, `p`, and `probe`. An unknown User-Agent such
 * as `undici` or `Python-urllib` is never guessed into a product.
 */
export function resolveClientIdentity(input: {
  client?: string | null;
  clientVersion?: string | null;
  userAgent?: string | null;
}): ResolvedClientIdentity {
  const reportedClient = input.client?.trim() || undefined;
  const reportedClientVersion = input.clientVersion?.trim() || undefined;
  const family = parseKnownClientFamily(input.userAgent);
  if (family && (!reportedClient || isLucySelfName(reportedClient))) {
    return {
      client: family.client,
      clientVersion: family.clientVersion,
      ...(reportedClient ? { reportedClient, reportedClientVersion } : {})
    };
  }
  if (reportedClient) {
    return {
      client: reportedClient,
      clientVersion: reportedClientVersion,
      reportedClient,
      reportedClientVersion
    };
  }
  return family ? { client: family.client, clientVersion: family.clientVersion } : {};
}

export type StoredClientRow = {
  client?: string | null;
  clientVersion?: string | null;
  client_version?: string | null;
  userAgent?: string | null;
  user_agent?: string | null;
  reportedClient?: string | null;
  reported_client?: string | null;
  reportedClientVersion?: string | null;
  reported_client_version?: string | null;
};

/**
 * Display rule for a stored audit row. New rows keep the product already
 * written in `client` and the raw self-report in `reported_client`. Older rows
 * have a null self-report column, so the same resolver runs at read time.
 */
export function presentStoredClient(row: StoredClientRow): ResolvedClientIdentity {
  const storedReported = (row.reported_client ?? row.reportedClient)?.trim() || undefined;
  const storedReportedVersion = (row.reported_client_version ?? row.reportedClientVersion)?.trim() || undefined;
  if (storedReported) {
    return {
      client: row.client?.trim() || undefined,
      clientVersion: (row.client_version ?? row.clientVersion)?.trim() || undefined,
      reportedClient: storedReported,
      reportedClientVersion: storedReportedVersion
    };
  }
  return resolveClientIdentity({
    client: row.client,
    clientVersion: row.client_version ?? row.clientVersion,
    userAgent: row.user_agent ?? row.userAgent
  });
}

export type RequestClientMeta = {
  clientIp?: string;
  /** Spec 162 §8 / SC-22 — display-only forwarded chain, never used for ACL. */
  clientForwardedFor?: string;
  userAgent?: string;
  deviceName?: string;
  client?: string;
  clientVersion?: string;
};

export function extractRequestClientMeta(req: IncomingMessage): RequestClientMeta {
  const meta: RequestClientMeta = {
    clientIp: extractClientIp(req),
    clientForwardedFor: extractForwardedFor(req),
    userAgent: extractUserAgent(req),
    deviceName: extractDeviceName(req)
  };
  // The structured identity is not known yet at header time; the proxy
  // resolves it once the MCP `initialize` handshake (if any) has landed.
  return meta;
}
