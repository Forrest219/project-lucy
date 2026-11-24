# （作废）原「客户交付与镜像上线 Checklist」

| 元数据 | 内容 |
|---|---|
| 状态 | **已作废（2026-11-13）** |
| 原因 | 与现行门禁双写且过期（缺 G4c／G4d、G／H／K 编号漂移、Go／No-Go 与脚本脱节）；经验段应进错题本，操作段应只留一份 SOT |
| 原版本 | v1.4（2026-08-28…2026-10-07） |

**不要**再把本文件当出包／放行依据。

## 经验去哪了

| 原「五大铁律」 | 错题本 |
|---|---|
| 1 二进制架构 · 2 离线 runtime · 4 禁止盲复用 | [`docs/lessons/2026-08-27-customer-amd64-elf-uv-blind-reuse.md`](../lessons/2026-08-27-customer-amd64-elf-uv-blind-reuse.md) |
| 3 MCP Advertise／fallback | [`docs/lessons/2026-08-28-mcp-public-url-fallback.md`](../lessons/2026-08-28-mcp-public-url-fallback.md) |
| 5 升级契约 · 现场症状对照表 | [`docs/lessons/2026-09-02-k8s-inplace-upgrade-contract.md`](../lessons/2026-09-02-k8s-inplace-upgrade-contract.md) |

索引：[`docs/lessons/README.md`](../lessons/README.md)。

## 操作去哪了（现行 SOT）

| 用途 | 文档／入口 |
|---|---|
| 客户 amd64 镜像 G 门禁、封包红线、作废规则 | [`customer-amd64-image-build-checklist.md`](customer-amd64-image-build-checklist.md) |
| 2.0 升级／引导密钥 C01–C20 | [`customer-v2-upgrade-release-checklist.md`](customer-v2-upgrade-release-checklist.md) |
| 待测包 vs 客户包 | [`customer-k8s-test-package-principles.md`](customer-k8s-test-package-principles.md) |
| CI／发布门禁口径 | [`docs/governance/release-ci.md`](../governance/release-ci.md) |
| 现场部署速查 | [`customer-k8s-deployer-quickstart.md`](customer-k8s-deployer-quickstart.md) |

原正文（阶段一～四勾选表、放行条件）**已删除，不再维护**。
