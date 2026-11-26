# REQ-0120 Plan／UAT 对抗评审记录

| 元数据 | 内容 |
|---|---|
| 评审对象 | [Plan](../plans/lucy-20261127-asset-list-zoom-ux-plan.md)／[`UAT-SUITE-ASSET-LIST-ZOOM`](../qa/uat/suites/asset-list-zoom/suite.md)（cases／fixtures／INDEX 行） |
| 对照基准 | [Spec v1.0 终稿](../specs/lucy-20261127-asset-list-zoom-ux-spec.md)；[`CONVENTIONS.md`](../qa/uat/CONVENTIONS.md)；[`DEVELOPMENT.md`](../governance/DEVELOPMENT.md) 浏览器＋计时 |
| 评审人 | Kimi Code（委托人 xingchen 授权，最多三轮；`-p` 输出由主会话落盘并应用补丁） |
| 日期 | 2026-11-27 |
| 最终结论 | **Approve with nits** |

## 轮次 1

**结论：Request changes（5 项阻断）。** Plan↔SC↔UAT 主链完整；假绿防线在套件边界已有，但 cases／fixtures 有可绕过或永久 BLOCKED 漏洞。

| # | 级别 | 位置 | 问题 |
|---|---|---|---|
| B1 | 阻断 | cases `UAT-ALZ-02` | 「DOM／测试探针」可被读成 vitest/jsdom |
| B2 | 阻断 | suite 必做表 vs cases `UAT-ALZ-09/10` | 挂 SC-14 但步骤无搜索引导断言 |
| B3 | 阻断 | fixtures | ALZ-07／09 无造数入口与降级授权指针 |
| B4 | 阻断 | suite 可选 ALZ-13 | SC-10 无证据路径／SKIPPED 纪律 |
| B5 | 阻断 | cases `UAT-ALZ-04` | P1-80 诚实检查标可选 |
| N1 | nit | suite 边界 | 未引用 CONVENTIONS 降级授权 |
| N2 | nit | cases `UAT-ALZ-10` | Spec E14 已选摘要分页无步骤 |
| N3 | nit | fixtures | ALZ-07 无 Schema 数前置核对 |

**对抗反例摘要**：vitest 冒充浏览器（B1）；角色分页漏引导仍 PASS（B2）；lean 永久 BLOCKED（B3）；SC-10 无证据收口（B4）；加载文案假阴性漏检（B5）。

### 轮次 1 修订

补丁已落入 cases／fixtures／suite（见主会话应用）；未改 Spec 合同与运行代码。

## 轮次 2

**结论：B1–B5 闭合。** 复审依据＝修订后 cases／fixtures／suite 措辞；补充抽查造数污染、计时冒充、规模基线误主张均闭合。无新增阻断。

## 轮次 3

**最终结论：Approve with nits。**

- Plan 维持 v1.0 定稿态（未获开发授权；浏览器验证未执行；INDEX＝NOT RUN）。
- 任务↔SC↔UAT 无孤儿。
- 假绿防线：套件边界 + 步骤级 + 夹具级。

**残留 nit**：R1 单元格搜索可发现性；R2 Ctrl+F 执行纪律。  
**残留 OQ**：OQ-1 lean Schema／候选实际数；OQ-2 Agent 预览可达性——跑次按 fixtures 造数／降级规则处理。

## 变更摘要

| 文件 | 修订 |
|---|---|
| `cases.md` | B1／B2／B5／N2 |
| `fixtures.md` | B3／N3 |
| `suite.md` | B4／N1／对抗结论元数据 |
| INDEX | 可选同步对抗一句 |
