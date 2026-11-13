# 访问关系图空桑基修复 Spec

| 元数据 | 内容 |
|---|---|
| 文档类型 / 版本 | 功能合同修订 / **v0.1** |
| 日期 / 目标版本 | 2026-11-13 / 不绑定产品版本号 |
| 功能编号 / 优先级 | **无**（事故修复）／**P0** |
| 状态 | **v0.1 可交付开发（2026-11-13）**。委托人批准推进修复（D1–D4 按推荐）。**不表示可上线** |
| 决策来源 | 错题本 [`docs/lessons/2026-11-13-access-map-sankey-empty.md`](../lessons/2026-11-13-access-map-sankey-empty.md)；Plan [`lucy-20261113-access-map-sankey-empty-fix-plan.md`](../plans/lucy-20261113-access-map-sankey-empty-fix-plan.md) |
| 与既有 Spec | **保持** confirmed-only 硬锁；**修订** usage-first 空访问空态；**澄清** 显式 begin 后续同会话工具调用的关联写入 |
| 实施计划 | 同上 Plan |

## 闭口层级

- 层级：功能合同
- 本条承诺：SC-01–SC-12
- 不在本条出口：客户环境发布取证、Docker 重建（除非另授）、改默认筛
- 上线关系：本条收口不表示可上线

## Terminology Compliance

Follows `webui/docs/00-product-terminology-standard.md`. 产品名仍为「访问关系图」。

New UI copy（图例，可选）：

| 控件 | 文案 |
|---|---|
| 图例（空态） | 闲置骨干 = 无访问时的连通示意（不撑使用刻度） |

## 1. 决策冻结（D1–D4）

| ID | 裁定 |
|---|---|
| D1 | 访问面继续硬锁 `association_status='confirmed'` |
| D2 | `accessPaths=0` 且两端均在画布上的闲置授权边：画**闲置骨干**连通带；闲置表仍不进列；不进 usage 刻度 |
| D3 | 同会话在 `lucy_begin_question`（或其它已 `record` 的显式 turn）之后、无冲突 `x-lucy-turn-id` 时，后续 `tools/call` **按显式延续**解析 → `association_status=confirmed` |
| D4 | 本条不改默认问询种类／访问等级 |

## 2. 关联写入（Normative）

```text
on tools/call (tool ≠ lucy_begin_question):
  if header x-lucy-turn-id present:
    resolve(explicitTurnId=header)   # 既有：合法→confirmed；非法→conflict
  else if sessionId present AND activeTurnFor(identity, sessionId) = T:
    resolve(explicitTurnId=T)        # 显式问询延续 → confirmed
  else:
    resolve(session/identity as today)  # session_bound → candidate；不得升 confirmed
```

禁止：把纯 `session_bound` 推断（注册表中无 begin 记录、仅靠历史行）静默写成 confirmed。  
禁止：历史 backfill 把 candidate／null 升为 confirmed。

## 3. 空访问闲置骨干（Normative · 修订 usage-first §5.4 空态）

当 `accessOk` 且画布上存在闲置端点、使用边为空时：

```text
for idle edge e with grantPaths>0 and accessPaths==0:
  if both e.source and e.target are on canvas:
    draw backbone band thickness = BACKBONE_PX (= IDLE_GRANT_PX)
    backbone does NOT enter unitPx / pillarHeight usage sums
  idle endpoint pillars may use height floor BACKBONE_PX so bands attach
stubs + idle list remain
tables with only idle grants still do NOT enter columns
```

有使用时：usage 流带规则不变（厚度＝`accessPaths×unitPx`）。

## 4. 验收 SC

| ID | 断言 | 类型 |
|---|---|---|
| SC-01 | begin 后同 session 无 header 的工具调用 → confirmed + mode explicit | 单测 |
| SC-02 | 无 active turn 时 session 唯一候选仍为 candidate（不升 confirmed） | 单测 |
| SC-03 | 非法 header 仍 conflict；不回落 active turn | 单测 |
| SC-04 | access-map SQL 仍硬锁 confirmed；非法 trust 400 | 既有＋回归 |
| SC-05 | 仅 dormant、两端在画布：layout.links 含骨干；unitPx 不被 grant 撑高 | 布局测 |
| SC-06 | 有 usage 时骨干不替代 usage 厚度；柱高跟 accessPaths | 布局测 |
| SC-07 | 闲置表仍不进 selectAccessMapCanvasNodes | 布局测 |
| SC-08 | 图例披露闲置骨干或等价空态说明 | 组件 |
| SC-09 | 夹具：多 candidate 触表 + 0 confirmed → accessPaths=0；有骨干 | 服务端／布局 |
| SC-10 | 夹具：confirmed 触表路径 → accessPaths>0 且有 usage 流带 | 服务端／布局 |
| SC-11 | 本机 demo 冒烟步骤有记录（API 或目视） | 笔记 |
| SC-12 | 错题本状态更新为 mitigated／closed | 文档 |

## 5. 非目标

- 重开 `trust=include_candidate`
- 按授权路径恢复胖子柱排行榜
- 改写历史 audit 行 association_status
