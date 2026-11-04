# 行权限真实 e2e 审判包（强度 B）Implementation Plan

**Goal:** 本机一次两阶段 run，对 ROW25-V01…V22 + RTP25-01…10 + RTV25-01…08 + BY-01…19 做真实一推一；数据面绑阿里云 RDS 只读 `mysql-aliyun`／`dataforai.superstore_orders`（华东／西南），禁止假 `coversV025` 与写库 seed。

**Architecture:** 新建 `examples/row-policy-e2e` 审判包；`row-policy-pack.mjs` 持有 id→owner 注册表与区划常量；`prepare-environment --pack row-policy` 渲染包并挂载 RDS 密码文件；`run-row-policy-b.mjs` 串 Gate-Off→Gate-On；重写 `row-policy-v025`／`row-policy-templates-v025` 与改绑 BY handlers。

**Tech Stack:** Node ESM（`scripts/e2e`）、Playwright real-e2e、MySQL RDS 只读、现有 `v025-coverage.yaml`／`access-v025.mjs` 描述符。

**Design authority:** [`docs/plans/2026-11-04-row-policy-real-e2e-pack-design.md`](./2026-11-04-row-policy-real-e2e-pack-design.md)

## Global Constraints

- 强度 B；同 run 两阶段；本机，非客户 K8s。
- RDS 只读：`cw_rds_bot`；密码只走 `file:.ktx/secrets/mysql-aliyun-password`（或 runDir secrets 副本）；禁止密码入仓／入证。
- 谓词字面量：`华东`／`西南`（非 East／West）。
- 每个 execution id 唯一断言所有者；`blocked`／`skip` 不算 B 通过。
- **不要自动 git commit**；仅当用户明确要求时再提交（本仓库用户规则优先于本 plan 模板里的 Commit 步）。
- 本条实施不表示可上线；不改功能 Spec 头部状态。

## File map

| Path | Responsibility |
|------|----------------|
| `examples/row-policy-e2e/**` | 审判包模板（ktx／semantic／access／README） |
| `scripts/e2e/lib/row-policy-pack.mjs` | 包常量、区划、id→owner 注册表、phase 归属 |
| `scripts/e2e/__tests__/row-policy-pack.test.mjs` | 注册表守恒／无假覆盖／无写库入口 |
| `scripts/e2e/prepare-environment.mjs` | `--pack row-policy` 分支 |
| `scripts/e2e/run-row-policy-b.mjs` | 两阶段编排与汇总 exit code |
| `webui/tests/real-e2e/row-policy-v025.spec.ts` | ROW25 真断言（纠偏 covers） |
| `webui/tests/real-e2e/row-policy-templates-v025.spec.ts` | RTP／RTV 拆测 |
| `scripts/e2e/security/row-policy-cases.mjs` | BY 改绑审判包 Agent／表／区划 |

---

### Task 1: 注册表模块（TDD）— `row-policy-pack.mjs`

**Files:**
- Create: `scripts/e2e/lib/row-policy-pack.mjs`
- Create: `scripts/e2e/__tests__/row-policy-pack.test.mjs`
- Consumes: `ROW25_EXECUTION_IDS` from `scripts/e2e/lib/access-v025.mjs`；RTP／RTV id 列表 from `scripts/e2e/lib/row-policy-templates-v025.mjs`（若无导出则本任务内硬编码与 coverage 一致的 10+8 列表并加注释指向 coverage）
- Produces: `REGIONS`, `TABLES`, `ROLES`, `AGENTS`, `REGISTRY`, `idsForPhase(phase)`, `assertRegistryComplete()`

- [ ] **Step 1: 写失败单测**

在 `scripts/e2e/__tests__/row-policy-pack.test.mjs`：

```js
import assert from "node:assert/strict";
import test from "node:test";
import {
  REGIONS, REGISTRY, idsForPhase, assertRegistryComplete
} from "../lib/row-policy-pack.mjs";
import { ROW25_EXECUTION_IDS } from "../lib/access-v025.mjs";

test("regions are live RDS Chinese values", () => {
  assert.equal(REGIONS.A, "华东");
  assert.equal(REGIONS.B, "西南");
});

test("every ROW25 id has exactly one registry owner", () => {
  assertRegistryComplete();
  for (const id of ROW25_EXECUTION_IDS) {
    const hits = REGISTRY.filter((r) => r.executionId === id);
    assert.equal(hits.length, 1, id);
  }
});

test("phase-off includes V18 and BY-09; phase-on includes V08", () => {
  const off = new Set(idsForPhase("off"));
  const on = new Set(idsForPhase("on"));
  assert.ok(off.has("ROW25-V18"));
  assert.ok(off.has("BY-09") || [...off].some((x) => x.includes("BY09") || x === "SEC-11-BY09"));
  assert.ok(on.has("ROW25-V08"));
});
```

（BY id 在注册表中统一用 `BY-01`…`BY-19` 字符串；与 `SEC-11-BY01` 的映射写在 `REGISTRY[].catalogId` 可选字段。）

- [ ] **Step 2: 跑测确认失败**

```bash
node --test scripts/e2e/__tests__/row-policy-pack.test.mjs
```

Expected: FAIL（模块不存在或导出缺失）。

- [ ] **Step 3: 实现最小 `row-policy-pack.mjs`**

必须导出（形状锁定）：

```js
export const PACK_ID = "row-policy";
export const CONNECTION_ID = "mysql-aliyun";
export const REGIONS = Object.freeze({ A: "华东", B: "西南" });
export const TABLES = Object.freeze({
  fact: { schema: "dataforai", name: "superstore_orders", field: "Region" },
  ungranted: { schema: "dataforai", name: "superstore_returns" }
});
export const ROLES = Object.freeze({
  east: "rp_east", west: "rp_west", all: "rp_all", eastPlusInline: "rp_east_plus_inline"
});
export const AGENTS = Object.freeze({
  east: "ag_east", eastWest: "ag_east_west", all: "ag_all", eastConstrained: "ag_east_constrained"
});
/** @typedef {{ executionId: string, phase: "off"|"on"|"both", ownerFile: string, ownerSymbol: string, catalogId?: string }} RegEntry */
/** @type {readonly RegEntry[]} */
export const REGISTRY = Object.freeze([/* 填满 ROW25+RTP+RTV+BY-01..19；owner 可先占位文件名，Task 5–7 再对齐 symbol */]);
export function idsForPhase(phase) { /* phase===off|on|both 过滤 */ }
export function assertRegistryComplete() { /* 缺 id / 重复 id 抛错 */ }
```

`REGISTRY` 初版允许 `ownerSymbol: "TODO"`，但 **executionId 集合必须完整且唯一**；单测只强制集合完整。另加单测：`REGISTRY` 中不得出现字面量 `East`／`West` 作为期望区划（可扫 `expectation` 字段若有）。

- [ ] **Step 4: 再跑测确认通过**

```bash
node --test scripts/e2e/__tests__/row-policy-pack.test.mjs
```

Expected: PASS。

---

### Task 2: 审判包文件系统 — `examples/row-policy-e2e`

**Files:**
- Create: `examples/row-policy-e2e/README.md`
- Create: `examples/row-policy-e2e/project-template/ktx.yaml.template`
- Create: `examples/row-policy-e2e/project-template/webui/config/access.yaml.template`
- Create: `examples/row-policy-e2e/project-template/semantic-layer/mysql-aliyun/_schema/dataforai.yaml`
- Create: `examples/row-policy-e2e/project-template/semantic-layer/mysql-aliyun/superstore_orders.yaml`（及 returns／people 最小 overlay）
- Optional copy source: AI Workspace `98-解决方案/9-演示环境配置/lucy-mcp/07-共享开发B层/assets/semantic-layer/mysql-aliyun/`（只读拷贝进包，再按需裁剪）

- [ ] **Step 1: 写 README 边界**

`examples/row-policy-e2e/README.md` 明确：

- 数据面 RDS 只读；禁止 apply-db
- 区划 华东／西南
- 与 `examples/security-e2e` 分工
- 入口命令指向 Task 4 的 `run-row-policy-b.mjs`

- [ ] **Step 2: `ktx.yaml.template`**

单连接（禁止第二 MySQL connectionId）：

```yaml
connections:
  mysql-aliyun:
    driver: mysql
    host: "{{DB_HOST}}"
    port: {{DB_PORT}}
    database: dataforai
    username: "{{DB_READER_ROLE}}"
    password: file:{{DB_PASSWORD_FILE}}
    schemas: [dataforai]
    enabled_tables:
      - dataforai.superstore_orders
      - dataforai.superstore_returns
      - dataforai.superstore_people
setup:
  database_connection_ids: [mysql-aliyun]
```

默认占位与 prepare 注入：`DB_HOST=rm-bp1q2ui29c6268t8wro.mysql.rds.aliyuncs.com`，`DB_PORT=3306`，`DB_READER_ROLE=cw_rds_bot`，`DB_PASSWORD_FILE`→runDir secrets。

- [ ] **Step 3: `access.yaml.template`**

按设计 §3.2–3.3：

- `row_policy_templates.tpl_eq_east` → `Region eq 华东`
- `tpl_in_regions` → `in [华东, 西南]`
- 坏模板各一条（未知字段／度量／非法 op）——仅配置存在即可，供管理面／编译用例引用
- Roles：`rp_east`（template）、`rp_west`（西南内联）、`rp_all`、`rp_east_plus_inline`
- Agents：`ag_east`、`ag_east_west`（roles: [rp_east, rp_west]）、`ag_all`、`ag_east_constrained`
- Token hash 占位与 security 包相同 `{{TOKEN_HASH_*}}` 模式；**禁止** `finance_east_west` 单 Role 双 selector

- [ ] **Step 4: 语义层最小可用**

`superstore_orders.yaml` 至少含：`Region` 维度、一个可聚合 measure（如 `sum(sales)`→`total_sales`），grain 与现网一致。可用 Workspace B 层 overlay 为底。

- [ ] **Step 5: 静态检查**

```bash
rg -n "East|West|marketing_daily|fin-db|apply-db|seed\\.sql" examples/row-policy-e2e
```

Expected: 无业务谓词命中 East／West／marketing_daily／fin-db；允许 README 里「废除 East／West」的说明句（若命中说明句，改用「英文区划旧字面量」表述避免误伤）。

---

### Task 3: `prepare-environment --pack row-policy`

**Files:**
- Modify: `scripts/e2e/prepare-environment.mjs`
- Modify or Create: 解析 `--pack` 的 CLI 段（同文件顶部）
- Test: `scripts/e2e/__tests__/row-policy-pack.test.mjs` 增补「pack 根路径解析」纯函数（若把 `resolveFixtureRoot(pack)` 抽到 `row-policy-pack.mjs`）

- [ ] **Step 1: 抽出 fixture 根解析**

在 `row-policy-pack.mjs`：

```js
import path from "node:path";
import { fileURLToPath } from "node:url";
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export function resolveFixtureRoot(pack = "security") {
  if (pack === "row-policy" || pack === PACK_ID) {
    return path.join(REPO_ROOT, "examples", "row-policy-e2e");
  }
  return path.join(REPO_ROOT, "examples", "security-e2e");
}
```

单测：`resolveFixtureRoot("row-policy")` 以 `row-policy-e2e` 结尾。

- [ ] **Step 2: prepare 接受 `--pack`**

将硬编码 `FIXTURE_ROOT = ...security-e2e` 改为：

```js
const pack = options.pack ?? "security";
const FIXTURE_ROOT = resolveFixtureRoot(pack);
```

CLI：`--pack <name>`。

- [ ] **Step 3: row-policy 包的 DB 合同**

当 `pack === "row-policy"`：

- **不要** 设置 `applyDb: true` 默认；若用户传 `--apply-db` → **抛 PrepareError**（文案：row-policy pack is RDS read-only）。
- `dbHost`／`dbPort`／`dbReaderRole` 默认指向 RDS（可用 env `LUCY_ROW_POLICY_DB_HOST` 覆盖）。
- 将仓库 `.ktx/secrets/mysql-aliyun-password` **复制**到 `runDir/checker/secrets/`（mode 0600），模板 `DB_PASSWORD_FILE` 指该副本；禁止打印内容。

- [ ] **Step 4: 干跑 prepare（不启动完整 Lucy 亦可先只渲染）**

按仓库现有 prepare 用法加 `--pack row-policy`（保留现有必填 flag）。渲染后检查：

```bash
rg -n "mysql-aliyun|华东|rp_east" "<runDir>/project"
test -f "<runDir>/checker/secrets/mysql-aliyun-password"
```

Expected: 命中；密码文件存在且 `stat` 非世界可读。

---

### Task 4: 两阶段入口 — `run-row-policy-b.mjs`

**Files:**
- Create: `scripts/e2e/run-row-policy-b.mjs`
- Create: `scripts/e2e/lib/row-policy-phase.mjs`（切换 proven 开关的最小 API）
- Test: `scripts/e2e/__tests__/row-policy-phase.test.mjs`（纯函数：汇总判定）

- [ ] **Step 1: 汇总器单测**

```js
import assert from "node:assert/strict";
import test from "node:test";
import { summarizeBRun } from "../lib/row-policy-phase.mjs";

test("B pass requires both phases green and no blocking blocked", () => {
  const r = summarizeBRun({
    phaseOff: { failed: 0, blockedBlocking: 0 },
    phaseOn: { failed: 0, blockedBlocking: 0 },
    registryMissing: []
  });
  assert.equal(r.passed, true);
});

test("blockedBlocking prevents B pass", () => {
  const r = summarizeBRun({
    phaseOff: { failed: 0, blockedBlocking: 1 },
    phaseOn: { failed: 0, blockedBlocking: 0 },
    registryMissing: []
  });
  assert.equal(r.passed, false);
});
```

- [ ] **Step 2: 实现 `summarizeBRun` + `setForcedPredicateProven(runDir, enabled)`**

`setForcedPredicateProven`：优先写 run 实例 env／重启约定（查现网 Lucy 是否支持运行时 env；若只认进程环境变量，则文档化「同 volume 重启」并在 runner 内调用现有 instance stop/start 辅助）。**禁止**在客户签署配置里持久化 `=1`。

- [ ] **Step 3: `run-row-policy-b.mjs` 编排**

伪流程（实现时接真实 prepare／playwright／security runner 调用）：

1. `prepare-environment ... --pack row-policy`（无 `--apply-db`）
2. 启动实例（复用现有 management／security 启动路径）
3. Phase off：proven=0 → 跑注册表 `phase=off|both` 的 Playwright grep／security BY 子集 → 写 `evidence/phase-off/`
4. Phase on：proven=1 → 跑 `phase=on|both` → `evidence/phase-on/`
5. `summarizeBRun`；`passed` 则 exit 0，否则 exit 1；打印每 id 结果表

- [ ] **Step 4: 包 JSON 脚本（可选）**

根 `package.json` 增加：`"e2e:row-policy-b": "node scripts/e2e/run-row-policy-b.mjs"`（若根目录已有 e2e 脚本区则放一起）。

---

### Task 5: 重写 `row-policy-v025.spec.ts`

**Files:**
- Modify: `webui/tests/real-e2e/row-policy-v025.spec.ts`
- Modify: `scripts/e2e/lib/row-policy-pack.mjs`（把 ROW25 的 `ownerSymbol` 改成真实 test title／函数名）

- [ ] **Step 1: 删除假 covers**

去掉将 V04／V05／V09／V10 挂在「未授权表／East vs all」上的 `coversV025`。每个 `test(...)` 只 `coversV025` 本测真正 `assertion` 的 id。

- [ ] **Step 2: 查询形状改绑 RDS**

```ts
const FACT = { connection: "mysql-aliyun", schema: "dataforai", name: "superstore_orders" };
const REGION_QUERY = {
  connectionId: "mysql-aliyun",
  source: "dataforai.superstore_orders",
  measures: ["total_sales"], // 与 overlay 一致
  dimensions: [{ field: "superstore_orders.Region" }] // 若现网限定名不同，以 lucy_query 报错为准再改
};
```

区划断言用 `华东`／`西南`。

- [ ] **Step 3: 按注册表补测（最少）**

| id | 断言要点 |
|----|----------|
| V08／V12 | 预览 `rp_east`+`rp_west` 或 Agent `ag_east_west` → OR-of-AND；MCP 见华东∪西南 |
| V09 | Role 并集含 `rp_all` → 预览「全部行」；运行时可见非华东非西南区划 |
| V10 | `ag_east_constrained` 交集 |
| V11 | 不可满足 → 拒绝／预览不可满足 |
| V04／V05 | **独立**测：缺模板／未知字段编译失败原因码 |
| V18 | 仅 phase-off：scoped → `row_policy_upstream_unproven` |

其余 ROW25 id：本文件或同目录拆出的 `row-policy-v025-*.spec.ts` 补齐；每个必须进 `REGISTRY`。

- [ ] **Step 4: 本地有 run 时点跑**

```bash
cd webui && LUCY_REAL_E2E_RUN=<runDir>/run.json \
  npx playwright test --config playwright.real.config.ts tests/real-e2e/row-policy-v025.spec.ts
```

无实例时不要把 skip 写成通过。

---

### Task 6: 重写 `row-policy-templates-v025.spec.ts`

**Files:**
- Modify: `webui/tests/real-e2e/row-policy-templates-v025.spec.ts`

- [ ] **Step 1: 禁止一次 covers 全部 RTP／RTV**

改为每条 test 一个或少数 id；或注册表驱动循环但 **循环体内按 id 分别 assertion**，且失败信息带 id。

- [ ] **Step 2: 表键对账用 `superstore_orders`**

反查 API 与 access-map 的规范键必须含 `mysql-aliyun`／`dataforai`／`superstore_orders`。

- [ ] **Step 3: 模板 dry-run／保存（真实 API）**

覆盖 RTP 写路径所需的最小浏览器或 `page.request` 序列；失败关闭与 digest 变化按 Spec §8。仍禁止 `page.route` mock。

---

### Task 7: 改绑 Security BY

**Files:**
- Modify: `scripts/e2e/security/row-policy-cases.mjs`
- Modify: `scripts/e2e/security/context.mjs`（若 Token／表常量集中在此）

- [ ] **Step 1: 常量改绑**

将 BY 正例／拒例中的 `fin-db`／`marketing_daily`／`region=East` 改为包常量（从 `row-policy-pack.mjs` import），Agent 默认 `ag_east`／`ag_east_west`。

- [ ] **Step 2: BY-09 固定在 phase-off**

断言原因 `row_policy_upstream_unproven`；phase-on 不得用同一用例冒充通过。

- [ ] **Step 3: BY-01／BY-10 在 phase-on**

BY-01：华东可查；BY-10：华东∪西南。typed_gold 若仍绑旧 Q-CAC-EAST，改为「Region 集合断言」或只读算出的新 gold key（Task 8）。

- [ ] **Step 4: 跑 security 子集（有实例时）**

用现有 `run-security.mjs` 过滤 SEC-11／BY，或由 `run-row-policy-b` 调用 handlers。

---

### Task 8: 只读 gold 辅助（最小）

**Files:**
- Create: `examples/row-policy-e2e/gold/compute-readonly-gold.mjs`
- Create: `scripts/e2e/__tests__/row-policy-readonly-gold.test.mjs`

- [ ] **Step 1: 生成器**

输入：RDS 连接参数（密码文件路径）。输出：`gold.json`（0600）含：

```json
{
  "regions": { "华东": <count>, "西南": <count>, ... },
  "assertShape": { "eastOnly": ["华东"], "union": ["华东", "西南"] }
}
```

只跑 `SELECT Region, COUNT(*) ... GROUP BY Region`；无 INSERT。

- [ ] **Step 2: 无网单测**

对固定假 rows 输入测 `buildGoldFromCounts(counts)` 纯函数（把查询与纯计算拆开），不要求 CI 连 RDS。

---

### Task 9: 本机实跑验收清单

**Files:**
- Create: `inbox/row-policy-b-run-notes.md`（过程笔记；可删）

- [ ] **Step 1: 预检 RDS**

```bash
docker run --rm mysql:8 mysql -h rm-bp1q2ui29c6268t8wro.mysql.rds.aliyuncs.com -P 3306 \
  -u cw_rds_bot -p"$(cat .ktx/secrets/mysql-aliyun-password)" --default-character-set=utf8mb4 \
  -e "SELECT Region, COUNT(*) c FROM dataforai.superstore_orders GROUP BY Region"
```

Expected: 含 华东／西南。

- [ ] **Step 2: 跑 `npm run e2e:row-policy-b`（或 node 入口）**

- [ ] **Step 3: 核对报告**

- 每 id 有结果；无「文件级 passed」冒充
- phase-off／phase-on 目录都有证据
- V15／V19／V22 若 blocked → 总判定 **不得** 写「强度 B 通过」
- 密码未出现在 evidence 文本（`rg` 密码文件内容于 evidence → 0 命中）

---

## Spec coverage check

| Design section | Task |
|----------------|------|
| §1 通过线／禁假 covers | 1, 5, 6, 9 |
| §2 审判包＋prepare＋run-b | 2, 3, 4 |
| §3 RDS 只读／华东西南／多 Role 并集 | 2, 5, 7, 8 |
| §4 两阶段 | 4, 5, 7, 9 |
| §5 V15／V19／V22 挡 B | 1（registry phase）、9 |
| §6 注册表守恒／no mock | 1, 5, 6 |

## Placeholder scan

本 plan 无 TBD；`ownerSymbol: "TODO"` 仅允许存在于 Task 1 初版，Task 5–7 必须清零（可加单测：`REGISTRY.every(r => r.ownerSymbol !== "TODO")` 作为 Task 7 收尾门禁）。
