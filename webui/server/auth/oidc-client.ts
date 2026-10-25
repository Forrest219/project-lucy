import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";
import type { OidcTokenEndpointAuth } from "./oidc-profile.js";

/**
 * OIDC protocol client (L25-06 Spec §6.2 / §8.2).
 *
 * The endpoints are static configuration, never discovered: the token exchange
 * posts to the configured token endpoint and the ID token is verified against the
 * configured JWKS. Signature verification is delegated to `jose`; this module never
 * decodes a JWT and calls it valid.
 */

export class OidcClientError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

/** Asymmetric signature algorithms only. `none` and every `HS*` variant are rejected. */
export const ALLOWED_ID_TOKEN_ALGORITHMS = [
  "RS256",
  "RS384",
  "RS512",
  "PS256",
  "PS384",
  "PS512",
  "ES256",
  "ES384",
  "ES512",
  "EdDSA"
] as const;

const TOKEN_REQUEST_TIMEOUT_MS = 10_000;
const JWKS_TIMEOUT_MS = 5_000;
const JWKS_COOLDOWN_MS = 30_000;
const JWKS_CACHE_MAX_AGE_MS = 600_000;
const MAX_TOKEN_RESPONSE_BYTES = 64 * 1024;
const CLOCK_TOLERANCE_SECONDS = 5;

/**
 * Reads the body with a hard byte cap.
 *
 * `response.text()` would materialise the whole body before the size check, so
 * the "response size limit" of Spec §8.2 would not really bound anything.
 */
async function readBoundedBody(response: Response): Promise<string | undefined> {
  const body = response.body;
  if (!body) return "";
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > MAX_TOKEN_RESPONSE_BYTES) {
      await reader.cancel().catch(() => undefined);
      return undefined;
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

export type AuthorizationCodeExchangeInput = {
  code: string;
  verifier: string;
  redirectUri: string;
  tokenEndpoint: string;
  tokenEndpointAuth: OidcTokenEndpointAuth;
  clientId: string;
  clientSecret: string;
};

export type TokenResponse = {
  idToken: string;
  accessToken?: string;
  refreshToken?: string;
};

function formEncode(value: string): string {
  return encodeURIComponent(value).replace(/%20/g, "+");
}

/**
 * Exchange an authorization code for tokens.
 *
 * The client secret is sent in exactly one way: `client_secret_post` puts it in
 * the form body, `client_secret_basic` puts it in the Authorization header. It is
 * never sent both ways.
 */
export async function exchangeAuthorizationCode(
  input: AuthorizationCodeExchangeInput
): Promise<TokenResponse> {
  const body = new URLSearchParams();
  body.set("grant_type", "authorization_code");
  body.set("code", input.code);
  body.set("redirect_uri", input.redirectUri);
  body.set("code_verifier", input.verifier);

  const headers: Record<string, string> = {
    "Content-Type": "application/x-www-form-urlencoded",
    Accept: "application/json"
  };
  if (input.tokenEndpointAuth === "client_secret_basic") {
    const credentials = `${formEncode(input.clientId)}:${formEncode(input.clientSecret)}`;
    headers.Authorization = `Basic ${Buffer.from(credentials, "utf8").toString("base64")}`;
  } else {
    body.set("client_id", input.clientId);
    body.set("client_secret", input.clientSecret);
  }

  let response: Response;
  try {
    response = await fetch(input.tokenEndpoint, {
      method: "POST",
      headers,
      body: body.toString(),
      redirect: "manual",
      signal: AbortSignal.timeout(TOKEN_REQUEST_TIMEOUT_MS)
    });
  } catch (error) {
    throw new OidcClientError(
      "code_exchange_failed",
      error instanceof Error ? error.message : "token endpoint is unreachable"
    );
  }

  if (!response.ok) {
    throw new OidcClientError("code_exchange_failed", `token endpoint returned ${response.status}`);
  }
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    throw new OidcClientError("code_exchange_failed", "token endpoint returned a non-JSON body");
  }
  const text = await readBoundedBody(response);
  if (text === undefined) {
    throw new OidcClientError("code_exchange_failed", "token endpoint response is too large");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new OidcClientError("code_exchange_failed", "token endpoint returned an unreadable body");
  }
  const doc = (parsed ?? {}) as Record<string, unknown>;
  const idToken = typeof doc.id_token === "string" ? doc.id_token : "";
  if (!idToken) throw new OidcClientError("code_exchange_failed", "token response has no id_token");

  return {
    idToken,
    ...(typeof doc.access_token === "string" ? { accessToken: doc.access_token } : {}),
    ...(typeof doc.refresh_token === "string" ? { refreshToken: doc.refresh_token } : {})
  };
}

export type VerifiedIdToken = {
  iss: string;
  sub: string;
  aud: string[];
  nonce?: string;
};

const jwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

function remoteJwks(jwksUri: string) {
  let jwks = jwksCache.get(jwksUri);
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(jwksUri), {
      timeoutDuration: JWKS_TIMEOUT_MS,
      cooldownDuration: JWKS_COOLDOWN_MS,
      cacheMaxAge: JWKS_CACHE_MAX_AGE_MS
    });
    jwksCache.set(jwksUri, jwks);
  }
  return jwks;
}

function audienceOf(payload: JWTPayload): string[] {
  const aud = payload.aud;
  if (typeof aud === "string") return [aud];
  if (Array.isArray(aud)) return aud.filter((entry): entry is string => typeof entry === "string");
  return [];
}

/**
 * Verify the ID token signature and claims.
 *
 * `jose` verifies the signature against the provider's JWKS and checks `iss`,
 * `aud` and `exp`. On top of that this function requires `iat`, the `nonce` and —
 * when the token carries several audiences — an `azp` equal to this client.
 */
export async function verifyIdToken(input: {
  idToken: string;
  jwksUri: string;
  expectedIssuer: string;
  expectedAudience: string;
  expectedNonce: string;
}): Promise<VerifiedIdToken> {
  let payload: JWTPayload;
  try {
    const verified = await jwtVerify(input.idToken, remoteJwks(input.jwksUri), {
      issuer: input.expectedIssuer,
      audience: input.expectedAudience,
      algorithms: [...ALLOWED_ID_TOKEN_ALGORITHMS],
      clockTolerance: CLOCK_TOLERANCE_SECONDS,
      // `jwtVerify` only validates `exp` when the claim is present, so a token
      // without an expiry would pass. Spec §6.2 requires a valid exp.
      requiredClaims: ["exp"]
    });
    payload = verified.payload;
  } catch (error) {
    throw new OidcClientError(
      "id_token_invalid",
      error instanceof Error ? error.message : "id_token verification failed"
    );
  }

  if (typeof payload.iat !== "number") {
    throw new OidcClientError("id_token_invalid", "id_token has no iat");
  }
  const nowSeconds = Math.floor(Date.now() / 1000);
  if (payload.iat > nowSeconds + CLOCK_TOLERANCE_SECONDS) {
    throw new OidcClientError("id_token_invalid", "id_token iat is in the future");
  }

  const aud = audienceOf(payload);
  const azp = typeof payload.azp === "string" ? payload.azp : "";
  if (aud.length > 1) {
    // Several audiences: OIDC requires azp to name the authorized party.
    if (!azp || azp !== input.expectedAudience) {
      throw new OidcClientError("id_token_invalid", "id_token has multiple audiences without a matching azp");
    }
  } else if (azp && azp !== input.expectedAudience) {
    // One audience but an azp for somebody else is still a mismatch.
    throw new OidcClientError("id_token_invalid", "id_token azp does not match this client");
  }

  const nonce = typeof payload.nonce === "string" ? payload.nonce : "";
  if (!nonce || nonce !== input.expectedNonce) {
    throw new OidcClientError("id_token_invalid", "id_token nonce does not match the login attempt");
  }

  const iss = typeof payload.iss === "string" ? payload.iss : "";
  const sub = typeof payload.sub === "string" ? payload.sub : "";
  if (!iss || !sub) throw new OidcClientError("id_token_invalid", "id_token has no subject");

  return { iss, sub, aud, ...(nonce ? { nonce } : {}) };
}
