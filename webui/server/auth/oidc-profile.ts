/**
 * Enterprise OIDC profile.
 *
 * v0.25 L25-06 loads this shape exactly once per process (see `oidc-runtime.ts`).
 * Loading never contacts the issuer, the profile alone never opens a login method
 * (the client secret file must be valid too), and the client secret never travels
 * inline with the profile.
 */

export const ACTIVE_LOGIN_METHODS = ["local"] as const;

/** Login methods exposed on the public auth status endpoint. */
export const LOGIN_METHOD_LOCAL = "local";
export const LOGIN_METHOD_OIDC = "oidc";

export type OidcTokenEndpointAuth = "client_secret_post" | "client_secret_basic";
export type OidcLogoutStyle = "id_token_hint" | "access_token";

export type OidcProfile = {
  issuer: string;
  discoveryUrl?: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  jwksUri: string;
  /** Reserved: this release never calls the provider's logout endpoint. */
  endSessionEndpoint?: string;
  clientId: string;
  scopes: string;
  tokenEndpointAuth: OidcTokenEndpointAuth;
  /** Reserved: this release never seals a logout hint. */
  logoutStyle?: OidcLogoutStyle;
  redirectPath: string;
  publicWebuiUrl: string;
};

export class OidcProfileError extends Error {
  readonly code = "OIDC_PROFILE_INVALID";
}

function fail(message: string): never {
  throw new OidcProfileError(message);
}

function httpUrl(value: unknown, field: string, httpsOnly = false): string {
  if (typeof value !== "string" || !value.trim()) fail(`${field} is required`);
  const url = value.trim();
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    fail(`${field} must be an absolute URL`);
  }
  if (parsed.username || parsed.password) fail(`${field} must not carry userinfo`);
  if (httpsOnly) {
    if (parsed.protocol !== "https:") fail(`${field} must use https`);
  } else if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    fail(`${field} must use http or https`);
  }
  return url;
}

/**
 * The `openid` scope is what turns an OAuth2 request into an OIDC request, so it is
 * required as an independent scope token. A substring match would wrongly accept
 * `openid_extra`.
 */
export function hasOpenidScope(scopes: string): boolean {
  return scopes.split(/\s+/).filter(Boolean).includes("openid");
}

/** Parse a profile. This function does not perform network I/O. */
export function parseOidcProfile(raw: unknown): OidcProfile {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) fail("OIDC profile must be a mapping");
  const doc = raw as Record<string, unknown>;
  if ("clientSecret" in doc || "client_secret" in doc) {
    fail("client secret must stay in a secret file");
  }
  const tokenEndpointAuth = doc.tokenEndpointAuth;
  if (tokenEndpointAuth !== "client_secret_post" && tokenEndpointAuth !== "client_secret_basic") {
    fail("tokenEndpointAuth must be client_secret_post or client_secret_basic");
  }
  const scopes = typeof doc.scopes === "string" ? doc.scopes.trim() : "";
  if (!scopes) fail("scopes is required");
  if (!hasOpenidScope(scopes)) fail("scopes must include the openid scope");
  const redirectPath = typeof doc.redirectPath === "string" ? doc.redirectPath.trim() : "";
  if (!redirectPath.startsWith("/") || redirectPath.includes("?") || redirectPath.includes(" ")) {
    fail("redirectPath must be an absolute path");
  }
  const clientId = typeof doc.clientId === "string" ? doc.clientId.trim() : "";
  if (!clientId) fail("clientId is required");
  const publicWebuiUrl = httpUrl(doc.publicWebuiUrl, "publicWebuiUrl", true);
  const origin = new URL(publicWebuiUrl);
  if (origin.pathname !== "/" || origin.search || origin.hash) {
    fail("publicWebuiUrl must be an https origin");
  }
  // The logout fields are reserved for a later release. They stay optional so a
  // deployment is not forced to declare an endpoint this release never calls.
  const logoutStyle = doc.logoutStyle;
  if (logoutStyle !== undefined && logoutStyle !== null && logoutStyle !== "") {
    if (logoutStyle !== "id_token_hint" && logoutStyle !== "access_token") {
      fail("logoutStyle must be id_token_hint or access_token");
    }
  }
  const endSessionEndpoint =
    doc.endSessionEndpoint === undefined || doc.endSessionEndpoint === null || doc.endSessionEndpoint === ""
      ? undefined
      : httpUrl(doc.endSessionEndpoint, "endSessionEndpoint");
  return {
    issuer: httpUrl(doc.issuer, "issuer"),
    ...(doc.discoveryUrl === undefined || doc.discoveryUrl === ""
      ? {}
      : { discoveryUrl: httpUrl(doc.discoveryUrl, "discoveryUrl") }),
    authorizationEndpoint: httpUrl(doc.authorizationEndpoint, "authorizationEndpoint"),
    tokenEndpoint: httpUrl(doc.tokenEndpoint, "tokenEndpoint"),
    jwksUri: httpUrl(doc.jwksUri, "jwksUri"),
    ...(endSessionEndpoint ? { endSessionEndpoint } : {}),
    clientId,
    scopes,
    tokenEndpointAuth,
    ...(logoutStyle ? { logoutStyle } : {}),
    redirectPath,
    publicWebuiUrl: origin.origin
  };
}

/**
 * Canonical form of the profile, used as the configuration digest.
 *
 * The client secret is not part of the profile, so it cannot leak through the
 * digest. Key order is fixed by the literal below, so the string is stable across
 * processes and across YAML/JSON input shapes.
 */
export function canonicalOidcProfileJson(profile: OidcProfile): string {
  return JSON.stringify({
    issuer: profile.issuer,
    discoveryUrl: profile.discoveryUrl ?? null,
    authorizationEndpoint: profile.authorizationEndpoint,
    tokenEndpoint: profile.tokenEndpoint,
    jwksUri: profile.jwksUri,
    endSessionEndpoint: profile.endSessionEndpoint ?? null,
    clientId: profile.clientId,
    scopes: profile.scopes,
    tokenEndpointAuth: profile.tokenEndpointAuth,
    logoutStyle: profile.logoutStyle ?? null,
    redirectPath: profile.redirectPath,
    publicWebuiUrl: profile.publicWebuiUrl
  });
}
