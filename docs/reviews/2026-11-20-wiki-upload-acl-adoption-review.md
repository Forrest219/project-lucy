# Wiki 覆盖上传 ACL 采用 — 独立终审与终稿确权记录

| 元数据 | 内容 |
|---|---|
| 文档名称 | Wiki 覆盖上传 ACL 采用独立终审与终稿确权 |
| 文档类型 | Review |
| 版本 | v1.1 |
| 撰写日期 | 2026-11-20 |
| 撰写人 | Cursor |
| 委托人 | xingchen |
| 基于材料 | Spec／Plan／UAT v0.2 正文；DEVELOPMENT 落盘清单 1–18；交互合同门禁；user-personas；既有 v0.2-review 四项闭合记录 |
| 适用范围 | P1-65／REQ-030-086 文档终稿确权；不含开发授权、改后 UAT、commit／push |
| 输出位置 | `docs/reviews/2026-11-20-wiki-upload-acl-adoption-review.md` |

| 审阅字段 | 内容 |
|---|---|
| 对象 | [Spec](../specs/lucy-20261120-wiki-upload-acl-adoption-spec.md)／[Plan](../plans/lucy-20261120-wiki-upload-acl-adoption-plan.md)／[UAT cases](../qa/uat/suites/wiki-upload-acl-adoption/cases.md)／[fixtures](../qa/uat/suites/wiki-upload-acl-adoption/fixtures.md)／[suite](../qa/uat/suites/wiki-upload-acl-adoption/suite.md) |
| 授权 | 委托人 2026-11-20「授权对 Spec、Plan 和 UAT 用例做独立终审…通过后同步终稿确权」；仍仅文档；不改运行代码；不将 UAT 标为 PASS；不 commit／push |
| 终审结论 | **PASS** |
| 终稿确权 | **已确权**＝委托人明示本提示词确权（仓库口径：Codex CLI 终审，或无 Codex 时委托人明示确权）。本轮未跑独立 Codex CLI，不主张 CLI 审阅通过 |
| 开发／执行 | **未授权**；改后 R0／01–12 全部 NOT RUN |
| 测试事实源 | [INDEX](../qa/uat/INDEX.md) 保持 **FAIL（改前 v0.1 基线）**；历史 [基线跑次](../qa/uat/suites/wiki-upload-acl-adoption/runs/2026-11-20-cursor-docker-baseline.md) 原样；无新 verify |

## 1. 独立终审核对（DEVELOPMENT 落盘清单）

| # | 审查项 | 结论 |
|---|---|---|
| 1 | 命名与落位 | PASS；共用 `lucy-20261120-wiki-upload-acl-adoption` |
| 2 | 核心流程伪代码 | PASS；§3 覆盖预检／选择／最新 digest／提交校验 |
| 3 | Spec／Plan 元数据 | PASS；类型／版本／状态／授权边界／验收齐全 |
| 4 | Plan 五类章节 | PASS；目标／开工前置／任务／验收／完成定义／风险 |
| 5 | Terminology Compliance | PASS；`This feature follows`／`New terms: none` |
| 6 | Design System 四段式 | PASS；浮层／按钮／状态／Spec 193 |
| 7 | 索引登记 | PASS；docs／plans README 有行 |
| 8 | 新增命令／CI | PASS；无新增命令或 CI job |
| 9 | 台账号与身份 | PASS；台账号＝无；P1-65／REQ 仅映射 |
| 10 | 机器门禁 | PASS；本轮 `lint:spec-docs`／`lint:terminology`／`lint:ia-boundary`／`check-e2e-ledger` exit 0 |
| 11 | 闭口层级 | PASS；功能合同；收口不表示可上线 |
| 12 | 作废状态句 | PASS；无裸写作废现值 |
| 13 | 交互合同 | PASS；E1–E7＋Q1–Q6；Plan「浏览器验证」对齐；执行 NOT RUN |
| 14 | 先入总账 | PASS；P1-65／REQ-030-086；不入核心分母 |
| 15 | 三台勾连 | PASS；总账→Spec／Plan→Suite／INDEX→基线；GAP-UAT-P1-65 开放（改后证据） |
| 16 | 主路径可用性 | PASS（设计）；显式保留／采用／重设、管理访问、纯 MCP 检查点均必做 |
| 17 | 受影响画像 | PASS；P2 最差 ↓＋补偿挂 SC；四画像齐全 |
| 18 | WebUI 浏览器＋计时 | PASS（合同）；07／E1–E7 必做；本轮未执行 |

## 2. Spec／Plan／UAT 一致性抽检

| 抽检 | 结果 |
|---|---|
| D1–D8 与 §2.1／§2.2 矩阵 | 无开放 OQ；corrupt／同键／missing≠empty 一致 |
| SC-01–14 ↔ R0／01–12／M／K／T／E | 连续无悬空；cases「SC 映射」可逆 |
| 证据分工 | 07＝真实点击；01／02／08＝API 结果；06＝各写入检查点 MCP |
| 隔离／负控 | 03 要求 B≠W；05 独立 B→W；setup≠测量 |
| 历史基线 | v0.1 01 FAIL 语义保留；不得重释为新 01 PASS |
| 安全前提 | replace 不得静默采用上传声明；差异须显式选择 |

## 3. 画像五问（出门）

1. 触及 P2 语义口径面／权限授权面，观察 P1 问数面；P3／P4 无路径变更。
2. 变更后差异／损坏须显式选择；合法同键可默认保留；纯 MCP 合法角色仍可搜索／读取。
3. P2 ↓ 补偿：同 Dialog 显式保留（SC-02）、同键不加步骤（SC-12）、失败恢复（SC-14）、管理访问（SC-07）。
4. 最差子面规则已用；不以授权面 ↑ 抵消口径面成本。
5. 无新增画像；UAT 专用 Role／Agent 仅为夹具。

## 4. 四项过程意见（历史闭合，终审复核）

| 原意见 | 终审 |
|---|---|
| 差异门禁不止加宽 | 已闭合；07·M1–M9＋11 |
| corrupt 保留／重设冲突 | 已闭合；10·K1–K5 |
| 顺序污染负控 | 已闭合；fixtures 隔离＋03／05 |
| SC／UAT 悬空与 API 冒充点击 | 已闭合；SC-01–14↔01–12；UI／API 分工 |

## 5. 状态出口

| 层 | 现值 |
|---|---|
| 终稿确权 | **已确权**（本提示词） |
| 开发授权 | **未获得** |
| 功能合同收口 | **未收口** |
| 测试台 INDEX | **FAIL（改前基线）**；改后 verify **NOT RUN** |
| 可上线 | **否** |

本记录同步 Spec／Plan／总账／REQ／e2e／索引现值同句；**不得**把终稿确权写成 UAT PASS 或开发授权。
