import { BlockList, isIP } from "node:net";
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

/**
 * Extract a best-effort display IP for audit rows. **Display-only** —
 * it does NOT participate in ACL decisions. ACL / rate-limit gating use
 * `webui/server/auth/rate-limit.ts:clientSource`, which additionally
 * checks the peer CIDR before honoring X-Forwarded-For (EA-10).
 *
 * When `LUCY_TRUST_PROXY` is on but the peer is not inside
 * `LUCY_TRUSTED_PROXY_CIDRS`, this function may still return an XFF
 * value; the audit row's `trustedSource` will record `untrusted_peer`
 * so the entry is visible as a forged-XFF attempt at review time.
 */
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
  /**
   * Spec 173 v0.3 / 2026-10-19 audit-trust:可信来源分类。
   *  - `local_admin`    : 进程内本地管理面（无 socket）
   *  - `customer`       : 直接 socket peer，无可信代理介入
   *  - `trusted_proxy`  : socket peer 在 `LUCY_TRUSTED_PROXY_CIDRS` 内，XFF 头被采纳
   *  - `untrusted_peer` : socket peer 不在白名单或 XFF 头被伪造（仍写链但不参与 ACL）
   *  - `unknown`        : 无法判断
   */
  trustedSource?: "local_admin" | "customer" | "trusted_proxy" | "untrusted_peer" | "unknown";
};

export function extractRequestClientMeta(req: IncomingMessage): RequestClientMeta {
  const meta: RequestClientMeta = {
    clientIp: extractClientIp(req),
    clientForwardedFor: extractForwardedFor(req),
    userAgent: extractUserAgent(req),
    deviceName: extractDeviceName(req),
    trustedSource: classifyTrustedSource(req)
  };
  // The structured identity is not known yet at header time; the proxy
  // resolves it once the MCP `initialize` handshake (if any) has landed.
  return meta;
}

/**
 * Spec 173 v0.3 / 2026-10-19 audit-trust:可信来源分类。
 * 与本文件 `extractClientIp` + `webui/server/auth/rate-limit.ts:clientSource` 同源：
 *  - `local_admin`    : 没有 socket peer（进程内 Admin 调用或未携带 socket 信息）
 *  - `customer`         : 直接 socket peer，可信代理未启用
 *  - `trusted_proxy`    : 可信代理白名单内的 socket peer，XFF 头可采纳
 *  - `untrusted_peer`   : socket peer 不在白名单但带了 XFF（伪造风险被记录，不入 ACL）
 *  - `unknown`          : 无法解析的 peer 地址
 *
 * 注：`extractClientIp` 仍按 `trustProxyEnabled()` 与 `LUCY_TRUSTED_PROXY_CIDRS`
 * 选择来源；本函数仅做分类，不修改 clientIp 取值。EA-10 的「伪造 XFF 不影响 ACL /
 * 限流」由 `auth/rate-limit.ts:clientSource` 的 socket-peer 检查承担。
 */
export function classifyTrustedSource(req: IncomingMessage): RequestClientMeta["trustedSource"] {
  const peer = req.socket?.remoteAddress;
  if (!peer) return "local_admin";
  const version = isIP(peer);
  if (version === 0) return "unknown";
  if (!trustProxyEnabled()) return "customer";
  // trust on with NO CIDR list: any XFF cannot be considered trusted, so
  // fall through to the peer-not-trusted branch. A peer carrying XFF is then
  // classified as `untrusted_peer` rather than silently labeled `customer`,
  // because `extractClientIp` will still honor the XFF in this configuration
  // while `clientSource` will not — the audit row must reflect that mismatch.
  const cidrs = (process.env.LUCY_TRUSTED_PROXY_CIDRS ?? "").trim();
  const list = new BlockList();
  if (cidrs) {
    for (const entry of cidrs.split(",").map((s) => s.trim()).filter(Boolean)) {
      const [address, prefix] = entry.split("/");
      const family = isIP(address) === 6 ? "ipv6" : "ipv4";
      if (!isIP(address)) continue;
      if (prefix === undefined) list.addAddress(address, family);
      else list.addSubnet(address, Number(prefix), family);
    }
  }
  const peerIsTrusted = list.check(peer, version === 6 ? "ipv6" : "ipv4");
  if (peerIsTrusted) return "trusted_proxy";
  // peer 不可信 + 携带 XFF = 疑似伪造，记录为 untrusted_peer，不影响 ACL。
  const xff = firstHeaderValue(req.headers["x-forwarded-for"]);
  return xff ? "untrusted_peer" : "customer";
}
