# Fixtures — UAT-SUITE-REBUILD-PROBE-BUDGET

| 项 | 约定 |
|---|---|
| 限速 | 建议 Docker blkio：读写 30MB/s、读 300／写 100 IOPS（与冷启动台一致） |
| 额度 | CPU 4／memory 8Gi 量级（对齐客户包；Docker VM 物理内存差异须在跑次注明） |
| 数据 | 满量合成推断夹具；可复用冷启动种子扩展；禁止客户生产库 |
| 探针 | 客户观察器：timeout 3s、period 5s；另可高频采样作诊断 |
| 输出 | `inbox/uat-rebuild-probe-budget-YYYY-MM-DD/` |

可写：镜像名、限速参数、采样 JSON。禁写：凭据内容。
