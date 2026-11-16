import type { IncomingMessage } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import {
  classifyTrustedSource,
  clientIpSource,
  extractClientIp,
  extractDeviceName,
  extractRequestClientMeta,
  extractUserAgent,
  resolveClientIpEvidence,
  trustProxyEnabled
} from "../proxy/request-client-meta";

function fakeReq(partial: {
  headers?: IncomingMessage["headers"];
  remoteAddress?: string;
}): IncomingMessage {
  return {
    headers: partial.headers ?? {},
    socket: { remoteAddress: partial.remoteAddress }
  } as IncomingMessage;
}

describe("request-client-meta", () => {
  const prev = process.env.LUCY_TRUST_PROXY;

  afterEach(() => {
    if (prev === undefined) delete process.env.LUCY_TRUST_PROXY;
    else process.env.LUCY_TRUST_PROXY = prev;
  });

  it("uses socket remoteAddress when trust proxy is off", () => {
    delete process.env.LUCY_TRUST_PROXY;
    expect(trustProxyEnabled()).toBe(false);
    const ip = extractClientIp(
      fakeReq({
        headers: { "x-forwarded-for": "203.0.113.9, 10.0.0.1" },
        remoteAddress: "127.0.0.1"
      })
    );
    expect(ip).toBe("127.0.0.1");
  });

  it("uses X-Forwarded-For first hop when trust proxy is on", () => {
    process.env.LUCY_TRUST_PROXY = "1";
    const ip = extractClientIp(
      fakeReq({
        headers: { "x-forwarded-for": "203.0.113.9, 10.0.0.1" },
        remoteAddress: "127.0.0.1"
      })
    );
    expect(ip).toBe("203.0.113.9");
  });

  it("truncates user-agent and device name", () => {
    const ua = extractUserAgent(fakeReq({ headers: { "user-agent": "u".repeat(400) } }));
    expect(ua?.length).toBe(256);
    const device = extractDeviceName(fakeReq({ headers: { "x-lucy-device-name": "d".repeat(200) } }));
    expect(device?.length).toBe(128);
  });

  it("extractRequestClientMeta aggregates fields", () => {
    process.env.LUCY_TRUST_PROXY = "true";
    const meta = extractRequestClientMeta(
      fakeReq({
        headers: {
          "x-forwarded-for": "198.51.100.2",
          "user-agent": "Cursor/1.0",
          "x-lucy-device-name": "desk"
        },
        remoteAddress: "10.0.0.1"
      })
    );
    expect(meta).toEqual({
      clientIp: "198.51.100.2",
      // Spec 162 §8 / SC-22: the forwarded chain is captured in its own
      // display-only field, separately from the peer address.
      clientForwardedFor: "198.51.100.2",
      userAgent: "Cursor/1.0",
      deviceName: "desk",
      // Spec 173 v0.3 / 2026-10-19 audit-trust / EA-10: the trusted-source
      // classification travels with the row. Trust proxy is on, but the peer
      // 10.0.0.1 is not inside LUCY_TRUSTED_PROXY_CIDRS, so the XFF value is
      // recorded as a forged-XFF attempt: display-only, never an ACL input.
      trustedSource: "untrusted_peer"
    });
  });

  it("leaves clientForwardedFor empty when there is no forwarding header", () => {
    const previous = process.env.LUCY_TRUST_PROXY;
    delete process.env.LUCY_TRUST_PROXY;
    const meta = extractRequestClientMeta(
      fakeReq({
        headers: { "user-agent": "kscc-code/1.3.7 (cli)" },
        remoteAddress: "10.0.0.1"
      })
    );
    expect(meta.clientForwardedFor).toBeUndefined();
    // client_ip stays the socket peer; no office range is guessed.
    expect(meta.clientIp).toBe("10.0.0.1");
    if (previous === undefined) delete process.env.LUCY_TRUST_PROXY;
    else process.env.LUCY_TRUST_PROXY = previous;
  });
});

// P1-36 D8 / SC-08 — client_ip, ip_source and trusted_source are recorded together.
describe("resolveClientIpEvidence (P1-36 D8)", () => {
  const prevTrust = process.env.LUCY_TRUST_PROXY;
  const prevCidrs = process.env.LUCY_TRUSTED_PROXY_CIDRS;

  afterEach(() => {
    if (prevTrust === undefined) delete process.env.LUCY_TRUST_PROXY;
    else process.env.LUCY_TRUST_PROXY = prevTrust;
    if (prevCidrs === undefined) delete process.env.LUCY_TRUSTED_PROXY_CIDRS;
    else process.env.LUCY_TRUSTED_PROXY_CIDRS = prevCidrs;
  });

  function setup(trust: boolean, cidrs?: string) {
    if (trust) process.env.LUCY_TRUST_PROXY = "1";
    else delete process.env.LUCY_TRUST_PROXY;
    if (cidrs === undefined) delete process.env.LUCY_TRUSTED_PROXY_CIDRS;
    else process.env.LUCY_TRUSTED_PROXY_CIDRS = cidrs;
  }

  it("default (trust proxy off): socket address, headers ignored", () => {
    setup(false);
    const req = fakeReq({
      headers: { "x-forwarded-for": "203.0.113.9", "x-real-ip": "203.0.113.10" },
      remoteAddress: "172.18.0.2"
    });
    expect(resolveClientIpEvidence(req)).toEqual({
      clientIp: "172.18.0.2",
      ipSource: "socket",
      trustedSource: "customer"
    });
  });

  it("trusted proxy + X-Forwarded-For: xff is adopted and labelled trusted_proxy", () => {
    setup(true, "10.0.0.0/8");
    const req = fakeReq({ headers: { "x-forwarded-for": "203.0.113.9, 10.1.2.3" }, remoteAddress: "10.1.2.3" });
    expect(resolveClientIpEvidence(req)).toEqual({
      clientIp: "203.0.113.9",
      ipSource: "xff",
      trustedSource: "trusted_proxy"
    });
  });

  it("trusted proxy + X-Real-IP: real_ip is adopted and labelled trusted_proxy", () => {
    setup(true, "10.0.0.0/8");
    const req = fakeReq({ headers: { "x-real-ip": "203.0.113.10" }, remoteAddress: "10.1.2.3" });
    expect(resolveClientIpEvidence(req)).toEqual({
      clientIp: "203.0.113.10",
      ipSource: "real_ip",
      trustedSource: "trusted_proxy"
    });
  });

  it("untrusted peer forging X-Forwarded-For: untrusted_peer, client_ip unchanged (recorded only)", () => {
    setup(true, "10.0.0.0/8");
    const req = fakeReq({ headers: { "x-forwarded-for": "198.51.100.7" }, remoteAddress: "203.0.113.40" });
    expect(resolveClientIpEvidence(req)).toEqual({
      clientIp: "198.51.100.7",
      ipSource: "xff",
      trustedSource: "untrusted_peer"
    });
  });

  it("untrusted peer forging X-Real-IP: untrusted_peer, client_ip unchanged (recorded only)", () => {
    setup(true, "10.0.0.0/8");
    const req = fakeReq({ headers: { "x-real-ip": "198.51.100.8" }, remoteAddress: "203.0.113.40" });
    expect(resolveClientIpEvidence(req)).toEqual({
      clientIp: "198.51.100.8",
      ipSource: "real_ip",
      trustedSource: "untrusted_peer"
    });
  });

  it("trust on, no CIDR list: forged X-Real-IP is untrusted_peer, never customer", () => {
    setup(true);
    const req = fakeReq({ headers: { "x-real-ip": "198.51.100.8" }, remoteAddress: "203.0.113.40" });
    expect(classifyTrustedSource(req)).toBe("untrusted_peer");
  });

  it("trusted peer without forwarding headers: socket address, not trusted_proxy", () => {
    setup(true, "10.0.0.0/8");
    const req = fakeReq({ remoteAddress: "10.1.2.3" });
    expect(resolveClientIpEvidence(req)).toEqual({
      clientIp: "10.1.2.3",
      ipSource: "socket",
      trustedSource: "customer"
    });
  });

  it("empty first X-Forwarded-For hop falls through to X-Real-IP, matching extractClientIp", () => {
    setup(true, "10.0.0.0/8");
    const req = fakeReq({
      headers: { "x-forwarded-for": " , 1.2.3.4", "x-real-ip": "203.0.113.10" },
      remoteAddress: "10.1.2.3"
    });
    expect(extractClientIp(req)).toBe("203.0.113.10");
    expect(clientIpSource(req)).toBe("real_ip");
  });

  it("clientIp always equals extractClientIp across scenarios", () => {
    setup(true, "10.0.0.0/8");
    const reqs = [
      fakeReq({ headers: { "x-forwarded-for": "203.0.113.9" }, remoteAddress: "10.1.2.3" }),
      fakeReq({ headers: { "x-real-ip": "203.0.113.10" }, remoteAddress: "203.0.113.40" }),
      fakeReq({ remoteAddress: "203.0.113.40" }),
      fakeReq({})
    ];
    for (const req of reqs) expect(resolveClientIpEvidence(req).clientIp).toBe(extractClientIp(req));
  });
});
