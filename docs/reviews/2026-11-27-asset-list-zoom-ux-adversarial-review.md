# REQ-0120 资产列表 Zoom 交互 · 三轮对抗式评审

| 元数据 | 内容 |
|---|---|
| 文档名称 | REQ-0120 资产列表 Zoom 交互 · 三轮对抗式评审 |
| 文档类型 | Review（过程评审记录） |
| 版本 | v1.0 |
| 撰写日期 | 2026-11-27 |
| 撰写人 | Cursor Agent（Composer）代行；**本会话无法唤起 Claude Code CLI**（Cursor SDK 拒绝 MiniMax 模型名；Terminal.app 自动化挂起）。评审提示词已留 `inbox/20261127-asset-list-zoom-adversarial-review-prompt.md`，委托人可在本机 Terminal 重跑 Claude Code 作独立复核 |
| 委托人 | xingchen |
| 评审对象 | [Spec](../specs/lucy-20261127-asset-list-zoom-ux-spec.md)（评审过程中由 v0.1-draft → v0.3-draft）· [REQ-0120](../backlog/entries/REQ-0120-asset-list-zoom-ux.md) |
| 关联登记 | REQ-0120 |
| 适用范围 | 终稿确权与开发授权前的 Spec 对抗性评审；无配对 Plan／UAT 套件时只评 Spec 合同可执行性 |
| 输出位置 | `docs/reviews/2026-11-27-asset-list-zoom-ux-adversarial-review.md` |

## 0. 本记录的效力

- 过程评审，**不构成**终稿确权、开发授权、功能合同收口、UAT 结果或可上线结论。
- 未改运行代码；未执行浏览器 UAT。
- 三轮均针对 Spec 合同与现行实现对拍；每轮后修订 Spec 再进入下一轮。

## 三轮汇总

| 轮次 | Spec 版本进 | Spec 版本出 | 结论 |
|---|---|---|---|
| 1 | v0.1-draft | v0.2-draft | **Request changes**（B1–B6） |
| 2 | v0.2-draft | v0.3-draft | **Approve with nits**（N1–N4；无新阻断） |
| 3 | v0.3-draft | v0.3-draft | **Approve with nits**（残留 N／OQ 不阻塞进入委托人阅稿；仍待终稿确权） |

**最终建议**：Spec 可作为委托人阅稿与写 Plan 的基线；**不建议**在无 Plan／无测试台套件登记前开发授权。独立 Claude Code 复核仍建议补跑。

---

## §轮次1（v0.1-draft）

### 1.1 结论

**Request changes：退回 Spec 修订。** 合同方向正确，但存在可假绿与版式错位漏洞。

### 1.2 发现表

| 编号 | 严重度 | 审查项 | 证据 | 对抗反例 | 关闭条件 |
|---|---|---|---|---|---|
| B1 | 阻断 | Catalog 套用「单 Schema 组」单位不清 | Spec §3.1；`Catalog.tsx` `groupedTables`／`filtered` 全量渲染 | 实现者对右表 `filtered.map` 只做「全局前 5 行」仍声称家族 A，10 个 Schema 头+表仍可混成墙，或 `schema=all` 时一次挂多组 | 明确 Catalog 以 `conn/schema` 分组；同时只展开一组；`schema=all` 不得把多组表行同时挂出 |
| B2 | 阻断 | 「显示更多」可做成 CSS 隐藏全量 DOM | Spec §3.1 只写未展开组不挂载；组内 show-more 未禁止全挂载 | 实现挂载 200 行 `hidden`，性能与「有界」承诺双假绿 | 合同：可见窗口外的表行**不得**进入文档（除无障碍活区计数节点）；测试可断言 DOM 表行数 ≤ 可见上限 |
| B3 | 阻断 | 家族 B「约 50」过软 | Spec §3.2「约 ≤50」 | `RoleTableGrants` 继续全铺，仅加 `max-height` 滚动仍称满足 | 改为硬上限：过滤后候选表行 >50 必须分页；单页候选表 checkbox／已授表行 ≤50 |
| B4 | 阻断 | 搜索优先缺强制用户可见引导与 SC | Spec 原则 3；SC-06 仅启用表一例 | 有搜索框但无引导，用户仍滚长列表；Ctrl+F 实操主路径 | 当过滤后总量 > 当前家族默认 cap 时，工具条或空态附近须有系统内搜索引导文案；补 SC |
| B5 | 阻断 | 未显式废止启用表 `WHITELIST_ROW_BUDGET=50` 全展开 | `TableWhitelist.tsx:180-181`；`largeList = visibleTotal > 50` 时才折叠 | 实现保留 ≤50 全组展开，声称「有 cap」但 10×5 仍可被旧逻辑绕开 | Spec 写明：**取代**「过滤行 ≤50 则全组展开」；家族 A 默认即单组+5，与 50 无关 |
| B6 | 阻断 | Agent 权限预览「等价分页」不可测 | Spec E10／SC-10 | 只折叠 `<details>` 仍枚举全部表于 DOM | 定义计数单位＝有效权限树中的表名行；>50 必须分页或「显示更多」二选一写死（本条选分页以对齐家族 B） |
| N1 | 重要 | 新术语未写入术语标准正文 | Spec Terminology Compliance | 上线文案漂移 | 开发授权前登记到 `00-product-terminology-standard.md` 或 Plan 列强制任务 |
| N2 | 重要 | 无 UAT 套件／测试台行 | 闭口要求 SC-12 浏览器 | 日后主张 UAT PASS 时 `not_registered` | Plan 阶段登记 `UAT-SUITE-…`；宣称前挂测试台 |
| N3 | 建议 | OQ-1/2/3 未裁定 | Spec §8 | 实现分叉 | 本轮在 Spec 内冻结默认倾向为合同 |
| N4 | 建议 | 画像 P2 双面均 ↑ 依据可再钉 DOM 断言 | Spec 受影响画像 | — | 在 SC 中加「首屏表行 DOM ≤ cap」类断言编号 |

### 1.3 本轮 Spec 修订摘要 → v0.2-draft

闭合 B1–B6；将 OQ 默认倾向升为合同；补 SC-13–SC-15；头部注明轮次1已修订。

---

## §轮次2（v0.2-draft）

### 2.1 结论

**Approve with nits。** 阻断项已在合同层关闭；残留为落地与台账类 nit。

### 2.2 复核对拍

| 原编号 | 复审 | 说明 |
|---|---|---|
| B1 | 闭合 | §3.1 明确 Catalog `conn/schema` 组与 `schema=all` 禁多组表行 |
| B2 | 闭合 | §3.0 挂载合同 + SC-13 |
| B3 | 闭合 | §3.2 硬 50 + 分页 |
| B4 | 闭合 | §2.5 + SC-14 |
| B5 | 闭合 | §7 显式取代 WHITELIST 50 全展开 |
| B6 | 闭合 | §3.2 Agent 表名行计数 + 分页 |
| N1–N4 | 保留 | 不升阻断；写入 Follow-up |

### 2.3 新发现

| 编号 | 严重度 | 项 | 关闭条件 |
|---|---|---|---|
| N5 | 建议 | 连接概览单元格内搜索与页级搜索关系仍略重 | Plan 选「单元格内最小搜索」为默认实现，避免阻塞家族 A |
| N6 | 建议 | 家族 B 已选表若 >50，已选摘要折叠内是否也要分页 | Spec 补一句：已选摘要默认折叠；展开后若 >50 同样分页或显示更多（选分页） |

### 2.4 本轮 Spec 修订摘要 → v0.3-draft

补 N6 已选摘要分页；N5 记入实现指导；状态句更新为「三轮过程评审进行中」。

---

## §轮次3（v0.3-draft）

### 3.1 结论

**Approve with nits。**

合同可执行、假绿主路径（CSS 藏全量、≤50 全展开、Catalog 多组墙、家族 B 软上限）已在条文层封死。残留 N1／N2／N5 属落地与台账，不阻止委托人阅稿；**阻止开发授权**直至：委托人终稿确权 + Plan + 测试台套件登记 + 另发开发授权。

### 3.2 残留清单

| ID | 类型 | 内容 |
|---|---|---|
| N1 | 术语 | 开发前登记「显示更多」「显示 a / b」到术语标准 |
| N2 | 测试台 | Plan／INDEX 登记 UAT 套件前不得主张 UAT PASS |
| N5 | 实现 | 连接概览展开表清单优先单元格内最小搜索 |
| OQ-none | — | 原 OQ-1/2/3 已在 v0.2 升为合同，无开放 OQ |

### 3.3 受影响画像（评审行）

| 审查项 | 结论 | 核对依据 |
|---|---|---|
| 受影响画像判定（4 画像） | 通过 | Spec「受影响画像」；SC-01–SC-15；补偿路径为显示更多／分页可达全集 |

### 3.4 第一性原理

合法治理路径仍可达任意表（搜索 + 有界展开／分页）；约束与成交双覆盖（SC-13／14／06／09）。通过。

---

## 附录：为何非 Claude Code 落盘

1. Agent shell 内 `claude --print` 返回 `[claude-code:unrecognized_model]`（`MiniMax-M3.1-Flash`／`MiniMax-M3[1M]`），被 Cursor SDK 拦截。
2. `osascript` 调 Terminal.app 启动 Claude Code 超过 100s 无输出（疑似自动化权限未授）。
3. 提示词已保存，建议本机执行：

```bash
cd /Users/forrest/GitHub/project-lucy
claude --print --dangerously-skip-permissions "$(cat inbox/20261127-asset-list-zoom-adversarial-review-prompt.md)"
```
