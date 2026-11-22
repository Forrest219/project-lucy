# 页面打开与路由兜底分流 Spec

| 元数据 | 内容 |
|---|---|
| 文档名称 | 页面打开与路由兜底分流 Spec |
| 文档类型 / 版本 | Spec（事故修复 lite）／**v1.0** |
| 日期 / 目标版本 | 2026-11-22／产品线 `0.30.0` |
| 功能编号 / 优先级 | **P1-44**／REQ-030-065／**P1**。**不入核心分母** |
| 阶段 | S5 |
| 收口范围 | scoped：PO-01 27 页面＋PO-02 28 页签；调用流水 `auth_failure` 可渲染；兜底分流（chunk 加载失败才显示版本文案，普通渲染错误显示「本页出错」）。不含 PO-03 详情页、修复前负控实跑、线上升级 |
| 状态 | S5｜**v1.0；功能合同已收口（2026-11-22，scoped；B1）**。实现已提交 `c1f54f64`；测试台 PASS WITH GAP（55/55）；[收口记录](../reviews/2026-11-22-p158-p159-p142-p144-s5-closure-record.md)。不入核心分母。≠ 可上线 |
| 决策来源 | 委托人 2026-11-18 授权登错题、建 UAT、修正兜底；2026-11-22 勾选 B1（砍 NOT-RUN＋lite Spec）并授权改 Spec／收口 |
| 需求来源 | 错题 [audit-calls-render-crash-misreported](../lessons/2026-11-18-audit-calls-render-crash-misreported.md) |
| 实施计划 | [配对 Plan](../plans/lucy-20261122-page-open-error-boundary-plan.md) |
| 测试台 | [`UAT-SUITE-PAGE-OPEN`](../qa/uat/suites/page-open-exceptions/suite.md) |
| 输出位置 | `docs/specs/lucy-20261122-page-open-error-boundary-spec.md` |

## 闭口层级

- 层级：功能合同
- 本条承诺：侧栏二级入口与页签可打开；普通渲染异常不伪装成「版本已更新」；调用流水含 `auth_failure` 行不整页崩溃。
- 本条出口：scoped — 收口范围内已验用例。
- 不在本条出口：详情页穷举；修复前负控实跑；其它页面内容；线上升级。
- 上线关系：本条收口不表示可上线。

## Terminology Compliance

This feature follows `webui/docs/00-product-terminology-standard.md`. New terms: 「本页出错」（普通渲染兜底）；「页面资源加载失败，可能是版本已更新」（仅 chunk 加载失败）。禁止把普通渲染错误写成版本文案。

## 伪代码豁免

伪代码豁免：本条为事故修复归档 lite Spec，无新增独立算法模块；分流规则以单测 `route-chunk-boundary` 与提交 `c1f54f64` 为准。

## 交互合同豁免

- 原因：不改变用户可见 WebUI 表面；只改调用流水空值防护与路由错误边界分流文案，不改页面信息架构与路由表。
- 不改变：侧栏导航、页签结构、详情页合同；PO-03 详情穷举另期。

## 成功标准（scoped）

| ID | 标准 | 验证 |
|---|---|---|
| SC-01 | 侧栏二级页面可打开（无未捕获异常、有标题／正文、页面 `/api` 无 5xx） | UAT-PO-01（27） |
| SC-02 | 页签可打开（同判据） | UAT-PO-02（28） |
| SC-03 | `auth_failure` 行可渲染；故事线空 `tool` 不崩 | 单测＋调用流水页 PO-01 |
| SC-04 | `RouteChunkBoundary`：普通渲染→「本页出错」＋错误类别；仅 chunk 失败→版本文案 | 单测 `route-chunk-boundary` |

## 主路径可用性

合法用户打开访问日志／其它侧栏页不得因本条兜底变成不可用；重试只重置边界，不强迫整站刷新掩盖数据 bug。
