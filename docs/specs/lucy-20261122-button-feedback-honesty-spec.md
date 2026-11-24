# 按钮级成功反馈真实性 Spec（下载／保存／导出）

| 元数据 | 内容 |
|---|---|
| 文档名称 | 按钮级成功反馈真实性 Spec |
| 文档类型 / 版本 | Spec（事故修复 lite）／**v1.0** |
| 日期 / 目标版本 | 2026-11-22／产品线 `0.30.0` |
| 功能编号 / 优先级 | **P1-42**／REQ-030-063／**P1**。**不入核心分母** |
| 阶段 | S5 |
| 收口范围 | scoped：必做 BTN-01–06／08–10 REAL；S01／S02；G1；BTN-07＝HONEST-FAILURE（失败诚实）。不含 6 入口 NOT-RUN、BTN-07 成功下文件、低权限／网络／`runtimeAck=false`／超大文件（单测保留） |
| 状态 | S5｜**v1.0；功能合同已收口（2026-11-22，scoped；B1）**。实现已提交 `f1436556`；测试台改后 PASS WITH GAP；[收口记录](../reviews/2026-11-22-p158-p159-p142-p144-s5-closure-record.md)。不入核心分母。≠ 可上线 |
| 决策来源 | 委托人 2026-11-17 C 档授权；2026-11-22 勾选 B1（砍 NOT-RUN＋lite Spec）并授权改 Spec／收口 |
| 需求来源 | 错题 [button-feedback-silent-failure](../lessons/2026-11-17-button-feedback-silent-failure.md)；前序 P1-40 |
| 实施计划 | [配对 Plan](../plans/lucy-20261122-button-feedback-honesty-plan.md) |
| 测试台 | [`UAT-SUITE-BUTTON-FEEDBACK`](../qa/uat/suites/button-feedback/suite.md) |
| 输出位置 | `docs/specs/lucy-20261122-button-feedback-honesty-spec.md` |

## 闭口层级

- 层级：功能合同
- 本条承诺：下载／保存／导出类按钮的成功反馈以可观察结果为前提；失败诚实提示，不静默、不假成功。
- 本条出口：scoped — 收口范围内已验用例；登记门禁 `lint:button-feedback`。
- 不在本条出口：导出内容对错、业务逻辑、6 入口 NOT-RUN、BTN-07 成功路径、线上升级。
- 上线关系：本条收口不表示可上线。

## Terminology Compliance

This feature follows `webui/docs/00-product-terminology-standard.md`. New terms: none.

## 伪代码豁免

伪代码豁免：本条为事故修复归档 lite Spec，无新增独立算法／状态机；实现与验收以既有提交 `f1436556` 与测试台为准。

## 交互合同豁免

- 原因：不改变用户可见 WebUI 表面；只改既有下载／保存／导出按钮的结果判定与 Toast／下载反馈语义，不改路由、布局与信息架构。
- 不改变：页面路由、页头、导航、表单结构；导出内容对错与业务逻辑。

## 成功标准（scoped）

| ID | 标准 | 验证 |
|---|---|---|
| SC-01 | 可点下载入口 REAL（收到非空、文件名匹配、非错误体） | UAT-BTN-01–06／08–10 |
| SC-02 | 真实失败时 HONEST-FAILURE（无文件＋界面说明原因） | UAT-BTN-07（demo 409） |
| SC-03 | 保存类成功／冲突诚实 | UAT-BTN-S01／S02 |
| SC-04 | 新下载入口须登记进门禁表 | UAT-BTN-G1／`lint:button-feedback` |

## 主路径可用性

本条不新增拒绝条件；失败诚实不得把合法成功路径改成不可用。
