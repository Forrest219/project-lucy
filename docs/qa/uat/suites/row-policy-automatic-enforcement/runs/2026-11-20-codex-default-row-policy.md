# Run — 2026-11-20 — Codex — UAT-SUITE-ROW-POLICY-AUTO

| 元数据 | 内容 |
|---|---|
| 总账 / REQ | P1-72／REQ-030-093 |
| 合同 | [Spec](../../../../../specs/lucy-20261120-row-policy-automatic-enforcement-spec.md) SC-01–08 |
| 环境 | 既有 arm64 镜像＋候选 server 只读挂载；全新隔离临时项目；真实 bundled KTX 0.16.0＋只读 demo MySQL；普通 Agent Token／纯 MCP，无 WebUI 登录或宿主 attestation |
| 候选 | gitSha／dirty、镜像 ID 与三份运行时源码 SHA256 见 [verification.json](2026-11-20-codex-default-row-policy-artifacts/verification.json)；dirty 包含共享工作树其他任务，不作为本条交付 |
| 总判定 | **PASS**，仅本条默认自动强制执行合同；不是整套 P1-28 PASS，不表示整包可上线 |

## 结果

| 用例 | 结果 | 证据 |
|---|---|---|
| AUTO-01／02 | PASS | unset／false／true 各自独立容器与 KTX 进程；13 项各全过，源码摘要一致 |
| AUTO-03 | PASS | East／Southwest 两个 scoped 身份与不受限全四域对照；无用户过滤、额外收紧、伪造双载体均只在授权域。字符串与 OR 拒绝；多保护表拒绝由定向组件回归覆盖 |
| AUTO-04 | PASS | read_source／freshness 保持拒绝；sl_query AbsoluteDeny；all 对照完整四域 |
| AUTO-05 | PASS | 内部授权入口真实 KTX 与普通 MCP 区域／金额一致；网络回归验证 filters 前缀＋sl_query 改写；空载体／编译非法载体测试失败拒绝 |
| AUTO-06 | PASS | explain 本地零上游／零行；兼容字段 true、不再报告缺运维开关；零上游由 wire 测试独立观测 |
| AUTO-07 | PASS | 当前脚本／Runbook／手册／旧合同替代条款更新；临时容器自动删除，当前 demo 保持 healthy、原数据未修改 |

真实结果：East＝550670.82；Southwest＝242646.20；不受限对照还含 Central South＝363958.98、Northeast＝302200.09。每次结果逐域与直接只读 SQL 的 SUM(sales) 对照，误差 <0.01。个人约束共用 all Role、最终仅 East。没有用查询自带行域过滤凑默认隔离；额外收紧单列测试。

三环境逐次耗时及行域见 [unset](2026-11-20-codex-default-row-policy-artifacts/docker-unset.json)、[false](2026-11-20-codex-default-row-policy-artifacts/docker-false.json)、[true](2026-11-20-codex-default-row-policy-artifacts/docker-true.json)。临时 Token 仅在测试进程内随机生成，正式证据无明文。

## 自动化与静态检查

- 定向回归：23 文件／286 项 PASS；脚本合同：97 项 PASS。
- typecheck、术语、IA、Spec／Plan 形态、三台勾连及 diff 空白检查 PASS。
- 完整 lint:spec 有 8 条既有 ops-step API 未登记；来源为共享工作树另一任务，本次无新增 API，不越界改其文档。

## 扩展回归与基线对照

扩展到空结果、手册时为 376 PASS／20 FAIL。18 项旧夹具要求 begin 成功，但现行产品返回 begin_not_available；另两项是共享工作树 ops-step 导航 27 项与手册 26 项不一致。隔离复制共享树并仅还原本次三个运行时文件和手册为 HEAD 后，复现相同 18＋2 失败；[基线日志](2026-11-20-codex-default-row-policy-artifacts/baseline-tests.log) 与 [空结果完整基线](2026-11-20-codex-default-row-policy-artifacts/baseline-empty-tests.log)。本次不把它们记 PASS，也不扩围修复其他已授权任务。

## 前台浏览器与计时

临时 Docker WebUI 挂载新手册，前台 Chrome 点目录“访问治理 · 行级策略”，可见“行级策略自动执行”“无需设置…或重启服务”；目录点击至内容被前台确认的观测上界 2773ms（含工具／AX 观测开销），同场 handbook API 13.813ms，分列而不互代。仅验证本次手册正文；无其他 WebUI 页面通过主张。预览容器已停止并自动删除。

## 终审与边界

Codex CLI 已审阅：环境变量不再参与授权；保留身份／表／工具 ACL、FinalRows、形状校验、伪造剥离；主路径和内部路径同载体，空／非法载体不能以无过滤转发；explain 保持本地诊断。未发现本条新增阻塞。

本条功能合同收口。远端 CI、客户实例、其他数据库版本与 P1-28 12 人双表完整场景未执行，历史 FAIL 不改写；不提交／推送／发布，不更新当前 demo 镜像。
