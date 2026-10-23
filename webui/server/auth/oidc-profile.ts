/**
 * Reserved enterprise OIDC profile.
 *
 * v2.0 validates this shape for a later release and never loads it during startup,
 * never contacts the issuer, and never offers it as a login method.
 * The client secret stays in a secret file and is not part of this profile.
 */

export const ACTIVE_LOGIN_METHODS = ["local"] as const;

export type OidcTokenEndpointAuth = "client_secret_post" | "client_secret_basic";
export type OidcLogoutStyle = "id_token_hint" | "access_token";

export type OidcProfile = {
  issuer: string;
  discoveryUrl?: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  jwksUri: string;
  endSessionEndpoint: string;
  clientId: string;
  scopes: string;
  tokenEndpointAuth: OidcTokenEndpointAuth;
  logoutStyle: OidcLogoutStyle;
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

/** Parse a reserved profile. This function does not perform network I/O. */
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
  const logoutStyle = doc.logoutStyle;
  if (logoutStyle !== "id_token_hint" && logoutStyle !== "access_token") {
    fail("logoutStyle must be id_token_hint or access_token");
  }
  const scopes = typeof doc.scopes === "string" ? doc.scopes.trim() : "";
  if (!scopes) fail("scopes is required");
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
  return {
    issuer: httpUrl(doc.issuer, "issuer"),
    ...(doc.discoveryUrl === undefined || doc.discoveryUrl === ""
      ? {}
      : { discoveryUrl: httpUrl(doc.discoveryUrl, "discoveryUrl") }),
    authorizationEndpoint: httpUrl(doc.authorizationEndpoint, "authorizationEndpoint"),
    tokenEndpoint: httpUrl(doc.tokenEndpoint, "tokenEndpoint"),
    jwksUri: httpUrl(doc.jwksUri, "jwksUri"),
    endSessionEndpoint: httpUrl(doc.endSessionEndpoint, "endSessionEndpoint"),
    clientId,
    scopes,
    tokenEndpointAuth,
    logoutStyle,
    redirectPath,
    publicWebuiUrl: origin.origin
  };
}
