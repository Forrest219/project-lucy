# P1-60 原四项整改后的最终交付复审

| 元数据 | 内容 |
|---|---|
| 日期 | 2026-11-20（Asia/Shanghai） |
| 范围裁决 | 委托人明确“只完成原四项，预算问题另行处理”；不推送、不发布 |
| 运行提交 | 初步修复 f61b7ddc／90219073；补全R-01跨门禁77e2ad8425ae0e7a2918803e497da10636b14e5a |
| 测试实现 | 6b8deec4／60f7ab8c；最终runner SHA256 87a19772…；执行副本及逐组指纹已存 |
| 最终Docker | `project-lucy:p1-60-77e2ad84-final`；`sha256:a794f7e056c094f59f776bc0570658dd235eebd49c150676f8ac0ffeb2a69342`；linux/arm64；77e2ad84-dirty |
| 合同 | [Spec v0.8](../specs/lucy-20261119-webui-publish-caliber-registry-repair-spec.md)／[Plan](../plans/lucy-20261119-webui-publish-caliber-registry-repair-plan.md) |
| 完整R | [正式跑次](../qa/uat/suites/begin-zero-binding/runs/2026-11-20-codex-77e2ad84-r.md)；[13项逐例结果](../qa/uat/suites/begin-zero-binding/runs/2026-11-20-codex-repair-artifacts/case-results.json) |
| 决议 | **原R-01–04修复复核通过；完整R＝12 PASS／1 FAIL。当前不批准按完整合同交付用户更新，功能合同未收口。** 失败为既有预算可用性问题，按委托人裁决另行处理，不扩展本轮修复。 |

## 原四项处置

| Finding | 决议与最终行为 | 证据 |
|---|---|---|
| R-01 L0 optional preparing阻断query | 已关闭。现有文件历史完整、三强制字段全空且无previous bound，须同时全局可信零；caliber与source-ambiguity两道门禁均适配；源选择仍执行，不skip、不清旧态 | 新增完整Proxy链反例先FAIL后PASS；最终镜像L0真实重启后query＝4／100；I0–I4含有效／无效draft预算与历史hash前后不变；L1／U0拒绝及合法恢复后成交 |
| R-02 旧空摘要与source-map恢复耦合 | 已关闭。只读现有提交凭据与作者状态证明零；兼容两种旧空摘要；未知／prepared／published漂移不认零；可信零不编译source map | I3旧基线生产API生成凭据后，首次／两次普通发布、新旧会话及重启成交；实际loader计数0且有正控；真实作者编译失败下D2不变；生效ACL失败保留既有拒绝优先级 |
| R-03 分类异常重新曝光begin | 已关闭。异常按unknown隐藏begin，fallback指导清理；continue保留；直接调用安全unresolved不写状态 | 真本地Proxy异常注入、list／initialize／fallback及直接call；Docker正常隐藏与真实continue续查 |
| R-04 业务参数校验先于D2 | 已关闭。身份与工具授权后，inactive先D2；缺intentSummary／不存在bindingId／正常参数同样拒绝且后续可查询；active按旧合同 | 三种强制调用真实响应及状态前后对照；未授工具／过期／吊销／disabled／global deny仍先拒绝；A0允许／偏离与T0快照保持 |

R-01曾出现一次重要漏检：仅直接调用caliber helper可放行，真实query却在source-ambiguity gate再次被拒绝。该真实失败和新增完整Proxy反例均保留；77e2ad84补齐后重新取得数据库事实，未用局部绿灯移植为通过。

## 验证结果

- 相关12文件 **245 PASS**：Proxy、注册表、session、源歧义、答案可核查性、发布、ACL、预算与continue。原预算重启测试补真实active注册表前置，round＝2及累计／归属断言保留。D2真实load／commit计数均0，正控真实调用各1。
- R0／01–12共13项完整执行，**12 PASS／ZB-10 FAIL**，无NOT RUN。独立选择器各自保留PARTIAL／FAIL原状态；完整判定只在正式逐例矩阵和测试台作出，未拼造一份全绿执行日志。
- RC1为未经修改的既有Codex CLI0.165.0（固定二进制hash）。真实catalog→read_source→query，最终订单数4／金额100，审计有真实成功1行结果，未调用begin，也未用shell查询。未观察到幻觉call，故不声称真实Agent覆盖了该条件分支；强制D2由协议用例覆盖。
- P3／P4通过公开只读审计HTTP入口补偿任务：由返回的真实trace定位D2及同身份／会话后续成功；6次query成功，explicit0／session_bound0／identity_inferred0／unassigned6，未声称取得未上报原文。
- 隔离候选全库typecheck保留50条非本修复诊断；后续共享工作树typecheck退出0来自并行类型修复，不能跨制品移植绿灯。本次相关修改无类型诊断。未将其他候选的类型、浏览器或预算修复计入本次结果。

## 唯一未关闭的完整R阻断：预算不可用

三轮均满足采样前冻结的250ms绝对／50%相对双容差，但普通N在无begin情况下仍出现HTTP503 `audit_unavailable`／`question_budget_unavailable`：

| 轮次 | 基线p95 ms | 候选p95 ms | 基线失败/100 | 候选失败/100 |
|---|---:|---:|---:|---:|
| 1 | 1039.690 | 998.963 | 2 | 0 |
| 2 | 1711.630 | 1666.045 | 3 | 3 |
| 3 | 776.752 | 813.890 | 2 | 3 |

每组300个问题全部实际尝试，不重试、不剔除失败；预热失败0。基线成功293／300（97.67%），候选294／300（98.00%）；13次采样失败全部为上述预算拒绝，没有begin调用。各组均全新I0、2CPU／2GiB、原生数据卷，同宿主随机交错；同宿主同时有隔离功能用例，耗时不外推为生产SLO。另起原基线单组探针也在169问后复现相同码。

本跑次没有取得足以确定底层异常的日志，不把根因写死为SQLite锁。共享工作区另有预算writer WIP和并行合并候选记录；它们均未进入本次镜像，亦未用其替换本次基线。预算缺陷是否已在别的任务修复，不改变本制品实际FAIL。

## 制品、夹具与历史处置

[manifest](../qa/uat/suites/begin-zero-binding/runs/2026-11-20-codex-repair-artifacts/artifact-manifest.json)核对五个运行文件与77e2ad84逐字节一致；audit.ts实际SHA与原c1cd67a0基线相同。基于固定本机基镜像增量重建并重编前端，诚实保留基镜像已存在的Wiki差异和dirty标记，不冒称干净全仓、合并候选或客户包。原890a0394退回报告保留。

资格跑次全部留痕。旧强状态夹具曾在基线自动运行元数据生成前提交凭据，不能作为“健康active”前置；后续先稳定同一基镜像自带元数据，再由旧基线生产API生成真实旧格式凭据，仍验证强状态拒绝／恢复／偏离。原生卷、动态端口、公开审计与RC1客户端准入修正都属于测试接线，未放宽产品判据。

RC1初次被本机never策略在到达Lucy前拒绝；按[官方配置参考](https://learn.chatgpt.com/docs/config-file/config-reference)，仅在该次CLI参数中逐工具批准catalog／read_source／query后完成。未改全局配置、Lucy权限或工具可见性，也未使用全局沙箱绕过。

正式证据共24个最终夹具清理核对通过：容器、网络、命名数据卷与私有凭据目录均删除，新MySQL匿名卷随容器移除；不声称已清理无法归属的其他历史卷。共享demo未替换；没有推送、发布、客户出包或现场变更。

## 交付结论

**四项代码整改可以验收；本制品完整合同尚不能签为可交付用户更新。** 依据是保留的真实N预算拒绝，既不是客户环境缺失，也不是要求把预算修复强加回本轮。预算按委托人裁决另行处理，测试台保持FAIL，原四项结果、完整矩阵和最终镜像证据已齐。

## 最后治理检查

`lint:spec`、`lint:terminology`、`lint:ia-boundary`及e2e台账指针检查通过；7处现值镜像一致，本任务本地链接与空白检查通过。全仓`lint:spec-docs`仍有23项违规，均位于并行的memory-probe／process-drain／page-dom文档；P1-60定向违规0。未修改这些无关文档或增加基线豁免，日志已保存。

原始证据以保真压缩归档保存（1598文件，逐文件SHA256已核验），正文保留逐例／性能／客户端与制品摘要；[归档及校验索引](../qa/uat/suites/begin-zero-binding/runs/2026-11-20-codex-repair-artifacts/README.md)。原始日志中的空白与失败未被改写。

后续同候选复审见[2026-11-20合并最终评审](2026-11-20-p160-p164-combined-final-review.md)。本报告对应原镜像的历史结论保留，不作当前候选状态源。
