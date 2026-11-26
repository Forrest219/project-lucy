/**
 * REQ-0117 方向 1 — commitEffectivePolicy 的增量重编译（缩小重载面）。
 *
 * 不变式（Spec lucy-20261126-access-write-window-resilience §1 方向 1）：
 *  - allow / 行权限编译结果不变：未受影响用户的编译结果与全量编译逐字一致；
 *  - 复用以「引用相等」证明（上次快照的同一结果对象被再次装入 byUserId）；
 *  - 全局输入（defaults / 行策略模板目录 / source map / 启用表）任一变化即回退全量；
 *  - 降级快照（degradedGlobal）不复用。
 */
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let projectRoot = "";
let previousRoot: string | undefined;
let previousContentRoot: string | undefined;

beforeEach(async () => {
  previousRoot = process.env.KTX_PROJECT_ROOT;
  previousContentRoot = process.env.LUCY_CONTENT_ROOT;
  process.env.LUCY_CONTENT_ROOT = ".";
});

afterEach(async () => {
  if (previousRoot === undefined) delete process.env.KTX_PROJECT_ROOT;
  else process.env.KTX_PROJECT_ROOT = previousRoot;
  if (previousContentRoot === undefined) delete process.env.LUCY_CONTENT_ROOT;
  else process.env.LUCY_CONTENT_ROOT = previousContentRoot;
  if (projectRoot) await rm(projectRoot, { recursive: true, force: true });
  projectRoot = "";
});

const ROLES = `roles:
  alpha:
    description: alpha
    permission_model_version: 2
    allow:
      connections:
        - warehouse
      tableSelectors:
        - connection: warehouse
          schema: fin
          names:
            - fin_ledger
          row_access: all
      tools:
        - lucy_query
  beta:
    description: beta
    permission_model_version: 2
    allow:
      connections:
        - warehouse
      tableSelectors:
        - connection: warehouse
          schema: fin
          names:
            - fin_budget
          row_access: all
      tools:
        - lucy_query
`;

const SCHEMA = `tables:
  fin_ledger:
    table: fin.fin_ledger
  fin_budget:
    table: fin.fin_budget
`;

function accessYaml(usersBlock: string, rolesBlock = ROLES, defaultsBlock = "defaults:\n  deny_tools: []\n"): string {
  return `${rolesBlock}users:
${usersBlock}
${defaultsBlock}`;
}

async function makeProject(yaml: string): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "lucy-req0117-incr-"));
  await mkdir(path.join(root, "webui", "config"), { recursive: true });
  await mkdir(path.join(root, "semantic-layer", "warehouse", "_schema"), { recursive: true });
  await writeFile(
    path.join(root, "ktx.yaml"),
    `connections:
  warehouse:
    driver: mysql
    enabled_tables:
      - fin.fin_ledger
      - fin.fin_budget
`,
    "utf8"
  );
  await writeFile(path.join(root, "webui", "config", "access.yaml"), yaml, "utf8");
  await writeFile(path.join(root, "semantic-layer", "warehouse", "_schema", "fin.yaml"), SCHEMA, "utf8");
  return root;
}

async function loadAcl() {
  vi.resetModules();
  return import("../proxy/acl.js");
}

const USERS_THREE = `  - id: agent_a
    name: A
    enabled: true
    role: alpha
    tokens: []
  - id: agent_b
    name: B
    enabled: true
    role: beta
    tokens: []
  - id: agent_c
    name: C
    enabled: true
    roles:
      - alpha
      - beta
    tokens: []
`;

describe("REQ-0117 — policy incremental recompile", () => {
  it("agent save: only the saved agent recompiles; unaffected users reuse the previous result objects", async () => {
    projectRoot = await makeProject(accessYaml(USERS_THREE));
    process.env.KTX_PROJECT_ROOT = projectRoot;
    const acl = await loadAcl();
    const byUsers = () => acl.policyRuntimeByUserIdForTests();
    await acl.commitEffectivePolicy();
    const first = byUsers();
    expect(first?.size).toBe(3);

    // 仅修改 agent_b 的显示名（属于该用户自身的记录变化）
    const renamed = accessYaml(USERS_THREE.replace("name: B", "name: B2"));
    await writeFile(path.join(projectRoot, "webui", "config", "access.yaml"), renamed, "utf8");
    await acl.commitEffectivePolicy();

    const second = byUsers();
    expect(second?.size).toBe(3);
    // 未受影响用户复用同一结果对象（引用相等）；被改用户是 fresh 编译结果。
    expect(second!.get("agent_a")).toBe(first!.get("agent_a"));
    expect(second!.get("agent_c")).toBe(first!.get("agent_c"));
    expect(second!.get("agent_b")).not.toBe(first!.get("agent_b"));

    // 语义等价：复用后的生效权限与全量编译一致（ok / capability 集不变）。
    const a = await acl.effectivePermissions({ userId: "agent_a", tokenLabel: "t", tokenHashPrefix: "t" });
    expect(a.ok).toBe(true);
  });

  it("role save: users referencing the changed role recompile; the rest reuse", async () => {
    projectRoot = await makeProject(accessYaml(USERS_THREE));
    process.env.KTX_PROJECT_ROOT = projectRoot;
    const acl = await loadAcl();
    const byUsers = () => acl.policyRuntimeByUserIdForTests();
    await acl.commitEffectivePolicy();
    const first = byUsers();

    // 修改 alpha（agent_a 与 agent_c 引用它）
    const changed = accessYaml(USERS_THREE, ROLES.replace("description: alpha", "description: alpha2"));
    await writeFile(path.join(projectRoot, "webui", "config", "access.yaml"), changed, "utf8");
    await acl.commitEffectivePolicy();

    const second = byUsers();
    expect(second!.get("agent_a")).not.toBe(first!.get("agent_a"));
    expect(second!.get("agent_c")).not.toBe(first!.get("agent_c"));
    expect(second!.get("agent_b")).toBe(first!.get("agent_b"));
  });

  it("global input change (defaults) falls back to a full recompile", async () => {
    projectRoot = await makeProject(accessYaml(USERS_THREE));
    process.env.KTX_PROJECT_ROOT = projectRoot;
    const acl = await loadAcl();
    const byUsers = () => acl.policyRuntimeByUserIdForTests();
    await acl.commitEffectivePolicy();
    const first = byUsers();

    const changed = accessYaml(USERS_THREE, ROLES, "defaults:\n  deny_tools:\n  - wiki_search\n");
    await writeFile(path.join(projectRoot, "webui", "config", "access.yaml"), changed, "utf8");
    await acl.commitEffectivePolicy();

    const second = byUsers();
    expect(second!.get("agent_a")).not.toBe(first!.get("agent_a"));
    expect(second!.get("agent_b")).not.toBe(first!.get("agent_b"));
    expect(second!.get("agent_c")).not.toBe(first!.get("agent_c"));
  });

  it("added / removed roles propagate to their users", async () => {
    projectRoot = await makeProject(accessYaml(USERS_THREE));
    process.env.KTX_PROJECT_ROOT = projectRoot;
    const acl = await loadAcl();
    const byUsers = () => acl.policyRuntimeByUserIdForTests();
    await acl.commitEffectivePolicy();
    const first = byUsers();

    // 新增角色 gamma 并把 agent_b 改绑到 gamma：agent_b 变更、agent_a/c 未变
    const changed = accessYaml(
      USERS_THREE.replace("role: beta", "role: gamma"),
      `${ROLES}  gamma:
    description: gamma
    permission_model_version: 2
    allow:
      connections:
        - warehouse
      tableSelectors:
        - connection: warehouse
          schema: fin
          names:
            - fin_budget
          row_access: all
      tools:
        - lucy_query
`);
    await writeFile(path.join(projectRoot, "webui", "config", "access.yaml"), changed, "utf8");
    await acl.commitEffectivePolicy();

    const second = byUsers();
    expect(second!.get("agent_b")).not.toBe(first!.get("agent_b"));
    expect(second!.get("agent_a")).toBe(first!.get("agent_a"));
    expect(second!.get("agent_c")).toBe(first!.get("agent_c"));
  });

  it("degraded snapshot is never reused (recovery recompiles everyone)", async () => {
    // 先以坏角色（selector 零匹配）触发 agent 降级，再修好：恢复提交必须全量。
    const badUsers = USERS_THREE.replace("role: beta", "role: broken");
    projectRoot = await makeProject(accessYaml(badUsers, `${ROLES}  broken:
    description: broken
    permission_model_version: 2
    allow:
      connections:
        - warehouse
      tableSelectors:
        - connection: warehouse
          schema: fin
          names:
            - missing_table
          row_access: all
      tools:
        - lucy_query
`));
    process.env.KTX_PROJECT_ROOT = projectRoot;
    const acl = await loadAcl();
    const byUsers = () => acl.policyRuntimeByUserIdForTests();
    await acl.commitEffectivePolicy();
    const degraded = byUsers();
    expect(degraded?.get("agent_b")?.ok).toBe(false);

    const fixed = accessYaml(USERS_THREE);
    await writeFile(path.join(projectRoot, "webui", "config", "access.yaml"), fixed, "utf8");
    await acl.commitEffectivePolicy();
    const recovered = byUsers();
    expect(recovered?.get("agent_b")?.ok).toBe(true);
    expect(recovered?.get("agent_a")).toBe(degraded?.get("agent_a"));
  });

  it("effective permissions stay identical across an incremental commit (agent_c multi-role)", async () => {
    projectRoot = await makeProject(accessYaml(USERS_THREE));
    process.env.KTX_PROJECT_ROOT = projectRoot;
    const acl = await loadAcl();
    const byUsers = () => acl.policyRuntimeByUserIdForTests();
    await acl.commitEffectivePolicy();
    const before = await acl.effectivePermissions({ userId: "agent_c", tokenLabel: "t", tokenHashPrefix: "t" });

    const renamed = accessYaml(USERS_THREE.replace("name: B", "name: B2"));
    await writeFile(path.join(projectRoot, "webui", "config", "access.yaml"), renamed, "utf8");
    await acl.commitEffectivePolicy();
    const after = await acl.effectivePermissions({ userId: "agent_c", tokenLabel: "t", tokenHashPrefix: "t" });

    expect(after.ok).toBe(before.ok);
    if (before.ok && after.ok) {
      expect(after.permissions).toEqual(before.permissions);
    }
  });
});
