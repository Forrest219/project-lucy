# Lucy 0.30 — 用户旅程性能门禁 Plan

| 元数据 | 内容 |
|---|---|
| 文档类型 / 版本 | 实施计划 / v0.1-draft（随 Spec v0.1-draft；**未确权、未授权，不落地**） |
| 日期 | 2026-11-20 |
| 功能编号 | P1-67／REQ-030-088 |
| 授权状态 | 仅登记与设计授权；开发／执行／CI 改动授权须另行明示 |
| 状态 | S1｜v0.1-draft。委托人2026-11-20授权登记与 Spec／Plan 设计；终稿未确权；开发未授权；测试台未建；不入核心分母；≠ 功能收口；≠ 可上线。 |
| 授权边界 | 只写设计与登记；不改 workflow／runner 运行代码、不建测试台、不执行任何性能跑次。 |
| 验收 | Spec SC-01–SC-08 全过；首跑后预算设计值转实测冻结值须具名评审。 |
| 关联 | [Spec](../specs/lucy-20261120-user-journey-performance-gate-spec.md)；[KSC 错题](../lessons/2026-11-20-ksc-025-roles-agents-stuck-old-build.md) |

## 目标

把用户视角三维度性能（API／WebUI 交互／MCP 问询）变成**每次提交与每次发版的自动门禁**，并补上版本漂移对账；复用既有 `perf:entry`／`perf:release-baseline` 与 PDS 探针方法学，不新造轮子（Spec D1）。

## 阶段（各自独立授权）

### W1 文档与预算冻结（纯文档，可在确权后进行）

1. 建 `docs/qa/uat/suites/user-journey-perf/`（suite/cases/fixtures，编号 `UAT-UJP-*`）；fixtures 写入三维度预算线与 payload 字节预算，数值标注设计值并挂"待实测冻结"。
2. runbook 增补：版本性能特性对照表（0.25.0／3a9f0711／1fb73f72）＋ KSC 症状速查（Spec D6）。
3. INDEX／CONVENTIONS／e2e-ledger 登记新套件（横线 `UAT-UJP-*`）。

### W2 CI 门禁接入（**需开发授权**：改 workflow 与 runner 包装）

1. `perf:entry --tier ci-small` 接入 `lucy-ci.yml` 为硬步骤：严格超时（建议 2× 预算上界）、失败即红（SC-01/SC-08）。
2. `perf:release-baseline --tier release-medium` 接入 `lucy-release.yml` 发版前步骤；正式基线 seed 走既有 `perf:release-baseline:formal-seed`。
3. runner 现状核查：确认两 runner 在 HEAD 上可无人值守跑通（本阶段只修"跑不通/会挂死"，不改测量逻辑）。
4. 负控演练：临时注入 2× 延迟提交，验证门禁变红（SC-01 证据）。

### W3 MCP 问询维度补齐（**需开发授权**：新 runner 或扩展）

1. 新脚本 `scripts/uat/mcp-query-latency.mjs`：真实 MCP Proxy＋fixture token＋只读小表问题，begin→query 全链路分位统计；夹具数据分档（空/小/中）。
2. 预算：端到端 p95 设计值写入 fixtures；网关/冷启动窗口单列。
3. 负控：仅 initialize 无 query 的记录被判无效（SC-03）。

### W4 部署对账（**需开发授权**：脚本 + 可选调度）

1. `scripts/ops/version-reconcile.mjs`：读发版台账与现场 `/api/health`（只读），落后超阈值输出告警（Spec D5）；演示告警（SC-05）。
2. 发版 checklist 增补"发布后登记现场 gitSha"一步。

### W5 UAT 跑次与收口

1. 按 `UAT-UJP-*` cases 执行首跑（三维度 + 交互深度），证据进 runs/；预算设计值 → 实测冻结值走具名评审（Spec D2）。
2. SC-01–SC-08 全过 → Spec 收口申报；≠ 可上线。

## 不做（边界）

- 不改任何性能优化代码（P1-66 等各自合同）；不动 perf runner 的测量语义；
- 不对现场施压、不自动升级现场；不把门禁结果当作发布签字（发版归 release 流程）。

## 风险

- CI 时长增加 → ci-small 档 + 严格超时兜底（SC-08）。
- runner 在新代码上假绿（桩失效）→ W2 先无人值守试跑 + 负控注入。
- 预算线拍脑袋 → 全部标注设计值，首跑后走评审冻结，不追样本抬线。

## 开工前置

- 委托人批准 Spec 定稿并逐项明示授权（W1 文档 / W2 CI 接入 / W3 MCP runner / W4 对账脚本各自独立）；
- `perf:entry`／`perf:release-baseline` 在 HEAD 无人值守跑通；demo Docker 与本机 Chrome 可用；
- UJP 套件目录建立并登记 INDEX／CONVENTIONS／e2e-ledger。

## 验收

- 每阶段交付物：W1 套件文档＋对照表；W2 接入门禁的 CI 绿链＋负控红链证据；W3 MCP 分位报告＋负控；W4 告警演示；
- 最终：Spec SC-01–SC-08 全过，预算线完成实测冻结。

## 完成定义

- 门禁随 CI 生效并产生第一条真实看护记录；SC 全过申报收口；
- 不等于任何现场升级完成，不等于发布签字。

## 浏览器验证

不适用：本条不改变用户可见 WebUI 表面；工程报告与只读对账不新增 Lucy 页面。此豁免仅针对新增界面交互合同，不豁免 W5 对既有页面的真实前台浏览器性能计时；该验证须另获执行授权，当前未执行。
