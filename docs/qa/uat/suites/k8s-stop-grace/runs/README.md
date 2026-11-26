# 跑次槽 — UAT-SUITE-K8S-STOP-GRACE

| 规则 | 说明 |
|---|---|
| 命名 | `YYYY-MM-DD-<agent>-p185-<tag>.md` |
| 判定 | 只回写 [`../../../INDEX.md`](../../../INDEX.md) |
| 当前 | 尚无正式跑次（**NOT RUN**）。静态开发检查不算正式跑次；OQ-1 未裁及 P1-83 步骤 1⑥ 基线未完成前不得登记 PASS |
| 原始证据 | `evidence/<run-id>/`，含 SHA256SUMS；临时大文件可放 `inbox/p185-<run-id>/`，但正式跑次须保留可定位摘要与哈希 |

每份跑次至少包含：

- 授权与 OQ-1 裁定；改前基线先于候选落台的时间证明。
- 原生 amd64 节点、K3s／kubelet、namespace／PVC、镜像 digest、Chart／values 摘要、实际 `imageID`。
- R0／01／02／03／04／05A／06 逐项结果；05B 按 OQ-1 记录 PASS／SKIPPED／BLOCKED 及理由。
- 默认 60、45／75 合法覆盖、非法／错层／注释／`RollingUpdate` 负控、仓库与交付包布局结果。
- 每个旧 Pod 的有效宽限、Pod UID、`containerID`、`StartedAt`、TERM、退出码、是否强杀、Probe／Endpoint 时间轴。
- 正常在途与有界最长路径的注入生效证明、各阶段耗时、查询只执行一次与独立 SQL 结果。
- 改前／改后已受理、尤其已返回成功请求的唯一 ID 集逐条恰好一次、`ledger_seq` 水位、停机失败请求数及分类；不得只比总行数，不得把失败请求数写成必须为零。
- 每次替换后的同卷管理读、无 WebUI Cookie 纯 MCP 恢复和 P1-83 SC-09 证据交接链接。
- 清理回执与未覆盖项；静态通过、缺 B 层、缺最长路径或首升未决均不得写 PASS WITH GAP。

跑次元数据建议：

| 元数据 | 内容 |
|---|---|
| Suite | `UAT-SUITE-K8S-STOP-GRACE` |
| Agent／开始／结束 | 实际执行者与统一时区时间 |
| 总判定 | PASS／FAIL／BLOCKED／NOT RUN；可选 05B 符合裁定时的 SKIPPED 需单列 |
| 环境 | 原生 amd64 K3s、镜像 digest、Chart／values、namespace／PVC |
| 非 WebUI | 浏览器不适用；不得使用 Docker 重启伪装修复 |
