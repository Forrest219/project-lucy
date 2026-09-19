# Overview Focus And Restraint Spec

| 元数据 | 内容 |
|---|---|
| 文档名称 | Overview Focus And Restraint Spec |
| 文档类型 | Product / UX / Frontend Spec |
| 版本 | v1.0 |
| 撰写日期 | 2026-09-11 |
| 撰写人 | Cursor Grok |
| 委托人 | zhangxingchen |
| 基于材料 | 用户批准的首页聚焦精简定位（克制、聚焦核心、清晰易懂、宁缺毋滥）；`webui/src/pages/Onboarding.tsx`；`webui/src/lib/opsDashboard.ts`；Spec 39 / 41 / 43 / 100 / 102 / 104 |
| 适用范围 | `/overview`（兼容 `/onboarding`）信息架构、待处理事项队列、首页色阶 |
| 输出位置 | `webui/docs/142-overview-focus-and-restraint-spec.md` |

| 字段 | 内容 |
|---|---|
| Spec 编号 | 142 |
| 关联页面 | `/overview` |
| 上游 Spec | Spec 39 / 41 / 43 / 100 / 102 / 104；本 Spec **修订** 其首页分区与待办条目 |
| 状态 | Implemented |
| 日期 | 2026-09-11 |
| 范围 | 首页只保留系统状态、待处理事项、MCP 接入；删除质量快照与访问风险；待办去重；首页不再出现「高风险」 |

### Changelog

| 版本 | 变更 |
|---|---|
| v1.0 | 初稿并落地：首页三层；删除快照/风险分区；待办仅语义/发布/评测；语义缺口一律「待处理」 |

## 1. 背景

`/overview` 在 Spec 39–102 迭代中叠了五层：系统状态、待处理事项、质量快照、访问风险、MCP 接入。经理扫第一屏会被两件事分心：

1. 「访问风险」+「近 7 天 ACL 拒绝 > 0 即 `danger`」看起来像事故；实际多数是 ACL 按策略拦截，且滚动窗口无法闭环处理（Spec 100 v1.3 已把它移出待办，但仍留在首页并标红）。
2. 同一事实复读：`catalog-pending` 与「待补语义」同公式（`enabled ∩ Manifest` 上的 `total − done`，Spec 104 §5.3）；待发布 / 评测又在待办与质量快照各出现一次。

首页应只回答两件事：**能不能用**、**现在该处理什么**。访问治理细节去 `/admin/audit`、使用概况与 risk-review，不进第一屏。

## 2. 目标

1. `/overview` 只保留三层：系统状态、待处理事项、MCP 接入。
2. 待处理事项是唯一行动队列；最多三类可闭环事项，计数为 0 不展示。
3. 红色只留给系统不可用（Lucy MCP / KTX Runtime）。
4. 首页用户可见文案不出现「访问风险」「高风险」。
5. 页头描述收成一句，不堆模块名单。

## 3. 非目标

| 非目标 | 理由 |
|---|---|
| 不改 ACL / 评测 / 语义覆盖统计口径 | 只改首页呈现与待办去重 |
| 不把 risk-review 六类候选项搬上首页 | 真安全信号留在治理复核 |
| 不改侧栏 IA，不新开「经理首页」 | 克制 |
| 不重做视觉系统 | 删分区，不加新组件 |
| 不做浏览器验证（本轮） | 仓库默认；Vitest + terminology |

## 4. Terminology Compliance

This feature follows `webui/docs/00-product-terminology-standard.md`.

New terms:

- None

既有术语保持：

| UI | 说明 |
|---|---|
| 系统概览 | 页标题 |
| 待处理事项 | 唯一行动队列 |
| 系统异常 | MCP / KTX 不可用时的 Alert 标题 |
| MCP 接入 | 底部工具区 |

禁止在 `/overview` 用户可见文案使用：

| 禁止 | 理由 |
|---|---|
| 访问风险 | 把 ACL 活动包装成事故 |
| 高风险 | 语义缺口是工作队列，不是事故 |
| 质量快照 | 与待办复读，本 Spec 删除该分区 |

Protected：`Agent`、`Token`、`MCP`、`KTX`、`Runtime`、`ACL`、`Endpoint` 仍须 `notranslate`（MCP 接入区与系统状态摘要）。

## 5. 首页信息架构

```text
系统状态          ← 能不能用（异常才大红 Alert）
待处理事项        ← 现在该做什么（唯一行动队列）
MCP 接入          ← 怎么接上（弱、工具性）
```

| 分区 | 保留 / 删除 | 说明 |
|---|---|---|
| 系统状态摘要 / 系统异常 Alert | 保留 | 口径不变；danger 仅 `!mcpEndpointReady \|\| !ktxAvailable` |
| 待处理事项 | 保留并收窄 | 见 §6 |
| 质量快照 | **删除** | 语义 / 发布 / 评测数字跟待办走 |
| 访问风险 | **删除** | Agent / Token / ACL 拒绝次数不进首页 |
| MCP 接入 | 保留 | Endpoint、复制配置、查看配置、调试台 |

页头 description **必须**为：

> 确认系统可用，处理当前待办。

待处理事项副文 **必须**为：

> 语义缺口、待发布变更、评测缺口。点击任一项进入处理页面。

禁止再写「ACL 拒绝见下方访问风险」。

## 6. 待处理事项（唯一行动队列）

只生产以下 id；计数为 0 / 未知则省略。

| id | 条件 | severity | 徽章 |
|---|---|---|---|
| `semantic-gap` | 已启用 ∩ Manifest 且 `done < total` | **一律 `warning`** | 待处理 |
| `publish-pending` | `/api/diff` `files.length > 0` | `warning` | 待处理 |
| `eval-gap` | 近 30 天评测 `state !== unavailable` 且确认 0 次成功运行 | `info` | 提醒 |

**删除：**

| 原 id | 理由 |
|---|---|
| `catalog-pending` | 与 `semantic-gap` 同数，文案却写成 Catalog 同步（Spec 104 §5.3） |
| `acl-deny` | Spec 100 v1.3 已删；本 Spec 确认首页也不再展示 ACL 拒绝次数 |

语义缺口 **不再** 因缺口比例 ≥ 2/3 升为 `critical` / 「高风险」。首页不生产 `severity: "critical"` 的待办项。

ACL 拒绝、过宽 Role、吊销 Token 仍被尝试等，继续只在访问治理页 / `GET /api/admin/governance/risk-review` 出现。

## 7. 核心流程（伪代码）

```text
function buildOverviewActionItems(input):
  items = []
  gap = max(0, input.semantic.total - input.semantic.done)
  if input.semantic.total > 0 and gap > 0:
    items.push(semantic-gap, severity=warning)   # 不再按 2/3 升 critical
  if max(0, input.pendingPublishFiles) > 0:
    items.push(publish-pending, severity=warning)
  if input.evalRunsLast30d === 0:                # null = 未知，不造项
    items.push(eval-gap, severity=info)
  return sort_by(severityOrder, items)           # warning 先于 info

function overviewDanger(mcpEndpointReady, ktxAvailable):
  return not mcpEndpointReady or not ktxAvailable

function renderOverview(state):
  if overviewDanger(...):
    render Alert "系统异常"                       # 首页唯一大红
  else:
    render 一句健康摘要
  render 待处理事项(buildOverviewActionItems(state))
  render MCP 接入
  # 禁止渲染 质量快照 / 访问风险 / ACL 拒绝次数
```

## 8. 对既有 Spec 的修订

本 Spec 生效后，以下条款以本文件为准。

| 被修订条款 | 新规则 |
|---|---|
| Spec 39 §11「首页能看到质量快照、访问风险快照」 | 首页看到系统状态、待处理事项、MCP 接入 |
| Spec 43 §3.2「不删除主要区块」 | 允许删除质量快照与访问风险 |
| Spec 100 v1.3「ACL 拒绝仅由访问风险指标卡展示」 | ACL 拒绝次数不进首页；待办仍不得生产 `acl-deny` |
| Spec 100 §5.1 / §6 `catalog-pending` | 待办不再生产该 id |
| Spec 100 §5.4 质量快照 / 访问风险深链 | 分区删除；深链 Registry 仍可供治理页使用 |
| Spec 102 六卡 Metric Row | `/overview` 不再渲染这些卡；Spec 102 作为历史布局记录保留 |
| Spec 104 §5.3 Catalog 对象待处理 | 条目删除，不再与语义缺口并列 |

## 9. 色阶

| 信号 | 色阶 |
|---|---|
| Lucy MCP 或 KTX Runtime 不可用 | `danger` / 「系统异常」 |
| 待补语义、待发布 | `warning` / 「待处理」 |
| 近 30 天无评测 | `info` / 「提醒」 |
| 健康摘要 | 默认，不大红 |

刷新徽章连续失败 ≥ 3 次仍可用 `danger` 标「上次更新」过期，这是刷新反馈，不是访问风险。

## 10. Design System Compliance

- 引用 `webui/docs/design-system/00-principles.md`：层级清晰；主次不可混用误导性显著性。
- 引用 `webui/docs/design-system/20-patterns-page-layout.md` §4 概览页模式：中段只保留待处理事项，不再并排风险分区。
- 引用 `webui/docs/design-system/01-foundations-color.md`：`danger` 仅系统不可用。
- 不新增组件、色阶或 Metric Row 变体。删除后的空白不另补「弱文字拒绝次数」。

## 11. 验收标准

1. `/overview` DOM **不**含 `ops-quality-snapshot`、`ops-access-risk`、`ops-metric-acl`。
2. 用户可见文案 **不**含「访问风险」「质量快照」「高风险」。
3. 待办最多出现 `semantic-gap` / `publish-pending` / `eval-gap`；**不**出现 `catalog-pending`、`acl-deny`。
4. 任意大小的语义缺口徽章均为「待处理」。
5. 近 7 天 ACL 拒绝 > 0 时，首页不出现该数字，待办也不出现 ACL 条目。
6. 页头描述为「确认系统可用，处理当前待办。」
7. MCP / KTX 不可用仍渲染 `ops-service-health-critical`。
8. `npm test`（相关）、`npm run lint:terminology` 通过。
