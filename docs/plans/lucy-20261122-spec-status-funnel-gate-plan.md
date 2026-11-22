# Spec 开发台状态漏斗门禁 Plan

| 元数据 | 内容 |
|---|---|
| 文档类型 | 实施计划（Plan） |
| 版本 / 日期 | v1.0 / 2026-11-22 |
| 状态 | S5｜v1.2。功能合同已收口（2026-11-22，P1-73／P1-35 S5 收口批）。开发授权已获得；Wave A／B 已落地；v1.1 MIG＋`inventory-stage`；**v1.2 降熵 A＋B＋C**（D8／D8b）。SC-01–SC-15＋实现 CR PASS。伞级事实源＝漏斗 Spec。测试台 not_registered；不入核心分母。本条收口不表示可上线 |
| 主 Spec | [`docs/specs/lucy-20261122-spec-status-funnel-gate-spec.md`](../specs/lucy-20261122-spec-status-funnel-gate-spec.md) v1.0 |
| 姊妹建议书 | [`lucy-20261122-spec-status-vocabulary-chinese-plan.md`](lucy-20261122-spec-status-vocabulary-chinese-plan.md)（`status-vocab`；伞下 Wave A；不另开总账行；状态句为伞级子句） |
| 总账 | **P1-73**／REQ-030-094；**不入核心分母**；双规则 `status-funnel`＋`status-vocab` |
| 授权边界 | 开发授权已获得；落地限 Spec §8 白名单。不授权改 `webui/src`、`webui/server`、KTX；全仓 Spec 散文迁移须另列文件并授权。本条已收口 ≠ 可上线 |
| 验收 | Spec SC-01–SC-15（funnel）；姊妹建议书 §6.2（vocab，若同批授权）；夹具可打假；grandfather 内现行 Spec 不因 funnel 误红 |
| 落位依据 | [`docs/governance/DEVELOPMENT.md`](../governance/DEVELOPMENT.md)「强制流程：Plan Mode」「新增 Spec／Plan 的落盘清单」 |

## 目标

按 Spec v1.0 落地开发台状态**双规则**：可解析阶段字典（`status-funnel`）＋状态行英文禁用词（`status-vocab`）。共享 lint 实现；禁止第二份词表／字典拷贝。Wave B **必接** PR CI。不把 UAT／可上线写入阶段；不修复任何业务运行时。

## 开工前置

1. 已入总账 P1-73／REQ-030-094；Spec／本 Plan／姊妹建议书已交叉链接并入索引。
2. **终稿已确权**；**开发授权已获得**（委托人 2026-11-22 授予 P1-73／REQ-030-094）；本 Plan 步骤 1 起可执行。
3. OQ-1…OQ-7 与姊妹建议书 §6.1 已闭合（见 Spec §7／建议书 §6.1）。
4. 对照先例：交互合同门禁、状态机合同门禁；CI 缺口见姊妹建议书 §4.3。

## 步骤

| 步骤 | 内容 | 验证 |
|---|---|---|
| 0 | 文档定稿：闭合 OQ／评审 blocker；Spec／Plan／姊妹建议书升 v1.0；**仍不改 lint** | 人工；形态自检 |
| 1a | （~~须开发授权；~~已获开发授权 2026-11-22；Wave A）实现 `status-vocab`：按姊妹建议书 §3（仅英文 deny-list＋`Status` 表头；**不**报缺状态行）；清存量 `Draft`；`lint:status-vocab` 挂 `lucy-ci.yml`；登记 `test-layers-and-release-gates.md` | 姊妹 §6.2 |
| 1b | （~~须开发授权；~~已获开发授权 2026-11-22；Wave B）实现 `status-funnel`：按 Spec §4／§5；**同批**把含本规则的检查接入 `lucy-ci.yml`（全量 `lint:spec-docs` 或导出子集） | SC-01–SC-12；SC-15 |
| 2 | 新建 funnel grandfather json：**落地提交前**对 `git ls-files docs/specs/*.md` 快照；落地提交内新建 Spec **不进**名单；本批次落地提交内不得另建新 Spec 逃检 | SC-09／SC-10；D9 |
| 3 | `DEVELOPMENT.md`：措辞中文子节＋漏斗阶段子节＋落盘清单条目（可同次） | SC-13 |
| 4 | OQ-2＝A：总账镜像检查不做；总账进 lint＝v1.1 | 跳过 |
| 5 | Hook：OQ-5＝A 则不做 | — |
| 6 | 路径白名单＝Spec §8（含 `package.json`、`lucy-ci.yml`、`test-layers-and-release-gates.md`）；`lint:spec-docs:test` 绿；funnel 不误伤 grandfather；**全量 `lint:spec-docs` exit 0 不作为本条验收** | SC-14 |
| 7 | （另授权）MIG 批补 `| 阶段 |` | 迁移勾销；≠ 本条 SC 代替 |

## 浏览器验证

不适用：不改变用户可见 WebUI 表面。

## 验收

与 Spec SC-01–SC-15 同一标准。不以「存量 Spec 散文已能人工读懂」代替夹具。不以 UAT PASS 关单。不以「系统可上线」作为本条完成条件。

## 完成定义

- SC 证据可指回夹具与文 diff。
- Spec、Plan、总账、需求池、`docs/README.md`、`docs/plans/README.md` 伞级状态／阶段句同句收口，并写明本条收口不表示可上线；建议书状态为伞级子句，不另占总账镜像位。
- **≠ 全仓 Spec 已迁移；≠ 业务运行时已改；≠ 可上线。**

## 风险

| 风险 | 处理 |
|---|---|
| 误伤大量存量 Spec | grandfather＋仅授权口令／标记行取消跳过；名单在落地提交前生成 |
| 「状态」长文与阶段码双源 | D4 显式未收口短语表；评审要求改状态时同改阶段 |
| 把 S5 当成可上线 | D5／闭口层级「上线关系」；否定式 `≠ 可上线` 显式允许；X_REL 隔离发布取证 |
| 总账表解析脆弱 | OQ-2＝A；总账检查延后 |
| 迁移批冒充本条收口 | 附录写「≠ 已迁完」；迁移须另授权与文件列表 |
| Wave B 只进发版流水线 | D12／SC-15：Wave B 必接 `lucy-ci.yml` |
| 复制判定进 hook | D18：本条不做 hook |
