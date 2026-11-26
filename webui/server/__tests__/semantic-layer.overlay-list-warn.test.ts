import { mkdir, mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invalidateContentPathsCache } from "../paths";
import { listSourcesWithManifests } from "../semantic-layer";

// 只对目标连接目录注入错误，其余 readdir 透传真实实现。
// manifest 侧（listSchemaFiles）只 readdir 内容根与 <conn>/_schema，从不 readdir
// <conn> 本身，因此这里可以精确模拟「manifest 可读但 overlay 列举失败/竞态缺失」。
const injectedErrors = vi.hoisted(() => new Map<string, string>());

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    readdir: (async (dir: unknown, options?: unknown) => {
      if (typeof dir === "string") {
        for (const [suffix, code] of injectedErrors) {
          if (dir.endsWith(suffix)) {
            const error = new Error(`${code}: injected, scandir '${dir}'`) as NodeJS.ErrnoException;
            error.code = code;
            throw error;
          }
        }
      }
      return (actual.readdir as (d: unknown, o?: unknown) => Promise<unknown>)(dir, options);
    }) as typeof actual.readdir
  };
});

const CONN = "warnconn";
const CONN_DIR_SUFFIX = path.join("semantic-layer", CONN);

let projectRoot: string;
let prevRoot: string | undefined;
let prevContentRoot: string | undefined;
let warnSpy: ReturnType<typeof vi.spyOn>;

function semanticWarnCalls(): unknown[][] {
  return warnSpy.mock.calls.filter((args: unknown[]) => String(args[0]).includes("[lucy-semantic]"));
}

async function writeOrdersFixture() {
  const manifestPath = path.join(projectRoot, "semantic-layer", CONN, "_schema", "dataforai.yaml");
  await writeFile(
    manifestPath,
    "tables:\n  orders:\n    table: dataforai.orders\n    columns:\n      - name: id\n        type: number\n",
    "utf8"
  );
  await writeFile(
    path.join(projectRoot, "semantic-layer", CONN, "orders.yaml"),
    "name: orders\ngrain: [id]\n",
    "utf8"
  );
  // 让 overlay 严格新于 manifest，恢复后的 semanticUpdatedAtSource 断言不受 mtime 粒度影响
  const older = new Date("2026-01-01T00:00:00.000Z");
  await utimes(manifestPath, older, older);
}

beforeEach(async () => {
  projectRoot = await mkdtemp(path.join(os.tmpdir(), "ktx-webui-sl-warn-"));
  await mkdir(path.join(projectRoot, "semantic-layer", CONN, "_schema"), { recursive: true });
  await writeFile(path.join(projectRoot, "ktx.yaml"), "connections: {}\n", "utf8");
  prevRoot = process.env.KTX_PROJECT_ROOT;
  prevContentRoot = process.env.LUCY_CONTENT_ROOT;
  process.env.KTX_PROJECT_ROOT = projectRoot;
  process.env.LUCY_CONTENT_ROOT = ".";
  invalidateContentPathsCache();
  warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(async () => {
  warnSpy.mockRestore();
  injectedErrors.clear();
  invalidateContentPathsCache();
  if (prevRoot === undefined) delete process.env.KTX_PROJECT_ROOT;
  else process.env.KTX_PROJECT_ROOT = prevRoot;
  if (prevContentRoot === undefined) delete process.env.LUCY_CONTENT_ROOT;
  else process.env.LUCY_CONTENT_ROOT = prevContentRoot;
  await rm(projectRoot, { recursive: true, force: true });
});

describe("listSourcesWithManifests — overlay 目录列举降级的可观测性", () => {
  it("非 ENOENT 失败：overlay 按缺席降级并告警一次（按 conn+code 去重），恢复后 overlay 重新可见", async () => {
    await writeOrdersFixture();
    injectedErrors.set(CONN_DIR_SUFFIX, "EACCES");

    const degraded = await listSourcesWithManifests(projectRoot, { skipAuthorizedCounts: true });
    expect(degraded.tables).toHaveLength(1);
    expect(degraded.tables[0].hasGrain).toBe(false);
    expect(degraded.tables[0].semanticUpdatedAtSource).toBe("manifest");
    expect(semanticWarnCalls()).toHaveLength(1);
    expect(String(semanticWarnCalls()[0][0])).toContain(CONN);
    expect(String(semanticWarnCalls()[0][0])).toContain("EACCES");

    // 持续故障下第二次扫描不再重复告警（MCP 每查询路径防刷日志）
    await listSourcesWithManifests(projectRoot, { skipAuthorizedCounts: true });
    expect(semanticWarnCalls()).toHaveLength(1);

    // 故障恢复后下一次扫描即还原 overlay 语义
    injectedErrors.clear();
    const recovered = await listSourcesWithManifests(projectRoot, { skipAuthorizedCounts: true });
    expect(recovered.tables[0].hasGrain).toBe(true);
    expect(recovered.tables[0].semanticUpdatedAtSource).toBe("overlay");
  });

  it("ENOENT（manifest 扫描后目录被移除的竞态）静默降级，不告警", async () => {
    await writeOrdersFixture();
    injectedErrors.set(CONN_DIR_SUFFIX, "ENOENT");

    const result = await listSourcesWithManifests(projectRoot, { skipAuthorizedCounts: true });
    expect(result.tables).toHaveLength(1);
    expect(result.tables[0].hasGrain).toBe(false);
    expect(result.tables[0].semanticUpdatedAtSource).toBe("manifest");
    expect(semanticWarnCalls()).toHaveLength(0);
  });
});
