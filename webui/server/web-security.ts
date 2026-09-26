import type { FastifyInstance, FastifyRequest } from "fastify";

const UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'"
].join("; ");

function trustProxyEnabled(): boolean {
  const raw = (process.env.LUCY_TRUST_PROXY ?? "").trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes";
}

function firstHeaderValue(value: string | string[] | undefined): string | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw?.split(",")[0]?.trim() || undefined;
}

function effectiveHost(request: FastifyRequest): string | undefined {
  const forwarded = trustProxyEnabled()
    ? firstHeaderValue(request.headers["x-forwarded-host"])
    : undefined;
  return (forwarded ?? request.headers.host)?.trim().toLowerCase();
}

function csrfDenied(request: FastifyRequest): boolean {
  if (!UNSAFE_METHODS.has(request.method.toUpperCase()) || !request.url.startsWith("/api/")) {
    return false;
  }

  const fetchSite = firstHeaderValue(request.headers["sec-fetch-site"])?.toLowerCase();
  if (fetchSite === "cross-site") return true;

  const origin = firstHeaderValue(request.headers.origin);
  if (!origin) return false;
  if (origin === "null") return true;

  const host = effectiveHost(request);
  if (!host) return true;
  try {
    return new URL(origin).host.toLowerCase() !== host;
  } catch {
    return true;
  }
}

export function registerWebSecurity(app: FastifyInstance): void {
  app.addHook("onRequest", async (request, reply) => {
    if (!csrfDenied(request)) return;
    return reply.status(403).send({
      ok: false,
      error: {
        code: "CSRF_ORIGIN_DENIED",
        message: "Cross-site state-changing requests are not allowed"
      }
    });
  });

  app.addHook("onSend", async (_request, reply, payload) => {
    reply.header("Content-Security-Policy", CONTENT_SECURITY_POLICY);
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("X-Frame-Options", "DENY");
    reply.header("Referrer-Policy", "no-referrer");
    reply.header("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
    reply.header("Cross-Origin-Opener-Policy", "same-origin");
    reply.header("Cross-Origin-Resource-Policy", "same-origin");
    if (process.env.LUCY_WEBUI_COOKIE_SECURE === "1") {
      reply.header("Strict-Transport-Security", "max-age=31536000");
    }
    return payload;
  });
}
