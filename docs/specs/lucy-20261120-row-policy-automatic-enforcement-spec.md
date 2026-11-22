# 行权限自动强制执行 Spec

| 元数据 | 内容 |
|---|---|
| 文档类型 / 版本 | Spec / v1.0 |
| 日期 | 2026-11-20 |
| 功能编号 / 优先级 | P1-72／REQ-030-093；既有行权限可用性修复；不入核心分母 |
| 台账号 | 无 |
| 阶段 | S5 |
| 状态 | v1.0。终稿已确权；开发授权已获得；实现与 Codex CLI 代码终审完成；功能合同已收口（定向回归286项、脚本合同97项、隔离Docker39项）；测试台 UAT-SUITE-ROW-POLICY-AUTO PASS；扩展回归与全仓门禁既有缺口单列，远端CI未执行；不入核心分母；≠ 可上线。 |
| 授权 | 委托人批准取消人工证明开关、保留强制隔离、统一入口与验证方案并明确要求落地；Codex CLI 核定本合同；不含发布或客户实例变更 |
| 关联 | [Plan](../plans/lucy-20261120-row-policy-automatic-enforcement-plan.md)；[UAT](../qa/uat/suites/row-policy-automatic-enforcement/suite.md)；P1-25 评审、P1-28 场景验收 |

## 问题与目标

合法行策略可保存，受限用户却因未设置 LUCY_UPSTREAM_FORCED_PREDICATE_PROVEN 而无法查询。这个全局变量只表达人工声明，不校验上游；遗漏阻断可用性，置真也不能发现过滤缺失。目标是支持路径上配置一次即执行，由 Lucy 负责强制隔离。

## 决策与范围

1. 删除人工证明标志作为取数前置条件。旧变量未设置、false、true、1 或其他值均不改变行权限执行；不得以旧变量为旁路或全局禁用手段。采用已编译的 FinalRows 为唯一行域事实源。
2. 保留身份、工具／连接／表 ACL、字段绑定、查询形状检查、未包装工具拒绝、FinalRows 空载体失败拒绝。未知字段／目录能力继续由现行保存预览和编译诊断，不把字段目录能力当成执行隔离证明。
3. 普通 MCP 与内部授权查询复用 applyLucyQueryForcedFilters，剥离伪造字段，强制谓词写入 filters 前缀，与用户条件 AND。Hive 保留其注入和 SQL AST 校验。编译／注入失败必须在取数前终止；不允许退回全部行。
4. 内部 KTX 查询按标准 lucy_query→sl_query 改写，复用上游参数规范化，不能仅传被 bundled KTX 丢弃的 forced_filters。
5. explain 保持零上游／零行本地诊断；保留兼容字段 upstreamForcedPredicateProven=true，表示产品维护的强制执行契约，不代表当前查询必成功；明确无人工开关，不覆盖其他门禁或形状错误。
6. 支持范围沿用现有 Lucy 包装取数／bundled KTX 与 Hive 适配，不新增数据库／上游版本承诺。产品发版须对实际执行路径取证；未知／失败路径不得由人工 true 解锁。不增加每次查询的探测、客户确认或数据库权限要求。
7. 文档与现行测试改为默认可用；历史跑次保留，历史 Gate C 证明仍可追溯，但不再是运维启用步骤。不新增 UI 页面或产品术语。

## 核心流程（伪代码）

```text
query(identity, args):
  decision = authorizeAndRewrite(identity, tool, args)
  if denied: return existing precise denial
  outbound = applyLucyQueryForcedFilters(args, decision.forcedFilters)
  if Hive: normalize + inject + AST check; execute only when valid
  else: normalizeLucyFiltersForUpstream; rewrite lucy_query to sl_query; forward
  # no env flag; malformed/empty forced payload throws before upstream
```

## 验收

| 编号 | 可证伪承诺 / 方法 |
|---|---|
| SC-01 | 未设置旧变量，scoped 与 Agent Constraints 查询自动带强制域；真实 Proxy 请求＋Docker bundled KTX 行集对照 |
| SC-02 | 旧变量 false／true／1 均不改变授权范围；重启隔离进程复核，既有部署无配置迁移要求 |
| SC-03 | 用户不带过滤、额外收紧、伪造 forced 字段、恶意 OR／字符串、多个受保护源：合法返回域内，旁路明确拒绝或无域外行 |
| SC-04 | read_source／freshness 等未包装工具仍拒绝；原生 sl_query 仍 AbsoluteDeny；无行限制用户仍可查询 |
| SC-05 | 普通 MCP 与内部授权入口都发 filters 强制前缀；KTX 真实行集一致；无效／空强制载体失败不得发上游 |
| SC-06 | explain 默认不再暗示缺运维开关；仍零上游、零行，不冒充可执行性完整判定 |
| SC-07 | 纯 MCP 合法用户能完成默认环境查询；不依赖宿主 attestation 或 WebUI 登录；记录耗时 |
| SC-08 | 默认与遗留变量的测试、脚本、手册和 Runbook 一致；现行命令不再要求切 Gate-Off／On |

## 闭口层级

- 层级：功能合同
- 本条承诺：去掉人工启用依赖且保持行域强制执行。
- 本条出口：SC-01–08 的本机自动化和真实 Docker 验证。
- 不在本条出口：整个 P1-28 多人业务 UAT、数据库新增支持、客户环境、整包发布取证。
- 上线关系：本条收口不表示可上线。

## 受影响画像

事实源：[user-personas](../governance/user-personas.md)。以下为目标体验判定，须由验收验证。

| 画像 | 变更前体验 | 变更后体验 | 判定 | 依据 | 负向时的补偿路径 |
|---|---|---|---|---|---|
| P1 问数方 | 默认 scoped 查数被运维开关挡住 | 纯 MCP 配置范围内可查 | ↑ | SC-01／03／07 | — |
| P2 治理方 | 策略保存后仍需找运维 | 保存运行确认后按策略执行 | ↑ | SC-01／02 | — |
| P3 运维方 | 每实例手动置真、重建／重启 | 不再设置或维护证明标志 | ↑ | SC-02／08 | — |
| P4 管理层 | 无直接查询或部署操作 | 审计、报告语义不变；不触碰管理层展示路径 | ＝ | SC-04／06；沿用 proxy/audit | — |

## Terminology Compliance

This feature follows webui/docs/00-product-terminology-standard.md.

New terms: None。沿用行级策略、最终行约束、Agent 强制约束及既有拒绝码；旧 proven 字段仅保留兼容语义。

## 交互适用性说明

本条不新增页面、控件或交互流程，不触发交互合同；后端执行以纯 MCP 验证。既有内置手册正文有可见变化，仍须真实前台浏览器与即时计时核验，不以 API 测试代替页面验证。

## 风险与边界

旧 false 不再充当紧急全局禁查开关，需禁查时使用现有 Agent 停用／Token 吊销，不能移除行策略当作停用。原 Gate C 证明范围不扩展到所有数据库版本。字段值存在性与多个受保护表联查不在本次扩围。共享工作树其他任务保持原样，不发布／推送。
