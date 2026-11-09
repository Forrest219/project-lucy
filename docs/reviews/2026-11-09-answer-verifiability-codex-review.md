# P0-4 答复可核对块 · Codex 对抗式评审记录

| 元数据 | 内容 |
|---|---|
| 文档类型 | 评审记录（**不是** Spec） |
| 版本 / 日期 | v0.4 / 2026-11-09 |
| 对象 | [Spec](../specs/lucy-20261107-answer-verifiability-spec.md) · [Plan](../plans/lucy-20261107-answer-verifiability-plan.md)（现行 **v0.4-draft**） |
| 清单／REQ | P0-4／REQ-030-022 |
| 授权边界 | **过程对抗 ≠ 终稿确权 ≠ 开发授权** |

## 变更

| 版本 | 日期 | 内容 |
|---|---|---|
| v0.1 | 2026-11-09 | 登记 Codex R1＝BLOCK；AV-01…AV-10 摘要 |
| v0.2 | 2026-11-09 | Architect 将 Spec／Plan 升 **v0.3-draft**；下表逐条 triage 闭合 blocker／major（及 AV-10）；**仍≠ R2-F／R4**；建议开 Codex R2 复验 |
| v0.3 | 2026-11-09 | 登记 Codex R2＝BLOCK（major 3＋minor 1）；Architect 升 **v0.4-draft** 闭合 AV-08／03／06／09 与错位引用；AV-03／06／08／09 改「待复验／本版修订」；**仍≠ R2-F／R4**；**不代裁定 O1／O2**；建议开 Codex R2 复验（非 R3） |
| v0.4 | 2026-11-09 | Codex **R2 复验＝CONDITIONAL**（0 blocker／0 major／1 minor）；三项 major **设计闭合**；修复闭口层级「本条承诺」字段形态；**仍≠ R2-F／R4**；O1／O2 仍待 R3 |

## 总览

| 轮 | 输入稿 | 结果 | 原始产物 |
|---|---|---|---|
| R1 | v0.2-draft | **BLOCK**（blocker 2，major 7，minor 1） | `inbox/2026-11-09-p0-4-codex-r1-last.txt` |
| 修订 | → **v0.3-draft** | AV-01…AV-10 文档修订（architect；只改文档） | Spec／Plan v0.3-draft |
| R2 | v0.3-draft | **BLOCK**（blocker 0，major 3，minor 1；R1 部分项仍部分闭合） | `inbox/2026-11-09-p0-4-codex-r2-last.txt` |
| 修订 | → **v0.4-draft** | AV-08／03／06／09 残留＋§4.3／术语落位错引（architect；只改文档） | Spec／Plan v0.4-draft |
| R2 复验 | v0.4-draft | **CONDITIONAL**（blocker 0，major 0，minor 1） | `inbox/2026-11-09-p0-4-codex-r2b-last.txt` |
| 修订 | 闭口层级字段 | minor：`本条承诺：` 标准形态（lint:spec-docs close-layer） | Spec 闭口层级 |

## 门禁状态

| 项 | 状态 |
|---|---|
| 批次 R1（形式／事实性） | 已修订（见 round1 记录） |
| Codex 过程对抗 | **R1＝BLOCK**；**R2＝BLOCK**；**R2 复验＝CONDITIONAL**（三项 major 设计闭合；闭口层级 minor 已修） |
| R2-F 终稿确权 | **已闭合（2026-11-09）**：委托人明示确权 |
| R3 O 项 | **已闭合（2026-11-09）**：O1＝A、O2＝A（文档默认倾向） |
| R4 开发授权 | **已授予（2026-11-09）**；实现中 |

## R1 要点（原文摘要）

全文：`inbox/2026-11-09-p0-4-codex-r1-last.txt`。

| ID | 级别 | 摘要 |
|---|---|---|
| AV-01 | blocker | 允许成功响应无可见可核对块（装配失败静默缺席） |
| AV-02 | blocker | Hive／认证路由等旁路不经统一装配 |
| AV-03–AV-09 | major | schema／用户可见责任／来源身份／口径摘要／截止期可信／JSON 保真／SC↔Plan 矩阵 |
| AV-10 | minor | 元数据格式／行号漂移 |

## R1 → v0.3-draft triage

| ID | 级别 | 处置 | 落点（v0.3-draft） | 状态 |
|---|---|---|---|---|
| **AV-01** | blocker | 成功提交不变量 D6；B-DENY／B-RESOLVE／B-ASSEMBLE 分合同；禁静默成功无块 | Spec §4 D6、§6、SC-01／13／14 | **文档闭合**（R2 确认） |
| **AV-02** | blocker | 枚举生产点；KTX JSON／SSE＋**Hive 成功 lucy_query 纳入**；认证路由／模板／explain／read_source／freshness **排除**并登记 | Spec §4.1、SC-16／17；Plan §3–§4 | **文档闭合**（R2 确认） |
| **AV-03** | major | 冻结 `answer_verifiability` schema、三路径、冲突→装配失败、一次构造再投影；保护 Spec 162 字段 | Spec §5、D2／D4、SC-06b／19 | **待复验／本版修订**（R2：口径摘要类型／P0-1 引用仍不足 → v0.4） |
| **AV-04** | major | 分开模型可读工具结果 vs 用户可见答复；动态＋fallback instructions；UI 强制属 O1 | Spec §4.3／D5、SC-08；Plan S3 | **文档闭合**（R2 确认） |
| **AV-05** | major | `sources[]` 权威全集；connection／schema／source／table；禁首项冒充；不完整→B-RESOLVE | Spec D7、§5.1.1、SC-02／13 | **文档闭合**（R2 确认） |
| **AV-06** | major | 口径最小集；可解释 filters；用户改写前 vs 系统约束；P0-1 已激活快照引用 | Spec D8、§5.2、SC-03 | **待复验／本版修订**（R2：请求快照取得／传递未闭合 → v0.4） |
| **AV-07** | major | 首期一律 `not_checked`；禁 mtime／查询时／businessDate 冒充；登记 P0-B 缺口 | Spec D3、§4.4、SC-04／05 | **文档闭合**（R2 确认） |
| **AV-08** | major | 无损装配合同；大整数夹具；失败→B-ASSEMBLE 非损坏 success | Spec D9、SC-14；Plan S2 | **待复验／本版修订**（R2：外层／SSE／结构化保真漏洞 → v0.4） |
| **AV-09** | major | 决策→任务→文件→SC→夹具矩阵；Hive／失败／保真／双键 | Spec §6–§8、SC-20；Plan §4–§5 | **待复验／本版修订**（R2：SSE／改写前／error／保真映射不足 → v0.4） |
| **AV-10** | minor | 修复元数据 `\n` 粘连；刷新 E1–E10 锚点（符号准）；与 018 异同表 | Spec 头部、§1、§4.2 | **文档闭合**（R2 确认；另见 R2 新增错引） |
| 审计附注 | — | 不重造审计实体；响应≠已入审计库；保护 Spec 162 | Spec D10、§5.5、SC-19 | **文档闭合** |
| **O1／O2** | R3 | 选项影响写清于 Spec §9；**不代委托人裁定** | Spec §9；Plan S0／S5 | **待 R3** |

## R2 要点（原文摘要）

全文：`inbox/2026-11-09-p0-4-codex-r2-last.txt`。计数：**blocker 0／major 3／minor 1／low 0**（本轮问题数，不累加 R1）。

| ID | 级别 | 摘要 |
|---|---|---|
| AV-08 | major | 保真须覆盖外层解析／SSE 归一／投影／最终序列化；text 与结构化分别验；禁已舍入对象假绿 |
| AV-03／AV-06 | major | P0-1 代次命名空间、digest、缺失失败、随请求携带；在途＋supersede 夹具；CaliberSummary 类型／归一 |
| AV-09 | major | SSE 最终写回、改写前／后分离、请求快照引用、JSON-RPC error、各载体保真映射 |
| （新增） | minor | Spec 分层承诺错指 §4.4（应为 §4.3）；术语落位错指不存在的本 Spec §4.8 |

## R2 → v0.4-draft triage

| ID | 级别 | 处置 | 落点（v0.4-draft） | 状态 |
|---|---|---|---|---|
| **AV-08** | major | D9／§5.6 全链路 P1–P4；text／structuredContent 分验；禁 Number deepEqual 假绿；SC-23 | Spec D9、§5.6、E11、SC-14／23；Plan §4／§4.1 | **设计闭合**（R2 复验） |
| **AV-03／AV-06** | major | CaliberSummary 类型＋归一；`CaliberBindingRef` 双代次＋digest 合同；`RequestPinnedCaliberEvidence` 随请求；SC-22 | Spec §5.2／§5.2.1、D8、E12、SC-03／22；Plan S1／S2 | **设计闭合**（R2 复验） |
| **AV-09** | major | 矩阵补 SSE／error／改写前／pin／保真；SC-21…23；Plan §4.1 断言最低集 | Spec §8；Plan §4／§4.1／§5 | **设计闭合**（R2 复验） |
| 错位引用 | minor | 闭口层级改指 §4.3；术语落位改指术语标准（非本 Spec §4.8） | Spec 闭口层级、Terminology Compliance | **已修** |
| **O1／O2** | R3 | 影响披露维持 Spec §9；R2 不代裁定；R2-F 须保留待裁定边界 | Spec §9 | **待 R3**（不因本轮单独 BLOCK） |

## R2 复验要点

全文：`inbox/2026-11-09-p0-4-codex-r2b-last.txt`。计数：**blocker 0／major 0／minor 1／low 0**。

| ID | 级别 | 摘要 | 处置 |
|---|---|---|---|
| AV-08／03／06／09 | — | 设计层闭合 | 上表改「设计闭合」 |
| AV-11 | minor | 闭口层级「本条承诺（分两层…）」无法过 `lint:spec-docs` close-layer | **已修**为标准 `本条承诺：…` |

## 建议下一步

1. ~~Codex R2 复验~~ → **已完成（CONDITIONAL）**；minor 已修。
2. 可申请 **R2-F**（终稿确权），须保留 **O1／O2 待裁定**边界——**本记录不构成 R2-F**。
3. **R3**＝委托人书面裁定 O1／O2（不是过程对抗复验）。
4. **R4** 开发授权须另发；未获 R4 前不得改运行代码。

**本轮仅为过程对抗复验登记，不构成终稿确权（R2-F），也不构成开发授权（R4）。**
