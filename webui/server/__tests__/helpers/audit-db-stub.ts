import { vi } from "vitest";

/**
 * Empty-DB Statement stub for getAuditDb mocks.
 *
 * Real better-sqlite3 always returns a row for aggregate
 * `SELECT COALESCE(MAX(id), 0) AS id ...` (id === 0 on empty tables).
 * A blanket `get: () => undefined` crashes inferred-turn-maintainer on
 * `noteMaxId(mark.id)` during buildServer onReady.
 */
export function stubAuditStatement(sql: string) {
  if (/COALESCE\s*\(\s*MAX\s*\(\s*id\s*\)/i.test(sql)) {
    return {
      get: vi.fn(() => ({ id: 0 })),
      all: vi.fn(() => []),
      run: vi.fn(() => ({ lastInsertRowid: 1 }))
    };
  }
  return {
    get: vi.fn(() => undefined),
    all: vi.fn(() => []),
    run: vi.fn(() => ({ lastInsertRowid: 1 }))
  };
}

/** Minimal empty audit DB shape used by most admin route suites. */
export function createEmptyAuditDbStub() {
  return {
    prepare: vi.fn((sql: string) => stubAuditStatement(sql)),
    exec: vi.fn(),
    pragma: vi.fn(),
    transaction: vi.fn((fn: (...args: unknown[]) => unknown) => fn)
  };
}
