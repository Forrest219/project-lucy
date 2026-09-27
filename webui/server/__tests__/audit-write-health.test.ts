import { beforeEach, describe, expect, it } from "vitest";
import {
  beginAuditWrite,
  completeAuditWrite,
  failAuditWrite,
  readAuditWriteHealth,
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
});
