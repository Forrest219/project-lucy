# 页面打开与路由兜底分流 Plan（P1-44）

| 元数据 | 内容 |
|---|---|
| 文档名称 | 页面打开与路由兜底分流 Plan |
| 文档类型 | Other（实施 Plan／lite） |
| 版本 | v1.0 |
| 撰写日期 | 2026-11-22 |
| 撰写人 | Cursor Agent |
| 委托人 | xingchen |
| 基于材料 | [Spec](../specs/lucy-20261122-page-open-error-boundary-spec.md)；错题；UAT suite |
| 适用范围 | P1-44／REQ-030-065 事故修复归档与 scoped 收口 |
| 状态 | S5｜**v1.0；功能合同已收口（2026-11-22，scoped；B1）**。实现已提交 `c1f54f64`。[收口记录](../reviews/2026-11-22-p158-p159-p142-p144-s5-closure-record.md)。≠ 可上线 |
| 授权边界 | 委托人 2026-11-22 B1＋改 Spec／收口；**未授权**补跑 PO-03、push、发布、客户出包 |
| 验收 | Spec SC-01–04；测试台 INDEX |
| 输出位置 | `docs/plans/lucy-20261122-page-open-error-boundary-plan.md` |

## 1. 目标

调用流水不因 `auth_failure` 崩溃；路由兜底不再把普通渲染错误伪装成版本问题。

## 2. 开工前置

- [x] 错题已登记；修复已提交 `c1f54f64`
- [x] 测试台 `UAT-SUITE-PAGE-OPEN` 55/55 PASS WITH GAP
- [x] 委托人 2026-11-22 勾选 B1 并授权 lite Spec／收口

## 3. 已完成步骤（归档）

1. 调用流水空值防护＋`RouteChunkBoundary` 分流；单测 15 项通过。
2. `UAT-SUITE-PAGE-OPEN` 55/55 PASS；提交 `c1f54f64`。
3. 2026-11-22 scoped S5：PO-03 详情页等写入收口范围。

## 4. 验收

- Spec SC-01–04 与测试台 INDEX 一致。
- PO-03 详情页不阻塞本条 S5。

## 5. 完成定义

- Spec／Plan／总账／需求池／README／e2e 同句镜像 S5 scoped。
- `lint:status-funnel`／`lint:inventory-stage` 通过；lite Spec 形态门禁通过。

## 6. 风险

| 风险 | 处理 |
|---|---|
| 普通渲染仍显示版本文案 | 单测 `route-chunk-boundary`＋PO 套件看守 |
| 误把 PO-03 当收口缺口 | 收口范围与收口记录写明砍掉项 |

## 7. 非目标

不补跑详情页；不线上升级；不宣称可上线。

## 浏览器验证

不适用：本条交互合同豁免；既有前台 UAT 已在测试台归档，本 Plan 不再另开浏览器验证任务。
