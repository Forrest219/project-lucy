# UAT-SUITE-SOURCE-SHORTNAME-CONFLICT — 同连接跨 Schema 短名冲突

| 元数据 | 内容 |
|---|---|
| Suite ID | `UAT-SUITE-SOURCE-SHORTNAME-CONFLICT` |
| 总账／需求 | P1-64／REQ-030-085 |
| 授权 | 排查／定稿／开发授权见 Spec；**2026-11-20 委托人明示执行改后 Docker UAT**（Task 7 执行段）。提交推送仍须另行明示 |
| 修复合同 | [Spec v0.2](../../../../specs/lucy-20261120-source-shortname-uniqueness-runtime-ack-spec.md)／[Plan v0.2](../../../../plans/lucy-20261120-source-shortname-uniqueness-runtime-ack-plan.md)；Task 1–6 已实现；改后 UAT R0／01–09 PASS（[2026-11-20-cursor-docker-verify](runs/2026-11-20-cursor-docker-verify.md)） |
| 目标 | 在真实 Docker／数据库／管理 API／Lucy MCP 上验证跨 Schema 同名表扫描后能否继续合法问数 |
| 范围 | 连接名 `hive-1` 为合成夹具，数据库为 MySQL；测试共享短名生成与 Source Map 链路，不主张 SelectDB／Hive 元数据适配已验 |
| cases | [cases.md](cases.md) |
| fixtures | [fixtures.md](fixtures.md) |
| runs | [runs/](runs/) |

独立容器、独立网络、独立数据目录与随机凭据；不用客户配置、不挂现有 demo 数据卷、不把演示管理员口令写入证据。容器镜像版本、关键文件哈希、每个 API／MCP 的真实响应须存证。

- **repro**：改前缺陷复现；02 期望 FAIL。
- **verify**：改后 R0／01–09 全绿才可主张修复验收；任一失败保持 FAIL。

执行：

```bash
SNC_IMAGE=project-lucy:demo \
  python3 scripts/uat/reproduce-source-shortname-conflict.py --mode verify
```
