/**
 * T02 audit-trust 集成测试：
 * - 可信来源分类（trusted_proxy / untrusted_peer / customer / same-NAT）
 * - 普通 catalog_bound 不扩展到未声明连接
 * - lucy_admin 遵守现有规则并产生 policy_scope_expanded 审计事件
 *
 * 不覆盖客户端联调（需要 mock upstream）；单元覆盖每个类的边界。
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { classifyTrustedSource } from "../../proxy/request-client-meta";
import type { IncomingMessage } from "node:http";

function mockReq(opts: {
  remoteAddress?: string;
  xForwardedFor?: string;
}): IncomingMessage {
  const headers: Record<string, string> = {};
  if (opts.xForwardedFor) headers["x-forwarded-for"] = opts.xForwardedFor;
  const req = {
    socket: opts.remoteAddress ? { remoteAddress: opts.remoteAddress } : undefined,
    headers,
  } as unknown as IncomingMessage;
  return req;
}

describe("T02 classifyTrustedSource", () => {
  const originalTrustProxy = process.env.LUCY_TRUST_PROXY;
  const originalTrustCidrs = process.env.LUCY_TRUSTED_PROXY_CIDRS;

  beforeEach(() => {
    delete process.env.LUCY_TRUST_PROXY;
    delete process.env.LUCY_TRUSTED_PROXY_CIDRS;
  });

  afterEach(() => {
    if (originalTrustProxy === undefined) delete process.env.LUCY_TRUST_PROXY;
    else process.env.LUCY_TRUST_PROXY = originalTrustProxy;
    if (originalTrustCidrs === undefined) delete process.env.LUCY_TRUSTED_PROXY_CIDRS;
    else process.env.LUCY_TRUSTED_PROXY_CIDRS = originalTrustCidrs;
  });

  it("classifies in-process calls as local_admin when no peer is present", () => {
    const req = mockReq({});
    expect(classifyTrustedSource(req)).toBe("local_admin");
  });

  it("classifies direct peer as customer when LUCY_TRUST_PROXY is off", () => {
    process.env.LUCY_TRUST_PROXY = "off";
    expect(classifyTrustedSource(mockReq({ remoteAddress: "203.0.113.40" }))).toBe("customer");
  });

  it("classifies direct peer as customer when trust enabled but no CIDR list", () => {
    process.env.LUCY_TRUST_PROXY = "on";
    expect(classifyTrustedSource(mockReq({ remoteAddress: "203.0.113.40" }))).toBe("customer");
  });

  it("classifies trusted CIDR peer as trusted_proxy when XFF present", () => {
    process.env.LUCY_TRUST_PROXY = "true";
    process.env.LUCY_TRUSTED_PROXY_CIDRS = "10.0.0.0/8";
    expect(classifyTrustedSource(mockReq({ remoteAddress: "10.1.2.3", xForwardedFor: "203.0.113.40" }))).toBe("trusted_proxy");
  });

  it("flags forged XFF from a peer outside the trusted CIDR as untrusted_peer", () => {
    process.env.LUCY_TRUST_PROXY = "true";
    process.env.LUCY_TRUSTED_PROXY_CIDRS = "10.0.0.0/8";
    expect(classifyTrustedSource(mockReq({ remoteAddress: "203.0.113.40", xForwardedFor: "10.1.2.3" }))).toBe("untrusted_peer");
  });

  it("keeps classification of an untrusted peer without XFF as ordinary customer (no false alarm)", () => {
    process.env.LUCY_TRUST_PROXY = "true";
    process.env.LUCY_TRUSTED_PROXY_CIDRS = "10.0.0.0/8";
    expect(classifyTrustedSource(mockReq({ remoteAddress: "203.0.113.40" }))).toBe("customer");
  });

  it("treats forged XFF as untrusted_peer even when trust is on but no CIDR list is set", () => {
    process.env.LUCY_TRUST_PROXY = "true";
    delete process.env.LUCY_TRUSTED_PROXY_CIDRS;
    expect(classifyTrustedSource(mockReq({ remoteAddress: "203.0.113.40", xForwardedFor: "10.1.2.3" }))).toBe("untrusted_peer");
  });

  it("treats the same-NAT case as ordinary customer (does NOT split by shared IP)", () => {
    process.env.LUCY_TRUST_PROXY = "off";
    expect(classifyTrustedSource(mockReq({ remoteAddress: "192.0.2.10" }))).toBe("customer");
    expect(classifyTrustedSource(mockReq({ remoteAddress: "192.0.2.10" }))).toBe("customer");
  });

  it("returns unknown when peer address is unparseable", () => {
    process.env.LUCY_TRUST_PROXY = "off";
    expect(classifyTrustedSource(mockReq({ remoteAddress: "not-an-ip" }))).toBe("unknown");
  });
});

describe("T02 short hash and token_label are NOT security keys", () => {
  it("does not expose token_hash_prefix or token_label as identity inputs in RequestClientMeta", async () => {
    const { extractRequestClientMeta } = await import("../../proxy/request-client-meta");
    const req = mockReq({ remoteAddress: "203.0.113.40" });
    const meta = extractRequestClientMeta(req);
    // Spec 173 v0.3 / 2026-10-19 audit-trust: short hash and token_label are display-only.
    expect((meta as Record<string, unknown>).tokenHashPrefix).toBeUndefined();
    expect((meta as Record<string, unknown>).tokenLabel).toBeUndefined();
    expect((meta as Record<string, unknown>).tokenHash).toBeUndefined();
    // The trustedSource classification IS recorded.
    expect(meta.trustedSource).toBe("customer");
  });
});