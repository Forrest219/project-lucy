# 访问日志问询记录列密度 Spec

| 元数据 | 内容 |
|---|---|
| 文档类型 / 版本 | 呈现修订 / **v0.3** |
| 日期 / 目标版本 | 2026-11-02 / 不绑定产品版本号。不进入 v0.25 升级台账，不占用 `L25-*` |
| 功能编号 / 优先级 | **无** / **P2**（访问日志问询记录表局部密度 polish） |
| 状态 | **v0.3 已实施，功能合同未收口。本条收口不表示可上线**。S0–S3 已落地；SC-01–SC-07 组件测通过；SC-08 三视口证据见 `inbox/audit-turns-column-density-20261102/`。v0.3 补：客户端 / 会话 ID 表头与单元格允许换行；问询时长改为上下双行（问询跨度上、执耗时下） |
| 决策来源 | 对 `http://127.0.0.1:55176/admin/audit` 问询记录表的走查：问询 ID 仍按旧 UUID 预留过宽；开始时间单行占宽；问询时长与问询种类偏挤；关联调用数与预算终止次数表头偏宽；结果徽章列过窄 |
| 需求来源 | 列宽按方向调整（收窄 ID / 时间 / 两计数列，放宽时长 / 种类 / 结果）；开始时间改为日期上、时分秒下；倍数可微调，以实际显示效果为准；在 1280×800、1512×982、1920×1080 三档视口验收优于改前 |
| 实施主体 | Lucy WebUI 前端：`Audit.tsx` 与 `app.css`。不修改 KTX、审计读取 API、CSV |
| 落位依据 | [`docs/governance/DEVELOPMENT.md`](../governance/DEVELOPMENT.md)「Spec 落位规则」 |
| 与既有 Spec 的关系 | 不改问询种类、流水号问询 ID、来源徽章与结果八桶语义。字段名与术语沿用 [`lucy-20261102-audit-inquiry-kind-spec.md`](lucy-20261102-audit-inquiry-kind-spec.md) 与术语标准 §4.7。配置审计表的 `table-layout: fixed` + 列宽类是布局先例 |
| 实施计划 | [`docs/plans/lucy-20261102-audit-turns-column-density-plan.md`](../plans/lucy-20261102-audit-turns-column-density-plan.md) |

## 闭口层级

- 层级：功能合同
- 本条承诺：问询记录表在桌面三档视口下，问询 ID 与开始时间更紧凑、问询时长与问询种类更易读、关联调用数与预算终止次数表头可换行且列更窄、结果列足够展示状态徽章；开始时间单元格为日期在上、时分秒在下。
- 本条出口：SC-01–SC-08。组件测试打假列 class、双行时间 DOM、表头换行 class；三档视口截图与列宽对比入 `inbox/`，人工判定显示效果优于改前基线。
- 不在本条出口：调用流水列宽、CSV / 字段说明、抽屉布局、移动窄屏、客户镜像、部署、功能合同收口签字。
- 上线关系：本条收口不表示可上线

---

## Terminology Compliance

This feature follows `webui/docs/00-product-terminology-standard.md`.

New terms:

- None. 不新增产品概念。沿用问询 ID、开始时间、问询时长、问询种类、关联调用数、预算终止次数、结果、来源。

Forbidden:

- 改列头中文名或引入第三种来源徽章。
- 把关联键重新展示进列表问询 ID 列。
- 为密度调整改写结果八桶文案。

`Agent`、问询 ID、会话 ID 继续使用既有 `translate="no"` / `notranslate`。

## Design System Compliance

### Referenced Specs

- `webui/docs/design-system/00-principles.md`
- `webui/docs/design-system/20-patterns-page-layout.md`
- `webui/docs/design-system/30-pr-compliance-template.md`

### What This Change Follows

- [x] 沿用 `pl-data-grid` / `pl-audit-table` / 横向有界滚动，不新做表格控件族
- [x] 列宽用既有 `pl-audit-turns-col-*` 命名，与配置审计 `pl-config-audit-col-*` 同模式
- [x] 开始时间复用已有 `AuditDateTime` / `.pl-audit-date-time`，不新增时间组件
- [x] 不改 PageHeader、页签、筛选条、导出入口
- [x] 颜色与字号沿用审计表 12px 密度 token，不新增硬编码色值

### Exceptions (If Any)

- None

### Follow-up Needed

- None

---

## 伪代码豁免

本条是纯布局与时间单元格呈现 polish，无权限 / 状态机 / 跨模块数据流分支。豁免「核心流程（伪代码）」；列宽与呈现规则以下文章节与 SC 为准。

---

## 1. 背景

改前在约 1058×921 视口实测（问询记录表可横滚）：

| 列 | 约宽 (px) | 问题 |
|---|---|---|
| 问询 ID | 176 | `.pl-audit-turn-id-cell` 仍按 UUID 预留 14rem |
| 开始时间 | 148 | 单行 `YYYY/M/D HH:mm:ss` |
| 问询时长 | 73 | `1 m 8 s · 执 …` 易挤 |
| 问询种类 | 73 | 「未上报问询」偏紧 |
| 关联调用数 | 86 | 表头四字单行占宽，数值只需窄列 |
| 预算终止次数 | 98 | 同上 |
| 结果 | 60 | 多枚状态徽章叠挤 |

## 2. 目标

1. 问询记录表启用 `table-layout: fixed`，为密度相关列写入显式宽度类。
2. 方向（倍数可微调，以观感为准）：
   - 问询 ID：明显收窄
   - 开始时间：双行（日期上、时分秒下）并略收
   - 问询时长、问询种类：放宽
   - 关联调用数、预算终止次数：收窄，表头允许换行
   - 结果：明显放宽（约 2× 量级）
3. 三档视口 1280×800、1512×982、1920×1080 下显示效果优于改前基线截图。

## 3. 非目标

| 不做 | 原因 |
|---|---|
| 改调用流水列宽 | 本条只覆盖问询记录 |
| 改 API / CSV / 筛选语义 | 纯呈现 |
| 消灭横向滚动 | 列多时横滚仍合法 |
| 移动窄屏专项 | 项目默认不要求；不在本条出口 |

## 4. 建议列宽（可在实施中微调）

根字号按 16px 计。实施后若观感不佳，允许在同方向内微调 rem，不必锁死下表小数。

| 列 class | 建议 width | 备注 |
|---|---|---|
| `pl-audit-turns-col-id` + `.pl-audit-turn-id-cell` | ~7rem | 覆盖旧 14rem 单元格宽 |
| `pl-audit-turns-col-time` | ~6rem | 单元格用 `AuditDateTime` |
| `pl-audit-turns-col-duration` | ~7.5rem | |
| `pl-audit-turns-col-kind` | ~5.75rem | 新建 class |
| `pl-audit-turns-col-calls` | ~3.5rem | 表头可换行 |
| `pl-audit-turns-col-budget` | ~3.75rem | 新建 class；表头可换行 |
| `pl-audit-turns-col-result` | ~9rem | |

未点名的列保持可读默认；为 `fixed` 布局可补合理默认宽，但不改变本条承诺方向。

## 5. 验收（SC）

| ID | 断言 |
|---|---|
| SC-01 | 问询记录表有 `pl-audit-turns-table`，且 `table-layout` 为 fixed（CSS） |
| SC-02 | 「问询 ID」列与单元格宽度明显小于改前 UUID 预留；流水号与复制仍可用 |
| SC-03 | 「开始时间」单元格含 `.pl-audit-date-time`，`data-part="date"` 在上、`data-part="time"` 在下 |
| SC-04 | 「问询时长」「问询种类」列宽大于改前同视口基线（方向：放宽） |
| SC-05 | 「关联调用数」「预算终止次数」表头无强制 `whitespace-nowrap`（或具备允许换行的 class），列宽小于改前同视口基线（方向：收窄） |
| SC-06 | 「结果」列宽约为改前同视口的 2× 量级，多徽章不再被压到约 60px |
| SC-07 | `admin-audit-turns` 组件测试覆盖 SC-01/SC-03/SC-05 的 DOM class 断言 |
| SC-08 | 三档视口 1280×800 / 1512×982 / 1920×1080 各有改前基线与改后对比截图（或列宽 JSON）落在 `inbox/`，人工判定优于改前 |

## 6. 完成定义

- Spec / Plan 已登记 `docs/README.md` 与 `docs/plans/README.md`
- S1–S2 代码落地；SC-01–SC-07 自动化或可复现断言通过
- SC-08 三视口证据已写入 `inbox/`
- demo 容器已平滑升级（保留 volume）；WebUI 可打开
- 未宣称功能合同收口，未宣称可上线
