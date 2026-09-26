import { afterEach, describe, expect, it, vi } from "vitest";
import { buildServer } from "../index.js";
import { setSessionCookie } from "../auth/session.js";
import { CONTENT_SECURITY_POLICY } from "../web-security.js";

const previousCookieSecure = process.env.LUCY_WEBUI_COOKIE_SECURE;
const previousTrustProxy = process.env.LUCY_TRUST_PROXY;

afterEach(() => {
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
