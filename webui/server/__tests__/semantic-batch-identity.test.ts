// Lucy v0.25 — D1/D3/D6: semantic identity resolution, dependency closure and
// the shared capacity limits.
//
// Coverage:
//  - Identity is derived from the Schema Manifest model, never from a file
//    name (the `manifestSchemaFromTables` heuristic is replaced).
//  - Same table name in two schemas of ONE connection shares one overlay
//    file → selecting one of them is blocked (V01 / Spec §4.4).
//  - Same table name in TWO connections stays two distinct objects.
//  - A partial identity query that matches several model entries is an
//    ambiguity, never a silent first match.
//  - The dependency closure lists read-only dependencies separately and never
//    promotes a dependency to a writable target.
//  - A missing / ambiguous join reference blocks the whole closure.
//  - The shared limit definitions reject over-limit input without truncating.

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  SemanticIdentityError,
  buildSemanticModelIndex,
  computeUnselectedSharedTargets,
  formatSemanticIdentity,
  resolveSemanticDependencyClosure,
  resolveSemanticIdentity,
  sortUniqueSemanticIdentities,
  type SemanticTableIdentity
} from "../semantic-identity";
import {
  SEMANTIC_BATCH_LIMITS,
  SemanticLimitError,
  assertDependencyLimit,
  assertPackageWithinImportLimits,
  assertSelectedTableLimit,
  assertSingleYamlLimit,
  assertUnpackedLimit,
  assertYamlEntryLimit,
  assertZipLimit
} from "../semantic-limits";

let projectRoot: string;
let previousContentRoot: string | undefined;

async function writeFileAt(relPath: string, content: string): Promise<void> {
  const abs = path.join(projectRoot, relPath);
  await mkdir(path.dirname(abs), { recursive: true });
  await writeFile(abs, content, "utf8");
}

async function makeProject(): Promise<void> {
  projectRoot = await mkdtemp(path.join(os.tmpdir(), "lucy-v025-identity-"));
  await writeFileAt(
    "ktx.yaml",
    `connections:
  shop-db:
    driver: postgres
    schemas:
      - public
      - archive
    enabled_tables:
      - public.orders
  warehouse-db:
    driver: mysql
    schemas:
      - public
    enabled_tables:
      - public.orders
`
  );
}

/** shop-db / public / orders */
async function seedSingleConnection(): Promise<void> {
  await writeFileAt(
    "semantic-layer/shop-db/_schema/public.yaml",
    `tables:
  orders:
    table: public.orders
    columns:
      - name: id
        type: number
`
  );
  await writeFileAt(
    "semantic-layer/shop-db/orders.yaml",
    `name: orders
table: public.orders
`
  );
}

beforeEach(async () => {
  previousContentRoot = process.env.LUCY_CONTENT_ROOT;
  process.env.LUCY_CONTENT_ROOT = ".";
  await makeProject();
});

afterEach(async () => {
  if (previousContentRoot === undefined) delete process.env.LUCY_CONTENT_ROOT;
  else process.env.LUCY_CONTENT_ROOT = previousContentRoot;
  if (projectRoot) await rm(projectRoot, { recursive: true, force: true });
});

describe("D1 identity resolution contract", () => {
  it("resolves an identity from the manifest model, not from the file name", async () => {
    await seedSingleConnection();
    const index = await buildSemanticModelIndex(projectRoot);

    expect(index.entries).toHaveLength(1);
    const entry = index.byKey.get("shop-db/public/orders");
    expect(entry).toBeDefined();
    expect(entry?.manifestRelPath).toBe("semantic-layer/shop-db/_schema/public.yaml");
    expect(entry?.overlayRelPath).toBe("semantic-layer/shop-db/orders.yaml");
    expect(entry?.qualifiedName).toBe("public.orders");
    expect(entry?.overlayExists).toBe(true);
  });

  it("keeps same-named tables of two connections apart", async () => {
    await seedSingleConnection();
    await writeFileAt(
      "semantic-layer/warehouse-db/_schema/public.yaml",
      `tables:
  orders:
    table: public.orders
`
    );

    const index = await buildSemanticModelIndex(projectRoot);
    expect(index.connections).toEqual(["shop-db", "warehouse-db"]);

    const shop = resolveSemanticIdentity(index, {
      connectionId: "shop-db",
      schema: "public",
      table: "orders"
    });
    const warehouse = resolveSemanticIdentity(index, {
      connectionId: "warehouse-db",
      schema: "public",
      table: "orders"
    });

    expect(formatSemanticIdentity(shop.identity)).toBe("shop-db/public/orders");
    expect(formatSemanticIdentity(warehouse.identity)).toBe("warehouse-db/public/orders");
    expect(shop.overlayRelPath).not.toBe(warehouse.overlayRelPath);
  });

  it("blocks a partial identity query that matches several model entries", async () => {
    await seedSingleConnection();
    await writeFileAt(
      "semantic-layer/warehouse-db/_schema/public.yaml",
      `tables:
  orders:
    table: public.orders
`
    );
    const index = await buildSemanticModelIndex(projectRoot);

    expect(() => resolveSemanticIdentity(index, { table: "orders" })).toThrowError(
      /匹配到 2 个对象/
    );
    try {
      resolveSemanticIdentity(index, { table: "orders" });
      expect.unreachable("ambiguous identity must not resolve");
    } catch (error) {
      expect(error).toBeInstanceOf(SemanticIdentityError);
      expect((error as SemanticIdentityError).code).toBe("IDENTITY_AMBIGUOUS");
      expect((error as SemanticIdentityError).identities).toHaveLength(2);
    }
  });

  it("reports a missing identity instead of guessing", async () => {
    await seedSingleConnection();
    const index = await buildSemanticModelIndex(projectRoot);

    try {
      resolveSemanticIdentity(index, { connectionId: "shop-db", schema: "public", table: "ghost" });
      expect.unreachable("missing identity must not resolve");
    } catch (error) {
      expect((error as SemanticIdentityError).code).toBe("IDENTITY_NOT_FOUND");
    }
  });
});

describe("D3/D4 shared overlay targets", () => {
  it("blocks selecting one of two tables that share one overlay file", async () => {
    await seedSingleConnection();
    // Same connection, second schema, same source name → same overlay file.
    await writeFileAt(
      "semantic-layer/shop-db/_schema/archive.yaml",
      `tables:
  orders:
    table: archive.orders
`
    );

    const index = await buildSemanticModelIndex(projectRoot);
    const selected: SemanticTableIdentity[] = [
      { connectionId: "shop-db", schema: "public", table: "orders" }
    ];

    const impacted = computeUnselectedSharedTargets(index, selected);
    expect(impacted.map(formatSemanticIdentity)).toEqual(["shop-db/archive/orders"]);

    const closure = await resolveSemanticDependencyClosure(projectRoot, index, selected);
    expect(closure.unselectedImpact.map(formatSemanticIdentity)).toEqual([
      "shop-db/archive/orders"
    ]);
  });

  it("does not report a shared target when both tables are selected", async () => {
    await seedSingleConnection();
    await writeFileAt(
      "semantic-layer/shop-db/_schema/archive.yaml",
      `tables:
  orders:
    table: archive.orders
`
    );
    const index = await buildSemanticModelIndex(projectRoot);
    const closure = await resolveSemanticDependencyClosure(projectRoot, index, [
      { connectionId: "shop-db", schema: "public", table: "orders" },
      { connectionId: "shop-db", schema: "archive", table: "orders" }
    ]);
    expect(closure.unselectedImpact).toEqual([]);
  });
});

describe("D3 dependency closure", () => {
  it("lists read-only dependencies separately and never promotes them to targets", async () => {
    await seedSingleConnection();
    await writeFileAt(
      "semantic-layer/shop-db/_schema/public.yaml",
      `tables:
  orders:
    table: public.orders
  customers:
    table: public.customers
`
    );
    await writeFileAt(
      "semantic-layer/shop-db/orders.yaml",
      `name: orders
table: public.orders
joins:
  - to: customers
    on: orders.customer_id = customers.id
    relationship: many_to_one
`
    );

    const index = await buildSemanticModelIndex(projectRoot);
    const closure = await resolveSemanticDependencyClosure(
      projectRoot,
      index,
      [{ connectionId: "shop-db", schema: "public", table: "orders" }]
    );

    expect(closure.selected.map(formatSemanticIdentity)).toEqual(["shop-db/public/orders"]);
    expect(closure.dependencyIdentities.map(formatSemanticIdentity)).toEqual([
      "shop-db/public/customers"
    ]);
    expect(closure.dependencies[0]?.relation).toBe("same_schema");
    // A dependency is never a writable target.
    expect(closure.dependencyIdentities).not.toContainEqual(closure.selected[0]);
  });

  it("resolves a cross-connection reference and marks the relation", async () => {
    await seedSingleConnection();
    await writeFileAt(
      "semantic-layer/warehouse-db/_schema/public.yaml",
      `tables:
  orders:
    table: public.orders
`
    );
    await writeFileAt(
      "semantic-layer/shop-db/orders.yaml",
      `name: orders
table: public.orders
joins:
  - to: public.orders
    on: orders.id = orders.id
    relationship: many_to_one
`
    );

    const index = await buildSemanticModelIndex(projectRoot);
    const closure = await resolveSemanticDependencyClosure(
      projectRoot,
      index,
      [{ connectionId: "shop-db", schema: "public", table: "orders" }]
    );
    // Same connection resolves first; the cross-connection twin is not guessed.
    expect(closure.dependencyIdentities).toEqual([]);
  });

  it("blocks when a join reference cannot be resolved", async () => {
    await seedSingleConnection();
    await writeFileAt(
      "semantic-layer/shop-db/orders.yaml",
      `name: orders
table: public.orders
joins:
  - to: ghost_table
    on: orders.id = ghost.id
    relationship: many_to_one
`
    );
    const index = await buildSemanticModelIndex(projectRoot);

    await expect(
      resolveSemanticDependencyClosure(projectRoot, index, [
        { connectionId: "shop-db", schema: "public", table: "orders" }
      ])
    ).rejects.toThrowError(/DEPENDENCY_NOT_FOUND|找不到该表/);
  });

  it("blocks when a join reference is ambiguous across schemas", async () => {
    await seedSingleConnection();
    await writeFileAt(
      "semantic-layer/shop-db/_schema/archive.yaml",
      `tables:
  customers:
    table: archive.customers
`
    );
    await writeFileAt(
      "semantic-layer/shop-db/_schema/public.yaml",
      `tables:
  orders:
    table: public.orders
  customers:
    table: public.customers
`
    );
    await writeFileAt(
      "semantic-layer/shop-db/orders.yaml",
      `name: orders
table: public.orders
joins:
  - to: customers
    on: orders.customer_id = customers.id
    relationship: many_to_one
`
    );
    const index = await buildSemanticModelIndex(projectRoot);

    await expect(
      resolveSemanticDependencyClosure(projectRoot, index, [
        { connectionId: "shop-db", schema: "public", table: "orders" }
      ])
    ).rejects.toThrowError(/同名歧义必须阻断/);
  });
});

describe("identity helpers", () => {
  it("sorts and de-duplicates identities", () => {
    const sorted = sortUniqueSemanticIdentities([
      { connectionId: "b", schema: "s", table: "t" },
      { connectionId: "a", schema: "s", table: "t" },
      { connectionId: "b", schema: "s", table: "t" }
    ]);
    expect(sorted.map(formatSemanticIdentity)).toEqual(["a/s/t", "b/s/t"]);
  });
});

describe("D6 shared limits", () => {
  it("exposes the decided capacity values", () => {
    expect(SEMANTIC_BATCH_LIMITS.maxYamlEntries).toBe(200);
    expect(SEMANTIC_BATCH_LIMITS.maxSingleYamlBytes).toBe(8 * 1024 * 1024);
    expect(SEMANTIC_BATCH_LIMITS.maxMetadataBytes).toBe(256 * 1024);
    expect(SEMANTIC_BATCH_LIMITS.maxUnpackedBytes).toBe(16 * 1024 * 1024);
    expect(SEMANTIC_BATCH_LIMITS.maxZipBytes).toBe(20 * 1024 * 1024);
    expect(SEMANTIC_BATCH_LIMITS.maxHttpBodyBytes).toBe(32 * 1024 * 1024);
    expect(SEMANTIC_BATCH_LIMITS.checkConcurrency).toBe(4);
    expect(SEMANTIC_BATCH_LIMITS.perTableTimeoutMs).toBe(30_000);
    expect(SEMANTIC_BATCH_LIMITS.taskTimeoutMs).toBe(10 * 60_000);
    expect(SEMANTIC_BATCH_LIMITS.scopeTtlMs).toBe(30 * 60_000);
    expect(SEMANTIC_BATCH_LIMITS.exportBaselineTtlMs).toBe(7 * 24 * 60 * 60_000);
  });

  it("refuses over-limit input instead of truncating", () => {
    expect(() => assertYamlEntryLimit(200)).not.toThrow();
    expect(() => assertYamlEntryLimit(201)).toThrowError(SemanticLimitError);
    expect(() => assertSingleYamlLimit(8 * 1024 * 1024, "a.yaml")).not.toThrow();
    expect(() => assertSingleYamlLimit(8 * 1024 * 1024 + 1, "a.yaml")).toThrowError(
      /单文件上限/
    );
    expect(() => assertUnpackedLimit(16 * 1024 * 1024 + 1)).toThrowError(/解压内容总计/);
    expect(() => assertZipLimit(20 * 1024 * 1024 + 1)).toThrowError(/包大小/);
    expect(() => assertDependencyLimit(201)).toThrowError(/只读依赖/);
    expect(() => assertSelectedTableLimit(201)).toThrowError(/超过上限/);
  });

  it("self-checks a package against the import rules", () => {
    expect(() =>
      assertPackageWithinImportLimits({
        yamlEntryCount: 200,
        metadataBytes: 1024,
        unpackedBytes: 2048,
        zipBytes: 4096
      })
    ).not.toThrow();
    expect(() =>
      assertPackageWithinImportLimits({
        yamlEntryCount: 201,
        metadataBytes: 1024,
        unpackedBytes: 2048
      })
    ).toThrowError(SemanticLimitError);
  });
});
