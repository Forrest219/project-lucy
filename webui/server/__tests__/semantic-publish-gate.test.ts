/**
 * WO-202610-14 T5 / SC-24 — 语义发布门禁.
 *
 * A failing TS/Python contract check — including an illegal `columns.0.type` —
 * rejects the publish. An exemption row carries operator, reason and expiry.
 * Once the expiry passes the same publish fails again, and an exemption can
 * never switch off the whole check. This gate generates neither a physical-name
 * alias nor a join whitelist.
 */
import { describe, expect, it } from "vitest";
import {
  ALL_CHECKS,
  applyPublishExemption,
  checkColumnTypeContract,
  evaluatePublishGate,
  NON_WAIVABLE_CHECKS,
  validatePublishExemption,
  type PublishGateViolation,
} from "../publish-gate.js";

const NOW = new Date("2026-10-11T12:00:00.000Z");

describe("semantic publish gate (SC-24)", () => {
  it("rejects an illegal columns.0.type", () => {
    const violations = checkColumnTypeContract(
      [{ name: "date", type: "strinng" }, { name: "amount", type: "number" }],
      "semantic-layer/demo-mysql/chatbi/orders.yaml"
    );
    expect(violations.length).toBe(1);
    expect(violations[0].checkId).toBe("columns.0.type");
    expect(violations[0].filePath).toContain("orders.yaml");
    expect(violations[0].message).toContain("strinng");
  });

  it("rejects SQL spellings that KTX does not accept", () => {
    const violations = checkColumnTypeContract(
      [
        { name: "amount", type: "decimal" },
        { name: "rate", type: "float" },
        { name: "as_of", type: "TIMESTAMP" }
      ],
      "x.yaml"
    );
    expect(violations.map((v) => v.checkId)).toEqual([
      "columns.0.type",
      "columns.1.type",
      "columns.2.type"
    ]);
  });

  it("accepts legal column types and untyped columns", () => {
    expect(checkColumnTypeContract(
      [
        { name: "a", type: "string" },
        { name: "b", type: "number" },
        { name: "c", type: "time" },
        { name: "d", type: "boolean" },
        { name: "e" }
      ],
      "x.yaml"
    )).toEqual([]);
    expect(checkColumnTypeContract("not-an-array", "x.yaml")).toEqual([]);
  });

  it("blocks the publish when a contract violation is not waived", () => {
    const violations = checkColumnTypeContract([{ name: "date", type: "strinng" }], "x.yaml");
    const verdict = evaluatePublishGate(violations, null, NOW);
    expect(verdict.allowed).toBe(false);
    expect(verdict.waived).toBeNull();
    expect(verdict.blocking.map((v) => v.checkId)).toEqual(["columns.0.type"]);
  });

  it("requires operator, reason and expiry on an exemption", () => {
    expect(validatePublishExemption({}, NOW)).toEqual({ ok: false, reason: "exemption_operator_required" });
    expect(validatePublishExemption({ operator: "alice" }, NOW)).toEqual({ ok: false, reason: "exemption_reason_required" });
    expect(validatePublishExemption({ operator: "alice", reason: "紧急发布" }, NOW))
      .toEqual({ ok: false, reason: "exemption_expiry_required" });
    expect(validatePublishExemption({ operator: "alice", reason: "紧急发布", expiresAt: "tomorrow" }, NOW))
      .toEqual({ ok: false, reason: "exemption_expiry_not_iso" });
    expect(validatePublishExemption({ operator: "alice", reason: "紧急发布", expiresAt: "2026-10-01T00:00:00.000Z" }, NOW))
      .toEqual({ ok: false, reason: "exemption_already_expired" });
  });

  it("refuses an exemption with no check id, or one that disables everything", () => {
    const base = { operator: "alice", reason: "紧急发布", expiresAt: "2026-10-12T00:00:00.000Z" };
    expect(validatePublishExemption({ ...base, checkIds: [] }, NOW))
      .toEqual({ ok: false, reason: "exemption_check_ids_required" });
    expect(validatePublishExemption({ ...base, checkIds: [ALL_CHECKS] }, NOW))
      .toEqual({ ok: false, reason: "exemption_all_checks_forbidden" });
    expect(NON_WAIVABLE_CHECKS.has(ALL_CHECKS)).toBe(true);
  });

  it("accepts a complete exemption and records it in the audit shape", () => {
    const validated = validatePublishExemption({
      operator: "alice",
      reason: "上游字段类型待修正",
      expiresAt: "2026-10-12T00:00:00.000Z",
      checkIds: ["columns.0.type"],
      connectionId: "demo-mysql"
    }, NOW);
    expect(validated.ok).toBe(true);
    if (!validated.ok) return;

    const violations = checkColumnTypeContract([{ name: "date", type: "strinng" }], "x.yaml");
    const verdict = evaluatePublishGate(
      violations.map((v) => ({ ...v, connectionId: "demo-mysql" })),
      validated.exemption,
      NOW
    );
    expect(verdict.allowed).toBe(true);
    expect(verdict.waived?.operator).toBe("alice");
    expect(verdict.waived?.reason).toBe("上游字段类型待修正");
    expect(verdict.waived?.expiresAt).toBe("2026-10-12T00:00:00.000Z");
    expect(verdict.waived?.grantedAt).toBe(NOW.toISOString());
  });

  it("fails the same publish again once the exemption expires", () => {
    const exemption = {
      operator: "alice",
      reason: "上游字段类型待修正",
      expiresAt: "2026-10-12T00:00:00.000Z",
      checkIds: ["columns.0.type"]
    };
    const violations: PublishGateViolation[] = [
      { checkId: "columns.0.type", message: "bad type", connectionId: "demo-mysql" }
    ];

    expect(evaluatePublishGate(violations, exemption, NOW).allowed).toBe(true);

    // Just before expiry it still applies...
    expect(evaluatePublishGate(violations, exemption, new Date("2026-10-11T23:59:59.000Z")).allowed).toBe(true);
    // ...and at expiry the same publish fails again.
    const afterExpiry = evaluatePublishGate(violations, exemption, new Date("2026-10-12T00:00:00.000Z"));
    expect(afterExpiry.allowed).toBe(false);
    expect(afterExpiry.rejectedReason).toBe("exemption_expired");
    expect(afterExpiry.blocking.map((v) => v.checkId)).toEqual(["columns.0.type"]);
  });

  it("never lets an exemption cover a check it does not name", () => {
    const exemption = {
      operator: "alice",
      reason: "只豁免一个列",
      expiresAt: "2026-10-12T00:00:00.000Z",
      checkIds: ["columns.0.type"]
    };
    const decision = applyPublishExemption(
      [{ checkId: "columns.3.type", message: "another bad type" }],
      exemption,
      NOW
    );
    expect(decision.waived).toBe(false);
    expect(decision.rejectedReason).toBe("exemption_does_not_apply");
  });

  it("scopes a connection-bound exemption to that connection", () => {
    const exemption = {
      operator: "alice",
      reason: "仅 demo 连接",
      expiresAt: "2026-10-12T00:00:00.000Z",
      checkIds: ["columns.0.type"],
      connectionId: "demo-mysql"
    };
    const demoOnly = evaluatePublishGate(
      [{ checkId: "columns.0.type", message: "bad", connectionId: "demo-mysql" }],
      exemption,
      NOW
    );
    expect(demoOnly.allowed).toBe(true);

    const otherConnection = evaluatePublishGate(
      [{ checkId: "columns.0.type", message: "bad", connectionId: "prod-db" }],
      exemption,
      NOW
    );
    expect(otherConnection.allowed).toBe(false);
  });

  it("cannot waive a non-waivable check even when named directly", () => {
    const exemption = {
      operator: "alice",
      reason: "尝试关闭全部检查",
      expiresAt: "2026-10-12T00:00:00.000Z",
      checkIds: ["contract_presence"]
    };
    const verdict = evaluatePublishGate(
      [{ checkId: "contract_presence", message: "manifest 缺失" }],
      exemption,
      NOW
    );
    expect(verdict.allowed).toBe(false);
    expect(verdict.waived).toBeNull();
  });

  it("generates neither an alias nor a join whitelist", async () => {
    const source = await import("node:fs/promises").then((fs) =>
      fs.readFile(new URL("../publish-gate.ts", import.meta.url), "utf8")
    );
    expect(source).not.toMatch(/join_whitelist/i);
    // Aliases live in the customer semantic layer, not in this gate.
    expect(source).not.toMatch(/physical[_A-Za-z]*alias\s*[:=]/i);
  });
});