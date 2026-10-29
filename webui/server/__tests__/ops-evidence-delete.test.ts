/**
 * Spec 149 §8 / WO T5 — 运维问数连接的删除保护。
 *
 * 覆盖：SC-07。
 */

import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let projectRoot: string | undefined;
let previousRoot: string | undefined;
let previousContentRoot: string | undefined;

const YAML = `connections:
  lucy-ops:
    driver: sqlite
    readonly: true
    path: /tmp/lucy-ops-audit.sqlite
    schemas:
      - main
    enabled_tables:
      - ops_calls
      - ops_call_tables
  demo-mysql:
    driver: mysql
    enabled_tables:
      - dataforai.superstore_orders
setup:
  database_connection_ids:
    - demo-mysql
`;

async function makeProject(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "lucy-ops-evidence-delete-"));
  await mkdir(path.join(root, "webui", "config"), { recursive: true });
  await mkdir(path.join(root, ".ktx-ui"), { recursive: true });
  await mkdir(path.join(root, "config", "semantic-layer", "lucy-ops", "_schema"), { recursive: true });
  await mkdir(path.join(root, "skills", "lucy-ops"), { recursive: true });
  await mkdir(path.join(root, "wiki", "lucy-ops"), { recursive: true });
  await writeFile(path.join(root, "ktx.yaml"), YAML, "utf8");
  await writeFile(path.join(root, "webui", "config", "access.yaml"), "users: []\n", "utf8");
  await writeFile(path.join(root, ".ktx-ui", "audit.sqlite"), "audit-bytes", "utf8");
  await writeFile(
    path.join(root, "config", "semantic-layer", "lucy-ops", "_schema", "main.yaml"),
    "tables: {}\n",
    "utf8"
  );
  await writeFile(path.join(root, "skills", "lucy-ops", "ops-questioning.md"), "skill\n", "utf8");
  await writeFile(path.join(root, "wiki", "lucy-ops", "ops-questioning.md"), "wiki\n", "utf8");
  return root;
}

beforeEach(async () => {
  previousRoot = process.env.KTX_PROJECT_ROOT;
  previousContentRoot = process.env.LUCY_CONTENT_ROOT;
});

afterEach(async () => {
  if (previousRoot === undefined) delete process.env.KTX_PROJECT_ROOT;
  else process.env.KTX_PROJECT_ROOT = previousRoot;
  if (previousContentRoot === undefined) delete process.env.LUCY_CONTENT_ROOT;
  else process.env.LUCY_CONTENT_ROOT = previousContentRoot;
  if (projectRoot) {
    await rm(projectRoot, { recursive: true, force: true });
    projectRoot = undefined;
  }
});

describe("Spec 149 §8 — 删除保护", () => {
  it("SC-07: dryRun 与确认写入都拒绝，且审计库、三类资产与镜像仍在", async () => {
    projectRoot = await makeProject();
    process.env.KTX_PROJECT_ROOT = projectRoot;
    process.env.LUCY_CONTENT_ROOT = ".";

    vi.resetModules();
    const { removeConnection } = await import("../project");
    const recordConfigChange = vi.fn();

    for (const dryRun of [true, false]) {
      await expect(
        removeConnection(projectRoot!, "lucy-ops", dryRun, { recordConfigChange })
      ).rejects.toMatchObject({
        code: "OPS_EVIDENCE_CONNECTION_PROTECTED",
        statusCode: 400,
        message: "运维问数连接不能删除"
      });
    }

    // 不写配置变更台账。
    expect(recordConfigChange).not.toHaveBeenCalled();

    // 审计库、内容根资产与项目根镜像都还在。
    expect(await readFile(path.join(projectRoot, ".ktx-ui", "audit.sqlite"), "utf8")).toBe("audit-bytes");
    expect(
      await readFile(path.join(projectRoot, "config", "semantic-layer", "lucy-ops", "_schema", "main.yaml"), "utf8")
    ).toBe("tables: {}\n");
    expect(await readFile(path.join(projectRoot, "skills", "lucy-ops", "ops-questioning.md"), "utf8")).toBe("skill\n");
    expect(await readFile(path.join(projectRoot, "wiki", "lucy-ops", "ops-questioning.md"), "utf8")).toBe("wiki\n");

    // 连接块也没被改写。
    const yaml = await readFile(path.join(projectRoot, "ktx.yaml"), "utf8");
    expect(yaml).toContain("lucy-ops:");
  });
});
