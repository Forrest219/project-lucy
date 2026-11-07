# WebUI 交互合同门禁 实施 Plan

| 元数据 | 内容 |
|---|---|
| 文档类型 | 实施计划（Plan） |
| 版本 / 日期 | v0.5 / 2026-11-07 |
| 状态 | **v0.5，开发授权已获得；功能合同已收口（2026-11-07）**。本条收口不表示可上线 |
| 授权边界 | 2026-11-07 委托人授权落地 lint 与治理正文。不授权改页面、发版走查判定或 WebUI 运行代码。本条收口不表示可上线。Spec 见 [lucy-20261107-ui-interaction-contract-gate-spec.md](../specs/lucy-20261107-ui-interaction-contract-gate-spec.md) v0.5 |
| 验收 | 授权落地后：Spec SC-01–SC-15 逐条有证据；生产 grandfather 名单内的现行 Spec 不因 `interaction-contract` 失败；diff 落在 Spec §8。`lint:spec`、`lint:terminology`、`lint:ia-boundary` 退出码为 0。`lint:spec-docs` 与 `lint:spec-docs:test` 仍退出 1，原因是两份既有 Plan 的 `filename`／`plan-parts`，该失败在本次之前已存在，不在 §8。**不构成发布取证，不表示可上线** |
| 目标 | 按 Spec v0.5 的文法实现 lint，并把授权口令、豁免与六问的分叉、元素清单和 Fixed 与 Verified 的差别写进现有治理文件 |
| 落位依据 | [`docs/governance/DEVELOPMENT.md`](../governance/DEVELOPMENT.md)「落盘清单」「强制流程：Plan Mode」 |
| 评审记录 | [`docs/reviews/2026-11-07-codex-review-ui-interaction-contract-gate.md`](../reviews/2026-11-07-codex-review-ui-interaction-contract-gate.md) |

## 1. 目标

按 Spec v0.5 §4 与 §6 实现 `lint:spec-docs` 的规则 `interaction-contract`，并写入 §5 的治理句子。不改任何页面。lint 不代替授权人阅读，也不把证据记号或清单编号改成 Verified。

## 2. 开工前置

1. 本 Spec／Plan v0.5 已终稿确权。确权不等于开发授权。2026-11-07 委托人另发了开发授权。
2. 状态行已写「开发授权已获得」。本次只落地 lint 与治理正文。
3. D1–D13 保持 Spec §2 的裁定。要改裁定，先回写 Spec 版本，再改 lint。
4. 开工时核对按钮规范 §3 第 1 条与第 8 条、发版走查 D1–D12、台账 README 仍是被引用的句子。句子变了就停。

## 3. 任务

### Task 1：lint 与夹具

- 修改 `scripts/lint-spec-docs.mjs`。解析按 Spec §6，不另写一套字段规则。
- 修改 `scripts/lint-spec-docs.test.mjs`。夹具放在测试临时目录，不写入 `docs/specs/`。
- 覆盖 SC-01–SC-10 与 SC-15 的正例和 Spec 点名的负例，包括 `/joins/:conn/:schema/:table` 读真实 `App.tsx`、`已批准开工` 不取消跳过、证据缺某个清单编号、证据出现清单外编号、Plan 状态多写 `E999`、豁免缺表面清单、两行合规的豁免仍带「元素清单」、同一 Spec 有两个「元素清单」。另含两条：有效豁免加上「开发授权已获得」且没有交互评审、也没有元素清单 → 通过；grandfather 文件的豁免缺行、且没有标记和授权口令 → 通过。
- 配对 Plan 由文件名替换得到。缺 Plan 则触发 Spec 失败。

### Task 2：grandfather 名单

- 落地提交新建 `docs/governance/ui-interaction-contract-grandfather.json`。
- 内容是该提交时 `git ls-files docs/specs/*.md`。
- 夹具自带名单。另有一条检查用生产名单跑 lint，名单内现行文件不因本规则失败。

### Task 3：治理正文

- 在 `DEVELOPMENT.md` 写入 Spec §5 的六句。其中必须有：「开发授权已获得」是唯一取消 grandfather 的状态短语；其他说法不取消跳过，也不构成通过本门禁；六问只适用于触发且没有有效豁免的 Spec；有效豁免只核对两行；请求授权时的核对不是 lint；元素清单按路由列出，证据恰好覆盖编号，旧页面不在本轮补清单。
- 在「验证策略：浏览器测试约束」下写明：没触发的任务仍默认不做浏览器测试。
- 不新增 package script，不改 `docs/governance/test-layers-and-release-gates.md` 的命令表。

### Task 4：台账规则句

- 在 `docs/ui-ux-feedback/README.md`「使用规则」追加 Spec §5 的三句。既有 ID 只更新。没有代码修复不得写 Fixed。证据记号不代替浏览器复核。

### Task 5：白名单核对

- 变更路径必须落在 Spec §8。出现 `webui/src`、`webui/server` 或发版走查判定改动，本 Plan 不算完成。

## 4. 验收

与 Spec SC-14 同一标准。下表写的是 2026-11-07 的实测，不把既有失败记成已通过：

| 步骤 | 对应 | 通过 |
|---|---|---|
| 夹具 | SC-01–SC-10、SC-15 | `node --test --test-name-pattern "SC-" scripts/lint-spec-docs.test.mjs` 中 SC-01–SC-10、SC-15 通过。2026-11-07 已跑过 |
| 治理句子 | SC-11、SC-12 | `DEVELOPMENT.md`「交互合同」六句与台账 README 三句已写入。单测 SC-11 / SC-12 通过 |
| 路径 | SC-13 | 变更文件限于 Spec §8。不改 `webui/src`、`webui/server`、发版走查判定 |
| 全量命令 | SC-14 | `lint:spec`、`lint:terminology`、`lint:ia-boundary` 退出码 0。生产 grandfather 名单内现行 Spec 不因 `interaction-contract` 失败，单测 SC-14 通过。`lint:spec-docs` 与 `lint:spec-docs:test` 仍退出 1，被两份既有 Plan 的 `filename`／`plan-parts` 挡住：`lucy-20261107-lucy-0-30-core-direction.md`、`lucy-20261107-lucy-0-30-feature-inventory-pool.md`。测试名是「仓库现状：门禁在基线之上必须通过」。这两条在本次授权之前就已经阻塞，不在 §8 白名单里，本次不改 |

## 5. 完成定义

- SC-01–SC-15 的证据写回上一张表。
- Spec、Plan、`docs/README.md`、`docs/plans/README.md` 的状态句是同一句收口现值，并写明本条收口不表示可上线。
- 本 Plan 的浏览器小节保持「不适用」。

## 6. 风险

| 风险 | 处理 |
|---|---|
| G1：豁免与真实 diff 不符 | lint 只核对豁免文法。不把 G1 标成关闭。发版走查兜底 |
| 授权人用别的句子表示已授权 | 机器不把它当成口令。`DEVELOPMENT.md` 写明那不算通过本门禁 |
| 证据文件堆了关键字，人没看浏览器 | SC-09 只证明记号。Verified 仍要人复核。测试名保持这个区别 |
| 反引号路径误伤只提到 `/api/...` 的 Spec | 作者写豁免。豁免比补一份假屏幕合同便宜 |
| 六问被写成「通过」但没人核对数量 | lint 只核对问句和枚举。Q2 的数量由授权人在请求时核对，且只针对没有有效豁免的 Spec。该步不是 lint |
| 证据出现清单外的编号 | 记失败。新发现先补进元素清单，再写入下一次证据 |

停用本门禁时的回滚，同一次改完已有镜像：

- 删除新规则、名单文件和追加段落。
- 本 Spec、本 Plan、`docs/README.md`、`docs/plans/README.md` 的状态句一起改回未授权的现行句。
- 不改其他 Spec 的状态行。别处已经写下的「开发授权已获得」是那一条自己的授权，不由这次回滚撤销。
- 没有运行时数据要迁。

## 7. 落盘清单自查

| # | 结果 |
|---|---|
| 1 | Spec 与 Plan 同编号 `lucy-20261107-ui-interaction-contract-gate` |
| 2 | Spec 有「核心流程（伪代码）」 |
| 3 | 头部有文档类型 / 版本、状态；Plan 有状态、授权边界、验收 |
| 4 | 本 Plan 有目标、开工前置、验收、完成定义、风险 |
| 5 | Terminology Compliance 含 `This feature follows` 与 `New terms:` |
| 6 | Design System Compliance 为四段式 |
| 7 | 登记 `docs/README.md` 与 `docs/plans/README.md` |
| 8 | 不新增命令。测试门禁文档的命令表不改 |
| 9 | 台账号为「无」 |
| 10 | 落盘修订时已看 `lint:spec-docs` 对本对无新增违规。`lint:spec`、`lint:terminology`、`lint:ia-boundary` 本轮未执行，授权落地时与 SC-14 一起要求退出码 0 |
| 11 | 闭口层级为功能合同，上线关系写明本条收口不表示可上线 |
| 12 | 正文没有把已作废状态句写成现值 |

## 浏览器验证

不适用：不改变用户可见 WebUI 表面。本 Plan 只安排 lint 与治理正文，不打开页面。
