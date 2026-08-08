# Overview Health-to-Action Deep Link Closed Loop Spec

| 元数据 | 内容 |
|---|---|
| 文档名称 | Overview Health-to-Action Deep Link Closed Loop Spec |
| 文档类型 | Spec |
| 版本 | v1.3 |
| 撰写日期 | 2026-08-06 |
| 撰写人 | Composer |
| 委托人 | zhangxingchen |
| 基于材料 | Attu 集群健康卡 → 修复对象评估；Attu Overview 指标卡视觉参考 [02-overview.png](https://github.com/zilliztech/attu/blob/main/.github/images/v3/02-overview.png)；交叉审阅（可行性/可落地性，2026-08-05）；`webui/docs/99-mcp-playground-acl-decision-visibility-spec.md`；`webui/docs/39-data-agent-ops-platform-global-ux-spec.md` §7；`webui/docs/41-system-overview-enterprise-ops-polish-spec.md`；`webui/docs/43-system-overview-header-and-health-simplification-spec.md`；`webui/src/lib/opsDashboard.ts`；`webui/src/pages/Onboarding.tsx`；`webui/src/pages/Catalog.tsx` |
| 适用范围 | `/overview` 系统状态 / 待处理事项 / 质量与访问快照的深链契约；目标页对 query 的消费；overview 指标卡视觉（含小 icon）；与 Spec 99 共享 URL / 审计深链登记表 |
| 输出位置 | `webui/docs/100-overview-health-action-deeplink-loop-spec.md` |

| 字段 | 内容 |
|---|---|
| Spec 编号 | 100 |
| 关联工单 | `webui/docs/plans/wo-202608-33-overview-health-action-deeplink-loop.md` |
| 关联页面 | `/overview`；消费方：`/catalog`、`/connections`、`/publish/workbench`、`/eval/*`、`/admin/agents`、`/admin/audit`、`/admin/mcp-playground`（若已存在） |
| 关联台账 | `docs/ui-ux-feedback/pages/overview.md`（`UX-OVERVIEW-011`～`014`） |
| 上游 Spec | Spec 19/39/41/43（系统概览）；Spec 48（`/catalog`）；Spec 89/94（访问日志 query）；Spec 99（MCP 调试台 / 裁决深链，可组合） |
| 状态 | Implemented |
| 日期 | 2026-08-05 |
| 范围 | 统一深链登记表；修正过时深链；query-driven Catalog；ActionRequiredItem 必填 impact/evidence；回写刷新约定；Attu 式指标卡 + 小 icon；契约测试 |

> **口径修订（Spec 104）：** §3「不改待处理事项计数口径」已被 [`104-enabled-scope-semantic-coverage-alignment-spec.md`](104-enabled-scope-semantic-coverage-alignment-spec.md) 修订：语义覆盖 / 待补语义分母改为「已启用 ∩ Manifest」。本 Spec 的 Canonical Deep Link URL（含 `/catalog?completion=incomplete`）不变；Catalog 默认 `scope=enabled` 后深链结果与待办一致。
>
> **审计深链修订（Spec 106）：** 生产者改为 `view=calls&range=7d`（兼容读旧 `tab`/`hours`）。下文历史示例中的 `tab=calls&hours=168` 以 Spec 106 / `DEEP_LINKS` 为准。

### Changelog

| 版本 | 变更 |
|---|---|
| v1.0 | 初稿：自 Attu 健康卡闭环评估收敛为 Lucy overview P0 |
| v1.1 | 补充 Attu Overview 指标卡（含小 icon）视觉借鉴；纳入质量/访问快照 metric 呈现要求（§8） |
| v1.2 | 交叉审阅补齐：修正 §5.1/`incomplete` 自相矛盾；新增共享深链登记表与弃用表；`impact`/`evidence` 升为必填；Catalog URL 读写原子交付；待办回写刷新约定；与 Spec 99 接口对齐 |
| v1.3 | 待处理事项移除 `acl-deny`：近 7 天 ACL 拒绝仅由「访问风险」指标卡展示（滚动窗口不可闭环处理） |

## 0. 与 Spec 99 的组合关系（非重复）

| | Spec 99 | Spec 100 |
|---|---|---|
| 主价值 | 决策可解释性与审计可达性（裁决预览 + 裁决原因双行 + 修复深链） | 健康建议的行动闭环（待办/健康 → 可过滤修复面 → 回写可见） |
| 共享接口 | §0 / Spec 99 §0 同一套 **Canonical Deep Link Registry** | 同左 |
| 合并不依赖 | 100 可先于 99 合并；MCP 调试台链仅在 99 路由存在时启用 | 99 审计 denied 深链必须使用本登记表的 audit URL 形态 |

**上线一致性硬门禁：** 任何写入 `actionUrl` / CTA `to=` 的改动，必须与目标页 query 消费同 PR 交付；禁止「overview 已发新链、Catalog 仍只读本地 state」的半截发布。

## 1. 背景

Spec 39 / 41 已将 `/overview` 定位为运维驾驶舱：「是否可服务 → 哪里有风险 → 下一步处理什么」。Attu 的集群健康卡验证了同类模式：**状态对象必须一跳到可修复面**。

产品评审额外确认：Attu Overview 顶栏指标卡（参考 [02-overview.png](https://github.com/zilliztech/attu/blob/main/.github/images/v3/02-overview.png)）在加上 **小号线框 icon** 后扫读感与精致度明显更好。Lucy `/overview` 质量快照 / 访问风险应吸收该视觉语言。

交叉审阅（2026-08-05）进一步确认文档/代码双轨风险：

1. **深链生产者已文档化、消费者未契约化**：`opsDashboard.ts` 仍输出 `/?status=partial` 与 `/admin/audit?outcome=denied`（缺 `tab`/`hours`）；Catalog 筛选仍是本地 state。
2. **Spec 正文曾自相矛盾**：v1.1 §5.1 表写过 `completion=partial`，§5.2 却拍板 `incomplete`——以 v1.2 §5 为准，一律 `incomplete`。
3. **待办模型缺必填追溯字段**：无稳定 `impact` / `evidence` 时，三段式（问题 / 影响 / 证据来源）无法落到 UI。
4. **缺回写约定**：用户从深链处理返回 overview 后，无「何时看到待办消失」的规则，易误判未处理。

## 2. 目标

1. 每一条 `待处理事项` 的 `actionUrl` 指向 **Canonical Deep Link Registry** 中的路径 + query，落地后用户看到已过滤对象。
2. 系统状态（ready / warning / danger）提供与原因匹配的 CTA，禁止万能跳到访问日志。
3. `opsDashboard.ts` 为深链唯一生产者；UI 只渲染；测试锁定全表。
4. Catalog **强制** query-driven：mount 读 URL、改筛选写回 URL（`replace: true`）；与 overview 新链 **同 PR**。
5. `ActionRequiredItem.impact` / `evidence` **必填**（字符串，可短）。
6. 定义返回 overview 后的 **回写 / 刷新** 可见性规则（§7）。
7. 快照指标卡对齐 Attu：**小 icon + 标签 + 主值 + 可选次行**。
8. 仓库内消灭 overview 待办对弃用路径的引用（§5.0 弃用表）。

## 3. 非目标

| 非目标 | 理由 |
|---|---|
| 不新增后端聚合 API | 继续用现有 project/sources/diff/agents/eval/audit 计数 |
| 不重新引入四卡 ServiceHealthStrip 为主 UI | Spec 43；本单指标卡是快照区 |
| 不照搬 Attu Cluster Tab / Quick Start / 五卡集合 | 只借鉴视觉语法 |
| 不引入对象详情抽屉全局框架 | 本单路由深链 |
| 不改待处理事项计数口径 | count 逻辑保持 |
| 不恢复全局 auto-refresh interval | Spec 43；回写靠「返回 refetch + 手动刷新」 |
| 不做浏览器验证（本轮） | Vitest + terminology + build + code review |
| 不阻塞于 Spec 99 | MCP 调试台链按 §5.3 条件启用 |

## 4. Terminology Compliance

This feature follows `webui/docs/00-product-terminology-standard.md`.

| Canonical Term | UI 主术语 | 禁止文案 | 说明 |
|---|---|---|---|
| Action Required | 待处理事项 | 运维待办、告警列表 | 已有 |
| System Health Summary | 系统状态 | 服务健康条（作主 UI） | 一句摘要 |
| Deep Link | 深链 | 跳转（作用户主文案） | 文档用语 |
| Semantic Completion Incomplete | 未完成 | partial（作用户主文案）、status=partial | Catalog 筛选 value=`incomplete`；含 `not_started`+`partial` |
| Semantic Completion Partial | 部分完成 | — | 仅筛 `completion===partial`；兼容旧 query |
| Action Impact | 影响 | impact（裸露） | 待办行次级文案 |
| Action Evidence | 证据来源 | evidence（裸露） | 如「语义资产」「访问日志」 |

Protected：`Lucy MCP`、`KTX Runtime`、`Agent`、`Token`、`ACL`、`Catalog`、`Endpoint`、路由 path、query key。

**禁止**在用户可见待办描述中出现裸 `partial` / `not_started`（见既有 UX-OVERVIEW-010）。机器枚举仅出现在 URL query value 与代码类型中，并 `notranslate`。

## 5. Canonical Deep Link Registry（事实源）

本节为 Spec 99 / 100 **共享**。实现与测试以此为准；其它文档冲突时以本节为准。

### 5.0 弃用路径（实现后仓库内不得再由 overview / opsDashboard 产出）

| 弃用 | 替换为 |
|---|---|
| `/?status=partial` | `/catalog?completion=incomplete` |
| `/catalog?status=*` | `/catalog?completion=*`（query key 固定为 `completion`） |
| `/admin/audit?outcome=denied`（无 `tab`） | `/admin/audit?tab=calls&outcome=denied&hours=168` |
| `/onboarding` 作为待办目标 | `/overview` 或具体模块 canonical |

允许短期 **消费** 旧链做兼容（例如用户收藏夹），但 **禁止生产**。

### 5.1 待处理事项 `actionUrl`

| id | 条件 | actionText | Canonical `actionUrl` | 目标页必须 |
|---|---|---|---|---|
| `semantic-gap` | 语义未完成 | 前往补全 | `/catalog?completion=incomplete` | 筛「未完成」=`!== done`；URL↔state 双向 |
| `catalog-pending` | Catalog 待处理 > 0 | 查看连接 | `/connections` | 已有 |
| `publish-pending` | 待发布文件 > 0 | 打开发布工作台 | `/publish/workbench` | 已有 |
| `eval-gap` | 近 30 天 run = 0 | 查看趋势监控 | `/eval/monitor` | 已有 |

> **v1.3：** `acl-deny` 已从待处理事项移除。近 7 天 ACL 拒绝只走 §5.4「访问风险」指标卡 CTA；`opsDashboard.buildActionRequiredItems` **不得**再生产 `id: "acl-deny"`。

### 5.2 语义缺口筛选语义

Catalog `CompletionStatus`：`not_started` | `partial` | `done`。

| Query `completion=` | 筛选语义 | UI 选项文案 |
|---|---|---|
| `incomplete` | `!== "done"` | **未完成** |
| `partial` | `=== "partial"` | 部分完成（兼容旧链） |
| `not_started` | `=== "not_started"` | 未开始 |
| `done` | `=== "done"` | 已完成 |
| 缺省 / `all` | 不筛 | 全部状态 |

Overview「待补语义」计数 = `total - done`，深链 **只生产** `incomplete`。

### 5.3 系统状态 CTA

#### Warning 摘要

| 优先级 | 条件 | CTA 文案 | 目标 |
|---|---|---|---|
| 1 | `semantic.gap > 0` | 查看未完成语义资产 | `/catalog?completion=incomplete` |
| 2 | `agents.gap > 0` | 查看 Agent | `/admin/agents` |
| 3 | 否则 | 查看访问日志 | `/admin/audit?tab=calls&hours=168` |

最多 1 主 CTA + 可选 1 文链。

#### Danger 告警

| 条件 | 动作 |
|---|---|
| `!mcpReady` | `检查 MCP 接入` → `#overview-mcp`；若路由 `/admin/mcp-playground` 已注册，另加 `打开 MCP 调试台` |
| `!ktxAvailable` | `查看连接概览` → `/connections` |
| 两者皆不可用 | 同时给出以上动作 |

### 5.4 质量快照 / 访问风险

| 区块 | Canonical 目标 |
|---|---|
| 待发布变更 | `/publish/workbench` |
| 评测数据 | `/eval/monitor` |
| Agent 启用与禁用 | `/admin/agents` |
| 近 7 天 ACL 拒绝 | `/admin/audit?tab=calls&outcome=denied&hours=168` |

### 5.5 Spec 99 共用审计 / 调试台形态

| 用途 | Canonical URL |
|---|---|
| 同类 ACL 拒绝 | `/admin/audit?tab=calls&outcome=denied&hours=168`（可加 `agentId` / `user`） |
| MCP 调试台预填 | `/admin/mcp-playground?agentId=&tool=&mode=dry-run` |

`agentId` 与审计筛选字段对齐：若审计现用 `user=` 表示 Agent id，则 Registry 与 Spec 99 remediation 必须与 `Audit.tsx` 实际 query key **同一键名**（实现前以代码为准拍板，写入本表脚注，禁止文档用 `agentId`、代码用 `user` 双轨）。

> **拍板（v1.2）：** 审计页 Agent 筛选 query 继续用既有 `user=`（与 Agent 列表「查看日志」一致）。Spec 99 remediation / 调试台预填 Agent 上下文用 `agentId=`；从审计跳调试台时做 `user`→`agentId` 映射。Overview→审计继续用 `user` 仅当需要锁定某 Agent；默认访问风险 ACL 拒绝全量 denied **不带** user。

## 6. 待处理事项行模型（必填契约）

```ts
export type ActionRequiredItem = {
  id: string;
  title: string;
  description: string;
  severity: Exclude<Severity, "ready">;
  actionText: string;
  actionUrl: string; // 必须来自 §5 Registry
  impact: string;    // 必填：影响面一句话
  evidence: string;  // 必填：证据来源标签
};
```

| id | impact | evidence |
|---|---|---|
| semantic-gap | Agent 可能无法回答相关表问题 | 语义资产 |
| catalog-pending | 本地目录与启用表范围可能不一致 | 数据接入 |
| publish-pending | 变更尚未进入 KTX 索引 | 语义发布 |
| eval-gap | 缺少质量回归基线 | 质量评测 |

不强制负责人 / 更新时间（无稳定数据源不造假）。

UI：标题 → 描述 → `影响：…` / `证据来源：…` 弱样式 → CTA。

## 7. 目标页 URL 同步与回写

### 7.1 Query 同步（强制）

| 页面 | Query | 行为 |
|---|---|---|
| `/catalog` | `completion`、`connection`、`schema`、`q` | mount 读入；变更 `setSearchParams(..., { replace: true })`；刷新/分享可复现 |
| `/admin/audit` | `tab`、`outcome`、`hours`、`user`、… | 已有；本单回归 `tab=calls&outcome=denied&hours=168` |
| `/admin/agents` | — | 路径正确即可 |
| `/overview` | `#overview-mcp` | MCP 接入 `id="overview-mcp"` |

**原子交付：** `opsDashboard` 新 `actionUrl` 与 Catalog query 同步 **同一 PR**；拆分发布视为不合格。

### 7.2 回写 / 刷新可见性（闭环收口）

用户从待办深链处理完返回 `/overview` 后：

1. **路由重新进入 `/overview`（含侧栏点回）**：自动 `refetch` 构建待办所用的既有 queries（与「刷新首页数据」同一组），使计数与待办列表更新。
2. **同页未离开**：不静默改数；依赖 Header「刷新首页数据」。
3. **不引入** 后台 interval auto-refresh（Spec 43）。
4. **不**在目标页写「已处理」本地标记；真实性以 sources/diff/audit/eval 数据为准。
5. 若 refetch 后该项 count 归零，该项从待办列表消失——这即「处理完成」的唯一信号。

验收：单测或组件测可模拟「返回 overview 触发 refetch」；不必浏览器 E2E。

## 8. Attu 式指标卡视觉（含小 icon）

### 8.1 参考

- [02-overview.png](https://github.com/zilliztech/attu/blob/main/.github/images/v3/02-overview.png)
- 借鉴视觉语法，不照搬指标集合。

### 8.2 视觉语法

| 元素 | 要求 |
|---|---|
| 布局 | 近似等宽卡；轻边框、圆角、充足内边距 |
| Icon | 左上角小号 outline ≈16px；`fg-muted`；不抢主值 |
| 标签 | 小字、次级色 |
| 主值 | 大号、高对比、`tabular-nums` |
| 次行 | 可选弱说明 |
| CTA | 卡外/卡底「↗」；icon 本身不可点 |

禁止：emoji icon、紫渐变/glow/重阴影、装饰性新指标、换皮恢复四卡健康条。

> **澄清（Spec 102）：** CTA 落位修订为**右侧垂直居中**（对齐「待处理事项」），不再要求卡底左对齐。详见 `102-overview-quality-risk-metric-row-unification-spec.md`。

### 8.3 Lucy 落位

| 区域 | icon 语义 | 主值 |
|---|---|---|
| 语义覆盖 | 图层/清单 | done/total |
| 待发布变更 | 上传/发布 | 文件数 |
| 评测数据 | 趋势/检查 | 近 30 天 runs |
| Agent 启用 | Agent | 启用/总数 |
| ACL 拒绝 | 盾牌/拒绝 | 近 7 天次数 |

扩展 `pl-metric-card` 的 `icon` 槽位；本单验收只卡 `/overview`。

### 8.4 Design System Compliance

PageHeader / panel / `pl-card-cta` / `pl-metric-card` / alert；状态不靠单色或单 icon；术语与 path `notranslate`。

## 9. 验收标准

- [ ] 仓库内 overview/opsDashboard **不生产** §5.0 弃用路径；`semantic-gap` = `/catalog?completion=incomplete`。
- [ ] Catalog：`completion=incomplete` 过滤正确；URL↔state 双向；与 overview 新链同 PR。
- [ ] 访问风险「近 7 天 ACL 拒绝」CTA = `/admin/audit?tab=calls&outcome=denied&hours=168`（或 Spec 106 的 `view=calls&range=7d`）；待处理事项 **不**含 `acl-deny`。
- [ ] `ActionRequiredItem` 每条含非空 `impact`/`evidence`；UI 可见。
- [ ] 返回 `/overview` 触发待办相关 refetch（§7.2）。
- [ ] Warning/Danger CTA 符合 §5.3。
- [ ] 快照指标卡含 outline icon（§8）。
- [ ] 测试锁定 Registry；`lint:terminology`；`build`；不做浏览器验证。

## 10. 对上游 Spec 的澄清

| Spec | 澄清 |
|---|---|
| 39 §7.2 | 目标改为 `/catalog?completion=incomplete` |
| 41 | impact/evidence 必填；负责人/时间仍可缺省 |
| 43 | 不恢复四卡健康条与 interval auto-refresh；允许进入页 refetch |
| 48 | Catalog URL 同步 + `incomplete` |
| 99 | 共享 §5 Registry；审计 `user=` vs 调试台 `agentId=` 映射见 §5.5 |

## 11. 实施分期

| Phase | 内容 | 必达 |
|---|---|---|
| 1 | Registry：`opsDashboard` actionUrl + 类型必填字段 + 测试 | 是 |
| 2 | Catalog URL 同步 + `incomplete`（与 Phase 1 同 PR） | 是 |
| 3 | 摘要/danger CTA + MCP 锚点；Onboarding 旧 audit 链对齐 Registry | 是 |
| 4 | 返回 overview refetch（§7.2） | 是 |
| 5 | impact/evidence UI | 是 |
| 6 | 快照 Attu 式 icon（§8） | 是 |
| 7 | Audit query 回归 + 台账 | 是 |
