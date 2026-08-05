# Overview Quality / Access Risk Metric Row Unification Spec

| 元数据 | 内容 |
|---|---|
| 文档名称 | Overview Quality / Access Risk Metric Row Unification Spec |
| 文档类型 | Spec |
| 版本 | v1.0 |
| 撰写日期 | 2026-08-05 |
| 撰写人 | Composer |
| 委托人 | zhangxingchen |
| 基于材料 | `/overview` 浏览器布局核查（质量快照 / 访问风险 / 待处理事项）；用户三点反馈；`webui/docs/100-overview-health-action-deeplink-loop-spec.md` §8；`webui/src/pages/Onboarding.tsx`；`webui/src/app/app.css` |
| 适用范围 | `/overview`「质量快照」「访问风险」六张指标卡的布局骨架与 CTA 位置；澄清 Spec 100 §8.2 CTA 落位 |
| 输出位置 | `webui/docs/102-overview-quality-risk-metric-row-unification-spec.md` |

| 字段 | 内容 |
|---|---|
| Spec 编号 | 102 |
| 关联工单 | `webui/docs/plans/wo-202608-35-overview-quality-risk-metric-row-unification.md` |
| 关联页面 | `/overview`（`ops-quality-snapshot` / `ops-access-risk`） |
| 关联台账 | `docs/ui-ux-feedback/pages/overview.md`（`UX-OVERVIEW-016`～`018`） |
| 上游 Spec | Spec 100 §8（Attu 式 icon + 主值）；Spec 41 / 43（系统概览快照区） |
| 状态 | Implemented |
| 日期 | 2026-08-05 |
| 范围 | 统一 Metric Row 骨架；CTA 右中对齐待处理事项；标题左上 / 数值左下；Token 卡对齐；语义卡保留 progress |

### Changelog

| 版本 | 变更 |
|---|---|
| v1.0 | 初稿并落地：统一质量/访问六卡布局与 CTA |

## 1. 背景

Spec 100 已为快照区补上 Attu 式 outline icon，但落地后仍存在三套并存模板：

1. **语义覆盖率**：单列 + progress，无 CTA，数值在标题下方。
2. **待发布 / 评测 / Agent / ACL**：双列 grid 把主值挤到右上，CTA 掉到左下。
3. **可用 Token**：无 icon、无 `pl-metric-card--with-icon`，CTA 碰巧在右中。

浏览器测量确认与「待处理事项」不对齐：待办行 CTA 为右侧垂直居中；快照区多数 CTA 在左下。用户反馈三点均属实。

本 Spec **修订** Spec 100 §8.2 中「CTA 卡外/卡底」为：**CTA 右侧垂直居中**（对齐待处理事项）。Icon / 标签 / 主值语义不变。

## 2. 目标

1. 「质量快照」「访问风险」六卡共用同一 **Ops Metric Row** 骨架。
2. 每卡：**标题左上**（icon + 标签）→ **主值左下**（与标题有明确垂直间距）→ 可选 hint / progress → **CTA 右侧垂直居中**。
3. 「可用 Token」补齐 icon + 主值层级，不再特例布局。
4. 「语义覆盖率」保留 progress 与 a11y `role="progressbar"`，并补 Registry CTA（`/catalog?completion=incomplete`）。
5. 两栏各三行视觉节奏接近（统一 `min-height`）。

## 3. 非目标

| 非目标 | 理由 |
|---|---|
| 不改计数口径 / API / 深链 Registry 路径形态 | Spec 100 已定；本单只动布局 |
| 不恢复四卡服务健康条 | Spec 43 |
| 不改「待处理事项」行结构 | 本单以其为 CTA 参考，不反向改待办 |
| 不落地 Spec 101 刷新 icon-btn（`UX-OVERVIEW-015`） | 独立工单 |
| 不做浏览器验证（本轮） | Vitest + terminology + build + code review |

## 4. Terminology Compliance

Follows `webui/docs/00-product-terminology-standard.md`.

无新增产品概念。既有术语与 deep link 文案保持：

| UI | 说明 |
|---|---|
| 语义覆盖率 / 待发布变更 / 评测数据 | 质量快照既有 |
| Agent 启用与禁用 / 近 7 天 ACL 拒绝 / 可用 Token | 访问风险既有 |
| 查看语义资产 ↗ / 打开发布工作台 ↗ / … | CTA；`Agent` / `Token` / `MCP` 等 `notranslate` |

## 5. 统一骨架（Ops Metric Row）

```text
┌──────────────────────────────────────────────────────────┐
│  [icon] 标题                              CTA ↗（右中） │
│                                                          │
│  主数值（tabular-nums）                                  │
│  可选：progress / 次行说明                               │
└──────────────────────────────────────────────────────────┘
```

| 元素 | 要求 |
|---|---|
| 容器 | 统一 class（如 `.pl-ops-metric-row`）；`grid`：`minmax(0,1fr) auto`；`min-height` 统一（约 6rem） |
| Icon | 延续 Spec 100：outline ≈16px、`fg-muted` |
| 标题 | 左上；弱字色 |
| 主值 | 左下；`text-xl` + `tabular-nums`；禁止再把主值放到右列 |
| 标题↔主值间距 | ≥ `gap-2`（约 8px），形成扫读层级 |
| CTA | 右列 `align-self: center`；`pl-card-cta` + `↗`；与待处理事项同级视觉 |
| Tone | `default` / `warning` / `danger` 仅改边框/底色，不改变骨架 |

### 5.1 六卡映射

| 卡 | Icon | 主值 | 次行 / extra | CTA |
|---|---|---|---|---|
| 语义覆盖率 | Layers | `N%` | progress + `done/total …` | 查看语义资产 ↗ → `DEEP_LINKS.catalogIncomplete` |
| 待发布变更 | Upload | 文件数 | 审阅状态说明 | 打开发布工作台 ↗ |
| 评测数据 | Activity | 近 30 天 runs | 有无评测说明 | 查看趋势监控 ↗ |
| Agent 启用与禁用 | Users | `启用 / 总数` | 启用 / 总数 | 查看 Agent 管理 ↗ |
| 近 7 天 ACL 拒绝 | ShieldAlert | 次数 | 次拒绝 | 查看访问日志 ↗ |
| 可用 Token | KeyRound（或等价） | 可用个数 | `N 个可用 Token` 可并入主值/次行 | 管理 Token ↗ → `/admin/agents` |

### 5.2 对 Spec 100 §8.2 的澄清

| 原表述 | 本 Spec |
|---|---|
| CTA 卡外/卡底 | **CTA 右侧垂直居中**（对齐待处理事项） |
| Icon / 标签 / 主值 | 不变 |

## 6. 实现约束

1. 抽取共用组件（如 `OpsMetricRow`），禁止六份分叉 markup。
2. 收敛或废弃导致「主值右上、CTA 左下」的 `.pl-snapshot-item` / `.pl-risk-item` 双列隐式排布；列表容器可保留。
3. 深链仍只使用 Spec 100 Registry；禁止新造半截 URL。
4. 语义 progress 的 `aria-valuenow/min/max` 与 `aria-label` 不得回退。

## 7. Design System Compliance

- Panel / `pl-metric-card` / `pl-card-cta` / outline icon。
- 专业术语与 path：`notranslate` + `translate="no"`。
- 状态 tone 不只依赖颜色；danger/warning 仍有文案。

## 8. 验收标准

- [ ] 六卡共用同一行骨架；Token 含 icon。
- [ ] 主值均在左侧标题下方；CTA 均在右侧垂直居中。
- [ ] 语义卡保留 progress a11y；CTA → `/catalog?completion=incomplete`。
- [ ] `onboarding.test.tsx` 覆盖布局/CTA/进度；`lint:terminology`；`build`。
- [ ] 台账 `UX-OVERVIEW-016`～`018` → `Fixed`；本轮不做浏览器验证。

## 9. 台账与主题

| ID | 摘要 |
|---|---|
| UX-OVERVIEW-016 | 质量快照 / 访问风险不对称 |
| UX-OVERVIEW-017 | 快照 CTA 未对齐待处理事项右中 |
| UX-OVERVIEW-018 | 标题应左上、数值应左下并拉开间距 |

跨页面主题：`ops metric-row symmetry`（CTA 右中 + 主值左下）。
