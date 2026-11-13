# 访问关系图空桑基修复 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. **未获委托人「开发授权」前禁止改运行代码。**

| 元数据 | 内容 |
|---|---|
| 文档版本 / 日期 | **v0.2** / 2026-11-13 |
| 优先级 | **P0**（部署侧主视觉失效） |
| 状态 | **D1–D4 按推荐已拍板；委托人批准推进修复（2026-11-13）；开发授权已获得**。Spec 见 [`lucy-20261113-access-map-sankey-empty-fix-spec.md`](../specs/lucy-20261113-access-map-sankey-empty-fix-spec.md) |
| 错题本 | [`docs/lessons/2026-11-13-access-map-sankey-empty.md`](../lessons/2026-11-13-access-map-sankey-empty.md) |
| 相关合同 | confirmed-only [`lucy-20261105-access-map-confirmed-only-spec.md`](../specs/lucy-20261105-access-map-confirmed-only-spec.md)；usage-first [`lucy-20261105-access-map-usage-first-spec.md`](../specs/lucy-20261105-access-map-usage-first-spec.md)；关联质量 [`lucy-20261019-audit-trust-and-admin-investigation-spec.md`](../specs/lucy-20261019-audit-trust-and-admin-investigation-spec.md) §4.1 |
| 证据提交 | `556fdc30`、`80ff5bca`；本机／云端 API `accessPaths=0` 同构 |

**Goal:** 部署打开「访问关系图」时，主视觉再次可读：有真实查数则画出使用流带；无使用但有授权时仍能读出因果链（不是一排孤立细柱）。不偷偷放宽「已确认关联」口径去凑数。

**Architecture:** 双轨修复——（A）让**本应进 confirmed 的触表调用**真正落到 `association_status=confirmed`，恢复 usage-first 主线；（B）修订 usage-first **空访问空态**：有授权无访问时画「闲置骨干」而不是只留 stub。另加组合门禁，防止再绿夹具、空部署。

**Tech Stack:** 既有 `access-map` 服务端／`AccessMapCanvas`；audit 写入／关联晋升；Vitest；本机 demo 冒烟。

## Global Constraints

- **登记／本 Plan ≠ 开发授权**；改运行代码须委托人另发授权。
- **不默默废止 confirmed-only**：访问面仍只计已确认关联（除非 D1 明确改合同）。
- **不回到「授权胖子柱排行榜」**：有使用时厚度仍＝`accessPaths`（usage-first S1–S2）。
- 本地脚本兼容 stock macOS bash 3.2；不擅自 `docker buildx create --use`。
- 术语遵守 `webui/docs/00-product-terminology-standard.md`；产品名仍是「访问关系图」。
- 0.30：若修订已收口 Spec，须走合同变更 + 终稿确权后再落地。

---

## 0. 问题摘要（给零上下文执行者）

| 层 | 事实 |
|---|---|
| 症状 | `/admin/access-map` 几乎无流带；KPI「有问询 0」；仅 idle stub |
| 数据 | 本机 audit：大量带 `access_log_sources` 的 `lucy_query` 为 `null`／`candidate`；`confirmed` 极少且多为无表源的 `lucy_begin_question` |
| 合同 A | confirmed-only：SQL 硬锁 `association_status='confirmed'` |
| 合同 B | usage-first：只对 `accessPaths>0` 画流带；闲置不撑柱、表不进列 |
| 叠加结果 | A 把访问面滤空 → B 画不出桑基 → 部署观感＝失效 |

信任 Spec §4.1：**confirmed 仅来自合法显式关联或 begin 自身**；自动归属只形成 candidate，**不得混入已确认调用数**。因此正确修法是：让「显式问询下的触表工具调用」按合同写成 confirmed（若今天没写成，是实现缺口）；**不是**把 candidate 塞进桑基分母。

---

## 1. 产品决策（开工前置；须委托人拍板）

| ID | 议题 | **推荐** | 备选 | 影响 |
|---|---|---|---|---|
| **D1** | 访问面是否继续硬锁 confirmed | **保持硬锁** | 临时允许 candidate（须废止／修订 confirmed-only） | 推荐避免推翻信任计量 |
| **D2** | `accessPaths=0` 且 `grantPaths>0` 时图怎么画 | **闲置骨干**：列间画细、中性、不参与 usage 刻度的连通带（或等价可读骨架）；表仍不进列，清单／stub 保留 | 仅加强文案、仍无连通带 | 须**修订 usage-first** 空态条款 |
| **D3** | 显式 turn 下触表调用的 `association_status` | **与 begin／显式校验成功同属 confirmed**（对齐信任 Spec「合法显式关联」） | 仅 begin 行 confirmed、工具行永 candidate → 则桑基永远无表路径，必须改 D1 | 可能改 audit 写入／晋升，不改历史静默升级规则 |
| **D4** | 默认筛（管理相关 + 排除连接） | **本条不改默认**；空态文案保持；修复后用「全部」与真实问询验收 | 顺手改默认到 real | 降范围，避免夹带 |

**决策闭合前禁止改代码。** 闭合后：先写／修订 Spec（建议新条或 usage-first／audit 补丁 Spec），再开发授权。

---

## 2. 目标验收（决策闭合后写入 Spec SC）

| ID | 验收叙事 |
|---|---|
| V1 | 本机 demo：窗口内存在「显式问询 + 触表工具调用」且按 D3 为 confirmed 时，`inquiryKind=all&accessGrade=all` 下 `counts.accessPaths > 0`，SVG 出现使用流带 |
| V2 | 人为／夹具「有授权、零 confirmed 触表」时，图仍有 **列间连通**（D2），不得只剩孤立柱；不得用授权量重新撑高 usage 刻度 |
| V3 | confirmed-only：非法 `trust` 仍 400；成功响应 `meta.access.trust==="confirmed"` |
| V4 | 回归：夹具模拟「库内大量 candidate 触表 + 极少 confirmed」时，若 D3 未满足则测试失败（禁止只靠全 confirmed 夹具绿） |
| V5 | 错题本该条状态 → `mitigated`／`closed`，并回写后续动作 |

---

## 3. 文件落点（预期）

| 路径 | 职责 |
|---|---|
| `docs/specs/lucy-20261113-access-map-sankey-empty-fix-spec.md`（建议新建）或修订 usage-first／audit-trust 补丁 | 空态＋关联写入合同 |
| `webui/server/proxy/audit.ts`（及相关归因写入点） | D3：显式校验成功时触表行写 confirmed |
| `webui/server/admin/access-map.ts` / `access-map-echo.ts` | 保持 confirmed 谓词；必要时 meta 披露「为何访问为 0」 |
| `webui/src/components/admin/AccessMapCanvas.tsx` | D2：闲置骨干几何 |
| `webui/src/pages/admin/AccessMap.tsx` / Legend | 空态文案与图例（若 D2 新增图例项） |
| `webui/server/__tests__/p1-access-map*.test.ts`、`access-map*.test.tsx`、audit 关联测试 | V1–V4 |
| `docs/lessons/2026-11-13-access-map-sankey-empty.md` | 回写状态 |

---

## 4. 阶段与任务

### Task 0: 决策闭合与 Spec

**Files:**
- Create: `docs/specs/lucy-20261113-access-map-sankey-empty-fix-spec.md`（或委托人指定改既有 Spec）
- Modify: 本 Plan 头部状态；错题本「后续动作」

- [ ] **Step 0.1:** 委托人确认 D1–D4（可回复「D1–D4 按推荐」）
- [ ] **Step 0.2:** 撰写 Spec：空态几何、关联写入、SC 矩阵、明确「不表示可上线」
- [ ] **Step 0.3:** 终稿确权 + **开发授权** 后才进入 Task 1

### Task 1: 归因探针（只读取证，可先于授权做只读）

**Files:**
- 只读：demo `/data/lucy/.ktx-ui/audit.sqlite`；`webui/server/proxy/audit.ts` 写入路径

- [ ] **Step 1.1:** 统计窗口内 `lucy_query`／`lucy_read_source` 的 `turn_attribution_mode`、`explicit_turn_validated`、`association_status`、是否有 sources
- [ ] **Step 1.2:** 对照一次「lucy_begin_question → lucy_query」会话：begin 为 confirmed 时，同 turn 触表行实际写入值
- [ ] **Step 1.3:** 把结论写进 Spec「现状」与错题本 §3（实现缺口 vs 合同本意）

**Produces:** 一份短取证笔记（可落 `inbox/` 后链到错题本）；判定 D3 是 bugfix 还是合同补洞。

### Task 2: D3 关联写入修复（TDD）

**Files:**
- Modify: `webui/server/proxy/audit.ts`（及实际设置 `associationStatus` 的入口）
- Test: 既有 `webui/server/__tests__/audit-trust/*.test.ts` 或新增聚焦用例

**Interfaces:**
- Consumes: 信任 Spec — 合法显式关联 → confirmed
- Produces: 新写入的触表 `access_log` 行在显式校验成功时 `association_status === "confirmed"`；**不**把 `session_bound`／inferred 升成 confirmed

- [ ] **Step 2.1:** 写失败测试：显式 turn 已校验 + 同 turn 的 `lucy_query` 带 sources → 期望 `association_status=confirmed`
- [ ] **Step 2.2:** 跑测确认红
- [ ] **Step 2.3:** 最小修复写入路径（禁止历史 backfill 静默升级；只修新写入／合同允许的投影）
- [ ] **Step 2.4:** 跑测绿；补「candidate 仍不得进 access-map E」断言
- [ ] **Step 2.5:** Commit（获授权后）

### Task 3: D2 空访问闲置骨干（TDD）

**Files:**
- Modify: `webui/src/components/admin/AccessMapCanvas.tsx`（`layoutAccessMap`／band 构建）
- Modify: `AccessMapLegend.tsx`（若新增图例项）
- Test: `webui/src/__tests__/access-map-usage-first.test.tsx`、`access-map-layout.test.tsx`

**Interfaces:**
- Consumes: `grantPaths>0 && accessPaths===0` 边；usage 边仍仅 `accessPaths>0`
- Produces: 空访问时 SVG 存在列间连通 path（骨干）；`unitPx`／柱高仍只由 usage 决定；闲置表仍不进列

- [ ] **Step 3.1:** 写失败测试：仅 dormant 授权边 → 布局含骨干 link（厚度常量或独立于 grant 排行），且无 usage 刻度被 grant 撑高
- [ ] **Step 3.2:** 跑测确认红
- [ ] **Step 3.3:** 实现骨干带（与 stub／清单共存；着色中性；不冒充 usage）
- [ ] **Step 3.4:** 跑 usage-first 既有 SC 相关测，确保有使用时行为不变
- [ ] **Step 3.5:** Commit（获授权后）

### Task 4: 组合门禁与部署冒烟

**Files:**
- Test: `webui/server/__tests__/p1-access-map*.test.ts` 新增「稀疏 confirmed」夹具
- Optional: 文档化本机冒烟步骤（不强制 Playwright，除非另授）

- [ ] **Step 4.1:** 夹具：N 条 candidate 触表 + 0／少条 confirmed → 在 D3 修复后，仅 confirmed 进 E；图在 0 confirmed 时走 D2 骨干
- [ ] **Step 4.2:** 本机 `demo`：`GET /api/admin/access-map?window=168h&inquiryKind=all&accessGrade=all` 记录 `accessPaths`；有真实显式查数后应 >0
- [ ] **Step 4.3:** 打开 WebUI 目视：有使用见粗流带；无使用见骨干连通（截图可落 `inbox/`）
- [ ] **Step 4.4:** 更新错题本状态与本 Plan 状态行

### Task 5: 文档镜像

- [ ] **Step 5.1:** `docs/README.md`／清单池（若升 REQ）按 `DEVELOPMENT.md` 状态登记改镜像
- [ ] **Step 5.2:** 不宣称可上线；客户环境另走发布取证

---

## 5. 风险

| 风险 | 缓解 |
|---|---|
| 为凑数重开 include_candidate | D1 锁死；测试锁定 trust 400 |
| 骨干带又变成授权排行榜 | 骨干厚度封顶常量；禁止 `grantPaths×unitPx` 进 usage 刻度 |
| 历史行大量 null 无法回填 confirmed | 信任 Spec 禁止静默升级；只修新写入；旧数据靠骨干空态可读 |
| 只修前端不修归因 | V1 在真实 demo 仍可能 0；两轨都要做 |
| 0.30 未授权开工 | Task 0 门闩 |

---

## 6. 建议实施顺序

```text
D1–D4 拍板 → Spec → 开发授权
    → Task 1 取证（可与 Spec 并行只读）
    → Task 2 归因（恢复有数时的流带）
    → Task 3 空态骨干（无数时仍可读）
    → Task 4 门禁 + demo 冒烟
    → Task 5 文档／错题本闭口
```

**止血优先级：** 若只能先做一轨——**先 Task 3（空态可读）** 立刻改善「图坏了」观感；**Task 2** 才能恢复真实使用故事。推荐两轨都做。

---

## 7. Self-review

| 检查 | 结果 |
|---|---|
| 错题本两层根因是否都有任务 | 是：Task 2＝confirmed 数据面；Task 3＝usage-first 空态 |
| 是否偷偷改 confirmed-only | 否：D1 推荐保持；改则显式决策 |
| 占位符 | 无 TBD 实现步骤；决策表待拍板属前置 |
| 与 0.30 治理 | 标明未授权；先 Spec |

---

## 8. 执行前请委托人回复

请直接拍板，例如：

> **D1–D4 按推荐；先写 Spec，确认后再给开发授权。**

或逐条改 D2／D3。拍板后本 Plan 升版并开 Spec；**在此之前不改运行代码。**
