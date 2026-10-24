// Lucy v0.25 — D2/D14: scope snapshots, actor/instance binding and the CAS
// plan digest that replaces the global `confirmOverwrite` boolean.
//
// Coverage:
//  - A scope keeps the selection sorted + de-duplicated and records the
//    baseline digests of every target and dependency.
//  - A scope expires after 30 minutes and is refused afterwards.
//  - Another actor and another instance may not consume the scope id.
//  - The baseline digest changes when a target changes on disk (including the
//    "target was created by somebody else" case).
//  - The plan digest is bound to the concrete target set: changing a target
//    invalidates the confirmation.

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  SemanticScopeError,
  assertSemanticBaselineUnchanged,
  computeSemanticPlanDigest,
  createSemanticScope,
  describeSemanticScope,
  diffSemanticBaseline,
  readSemanticScope,
  recomputeSemanticPlanDigest,
  requireFreshSemanticScope,
  resolveSemanticInstanceId,
  resolveSemanticScope
} from "../semantic-scopes";

let projectRoot: string;
let previousContentRoot: string | undefined;

async function writeFileAt(relPath: string, content: string): Promise<void> {
  const abs = path.join(projectRoot, relPath);
  await mkdir(path.dirname(abs), { recursive: true });
  await writeFile(abs, content, "utf8");
}

const TARGET = "semantic-layer/shop-db/orders.yaml";
const DEPENDENCY = "semantic-layer/shop-db/customers.yaml";

beforeEach(async () => {
  previousContentRoot = process.env.LUCY_CONTENT_ROOT;
  process.env.LUCY_CONTENT_ROOT = ".";
  projectRoot = await mkdtemp(path.join(os.tmpdir(), "lucy-v025-scope-"));
  await writeFileAt(
    "ktx.yaml",
    `connections:
  shop-db:
    driver: postgres
    schemas:
      - public
    enabled_tables:
      - public.orders
`
  );
  await writeFileAt(TARGET, "name: orders\ntable: public.orders\n");
  await writeFileAt(DEPENDENCY, "name: customers\ntable: public.customers\n");
});

afterEach(async () => {
  if (previousContentRoot === undefined) delete process.env.LUCY_CONTENT_ROOT;
  else process.env.LUCY_CONTENT_ROOT = previousContentRoot;
  if (projectRoot) await rm(projectRoot, { recursive: true, force: true });
});

async function makeScope(overrides: { actor?: string; instanceId?: string; now?: () => number } = {}) {
  return createSemanticScope(projectRoot, {
    actor: overrides.actor ?? "admin-a",
    instanceId: overrides.instanceId ?? "inst-test",
    refs: [
      { connectionId: "shop-db", schema: "public", table: "orders" },
      { connectionId: "shop-db", schema: "public", table: "orders" }
    ],
    dependencies: [{ connectionId: "shop-db", schema: "public", table: "customers" }],
    targets: [{ path: TARGET }],
    dependencyTargets: [{ path: DEPENDENCY }],
    ...(overrides.now ? { now: overrides.now } : {})
  });
}

describe("D2 scope snapshot", () => {
  it("stores a sorted, de-duplicated selection with a baseline digest", async () => {
    const scope = await makeScope();

    expect(scope.refs).toHaveLength(1);
    expect(scope.refs[0]).toEqual({
      connectionId: "shop-db",
      schema: "public",
      table: "orders"
    });
    expect(scope.baseline.targets).toHaveLength(1);
    expect(scope.baseline.targets[0]?.path).toBe(TARGET);
    expect(scope.baseline.targets[0]?.digest).toMatch(/^[0-9a-f]{64}$/);
    expect(scope.baseline.dependencies[0]?.digest).toMatch(/^[0-9a-f]{64}$/);
    expect(scope.baseline.digest).toMatch(/^[0-9a-f]{64}$/);
    expect(scope.expiresAt).toBeTruthy();
  });

  it("persists the scope so a later request can consume it", async () => {
    const scope = await makeScope();
    const loaded = await readSemanticScope(projectRoot, scope.scopeId);
    expect(loaded?.scopeId).toBe(scope.scopeId);
    expect(loaded?.actor).toBe("admin-a");
  });

  it("refuses a scope id that was never issued", async () => {
    expect(await readSemanticScope(projectRoot, "scope_does_not_exist")).toBeNull();
    await expect(
      requireFreshSemanticScope(projectRoot, "scope_does_not_exist", {
        actor: "admin-a",
        instanceId: "inst-test"
      })
    ).rejects.toThrowError(/不存在|已过期/);
  });

  it("expires after 30 minutes", async () => {
    const createdAt = Date.parse("2026-10-25T00:00:00.000Z");
    const scope = await makeScope({ now: () => createdAt });

    await expect(
      requireFreshSemanticScope(projectRoot, scope.scopeId, {
        actor: "admin-a",
        instanceId: "inst-test",
        now: () => createdAt + 29 * 60_000
      })
    ).resolves.toBeTruthy();

    await expect(
      requireFreshSemanticScope(projectRoot, scope.scopeId, {
        actor: "admin-a",
        instanceId: "inst-test",
        now: () => createdAt + 31 * 60_000
      })
    ).rejects.toThrowError(/过期/);
  });

  it("binds the scope to the actor and the instance", async () => {
    const scope = await makeScope();

    await expect(
      requireFreshSemanticScope(projectRoot, scope.scopeId, {
        actor: "admin-b",
        instanceId: "inst-test"
      })
    ).rejects.toThrowError(/其他操作者/);

    await expect(
      requireFreshSemanticScope(projectRoot, scope.scopeId, {
        actor: "admin-a",
        instanceId: "inst-other"
      })
    ).rejects.toThrowError(/其他实例/);
  });

  it("describes the scope for a preview response", async () => {
    const scope = await makeScope();
    const described = describeSemanticScope(scope);
    expect(described.scopeId).toBe(scope.scopeId);
    expect(described.selectedCount).toBe(1);
    expect(described.dependencyCount).toBe(1);
    expect(described.refs).toEqual(["shop-db/public/orders"]);
  });
});

describe("D2 baseline drift detection", () => {
  it("detects a changed target", async () => {
    const scope = await makeScope();
    await expect(diffSemanticBaseline(projectRoot, scope.baseline)).resolves.toEqual([]);

    await writeFileAt(TARGET, "name: orders\ntable: public.orders\ngrain:\n  - id\n");
    await expect(diffSemanticBaseline(projectRoot, scope.baseline)).resolves.toEqual([TARGET]);
    await expect(assertSemanticBaselineUnchanged(projectRoot, scope.baseline)).rejects.toThrowError(
      /已被改动/
    );
  });

  it("detects a target that was created after the preview", async () => {
    const scope = await createSemanticScope(projectRoot, {
      actor: "admin-a",
      instanceId: "inst-test",
      refs: [{ connectionId: "shop-db", schema: "public", table: "refunds" }],
      targets: [{ path: "semantic-layer/shop-db/refunds.yaml" }]
    });
    // "absent" at preview time.
    expect(scope.baseline.targets[0]?.digest).toBeNull();

    await writeFileAt("semantic-layer/shop-db/refunds.yaml", "name: refunds\n");
    await expect(diffSemanticBaseline(projectRoot, scope.baseline)).resolves.toEqual([
      "semantic-layer/shop-db/refunds.yaml"
    ]);
  });
});

describe("D14 plan digest", () => {
  it("binds the confirmation to the concrete target set", async () => {
    const scope = await makeScope();
    const candidate = { overlays: ["orders"] };

    const planDigest = computeSemanticPlanDigest({
      candidate,
      targets: scope.baseline.targets.map((target) => ({
        path: target.path,
        digest: target.digest
      }))
    });
    expect(planDigest).toMatch(/^[0-9a-f]{64}$/);

    const recomputed = await recomputeSemanticPlanDigest(projectRoot, {
      candidate,
      targets: [{ path: TARGET }],
      confirmedPlanDigest: planDigest,
      expected: scope.baseline.targets
    });
    expect(recomputed.matches).toBe(true);
    expect(recomputed.changed).toEqual([]);
  });

  it("invalidates the confirmation when a target changed after the preview", async () => {
    const scope = await makeScope();
    const candidate = { overlays: ["orders"] };
    const planDigest = computeSemanticPlanDigest({
      candidate,
      targets: scope.baseline.targets.map((target) => ({
        path: target.path,
        digest: target.digest
      }))
    });

    await writeFileAt(TARGET, "name: orders\ntable: public.orders\n# changed\n");
    const recomputed = await recomputeSemanticPlanDigest(projectRoot, {
      candidate,
      targets: [{ path: TARGET }],
      confirmedPlanDigest: planDigest,
      expected: scope.baseline.targets
    });
    expect(recomputed.matches).toBe(false);
    expect(recomputed.changed).toEqual([TARGET]);
  });

  it("refuses an empty scope", async () => {
    await expect(
      createSemanticScope(projectRoot, {
        actor: "admin-a",
        instanceId: "inst-test",
        refs: [],
        targets: []
      })
    ).rejects.toThrowError(SemanticScopeError);
  });
});

describe("instance id", () => {
  it("is stable across calls and unique per project", async () => {
    const first = await resolveSemanticInstanceId(projectRoot);
    const second = await resolveSemanticInstanceId(projectRoot);
    expect(first).toBe(second);
    expect(first.startsWith("inst_")).toBe(true);

    const otherRoot = await mkdtemp(path.join(os.tmpdir(), "lucy-v025-scope-other-"));
    try {
      const other = await resolveSemanticInstanceId(otherRoot);
      expect(other).not.toBe(first);
    } finally {
      await rm(otherRoot, { recursive: true, force: true });
    }
  });
});

describe("scope resolution", () => {
  it("resolves a selection into a snapshot with computed targets", async () => {
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

    const resolved = await resolveSemanticScope(projectRoot, {
      actor: "admin-a",
      instanceId: "inst-test",
      refs: [{ connectionId: "shop-db", schema: "public", table: "orders" }]
    });

    expect(resolved.scope.refs).toEqual([
      { connectionId: "shop-db", schema: "public", table: "orders" }
    ]);
    expect(resolved.scope.dependencies).toEqual([
      { connectionId: "shop-db", schema: "public", table: "customers" }
    ]);
    expect(resolved.scope.baseline.targets.map((target) => target.path)).toEqual([
      "semantic-layer/shop-db/orders.yaml"
    ]);
    expect(resolved.scope.baseline.dependencies.map((target) => target.path)).toEqual([
      "semantic-layer/shop-db/customers.yaml"
    ]);
  });

  it("refuses a selection that would silently widen the write scope", async () => {
    await writeFileAt(
      "semantic-layer/shop-db/_schema/public.yaml",
      `tables:
  orders:
    table: public.orders
`
    );
    await writeFileAt(
      "semantic-layer/shop-db/_schema/archive.yaml",
      `tables:
  orders:
    table: archive.orders
`
    );

    await expect(
      resolveSemanticScope(projectRoot, {
        actor: "admin-a",
        instanceId: "inst-test",
        refs: [{ connectionId: "shop-db", schema: "public", table: "orders" }]
      })
    ).rejects.toThrowError(/共用同一个 overlay 文件/);
  });

  it("refuses an identity that the model does not know", async () => {
    await expect(
      resolveSemanticScope(projectRoot, {
        actor: "admin-a",
        instanceId: "inst-test",
        refs: [{ connectionId: "shop-db", schema: "public", table: "ghost" }]
      })
    ).rejects.toThrowError(/不存在/);
  });
});
