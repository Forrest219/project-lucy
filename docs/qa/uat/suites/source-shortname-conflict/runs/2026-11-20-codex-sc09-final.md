# P1-64 SC-09 类型修复与最终候选复验

| 元数据 | 内容 |
|---|---|
| 类型／日期／版本 | Test Report／2026-11-20／v1.0 |
| 套件／条目／执行人 | UAT-SUITE-SOURCE-SHORTNAME-CONFLICT／P1-64／REQ-030-085／Codex |
| 授权 | 委托人本轮明确要求修复49条类型错误、回归、SC-09通过后同步三台账并终审；未授权提交／推送／发布 |
| 判定 | **PASS**：R0／01–12共13项；SC-09宿主与候选容器全库类型检查均0错误；相关Vitest 413 PASS，概念模块29 PASS |
| Docker窗口 | `2026-11-20T04:07:54.138920+00:00` → `2026-11-20T04:09:06.825385+00:00` |
| 最终候选 | `project-lucy:p164-sc09-final`，linux/arm64；`sha256:40104b7f1acc666af3d82f2733d38c733c76474e36d424cab4cca29678549650` |
| 来源 | 上轮已验候选d7c23943＋本轮明确列出的SC-09覆盖文件；base HEAD 7e8ee884＋dirty；[构建与源码清单](2026-11-20-codex-sc09-final-artifacts/candidate-source.json) |
| 原始证据 | [Docker完整summary](2026-11-20-codex-sc09-final-artifacts/docker/summary.json)／[构建日志](2026-11-20-codex-sc09-final-artifacts/candidate-build.log)／[回归日志](2026-11-20-codex-sc09-final-artifacts/regression-final.log) |
| 隔离与清理 | 独立MySQL8.4、容器、网络、临时数据和随机凭据；cleanedUp=true；共享demo不变；保留候选与脱敏证据 |
| 判定边界 | 本条功能验收通过；整包用户更新还须核对实际纳入的其他功能评审，不能用本套件PASS覆盖P1-60已有问题 |

## 49条诊断的处理

| 类别 | 原诊断数 | 修复 |
|---|---:|---|
| 概念MJS导入及回调 | 24 | 为store／apply／scan／plan补真实API声明和共享结构；恢复回调推断，无ambient any |
| 多角色与预览、统计契约 | 12 | YamlUser补既有roles字段；保留typed user参与canonicalization；预览读取展开结果内的config；summary只要求实际使用的投影；补完整审计actor夹具 |
| 其他测试和预算allow契约 | 11 | mock按真实函数签名、query参数、可变状态声明；预算consume返回既有BudgetAllow；收窄schema读取分支；canonical schema夹具用合法string类型，仍保留空ID／NaN的证据缺失负控 |
| 审计导出和既有错误码 | 2 | 为过滤后的Object.fromEntries结果保留精确键集；声明已使用的admission_stop_failed错误码；不改导出字段或拒绝语义 |

原始全库49条见[改前](2026-11-20-codex-sc09-final-artifacts/typecheck-before.log)，最终[npm run typecheck](2026-11-20-codex-sc09-final-artifacts/typecheck-final.log)退出0。`strict`、include、检查命令不变，没有排除文件或ts-ignore。容器内另执行同一命令，build脚本对非0立即中止，成功后才固化上述镜像。

预览修复包含一处真实行为更正：原来将RowPolicyTemplateExpansionResult外壳传作配置，丢失已指派角色／模板／默认值依赖。新增两条反例原实现失败、修正后通过；最终相关测试含既有“无关角色变更不影响预览”正向路径。[反例](2026-11-20-codex-sc09-final-artifacts/racs-red.log)／[通过](2026-11-20-codex-sc09-final-artifacts/racs-green.log)。容器中再执行真实tsx模块探针验证Role／Agent引用模板和defaults变化均改变依赖摘要，无mock：[结果](2026-11-20-codex-sc09-final-artifacts/docker-racs-probe.json)。不把该纯计算探针当成权限发布持久化UAT。

27文件413项Vitest全部通过，含原SC-09的schema／catalog／policy-compile／canonical-source-key／Spec178／创建连接／启用表，以及本轮受影响的RACS、统计、审计CSV、预算和概念Ops。概念核心原生Node测试29项通过，[日志](2026-11-20-codex-sc09-final-artifacts/concepts-tests.log)。最初普通沙箱执行API集成用例未正常完成并中止，正式统计仅取允许本地监听后的完整重跑，不将环境失败计作产品PASS。

## Docker与主路径

| 用例 | 关键结果 |
|---|---|
| R0 | 候选摘要／五份运行源码hash一致；真实管理员bootstrap和普通MCP身份 |
| 01／02／03 | 原事故不手改扫描YAML即生成city／ods_city；保存ack真实、旧引用稳定、MCP可查 |
| 04／05 | 冲突400且不写入；合法MCP继续可用；二次前缀占用确定避名 |
| 06 | 并发恰一确认成功，具名busy失败候选原样重试400 DUPLICATE_SOURCE_NAME；Manifest无写入、上传记录及journal文件集合不变 |
| 07／08 | 旧冲突ack=false并给issue；六组逐份修复，最终无需重启恢复 |
| 09 | 响应、文件摘要和清理证据留存 |
| 10／11 | 旧别名不被新表抢占，旧／新真实COUNT=1／2；aux.City在两扫描路径保留物理大小写并可查 |
| 12 | 两WebUI入口成功／未确认／恢复，真实前台反馈与计时全部PASS |

当前P1-60零绑定面隐藏begin；仅在tools/list确实不公开begin且旧调用精确返回begin_not_available时认作兼容预期，四条公开主路径仍必须真实成功，query不得豁免。此处不覆盖P1-60的L0恢复等其他场景。

## 前台浏览器计时

Chrome157.0.8103.79，headed、1440×1000；每段visible＋hasFocus，关键内容与反馈都在视口内，无pageerror。真实UI登录和提交，不拦截API、不注入DOM。单位ms：

| 场景 | 导航→关键内容 | 提交→反馈 | 同次写API | ack |
|---|---:|---:|---:|---|
| whitelist-success | 233 | 1528 | 1310 | true |
| connection-success | 139 | 1986 | 1947 | true |
| whitelist-unconfirmed | 73 | 1548 | 1340 | false |
| connection-unconfirmed | 67 | 1886 | 1841 | false |
| whitelist-recovered | 72 | 1510 | 1196 | true |
| connection-recovered | 72 | 1931 | 1899 | true |

[未确认启用表截图](2026-11-20-codex-sc09-final-artifacts/docker/browser/whitelist-unconfirmed.png)／[未确认连接截图](2026-11-20-codex-sc09-final-artifacts/docker/browser/connection-unconfirmed.png)已实际查看：具体Source Map issue可见，没有成功Toast。成功时启用表目录刷新可能仍进行中，本里程碑只表示保存反馈；不声明后台刷新完成或通用p95性能承诺。

## 来源与验收限制

本候选从上轮隔离镜像派生，逐份复制本轮清单文件后重新WebUI build和容器typecheck，保留原ENTRYPOINT与UID10001；不混入他人P1-60／Wiki工作树变更。它证明本轮功能与类型修复，不冒称标准Dockerfile从零构建或正式发布包。真实数据库为合成MySQL，共享链路通过不扩大为Hive／SelectDB特有适配或客户现场已验。历史R1–R3跑次的SC-09 FAIL保留，由本轮证据关闭该缺口。

三台账同步后[最终评审](../../../../../reviews/2026-11-20-p1-64-sc09-final-review.md)批准P1-64功能合同收口；当前整包仍待P1-60问题关闭与对应最终候选取证。五项文档／术语／IA／台账门禁退出0，日志在本artifacts的gate-*.log。
