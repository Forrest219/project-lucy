# P1-64 SC-09 修复后最终评审与功能收口

| 元数据 | 内容 |
|---|---|
| 类型／版本／日期 | Final Review／v1.0／2026-11-20 |
| 审阅人／合同 | Codex；[Spec v0.3](../specs/lucy-20261120-source-shortname-uniqueness-runtime-ack-spec.md)／[Plan Task 9](../plans/lucy-20261120-source-shortname-uniqueness-runtime-ack-plan.md) |
| 范围 | 已授权49条全库类型修复、必要回归、P1-64同候选复验、三台账同步后的终审；未接管他人P1-60整改 |
| 最终候选 | `project-lucy:p164-sc09-final`；`sha256:40104b7f1acc666af3d82f2733d38c733c76474e36d424cab4cca29678549650`；linux/arm64；7e8ee884＋明确列出的dirty修复 |
| 结论 | **P1-64功能合同收口通过，SC-09缺口关闭。当前整个候选不批准直接交付用户更新：其中P1-60仍包含已有未关闭问题。** |
| 实测／测试台 | [SC-09最终候选跑次](../qa/uat/suites/source-shortname-conflict/runs/2026-11-20-codex-sc09-final.md)／[INDEX](../qa/uat/INDEX.md) |

## 本轮修复与复核

49条诊断已清零，宿主和候选容器内 `npm run typecheck` 均退出0；严格模式与include范围未改，无排除文件、ts-ignore或新增无类型any。新增MJS声明对应实际读取、扫描、计划及应用接口；相关真实MJS测试29项通过。审计CSV保留原过滤行为，错误码／BudgetAllow／多角色配置声明与既有实现对齐；测试mock和夹具按照真实签名修正。

实际行为更正仅在预览依赖：此前把模板展开结果的外壳当作配置，导致角色／模板／defaults变化未进入依赖摘要。现在保留输入配置和展开后的角色定义，交给依赖收集器。新增两条反例由失败转绿；既有无关角色修改可继续提交的测试保留并通过。新候选真实tsx进程额外验证Role与Agent引用模板和defaults变化均使摘要变化，未改权限放行规则。

运行代码、声明和测试哈希与固化候选清单逐项核对；没有混入共享工作树他人的Wiki／P1-60运行修改。413项Vitest来自27个完整通过的文件，包含原短名回归和本轮受影响模块；不叠加重复计算之前29项RACS小跑次。原生概念测试另29项。

## 功能合同验收矩阵

| 合同 | 本次可核对证据 | 结论 |
|---|---|---|
| SC-01 | 分配器／schema回归；Docker01／02／05／11，大小写物理身份和唯一语义短名分别处理 | PASS |
| SC-02 | 旧映射和打乱扫描顺序回归；Docker03／10，旧别名查原表，新表不同COUNT | PASS |
| SC-03 | catalog-source-name-conflict读取失败关闭、校验建议和零写入回归；Docker04合法MCP仍可用 | PASS |
| SC-04 | beforePublishLock受控时序回归；Docker06真实争用＋失败候选原样重试400，上传和journal文件集合不变 | PASS |
| SC-05 | 多冲突回归；Docker08六组逐份修复直到全部消除 | PASS |
| SC-06 | source-shortname-runtime-ack两个真实API写入分支；Docker07及浏览器12负控，具体issue、ack=false | PASS |
| SC-07 | 两写入路径修复后恢复回归；既有Access role_resolution_failed仍ack的专项测试；浏览器两入口恢复 | PASS |
| SC-08 | Docker01／02，weather／ods真实扫描、validate、upload、启用，未手改生成YAML，ack=true | PASS |
| SC-09 | 相关policy-compile／canonical／Spec178／schema／catalog／创建／启用回归通过；全库类型宿主及容器0错误 | PASS |
| SC-10 | 组件回归与同候选浏览器12：两入口×成功／未确认／恢复，真实前台、视口内、即时计时及截图，无未确认成功Toast | PASS |

最终完整Docker R0／01–12共13项PASS，包含真实数据库和普通MCP Token合法查询。Chrome157前台六场景导航67–233ms、提交反馈1510–1986ms，与API分列；该单次样本不声明通用性能预算。成功保存反馈不等于后台目录刷新完成。截图已实际查看，issue可读。

文档／Spec／术语／IA／三台勾连五项检查退出0，另核查新套件全部文档链接及已有状态镜像一致，git diff --check通过。文档门禁的5项WARN来自他人未跟踪page-dom-scale Plan；不代改或当作本功能验证结论。机械台账脚本未枚举本套件部分，因此本条另做了专门勾连检查。

## 三台账、画像与收口

SC-09通过后，已先将需求台P1-64／REQ-030-085、开发台Spec／Plan及README现值镜像、测试台INDEX与e2e-ledger同步为“验收通过，待终审”，再进行本次终审。现批准本条功能合同收口并同步最终镜像，GAP-UAT-P1-64关闭；原49条FAIL和历次跑次保留为历史证据。

画像判定沿用Spec：问数方与治理方的短名／保存主路径改善（自动避名、既有查询仍成交、错误反馈可辨）；运维方获取可复核的类型与镜像证据；管理层未触碰报告／经营结果路径。没有新增无逃生门禁；预览相关变化能检测真正依赖变化，既有无关编辑正向路径仍通过。差集核对：本次均归属原SC-09，未新增产品能力或漏登记的修复主张。

## 用户更新判定

**本次P1-64修复已满足自己的功能合同。当前镜像整体仍不放行用户更新。** 原因是它同时包含P1-60，而[该功能已有终审](2026-11-20-begin-zero-binding-final-delivery-review.md)记录了L0 preparing恢复阻断、旧空凭据恢复问题，以及begin隐藏／参数拒绝协议问题，并缺完整R证据。当前测试台仍为修复执行中，未登记最终PASS。

本次对候选的mcp-proxy、caliber-binding-registry、caliber-binding-session、caliber-binding四文件做了摘要核对，均与上述受审7e8ee884基线一致；[摘要证据](../qa/uat/suites/source-shortname-conflict/runs/2026-11-20-codex-sc09-final-artifacts/included-p160-source-comparison.json)。因此不能把P1-64的短名正常夹具及全库类型通过外推成已修复P1-60恢复／异常路径。这是实际纳入候选的已知功能问题，不以客户环境缺失或假设风险阻断。

用户更新的后续条件：由P1-60当前整改完成其反例回归与冻结R跑次；将两条修复合并到同一最终候选并核对证据后，再作整包放行结论。本轮未提交、推送或发布；隔离UAT容器／网络／私有目录已清理，保留候选和脱敏证据。依赖镜像派生构建方式如实记录，不冒充标准Dockerfile从零构建或正式出包。

后续同候选复审见[2026-11-20合并最终评审](2026-11-20-p160-p164-combined-final-review.md)。本报告对应原镜像的历史结论保留，不作当前候选状态源。
