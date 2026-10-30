/**
 * Spec 149 §6.1 / WO T8 — Docker demo 模板的演示运维问数 Agent。
 *
 * 覆盖：SC-15。断言只读**模板文件**，不依赖已有 `lucy-demo-data` 卷。
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const ACCESS_YAML_PATH = path.join(
  REPO_ROOT,
  "examples/docker-demo/project-template/webui/config/access.yaml"
);

interface DemoAccessConfig {
  roles: Record<string, {
    description?: string;
    permission_model_version?: number;
    allow?: {
      connections?: string[];
      source_scope?: string;
      tableSelectors?: Array<{ connection?: string; schema?: string; names?: string[]; row_access?: string }>;
      tools?: string[];
    };
  }>;
  users: Array<{
    id: string;
    name?: string;
    enabled?: boolean;
    tokens?: Array<{ hash?: string; label?: string }>;
    role?: string;
    roles?: string[];
  }>;
}

describe("Spec 149 §6.1 — Docker demo 模板", () => {
  it("SC-15: 存在 demo_ops 与只授权 lucy-ops 的正式 Role", async () => {
    const raw = await readFile(ACCESS_YAML_PATH, "utf8");
    const config = parse(raw) as DemoAccessConfig;

    const opsRole = config.roles.lucy_ops_reader;
    expect(opsRole, "demo 模板必须带同名正式 Role").toBeDefined();
    expect(opsRole.allow?.connections).toEqual(["lucy-ops"]);
    expect(opsRole.allow?.source_scope).toBeUndefined();
    expect(opsRole.allow?.tableSelectors).toHaveLength(1);
    expect(opsRole.allow?.tableSelectors?.[0].connection).toBe("lucy-ops");
    expect(opsRole.allow?.tableSelectors?.[0].schema).toBe("main");
    expect(opsRole.allow?.tableSelectors?.[0].names).toEqual(["ops_calls", "ops_call_tables"]);
    // 四个只读通道工具。
    for (const tool of ["wiki_search", "wiki_read", "lucy_skill_search", "lucy_skill_read"]) {
      expect(opsRole.allow?.tools, tool).toContain(tool);
    }

    const demoOps = config.users.find((user) => user.id === "demo_ops");
    expect(demoOps, "demo 模板必须带演示运维问数 Agent").toBeDefined();
    expect(demoOps?.role).toBe("lucy_ops_reader");
    expect(demoOps?.tokens?.[0].label).toBe("demo-ops");
    expect(demoOps?.tokens?.[0].hash).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it("SC-15: demo_readonly 仍只有三张示例表，lucy_admin 的星号不变", async () => {
    const raw = await readFile(ACCESS_YAML_PATH, "utf8");
    const config = parse(raw) as DemoAccessConfig;

    const demoReadonly = config.roles.demo_readonly;
    expect(demoReadonly.allow?.connections).toEqual(["demo-mysql"]);
    expect(demoReadonly.allow?.tableSelectors?.[0].names).toEqual([
      "superstore_orders",
      "superstore_returns",
      "superstore_people"
    ]);

    const admin = config.roles.lucy_admin;
    expect(admin.allow?.connections).toEqual(["*"]);
    expect(admin.allow?.source_scope).toBe("catalog_bound");
  });

  it("SC-15: 明文 Token 不进仓库（模板只存哈希）", async () => {
    const raw = await readFile(ACCESS_YAML_PATH, "utf8");
    expect(raw).not.toContain("lucy-demo-ops-token");
  });
});
