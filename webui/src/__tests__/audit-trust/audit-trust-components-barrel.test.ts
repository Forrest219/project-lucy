/**
 * T05d audit-trust components 索引 (barrel) 测试
 */
import { describe, expect, it } from "vitest";
import * as auditTrust from "../../components/audit-trust";

describe("T05d audit-trust components barrel", () => {
  it("re-exports all six contract components", () => {
    expect(typeof auditTrust.AuditStatusTriad).toBe("function");
    expect(typeof auditTrust.AuditTopMetaBar).toBe("function");
    expect(typeof auditTrust.CredentialPrincipalCell).toBe("function");
    expect(typeof auditTrust.AssociationRevisionTimeline).toBe("function");
    expect(typeof auditTrust.ClientCoveragePill).toBe("function");
    expect(typeof auditTrust.ReadonlySqlRowset).toBe("function");
  });
});