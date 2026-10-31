// Spec `lucy-20261030-publish-workbench-three-column-spec.md` §5.5 — the
// impact model.
//
// Coverage:
//  - A table's identity is connectionId + schema + table; same-named tables in
//    different connections are two entries, never one.
//  - A table changed in both its overlay and its Manifest is one entry with two
//    reasons, counted once.
//  - A Manifest counts only the tables that actually changed inside it.
//  - A Manifest that changed at schema level is reported as a schema change.
//  - Wiki changes, schema-level changes and reference dependencies are
//    separate sections and never inflate the table count.
//  - An unresolvable identity leaves the impact incomplete.
//  - First verification says "first verification", never "new table".
//  - More than eight tables are all listed — the list is never truncated.

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  advancePublishBaseline,
  capturePublishConsumption,
  readPublishPendingSnapshot
} from "../publish-workbench-state";
import {
  buildPublishImpact,
  diffManifestTable,
  diffNamedList,
  diffOverlay
} from "../publish-impact";

let projectRoot: string;
let previousContentRoot: string | undefined;

function manifestYAML(tables: Record<string, string>): string {
  return `tables:\n${Object.entries(tables)
    .map(([name, body]) => `  ${name}:\n${body}`)
    .join("")}`;
}

async function writeContent(relPath: string, content: string): Promise<void> {
  const abs = path.join(projectRoot, relPath);
  await mkdir(path.dirname(abs), { recursive: true });
  await writeFile(abs, content, "utf8");
}

async function seedBase(): Promise<void> {
  await writeContent(
    "semantic-layer/conn-a/_schema/sales.yaml",
    manifestYAML({
      orders: "    table: sales.orders\n    columns:\n      - name: id\n        type: string\n"
    })
  );
  await writeContent(
    "semantic-layer/conn-a/orders.yaml",
    "name: orders\ngrain:\n  - id\nmeasures:\n  - name: total\n    expr: sum(amount)\n"
  );
}

/**
 * Commit the current content as the proven baseline — the same order the
 * publish path uses: capture the content (which stores the baseline's raw
 * bytes) and only then advance the pointer.
 */
async function commitBaseline(): Promise<void> {
  const capture = await capturePublishConsumption(projectRoot);
  await advancePublishBaseline(projectRoot, {
    expectedGeneration: capture.baselineGeneration,
    files: capture.files
  });
}

beforeEach(async () => {
  previousContentRoot = process.env.LUCY_CONTENT_ROOT;
  projectRoot = await mkdtemp(path.join(os.tmpdir(), "lucy-pwb-impact-"));
  process.env.LUCY_CONTENT_ROOT = ".";
  await seedBase();
});

afterEach(async () => {
  if (previousContentRoot === undefined) delete process.env.LUCY_CONTENT_ROOT;
  else process.env.LUCY_CONTENT_ROOT = previousContentRoot;
  if (projectRoot) {
    await rm(projectRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

describe("publish impact model", () => {
  it("does not merge same-named tables from different connections", async () => {
    await writeContent(
      "semantic-layer/conn-b/_schema/sales.yaml",
      manifestYAML({
        orders: "    table: sales.orders\n    columns:\n      - name: id\n        type: string\n"
      })
    );
    await writeContent(
      "semantic-layer/conn-b/orders.yaml",
      "name: orders\ngrain:\n  - id\nmeasures:\n  - name: total\n    expr: sum(amount)\n"
    );
    await commitBaseline();

    await writeContent(
      "semantic-layer/conn-a/orders.yaml",
      "name: orders\ngrain:\n  - id\nmeasures:\n  - name: total\n    expr: sum(amount)\n  - name: count\n    expr: count(*)\n"
    );
    await writeContent(
      "semantic-layer/conn-b/orders.yaml",
      "name: orders\ngrain:\n  - id\nmeasures:\n  - name: total\n    expr: sum(amount)\n  - name: count\n    expr: count(*)\n"
    );

    const snapshot = await readPublishPendingSnapshot(projectRoot);
    const impact = await buildPublishImpact({ projectRoot, snapshot });

    expect(impact.tables).toHaveLength(2);
    const keys = impact.tables.map((table) => `${table.identity.connectionId}/${table.identity.schema}/${table.identity.table}`);
    expect(keys.sort()).toEqual(["conn-a/sales/orders", "conn-b/sales/orders"]);
    expect(impact.counts.tables).toBe(2);
  });

  it("merges the overlay and Manifest reasons of one table into a single entry", async () => {
    await commitBaseline();

    await writeContent(
      "semantic-layer/conn-a/orders.yaml",
      "name: orders\ngrain:\n  - id\nmeasures:\n  - name: total\n    expr: sum(amount)\n  - name: count\n    expr: count(*)\n"
    );
    await writeContent(
      "semantic-layer/conn-a/_schema/sales.yaml",
      manifestYAML({
        orders:
          "    table: sales.orders\n    columns:\n      - name: id\n        type: string\n      - name: amount\n        type: number\n"
      })
    );

    const snapshot = await readPublishPendingSnapshot(projectRoot);
    const impact = await buildPublishImpact({ projectRoot, snapshot });

    expect(impact.tables).toHaveLength(1);
    expect(impact.counts.tables).toBe(1);
    const reasons = impact.tables[0]!.reasons;
    expect(reasons.map((reason) => reason.kind).sort()).toEqual([
      "manifest_table_change",
      "overlay_change"
    ]);
    expect(reasons.find((reason) => reason.kind === "overlay_change")?.summary).toContain(
      "新增指标 count"
    );
    expect(reasons.find((reason) => reason.kind === "manifest_table_change")?.summary).toContain(
      "新增字段 amount"
    );
  });

  it("counts only the tables that actually changed inside a Manifest", async () => {
    await writeContent(
      "semantic-layer/conn-a/_schema/sales.yaml",
      manifestYAML({
        orders: "    table: sales.orders\n    columns:\n      - name: id\n        type: string\n",
        refunds: "    table: sales.refunds\n    columns:\n      - name: id\n        type: string\n"
      })
    );
    await writeContent(
      "semantic-layer/conn-a/refunds.yaml",
      "name: refunds\ngrain:\n  - id\nmeasures:\n  - name: total\n    expr: sum(amount)\n"
    );
    await commitBaseline();

    // Only `orders` changes inside the Manifest; `refunds` stays untouched.
    await writeContent(
      "semantic-layer/conn-a/_schema/sales.yaml",
      manifestYAML({
        orders: "    table: sales.orders\n    columns:\n      - name: id\n        type: string\n      - name: note\n        type: string\n",
        refunds: "    table: sales.refunds\n    columns:\n      - name: id\n        type: string\n"
      })
    );

    const snapshot = await readPublishPendingSnapshot(projectRoot);
    const impact = await buildPublishImpact({ projectRoot, snapshot });

    expect(impact.tables).toHaveLength(1);
    expect(impact.tables[0]?.identity.table).toBe("orders");
    expect(impact.counts.tables).toBe(1);
    expect(impact.schemaChanges).toHaveLength(0);
  });

  it("reports a Manifest with no per-table change as a schema-level change", async () => {
    await writeContent(
      "semantic-layer/conn-a/_schema/sales.yaml",
      manifestYAML({
        orders: "    table: sales.orders\n    columns:\n      - name: id\n        type: string\n"
      })
    );
    await commitBaseline();

    // Only a top-level key changes; no table entry changes.
    await writeContent(
      "semantic-layer/conn-a/_schema/sales.yaml",
      `version: 2\n${manifestYAML({
        orders: "    table: sales.orders\n    columns:\n      - name: id\n        type: string\n"
      })}`
    );

    const snapshot = await readPublishPendingSnapshot(projectRoot);
    const impact = await buildPublishImpact({ projectRoot, snapshot });

    expect(impact.tables).toHaveLength(0);
    expect(impact.counts.tables).toBe(0);
    expect(impact.schemaChanges).toHaveLength(1);
    expect(impact.schemaChanges[0]?.connectionId).toBe("conn-a");
    expect(impact.schemaChanges[0]?.schema).toBe("sales");
  });

  it("keeps Wiki changes out of the table list", async () => {
    await writeContent("wiki/global/sales.md", "# 销售口径\n");
    await commitBaseline();
    await writeContent("wiki/global/sales.md", "# 销售口径\n\n补充说明。\n");

    const snapshot = await readPublishPendingSnapshot(projectRoot);
    const impact = await buildPublishImpact({ projectRoot, snapshot });

    expect(impact.counts.wikiPages).toBe(1);
    expect(impact.wikiChanges).toHaveLength(1);
    expect(impact.wikiChanges[0]?.title).toBe("销售口径");
    expect(impact.counts.tables).toBe(0);
  });

  it("marks an unresolvable identity as incomplete instead of guessing", async () => {
    await writeContent(
      "semantic-layer/conn-a/orphan.yaml",
      "name: orphan\nmeasures:\n  - name: total\n    expr: sum(amount)\n"
    );
    await commitBaseline();
    await writeContent(
      "semantic-layer/conn-a/orphan.yaml",
      "name: orphan\nmeasures:\n  - name: total\n    expr: sum(amount)\n  - name: c\n    expr: count(*)\n"
    );

    const snapshot = await readPublishPendingSnapshot(projectRoot);
    const impact = await buildPublishImpact({ projectRoot, snapshot });

    expect(impact.complete).toBe(false);
    expect(impact.unresolved.some((entry) => entry.blocking)).toBe(true);
    expect(impact.unresolved.some((entry) => entry.filePath.includes("orphan"))).toBe(true);
  });

  it("says first verification instead of new table when there is no baseline", async () => {
    const snapshot = await readPublishPendingSnapshot(projectRoot);
    const impact = await buildPublishImpact({ projectRoot, snapshot });

    expect(snapshot.baselineState).toBe("uninitialized");
    expect(impact.tables).toHaveLength(1);
    expect(impact.tables[0]?.reasons[0]?.kind).toBe("first_verification");
    expect(impact.tables[0]?.reasons[0]?.summary).toContain("首次核对");
    expect(impact.complete).toBe(true);
  });

  it("lists every affected table — the list is never truncated", async () => {
    const names = Array.from({ length: 12 }, (_, index) => `t${String(index).padStart(2, "0")}`);
    await writeContent(
      "semantic-layer/conn-a/_schema/sales.yaml",
      manifestYAML(
        Object.fromEntries(
          names.map((name) => [
            name,
            "    table: sales." + name + "\n    columns:\n      - name: id\n        type: string\n"
          ])
        )
      )
    );
    for (const name of names) {
      await writeContent(
        `semantic-layer/conn-a/${name}.yaml`,
        `name: ${name}\ngrain:\n  - id\nmeasures:\n  - name: total\n    expr: sum(amount)\n`
      );
    }
    await commitBaseline();

    for (const name of names) {
      await writeContent(
        `semantic-layer/conn-a/${name}.yaml`,
        `name: ${name}\ngrain:\n  - id\nmeasures:\n  - name: total\n    expr: sum(amount)\n  - name: c\n    expr: count(*)\n`
      );
    }

    const snapshot = await readPublishPendingSnapshot(projectRoot);
    const impact = await buildPublishImpact({ projectRoot, snapshot });

    expect(impact.tables).toHaveLength(12);
    expect(impact.counts.tables).toBe(12);
  });

  it("reports reference dependencies separately from the changed tables", async () => {
    await writeContent(
      "semantic-layer/conn-a/_schema/sales.yaml",
      manifestYAML({
        orders: "    table: sales.orders\n    columns:\n      - name: id\n        type: string\n",
        refunds: "    table: sales.refunds\n    columns:\n      - name: id\n        type: string\n"
      })
    );
    await writeContent(
      "semantic-layer/conn-a/refunds.yaml",
      "name: refunds\ngrain:\n  - id\nmeasures:\n  - name: total\n    expr: sum(amount)\n"
    );
    await writeContent(
      "semantic-layer/conn-a/orders.yaml",
      "name: orders\ngrain:\n  - id\njoins:\n  - to: refunds\n    type: left\nmeasures:\n  - name: total\n    expr: sum(amount)\n"
    );
    await commitBaseline();

    await writeContent(
      "semantic-layer/conn-a/orders.yaml",
      "name: orders\ngrain:\n  - id\njoins:\n  - to: refunds\n    type: left\nmeasures:\n  - name: total\n    expr: sum(amount)\n  - name: c\n    expr: count(*)\n"
    );

    const snapshot = await readPublishPendingSnapshot(projectRoot);
    const impact = await buildPublishImpact({ projectRoot, snapshot });

    // `refunds` is only referenced by a join — it is not a changed table.
    expect(impact.tables.map((table) => table.identity.table)).toEqual(["orders"]);
    expect(impact.counts.tables).toBe(1);
    expect(
      impact.relatedScope.some((entry) => entry.identity.table === "refunds")
    ).toBe(true);
  });
});

describe("impact diff helpers", () => {
  it("names the concrete items that changed in a named list", () => {
    const before = [{ name: "a", expr: "1" }, { name: "b", expr: "2" }];
    const after = [{ name: "a", expr: "1" }, { name: "b", expr: "3" }, { name: "c", expr: "4" }];
    const summaries = diffNamedList(before, after, {
      added: "新增",
      removed: "删除",
      changed: "变更"
    });
    expect(summaries).toEqual(["变更 b", "新增 c"]);
  });

  it("summarizes the concrete changes inside an overlay", () => {
    const before = "name: t\nmeasures:\n  - name: a\n    expr: sum(x)\n";
    const after = "name: t\nmeasures:\n  - name: a\n    expr: sum(y)\n  - name: b\n    expr: count(*)\n";
    const diff = diffOverlay(before, after);
    expect(diff.parseFailed).toBe(false);
    expect(diff.summaries).toEqual(["指标定义变更 a", "新增指标 b"]);
  });

  it("reports an unparsable overlay instead of pretending it is empty", () => {
    const diff = diffOverlay("name: t\n", "::: not yaml :::\n");
    expect(diff.parseFailed).toBe(true);
  });

  it("summarizes the concrete changes inside a manifest table", () => {
    const before = {
      table: "sales.t",
      columns: [{ name: "id", type: "string" }]
    };
    const after = {
      table: "sales.t",
      columns: [
        { name: "id", type: "number" },
        { name: "note", type: "string" }
      ]
    };
    const summaries = diffManifestTable(before, after);
    expect(summaries).toContain("字段类型变更 id");
    expect(summaries).toContain("新增字段 note");
  });
});
