# Fixtures — UAT-SUITE-INFERRED-REBUILD-RECOVERY

| 项 | 约定 |
|---|---|
| 数据 | 合成 `access_log`；禁止客户生产导出 |
| 小样本 | ≥80 业务调用／单用户（IRR-01） |
| 中样本 | ≥6000 业务调用／单用户（IRR-02） |
| 大样本（可选） | 对齐前方：约 20 万原始调用、多用户；第 2 用户目标完整推断约 2986（以夹具金标准为准） |
| 持久卷 | 同卷跨进程；中断前后共用 |
| 凭据 | 若需 MCP／登录：仓库外凭据文件路径；禁写内容 |
| 参考脚本 | 前方证据目录中的 `codex-interruption-review.mts`、`codex-independent-review.test.ts`（开发台）；正式 UAT 跑次须另归档到本套件 `runs/` |

可写：镜像名、容器名、SQL 计数命令、输出目录 `inbox/uat-inferred-rebuild-recovery-YYYY-MM-DD/`。  
禁写：密码、Token、客户库连接串。
