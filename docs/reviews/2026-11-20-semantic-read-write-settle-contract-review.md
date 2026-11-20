# P1-70 正常语义写入读取等待：合同终审

2026-11-20，委托人明确选择“批准补充合同并修复”，授权先完成合同终审后实施最小修复。需求先登记P1-70／REQ-030-091；[Spec](../specs/lucy-20261120-semantic-read-write-settle-spec.md)与[Plan](../plans/lucy-20261120-semantic-read-write-settle-plan.md)由Codex CLI0.165.0以read-only方式复审。

结论：**第二轮 APPROVED**。原首轮REQUEST CHANGES保留：按三个工具分别定义查询／元数据／plan_only及SQL次数，四画像补足等待延迟补偿；修订后重新确权。另具名保留真实私有owner/WAL／等待阶段的有界工程取证，不新增公开API或日志产品。

确权覆盖真实owner在WAL首次持久化前绑定、从原入口起固定20秒等待资格、原预算及socket时限不重置、故障／孤儿仍关闭、当前ACL复核、TERM／断连优先、只等实际写／镜像阶段而非publish／reload最终态，以及单次原请求不重放SQL。

审阅时Spec SHA256：e91ac21a461f4a635fbff785eb6a77346caa3e75b2e15f79f7b79d4aeaf75e21；Plan SHA256：9122a014c7aa10c403c2516e990df717976ae4ecc46eaa916689047e38c95329。正文冻结副本、实际命令／版本／结果及G2保存在本机工程证据 `inbox/core-availability-followup/20261120-execution/10-semantic-read-delta/`。确权后仅更新Spec头部现值与既有镜像；实现须另做代码复核与测试。

允许实施范围仅publish-coordinator、semantic-recovery-journal、catalog-assets、mcp-proxy四运行文件和必要定向测试。只读终审不表示实现完成、UAT PASS、WebUI通过、可上线或客户交付完成。原候选4 FAIL不改写，正式30分钟仍须新候选另跑。
