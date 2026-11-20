# 最终77e2ad84证据索引

- [制品manifest](artifact-manifest.json)：a794f7e0…、5个运行文件与原预算writer hash。
- [逐例结果](case-results.json)：13必做，12 PASS／1 FAIL，无NOT RUN。
- [性能摘要](performance-summary.json)：两组各300问、三轮、13次预算拒绝，原始样本完整保留。
- [RC1摘要](client-summary.json)：CodexCLI0.165.0真实3工具，答案4／100，无begin／shell。
- [清理核对](cleanup-summary.json)：24个最终夹具；[治理检查](final-governance-check.json)。
- [历史跑次](qualification-history.json)：原始失败／部分选择器不改写为PASS。
- [完整原始证据归档](raw-evidence.tar.gz)，[归档内逐文件SHA256](raw-evidence-index.json)。
- [本目录完整性](SHA256SUMS.json)。

归档完整保留1598个原始文件的字节，包括每项请求／响应、真实客户端全轨迹、数据库oracle、预算／绑定持久化读回、逐样本耗时、构建和回归日志以及runner执行副本。case-results中的source／sources和cleanup中的fixture均指归档内原始路径；解压后目录及相对链接保持原样。未为消除日志空白而改写原始内容。

原四项代码修复已复核；完整合同保持FAIL与未收口。预算按委托人裁决另处理，未纳入此镜像。未推送、未发布。
