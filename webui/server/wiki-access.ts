import { parseObjectAcl, type ObjectAcl } from "./proxy/context-acl.js";
import {
  buildWikiAccessSummary,
  classifyAccessDirection,
  loadWikiAccessConfigSnapshot,
  resolveWikiAccessEffects,
  sameCanonicalAcl,
  type AccessDirection,
  type WikiAccessRoleEffect,
  type WikiAccessSummary
} from "./wiki-access-effects.js";
import {
  applyRawAllowedRoles,
  canonicalDeclaration,
  computeWikiAccessDigest,
  mutateWikiAccessUnlocked,
  normalizeRequestedRoles,
  readAclDeclaration,
  readWikiBytes,
  WikiAccessError
} from "./wiki-access-operation.js";
import { readWikiAccessPendingChange } from "./wiki-access-holds.js";
import { createWikiVersionSnapshot } from "./wiki.js";
import { systemActor, type TrustedActor } from "./security/request-actor.js";
import { wikiContentHash } from "./wiki-hash.js";
import { normalizeWikiKey } from "./wiki-key.js";
import { withWikiWriteQueue } from "./wiki-write-queue.js";

/**
 * Spec 193 §6 — the independent, single-document authorization management.
 *
 * The authorization is an OBJECT fact of the Markdown file. This service
 * changes ONLY `allowed_roles`:
 *
 * - the body is preserved verbatim,
 * - every unknown frontmatter field keeps its value,
 * - a canonical no-op writes no file, creates no audit row and no version,
 * - a widening is held until the durable security operation is committed.
 */

export interface WikiAccessPreviewResult {
  key: string;
  file_version: string;
  current_acl: ObjectAcl;
  next_acl: ObjectAcl;
  direction: AccessDirection;
  noop: boolean;
  role_effects: WikiAccessRoleEffect[];
  declared_role_count: number | null;
  declared_without_discover: number;
  declared_without_read: number;
  role_channel_version: string;
  preview_digest: string;
}

export interface WikiAccessSaveResult {
  status: "applied" | "noop";
  key: string;
  file_version: string;
  acl: ObjectAcl;
  direction: AccessDirection;
  role_effects: WikiAccessRoleEffect[];
  role_channel_version: string;
}

function aclOfDeclaration(declaration: { declared: boolean; value: unknown }): ObjectAcl {
  return parseObjectAcl(declaration.value, declaration.declared);
}

function notFound(key: string): WikiAccessError {
  return new WikiAccessError("WIKI_NOT_FOUND", `Wiki 文档不存在：${key}`, 404);
}

/**
 * The full authorization summary of one document.
 *
 * It carries the Role channel effects and the affected Agent ids — the list
 * response deliberately does not.
 */
export async function getWikiAccessSummary(
  projectRoot: string,
  rawKey: string
): Promise<WikiAccessSummary> {
  const key = normalizeWikiKey(rawKey);
  const currentText = await readWikiBytes(projectRoot, key);
  if (currentText === null) throw notFound(key);
  const snapshot = await loadWikiAccessConfigSnapshot(projectRoot);
  const pending = await readWikiAccessPendingChange(key);
  return buildWikiAccessSummary({
    key,
    file_version: wikiContentHash(currentText),
    acl: aclOfDeclaration(readAclDeclaration(currentText)),
    snapshot,
    pending_change: pending
  });
}

/**
 * The authorization preview.
 *
 * The digest binds the key, the current document version, the normalized
 * candidate ACL and the global Role / channel / Agent version.
 */
export async function previewWikiAccess(
  projectRoot: string,
  rawKey: string,
  input: { allowed_roles: unknown; expected_version?: string }
): Promise<WikiAccessPreviewResult> {
  const key = normalizeWikiKey(rawKey);
  const currentText = await readWikiBytes(projectRoot, key);
  if (currentText === null) throw notFound(key);
  if (!input.expected_version?.trim()) {
    throw new WikiAccessError("wiki_expected_version_required", "缺少文档版本。", 428);
  }
  const currentVersion = wikiContentHash(currentText);
  if (input.expected_version.trim() !== currentVersion) {
    throw new WikiAccessError("wiki_write_conflict", "文档已被其他修改更新，请刷新后重试。", 409);
  }

  const currentAcl = aclOfDeclaration(readAclDeclaration(currentText));
  const normalized = normalizeRequestedRoles(input.allowed_roles);
  const nextAcl = parseObjectAcl(normalized, true);
  const snapshot = await loadWikiAccessConfigSnapshot(projectRoot);
  const effects = resolveWikiAccessEffects(nextAcl, snapshot);
  const preview_digest = computeWikiAccessDigest({
    key,
    expectedVersion: currentVersion,
    nextAcl,
    roleChannelVersion: snapshot.role_channel_version
  });

  return {
    key,
    file_version: currentVersion,
    current_acl: currentAcl,
    next_acl: nextAcl,
    direction: classifyAccessDirection(currentAcl, nextAcl),
    noop: sameCanonicalAcl(currentAcl, nextAcl),
    role_effects: effects.role_effects,
    declared_role_count: effects.declared_role_count,
    declared_without_discover: effects.declared_without_discover,
    declared_without_read: effects.declared_without_read,
    role_channel_version: snapshot.role_channel_version,
    preview_digest
  };
}

/**
 * Save the authorization of one document.
 *
 * The write runs inside the shared Wiki write queue and through the ONE
 * coordinated mutation, so a widening is held until the durable security
 * operation is committed.
 */
export async function saveWikiAccess(
  projectRoot: string,
  rawKey: string,
  input: { allowed_roles: unknown; expected_version?: string; preview_digest?: string },
  actor?: TrustedActor
): Promise<WikiAccessSaveResult> {
  const key = normalizeWikiKey(rawKey);
  const expectedVersion = input.expected_version?.trim() ?? "";
  if (!expectedVersion) {
    throw new WikiAccessError("wiki_expected_version_required", "缺少文档版本。", 428);
  }
  const previewDigest = input.preview_digest?.trim() ?? "";
  if (!previewDigest) {
    throw new WikiAccessError("wiki_access_preview_stale", "缺少授权预检摘要，请重新预检。", 409);
  }
  const normalized = normalizeRequestedRoles(input.allowed_roles);
  const nextAcl = parseObjectAcl(normalized, true);

  const result = await withWikiWriteQueue(() =>
    mutateWikiAccessUnlocked({
      projectRoot,
      key,
      expectedVersion,
      existence: "must_exist",
      buildTarget: (currentText) => ({
        targetMarkdown: applyRawAllowedRoles(currentText, canonicalDeclaration(nextAcl)),
        nextAcl
      }),
      actor: actor ?? systemActor(),
      versionOperation: "access_update",
      changeType: "wiki_access_update",
      expectedDigest: previewDigest,
      computeDigest: ({ expectedVersion: version, nextAcl: acl, roleChannelVersion }) =>
        computeWikiAccessDigest({
          key,
          expectedVersion: version,
          nextAcl: acl,
          roleChannelVersion
        }),
      noOpWhen: (current, next) => sameCanonicalAcl(current, next),
      writeVersionSnapshot: async (markdown) => {
        await createWikiVersionSnapshot(projectRoot, key, markdown, {
          operation: "access_update"
        });
      }
    })
  );

  const snapshot = await loadWikiAccessConfigSnapshot(projectRoot);
  const effects = resolveWikiAccessEffects(result.acl, snapshot);
  return {
    status: result.status,
    key: result.key,
    file_version: result.fileVersion,
    acl: result.acl,
    direction: result.direction,
    role_effects: effects.role_effects,
    role_channel_version: snapshot.role_channel_version
  };
}
