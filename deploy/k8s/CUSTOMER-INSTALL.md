# Lucy 2.0 空环境安装

这份说明只用于还没有 Lucy 的 namespace。现役 `20260828-v1` 的原地升级继续使用该实例已经配套的升级包和 `CUSTOMER-UPGRADE.md`。

## 安装前

目标 namespace 中还没有同名 Deployment、PVC、Service 和 Helm release。同名 Service 会在部署写操作之前被拒绝。

使用私有附件里的 `scripts/prepare.sh`。复制 `examples/instance.install.http.example.json` 或 `examples/instance.install.https.example.json`，填写 context、访问地址和节点映射。不要填写 `instanceId`，不要自行生成引导密钥。

`pvcName` 必须等于 `<deployment>-data`。不要填写 `existingClaim`、旧资源 UID、旧镜像或恢复说明。

内容根留空。`semantic-layer/`、`wiki/`、`skills/` 落在 `/data/lucy/config/`。

容器端口保持 WebUI 5174、MCP 7879。Service 类型和 Service 端口由这套新环境选择。Chart 默认是 ClusterIP，Service 端口与容器端口相同。KTX 7878 不进入 Service。

`LUCY_PUBLIC_MCP_URL` 写成 Agent 实际访问的地址。

Chart Ingress 关闭时，HTTPS 要先核对外部网关：`/` 到达 WebUI，`/mcp` 到达 7879，然后把 `externalTlsReviewed` 设为 true。私有 CA 填写 `tlsCaFile`。公有 CA 省略该文件。HTTPS 还要设置 `LUCY_TRUST_PROXY` 为 `1`，并把 `LUCY_TRUSTED_PROXY_CIDRS` 设成已核对的网关出口 CIDR。HTTP 安装会从生成结果中删除这两个变量。

## 启动后

空 PVC 首次启动会种入镜像里的示例项目：连接名 `customer-db`，口令文件 `/data/lucy/.ktx/secrets/customer-db-password`，以及示例语义层。示例连接不是客户业务数据。`LUCY_ALLOW_PLACEHOLDER_KTX` 保持关闭。

未配置数据库 Secret 时，Chart 不渲染 `secrets-sync`。无数据库口令时 Pod 能否就绪，以这套环境的实测为准。不能就绪就停止交付并修订方案。

认领前 `/api/auth/status` 为 bootstrap。打开 WebUI 地址，用附件中的引导密钥创建首个所有者。重复认领会被拒绝。其余需要管理面的账户由所有者建成运维人员。

正式取数前，由所有者替换示例连接、写入数据库口令，并重建索引。安装包交付本身不表示业务取数已经通过。
