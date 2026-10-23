/**
 * T03d audit-trust 集成测试：
 * - EA-13 同输入同 hash；时间变化 ≠ hash 变化；能力/行/来源变化 → hash 变化。
 * - EA-35 输出不含明文 token / cookie / 密码 / 私有业务正文 / 过滤值。
 */
import { describe, expect, it } from "vitest";
import {
  redactAuditSummary,
  redactAuditDiff,
  redactAuditText,
  REDACTED,
  REDACTED_HASH
} from "../../security/redaction";
import { revisionContentHash } from "../../proxy/association-revision";

describe("T03d EA-13 hash determinism", () => {
  function baseRevision() {
    return {
      id: 1,
      originalTurnId: "turn-1",
      effectiveTurnId: "turn-1",
      originalAssociationStatus: "session_bound",
      effectiveAssociationStatus: "confirmed",
      reason: "explicit turn validated by admin",
      referenceDoc: "spec/131",
      attributionRuleVersion: "v1",
      actorKind: "person",
      actorId: "admin-1",
      instanceId: null,
      instanceStartGeneration: null,
      ts: "2026-10-19T12:00:00Z",
      classificationVersion: "audit-trust-2026-10-19-r1.v1",
      expectedRevision: null
    };
  }

  it("same input → same hash", () => {
    const a = revisionContentHash(baseRevision());
    const b = revisionContentHash({ ...baseRevision() });
    expect(a).toBe(b);
  });

  it("time change → same hash (TS not part of canonical input)", () => {
    const a = revisionContentHash(baseRevision());
    const b = revisionContentHash({ ...baseRevision(), ts: "2026-10-19T13:00:00Z" });
    expect(a).toBe(b);
  });

  it("actor_id change → same hash (server-resolved, not authoritative)", () => {
    const a = revisionContentHash(baseRevision());
    const b = revisionContentHash({ ...baseRevision(), actorId: "admin-2" });
    expect(a).toBe(b);
  });

  it("effective status change → hash change", () => {
    const a = revisionContentHash(baseRevision());
    const b = revisionContentHash({
      ...baseRevision(),
      effectiveAssociationStatus: "conflict"
    });
    expect(a).not.toBe(b);
  });

  it("reason change → hash change", () => {
    const a = revisionContentHash(baseRevision());
    const b = revisionContentHash({
      ...baseRevision(),
      reason: "explicit turn invalidated"
    });
    expect(a).not.toBe(b);
  });

  it("rule version change → hash change", () => {
    const a = revisionContentHash(baseRevision());
    const b = revisionContentHash({
      ...baseRevision(),
      attributionRuleVersion: "v2"
    });
    expect(a).not.toBe(b);
  });

  it("classification version change → hash change", () => {
    const a = revisionContentHash(baseRevision());
    const b = revisionContentHash({
      ...baseRevision(),
      classificationVersion: "audit-trust-2026-10-19-r1.v2"
    });
    expect(a).not.toBe(b);
  });
});

describe("T03d EA-35 no-secret-in-output (redactAuditText)", () => {
  it("masks password assignment", () => {
    const out = redactAuditText("connection test failed: password=hunter2");
    expect(out).not.toContain("hunter2");
    expect(out).toMatch(/password=\[REDACTED\]/);
  });

  it("masks token assignment", () => {
    const out = redactAuditText("upstream rejected token=sk-live-abc123XYZ");
    expect(out).not.toContain("sk-live-abc123XYZ");
    expect(out).toMatch(/token=\[REDACTED\]/);
  });

  it("masks Bearer authorization header value", () => {
    const out = redactAuditText(`Authorization: Bearer abc123def456ghi789jkl012mno345pqr`);
    expect(out).not.toContain("abc123def456ghi789jkl012mno345pqr");
    expect(out).toContain(`Bearer ${REDACTED}`);
  });

  it("masks scrypt password hash", () => {
    const out = redactAuditText(`hash: "scrypt:AbCdEf123456:morehashpleasewithverylongcontentsuffix"`);
    expect(out).toContain(REDACTED_HASH);
    expect(out).not.toContain("scrypt:");
  });

  it("masks sha256:hex full token hash (40+ chars)", () => {
    const fullHash = "sha256:" + "a".repeat(64);
    const out = redactAuditText(`token_hash: ${fullHash}`);
    expect(out).toContain(REDACTED_HASH);
    expect(out).not.toContain("a".repeat(64));
  });

  it("preserves 12-hex fingerprint (audit-intentional)", () => {
    const fingerprint = "ab12cd34ef56"; // 12 hex chars
    const out = redactAuditText(`session fpr: ${fingerprint}`);
    expect(out).toContain(fingerprint);
  });

  it("does not invent secrets when none are present", () => {
    const out = redactAuditText("user clicked submit without errors");
    expect(out).not.toContain(REDACTED);
    expect(out).not.toContain(REDACTED_HASH);
    expect(out).toBe("user clicked submit without errors");
  });
});

describe("T03d EA-35 redactAuditSummary (object redaction)", () => {
  it("masks known credential keys in summary objects", () => {
    const out = redactAuditSummary("policy_change", {
      password: "hunter2",
      api_key: "sk-live-abc",
      description: "rotated key for connection X"
    });
    const text = JSON.stringify(out);
    expect(text).not.toContain("hunter2");
    expect(text).not.toContain("sk-live-abc");
    expect(text).toContain(REDACTED);
    expect(text).toContain("rotated key for connection X"); // non-secret context preserved
  });

  it("does not write null/0/false for secret fields (per EA-35: not invented)", () => {
    const out = redactAuditSummary("token_label_change", {
      token: "sk-live-original",
      label: "production",
      fingerprint: "ab12cd34ef56"
    });
    const text = JSON.stringify(out);
    expect(text).not.toContain("sk-live-original");
    expect(text).toContain(REDACTED);
    expect(text).toContain("production"); // non-secret label kept
  });

  it("does not invent secrets when input is undefined or empty", () => {
    // redactAuditSummary itself may return undefined for undefined input;
    // the contract concern is "no fabricated 0/false/[REDACTED] when there
    // was no secret". Verify the wrapper-level behavior by passing through
    // a serializer.
    const out = redactAuditSummary("token_label_change", undefined);
    // Whatever the return shape, it must NOT contain REDACTED / REDACTED_HASH
    // markers (we didn't redact anything because there was nothing).
    const text = JSON.stringify(out ?? null);
    expect(text === "null" || text === undefined).toBe(true);
  });
});

describe("T03d EA-35 redactAuditDiff (yaml/text diff redaction)", () => {
  it("masks credential lines in YAML-style diffs", () => {
    const diff = [
      " connections:",
      "   prod:",
      "-    password: hunter2",
      "+    password: ${REDACTED}",
      "     api_key: sk-live-original"
    ].join("\n");
    const out = redactAuditDiff(diff);
    expect(out).not.toContain("hunter2");
    expect(out).not.toContain("sk-live-original");
    // Mask marker present (text preserved for review).
    expect(out).toContain(REDACTED);
  });

  it("returns non-empty diff unchanged when no secrets", () => {
    const diff = " description: rotated connection\n host: db.example.com\n";
    const out = redactAuditDiff(diff);
    expect(out).toBe(diff);
  });
});

describe("T03d EA-35 hash determinism under summary change (composition)", () => {
  it("two redactAuditSummary outputs with same content → same shape", () => {
    const a = redactAuditSummary("x", { password: "hunter2", note: "ok" });
    const b = redactAuditSummary("x", { password: "hunter2", note: "ok" });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("two redactAuditSummary outputs with different non-secret content → different shape", () => {
    // The redaction layer masks secrets identically, so two different secret
    // values produce the same REDACTED placeholder — that is the desired
    // behaviour. To prove the layer preserves non-secret differences, vary
    // a non-secret field instead.
    const a = redactAuditSummary("x", { password: "hunter2", note: "first" });
    const b = redactAuditSummary("x", { password: "hunter2", note: "second" });
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(b));
  });
});