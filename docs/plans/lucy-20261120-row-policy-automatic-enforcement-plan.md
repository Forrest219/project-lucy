# 行权限自动强制执行 Plan

| 元数据 | 内容 |
|---|---|
| 文档类型 / 版本 | Plan / v1.0 |
| 日期 / 编号 | 2026-11-20；P1-72／REQ-030-093 |
| 状态 | S5｜阶段:S5｜v1.0。终稿已确权；开发授权已获得；实现与 Codex CLI 代码终审完成；功能合同已收口（定向回归286项、脚本合同97项、隔离Docker39项）；测试台 UAT-SUITE-ROW-POLICY-AUTO PASS；扩展回归与全仓门禁既有缺口单列，远端CI未执行；不入核心分母；≠ 可上线。 |
| 授权边界 | 已批准方案的实现、测试、隔离本机 Docker 与文档；不改 KTX 源码、不改现有 demo 数据／凭据；委托人后续明示 commit 已授权仅提交本条增量，不推送／发布 |
| 验收 | Spec SC-01–08；定向回归、真实进程、Docker 行集对照；测试台如实登记 |
| 配对 Spec | [Spec](../specs/lucy-20261120-row-policy-automatic-enforcement-spec.md) |

## 目标

去掉运维人工启用步骤，保持强制行域不可放宽。使用 writing-plans / Code 技能，直接执行本次获批方案，不重复申请授权。

## 开工前置

委托人已批准评估方案并明确要求落地。先入总账 REQ-030-093／P1-72，Codex CLI 审阅方案与合同，再改运行代码。共享工作树已有其他任务，按文件和增量保护，不做清理或切分支。

## 实施步骤

1. 登记 Spec／Plan、需求台、测试台与索引，固定验收和授权。
2. 修改 webui/server/proxy/acl.ts、row-policy.ts、mcp-proxy.ts：去 env gate；兼容诊断；统一真实载体；空载体和编译异常失败拒绝。先补默认／旧 false 与内部查询测试，确认旧实现失败，再实现。
3. 更新 webui/server/__tests__/ 行策略、Agent Constraints、权限模型、产品预览与 Proxy wire 测试。复用已有测试夹具，覆盖授权／拒绝和内部入口；不新增无意义快照。
4. 更新 scripts/e2e 的旧 Gate-Off 断言、相关 real-e2e 与 smoke 契约；Compose 旧测试 overlay 注释为兼容，不再要求开关。历史跑次不改结果。
5. 用现有本机镜像＋候选源码隔离运行 Docker，合成 ACL／语义项目，真实 bundled KTX＋MySQL 执行。默认与 false 两进程验证 SC-01–07，保留当前 demo 容器与数据。记录镜像／源码摘要、环境、耗时、域内对照和拒绝结果，清理隔离资源。
6. 更新 Runbook、现行 Spec 替代条款与手册，过术语／文档／类型门禁；审阅最终 diff，回写同句状态与真实跑次。

## 验收

运行 webui npm test -- --run row-policy ac-security-eval agent-constraints permission-model-version p1-hive-row-policy 及受影响入口测试；node --test 受影响 e2e 合同测试。运行根目录 lint:spec-docs／lint:spec、webui lint:terminology／lint:ia-boundary、typecheck。Docker 证据与自动化分列，不用 mock 行集冒充真库隔离。

## 浏览器验证

后端合同以纯 MCP 验证；如更新内置手册正文，前台桌面浏览器打开手册核验内容及导航到可见的耗时，API 耗时另记。不做移动窄屏。

## 完成定义

SC-01–08 有证据；代码审阅未留下本次阻塞；文档／脚本语义一致；总账与所有现值镜像同步；无临时账户／表／容器残留。远端 CI、客户、整套 P1-28 和上线不在本条主张。

## 风险

内部入口不能只补 forced_filters，bundled KTX 会丢弃该键；必须同时补 filters 载体和上游工具改写。旧 env=false 迁移需文档说明。空强制对象不能变成空过滤放行。当前 demo 不重建，不把共享工作树其他任务作为本条交付。

## 实施与验证记录

实现、代码终审、三环境 Docker 与前台手册验证已完成；[正式跑次](../qa/uat/suites/row-policy-automatic-enforcement/runs/2026-11-20-codex-default-row-policy.md) 含源码摘要、精确结果、计时和基线对照。扩展回归20项既有失败与全仓8条API登记缺口如实保留；无本次新增 API；当前 demo 未重建，临时资源已清理。

## 提交授权

委托人在实现与验证完成后明确要求 commit；本次提交只包含 P1-72 代码、文档、验收与其台账增量。共享工作树其他任务留待各自提交。
