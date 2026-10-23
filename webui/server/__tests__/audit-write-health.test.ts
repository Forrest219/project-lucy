import { beforeEach, describe, expect, it } from "vitest";
import {
  beginAuditWrite,
  completeAuditWrite,
  failAuditWrite,
  readAuditWriteHealth,
  recordLedgerAppend,
  recordProjectionStatus,
  resetAuditWriteHealthForTests
} from "../proxy/audit-write-health.js";

describe("audit write health", () => {
  beforeEach(() => resetAuditWriteHealthForTests());

  it("reports pending and failed writes as partial", () => {
    beginAuditWrite();
    expect(readAuditWriteHealth()).toMatchObject({ state: "partial", pendingWrites: 1, failedWrites: 0 });
    failAuditWrite();
    expect(readAuditWriteHealth()).toMatchObject({ state: "partial", pendingWrites: 0, failedWrites: 1 });
  });

  it("reports completed writes without failures as ok", () => {
    beginAuditWrite();
    completeAuditWrite();
    expect(readAuditWriteHealth()).toMatchObject({
      state: "ok",
      pendingWrites: 0,
      failedWrites: 0,
      successfulWrites: 1
    });
  });

  it("reports canonical ledger failures independently of access_log writes and projection lag", () => {
    expect(readAuditWriteHealth()).toMatchObject({ ledger: { state: "ok", failedAppends: 0 }, projection: { complete: null } });

    recordLedgerAppend(false);
    recordProjectionStatus({ complete: true, lag: 0, delayMs: 0 });
    // A healthy projection never masks a failed canonical append, and access_log writes stay "ok".
    expect(readAuditWriteHealth()).toMatchObject({
      state: "ok",
      ledger: { state: "unavailable", failedAppends: 1 },
      projection: { complete: true }
    });

    recordLedgerAppend(true);
    expect(readAuditWriteHealth().ledger).toMatchObject({ state: "ok", failedAppends: 1 });
  });
});
