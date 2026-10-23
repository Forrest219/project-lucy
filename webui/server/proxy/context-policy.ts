import { createHash } from "node:crypto";
import { effectivePermissions, getPolicyRuntimeStatus } from "./acl.js";
import type { Identity } from "./identity.js";
import type { ContextAction, ContextAssetKind, ContextSnapshot, ObjectAcl } from "./context-acl.js";

/**
 * Spec §2 / §4.4 — contextPolicyVersion and the per-request role snapshot.
 *
 * The snapshot is rebuilt from the committed EffectivePolicy on every request (no sensitive
 * body is ever cached), so role/channel narrowing and ACL edits take effect on the next
 * request without waiting for a KTX reindex.
 */

/** One object's authorization facts, with no body text. */
export interface ContextInventoryEntry {
  kind: ContextAssetKind;
  id: string;
  acl: ObjectAcl;
  /** Skill lifecycle status; absent for Wiki pages. */
  status?: string;
  /** Content-derived file identity (`sha256` of the exact file bytes). */
  fileVersion: string;
  /** Wiki only: legacy `visibility` metadata. Informational for migration; never authorizes. */
  legacyVisibility?: string;
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function stableAcl(acl: ObjectAcl): unknown {
  if (acl.state === "roles") return { state: acl.state, roles: [...acl.roles].sort() };
  if (acl.state === "corrupt") return { state: acl.state };
  return { state: acl.state };
}

/**
 * Resolve the caller's role facts. Fails closed: a legacy direct-allow Agent has no formal
 * role (`context_role_required`); an unresolvable / degraded policy cannot prove an ACL
 * (`context_policy_unavailable`).
 */
export async function resolveContextSnapshot(identity: Identity): Promise<ContextSnapshot> {
  const resolved = await effectivePermissions(identity);
  if (!resolved.ok) return { ok: false, reason: "context_policy_unavailable", detail: resolved.reason };
  const { permissions } = resolved;
  if (permissions.legacyAllow || permissions.roleIds.length === 0) {
    return { ok: false, reason: "context_role_required" };
  }
  const roleChannels: Record<string, string[]> = {};
  for (const roleId of permissions.roleIds) {
    roleChannels[roleId] = [...(permissions.roleMetaTools?.[roleId] ?? [])];
  }
  return {
    ok: true,
    roleIds: [...permissions.roleIds],
    roleChannels,
    policyVersion: getPolicyRuntimeStatus().policyVersion,
    roleChannelVersion: permissions.snapshotHash
  };
}

/** `hash(normalized object ACL + file identity/version + role channel version)`. */
export function computeContextPolicyVersion(entries: ContextInventoryEntry[], roleChannelVersion: string): string {
  const normalized = entries
    .map((entry) => ({
      kind: entry.kind,
      id: entry.id,
      acl: stableAcl(entry.acl),
      status: entry.status ?? null,
      fileVersion: entry.fileVersion
    }))
    .sort((a, b) => `${a.kind}:${a.id}`.localeCompare(`${b.kind}:${b.id}`));
  return `ctx-${sha256Hex(JSON.stringify({ entries: normalized, roleChannelVersion })).slice(0, 32)}`;
}

/**
 * Cache key for any derived context result (discover list, rendered directory, ...).
 * Includes identity generation, role channel version, policyVersion, contextPolicyVersion and
 * action, so a narrowing in any input yields a different key and never reuses a wider result.
 */
export function contextCacheKey(input: {
  identity: Pick<Identity, "userId" | "tokenHashPrefix">;
  snapshot: Extract<ContextSnapshot, { ok: true }>;
  contextPolicyVersion: string;
  action: ContextAction;
  kind: ContextAssetKind;
}): string {
  return [
    "ctx",
    input.identity.userId,
    input.identity.tokenHashPrefix,
    input.snapshot.roleChannelVersion,
    input.snapshot.policyVersion,
    input.contextPolicyVersion,
    input.kind,
    input.action
  ].join("|");
}
