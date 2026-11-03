/**
 * L25-04 / Spec 业务 Skill 负责人: the `owner` frontmatter contract.
 *
 * `owner` is a free-text governance label (a person or a team). It is never an
 * account, a role, an authorization source, or a notification target, so it
 * carries no runtime meaning beyond display and audit.
 *
 * Strictness is the point of this module. The generic frontmatter handling in
 * `loader.ts` stringifies whatever it finds (name/title/version/description);
 * a corrupt `owner` must NOT be stringified into a plausible-looking label.
 * It is disclosed as invalid instead, the same way a corrupt `roles_allowed`
 * is disclosed.
 */

/** Spec §3.1: trim 后 0–80 个 Unicode code point。 */
export const SKILL_OWNER_MAX_CODE_POINTS = 80;

/** Spec §4.1: the only new error code this feature introduces. */
export const SKILL_OWNER_INVALID_CODE = "skill_owner_invalid";

/** C0 (U+0000–U+001F), DEL (U+007F) and C1 (U+0080–U+009F). */
const CONTROL_CHARACTERS = /[\u0000-\u001F\u007F-\u009F]/;

export type ParsedOwner = {
  /** The normalized label; empty means "unspecified". */
  value: string;
  /** True when the stored declaration is corrupt and must be repaired explicitly. */
  invalid: boolean;
};

export function containsControlCharacter(value: string): boolean {
  return CONTROL_CHARACTERS.test(value);
}

export function countCodePoints(value: string): number {
  return [...value].length;
}

/**
 * Spec §6 `parseOwner`: a missing key is "unspecified" (not an error); anything
 * that is not a legal string is a corrupt declaration.
 */
export function parseOwner(raw: unknown, present: boolean): ParsedOwner {
  if (!present) {
    return { value: "", invalid: false };
  }
  if (typeof raw !== "string") {
    return { value: "", invalid: true };
  }
  const normalized = raw.trim();
  if (countCodePoints(normalized) > SKILL_OWNER_MAX_CODE_POINTS) {
    return { value: "", invalid: true };
  }
  // The control-character check runs on the RAW value: a trailing "\n" must not be
  // silently trimmed away, because the same text ends up in a table cell.
  if (containsControlCharacter(raw)) {
    return { value: "", invalid: true };
  }
  return { value: normalized, invalid: false };
}

/**
 * Write-side validation (Spec §3.1 / §6 `validateOwner`): a rejected value never
 * reaches the file, and the caller turns the code into the single stable error
 * code the API contract allows.
 */
export function validateOwnerInput(
  raw: unknown
): { ok: true; value: string } | { ok: false; code: string } {
  if (typeof raw !== "string") {
    return { ok: false, code: SKILL_OWNER_INVALID_CODE };
  }
  const normalized = raw.trim();
  if (countCodePoints(normalized) > SKILL_OWNER_MAX_CODE_POINTS) {
    return { ok: false, code: SKILL_OWNER_INVALID_CODE };
  }
  if (containsControlCharacter(raw)) {
    return { ok: false, code: SKILL_OWNER_INVALID_CODE };
  }
  return { ok: true, value: normalized };
}
