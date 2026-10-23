import type { Identity } from "./identity.js";
import { getPolicyRuntimeStatus, permissionSnapshot } from "./acl.js";
import type { AccessLogEntry } from "./audit.js";

/** Spec 137 / Spec 07: always attach policyVersion; digest when snapshot exists. */
export async function buildAccessLogAuditMeta(
  identity: Identity | null | undefined,
  decisionReason: string
): Promise<Partial<AccessLogEntry>> {
  if (!identity) return { decisionReason };
  const runtimePv = getPolicyRuntimeStatus().policyVersion;
  const snapshot = await permissionSnapshot(identity).catch(() => undefined);
  const tokenMeta: Partial<AccessLogEntry> = {
    tokenLabel: identity.tokenLabel,
    tokenHashPrefix: identity.tokenHashPrefix,
    clientVersion: identity.clientVersion,
    decisionReason,
    policyVersion: runtimePv,
    // Spec 162 §7.6 — the Token's explicit eval mark travels with every row.
    // Absent stays unmarked; it is never derived from User-Agent or token_label.
    evalMark: identity.evalMark === true
  };
  if (!snapshot) return tokenMeta;
  return {
    ...tokenMeta,
    roleIds: snapshot.roleIds,
    permissionSnapshotHash: snapshot.hash,
    effectiveTablesCount: snapshot.effectiveTablesCount,
    policyVersion: snapshot.policyVersion,
    capabilityDigest: snapshot.capabilityDigest,
    permissionSnapshot: {
      hash: snapshot.hash,
      rolesJson: snapshot.rolesJson,
      resolvedJson: snapshot.resolvedJson,
      capabilityDigest: snapshot.capabilityDigest,
      toolClassificationVersion: snapshot.toolClassificationVersion
    }
  };
}
