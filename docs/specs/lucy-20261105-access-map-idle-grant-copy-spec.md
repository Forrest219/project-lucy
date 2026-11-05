# 访问关系图闲置授权文案与边悬停 Spec

| 元数据 | 内容 |
|---|---|
| 文档类型 / 版本 | 呈现＋术语修订 / **v0.3** |
| 日期 / 目标版本 | 2026-11-05 / 不绑定产品版本号。不升 Spec 187 版本号 |
| 功能编号 / 优先级 | **无** / **P2**（访问关系图可见文案与悬停阅读顺序）。不进入 [`docs/plans/2026-10-18-lucy-2.5-upgrade-proposal.md`](../plans/2026-10-18-lucy-2.5-upgrade-proposal.md) 登记册 |
| 状态 | **v0.3 功能合同已收口（2026-11-05）**。SC-01–SC-15 本机自动化通过，证据见 [收口记录](../reviews/2026-11-05-access-map-idle-grant-copy-closure.md)。D1–D9 已冻结；三轮审阅 F09–F13 已闭合（见 [审阅记录](../reviews/2026-11-05-codex-review-access-map-idle-grant-copy.md)）。本条收口不表示可上线 |
| 决策来源 | 2026-11-05 对 `http://127.0.0.1:55176/admin/access-map?window=720h` 的反馈：边悬停「授权路径 / 访问路径 / 调用」平铺且「状态: 僵尸授权」不友好；委托人更关心窗口内真实调用次数。澄清后拍板：**方案 2**（全站正式改名「闲置授权」+ 四态统一三段式悬停）；悬停布局选 **结论句优先** |
| 需求来源 | 管理员读边时先回答「这段关系窗口内真实调用了几次」，状态用语不带恐吓感；访问面降级时不得用零值冒充「未调用／有调用」 |
| 实施主体 | Lucy WebUI：`AccessMapTypes` / `AccessMapCanvas` / `AccessMap.tsx`（传入访问面可用态）／相关测试；术语标准；ops 四副本。不修改 KTX；不修改 `/api/admin/access-map` 字段与 `dormant` 枚举值 |
| 落位依据 | [`docs/governance/DEVELOPMENT.md`](../governance/DEVELOPMENT.md)「Spec 落位规则」与「功能闭口与发布取证」 |
| 与既有 Spec 的关系 | **修订呈现与 UI 主术语，不改语义。** 权威边状态判定仍是 [`webui/docs/187-access-relation-sankey-spec.md`](../../webui/docs/187-access-relation-sankey-spec.md)。**取代** chart-first §5.6 边悬停合同中含「僵尸授权／访问路径平铺」一句的**有效呈现**。访问面 `meta.access.state === "unavailable"` 时仍可渲染授权骨架（既有行为）；本条只约束悬停不得把缺失访问面说成真实调用结果（对齐 Spec 187 降级诚实性） |
| 实施计划 | [`docs/plans/lucy-20261105-access-map-idle-grant-copy-plan.md`](../plans/lucy-20261105-access-map-idle-grant-copy-plan.md) |
| 审阅记录 | [`docs/reviews/2026-11-05-codex-review-access-map-idle-grant-copy.md`](../reviews/2026-11-05-codex-review-access-map-idle-grant-copy.md) |

## 闭口层级

- 层级：功能合同
- 本条承诺：运行时可见面将 Dormant Grant 主术语改为「闲置授权」；访问面可用时边悬停三段式先结论并突出真实调用次数；访问面不可用时悬停明示调用情况暂不可用，不以 0 次冒充未调用／有调用；「僵尸授权」不再出现在运行时可见面与 ops 触发词副本中。
- 本条出口：SC-01–SC-15。
- 不在本条出口：浏览器走查、Playwright、窄屏、镜像、部署、改边状态机／API／几何／着色、历史 notes 全文替换、Agent 名册「闲置」改名。文档指针归 Plan S3。
- 上线关系：本条收口不表示可上线

## 伪代码豁免

本条为呈现与术语修订，**不改变** Spec 187 边状态判定、授权／访问构图或 `buildAccessMap` 控制流。豁免「核心流程（伪代码）」；算法仍以 Spec 187 为准。

---

## Terminology Compliance

This feature follows `webui/docs/00-product-terminology-standard.md`.

New terms:

- None as a new product concept. **修订既有术语 UI 主术语**：Canonical `Dormant Grant` 的 UI 主术语由「僵尸授权」改为「闲置授权」。

术语表目标行（实施时写入标准正文）：

| Canonical Term | UI 主术语 | 允许补充说法 | 禁止文案 | 说明 |
|---|---|---|---|---|
| Dormant Grant | 闲置授权 | 有权未用 | 僵尸授权；未使用权限；闲置资源 | 授权路径数 > 0 且访问路径数 = 0；API／内部值仍为 `dormant` |

与 Agent 名册「闲置」**不同概念**：访问关系图必须写「闲置授权」四字。

控件／展示文案：

| 控件 | 文案 | 说明 |
|---|---|---|
| 边状态标签 `dormant` | 闲置授权 | `accessMapEdgeStateLabel` |
| 列头 KPI | 闲置授权 {n} | |
| 口径前缀 | 闲置授权口径： | |
| 访问面可用·结论 | §5.2 表 | |
| 访问面可用·数字行 | 授权路径 {grantPaths} 条 · 调用 {accessCalls} 次 | **突出调用**＝该行必须含 `调用 {n} 次`，且位于结论行之后 |
| 访问面不可用·结论 | 授权面可读，调用情况暂不可用 | 逐字 |
| 访问面不可用·数字行 | 授权路径 {grantPaths} 条 · 调用情况暂不可用 | **禁止**写 `调用 0 次` |

Forbidden：运行时 DOM／ops 触发词再出现「僵尸授权」；访问面不可用时用「有调用／未调用」或数字 0 冒充真实调用结果。

---

## Design System Compliance

### Referenced Specs

- `webui/docs/design-system/00-principles.md`
- `webui/docs/design-system/01-foundations-color.md`
- `webui/docs/design-system/99-governance.md`（`TD-187-01` 着色不变）
- chart-first／quiet-reading 呈现 Spec

### What This Change Follows

- [ ] 自定义悬停（`access-map-hover-tip`）为合同提示；SVG `<title>` 非唯一提示
- [ ] 保留的 `<title>` 短状态须新词合规
- [ ] 状态有文字；着色不变；无裸 hex；无新组件族

### Exceptions

- chart-first §5.6「悬停须含访问路径计数」：本条改为**访问面可用时**自定义悬停不展示访问路径条数；抽屉仍可展示。
- 访问面不可用：悬停不展示真实调用次数（对齐 Spec 187 降级诚实性）。

### Follow-up Needed

- Plan S3：chart-first／187／quiet-reading／geometry／handbook／selector-contract／TD-187-01 指针同步。

---

## 1. 背景

边悬停原平铺「授权路径／访问路径／调用」并以「僵尸授权」作状态。用户更关心真实调用次数。另：访问面 `unavailable` 时服务端仍返回授权骨架且边可初始为 `normal`、调用集合为空；若仍套「有授权，窗口内有调用」+「调用 0 次」会违反降级诚实性。

## 2. 目标

1. UI 主术语「闲置授权」；禁止「僵尸授权」。
2. 访问面可用：四态三段式悬停；突出 `调用 N 次`。
3. 访问面不可用：悬停明示「调用情况暂不可用」，不以 0 冒充。
4. 语义／API／着色／几何不动。

## 3. 非目标

| 不做 | 原因 |
|---|---|
| 改 dormant 判定或 API | Spec 187 |
| 改着色／几何／抽屉布局 | 本条只改悬停与可见术语 |
| 访问不可用时隐藏整图 | 既有页壳保留授权骨架 |
| Agent「闲置」筛选改名 | 不同概念 |
| 浏览器 E2E／镜像 | 不在出口 |

## 4. 拍板记录

| ID | 决议 |
|---|---|
| D1 | A+C：悬停 + 正式改术语 |
| D2 | 主术语＝闲置授权 |
| D3 | 访问面可用时三段式白话 |
| D4 | 方案 2：全站可见改名 + 四态悬停 |
| D5 | 访问面可用：数字行不展示访问路径；必须展示 `调用 N 次`（含真实 0） |
| D6 | API／`dormant`／Canonical 不变 |
| D7 | SVG `<title>` 若保留：新短标签、禁旧词；不要求三段式 |
| D8 | 功能出口＝运行时 UI + ops 四副本；handbook 等归 S3 |
| D9 | `meta.access.state !== "ok"`：悬停用降级结论／数字行；禁止「有调用／未调用」与 `调用 0 次` 冒充 |

## 5. 边悬停合同

节点悬停不变。`AccessMapCanvas` 必须接收布尔 **`accessOk`**（页面传 `response.meta.access.state === "ok"`）。

边自定义悬停（`data-testid="access-map-hover-tip"`）固定 **三行、顺序不可颠倒**：

1. **关系行**：`{sourceLabel} → {targetLabel}`
2. **结论行**：见 §5.2／§5.3
3. **数字行**：见 §5.2／§5.3

禁止第四行「状态：…」。禁止自定义悬停出现「访问路径」。禁止「僵尸授权」。

### 5.1 原生 `<title>`

若保留：短状态来自 `accessMapEdgeStateLabel`；禁「僵尸授权」；访问面不可用时 title 亦不得写「调用 0 次」冒充（可用「调用情况暂不可用」或省略调用数字）。不要求三段式。

### 5.2 访问面可用（`accessOk === true`）

```ts
accessMapEdgeHoverConclusion(state: AccessMapEdgeState): string
```

| state | 结论句（逐字） |
|---|---|
| dormant | 有授权，窗口内未调用 |
| normal | 有授权，窗口内有调用 |
| needs_review | 窗口内有调用，当前授权对不上（需复核） |
| overflow | 窗口内有调用，且超出当前授权 |

数字行（逐字结构）：`授权路径 {grantPaths} 条 · 调用 {accessCalls} 次`

若 `confirmedUnauthorized === true`：在结论句后追加「（确凿越权：调用当时授权亦不覆盖）」；为 false 时不得出现该括注。

夹具不变量：`normal`／`needs_review`／`overflow` ⇒ `accessCalls >= 1`；`dormant` ⇒ `accessCalls === 0`。

### 5.3 访问面不可用（`accessOk === false`）

结论行（逐字，**不**按四态切换）：`授权面可读，调用情况暂不可用`

数字行（逐字结构）：`授权路径 {grantPaths} 条 · 调用情况暂不可用`

禁止：结论使用 §5.2 四态「有调用／未调用」句；数字行出现 `调用 {n} 次`（含 0）。`confirmedUnauthorized` 括注在此分支亦不展示（无可靠访问面证据时不叠确凿越权括注）。

短状态标签（列头／抽屉／aria）仍可用 `accessMapEdgeStateLabel`（授权面事实）；仅悬停调用叙事降级。

## 6. 其它可见面改名

### 6.1 功能出口

- `accessMapEdgeStateLabel("dormant")` →「闲置授权」
- 列头「闲置授权 {n}」；口径前缀「闲置授权口径：」；抽屉状态行；悬停／title 短标签
- ops 四路径：`skills/…`、`config/skills/…`、`examples/docker-demo/.../ops-questioning.md`、`webui/config/ops-evidence/.../ops-questioning.md`

### 6.2 S3（非功能 SC）

术语标准（SC-02 仍打假）、Spec 187／quiet-reading／chart-first／geometry、handbook、selector-contract、TD-187-01。

## 7. 验收场景

| ID | 断言 | 打假 |
|---|---|---|
| SC-01 | `accessMapEdgeStateLabel("dormant") === "闲置授权"` | 单测 |
| SC-02 | 术语标准 Dormant Grant 行主术语／禁止列 | 读文件断言 |
| SC-03 | `accessOk`：dormant 悬停三行顺序＝关系→结论「有授权，窗口内未调用」→含「调用 0 次」；无「访问路径」；无「状态：」 | hover-tip |
| SC-04 | `accessOk`：normal 结论「有授权，窗口内有调用」；数字行含「调用 {n} 次」且 n≥1；结论在数字前 | 同上 |
| SC-05 | `accessOk`：needs_review 结论固定句；数字行含调用次数；无「访问路径」／「状态：」 | 同上 |
| SC-06 | `accessOk`：overflow 结论固定句；数字行含调用次数 | 同上 |
| SC-07 | `accessOk` + `confirmedUnauthorized=true`：结论含括注；`=false`：无该括注 | 同上 |
| SC-08 | `accessOk=false`：结论「授权面可读，调用情况暂不可用」；数字行含「调用情况暂不可用」、不含 `调用 \d+ 次`；即使夹具 `confirmedUnauthorized=true` 也**不得**出现确凿越权括注 | 同上 |
| SC-09 | 列头可见「闲置授权」、不可见「僵尸授权」 | 组件 |
| SC-10 | 抽屉 dormant 短标签「闲置授权」 | 组件 |
| SC-11 | 口径前缀「闲置授权口径」可见面无「僵尸授权」（SignalNotes 若挂载） | 组件或字符串常量断言 |
| SC-12 | 若保留 SVG `<title>`：无「僵尸授权」；且在 `accessOk=false` 时不出现 `调用 \d+ 次`（可用「调用情况暂不可用」或省略调用数字） | 组件 |
| SC-13 | 两份 access-map 测试文件用户可见期望串无「僵尸授权」 | 测试文件 |
| SC-14 | ops 四文件无「僵尸授权」且含「闲置授权」 | 读文件 |
| SC-15 | `AccessMap.tsx` 向 Canvas 传入 `accessOk={meta.access.state==="ok"}`（或等价 prop） | 组件／静态断言 |

不在出口：Playwright、改 `dormantEdges` 字段名、handbook 全文无旧词。

## 8. 完成定义

- SC-01–SC-15 有证据；S3 指针更新；本条收口不表示可上线
