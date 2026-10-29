// Lucy v0.25 — D4/D5/D7: the `semantic-maintenance-package/v1` round-trip.
//
// Coverage:
//  - The package carries `package.json` + editable overlays + read-only
//    context, and every entry records entryId / role / full table identity /
//    package path / exported digest / target digest (or absent) / baseline.
//  - A table without an overlay exports an explicit template with
//    `baseTarget = absent`.
//  - The unpacker rejects absolute paths, `..`, symlink / non-regular
//    entries, duplicate paths, duplicate identities, unregistered entries,
//    nested packages and credential-bearing content.
//  - The unpacker never returns a host absolute path.
//  - The export baseline is verified server-side: unknown / expired /
//    other-instance / altered packages are refused (V07).

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  MAINTENANCE_PACKAGE_KIND,
  MaintenancePackageError,
  assertEntryIdentityNotRebound,
  assertReadonlyContextUnchanged,
  buildMaintenancePackage,
  buildExportBaseline,
  newMaintenanceExportId,
  persistMaintenanceExportBaseline,
  readZipEntries,
  unpackMaintenancePackage,
  verifyMaintenanceExportBaseline,
  type MaintenancePackageEntryMeta
} from "../semantic-maintenance-package";

let projectRoot: string;
let previousContentRoot: string | undefined;

const SELECTED = [{ connectionId: "shop-db", schema: "public", table: "orders" }];
const DEPENDENCIES = [{ connectionId: "shop-db", schema: "public", table: "customers" }];

beforeEach(async () => {
  previousContentRoot = process.env.LUCY_CONTENT_ROOT;
  process.env.LUCY_CONTENT_ROOT = ".";
  projectRoot = await mkdtemp(path.join(os.tmpdir(), "lucy-v025-package-"));
  await mkdir(path.join(projectRoot, "semantic-layer", "shop-db", "_schema"), { recursive: true });
});

afterEach(async () => {
  if (previousContentRoot === undefined) delete process.env.LUCY_CONTENT_ROOT;
  else process.env.LUCY_CONTENT_ROOT = previousContentRoot;
  if (projectRoot) await rm(projectRoot, { recursive: true, force: true });
});

async function buildPackage(overrides: { instanceId?: string; exportId?: string } = {}) {
  return buildMaintenancePackage({
    projectRoot,
    exportId: overrides.exportId ?? newMaintenanceExportId(),
    instanceId: overrides.instanceId ?? "inst-a",
    product: { name: "Lucy", version: "0.25.0", revision: "test" },
    selected: SELECTED,
    dependencies: DEPENDENCIES,
    baselineDigest: "b".repeat(64),
    overlays: [
      {
        identity: SELECTED[0]!,
        targetPath: "semantic-layer/shop-db/orders.yaml",
        content: "name: orders\ntable: public.orders\n"
      },
      {
        identity: { connectionId: "shop-db", schema: "public", table: "refunds" },
        targetPath: "semantic-layer/shop-db/refunds.yaml",
        content: null
      }
    ],
    readonlyContexts: [
      {
        connectionId: "shop-db",
        schema: "public",
        targetPath: "semantic-layer/shop-db/_schema/public.yaml",
        content: "tables:\n  orders:\n    table: public.orders\n"
      }
    ]
  });
}

describe("D4 package structure", () => {
  it("carries metadata, editable overlays and read-only context", async () => {
    const built = await buildPackage();
    const unpacked = unpackMaintenancePackage(built.zip);

    expect(unpacked.metadata.packageKind).toBe(MAINTENANCE_PACKAGE_KIND);
    expect(unpacked.metadata.selected).toEqual(SELECTED);
    expect(unpacked.metadata.dependencies).toEqual(DEPENDENCIES);
    expect(unpacked.entries).toHaveLength(3);

    const overlay = unpacked.entries.find((entry) => entry.meta.role === "editable_overlay");
    expect(overlay?.meta.identity).toEqual(SELECTED[0]);
    expect(overlay?.meta.packagePath).toBe("overlays/shop-db/orders.yaml");
    expect(overlay?.meta.exportedDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(overlay?.meta.targetDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(overlay?.meta.baseTarget).toBe("present");
    expect(overlay?.meta.baselineDigest).toBe("b".repeat(64));

    const context = unpacked.entries.find((entry) => entry.meta.role === "readonly_context");
    expect(context?.meta.packagePath).toBe("readonly/shop-db/_schema/public.yaml");
  });

  it("exports an explicit template with baseTarget=absent for a table without overlay", async () => {
    const built = await buildPackage();
    const unpacked = unpackMaintenancePackage(built.zip);
    const template = unpacked.entries.find((entry) =>
      entry.meta.identity.table === "refunds"
    );

    expect(template?.meta.baseTarget).toBe("absent");
    expect(template?.meta.targetDigest).toBeNull();
    expect(template?.meta.template).toBe(true);
    expect(template?.content).toContain("name: refunds");
    expect(template?.content).toContain("table: public.refunds");
  });

  it("never leaks a host absolute path into the unpacked result", async () => {
    const built = await buildPackage();
    const unpacked = unpackMaintenancePackage(built.zip);
    const serialized = JSON.stringify(unpacked);
    expect(serialized).not.toContain(projectRoot);
    expect(serialized).not.toContain(os.tmpdir());
  });

  it("carries a file shared by two tables once and lists both identities", async () => {
    const built = await buildMaintenancePackage({
      projectRoot,
      exportId: newMaintenanceExportId(),
      instanceId: "inst-a",
      product: { name: "Lucy", version: "0.25.0", revision: "test" },
      selected: [
        { connectionId: "shop-db", schema: "public", table: "orders" },
        { connectionId: "shop-db", schema: "archive", table: "orders" }
      ],
      dependencies: [],
      baselineDigest: "b".repeat(64),
      overlays: [
        {
          identity: { connectionId: "shop-db", schema: "public", table: "orders" },
          targetPath: "semantic-layer/shop-db/orders.yaml",
          content: "name: orders\ntable: public.orders\n"
        },
        {
          identity: { connectionId: "shop-db", schema: "archive", table: "orders" },
          targetPath: "semantic-layer/shop-db/orders.yaml",
          content: "name: orders\ntable: public.orders\n"
        }
      ],
      readonlyContexts: []
    });

    const unpacked = unpackMaintenancePackage(built.zip);
    const overlay = unpacked.entries.find((entry) => entry.meta.role === "editable_overlay");
    expect(overlay?.meta.identity).toEqual({
      connectionId: "shop-db",
      schema: "public",
      table: "orders"
    });
    expect(overlay?.meta.sharedIdentities).toEqual([
      { connectionId: "shop-db", schema: "archive", table: "orders" }
    ]);
    // One physical file → one ZIP member.
    expect(
      unpacked.entries.filter((entry) => entry.meta.role === "editable_overlay")
    ).toHaveLength(1);
  });

  it("refuses to export a shared file that has no overlay yet", async () => {
    await expect(
      buildMaintenancePackage({
        projectRoot,
        exportId: newMaintenanceExportId(),
        instanceId: "inst-a",
        product: { name: "Lucy", version: "0.25.0", revision: "test" },
        selected: [
          { connectionId: "shop-db", schema: "public", table: "orders" },
          { connectionId: "shop-db", schema: "archive", table: "orders" }
        ],
        dependencies: [],
        baselineDigest: "b".repeat(64),
        overlays: [
          {
            identity: { connectionId: "shop-db", schema: "public", table: "orders" },
            targetPath: "semantic-layer/shop-db/orders.yaml",
            content: null
          },
          {
            identity: { connectionId: "shop-db", schema: "archive", table: "orders" },
            targetPath: "semantic-layer/shop-db/orders.yaml",
            content: null
          }
        ],
        readonlyContexts: []
      })
    ).rejects.toThrowError(/无法生成无歧义的模板/);
  });
});

describe("D5 safe unpack", () => {
  it("rejects an absolute path", () => {
    const zip = buildRawZip([
      { name: "/etc/passwd.yaml", data: Buffer.from("name: x\n") },
      { name: "package.json", data: Buffer.from(JSON.stringify(minimalMetadata())) }
    ]);
    expect(() => unpackMaintenancePackage(zip)).toThrowError(/路径不安全/);
  });

  it("rejects a `..` traversal", () => {
    const zip = buildRawZip([
      { name: "overlays/../../escape.yaml", data: Buffer.from("name: x\n") },
      { name: "package.json", data: Buffer.from(JSON.stringify(minimalMetadata())) }
    ]);
    expect(() => unpackMaintenancePackage(zip)).toThrowError(/路径不安全/);
  });

  it("rejects a symlink entry", () => {
    const zip = buildRawZip([
      { name: "overlays/shop-db/orders.yaml", data: Buffer.from("name: x\n"), unixMode: 0o120777 },
      { name: "package.json", data: Buffer.from(JSON.stringify(minimalMetadata())) }
    ]);
    expect(() => unpackMaintenancePackage(zip)).toThrowError(/符号链接/);
  });

  it("rejects a duplicate normalized path", () => {
    const zip = buildRawZip([
      { name: "overlays/shop-db/orders.yaml", data: Buffer.from("name: x\n") },
      { name: "overlays/shop-db/orders.yaml", data: Buffer.from("name: y\n") },
      { name: "package.json", data: Buffer.from(JSON.stringify(minimalMetadata())) }
    ]);
    expect(() => unpackMaintenancePackage(zip)).toThrowError(/路径重复/);
  });

  it("rejects a duplicate table identity", () => {
    const metadata = minimalMetadata();
    metadata.entries = [
      entryMeta("a", "overlays/shop-db/orders.yaml"),
      entryMeta("b", "overlays/shop-db/orders-copy.yaml")
    ];
    const zip = buildRawZip([
      { name: "overlays/shop-db/orders.yaml", data: Buffer.from("name: x\n") },
      { name: "overlays/shop-db/orders-copy.yaml", data: Buffer.from("name: x\n") },
      { name: "package.json", data: Buffer.from(JSON.stringify(metadata)) }
    ]);
    expect(() => unpackMaintenancePackage(zip)).toThrowError(/重复表身份/);
  });

  it("rejects an unregistered file", () => {
    const metadata = minimalMetadata();
    metadata.entries = [entryMeta("a", "overlays/shop-db/orders.yaml")];
    const zip = buildRawZip([
      { name: "overlays/shop-db/orders.yaml", data: Buffer.from("name: x\n") },
      { name: "overlays/shop-db/sneaky.yaml", data: Buffer.from("name: y\n") },
      { name: "package.json", data: Buffer.from(JSON.stringify(metadata)) }
    ]);
    expect(() => unpackMaintenancePackage(zip)).toThrowError(/未登记文件/);
  });

  it("rejects a missing registered entry", () => {
    const metadata = minimalMetadata();
    metadata.entries = [entryMeta("a", "overlays/shop-db/orders.yaml")];
    const zip = buildRawZip([
      { name: "package.json", data: Buffer.from(JSON.stringify(metadata)) }
    ]);
    expect(() => unpackMaintenancePackage(zip)).toThrowError(/条目缺失/);
  });

  it("rejects a nested package", () => {
    const metadata = minimalMetadata();
    metadata.entries = [entryMeta("a", "overlays/shop-db/orders.yaml")];
    const zip = buildRawZip([
      {
        name: "overlays/shop-db/orders.yaml",
        data: Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00])
      },
      { name: "package.json", data: Buffer.from(JSON.stringify(metadata)) }
    ]);
    expect(() => unpackMaintenancePackage(zip)).toThrowError(/嵌套包/);
  });

  it("rejects credential-bearing content", () => {
    const metadata = minimalMetadata();
    metadata.entries = [entryMeta("a", "overlays/shop-db/orders.yaml")];
    const zip = buildRawZip([
      { name: "overlays/shop-db/orders.yaml", data: Buffer.from("name: x\npassword: hunter2\n") },
      { name: "package.json", data: Buffer.from(JSON.stringify(metadata)) }
    ]);
    expect(() => unpackMaintenancePackage(zip)).toThrowError(/凭据/);
  });

  it("rejects a package without metadata", () => {
    const zip = buildRawZip([{ name: "overlays/shop-db/orders.yaml", data: Buffer.from("name: x\n") }]);
    expect(() => unpackMaintenancePackage(zip)).toThrowError(/缺少 package.json/);
  });

  it("rejects metadata of an unsupported package kind", () => {
    const metadata = minimalMetadata();
    metadata.packageKind = "something-else/v1" as never;
    const zip = buildRawZip([
      { name: "package.json", data: Buffer.from(JSON.stringify(metadata)) }
    ]);
    expect(() => unpackMaintenancePackage(zip)).toThrowError(/格式不受支持/);
  });
});

describe("D5 read-only context and identity rebinding", () => {
  it("blocks a modified read-only context", async () => {
    const built = await buildPackage();
    const unpacked = unpackMaintenancePackage(built.zip);
    expect(() => assertReadonlyContextUnchanged(unpacked)).not.toThrow();

    const tampered = unpackMaintenancePackage(
      rewriteEntryContent(built.zip, "readonly/shop-db/_schema/public.yaml", "tables: {}\n")
    );
    expect(() => assertReadonlyContextUnchanged(tampered)).toThrowError(/只读上下文/);
  });

  it("blocks an entry whose identity was rebound", async () => {
    const built = await buildPackage();
    const unpacked = unpackMaintenancePackage(built.zip);
    const expected = new Map<string, { connectionId: string; schema: string; table: string }>();
    expected.set("overlays/shop-db/orders.yaml", {
      connectionId: "shop-db",
      schema: "public",
      table: "refunds"
    });
    expect(() => assertEntryIdentityNotRebound(unpacked, expected)).toThrowError(/改绑/);
  });
});

describe("D7 export baseline", () => {
  it("accepts a package whose server-side record matches", async () => {
    const built = await buildPackage();
    const unpacked = unpackMaintenancePackage(built.zip);
    const record = buildExportBaseline({ metadata: built.metadata, packageDigest: built.packageDigest });
    await persistMaintenanceExportBaseline(projectRoot, record);

    await expect(
      verifyMaintenanceExportBaseline(projectRoot, unpacked, { instanceId: "inst-a" })
    ).resolves.toBeTruthy();
  });

  it("refuses a package from another instance", async () => {
    const built = await buildPackage({ instanceId: "inst-b" });
    const unpacked = unpackMaintenancePackage(built.zip);
    const record = buildExportBaseline({ metadata: built.metadata, packageDigest: built.packageDigest });
    await persistMaintenanceExportBaseline(projectRoot, record);

    await expect(
      verifyMaintenanceExportBaseline(projectRoot, unpacked, { instanceId: "inst-a" })
    ).rejects.toThrowError(/其他实例/);
  });

  it("refuses an unknown export record", async () => {
    const built = await buildPackage();
    const unpacked = unpackMaintenancePackage(built.zip);
    await expect(
      verifyMaintenanceExportBaseline(projectRoot, unpacked, { instanceId: "inst-a" })
    ).rejects.toThrowError(/没有该语义维护包的导出记录/);
  });

  it("refuses an expired export record", async () => {
    const built = await buildPackage();
    const unpacked = unpackMaintenancePackage(built.zip);
    const record = buildExportBaseline({
      metadata: built.metadata,
      packageDigest: built.packageDigest,
      now: () => Date.parse("2026-10-25T00:00:00.000Z")
    });
    await persistMaintenanceExportBaseline(projectRoot, record);

    await expect(
      verifyMaintenanceExportBaseline(projectRoot, unpacked, {
        instanceId: "inst-a",
        now: () => Date.parse("2026-10-25T00:00:00.000Z") + 8 * 24 * 60 * 60_000
      })
    ).rejects.toThrowError(/过期/);
  });

  it("accepts an edited overlay but refuses a tampered read-only entry", async () => {
    const built = await buildPackage();
    const record = buildExportBaseline({ metadata: built.metadata, packageDigest: built.packageDigest });
    await persistMaintenanceExportBaseline(projectRoot, record);

    // An EDITABLE overlay is expected to differ from the exported bytes — the
    // export → edit → import journey is the product's core flow. The baseline
    // is verified entry by entry, so the edited overlay still verifies.
    const edited = unpackMaintenancePackage(
      rewriteEntryContent(built.zip, "overlays/shop-db/orders.yaml", "name: orders\ntable: public.orders\n# edited\n")
    );
    await expect(
      verifyMaintenanceExportBaseline(projectRoot, edited, { instanceId: "inst-a" })
    ).resolves.toBeTruthy();

    // A read-only entry, by contrast, must still carry its exported content.
    const tamperedReadonly = unpackMaintenancePackage(
      rewriteEntryContent(built.zip, "readonly/shop-db/_schema/public.yaml", "tampered: true\n")
    );
    await expect(
      verifyMaintenanceExportBaseline(projectRoot, tamperedReadonly, { instanceId: "inst-a" })
    ).rejects.toThrowError(/不一致/);
  });

  it("refuses a read-only entry whose uploaded role was changed to editable", async () => {
    const built = await buildPackage();
    const record = buildExportBaseline({ metadata: built.metadata, packageDigest: built.packageDigest });
    await persistMaintenanceExportBaseline(projectRoot, record);
    const unpacked = unpackMaintenancePackage(built.zip);
    const tampered = {
      ...unpacked,
      packageDigest: "0".repeat(64),
      entries: unpacked.entries.map((entry) =>
        entry.meta.role === "readonly_context"
          ? { ...entry, meta: { ...entry.meta, role: "editable_overlay" as const } }
          : entry
      )
    };

    await expect(
      verifyMaintenanceExportBaseline(projectRoot, tampered, { instanceId: "inst-a" })
    ).rejects.toThrowError(/角色/);
  });

  it("refuses a package that dropped an entry from the server record", async () => {
    const built = await buildPackage();
    const record = buildExportBaseline({ metadata: built.metadata, packageDigest: built.packageDigest });
    await persistMaintenanceExportBaseline(projectRoot, record);
    const unpacked = unpackMaintenancePackage(built.zip);
    const tampered = {
      ...unpacked,
      packageDigest: "1".repeat(64),
      entries: unpacked.entries.filter((entry) => entry.meta.role !== "readonly_context")
    };

    await expect(
      verifyMaintenanceExportBaseline(projectRoot, tampered, { instanceId: "inst-a" })
    ).rejects.toThrowError(/删除|数量/);
  });
});

// ─── helpers ────────────────────────────────────────────────────────────────

function minimalMetadata(): {
  packageKind: typeof MAINTENANCE_PACKAGE_KIND;
  schemaVersion: typeof MAINTENANCE_PACKAGE_KIND;
  exportId: string;
  exportedAt: string;
  instanceId: string;
  product: { name: string; version: string; revision: string };
  baselineDigest: string;
  selected: unknown[];
  dependencies: unknown[];
  entries: MaintenancePackageEntryMeta[];
} {
  return {
    packageKind: MAINTENANCE_PACKAGE_KIND,
    schemaVersion: MAINTENANCE_PACKAGE_KIND,
    exportId: "exp_test",
    exportedAt: "2026-10-25T00:00:00.000Z",
    instanceId: "inst-a",
    product: { name: "Lucy", version: "0.25.0", revision: "test" },
    baselineDigest: "b".repeat(64),
    selected: [],
    dependencies: [],
    entries: []
  };
}

function entryMeta(entryId: string, packagePath: string): MaintenancePackageEntryMeta {
  return {
    entryId,
    role: "editable_overlay",
    identity: { connectionId: "shop-db", schema: "public", table: "orders" },
    sharedIdentities: [],
    packagePath,
    exportedDigest: "c".repeat(64),
    targetDigest: "d".repeat(64),
    baseTarget: "present",
    baselineDigest: "b".repeat(64),
    template: false
  };
}

/** A raw ZIP builder that can inject a unix mode (for the symlink case). */
function buildRawZip(files: Array<{ name: string; data: Buffer; unixMode?: number }>): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;
  for (const file of files) {
    const nameBuf = Buffer.from(file.name, "utf8");
    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0, 8);
    localHeader.writeUInt32LE(file.data.length, 18);
    localHeader.writeUInt32LE(file.data.length, 22);
    localHeader.writeUInt16LE(nameBuf.length, 26);
    localParts.push(localHeader, nameBuf, file.data);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt32LE(file.data.length, 20);
    centralHeader.writeUInt32LE(file.data.length, 24);
    centralHeader.writeUInt16LE(nameBuf.length, 28);
    centralHeader.writeUInt32LE(file.unixMode ? (file.unixMode << 16) >>> 0 : 0, 38);
    centralHeader.writeUInt32LE(offset, 42);
    centralParts.push(centralHeader, nameBuf);
    offset += localHeader.length + nameBuf.length + file.data.length;
  }
  const centralDir = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralDir.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...localParts, centralDir, end]);
}

/** Rewrite one member of a ZIP, keeping the structure valid. */
function rewriteEntryContent(zip: Buffer, memberName: string, content: string): Buffer {
  const entries = readZipEntries(zip);
  const rewritten = entries.map((entry) =>
    entry.name === memberName ? { ...entry, data: Buffer.from(content, "utf8") } : entry
  );
  return buildRawZip(rewritten.map((entry) => ({ name: entry.name, data: entry.data })));
}
