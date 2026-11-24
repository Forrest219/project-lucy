import { createHash } from "node:crypto";
import { BlockList, isIPv4, isIPv6 } from "node:net";
import { previewDiff } from "../diff.js";

/**
 * Write-time redaction for the configuration audit trail (Spec §5.3, T08-2).
 *
 * Applied before a row reaches SQLite, so the database never holds the original
 * text (hiding it only in CSV/API output is not enough). Rules:
 * - credential values are masked; the surrounding diff stays reviewable;
 * - authentication/account events keep only an explicit key allowlist;
 * - Wiki / Skill bodies are recorded as digests and line counts, never copied.
 */

export const REDACTED = "[REDACTED]";
export const REDACTED_HASH = "[REDACTED_HASH]";

const SECRET_KEY_RE =
  /^(?:password(?:_hash)?|passwd|pwd|secret|client_secret|api[-_]?key|access[-_]?key|private[-_]?key|bootstrap[-_]?(?:token|secret|key)|session[-_]?secret|authorization|cookie|set-cookie|token|credentials?)$/i;

const SCRYPT_VALUE_RE = /\bscrypt:[A-Za-z0-9+/=_:.-]{8,}/g;
const BEARER_VALUE_RE = /\bBearer\s+[A-Za-z0-9._~+/=-]{16,}/g;
// T10 — a full sha256:hex token hash is a credential; redact the value even
// when the surrounding key is unlabelled (e.g. `hash: "sha256:..."` in
// tokens.yaml). 40+ hex chars distinguishes a full digest from the 12-hex
// fingerprint that the audit trail intentionally preserves.
const HASH_VALUE_RE = /\bsha256:[0-9a-f]{40,}\b/g;
// T10 — `password=hunter2`, `token: sk-live-...` (free-form key/value with no
// colon) gets a value-only mask so the surrounding text is still reviewable.
const PASSWORD_ASSIGN_RE = /\b(password|passwd|pwd)\s*=\s*([^,\s;"']+)/gi;
const TOKEN_ASSIGN_RE = /\btoken\s*=\s*([^,\s;"']+)/gi;

// `<diff marker><indent><list dash>"key"<sep>value`
const YAML_LINE_RE = /^([+\- ]?[ \t]*(?:-[ \t]+)?["']?)([A-Za-z_][\w.-]*)(["']?[ \t]*:[ \t]*)(.*)$/;

/** Mask credential-shaped values inside free text (error reasons, summaries). */
export function redactAuditText(text: string): string {
  return text
    .replace(SCRYPT_VALUE_RE, REDACTED_HASH)
    .replace(BEARER_VALUE_RE, `Bearer ${REDACTED}`)
    .replace(HASH_VALUE_RE, REDACTED_HASH)
    .replace(PASSWORD_ASSIGN_RE, (_m, key) => `${key}=${REDACTED}`)
    .replace(TOKEN_ASSIGN_RE, (_m) => `token=${REDACTED}`);
}

export const REDACTED_ADDR = "[REDACTED_ADDR]";
export const REDACTED_PATH = "[REDACTED_PATH]";
export const REDACTED_TOOL = "[REDACTED_TOOL]";

// Storage URLs run to whitespace / quote / angle bracket; trailing sentence
// punctuation is left outside the match.
const STORAGE_PATH_RE = /\b(?:hdfs|s3a?|file):\/\/[^\s"'`<>]*[^\s"'`<>.,;:)\]]/gi;
// `scheme://user:password@host` — only the password segment is masked; scheme, user and
// host stay reviewable. Covers jdbc:/postgresql:/mongodb:/redis: style connection strings.
const URL_USERINFO_RE = /\b([a-z][a-z0-9+.-]*:\/\/[^\s:@/"'`<>]*):([^\s/"'`<>]+)@/gi;
const BRACKETED_IPV6_RE = /\[([0-9a-fA-F:.]+)\](?::\d{1,5})?/g;
const BARE_IPV6_RE = /(?<![\w:.])(?:[0-9a-fA-F]{0,4}:){2,7}[0-9a-fA-F]{0,4}(?![\w:])/g;
const IPV4_RE = /(?<![\w.])(\d{1,3}(?:\.\d{1,3}){3})(?::\d{1,5})?(?!\d|\.\d)/g;
const INTERNAL_TOOL_RE = /(?<!\w)sl_query(?!\w)/g;

const INTERNAL_ADDRESSES = (() => {
  const list = new BlockList();
  for (const [net, prefix] of [
    ["10.0.0.0", 8],
    ["172.16.0.0", 12],
    ["192.168.0.0", 16],
    ["127.0.0.0", 8],
    ["169.254.0.0", 16]
  ] as const) {
    list.addSubnet(net, prefix, "ipv4");
  }
  list.addAddress("::1", "ipv6");
  list.addSubnet("fe80::", 10, "ipv6");
  list.addSubnet("fc00::", 7, "ipv6");
  return list;
})();

const isInternalIPv4 = (value: string) => isIPv4(value) && INTERNAL_ADDRESSES.check(value, "ipv4");
const isInternalIPv6 = (value: string) => isIPv6(value) && INTERNAL_ADDRESSES.check(value, "ipv6");

/**
 * Storage-side redaction for `error_detail` (P1-36 D9 / SC-07). Call it before
 * writing the text to the audit ledger; `redactAuditText` itself is unchanged.
 *
 * Runs the `redactAuditText` credential chain, then replaces with category
 * placeholders (never an empty string):
 * - internal addresses (RFC1918, loopback, link-local, ULA; IPv4 and IPv6, a
 *   trailing `:port` is absorbed) -> `[REDACTED_ADDR]`;
 * - `hdfs://`, `s3://`, `s3a://`, `file://` locations -> `[REDACTED_PATH]`;
 * - the password segment of `scheme://user:password@host` connection strings
 *   -> `[REDACTED]` (scheme, user and host are kept);
 * - the internal tool name `sl_query` (whole identifier only) -> `[REDACTED_TOOL]`.
 * Public IPs, version strings, timestamps, `:port` fragments and reason codes
 * pass through untouched.
 */
export function redactStorageDetail(text: string): string {
  return redactAuditText(text)
    .replace(STORAGE_PATH_RE, REDACTED_PATH)
    .replace(URL_USERINFO_RE, (_m, head: string) => `${head}:${REDACTED}@`)
    .replace(BRACKETED_IPV6_RE, (m, addr: string) => (isInternalIPv6(addr) ? REDACTED_ADDR : m))
    .replace(BARE_IPV6_RE, (m) => (isInternalIPv6(m) ? REDACTED_ADDR : m))
    .replace(IPV4_RE, (m, addr: string) => (isInternalIPv4(addr) ? REDACTED_ADDR : m))
    .replace(INTERNAL_TOOL_RE, REDACTED_TOOL);
}

function redactLine(line: string): string {
  const match = YAML_LINE_RE.exec(line);
  if (match && SECRET_KEY_RE.test(match[2]!) && match[4]!.trim() !== "") {
    return `${match[1]}${match[2]}${match[3]}${REDACTED}`;
  }
  return redactAuditText(line);
}

/** Line-based mask over a unified diff: `password_hash: "scrypt:…"` becomes `password_hash: [REDACTED]`. */
export function redactAuditDiff(diff: string): string {
  return diff.split("\n").map(redactLine).join("\n");
}

/** Authentication / account events record only these top-level keys. */
const AUTH_SUMMARY_ALLOWLIST = new Set([
  "id",
  "role",
  "enabled",
  "displayName",
  "count",
  "hasAccountUid",
  "passwordRotated",
  "targetId"
]);

const AUTH_CHANGE_TYPE_RE = /^(?:admin_|auth_|bootstrap)/;

function maskDeep(value: unknown): unknown {
  if (typeof value === "string") return redactAuditText(value);
  if (Array.isArray(value)) return value.map(maskDeep);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, inner]) => [
        key,
        SECRET_KEY_RE.test(key) && inner !== null && inner !== undefined ? REDACTED : maskDeep(inner)
      ])
    );
  }
  return value;
}

export function redactAuditSummary(changeType: string, value: unknown): unknown {
  if (value === undefined || value === null) return value;
  if (AUTH_CHANGE_TYPE_RE.test(changeType)) {
    if (typeof value !== "object" || Array.isArray(value)) return {};
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).filter(
        ([key, inner]) => AUTH_SUMMARY_ALLOWLIST.has(key) && (inner === null || typeof inner !== "object")
      )
    );
  }
  return maskDeep(value);
}

function splitFrontmatter(text: string): { front: string; body: string } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(text);
  if (!match) return { front: "", body: text };
  return { front: match[1]!, body: text.slice(match[0].length) };
}

const digest12 = (text: string) => createHash("sha256").update(text).digest("hex").slice(0, 12);

function changedLineCount(oldText: string, newText: string): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const line of previewDiff(oldText, newText, "body").split("\n")) {
    if (line.startsWith("+++") || line.startsWith("---")) continue;
    if (line.startsWith("+")) added += 1;
    else if (line.startsWith("-")) removed += 1;
  }
  return { added, removed };
}

const CONTENT_ASSET_KINDS = new Set(["wiki", "skill"]);

/**
 * The diff stored for a file write. Wiki/Skill documents keep their property
 * block (ACLs and metadata are what reviewers need) and reduce the body to a digest.
 */
export function auditDiffForContent(input: {
  assetKind?: string;
  relPath: string;
  oldText: string;
  newText: string;
  provided?: string;
}): string {
  if (!input.assetKind || !CONTENT_ASSET_KINDS.has(input.assetKind)) {
    return redactAuditDiff(input.provided ?? previewDiff(input.oldText, input.newText, input.relPath));
  }
  const before = splitFrontmatter(input.oldText);
  const after = splitFrontmatter(input.newText);
  const propertyDiff = redactAuditDiff(previewDiff(before.front, after.front, input.relPath));
  if (before.body === after.body) return propertyDiff;
  const { added, removed } = changedLineCount(before.body, after.body);
  const previous = before.body ? `sha256:${digest12(before.body)}` : "none";
  const next = after.body ? `sha256:${digest12(after.body)}` : "none";
  const bodyLine = `body: ${previous} -> ${next}, +${added} -${removed} lines (content not stored)`;
  return propertyDiff ? `${propertyDiff}\n${bodyLine}` : bodyLine;
}
