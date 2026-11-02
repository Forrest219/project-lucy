/**
 * Optional contact email on a login account.
 *
 * This is not a login key. Local login stays account id + password, and
 * single sign-on still matches `(issuer, sub)` only. A blank value clears
 * the field. Any whitespace is rejected. Letters are stored in lowercase.
 * A usable address needs one `@` and a domain whose last label is a letter
 * suffix such as `.com`. The local part may include an apostrophe, a plus,
 * or a leading underscore. A leading, trailing, or doubled dot is rejected.
 */
export type AccountEmailResult =
  | { ok: true; email: string | null }
  | { ok: false; message: string };

const LOCAL_PART = /^[a-z0-9_'%+-](?:[a-z0-9._'%+-]*[a-z0-9_'%+-])?$/;
const DOMAIN_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const TLD = /^[a-z]{2,24}$/;

export function normalizeAccountEmail(raw: string): AccountEmailResult {
  if (raw === "") return { ok: true, email: null };
  if (/\s/u.test(raw)) return { ok: false, message: "邮箱不能包含空格" };

  const email = raw.toLowerCase();
  const at = email.indexOf("@");
  if (at <= 0 || at !== email.lastIndexOf("@")) {
    return { ok: false, message: "邮箱需要包含 @" };
  }

  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  const labels = domain.split(".");
  const tld = labels[labels.length - 1] ?? "";
  const domainOk =
    labels.length >= 2 &&
    labels.every((label) => DOMAIN_LABEL.test(label)) &&
    TLD.test(tld) &&
    !domain.includes("..");
  if (!domainOk) return { ok: false, message: "邮箱需要包含域名后缀（如 .com）" };
  if (!LOCAL_PART.test(local) || local.includes("..")) {
    return { ok: false, message: "邮箱格式不正确" };
  }
  return { ok: true, email };
}

export function accountEmailTaken(
  config: { admins: ReadonlyArray<{ id: string; email?: string | null }> },
  email: string,
  exceptAdminId?: string
): boolean {
  const needle = email.toLowerCase();
  return config.admins.some(
    (admin) => admin.id !== exceptAdminId && (admin.email ?? "").toLowerCase() === needle && needle !== ""
  );
}
