import { describe, expect, it } from "vitest";
import {
  buildReadonlySnapshotPlan,
  type ReadonlySnapshotPlanInput
} from "../admin/readonly-snapshot-plan";

/**
 * Spec 187 (R0) — read-only snapshot inventory plan.
 *
 * In-memory fixtures only. The test suite never opens a database, never
 * reads disk, and never logs a real token or password. The forbidden-key
 * checks bypass TypeScript with `as unknown as` because the production
 * type signature has no password / token slot — the test still has to
 * prove the defensive walker rejects stray credential keys.
 */

const SHA_A = "a".repeat(64);
const SHA_B = "b".repeat(64);
const SHA_C = "c".repeat(64);
const SHA_D = "d".repeat(64);
const SHA_E = "e".repeat(64);
const SHA_F = "f".repeat(64);

function baseInput(overrides: Partial<ReadonlySnapshotPlanInput> = {}): ReadonlySnapshotPlanInput {
  return {
    connections: [
      {
        id: "mysql-aliyun",
        database: "dataforai",
        enabledTables: ["fin_ledger", "fin_txn_2026"]
      }
    ],
    contentFingerprints: [
      { relativePath: "semantic-layer/dataforai/fin_ledger.yaml", sha256: SHA_A },
      { relativePath: "wiki/fin_ledger.md", sha256: SHA_B }
    ],
    auditSnapshotSha256: SHA_C,
    ...overrides
  };
}

describe("buildReadonlySnapshotPlan — happy path (Spec 187 §2)", () => {
  it("emits D1, D2, D3 in order with the spec wording", () => {
    const plan = buildReadonlySnapshotPlan(baseInput());
    expect(plan.decisions.map((d) => d.id)).toEqual(["D1", "D2", "D3"]);
    expect(plan.decisions.map((d) => d.statement)).toEqual([
      "两张业务表且不含 UID",
      "启用表范围交集",
      "连接 id `mysql-aliyun`"
    ]);
  });

  it("lists connections without password fields and keeps enabled-table scope intact", () => {
    const plan = buildReadonlySnapshotPlan(baseInput());
    expect(plan.connections).toEqual([
      {
        id: "mysql-aliyun",
        database: "dataforai",
        enabledTables: ["fin_ledger", "fin_txn_2026"]
      }
    ]);
    // The returned connection objects must not carry any credential-shaped key.
    for (const connection of plan.connections) {
      expect(Object.keys(connection).sort()).toEqual(["database", "enabledTables", "id"]);
    }
  });

  it("returns contentFingerprints verbatim (relative path + sha256) and the audit snapshot hash", () => {
    const plan = buildReadonlySnapshotPlan(baseInput());
    expect(plan.contentFingerprints).toEqual([
      { relativePath: "semantic-layer/dataforai/fin_ledger.yaml", sha256: SHA_A },
      { relativePath: "wiki/fin_ledger.md", sha256: SHA_B }
    ]);
    expect(plan.auditSnapshotSha256).toBe(SHA_C);
  });

  it("always reports an empty `writes` array (R0 is inventory-only)", () => {
    const plan = buildReadonlySnapshotPlan(baseInput());
    expect(plan.writes).toEqual([]);
    // The shape is locked: any future widening must be deliberate.
    expect(plan.writes.length).toBe(0);
  });
});

describe("buildReadonlySnapshotPlan — empty / no-snapshot paths", () => {
  it("returns an empty auditSnapshotSha256 verbatim when no snapshot was produced", () => {
    const plan = buildReadonlySnapshotPlan({
      connections: [],
      contentFingerprints: [],
      auditSnapshotSha256: ""
    });
    expect(plan.auditSnapshotSha256).toBe("");
  });

  it("keeps an empty enabledTables list as empty, never as 'all tables' (D2)", () => {
    const plan = buildReadonlySnapshotPlan({
      connections: [
        { id: "mysql-aliyun", database: "dataforai", enabledTables: [] }
      ],
      contentFingerprints: [],
      auditSnapshotSha256: ""
    });
    expect(plan.connections[0]?.enabledTables).toEqual([]);
    // D2 invariant: the plan must not invent an "all" or wildcard fallback.
    expect(plan.connections[0]?.enabledTables.includes("*")).toBe(false);
  });

  it("accepts an input with no connections and no fingerprints", () => {
    const plan = buildReadonlySnapshotPlan({
      connections: [],
      contentFingerprints: [],
      auditSnapshotSha256: ""
    });
    expect(plan.connections).toEqual([]);
    expect(plan.contentFingerprints).toEqual([]);
    expect(plan.writes).toEqual([]);
  });
});

describe("buildReadonlySnapshotPlan — credential safety", () => {
  it("rejects a top-level `password` field rather than echoing it", () => {
    const malicious = baseInput({
      connections: [
        {
          id: "mysql-aliyun",
          database: "dataforai",
          enabledTables: ["fin_ledger"],
          password: "leaked-secret-password-value"
        } as unknown as ReadonlySnapshotPlanInput["connections"][number]
      ]
    });
    expect(() => buildReadonlySnapshotPlan(malicious)).toThrow(/forbidden credential field/);
  });

  it("rejects a top-level `token` field", () => {
    const malicious = baseInput({
      connections: [
        {
          id: "mysql-aliyun",
          database: "dataforai",
          enabledTables: ["fin_ledger"],
          token: "leaked-full-bearer-token"
        } as unknown as ReadonlySnapshotPlanInput["connections"][number]
      ]
    });
    expect(() => buildReadonlySnapshotPlan(malicious)).toThrow(/forbidden credential field/);
  });

  it("rejects a nested `token_hash` field on a credentials-shaped object", () => {
    const malicious = {
      connections: [
        {
          id: "mysql-aliyun",
          database: "dataforai",
          enabledTables: ["fin_ledger"],
          auth: { token_hash: "f".repeat(64) }
        } as unknown as ReadonlySnapshotPlanInput["connections"][number]
      ],
      contentFingerprints: [],
      auditSnapshotSha256: ""
    };
    expect(() => buildReadonlySnapshotPlan(malicious)).toThrow(/forbidden credential field/);
  });

  it("rejects a snake_case token_hash prefix variant", () => {
    const malicious = baseInput({
      contentFingerprints: [
        {
          relativePath: "wiki/fin_ledger.md",
          sha256: SHA_D,
          token_hash: "deadbeef".repeat(8)
        } as unknown as ReadonlySnapshotPlanInput["contentFingerprints"][number]
      ]
    });
    expect(() => buildReadonlySnapshotPlan(malicious)).toThrow(/forbidden credential field/);
  });

  it("does not include any forbidden key in the returned plan JSON", () => {
    const plan = buildReadonlySnapshotPlan(baseInput());
    const json = JSON.stringify(plan);
    expect(json).not.toMatch(/password|passwd|pwd/i);
    expect(json).not.toMatch(/token|access_token|refresh_token|bearer/i);
    expect(json).not.toMatch(/token_hash|client_secret|api_key|authorization/i);
  });
});

describe("buildReadonlySnapshotPlan — stable ordering", () => {
  it("sorts enabledTables alphabetically per connection", () => {
    const plan = buildReadonlySnapshotPlan({
      connections: [
        {
          id: "mysql-aliyun",
          database: "dataforai",
          enabledTables: ["fin_txn_2026", "fin_ledger", "fin_cashflow"]
        }
      ],
      contentFingerprints: [],
      auditSnapshotSha256: ""
    });
    expect(plan.connections[0]?.enabledTables).toEqual([
      "fin_cashflow",
      "fin_ledger",
      "fin_txn_2026"
    ]);
  });

  it("sorts contentFingerprints by relativePath", () => {
    const plan = buildReadonlySnapshotPlan({
      connections: [],
      contentFingerprints: [
        { relativePath: "wiki/fin_ledger.md", sha256: SHA_E },
        { relativePath: "semantic-layer/dataforai/fin_ledger.yaml", sha256: SHA_F },
        { relativePath: "evals/sql/fin_ledger.sql", sha256: SHA_A }
      ],
      auditSnapshotSha256: ""
    });
    expect(plan.contentFingerprints.map((f) => f.relativePath)).toEqual([
      "evals/sql/fin_ledger.sql",
      "semantic-layer/dataforai/fin_ledger.yaml",
      "wiki/fin_ledger.md"
    ]);
  });

  it("does not mutate the caller's input arrays", () => {
    const enabledTables = ["fin_txn_2026", "fin_ledger"];
    const fingerprints = [
      { relativePath: "wiki/fin_ledger.md", sha256: SHA_E },
      { relativePath: "semantic-layer/dataforai/fin_ledger.yaml", sha256: SHA_F }
    ];
    const snapshot = {
      enabledTables: [...enabledTables],
      fingerprints: fingerprints.map((f) => ({ ...f }))
    };
    buildReadonlySnapshotPlan({
      connections: [
        { id: "mysql-aliyun", database: "dataforai", enabledTables }
      ],
      contentFingerprints: fingerprints,
      auditSnapshotSha256: ""
    });
    expect(enabledTables).toEqual(snapshot.enabledTables);
    expect(fingerprints).toEqual(snapshot.fingerprints);
  });
});

describe("buildReadonlySnapshotPlan — input validation", () => {
  it("rejects malformed sha256 in a content fingerprint", () => {
    expect(() =>
      buildReadonlySnapshotPlan({
        connections: [],
        contentFingerprints: [{ relativePath: "wiki/foo.md", sha256: "not-a-sha256" }],
        auditSnapshotSha256: ""
      })
    ).toThrow(/sha256/);
  });

  it("rejects a non-empty malformed auditSnapshotSha256", () => {
    expect(() =>
      buildReadonlySnapshotPlan({
        connections: [],
        contentFingerprints: [],
        auditSnapshotSha256: "too-short"
      })
    ).toThrow(/sha256/);
  });

  it("rejects a missing connection id", () => {
    expect(() =>
      buildReadonlySnapshotPlan({
        connections: [
          { id: "", database: "dataforai", enabledTables: [] }
        ],
        contentFingerprints: [],
        auditSnapshotSha256: ""
      })
    ).toThrow(/id/);
  });

  it("rejects a non-array enabledTables", () => {
    expect(() =>
      buildReadonlySnapshotPlan({
        connections: [
          {
            id: "mysql-aliyun",
            database: "dataforai",
            enabledTables: "fin_ledger" as unknown as string[]
          }
        ],
        contentFingerprints: [],
        auditSnapshotSha256: ""
      })
    ).toThrow(/enabledTables/);
  });
});