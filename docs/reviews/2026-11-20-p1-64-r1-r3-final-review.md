# P1-64 R1–R3 整改最终评审

> 本报告为SC-09修复前历史快照；该类型缺口已由[后续终审](2026-11-20-p1-64-sc09-final-review.md)关闭，当前结论以新报告为准。

| 元数据 | 内容 |
|---|---|
| 类型／版本／日期 | Final Review／v1.0／2026-11-20 |
| 审阅人 | Codex |
| 范围 | 原受审 `0019a0f1` 的短名唯一性与保存 ack；本轮 R1–R3 修改及回归／Docker／前台浏览器取证；不审阅共享工作树其他功能 |
| 合同 | [Spec v0.3](../specs/lucy-20261120-source-shortname-uniqueness-runtime-ack-spec.md)／[Plan v0.3](../plans/lucy-20261120-source-shortname-uniqueness-runtime-ack-plan.md) |
| 实测 | [本轮完整 Docker＋浏览器跑次](../qa/uat/suites/source-shortname-conflict/runs/2026-11-20-codex-r1-r3-final.md) |
| 结论 | **R1–R3 整改通过；UAT PASS；功能合同仍未收口，暂不批准用户更新。** 原合同 SC-09 全库 TypeScript 仍 FAIL（49条基线诊断、新增0），不能将聚焦测试和 UAT 通过换成全部门禁通过。 |

## 整改复核

| 意见 | 代码与证据 | 复核结果 |
|---|---|---|
| R1：新表抢占有效旧别名 | [分配器](../../webui/server/source-name-registry.ts#L249) 先收集、校验并预留完整扫描集合中的有效旧映射，再分配新表；新增用例覆盖不同输入顺序。Docker先确立 `ods_zebra→ods.zebra`，再新建 `ods.ods_zebra`，最终两别名分别查询旧／新物理表，COUNT=1／2 | 已关闭；不以“名字唯一”替代“旧查询仍指原表” |
| R2：City 查不到小写Map键而退回裸名 | [物理名解析](../../webui/server/source-name-registry.ts#L57) 保留大小写，语义短名占用仍规范化；测试同时覆盖 columns、namesOnly、City／city并存。Docker真实 `aux.City` 两扫描路径分配 `aux_City`，SQL实际查询 `aux.City` | 已关闭；物理身份未被合并，合法MCP查询通过 |
| R3：任意并发失败被判PASS | [结果分类](../../scripts/uat/reproduce-source-shortname-conflict.py#L48) 仅接受唯一确认成功及指定冲突／busy；[争用后的重试](../../scripts/uat/reproduce-source-shortname-conflict.py#L776) 原样提交失败候选，强制400 DUPLICATE_SOURCE_NAME、失败Manifest不存在、上传记录与journal文件集合不变。真实争用观察busy，重试明确冲突；受控锁内时序由既有beforePublishLock测试另证 | 已关闭；busy只触发证明义务，非预期5xx仍FAIL |

本轮运行代码变更限定分配器；原上传复核、ack 与 UI 实现经聚焦回归及真实运行复验。新增 runner 分支仅适配当前 P1-60 无绑定隐藏 begin 的精确协议；公开工具及实际 query 必须成功，不把 begin 的预期拒绝算成可调用成功。

## 验收证据与门禁

| 检查 | 结果 |
|---|---|
| R1／R2红绿回归 | 五个新增用例改前FAIL、改后PASS |
| 聚焦回归 | 12文件、169项Vitest PASS；runner判定器5项PASS |
| Docker | 同一候选 `sha256:d7c23943eba33c9f13405c80e18e45661842c175eeb61b97de37d84c5cebb90f`，R0／01–12共13项PASS；关键运行源码hash一致 |
| 真实前台浏览器 | 两入口×成功／未确认／恢复六场景PASS；headed Chrome、1440×1000、visible＋focus、视口内；截图／JSON已存。补跑导航80–134ms，反馈1562–2804ms；API分列，未确认无成功Toast |
| 文档与治理 | lint:spec-docs、lint:spec、lint:terminology、lint:ia-boundary、lint:e2e-ledger退出0；额外人工／脚本核查P1-64所有本地文档链接和已有状态镜像一致；git diff --check通过 |
| SC-09全库类型 | **FAIL**：HEAD基线50→本轮49，新增0；移除本功能测试夹具漏字段的一条。未豁免SC-09 |

文档门禁退出0带有共享工作树另一份未跟踪 page-dom-scale Plan 的5项WARN，以及可清理的既有baseline提示；不是本功能通过了该草案验收。台账检查脚本当前未枚举本新套件，因此另做本条链接与镜像检查，没有用旧套件检查结果替代。

[类型差集及完整诊断](../qa/uat/suites/source-shortname-conflict/runs/2026-11-20-codex-r1-r3-final-artifacts/typecheck-delta.json)已保存；49条为既有问题，本轮没有扩展到这些无关模块修复。它们仍是原合同要求未满足的事实。**后续须处理该类型基线并使原SC-09通过，再做合同收口复审；本次不修改验收门槛。**

## 主路径、台账与限制

- 同时验证约束与放行：冲突被拒时已有合法MCP仍可查；旧冲突逐份修复后恢复；成功与未确认反馈分别可辨。问数方／治理方主路径满足本次测试夹具中的合同，未把“拒绝生效”作为全部可用性证据。
- 需求台P1-64／REQ-030-085、开发台Spec／Plan及已有README镜像、测试台INDEX、e2e-ledger均已指向新跑次；SC-09残留同步登记。差集核对：本轮事实均归属原P1-64，无新增产品功能或漏登记的用户修复。
- 标准构建镜像源403后复用匹配lockfile的本地依赖层，在隔离容器重新build；这是明确记录的功能验证候选，不是标准Dockerfile从零构建或发布制品证明。
- 合成MySQL，不扩大为Hive／SelectDB特有适配或客户现场已验；单实例并发边界不扩大为多副本共享卷保证。
- 已核对本轮隔离容器／网络为空、两跑次清理标记true。保留候选镜像和脱敏证据；未改共享demo，未提交／推送／发布。

最终判定保持分层：**代码整改通过／Docker与WebUI UAT通过；全合同门禁尚缺SC-09，用户更新暂不放行。**
