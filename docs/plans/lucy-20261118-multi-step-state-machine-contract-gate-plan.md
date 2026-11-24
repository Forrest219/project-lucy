# 多步流程状态机合同门禁 Plan

| 元数据 | 内容 |
|---|---|
| 文档类型 | 实施计划（Plan） |
| 版本 / 日期 | v0.1-draft / 2026-11-18 |
| 状态 | **S1｜v0.1-draft。与 Spec 同句：仅登记与起草，不开发；终稿未确权；未获开发授权；未授权不改运行代码与 lint；测试台 not_registered；不入核心分母；≠ 可上线** |
| 主 Spec | [`docs/specs/lucy-20261118-multi-step-state-machine-contract-gate-spec.md`](../specs/lucy-20261118-multi-step-state-machine-contract-gate-spec.md) |
| 总账 | **P1-48**／REQ-030-069；**不入核心分母** |
| 授权边界 | **当前不得改运行代码、不得改 lint。** 获终稿确权＋开发授权后，仅允许 Spec §8 白名单路径（`lint-spec-docs`、grandfather json、`DEVELOPMENT.md`、索引与本对文档）。不授权改 `webui/src`、`webui/server`、KTX 或附录盘点路径的业务实现 |
| 验收 | Spec SC-01–SC-12；夹具可打假；生产 grandfather 名单内现行 Spec 不因本规则误红（除非已写授权口令／标记行） |
| 落位依据 | [`docs/governance/DEVELOPMENT.md`](../governance/DEVELOPMENT.md)「强制流程：Plan Mode」「新增 Spec／Plan 的落盘清单」 |

## 目标

按 Spec v0.1 草案（终稿后以定稿为准）为「多步状态机合同」增加可解析文法与 `lint:spec-docs` 规则，并把指针写入 `DEVELOPMENT.md`。不修复任何业务运行时状态机。

## 开工前置

1. 已入总账 P1-48／REQ-030-069；Spec／本 Plan 已落盘。
2. **终稿确权**与 **开发授权**均未取得；取得前本 Plan 步骤 1 起不得执行。
3. OQ-1…OQ-4 已由委托人闭合，或明示沿用 Spec 倾向值并写入 Spec 定稿版。
4. 对照交互合同门禁落地先例：[`lucy-20261107-ui-interaction-contract-gate-plan.md`](lucy-20261107-ui-interaction-contract-gate-plan.md)（grandfather、授权口令、夹具形态）。

## 步骤

| 步骤 | 内容 | 验证 |
|---|---|---|
| 0 | 文档定稿：闭合 OQ；Spec／Plan 升正式版号；状态句同句；**仍不改 lint** | 人工；`lint:spec-docs` 形态自检 |
| 1 | （须开发授权）实现规则 `state-machine-contract`：解析按 Spec §4／§5，不另写字段集 | 夹具覆盖 SC-01–SC-09 |
| 2 | 新建 grandfather json＝落地提交时 `git ls-files docs/specs/*.md` | SC-07／SC-08 |
| 3 | `DEVELOPMENT.md` 落盘清单一行＋短节（触发／豁免／口令／逃生边／≠ 改运行时） | SC-10 |
| 4 | 附录盘点保持指针；若 OQ-3＝B，另开整改总账行（本 Plan 仍不改那些路径代码） | SC-12 |
| 5 | 路径白名单核对；全量 `lint:spec`／`lint:terminology`／`lint:ia-boundary`；本规则夹具绿 | SC-11／SC-14 等价 |

## 浏览器验证

不适用：不改变用户可见 WebUI 表面。

## 验收

与 Spec SC-01–SC-12 同一标准。不以「存量业务路径已有状态机散文」代替夹具。不以 UAT PASS 关单。

## 完成定义

- SC 证据可指回夹具与文 diff。
- Spec、Plan、总账、需求池、`docs/README.md`、`docs/plans/README.md` 状态句同句收口，并写明本条收口不表示可上线。
- **≠ 业务运行时已整改；≠ 可上线。**

## 风险

| 风险 | 处理 |
|---|---|
| 误伤大量存量 Spec | grandfather＋仅授权口令取消跳过；自愿标记行 |
| 作者写空转移表糊弄 | OQ-2＝B 时强制箭头行；评审仍人工读语义 |
| 把本条当成 Ops／MCP 运行时修复授权 | 授权边界与 §8 白名单写死；越权即本 Plan 未完成 |
| 与交互合同门禁口令混淆 | 共用「开发授权已获得」口令；规则名与小节标题分离 |
| 附录盘点被抄成「已合规」 | 表头写「≠ 已合规」；跟进状态禁止写 UAT PASS |
