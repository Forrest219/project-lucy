# 访问关系图与访问日志口径对齐 Plan

| 元数据 | 内容 |
|---|---|
| 文档版本 / 日期 | **v0.4** / 2026-11-04 |
| 目标版本 / 优先级 | 不绑定产品版本号 / **P1**。功能编号无，不进入 v0.25 登记册 |
| 主 Spec | [`docs/specs/lucy-20261102-access-map-audit-echo-spec.md`](../specs/lucy-20261102-access-map-audit-echo-spec.md)（**v0.3 可定稿**；实施按该版） |
| 权威语义 | Spec 187 路径／信任；inquiry-kind Spec；Spec 194／`usage-classification`；chart-first 弱入口 |
| 状态 | **v0.3 功能合同已收口（2026-11-04）**。S1–S3 已落地；SC-01–SC-20 关闭；证据见 [实施笔记](../reviews/2026-11-04-access-map-audit-echo-implementation-notes.md)。本条收口不表示可上线。原 Deferred → `REQ-030-003` 已拉出并实施完成 |
| 授权边界 | **已授权**改 `webui/server`／`webui/src` 运行代码与本条文档指针。**不授权** git commit（除非用户另行要求）、镜像、部署、浏览器走查、Playwright、客户环境 |
| 验收 | 以主 Spec §7 SC-01–SC-20 为准 |
| 实施主体 | Lucy：`webui/server/admin/access-map.ts`、`webui/src/pages/admin/AccessMap.tsx`、相关组件与测试 |
| 待拍板 | D1–D13 以主 Spec §4 为准（已冻结） |
| 审阅 | [`docs/reviews/2026-11-02-codex-review-access-map-audit-echo.md`](../reviews/2026-11-02-codex-review-access-map-audit-echo.md) |
| 变更 | v0.4（2026-11-04）：用户批准「先口径对齐、再打假集合 E」推进；P2 满足；补可执行任务拆分与复用边界。v0.3：Deferred 入池 |

> **For agentic workers:** 按 Task 顺序 TDD 实施；每 Task 结束跑该 Task 所列命令。不要 git commit，除非用户明确要求。

**Goal:** 访问关系图与访问日志共用问询种类／访问等级，关联口径降为弱入口；投影集合 E 可与预写期望 id 集逐项对账。

**Architecture:** 在 Spec 187 既有时间窗／trust／Token 上相与 inquiryKind／accessGrade；关联链路复用审计 D6 序；路径只吃 E；meta 暴露结构筛选前 `|E|`。UI 主工具条换两下拉，trust 移入「口径与快照」。

**Tech Stack:** Fastify + better-sqlite3 审计库；React + vitest；复用 `audit-inquiry-kind.ts`、`usage-classification.ts` 的 `accessGrade`／`accessGradeSql`。

## Global Constraints

- 非法 `inquiryKind`／`accessGrade` → **400**（与审计非法回落缺省不同；缺省仅当参数未出现）
- 禁止第二份种类／等级枚举；禁止「问询计入」主控件文案
- 禁止声称路径数＝问询行数或＝流水行数；对齐对象是集合 E 与边 `accessCalls`
- 不改授权骨架、geometry、凭证清单 Default Usage、KTX
- 本条收口不表示可上线

---

## 1. 目标

1. 主工具条：问询种类、访问等级；缺省与访问日志一致（参数缺省时）。
2. 「问询计入」→ 弱入口「关联口径」；筛选行对齐。
3. 投影集合 E 与跨边并集可打假；非法新参数 400。

## 2. 开工前置

| ID | 条件 | 状态 |
|---|---|---|
| P1 | 主 Spec 经 Codex 两轮后定稿 | **满足**（v0.3） |
| P2 | 用户明确授权改 access-map 服务端与页面 | **满足**（2026-11-04） |
| P3 | 基线可跑：`p1-access-map.test.ts`、`access-map.test.tsx`、`access-map-layout.test.tsx` | **满足**（2026-11-04 复跑 194/194 绿，含审计相关） |

## 3. 文件落点

### 3.1 预计修改

| 路径 | 改动 | 阶段 |
|---|---|---|
| `webui/server/admin/access-map-echo.ts`（新建） | 严格解析 inquiryKind／accessGrade；D6 `resolveTurn`；`buildBandED`；复用 `inquiryKindOfTurn`／`inquiryKindMatches`／`accessGrade`；触发与审计相同的推断重建准备 | S1 |
| `webui/server/admin/access-map.ts` | `AccessMapQuery` 增字段；`parseAccessMapQuery` 严格校验；`loadAccessSide` 入参扩 filter；构图用 E；`deniedCalls=\|D\|`；`meta.echo.enteringAllowCallCount=\|E\|`（结构筛选前） | S1 |
| `webui/server/admin/routes/access-map.ts` | 保持非法 400 | S1 |
| `webui/server/__tests__/p1-access-map.test.ts` | SC-03（服务端）、SC-09–SC-16、SC-19 | S1 |
| `webui/src/pages/admin/AccessMap.tsx` | 工具条下拉；弱入口关联口径；空态文案 | S2 |
| `webui/src/components/admin/AccessMapLegend.tsx` | 「关联口径」 | S2 |
| `webui/src/components/admin/AccessMapTypes.tsx` | 类型／meta.echo | S2（随响应） |
| `webui/src/__tests__/access-map.test.tsx` | SC-01–SC-09（组件）、SC-17–SC-18 | S2 |
| `webui/docs/187-access-relation-sankey-spec.md` | §4.2／§5.2／§6.3／§7.4 指针 | S3 |
| `docs/specs/lucy-20261101-access-map-chart-first-spec.md` | 工具条／弱入口指针 | S3 |
| `webui/docs/00-product-terminology-standard.md` | 退役「问询计入」产品句（若有） | S3 |
| `docs/README.md`／`docs/plans/README.md`／需求池 | 状态镜像 | S3（授权态本轮已先改） |

### 3.2 不改

- `usage-classification.ts` 名单
- `audit-inquiry-kind.ts` 判定逻辑（只复用；**不**把审计的非法回落解析用于 access-map URL）
- 授权构图与 geometry
- 凭证清单 Default Usage
- KTX

### 3.3 复用注意

- 审计 `parseInquiryKindFilter`／`parseAccessGradeFilter` 对非法值回落缺省 → **access-map 不可直接用于 URL 校验**。新建严格解析：合法集合命中才 ok，否则交 `parseAccessMapQuery` 返回 400；参数缺席才用 management／exclude_connect。
- `accessGrade` 过滤语义对齐 `audit.ts`：`exclude_connect` ⇒ grade ≠ connect；单等级精确匹配；`all` 不过滤。

---

## 4. 可执行任务

### Task 1 — S1a：严格 URL 解析（SC-03 缺省、SC-19 非法）

**Files:**
- Modify: `webui/server/admin/access-map.ts`（`AccessMapQuery`、`parseAccessMapQuery`）
- Create（可选抽离）: `webui/server/admin/access-map-echo.ts`（`isInquiryKindFilterParam`／`isAccessGradeFilterParam`）
- Test: `webui/server/__tests__/p1-access-map.test.ts`

- [ ] **Step 1:** 写失败测试：缺参 → inquiryKind=management、accessGrade=exclude_connect；非法 inquiryKind／accessGrade／与非法 trust 同现 → 400
- [ ] **Step 2:** 实现严格解析并跑通上述测试
- [ ] **Step 3:** 跑 `cd webui && npx vitest run server/__tests__/p1-access-map.test.ts --maxWorkers=1`

### Task 2 — S1b：D6 关联 + buildBandED + meta.echo（SC-10–SC-16）

**Files:**
- Create: `webui/server/admin/access-map-echo.ts`
- Modify: `webui/server/admin/access-map.ts`（`loadAccessSide` 读 tool／lucy_turn_id；构图前滤 E／D；`enteringAllowCallCount`）
- Test: `webui/server/__tests__/p1-access-map.test.ts`

**Interfaces:**
- `buildBandED(f, db) → { B, E, D }` 调用 id 集合（number／string 与现夹具一致）
- `resolveTurn` 序：非空 `lucy_turn_id` → conversation_turns；否则 `inferred_turn_access_logs` → inferred_turns
- 重建准备失败 → access `unavailable`（不得空 E 冒充无关联）
- 结构筛选前 `⋃ I(e) = E`；scope／focus 后并集 ⊆ E 且 `enteringAllowCallCount` 仍为 `|E|`；layer 不改 E

- [ ] **Step 1:** 夹具预写期望 id 集（SC-10 会话访问、SC-11 连接级、SC-12 关联五态、SC-13 逐项相等、SC-14 并集／deny／scope、SC-15 授权骨架不变、SC-16 无第二枚举静态断言）
- [ ] **Step 2:** 实现 echo 模块并接入 `loadAccessSide`／路径构建
- [ ] **Step 3:** 跑 `cd webui && npx vitest run server/__tests__/p1-access-map.test.ts server/__tests__/p1-access-map-contract.test.ts server/__tests__/p1-access-map-conservation.test.ts --maxWorkers=1`

### Task 3 — S2：工具条与弱入口（SC-01–SC-09、SC-17–SC-18）

**Files:**
- Modify: `webui/src/pages/admin/AccessMap.tsx`、`AccessMapLegend.tsx`、`AccessMapTypes.tsx`、`AccessMapSignalNotes.tsx`（若空态文案在此）
- Test: `webui/src/__tests__/access-map.test.tsx`（`access-map-layout.test.tsx` 若布局断言失效则同改）

- [ ] **Step 1:** 组件测试：无「问询计入」主分段；有 `access-map-inquiry-kind`／`access-map-access-grade`；弱入口 `access-map-trust`＋说明；legend「关联口径」；切换写 URL；E 空提示不声称全量无访问
- [ ] **Step 2:** 改页面实现
- [ ] **Step 3:** 跑 `cd webui && npx vitest run src/__tests__/access-map.test.tsx src/__tests__/access-map-layout.test.tsx --maxWorkers=1`

### Task 4 — S3：文档指针与 lint（SC-20）

**Files:** Spec 187 指定节、chart-first Spec、术语标准（若需）、本 Spec／Plan 状态、索引镜像、实施笔记 `docs/reviews/2026-11-04-access-map-audit-echo-implementation-notes.md`

- [x] **Step 1:** 改指针与文案
- [x] **Step 2:** 跑 `npm run lint:spec-docs && npm run lint:spec && npm run lint:terminology && npm run lint:ia-boundary`，结果写入实施笔记
- [x] **Step 3:** 全量复跑：

```bash
cd webui && npx vitest run --maxWorkers=1 \
  server/__tests__/p1-access-map.test.ts \
  server/__tests__/p1-access-map-contract.test.ts \
  server/__tests__/p1-access-map-conservation.test.ts \
  src/__tests__/access-map.test.tsx \
  src/__tests__/access-map-layout.test.tsx \
  server/__tests__/admin-audit.test.ts \
  server/__tests__/audit-inquiry-kind.test.ts \
  server/__tests__/access-grade.test.ts
```

## 5. 完成定义

- SC-01–SC-20 有对应证据
- 无「问询计入」主控件；弱入口可改关联口径
- 无第二份枚举；E 与期望集逐项相等有测
- 文档指针与索引镜像已更新；四项 lint 记录在实施笔记
- 本条收口不表示可上线；收口须用户另行批准 C 类闭口

## 6. 风险

| 风险 | 缓解 |
|---|---|
| 缺省变严图空 | 夹具＋空态文案点名筛选 |
| 重建失败被吞 | unavailable＋SC-12 |
| trust 400 与新参 400 | SC-09／SC-19 |
| 误用审计非法回落解析 | Task 1 严格集合 + 独立测试 |

## 7. Codex 审阅（历史）

- 第 1 轮退回 → v0.2；第 2 轮退回（中 2）→ v0.3 闭合定稿
- 汇总：`docs/reviews/2026-11-02-codex-review-access-map-audit-echo.md`
