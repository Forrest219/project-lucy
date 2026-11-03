import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildMergedModel,
  deriveSemanticDeletionSet,
  listManifestFiles,
  listOverlayFiles,
  manifestTableNames
} from "../semantic-merged-model.js";

const roots: string[] = [];

async function makeRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "lucy-l25-15-merged-model-"));
  roots.push(root);
  process.env.LUCY_CONTENT_ROOT = ".";
  await mkdir(path.join(root, "semantic-layer", "demo", "_schema"), { recursive: true });
  await writeFile(path.join(root, "ktx.yaml"), "connections: {}\n", "utf8");
  return root;
}

function manifestYaml(tables: string[]): string {
  const body = tables
    .map((table) => `  ${table}:\n    columns: []\n    descriptions: {}`)
    .join("\n");
  return `tables:\n${body}\n`;
}

afterEach(async () => {
  delete process.env.LUCY_CONTENT_ROOT;
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("semantic merged model", () => {
  it("lists manifests and overlays apart from each other", async () => {
    const root = await makeRoot();
    await writeFile(
      path.join(root, "semantic-layer", "demo", "_schema", "shop.yaml"),
      manifestYaml(["orders"]),
      "utf8"
    );
    await writeFile(
      path.join(root, "semantic-layer", "demo", "orders.yaml"),
      "grain: [order_id]\n",
      "utf8"
    );
    const manifests = await listManifestFiles(root);
    const overlays = await listOverlayFiles(root);
    expect(manifests.map((item) => item.relPath)).toEqual([
      "semantic-layer/demo/_schema/shop.yaml"
    ]);
    expect(manifests[0]?.connectionId).toBe("demo");
    expect(manifests[0]?.schema).toBe("shop");
    expect(overlays.map((item) => item.relPath)).toEqual(["semantic-layer/demo/orders.yaml"]);
  });

  it("reads the table set of a manifest and ignores an unparsable document", async () => {
    expect(manifestTableNames(manifestYaml(["orders", "customers"]))).toEqual([
      "orders",
      "customers"
    ]);
    expect(manifestTableNames("tables: [not, a, mapping]")).toEqual([]);
    expect(manifestTableNames("not yaml at all: [")).toEqual([]);
  });

  it("derives the semantic deletion set from a manifest that is rewritten in place", async () => {
    const root = await makeRoot();
    await writeFile(
      path.join(root, "semantic-layer", "demo", "_schema", "shop.yaml"),
      manifestYaml(["orders", "customers"]),
      "utf8"
    );
    await writeFile(
      path.join(root, "semantic-layer", "demo", "orders.yaml"),
      "grain: [order_id]\n",
      "utf8"
    );

    // The restore rewrites the manifest and drops "customers". The file stays
    // a `restore` target — it is not absent — but the table disappears from
    // the merged model.
    const restored = new Map([
      [
        "semantic-layer/demo/_schema/shop.yaml",
        manifestYaml(["orders"])
      ]
    ]);
    const analysis = await deriveSemanticDeletionSet({
      projectRoot: root,
      restoredManifestContents: restored,
      deletedOverlayPaths: [],
      restoredOverlayPaths: []
    });
    expect(
      analysis.semanticDeletionSet.map((table) => `${table.connectionId}/${table.schema}/${table.table}`)
    ).toEqual(["demo/shop/customers"]);
  });

  it("treats a deleted overlay as an invisible extension, not a vanished table", async () => {
    const root = await makeRoot();
    await writeFile(
      path.join(root, "semantic-layer", "demo", "_schema", "shop.yaml"),
      manifestYaml(["orders"]),
      "utf8"
    );
    await writeFile(
      path.join(root, "semantic-layer", "demo", "orders.yaml"),
      "grain: [order_id]\n",
      "utf8"
    );

    const analysis = await deriveSemanticDeletionSet({
      projectRoot: root,
      restoredManifestContents: new Map(),
      deletedOverlayPaths: ["semantic-layer/demo/orders.yaml"],
      restoredOverlayPaths: []
    });
    // The table structure still comes from the manifest, so no table vanishes.
    expect(analysis.semanticDeletionSet).toEqual([]);
    // The business extension does go away, and that still needs a readback.
    expect(analysis.overlayDeletionReadbacks).toHaveLength(1);
    expect(
      analysis.overlayDeletionReadbacks[0]?.tables.map(
        (table) => `${table.connectionId}/${table.schema}/${table.table}`
      )
    ).toEqual(["demo/shop/orders"]);
  });

  it("treats a manifest that becomes absent as a table disappearance", async () => {
    const root = await makeRoot();
    await writeFile(
      path.join(root, "semantic-layer", "demo", "_schema", "shop.yaml"),
      manifestYaml(["orders"]),
      "utf8"
    );
    const analysis = await deriveSemanticDeletionSet({
      projectRoot: root,
      restoredManifestContents: new Map([["semantic-layer/demo/_schema/shop.yaml", null]]),
      deletedOverlayPaths: [],
      restoredOverlayPaths: []
    });
    expect(
      analysis.semanticDeletionSet.map((table) => `${table.connectionId}/${table.schema}/${table.table}`)
    ).toEqual(["demo/shop/orders"]);
  });

  it("exposes the merged model of the current disk state", async () => {
    const root = await makeRoot();
    await writeFile(
      path.join(root, "semantic-layer", "demo", "_schema", "shop.yaml"),
      manifestYaml(["orders"]),
      "utf8"
    );
    await writeFile(
      path.join(root, "semantic-layer", "demo", "orders.yaml"),
      "grain: [order_id]\n",
      "utf8"
    );
    const model = await buildMergedModel({ projectRoot: root });
    expect(model.tables.map((table) => table.table)).toEqual(["orders"]);
    expect(model.overlayTables.get("semantic-layer/demo/orders.yaml")).toHaveLength(1);
  });
});
