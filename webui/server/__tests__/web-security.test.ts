import { afterEach, describe, expect, it, vi } from "vitest";
import { buildServer } from "../index.js";
import { clearSessionCookie, setSessionCookie } from "../auth/session.js";
import { resolveCookieSecure } from "../auth/deployment-mode.js";
import { CONTENT_SECURITY_POLICY } from "../web-security.js";

const previousCookieSecure = process.env.LUCY_WEBUI_COOKIE_SECURE;
const previousTrustProxy = process.env.LUCY_TRUST_PROXY;
const previousMode = process.env.LUCY_DEPLOYMENT_MODE;
const previousTestProfile = process.env.LUCY_WEBUI_TEST_PROFILE;
const previousAccess = process.env.LUCY_WEBUI_ACCESS;

afterEach(() => {
  if (previousMode === undefined) delete process.env.LUCY_DEPLOYMENT_MODE;
  else process.env.LUCY_DEPLOYMENT_MODE = previousMode;
  if (previousTestProfile === undefined) delete process.env.LUCY_WEBUI_TEST_PROFILE;
  else process.env.LUCY_WEBUI_TEST_PROFILE = previousTestProfile;
  if (previousAccess === undefined) delete process.env.LUCY_WEBUI_ACCESS;
  else process.env.LUCY_WEBUI_ACCESS = previousAccess;
  if (previousCookieSecure === undefined) delete process.env.LUCY_WEBUI_COOKIE_SECURE;
  else process.env.LUCY_WEBUI_COOKIE_SECURE = previousCookieSecure;
  if (previousTrustProxy === undefined) delete process.env.LUCY_TRUST_PROXY;
  else process.env.LUCY_TRUST_PROXY = previousTrustProxy;
});

describe("Web security baseline", () => {
  it("adds the enterprise security headers to API responses", async () => {
    delete process.env.LUCY_WEBUI_COOKIE_SECURE;
    const app = buildServer();
    await app.ready();
    const response = await app.inject({ method: "GET", url: "/api/auth/status" });

    expect(response.headers["content-security-policy"]).toBe(CONTENT_SECURITY_POLICY);
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    expect(response.headers["x-frame-options"]).toBe("DENY");
    expect(response.headers["referrer-policy"]).toBe("no-referrer");
    expect(response.headers["permissions-policy"]).toBe("camera=(), microphone=(), geolocation=()");
    expect(response.headers["cross-origin-opener-policy"]).toBe("same-origin");
    expect(response.headers["cross-origin-resource-policy"]).toBe("same-origin");
    expect(response.headers["strict-transport-security"]).toBeUndefined();
    await app.close();
  });

  it("enables HSTS and Secure session cookies for the HTTPS profile", async () => {
    process.env.LUCY_WEBUI_COOKIE_SECURE = "1";
    const app = buildServer();
    await app.ready();
    const response = await app.inject({ method: "GET", url: "/api/auth/status" });
    expect(response.headers["strict-transport-security"]).toBe("max-age=31536000");

    const header = vi.fn();
    setSessionCookie({ header } as never, "sealed-session", Math.floor(Date.now() / 1000) + 60);
    expect(header).toHaveBeenCalledWith(
      "Set-Cookie",
      expect.stringContaining("; HttpOnly; SameSite=Lax; Max-Age=")
    );
    expect(String(header.mock.calls[0]?.[1])).toContain("; Secure");
    await app.close();
  });

  it("rejects cross-site browser mutations but preserves same-origin and CLI requests", async () => {
    const app = buildServer();
    await app.ready();

    const crossSite = await app.inject({
      method: "POST",
      url: "/api/definitely-missing",
      headers: {
        host: "lucy.example.com",
        origin: "https://attacker.example",
        "sec-fetch-site": "cross-site"
      }
    });
    expect(crossSite.statusCode).toBe(403);
    expect(crossSite.json().error.code).toBe("CSRF_ORIGIN_DENIED");

    const sameOrigin = await app.inject({
      method: "POST",
      url: "/api/definitely-missing",
      headers: {
        host: "lucy.example.com",
        origin: "https://lucy.example.com",
        "sec-fetch-site": "same-origin"
      }
    });
    expect(sameOrigin.statusCode).not.toBe(403);

    const cli = await app.inject({ method: "POST", url: "/api/definitely-missing" });
    expect(cli.statusCode).not.toBe(403);
    await app.close();
  });

  it("uses forwarded host only when the trusted proxy profile is enabled", async () => {
    process.env.LUCY_TRUST_PROXY = "1";
    const app = buildServer();
    await app.ready();
    const response = await app.inject({
      method: "POST",
      url: "/api/definitely-missing",
      headers: {
        host: "lucy-internal:5174",
        "x-forwarded-host": "lucy.example.com",
        origin: "https://lucy.example.com",
        "sec-fetch-site": "same-origin"
      }
    });
    expect(response.statusCode).not.toBe(403);
    await app.close();
  });
});

describe("SEC-08: session cookie Secure policy by deployment mode (T02, Spec §3.1 item 8)", () => {
  function cookieHeaders(fn: (reply: never) => void): string {
    const header = vi.fn();
    fn({ header } as never);
    return String(header.mock.calls[0]?.[1]);
  }

  it("customer defaults to Secure with HSTS when LUCY_WEBUI_COOKIE_SECURE is unset", async () => {
    process.env.LUCY_DEPLOYMENT_MODE = "customer";
    delete process.env.LUCY_WEBUI_COOKIE_SECURE;
    expect(resolveCookieSecure()).toEqual({ secure: true, insecureTestProfile: false });
    expect(cookieHeaders((reply) => setSessionCookie(reply, "t", Math.floor(Date.now() / 1000) + 60))).toContain("; Secure");
    expect(cookieHeaders((reply) => clearSessionCookie(reply))).toContain("; Secure");

    const app = buildServer();
    await app.ready();
    const res = await app.inject({ method: "GET", url: "/api/auth/status" });
    expect(res.headers["strict-transport-security"]).toBe("max-age=31536000");
    await app.close();
  });

  it("customer + LUCY_WEBUI_COOKIE_SECURE=0 refuses to start", () => {
    process.env.LUCY_DEPLOYMENT_MODE = "customer";
    for (const value of ["0", "false"]) {
      process.env.LUCY_WEBUI_COOKIE_SECURE = value;
      delete process.env.LUCY_WEBUI_TEST_PROFILE;
      expect(() => resolveCookieSecure()).toThrow(/LUCY_WEBUI_COOKIE_SECURE/);
      expect(() => buildServer()).toThrow(/LUCY_WEBUI_COOKIE_SECURE/);
    }
  });

  it("customer intranet HTTP is an explicit access mode and is not the lab test profile", async () => {
    process.env.LUCY_DEPLOYMENT_MODE = "customer";
    process.env.LUCY_WEBUI_ACCESS = "http";
    process.env.LUCY_WEBUI_COOKIE_SECURE = "0";
    delete process.env.LUCY_WEBUI_TEST_PROFILE;
    expect(resolveCookieSecure()).toEqual({ secure: false, insecureTestProfile: false });
    expect(cookieHeaders((reply) => setSessionCookie(reply, "t", Math.floor(Date.now() / 1000) + 60))).not.toContain("Secure");

    const app = buildServer();
    await app.ready();
    const health = await app.inject({ method: "GET", url: "/api/health" });
    expect(health.json().data.insecureTestProfile).toBeUndefined();
    expect(health.headers["strict-transport-security"]).toBeUndefined();
    await app.close();
  });

  it("customer + COOKIE_SECURE=0 is allowed only for the explicit test profile, and health says so", async () => {
    process.env.LUCY_DEPLOYMENT_MODE = "customer";
    process.env.LUCY_WEBUI_COOKIE_SECURE = "0";
    process.env.LUCY_WEBUI_TEST_PROFILE = "1";
    expect(resolveCookieSecure()).toEqual({ secure: false, insecureTestProfile: true });
    expect(cookieHeaders((reply) => setSessionCookie(reply, "t", Math.floor(Date.now() / 1000) + 60))).not.toContain("Secure");

    const app = buildServer();
    await app.ready();
    const health = await app.inject({ method: "GET", url: "/api/health" });
    expect(health.json().data.insecureTestProfile).toBe(true);
    await app.close();
  });

  it("health carries no insecure-profile marker in the secure default", async () => {
    process.env.LUCY_DEPLOYMENT_MODE = "customer";
    delete process.env.LUCY_WEBUI_COOKIE_SECURE;
    const app = buildServer();
    await app.ready();
    const health = await app.inject({ method: "GET", url: "/api/health" });
    expect(health.json().data.insecureTestProfile).toBeUndefined();
    await app.close();
  });

  it("development keeps cookies non-Secure unless explicitly enabled; invalid values are rejected", () => {
    process.env.LUCY_DEPLOYMENT_MODE = "development";
    delete process.env.LUCY_WEBUI_COOKIE_SECURE;
    expect(resolveCookieSecure().secure).toBe(false);
    process.env.LUCY_WEBUI_COOKIE_SECURE = "1";
    expect(resolveCookieSecure().secure).toBe(true);
    process.env.LUCY_WEBUI_COOKIE_SECURE = "maybe";
    expect(() => resolveCookieSecure()).toThrow(/LUCY_WEBUI_COOKIE_SECURE/);
  });

  it("a Chart-pinned deployment mode that differs from the effective one refuses to start", () => {
    const previous = process.env.LUCY_CHART_DEPLOYMENT_MODE;
    try {
      process.env.LUCY_CHART_DEPLOYMENT_MODE = "customer";
      process.env.LUCY_DEPLOYMENT_MODE = "development";
      delete process.env.LUCY_WEBUI_COOKIE_SECURE;
      expect(() => buildServer()).toThrow(/LUCY_DEPLOYMENT_MODE.*Chart/);
      process.env.LUCY_DEPLOYMENT_MODE = "customer";
      expect(() => buildServer()).not.toThrow();
    } finally {
      if (previous === undefined) delete process.env.LUCY_CHART_DEPLOYMENT_MODE;
      else process.env.LUCY_CHART_DEPLOYMENT_MODE = previous;
    }
  });
});
