# UAT-SUITE-SOURCE-SHORTNAME-CONFLICT — 同连接跨 Schema 短名冲突

| 元数据 | 内容 |
|---|---|
| Suite ID | `UAT-SUITE-SOURCE-SHORTNAME-CONFLICT` |
| 总账／需求 | P1-64／REQ-030-085 |
| 授权 | 委托人 2026-11-19 要求排查代码并在 Docker 或指定 WebUI 复现；2026-11-20 仅新增修复 Spec／Plan 与改后验收设计；不包含产品运行代码、runner 修改或修复后 UAT 执行授权 |
| 修复合同 | [Spec v0.1-draft](../../../../specs/lucy-20261120-source-shortname-uniqueness-runtime-ack-spec.md)／[Plan v0.1-draft](../../../../plans/lucy-20261120-source-shortname-uniqueness-runtime-ack-plan.md)；终稿未确权、开发未授权 |
| 目标 | 在真实 Docker／数据库／管理 API／Lucy MCP 上验证跨 Schema 同名表扫描后能否继续合法问数 |
| 范围 | 连接名 `hive-1` 为合成夹具，数据库为 MySQL；测试共享短名生成与 Source Map 链路，不主张 SelectDB／Hive 元数据适配已验 |
| cases | [cases.md](cases.md) |
| fixtures | [fixtures.md](fixtures.md) |
| runs | [runs/](runs/) |

独立容器、独立网络、独立数据目录与随机凭据；不用客户配置、不挂现有 demo 数据卷。容器镜像版本、关键文件哈希、每个 API／MCP 的真实响应须存证。产品期望是两个合法物理表并存且 MCP 可用；编译拒绝被观察到时标 FAIL（缺陷复现），不得记成修复 PASS。只修改夹具短名的恢复实验不视为产品修复。

复现入口：`python3 scripts/uat/reproduce-source-shortname-conflict.py`（需要 Docker，使用本机已有 `project-lucy:demo` 与 `mysql:8.4` 镜像；`SNC_IMAGE` 可覆盖 Lucy 镜像，关键源码哈希不符会停止）。原始响应暂存 `inbox/source-shortname-conflict/evidence/<UTC跑次>/`；正式留档在对应 `runs/`。
