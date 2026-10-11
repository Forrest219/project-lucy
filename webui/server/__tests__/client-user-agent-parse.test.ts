/**
 * WO-202610-14 T3 / SC-22 — 客户端与来源.
 *
 * `kscc-code/1.3.7 (cli)` resolves to a client and version when the
 * structured fields are empty. Without a forwarding header
 * `client_forwarded_for` stays empty and `client_ip` remains the socket peer.
 */
import { describe, expect, it } from "vitest";
import {
  extractForwardedFor,
  parseKnownClientFamily,
  resolveClientIdentity,
  trustProxyEnabled,
  userAgentParsingEnabled,
} from "../proxy/request-client-meta.js";

function requestWith(headers: Record<string, string>): never {
  return { headers, socket: { remoteAddress: "10.0.0.9" } } as never;
}

describe("client and origin (SC-22)", () => {
  it("parses kscc-code with its version", () => {
    expect(parseKnownClientFamily("kscc-code/1.3.7 (cli)")).toEqual({
      client: "kscc-code",
      clientVersion: "1.3.7"
    });
  });

  it("parses the other known families", () => {
    expect(parseKnownClientFamily("codex-mcp-client/0.9.1")?.client).toBe("codex-mcp-client");
    expect(parseKnownClientFamily("codex-mcp-client/0.9.1")?.clientVersion).toBe("0.9.1");
    expect(parseKnownClientFamily("opencode/1.2.0")?.client).toBe("opencode");
    expect(parseKnownClientFamily("claude-code/2.0.5")?.client).toBe("claude-code");
    expect(parseKnownClientFamily("WorkBuddy/3.2.0")?.client).toBe("workbuddy");
  });

  it("leaves client empty for an unknown or absent User-Agent", () => {
    expect(parseKnownClientFamily("Python-urllib/3.11")).toBeNull();
    expect(parseKnownClientFamily("curl/8.4.0")).toBeNull();
    expect(parseKnownClientFamily("")).toBeNull();
    expect(parseKnownClientFamily(undefined)).toBeNull();
    expect(parseKnownClientFamily(null)).toBeNull();
    expect(resolveClientIdentity({ userAgent: "Python-urllib/3.11" }).client).toBeUndefined();
  });

  it("prefers the structured client over the User-Agent", () => {
    expect(resolveClientIdentity({
      client: "hermes",
      clientVersion: "2.0",
      userAgent: "kscc-code/1.3.7 (cli)"
    })).toEqual({ client: "hermes", clientVersion: "2.0" });
  });

  it("falls back to the User-Agent family when client is empty", () => {
    expect(resolveClientIdentity({ client: "", userAgent: "kscc-code/1.3.7 (cli)" }))
      .toEqual({ client: "kscc-code", clientVersion: "1.3.7" });
  });

  it("leaves client_forwarded_for empty when there is no forwarding header", () => {
    expect(extractForwardedFor(requestWith({}))).toBeUndefined();
    expect(extractForwardedFor(requestWith({ "user-agent": "kscc-code/1.3.7 (cli)" }))).toBeUndefined();
  });

  it("records the forwarded chain in its own field", () => {
    const forwarded = extractForwardedFor(requestWith({ "x-forwarded-for": "203.0.113.7, 70.41.3.18" }));
    expect(forwarded).toBe("203.0.113.7, 70.41.3.18");
    expect(extractForwardedFor(requestWith({ "x-real-ip": "198.51.100.4" }))).toBe("198.51.100.4");
  });

  it("keeps client_ip as the socket peer and does not guess an office range", async () => {
    const { extractClientIp } = await import("../proxy/request-client-meta.js");
    const previous = process.env.LUCY_TRUST_PROXY;
    delete process.env.LUCY_TRUST_PROXY;
    expect(trustProxyEnabled()).toBe(false);

    // With proxy trust off, a spoofed X-Forwarded-For cannot rewrite the peer.
    const req = requestWith({ "x-forwarded-for": "10.1.2.3" });
    expect(extractClientIp(req)).toBe("10.0.0.9");
    // The forwarded value is still captured, but only for display.
    expect(extractForwardedFor(req)).toBe("10.1.2.3");

    if (previous === undefined) delete process.env.LUCY_TRUST_PROXY;
    else process.env.LUCY_TRUST_PROXY = previous;
  });

  it("can be switched off, leaving client empty", () => {
    const previous = process.env.LUCY_USER_AGENT_PARSE;
    delete process.env.LUCY_USER_AGENT_PARSE;
    expect(userAgentParsingEnabled()).toBe(true);

    process.env.LUCY_USER_AGENT_PARSE = "off";
    expect(userAgentParsingEnabled()).toBe(false);
    expect(parseKnownClientFamily("kscc-code/1.3.7 (cli)")).toBeNull();
    expect(resolveClientIdentity({ userAgent: "kscc-code/1.3.7 (cli)" }).client).toBeUndefined();

    if (previous === undefined) delete process.env.LUCY_USER_AGENT_PARSE;
    else process.env.LUCY_USER_AGENT_PARSE = previous;
  });
});