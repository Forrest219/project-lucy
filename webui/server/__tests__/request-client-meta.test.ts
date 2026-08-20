import type { IncomingMessage } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import {
  extractClientIp,
  extractDeviceName,
  extractRequestClientMeta,
  extractUserAgent,
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
      userAgent: "Cursor/1.0",
      deviceName: "desk"
    });
  });
});
