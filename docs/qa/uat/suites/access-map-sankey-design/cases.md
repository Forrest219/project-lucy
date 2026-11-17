# Cases — UAT-SUITE-ACCESS-MAP-SANKEY

| ID | 标题 | profile | 层级 | 自动化指针 | 期望摘要 | 关联 SC |
|---|---|---|---|---|---|---|
| UAT-SANKEY-R0 | 沙箱与种子数据门禁 | 全部 | 脚本＋API | `webui/scripts/uat-access-map-sankey-sandbox.mts`（`SANKEY_EMIT=1`） | 沙箱起得来；`/api/admin/access-map` 数字等于 [fixtures 期望值](fixtures.md#期望值) | SC-A7 |
| UAT-SANKEY-01 | 使用桑基可读 | `rich` | 浏览器＋API | `webui/src/__tests__/access-map-usage-first.test.tsx` | 四列；使用流带 ≥ 20 条、柱高 > 0；四态齐全；`deniedCalls=2` 不进访问路径 | SC-A7 |
| UAT-SANKEY-02 | 零访问仍是桑基 | `grants-only` | 浏览器 | `webui/src/__tests__/access-map-sankey-restoration.test.tsx` | 表列存在；每个连接有可见带；不是文字或发丝线 | SC-B1 |
| UAT-SANKEY-03 | 宽授权不淹没使用、也不消失 | `sparse` | 浏览器 | `webui/src/__tests__/access-map.test.tsx` | 使用带可读；闲置授权以聚合节点＋幽灵带可见；图例四项 | SC-B2–B6 |
| UAT-SANKEY-04 | 未确认关联被披露 | `candidate-only` | 浏览器＋API | `webui/server/__tests__/p1-access-map-unconfirmed-calls.test.ts` | `unconfirmedCalls=175`；页面说明含 175；`include_candidate`＝400 | SC-A5、A6 |
| UAT-SANKEY-05 | 多 Agent 不塌缩 | `dense` | 浏览器＋DOM | `webui/server/__tests__/p1-access-map-column-cap.test.ts` | 每条使用带厚度 ≥ 2px；无零高使用柱；列内节点 ≤ 25；容器可纵向滚动 | SC-A2–A4 |
| UAT-SANKEY-06 | 旧码对照基线 | `rich` | 沙箱 A/B | 无（沙箱 A/B，见 fixtures） | 旧码 `rawCalls=0`、`deniedCalls=175`；HEAD 为 173／2 | SC-A1、A7 |
| UAT-SANKEY-07 | 线上实例验收 | 真实数据 | 浏览器＋health | 无（线上手工） | `gitSha` 含 `f3f88837`、`e2ca2ca7`；上列不变量在真实数据上成立 | SC-A1 |

---

## UAT-SANKEY-R0 — 沙箱与种子数据门禁

### 步骤

1. 按 [fixtures](fixtures.md) 构建前端并启动目标 profile 沙箱
2. `GET /api/admin/access-map?window=168h&inquiryKind=all&accessGrade=all`
3. 与期望值表逐项比对 `counts.grantPaths`、`counts.accessPaths`、`access.rawCalls`、`access.deniedCalls`

### 期望

全部相等。**不相等先修种子或环境，不得继续判后续用例。**

---

## UAT-SANKEY-01 — 使用桑基可读（`rich`）

### 步骤

1. 打开 `/admin/access-map?window=168h&inquiryKind=all&accessGrade=all`
2. DOM：数 `access-map-ribbon-e*`、`access-map-node-*`；读最小柱高
3. 看图例与四态：虚线中线（需复核）、实线轮廓（越出授权）

### 期望

- 使用流带 ≥ 20；每个使用节点柱高 > 0（纯闲置节点柱高为 0，不算使用节点）
- 边状态含 normal、dormant、needs_review、overflow（来自 API）
- 页面「进入允许调用」为 173

---

## UAT-SANKEY-02 — 零访问仍是桑基（`grants-only`）

### 步骤

1. 打开同一 URL（`grants-only` 沙箱）
2. 目视与 DOM：是否有第 4 列；每个连接是否有可见带

### 期望（D0＝C）

- 表列存在，恰 4 个聚合节点
- 每个连接至少一条厚度 6–40px 的幽灵带
- 不是仅文字，也不是 3px 发丝线

**基线（改前）**：3 列发丝线、无表列 → FAIL。

---

## UAT-SANKEY-03 — 宽授权（`sparse`，D0＝C 时必做）

### 步骤

1. 打开同一 URL（`sparse` 沙箱），聚焦何老师（`agent=hehe`）
2. 读聚合节点文案；点击聚合节点；点清单一行

### 期望

- 聚合节点文案含 119／10／8／4
- 清单行数等于该节点的 k；点行打开正确边抽屉
- 图例四项，无「流带宽度 = 授权路径数」

**基线（改前）**：无聚合节点，授权只剩发丝 → FAIL（对 D0＝C 的验收线）。

---

## UAT-SANKEY-04 — 未确认关联被披露（`candidate-only`）

### 步骤

1. API：`access.unconfirmedCalls`；`trust=include_candidate`
2. 页面空态说明

### 期望

- `unconfirmedCalls=175`；`include_candidate` 返回 400；`trust` 仍为 `confirmed`
- 说明含 175，不再写「可调整筛选后再看」

**基线（改前）**：API 无该字段；说明把原因归给筛选 → FAIL。

---

## UAT-SANKEY-05 — 多 Agent 不塌缩（`dense`）

### 步骤

1. 打开同一 URL（`dense` 沙箱，42 个 Agent）
2. CDP：`rect[height=0]` 计数；使用流带 `path` 包围盒厚度；各列 `access-map-node-*` 数；容器 `scrollHeight` 对 `clientHeight`

### 期望

- 无使用节点柱高为 0
- 每条使用带厚度 ≥ 2px
- 每列可见使用节点 ≤ 25（24＋「其他」）；闲置授权聚合节点另计，每父节点至多 1 个
- 超出容器高度时可纵向滚动

**基线（改前）**：`rect height="0"`、带厚度≈0、SVG 高 1350 → FAIL。

---

## UAT-SANKEY-06 — 旧码对照基线

### 步骤

1. 用 `git archive 6d2664b3` 构建旧码沙箱，加载同一 `rich` 种子
2. 取 API 数字与截图

### 期望

旧码：`rawCalls=0`、`deniedCalls=175`、156 条边全 `dormant`、页面只有文字标签。HEAD：173／2。用于证明线上镜像缺修复。

---

## UAT-SANKEY-07 — 线上实例验收

### 前置

凭据文件路径由委托人提供（只写路径，不写密码）；升级已获授权。**无凭据或未升级：写 `BLOCKED`，不得用沙箱结果替代。**

### 步骤

1. `GET /api/health` → `gitSha`；用 `git merge-base --is-ancestor` 判定含 `f3f88837`、`e2ca2ca7`
2. 登录后打开 `/admin/access-map`，对真实数据重复 01、02、05 的不变量；记录活跃 Agent 数与 `unconfirmedCalls`

### 期望

health 含两提交；桑基不变量成立。
