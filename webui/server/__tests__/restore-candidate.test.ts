import { describe, expect, it } from "vitest";
import {
  buildRestoreCandidate,
  RESTORE_CONNECTION_ID,
  RESTORE_REJECTED_NAME_SUBSTRING,
  RESTORE_TABLE_COUNT,
  RestoreCandidateInvalidError,
  type RestoreCurrent,
  type RestoreTarget
} from "../admin/restore-candidate";

/**
 * Spec 188 (R1) — restore candidate preview. In-memory fixtures only; no
 * disk reads, no database connections, no real tokens, no passwords.
 *
 * The forbidden-key checks bypass TypeScript with `as unknown as` because
 * the production type signature has no password / token slot — the test
 * still has to prove the defensive walker rejects stray credential keys.
 */

const SHA = (hex: string): string => hex.repeat(64 / hex.length).slice(0, 64);

const SHA_A = SHA("a");
const SHA_B = SHA("b");
const SHA_C = SHA("c");
const SHA_D = SHA("d");
const SHA_E = SHA("e");

/** Eight-table Schema Manifest — the "all-fixtures" baseline. */
const EIGHT_MANIFEST_ENTRIES: Array<{ physicalTable: string; manifestPath: string }> = [
  {
    physicalTable: "fin.fin_audit",
    manifestPath: "semantic-layer/mysql-aliyun/_schema/fin.yaml"
  },
  {
    physicalTable: "fin.fin_budget",
    manifestPath: "semantic-layer/mysql-aliyun/_schema/fin.yaml"
  },
  {
    physicalTable: "fin.fin_forecast",
    manifestPath: "semantic-layer/mysql-aliyun/_schema/fin.yaml"
  },
  {
    physicalTable: "fin.fin_fx",
    manifestPath: "semantic-layer/mysql-aliyun/_schema/fin.yaml"
  },
  {
    physicalTable: "fin.fin_hold",
    manifestPath: "semantic-layer/mysql-aliyun/_schema/fin.yaml"
  },
  {
    physicalTable: "fin.fin_ledger",
    manifestPath: "semantic-layer/mysql-aliyun/_schema/fin.yaml"
  },
  {
    physicalTable: "fin.fin_tax",
    manifestPath: "semantic-layer/mysql-aliyun/_schema/fin.yaml"
  },
  {
    physicalTable: "fin.fin_uid_dirty",
    manifestPath: "semantic-layer/mysql-aliyun/_schema/fin.yaml"
  }
];

function baseCurrent(overrides: Partial<RestoreCurrent> = {}): RestoreCurrent {
  return {
    connection: {
      id: "warehouse",
      database: "dataforai",
      enabledTables: [
        "fin.fin_budget",
        "fin.fin_hold",
        "fin.fin_ledger",
        "fin.fin_tax"
      ]
    },
    manifestTables: EIGHT_MANIFEST_ENTRIES.map((row) => ({ ...row })),
    contentFingerprints: [
      { relativePath: "semantic-layer/mysql-aliyun/_schema/fin.yaml", sha256: SHA_A },
      { relativePath: "semantic-layer/mysql-aliyun/fin_ledger.yaml", sha256: SHA_B },
      { relativePath: "semantic-layer/mysql-aliyun/fin_budget.yaml", sha256: SHA_C },
      { relativePath: "wiki/global.md", sha256: SHA_D },
      { relativePath: "wiki/playbook.md", sha256: SHA_E }
    ],
    ...overrides
  };
}

function targetTwo(overrides: Partial<RestoreTarget> = {}): RestoreTarget {
  return {
    connectionId: RESTORE_CONNECTION_ID,
    tables: ["fin.fin_ledger", "fin.fin_budget"],
    ...overrides
  };
}

// ====================================================================
// §2 — happy path (eight-table Manifest, target two tables, apply false)
// ====================================================================

describe("buildRestoreCandidate — happy path (Spec 188 §2)", () => {
  it("keeps the two target tables in keptManifestTables and drops the other six", () => {
    const candidate = buildRestoreCandidate(
      baseCurrent(),
      targetTwo()
    );
    expect(candidate.apply).toBe(false);
    expect(candidate.keptManifestTables).toEqual([
      {
        physicalTable: "fin.fin_budget",
        manifestPath: "semantic-layer/mysql-aliyun/_schema/fin.yaml"
      },
      {
        physicalTable: "fin.fin_ledger",
        manifestPath: "semantic-layer/mysql-aliyun/_schema/fin.yaml"
      }
    ]);
    expect(candidate.droppedManifestTables.map((row) => row.physicalTable)).toEqual([
      "fin.fin_audit",
      "fin.fin_forecast",
      "fin.fin_fx",
      "fin.fin_hold",
      "fin.fin_tax",
      "fin.fin_uid_dirty"
    ]);
    expect(candidate.droppedManifestTables).toHaveLength(6);
  });

  it("synthesises one overlay path per kept table under the target connection id", () => {
    const candidate = buildRestoreCandidate(
      baseCurrent(),
      targetTwo()
    );
    expect(candidate.keptOverlayPaths).toEqual([
      {
        physicalTable: "fin.fin_budget",
        overlayPath: "semantic-layer/mysql-aliyun/fin_budget.yaml"
      },
      {
        physicalTable: "fin.fin_ledger",
        overlayPath: "semantic-layer/mysql-aliyun/fin_ledger.yaml"
      }
    ]);
  });

  it("records the connection id delta as before→mysql-aliyun", () => {
    const candidate = buildRestoreCandidate(
      baseCurrent(),
      targetTwo()
    );
    expect(candidate.connection).toEqual({ before: "warehouse", after: "mysql-aliyun" });
  });

  it("records roleSelectorConnection as mysql-aliyun (D3)", () => {
    const candidate = buildRestoreCandidate(
      baseCurrent(),
      targetTwo()
    );
    expect(candidate.roleSelectorConnection).toBe("mysql-aliyun");
  });

  it("lists mirrorOldDirectories with action=mirror_only and never declares delete", () => {
    const candidate = buildRestoreCandidate(
      baseCurrent({
        mirrorOldDirectories: [
          { relativePath: "wiki/warehouse/global.md", connectionId: "warehouse" },
          { relativePath: "wiki/warehouse/playbook.md", connectionId: "warehouse" }
        ]
      }),
      targetTwo()
    );
    expect(candidate.mirrorOldDirectories).toEqual([
      {
        relativePath: "wiki/warehouse/global.md",
        connectionId: "warehouse",
        action: "mirror_only"
      },
      {
        relativePath: "wiki/warehouse/playbook.md",
        connectionId: "warehouse",
        action: "mirror_only"
      }
    ]);
    for (const entry of candidate.mirrorOldDirectories) {
      expect(entry.action).toBe("mirror_only");
      // The candidate never declares deletion for mirror directories.
      expect(entry.action).not.toBe("delete");
    }
  });

  it("does not widen the target to four tables when six extra manifest entries exist", () => {
    const candidate = buildRestoreCandidate(
      baseCurrent(),
      targetTwo()
    );
    expect(candidate.keptManifestTables).toHaveLength(RESTORE_TABLE_COUNT);
    expect(candidate.keptOverlayPaths).toHaveLength(RESTORE_TABLE_COUNT);
    // The dropped counter matches: 8 - 2 = 6.
    expect(candidate.droppedManifestTables).toHaveLength(6);
    // dropped is the source of truth; the function never "auto-extends"
    // `kept` to cover the rest of the Manifest.
    expect(candidate.keptManifestTables).not.toContainEqual(
      expect.objectContaining({ physicalTable: "fin.fin_audit" })
    );
    expect(candidate.keptManifestTables).not.toContainEqual(
      expect.objectContaining({ physicalTable: "fin.fin_uid_dirty" })
    );
  });
});

// ====================================================================
// §2 — target rejections (tables ≠ 2, connection id ≠ mysql-aliyun, uid)
// ====================================================================

describe("buildRestoreCandidate — target rejections (Spec 188 §2)", () => {
  it("rejects when target.tables has zero entries", () => {
    expect(() =>
      buildRestoreCandidate(baseCurrent(), targetTwo({ tables: [] }))
    ).toThrow(/exactly 2/);
    expect(() =>
      buildRestoreCandidate(baseCurrent(), targetTwo({ tables: [] }))
    ).toThrowError(RestoreCandidateInvalidError);
  });

  it("rejects when target.tables has exactly one entry", () => {
    expect(() =>
      buildRestoreCandidate(
        baseCurrent(),
        targetTwo({ tables: ["fin.fin_ledger"] })
      )
    ).toThrow(/exactly 2/);
  });

  it("rejects when target.tables has three entries (the D1 'do not widen' guard)", () => {
    expect(() =>
      buildRestoreCandidate(
        baseCurrent(),
        targetTwo({
          tables: ["fin.fin_ledger", "fin.fin_budget", "fin.fin_tax"]
        })
      )
    ).toThrow(/exactly 2/);
  });

  it("rejects when target.tables has four entries", () => {
    expect(() =>
      buildRestoreCandidate(
        baseCurrent(),
        targetTwo({
          tables: [
            "fin.fin_ledger",
            "fin.fin_budget",
            "fin.fin_tax",
            "fin.fin_audit"
          ]
        })
      )
    ).toThrow(/exactly 2/);
  });

  it("rejects when target.connectionId is not 'mysql-aliyun'", () => {
    expect(() =>
      buildRestoreCandidate(
        baseCurrent(),
        targetTwo({ connectionId: "warehouse" })
      )
    ).toThrow(/mysql-aliyun/);
  });

  it("rejects when one of the target tables contains 'uid' in its full name", () => {
    expect(() =>
      buildRestoreCandidate(
        baseCurrent(),
        targetTwo({ tables: ["fin.fin_ledger", "fin.fin_uid_dirty"] })
      )
    ).toThrow(/uid/);
  });

  it("rejects when the source name (post-dot) contains 'uid'", () => {
    // The schema part "fin" is fine; the source part "fin_uid_dirty" contains "uid".
    expect(() =>
      buildRestoreCandidate(
        baseCurrent(),
        targetTwo({ tables: ["fin.fin_ledger", "fin.fin_uid_budget"] })
      )
    ).toThrow(/uid/);
  });

  it("rejects when target.tables contains an entry that is not in schema.table form", () => {
    expect(() =>
      buildRestoreCandidate(
        baseCurrent(),
        targetTwo({ tables: ["fin.fin_ledger", "fin_ledger"] })
      )
    ).toThrow(/schema\.table|uid/);
  });

  it("attaches the same error code and HTTP status to every target rejection", () => {
    try {
      buildRestoreCandidate(
        baseCurrent(),
        targetTwo({ tables: ["fin.fin_ledger", "fin.fin_uid_dirty"] })
      );
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(RestoreCandidateInvalidError);
      const error = err as RestoreCandidateInvalidError;
      expect(error.code).toBe("RESTORE_CANDIDATE_TARGET_INVALID");
      expect(error.statusCode).toBe(400);
      expect(Array.isArray(error.detail?.reasons)).toBe(true);
    }
  });
});

// ====================================================================
// §2 — input / credential safety
// ====================================================================

describe("buildRestoreCandidate — credential safety (Spec 188 §1)", () => {
  it("rejects a top-level `password` field on `current.connection`", () => {
    const malicious = baseCurrent({
      connection: {
        id: "warehouse",
        database: "dataforai",
        enabledTables: [],
        password: "leaked-inline-password"
      } as unknown as RestoreCurrent["connection"]
    });
    expect(() =>
      buildRestoreCandidate(malicious, targetTwo())
    ).toThrow(/forbidden credential field/);
  });

  it("rejects a `token_hash` field nested inside `current`", () => {
    const malicious = {
      ...baseCurrent(),
      token_hash: "deadbeef".repeat(8)
    } as unknown as RestoreCurrent;
    expect(() =>
      buildRestoreCandidate(malicious, targetTwo())
    ).toThrow(/forbidden credential field/);
  });

  it("rejects a `bearer` field nested inside `target`", () => {
    const malicious = {
      connectionId: RESTORE_CONNECTION_ID,
      tables: ["fin.fin_ledger", "fin.fin_budget"],
      bearer: "leaked-bearer-token"
    } as unknown as RestoreTarget;
    expect(() => buildRestoreCandidate(baseCurrent(), malicious)).toThrow(
      /forbidden credential field/
    );
  });

  it("does not include any forbidden field in the returned candidate JSON", () => {
    const candidate = buildRestoreCandidate(baseCurrent(), targetTwo());
    const json = JSON.stringify(candidate);
    expect(json).not.toMatch(/password|passwd|pwd/i);
    expect(json).not.toMatch(/token|access_token|refresh_token|bearer/i);
    expect(json).not.toMatch(/token_hash|client_secret|api_key|authorization/i);
  });
});

// ====================================================================
// §2 — input validation
// ====================================================================

describe("buildRestoreCandidate — input validation (Spec 188 §2)", () => {
  it("rejects a malformed sha256 in contentFingerprints", () => {
    expect(() =>
      buildRestoreCandidate(
        baseCurrent({
          contentFingerprints: [{ relativePath: "wiki/foo.md", sha256: "not-a-sha256" }]
        }),
        targetTwo()
      )
    ).toThrow(/sha256/);
  });

  it("rejects a missing connection id on the current snapshot", () => {
    expect(() =>
      buildRestoreCandidate(
        baseCurrent({
          connection: {
            id: "",
            database: "dataforai",
            enabledTables: []
          }
        }),
        targetTwo()
      )
    ).toThrow(/id/);
  });

  it("rejects a non-array contentFingerprints list", () => {
    expect(() =>
      buildRestoreCandidate(
        baseCurrent({
          contentFingerprints: "wiki/foo.md" as unknown as RestoreCurrent["contentFingerprints"]
        }),
        targetTwo()
      )
    ).toThrow(/contentFingerprints/);
  });

  it("rejects a target whose tables list is missing", () => {
    expect(() =>
      buildRestoreCandidate(
        baseCurrent(),
        { connectionId: RESTORE_CONNECTION_ID } as unknown as RestoreTarget
      )
    ).toThrow(/tables/);
  });

  it("rejects a candidate whose target tables are not in the current Manifest", () => {
    // The fix would be `target.tables` references two tables not in the
    // 8-row fixture; R1 must throw instead of silently widening.
    expect(() =>
      buildRestoreCandidate(
        baseCurrent(),
        targetTwo({ tables: ["fin.fin_ledger", "fin.fin_missing"] })
      )
    ).toThrow(/kept Manifest tables must equal 2|silently widen/);
  });
});

// ====================================================================
// §2 — stability & invariants
// ====================================================================

describe("buildRestoreCandidate — stability & invariants (Spec 188 §2)", () => {
  it("sorts keptManifestTables alphabetically by physicalTable", () => {
    const candidate = buildRestoreCandidate(
      baseCurrent(),
      targetTwo({ tables: ["fin.fin_ledger", "fin.fin_budget"] })
    );
    expect(candidate.keptManifestTables.map((row) => row.physicalTable)).toEqual([
      "fin.fin_budget",
      "fin.fin_ledger"
    ]);
  });

  it("sorts droppedManifestTables alphabetically", () => {
    const candidate = buildRestoreCandidate(baseCurrent(), targetTwo());
    expect(candidate.droppedManifestTables.map((row) => row.physicalTable)).toEqual([
      "fin.fin_audit",
      "fin.fin_forecast",
      "fin.fin_fx",
      "fin.fin_hold",
      "fin.fin_tax",
      "fin.fin_uid_dirty"
    ]);
  });

  it("does not mutate the caller's input arrays", () => {
    const manifestTables = EIGHT_MANIFEST_ENTRIES.map((row) => ({ ...row }));
    const fingerprints = [
      { relativePath: "wiki/foo.md", sha256: SHA_A },
      { relativePath: "wiki/bar.md", sha256: SHA_B }
    ];
    const targetTables = ["fin.fin_ledger", "fin.fin_budget"];
    const snapshot = {
      manifest: manifestTables.map((row) => ({ ...row })),
      fingerprints: fingerprints.map((row) => ({ ...row })),
      target: [...targetTables]
    };
    buildRestoreCandidate(
      baseCurrent({ manifestTables, contentFingerprints: fingerprints }),
      targetTwo({ tables: targetTables })
    );
    expect(manifestTables).toEqual(snapshot.manifest);
    expect(fingerprints).toEqual(snapshot.fingerprints);
    expect(targetTables).toEqual(snapshot.target);
  });

  it("applies the locked apply=false invariant on every output shape", () => {
    const candidate = buildRestoreCandidate(baseCurrent(), targetTwo());
    expect(candidate.apply).toBe(false);
  });

  it("pins roleSelectorConnection to the constant from the spec", () => {
    const candidate = buildRestoreCandidate(baseCurrent(), targetTwo());
    expect(candidate.roleSelectorConnection).toBe(RESTORE_CONNECTION_ID);
    // The token must not be silently injected from the target — it is the
    // literal D3 string.
    expect(RESTORE_CONNECTION_ID).toBe("mysql-aliyun");
    expect(RESTORE_TABLE_COUNT).toBe(2);
    expect(RESTORE_REJECTED_NAME_SUBSTRING).toBe("uid");
  });

  it("accepts a current snapshot whose connection id already equals the target id", () => {
    const candidate = buildRestoreCandidate(
      baseCurrent({
        connection: {
          id: "mysql-aliyun",
          database: "dataforai",
          enabledTables: ["fin.fin_ledger"]
        }
      }),
      targetTwo()
    );
    expect(candidate.connection).toEqual({ before: "mysql-aliyun", after: "mysql-aliyun" });
    expect(candidate.apply).toBe(false);
  });

  it("treats an undefined `mirrorOldDirectories` list as an empty one (no spurious entries)", () => {
    const candidate = buildRestoreCandidate(baseCurrent(), targetTwo());
    expect(candidate.mirrorOldDirectories).toEqual([]);
  });
});
