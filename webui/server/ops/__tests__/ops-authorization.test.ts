/**
 * L25-16 S1 — 控制面授权（Spec §3.2.2 规则 1–5，R03 / N02）。
 *
 * 覆盖：
 * - 工具分类：控制面工具归入 `ControlPlane`，未分类工具仍然 fail-closed。
 * - 两层授权面：`allow.ops` 授予控制面工具；旧式 `user.allow` 直配**不授予**任何控制面权限。
 * - 逐对象完整匹配：禁止跨 grant 拼接；允许多条 grant 各自覆盖不同连接。
 * - 连接域缺省即拒绝（fail-closed）。
 * - `allow.tools` 里写控制面工具 → 角色编译失败。
 */

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Identity } from "../../proxy/identity";

const ACCESS_YAML = `roles:
  ops_only:
    description: ops-only role
    allow:
      ops:
        - tools:
            - lucy_ops_connection_tables
          asset_kinds:
            - governance
          connections:
            - conn_a
  ops_two:
    description: two connections in one grant
    allow:
      ops:
        - tools:
            - lucy_ops_connection_tables
            - lucy_ops_source_import
          asset_kinds:
            - governance
            - semantic
          connections:
            - conn_a
            - conn_b
  ops_split:
    description: one grant per connection
    allow:
      ops:
        - tools:
            - lucy_ops_connection_tables
          asset_kinds:
            - governance
          connections:
            - conn_a
        - tools:
            - lucy_ops_connection_tables
          asset_kinds:
            - governance
          connections:
            - conn_b
  ops_no_conn:
    description: missing connections -> fail closed
    allow:
      ops:
        - tools:
            - lucy_ops_connection_tables
          asset_kinds:
            - governance
  ops_wrong_kind:
    description: wrong asset kind
    allow:
      ops:
        - tools:
            - lucy_ops_connection_tables
          asset_kinds:
            - semantic
          connections:
            - conn_a
  ops_bad_tool_in_allow_tools:
    description: control plane tool smuggled into allow.tools
    allow:
      tools:
        - lucy_ops_connection_tables
users:
  - id: ops_agent
    name: Ops Agent
    enabled: true
    roles:
      - ops_only
    tokens: []
  - id: ops_two_agent
    name: Ops Two
    enabled: true
    roles:
      - ops_two
    tokens: []
  - id: ops_split_agent
    name: Ops Split
    enabled: true
    roles:
      - ops_split
    tokens: []
  - id: ops_no_conn_agent
    name: Ops No Conn
    enabled: true
    roles:
      - ops_no_conn
    tokens: []
  - id: ops_wrong_kind_agent
    name: Ops Wrong Kind
    enabled: true
    roles:
      - ops_wrong_kind
    tokens: []
  - id: ops_smuggle_agent
    name: Ops Smuggle
    enabled: true
    roles:
      - ops_bad_tool_in_allow_tools
    tokens: []
  - id: legacy_direct_agent
    name: Legacy Direct
    enabled: true
    tokens: []
    allow:
      connections:
        - conn_a
      tools:
        - lucy_ops_connection_tables
        - lucy_query
defaults:
  deny_tools: []
  known_tools:
    - lucy_query
    - lucy_read_source
    - lucy_catalog
    - lucy_ops_connection_tables
    - lucy_ops_source_import
  table_touching_tools:
    - lucy_query
    - lucy_read_source
  sensitive_metadata_tools: []
  sensitive_table_prefixes: []
`;

let projectRoot: string;
let previousRoot: string | undefined;

function identity(userId: string): Identity {
  return { userId, tokenLabel: "unit-test", tokenHashPrefix: "unit-test" };
}

async function loadAcl() {
  vi.resetModules();
  return import("../../proxy/acl");
}

beforeEach(async () => {
  previousRoot = process.env.KTX_PROJECT_ROOT;
  projectRoot = await mkdtemp(path.join(os.tmpdir(), "ktx-ops-auth-"));
  await mkdir(path.join(projectRoot, "webui", "config"), { recursive: true });
  await mkdir(path.join(projectRoot, "semantic-layer", "conn_a", "_schema"), { recursive: true });
  await writeFile(path.join(projectRoot, "ktx.yaml"), "connections: {}\n", "utf8");
  await writeFile(path.join(projectRoot, "webui", "config", "access.yaml"), ACCESS_YAML, "utf8");
  await writeFile(
    path.join(projectRoot, "semantic-layer", "conn_a", "_schema", "default.yaml"),
    "tables: {}\n",
    "utf8"
  );
  process.env.KTX_PROJECT_ROOT = projectRoot;
});

afterEach(async () => {
  if (previousRoot === undefined) delete process.env.KTX_PROJECT_ROOT;
  else process.env.KTX_PROJECT_ROOT = previousRoot;
  await rm(projectRoot, { recursive: true, force: true });
});

describe("L25-16 S1 控制面工具分类", () => {
  it("控制面工具归入 ControlPlane 类，未分类工具仍然 fail-closed", async () => {
    const { classifyTool, absoluteDenyOrUnclassifiedReason, DEFAULT_KNOWN_TOOLS } = await loadAcl();

    expect(classifyTool("lucy_ops_connection_tables")).toBe("ControlPlane");
    expect(classifyTool("lucy_ops_source_import")).toBe("ControlPlane");
    expect(classifyTool("lucy_query")).toBe("DataPlane");
    expect(classifyTool("future_tool")).toBe("AbsoluteDeny");

    expect(absoluteDenyOrUnclassifiedReason("lucy_ops_connection_tables")).toBeUndefined();
    expect(absoluteDenyOrUnclassifiedReason("future_tool")).toBe("tool_unclassified:future_tool");

    expect(DEFAULT_KNOWN_TOOLS).toContain("lucy_ops_connection_tables");
    expect(DEFAULT_KNOWN_TOOLS).toContain("lucy_ops_source_import");
  });
});

describe("L25-16 S1 控制面授权面", () => {
  it("allow.ops 授予的工具在 tools/list 可见且可调用", async () => {
    const { check, allowedToolNames } = await loadAcl();

    const visible = await allowedToolNames(identity("ops_agent"));
    expect(visible).toContain("lucy_ops_connection_tables");
    expect(visible).not.toContain("lucy_ops_source_import");

    await expect(
      check(identity("ops_agent"), "lucy_ops_connection_tables", { connectionId: "conn_a" })
    ).resolves.toEqual({ allowed: true });
  });

  it("未授予 ops 的角色看不到也调不动控制面工具", async () => {
    const { check, allowedToolNames } = await loadAcl();

    const visible = await allowedToolNames(identity("legacy_direct_agent"));
    expect(visible).not.toContain("lucy_ops_connection_tables");

    await expect(
      check(identity("legacy_direct_agent"), "lucy_ops_connection_tables", { connectionId: "conn_a" })
    ).resolves.toEqual({ allowed: false, reason: "ops_not_granted:lucy_ops_connection_tables" });
  });

  it("旧式 user.allow 直配不授予任何控制面权限", async () => {
    const { resolveEffectivePermissionsForAdmin } = await loadAcl();

    const result = await resolveEffectivePermissionsForAdmin("legacy_direct_agent");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.permissions.opsTools).toEqual([]);
  });

  it("allow.tools 里写控制面工具 → 角色编译失败", async () => {
    const { check } = await loadAcl();

    await expect(
      check(identity("ops_smuggle_agent"), "lucy_ops_connection_tables", { connectionId: "conn_a" })
    ).resolves.toEqual({
      allowed: false,
      reason: "role_resolution_failed:ops_bad_tool_in_allow_tools:control_plane_tool_in_allow_tools"
    });
  });

  it("仅有 allow.ops 的角色可以编译通过（不要求数据面能力）", async () => {
    const { check } = await loadAcl();
    await expect(
      check(identity("ops_agent"), "lucy_ops_connection_tables", { connectionId: "conn_a" })
    ).resolves.toEqual({ allowed: true });
  });
});

describe("L25-16 S1 逐对象完整匹配", () => {
  it("单条 grant 覆盖两个连接 → 整批放行", async () => {
    const { check } = await loadAcl();
    await expect(
      check(identity("ops_two_agent"), "lucy_ops_connection_tables", {
        connectionId: "conn_b"
      })
    ).resolves.toEqual({ allowed: true });
  });

  it("多条 grant 各自覆盖不同连接 → 逐对象各自放行（不要求单条 grant 覆盖整批）", async () => {
    const { resolveEffectivePermissionsForAdmin } = await loadAcl();

    const result = await resolveEffectivePermissionsForAdmin("ops_split_agent");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.permissions.opsTools).toEqual(["lucy_ops_connection_tables"]);
  });

  it("跨 grant 拼接不成立：A 的域 + B 的连接 → 拒绝", async () => {
    const { collectOpsGrants, matchOpsGrantForTarget } = await import("../ops-grants");
    const { getOpsToolSpec } = await import("../control-plane");
    const spec = getOpsToolSpec("lucy_ops_connection_tables");
    expect(spec).toBeDefined();
    if (!spec) return;

    const grants = collectOpsGrants(
      {
        roles: {
          spliced: {
            allow: {
              ops: [
                { tools: ["lucy_ops_connection_tables"], asset_kinds: ["semantic"], connections: ["conn_a"] },
                { tools: ["lucy_ops_source_import"], asset_kinds: ["semantic"], connections: ["conn_b"] }
              ]
            }
          }
        }
      },
      ["spliced"]
    );

    const match = matchOpsGrantForTarget(grants, spec, "conn_b");
    expect(match.matched).toBe(false);
    expect(match.reasons).toContain("kind_not_covered");
  });

  it("连接域缺省 → fail-closed", async () => {
    const { collectOpsGrants, matchOpsGrantForTarget } = await import("../ops-grants");
    const { getOpsToolSpec } = await import("../control-plane");
    const spec = getOpsToolSpec("lucy_ops_connection_tables");
    expect(spec).toBeDefined();
    if (!spec) return;

    const grants = collectOpsGrants(
      {
        roles: {
          noconn: {
            allow: {
              ops: [{ tools: ["lucy_ops_connection_tables"], asset_kinds: ["governance"] }]
            }
          }
        }
      },
      ["noconn"]
    );

    const match = matchOpsGrantForTarget(grants, spec, "conn_a");
    expect(match.matched).toBe(false);
    expect(match.reasons).toContain("connection_scope_absent");
  });

  it("grant 的 tools 不允许 `*`", async () => {
    const { normalizeOpsGrant } = await import("../ops-grants");
    expect(normalizeOpsGrant({ tools: ["*"], asset_kinds: ["governance"], connections: ["conn_a"] })).toEqual({
      ok: false,
      reason: "ops_grant_tools_wildcard_forbidden"
    });
  });

  it("asset_kinds 未覆盖工具适用域 → 拒绝", async () => {
    const { collectOpsGrants, matchOpsGrantForTarget } = await import("../ops-grants");
    const { getOpsToolSpec } = await import("../control-plane");
    const spec = getOpsToolSpec("lucy_ops_connection_tables");
    expect(spec).toBeDefined();
    if (!spec) return;

    const grants = collectOpsGrants(
      {
        roles: {
          wrongkind: {
            allow: {
              ops: [
                { tools: ["lucy_ops_connection_tables"], asset_kinds: ["semantic"], connections: ["conn_a"] }
              ]
            }
          }
        }
      },
      ["wrongkind"]
    );

    const match = matchOpsGrantForTarget(grants, spec, "conn_a");
    expect(match.matched).toBe(false);
    expect(match.reasons).toContain("kind_not_covered");
  });

  it("instance_scope read_only 不能授权写类控制面工具", async () => {
    const { matchOpsGrantForTarget } = await import("../ops-grants");
    const { getOpsToolSpec } = await import("../control-plane");
    const spec = getOpsToolSpec("lucy_ops_connection_tables");
    expect(spec).toBeDefined();
    if (!spec) return;
    const match = matchOpsGrantForTarget(
      [{
        tools: ["lucy_ops_connection_tables"],
        asset_kinds: ["governance"],
        connections: ["conn_a"],
        instance_scope: "read_only"
      }],
      spec,
      "conn_a"
    );
    expect(match.matched).toBe(false);
    expect(match.reasons).toContain("read_only_scope");
  });

  it("角色保存拒绝 read_only grant 带写工具", async () => {
    const { validateRoleShape } = await import("../../admin/roles");
    const result = validateRoleShape({
      allow: {
        ops: [{
          tools: ["lucy_ops_connection_tables"],
          asset_kinds: ["governance"],
          connections: ["conn_a"],
          instance_scope: "read_only"
        }]
      }
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain("read_only cannot grant write tool");
  });
});
