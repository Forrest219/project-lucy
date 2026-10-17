import { createHash } from "node:crypto";
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

// `<diff marker><indent><list dash>"key"<sep>value`
const YAML_LINE_RE = /^([+\- ]?[ \t]*(?:-[ \t]+)?["']?)([A-Za-z_][\w.-]*)(["']?[ \t]*:[ \t]*)(.*)$/;

/** Mask credential-shaped values inside free text (error reasons, summaries). */
export function redactAuditText(text: string): string {
  return text.replace(SCRYPT_VALUE_RE, REDACTED_HASH).replace(BEARER_VALUE_RE, `Bearer ${REDACTED}`);
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
