/**
 * L25-06 OIDC 单点登录 — user-facing copy, single source of truth.
 *
 * The wording is copied verbatim from
 * `docs/specs/lucy-20261025-v0p25-oidc-single-sign-on-spec.md` §9
 * （用户主文案 column）and `webui/docs/00-product-terminology-standard.md` §4.11.
 * Do not reword, do not add a trailing period, and never fall back to a raw
 * server message / IdP response / stack for these codes.
 */

/**
 * Callback failures the server redirects back with as `/login?oidc_error=<CODE>`.
 * Every value is the Spec §9 用户主文案 for that code.
 */
export const OIDC_LOGIN_ERROR_COPY: Readonly<Record<string, string>> = {
  OIDC_LOGIN_INVALID: "单点登录校验失败，请重新发起登录",
  OIDC_LOGIN_FAILED: "身份源未完成登录，请重试或使用本地账户登录",
  OIDC_PROVIDER_UNAVAILABLE: "暂时无法连接身份源，请稍后重试或使用本地账户登录",
  OIDC_ACCOUNT_NOT_BOUND: "该身份尚未绑定 Lucy 登录账户，请联系所有者",
  OIDC_ACCOUNT_UNAVAILABLE: "绑定的登录账户当前不可用，请联系所有者",
  // The callback also redirects with this code when the security state or the
  // audit ledger is unavailable (Spec §6.2 / §9).
  AUTH_STATE_UNAVAILABLE: "认证状态暂不可用，请稍后重试或联系部署人员"
};

/** Spec §9 — OIDC 未启用或本地配置不可用（503）。 */
export const OIDC_NOT_AVAILABLE_COPY = "单点登录当前不可用，请使用本地账户登录或联系部署人员";

/** Spec §9 — 安全状态或审计不可用（503）。 */
export const AUTH_STATE_UNAVAILABLE_COPY = "认证状态暂不可用，请稍后重试或联系部署人员";

/** Unmapped / unknown failure: never render the server message verbatim. */
export const OIDC_GENERIC_COPY = "单点登录未完成，请稍后重试或使用本地账户登录";

/** Generic fallback for owner binding writes: never a stack, never an IdP response. */
export const OIDC_BINDING_GENERIC_COPY = "操作失败，请稍后重试";

/**
 * Spec §5.1 / §7.1 — 本地退出只吊销 Lucy 会话，身份源会话可能仍然有效。
 * Never render 「已退出所有账户」.
 */
export const OIDC_LOGOUT_NOTICE = "已退出 Lucy；组织身份源的登录状态可能仍然有效";

/**
 * Business-rule codes whose backend message is already user-safe Chinese
 * (Spec §9). The backend owns the wording for these; the UI shows it as-is.
 */
export const OIDC_BUSINESS_ERROR_CODES: ReadonlyArray<string> = [
  "OIDC_BINDING_CONFLICT",
  "OIDC_ISSUER_MISMATCH",
  "AUTH_CREDENTIAL_REQUIRED",
  "LOCAL_OWNER_REQUIRED"
];

/** Fixed copy for codes whose backend message must not be echoed. */
export const OIDC_FIXED_ERROR_COPY: Readonly<Record<string, string>> = {
  OIDC_NOT_AVAILABLE: OIDC_NOT_AVAILABLE_COPY,
  AUTH_STATE_UNAVAILABLE: AUTH_STATE_UNAVAILABLE_COPY
};
