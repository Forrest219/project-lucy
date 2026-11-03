import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  FRONTMATTER_ENGINE_FORBIDDEN,
  FrontmatterEngineForbiddenError,
  parseMarkdownFrontmatter,
  stringifyMarkdownFrontmatter
} from "./markdown-frontmatter.js";
import { assertWritableAcl, parseObjectAcl, type ObjectAcl } from "./proxy/context-acl.js";
import { loadContentPaths } from "./paths.js";
import { assertReadable } from "./fs-safe.js";
import { auditedWriteFile } from "./admin/config-audit-write.js";
import { auditActorFields, type TrustedActor } from "./security/request-actor.js";
import { getSecurityStore } from "./security/instance.js";
import type { SecurityStore } from "./security/store.js";
import { withWikiWriteQueue } from "./wiki-write-queue.js";
import { wikiContentHash } from "./wiki-hash.js";
import { normalizeWikiKey } from "./wiki-key.js";
import { invalidateWikiAccessHoldCache } from "./wiki-access-holds.js";
import {
  classifyAccessDirection,
  loadWikiAccessConfigSnapshot,
  type AccessDirection,
  type WikiAccessConfigSnapshot
} from "./wiki-access-effects.js";

/**
 * Spec 193 §8 — the ONE coordinated authorization mutation.
 *
 * Every write that can change a Wiki document's `allowed_roles` goes through
 * {@link mutateWikiAccessUnlocked}: the single access drawer, the upload
 * create / replace path, the combined Markdown editor save and the bulk
 * authorization run. There is no second, simpler write path for ACL changes —
 * a bypass would skip the widening hold and the crash reconciliation.
 *
 * The security order is fixed:
 *
 * 1. refuse a key that carries an unresolved widening,
 * 2. read the current bytes ONCE and check `expected_version`,
 * 3. build the candidate from THOSE bytes,
 * 4. return `noop` when nothing changed (no file, no audit, no version),
 * 5. recompute the Role / channel / Agent effect and verify the digest,
 * 6. classify the direction,
 * 7. prepare the durable security operation AND activate the hold (one transaction),
 * 8. durable config-audit intent,
 * 9. atomic Markdown write,
 * 10. durable audit terminal — with a rollback when the terminal fails,
 * 11. version snapshot (and the batch journal row),
 * 12. commit the security operation AND release the hold (one transaction).
 *
 * A crash between 7 and 12 leaves a hold: the key stays denied to Agent
 * search and read, and recovery turns it into `needs_review`. It is never
 * ratified automatically.
 */

export class WikiAccessError extends Error {
  readonly code: string;
  readonly statusCode: number;

  constructor(code: string, message: string, statusCode = 400) {
    super(message);
    this.name = "WikiAccessError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

export type WikiAclVersionOperation =
  | "create"
  | "edit_save"
  | "upload_create"
  | "upload_replace"
  | "access_update";

export interface WikiAclMutationResult {
  status: "applied" | "noop";
  key: string;
  /** `sha256:<hex>` of the bytes on disk after the mutation. */
  fileVersion: string;
  acl: ObjectAcl;
  direction: AccessDirection;
  /** The durable security operation id (absent for a no-op). */
  operationId: string | null;
}

export interface WikiAclMutationInput {
  projectRoot: string;
  /** The canonical Wiki key. */
  key: string;
  /** The hash of the bytes the caller believes are stored. */
  expectedVersion: string;
  /**
   * The target's existence contract, re-checked INSIDE the queue.
   *
   * - `must_exist` — the document has to exist (ACL save, replace upload).
   * - `must_not_exist` — the document has to be absent (create upload). A
   *   create is never silently turned into a replace.
   */
  existence?: "must_exist" | "must_not_exist";
  /**
   * Build the candidate from the CURRENT bytes read inside the queue.
   *
   * The helper receives the exact text that was read for the version check,
   * so the candidate can never be built from a stale preview.
   */
  buildTarget: (
    currentText: string
  ) =>
    | { targetMarkdown: string; nextAcl: ObjectAcl }
    | Promise<{ targetMarkdown: string; nextAcl: ObjectAcl }>;
  actor: TrustedActor;
  versionOperation: WikiAclVersionOperation;
  /** Config-audit change type. */
  changeType: string;
  /**
   * A canonical no-op test.
   *
   * When it returns `true`, the mutation writes nothing: no file, no audit
   * row and no version. It exists because a re-serialized frontmatter can
   * differ byte-wise from the stored one even when the authorization did not
   * change at all.
   */
  noOpWhen?: (current: ObjectAcl, next: ObjectAcl) => boolean;
  /** Optional digest the caller must match against the recomputed candidate. */
  expectedDigest?: string;
  /** Recompute the digest from the CURRENT facts. */
  computeDigest?: (input: {
    key: string;
    expectedVersion: string;
    nextAcl: ObjectAcl;
    roleChannelVersion: string;
    targetMarkdown: string;
  }) => string;
  /**
   * A shared batch operation id. Every per-file audit of one bulk run uses it
   * as `requestId`, so the per-file audit rows correlate with the batch.
   */
  sharedOperationId?: string;
  /**
   * Persist the Wiki version snapshot for the written bytes.
   *
   * It runs only after the audited write succeeded. The caller owns it so the
   * coordinator stays free of a dependency on the Wiki service module.
   */
  writeVersionSnapshot?: (markdown: string) => Promise<void>;
  /** Called after a successful write (the bulk journal records the result). */
  onApplied?: (info: {
    operationId: string;
    targetHash: string;
    direction: AccessDirection;
    nextAcl: ObjectAcl;
  }) => Promise<void> | void;
  /** Called when the mutation ended up in `needs_review`. */
  onNeedsReview?: (info: { operationId: string; reason: string }) => Promise<void> | void;
}

/* -------------------------------------------------------------------------- */
/* Small helpers                                                              */
/* -------------------------------------------------------------------------- */

export { wikiContentHash } from "./wiki-hash.js";

function relPathForKey(key: string): string {
  return path.posix.join("wiki", normalizeWikiKey(key));
}

/**
 * Read the exact current bytes of a Wiki document.
 *
 * `null` means "the document does not exist"; the caller decides whether that
 * is a create or a conflict.
 */
export async function readWikiBytes(
  projectRoot: string,
  key: string
): Promise<string | null> {
  const normalized = normalizeWikiKey(key);
  try {
    const paths = await loadContentPaths();
    const abs = await assertReadable(paths, projectRoot, relPathForKey(normalized));
    return await readFile(abs, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

/**
 * The canonical ACL of a Markdown text.
 *
 * `declared` distinguishes "the field is absent" from "the field is empty" —
 * both deny every Agent but they are different declarations.
 */
export function aclOfMarkdown(markdown: string): ObjectAcl {
  let parsed: { data: Record<string, unknown> };
  try {
    parsed = parseMarkdownFrontmatter(markdown);
  } catch (error) {
    if (isFrontmatterEngineError(error)) throw error;
    throw new WikiAccessError(
      "wiki_access_frontmatter_invalid",
      `文档属性无法解析，未写入任何内容：${error instanceof Error ? error.message : String(error)}`,
      400
    );
  }
  return parseObjectAcl(
    parsed.data.allowed_roles,
    Object.prototype.hasOwnProperty.call(parsed.data, "allowed_roles")
  );
}

/**
 * Replace ONLY the `allowed_roles` declaration of a Markdown text.
 *
 * The body is preserved verbatim and every unknown frontmatter field keeps
 * its value. `roles = null` keeps the declaration exactly as it is (used by
 * `preserve_current`, which must not turn a missing declaration into an
 * explicit empty one and must not repair a corrupt one behind the admin's
 * back).
 */
export function applyAllowedRoles(markdown: string, roles: string[] | null): string {
  if (roles === null) return markdown;
  let parsed: { data: Record<string, unknown>; content: string };
  try {
    parsed = parseMarkdownFrontmatter(markdown);
  } catch (error) {
    if (isFrontmatterEngineError(error)) throw error;
    throw new WikiAccessError(
      "wiki_access_frontmatter_invalid",
      `文档属性无法解析，未写入任何内容：${error instanceof Error ? error.message : String(error)}`,
      400
    );
  }
  const data: Record<string, unknown> = { ...parsed.data, allowed_roles: roles };
  try {
    return stringifyMarkdownFrontmatter(parsed.content, data);
  } catch (error) {
    if (isFrontmatterEngineError(error)) throw error;
    throw new WikiAccessError(
      "wiki_access_frontmatter_invalid",
      `文档属性无法写回，未写入任何内容：${error instanceof Error ? error.message : String(error)}`,
      400
    );
  }
}

/** Normalize a requested role list into the exact declaration to write. */
export function normalizeRequestedRoles(value: unknown): string[] {
  try {
    return assertWritableAcl(value);
  } catch (error) {
    throw new WikiAccessError(
      "CONTEXT_ACL_INVALID",
      error instanceof Error ? error.message : "object ACL is invalid",
      400
    );
  }
}

/**
 * The RAW `allowed_roles` declaration of a Markdown text.
 *
 * `value` stays `unknown` on purpose: a corrupt declaration (a string, a
 * number, a mixed wildcard list) must be preserved verbatim by
 * `preserve_current` instead of being silently repaired.
 */
export interface RawAclDeclaration {
  declared: boolean;
  value: unknown;
}

export function readAclDeclaration(markdown: string): RawAclDeclaration {
  let parsed: { data: Record<string, unknown> };
  try {
    parsed = parseMarkdownFrontmatter(markdown);
  } catch (error) {
    if (isFrontmatterEngineError(error)) throw error;
    throw new WikiAccessError(
      "wiki_access_frontmatter_invalid",
      `文档属性无法解析：${error instanceof Error ? error.message : String(error)}`,
      400
    );
  }
  if (!Object.prototype.hasOwnProperty.call(parsed.data, "allowed_roles")) {
    return { declared: false, value: undefined };
  }
  return { declared: true, value: parsed.data.allowed_roles };
}

/**
 * Write a RAW declaration into the frontmatter.
 *
 * A declaration that was not declared removes the key again, so
 * `preserve_current` never turns "the admin never chose a role" into an
 * explicit empty ACL.
 */
export function applyRawAllowedRoles(markdown: string, declaration: RawAclDeclaration): string {
  let parsed: { data: Record<string, unknown>; content: string };
  try {
    parsed = parseMarkdownFrontmatter(markdown);
  } catch (error) {
    if (isFrontmatterEngineError(error)) throw error;
    throw new WikiAccessError(
      "wiki_access_frontmatter_invalid",
      `文档属性无法解析，未写入任何内容：${error instanceof Error ? error.message : String(error)}`,
      400
    );
  }
  const data: Record<string, unknown> = { ...parsed.data };
  if (declaration.declared) {
    data.allowed_roles = declaration.value;
  } else {
    delete data.allowed_roles;
  }
  try {
    return stringifyMarkdownFrontmatter(parsed.content, data);
  } catch (error) {
    if (isFrontmatterEngineError(error)) throw error;
    throw new WikiAccessError(
      "wiki_access_frontmatter_invalid",
      `文档属性无法写回，未写入任何内容：${error instanceof Error ? error.message : String(error)}`,
      400
    );
  }
}

/** The canonical declaration that expresses an ACL state. */
export function canonicalDeclaration(acl: ObjectAcl): RawAclDeclaration {
  if (acl.state === "missing") return { declared: false, value: undefined };
  if (acl.state === "empty") return { declared: true, value: [] };
  if (acl.state === "all") return { declared: true, value: ["*"] };
  if (acl.state === "roles") return { declared: true, value: [...acl.roles] };
  return { declared: true, value: undefined };
}

/* -------------------------------------------------------------------------- */
/* Upload authorization selection (Spec 193 §9.1)                             */
/* -------------------------------------------------------------------------- */

export type WikiUploadAccessSelection =
  | { mode: "preserve_current" }
  | { mode: "use_uploaded" }
  | { mode: "set"; allowed_roles: string[] };

export interface WikiAccessIssue {
  code: string;
  message: string;
  blocking: boolean;
}

export interface WikiUploadAclResolution {
  /** The declaration to write. */
  declaration: RawAclDeclaration;
  /** The canonical ACL of the result. */
  acl: ObjectAcl;
  /** Problems that block the commit. */
  issues: WikiAccessIssue[];
}

/**
 * Resolve the authorization an upload will write (Spec 193 §9.1).
 *
 * - `preserve_current` requires an existing target and carries the CURRENT
 *   declaration over verbatim — including a corrupt one, whose deny state is
 *   not silently repaired.
 * - `use_uploaded` requires a legal uploaded declaration; a corrupt one is
 *   refused with `CONTEXT_ACL_INVALID`.
 * - `set` always replaces the uploaded declaration with the normalized value.
 */
export function resolveUploadAcl(input: {
  exists: boolean;
  currentDeclaration: RawAclDeclaration;
  uploadedDeclaration: RawAclDeclaration;
  selection: WikiUploadAccessSelection;
}): WikiUploadAclResolution {
  const uploadedAcl = parseObjectAcl(
    input.uploadedDeclaration.value,
    input.uploadedDeclaration.declared
  );

  if (input.selection.mode === "preserve_current") {
    if (!input.exists) {
      throw new WikiAccessError(
        "wiki_upload_access_required",
        "保留现有授权只能用于覆盖已存在的文档。",
        400
      );
    }
    const currentAcl = parseObjectAcl(
      input.currentDeclaration.value,
      input.currentDeclaration.declared
    );
    return { declaration: input.currentDeclaration, acl: currentAcl, issues: [] };
  }

  if (input.selection.mode === "use_uploaded") {
    if (uploadedAcl.state === "corrupt") {
      throw new WikiAccessError(
        "CONTEXT_ACL_INVALID",
        "上传文件内的授权声明已损坏，请重新设置后再提交。",
        400
      );
    }
    return {
      declaration: canonicalDeclaration(uploadedAcl),
      acl: uploadedAcl,
      issues: []
    };
  }

  if (input.selection.mode === "set") {
    const normalized = normalizeRequestedRoles(input.selection.allowed_roles);
    const acl = parseObjectAcl(normalized, true);
    return { declaration: canonicalDeclaration(acl), acl, issues: [] };
  }

  throw new WikiAccessError(
    "wiki_upload_access_required",
    "上传必须携带明确的授权选择。",
    400
  );
}

/** The selection the server suggests for the current target state. */
export function suggestUploadAccessSelection(input: {
  exists: boolean;
  uploadedAcl: ObjectAcl;
}): WikiUploadAccessSelection {
  if (input.exists) return { mode: "preserve_current" };
  return { mode: "use_uploaded" };
}

/**
 * The digest that binds a preview to the facts it was computed from.
 *
 * It binds the target key, the expected document version, the mode (when the
 * caller has one), the content hash (when the caller has one), the normalized
 * candidate ACL and the global Role / channel / Agent version.
 */
export function computeWikiAccessDigest(input: {
  key: string;
  expectedVersion: string;
  nextAcl: ObjectAcl;
  roleChannelVersion: string;
  mode?: string;
  contentHash?: string;
}): string {
  const acl =
    input.nextAcl.state === "roles"
      ? { state: input.nextAcl.state, roles: [...input.nextAcl.roles].sort() }
      : { state: input.nextAcl.state };
  const payload = JSON.stringify({
    key: input.key,
    expectedVersion: input.expectedVersion,
    mode: input.mode ?? null,
    contentHash: input.contentHash ?? null,
    acl,
    roleChannelVersion: input.roleChannelVersion
  });
  return `wac-${createHash("sha256").update(payload).digest("hex").slice(0, 32)}`;
}

/* -------------------------------------------------------------------------- */
/* The widening hold                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Fail-closed hold projection (Spec 193 §8.2).
 *
 * `true` when the key carries an unresolved widening. A store failure is NOT
 * "not held": it is an error, and the caller must keep denying.
 */
export async function isWikiAccessWideningHeld(key: string): Promise<boolean> {
  const store = await getSecurityStore();
  if (!store.ok) {
    throw new WikiAccessError(
      "SECURITY_STORE_UNAVAILABLE",
      "安全状态存储不可用，该文档暂时保持拒绝。",
      503
    );
  }
  const held = store.value.isWikiAccessWideningHeld(key);
  if (!held.ok) {
    throw new WikiAccessError(
      "SECURITY_STORE_UNAVAILABLE",
      "安全状态存储不可用，该文档暂时保持拒绝。",
      503
    );
  }
  return held.value;
}

/**
 * Refuse every write on a key that carries an unresolved widening.
 *
 * Only the operation's own rollback / recovery helper may write the old
 * bytes back. This is what keeps a hash re-check from being broken by a
 * third-party write and what keeps an uncommitted widening from being moved
 * to another key.
 */
export async function assertWikiKeyNotHeld(key: string): Promise<void> {
  const held = await isWikiAccessWideningHeld(key);
  if (held) {
    throw new WikiAccessError(
      "wiki_access_change_pending",
      "该文档存在待核对的授权变更，当前禁止继续写入。",
      409
    );
  }
}

export { readWikiAccessPendingChange } from "./wiki-access-holds.js";

/* -------------------------------------------------------------------------- */
/* The coordinated mutation                                                   */
/* -------------------------------------------------------------------------- */

async function loadStore(): Promise<SecurityStore> {
  const store = await getSecurityStore();
  if (!store.ok) {
    throw new WikiAccessError(
      "SECURITY_STORE_UNAVAILABLE",
      "安全状态存储不可用，未写入任何内容。",
      503
    );
  }
  return store.value;
}

/**
 * True when the error is the frontmatter engine refusal (V-08).
 *
 * The access layer must NOT mask it: an unsupported frontmatter language is
 * rejected with `FRONTMATTER_ENGINE_FORBIDDEN` before any engine runs, and
 * the contract for that refusal is owned by the Markdown engine, not by the
 * authorization code.
 */
function isFrontmatterEngineError(error: unknown): boolean {
  if (error instanceof FrontmatterEngineForbiddenError) return true;
  return String((error as { code?: unknown } | null)?.code ?? "") === FRONTMATTER_ENGINE_FORBIDDEN;
}

/**
 * True when the error is a raw audit-store (SQLite) failure.
 *
 * The audit layer maps its own failures to `config_audit_*` codes, but a
 * driver-level failure (`SQLITE_READONLY`, `SQLITE_CANTOPEN`, …) escapes as
 * the driver's own error. Spec 193 §7.4.5 treats an audit-library failure as
 * SYSTEMIC: the run must stop and leave the remaining documents `not_run`
 * instead of continuing to write Wiki files.
 */
function isAuditStoreFailure(error: unknown): boolean {
  const code = String((error as { code?: unknown } | null)?.code ?? "");
  if (code.startsWith("SQLITE_")) return true;
  const name = String((error as { name?: unknown } | null)?.name ?? "");
  return name === "SqliteError";
}

function mapAuditFailure(error: unknown): never {
  const code = String((error as { code?: unknown } | null)?.code ?? "");
  if (
    code === "config_audit_intent_unavailable" ||
    code === "config_audit_rolled_back" ||
    code === "config_audit_rollback_failed" ||
    isAuditStoreFailure(error)
  ) {
    throw new WikiAccessError(
      "config_audit_unavailable",
      "配置审计不可用，变更未生效。",
      503
    );
  }
  throw error;
}

export async function mutateWikiAccessUnlocked(
  input: WikiAclMutationInput
): Promise<WikiAclMutationResult> {
  // ONE canonical key for the file path, the hold projection, the security
  // operation and the version snapshot.
  const key = normalizeWikiKey(input.key);

  // 1. An unresolved widening blocks every other mutation of this key.
  await assertWikiKeyNotHeld(key);

  // 2. Read the current bytes ONCE. The version check and the candidate are
  //    derived from the same read.
  const existence = input.existence ?? "must_exist";
  const storedText = await readWikiBytes(input.projectRoot, key);
  if (existence === "must_not_exist") {
    if (storedText !== null) {
      throw new WikiAccessError(
        "wiki_write_conflict",
        "目标 Wiki 文档已存在，请刷新后选择覆盖。",
        409
      );
    }
  } else if (storedText === null) {
    throw new WikiAccessError("wiki_write_conflict", "目标 Wiki 文档不存在。", 409);
  }
  const currentText = storedText ?? "";
  if (existence === "must_exist") {
    if (!input.expectedVersion?.trim()) {
      throw new WikiAccessError("wiki_expected_version_required", "缺少文档版本。", 428);
    }
    if (input.expectedVersion.trim() !== wikiContentHash(currentText)) {
      throw new WikiAccessError("wiki_write_conflict", "文档已被其他修改更新，请刷新后重试。", 409);
    }
  }
  const effectiveExpectedVersion = existence === "must_not_exist" ? wikiContentHash("") : input.expectedVersion.trim();

  const currentAcl = aclOfMarkdown(currentText);

  // 3. Build the candidate from the same bytes.
  const target = await input.buildTarget(currentText);

  // 4. Recompute the global Role / channel / Agent effect and verify the
  //    digest the client was given. The digest is checked BEFORE the no-op
  //    shortcut: a stale Role graph must be reported even when nothing would
  //    have been written.
  const snapshot: WikiAccessConfigSnapshot = await loadWikiAccessConfigSnapshot(input.projectRoot);
  if (input.expectedDigest !== undefined) {
    const recomputed = input.computeDigest
      ? input.computeDigest({
          key,
          expectedVersion: effectiveExpectedVersion,
          nextAcl: target.nextAcl,
          roleChannelVersion: snapshot.role_channel_version,
          targetMarkdown: target.targetMarkdown
        })
      : computeWikiAccessDigest({
          key,
          expectedVersion: effectiveExpectedVersion,
          nextAcl: target.nextAcl,
          roleChannelVersion: snapshot.role_channel_version
        });
    if (recomputed !== input.expectedDigest) {
      throw new WikiAccessError(
        "wiki_access_preview_stale",
        "授权预检已过期，请刷新后重新确认。",
        409
      );
    }
  }

  // 5. A change that produces identical bytes — or that the caller declares
  //    canonically unchanged — is a no-op: no file write, no audit record and
  //    no new version.
  if (input.noOpWhen?.(currentAcl, target.nextAcl)) {
    return {
      status: "noop",
      key,
      fileVersion: effectiveExpectedVersion,
      acl: currentAcl,
      direction: classifyAccessDirection(currentAcl, currentAcl),
      operationId: null
    };
  }
  const targetHash = wikiContentHash(target.targetMarkdown);
  if (targetHash === effectiveExpectedVersion) {
    return {
      status: "noop",
      key,
      fileVersion: effectiveExpectedVersion,
      acl: currentAcl,
      direction: classifyAccessDirection(currentAcl, currentAcl),
      operationId: null
    };
  }

  // 6. Classify the direction on the normalized runtime set.
  const direction = classifyAccessDirection(currentAcl, target.nextAcl);
  // The security operation id is always unique per file. The audit request id
  // may be SHARED: one bulk run correlates all of its per-file audit rows.
  const operationId = `wac-${randomUUID()}`;
  const auditRequestId = input.sharedOperationId ?? operationId;

  // 7. Prepare the durable operation AND activate the hold in ONE transaction.
  const store = await loadStore();
  const prepared = store.prepareWikiAccessOperation({
    operationId,
    wikiKey: key,
    direction,
    actor: input.actor.actorId,
    actorType: input.actor.actorType,
    oldHash: effectiveExpectedVersion,
    targetHash,
    summary: `wiki_access:${key}`,
    traceId: input.actor.requestId ?? undefined
  });
  if (!prepared.ok) {
    throw new WikiAccessError(
      "SECURITY_STORE_UNAVAILABLE",
      "安全状态存储不可用，未写入任何内容。",
      503
    );
  }
  // The key is held from this moment on: the next Agent request must be
  // refused for both search and read.
  invalidateWikiAccessHoldCache();

  try {
    // 8-10. Durable audit intent → atomic write → durable audit terminal.
    try {
      await auditedWriteFile(input.projectRoot, relPathForKey(key), target.targetMarkdown, {
        enabled: true,
        changeType: input.changeType,
        assetKind: "wiki",
        ...auditActorFields(input.actor),
        source: "wiki_api",
        targetId: key,
        operation: input.versionOperation,
        requestId: auditRequestId,
        oldSummary: { acl: currentAcl.state },
        newSummary: { acl: target.nextAcl.state }
      }, {
        requireIntent: true,
        rollbackOnTerminalFailure: true
      });
    } catch (error) {
      mapAuditFailure(error);
    }

    // 11. The version snapshot / batch journal row.
    if (input.writeVersionSnapshot) {
      await input.writeVersionSnapshot(target.targetMarkdown);
    }
    await input.onApplied?.({ operationId, targetHash, direction, nextAcl: target.nextAcl });

    // 12. Commit the operation AND release the hold in ONE transaction.
    const committed = store.commitWikiAccessOperation(operationId, input.actor.actorId, input.actor.actorType);
    invalidateWikiAccessHoldCache();
    if (!committed.ok) {
      throw new WikiAccessError(
        "SECURITY_STORE_UNAVAILABLE",
        "安全状态存储不可用，请核对该文档的授权状态。",
        503
      );
    }

    return {
      status: "applied",
      key,
      fileVersion: targetHash,
      acl: target.nextAcl,
      direction,
      operationId
    };
  } catch (error) {
    // Reconcile the evidence. A widening whose bytes reached the disk but
    // whose security state was not committed is NEVER ratified: it becomes
    // `needs_review` and the hold stays.
    const current = await readWikiBytes(input.projectRoot, key).catch(() => null);
    const currentHash = current === null ? null : wikiContentHash(current);
    const evidence =
      currentHash === effectiveExpectedVersion
        ? "not_applied"
        : currentHash === targetHash
          ? "applied"
          : "unknown";

    if (evidence === "not_applied") {
      store.abortWikiAccessOperation(operationId, "recovered: the previous bytes are still stored", input.actor.actorId, input.actor.actorType);
      invalidateWikiAccessHoldCache();
      throw error;
    }

    if (direction === "widen") {
      store.markWikiAccessOperationNeedsReview(
        operationId,
        "the target bytes are stored but the security operation was not committed"
      );
      invalidateWikiAccessHoldCache();
      await input.onNeedsReview?.({ operationId, reason: "widening_requires_operator_review" });
      throw new WikiAccessError(
        "wiki_access_change_pending",
        "授权扩权未能提交，该文档已保持拒绝并等待运维核对。",
        409
      );
    }

    if (evidence === "applied") {
      // A narrowing / neutral change may be committed by the existing
      // recovery rule — but the write is never replayed.
      store.commitWikiAccessOperation(operationId, "recovery", "system");
      invalidateWikiAccessHoldCache();
    } else {
      store.markWikiAccessOperationNeedsReview(operationId, "the stored bytes do not match the operation evidence");
      invalidateWikiAccessHoldCache();
      await input.onNeedsReview?.({ operationId, reason: "evidence_unknown" });
      throw new WikiAccessError(
        "wiki_access_change_pending",
        "授权变更状态无法核对，该文档已保持拒绝并等待运维核对。",
        409
      );
    }

    throw error;
  }
}

/**
 * The public, queue-acquiring entry point.
 *
 * The caller does NOT hold the queue here.
 */
export function saveWikiAccess(
  input: WikiAclMutationInput
): Promise<WikiAclMutationResult> {
  return withWikiWriteQueue(() => mutateWikiAccessUnlocked(input));
}
