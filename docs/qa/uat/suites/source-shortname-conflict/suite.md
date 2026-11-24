# UAT-SUITE-SOURCE-SHORTNAME-CONFLICT — 同连接跨 Schema 短名冲突

| 元数据 | 内容 |
|---|---|
| Suite ID | `UAT-SUITE-SOURCE-SHORTNAME-CONFLICT` |
| 总账／需求 | P1-64／REQ-030-085 |
| 授权 | 排查／定稿／开发授权见 Spec；**2026-11-20 委托人明示执行改后 Docker UAT**（Task 7 执行段）。提交推送仍须另行明示 |
| 修复合同 | [Spec v0.3](../../../../specs/lucy-20261120-source-shortname-uniqueness-runtime-ack-spec.md)／[Plan v0.3](../../../../plans/lucy-20261120-source-shortname-uniqueness-runtime-ack-plan.md)；本轮 R0／01–12 PASS（[跑次](runs/2026-11-20-codex-sc09-final.md)）；SC-09全库类型0错误，回归413＋29 PASS，整包更新另行评审 |
| 目标 | 在真实 Docker／数据库／管理 API／Lucy MCP 上验证跨 Schema 同名表扫描后能否继续合法问数 |
| 范围 | 连接名 `hive-1` 为合成夹具，数据库为 MySQL；测试共享短名生成与 Source Map 链路，不主张 SelectDB／Hive 元数据适配已验 |
| cases | [cases.md](cases.md) |
| fixtures | [fixtures.md](fixtures.md) |
| runs | [runs/](runs/) |

独立容器、独立网络、独立数据目录与随机凭据；不用客户配置、不挂现有 demo 数据卷、不把演示管理员口令写入证据。容器镜像版本、关键文件哈希、每个 API／MCP 的真实响应须存证。

- **repro**：改前缺陷复现；02 期望 FAIL。
- **verify**：改后 R0／01–12 全绿才可主张修复验收；任一失败保持 FAIL。

执行：

```bash
SNC_IMAGE=project-lucy:p164-sc09-final \
  python3 scripts/uat/reproduce-source-shortname-conflict.py --mode verify --browser
```

2026-11-20 最终评审整改：全套分母为 R0／01–12；10／11 覆盖旧别名防抢占与大写物理名，12 覆盖两条 WebUI 真实前台反馈与计时。允许具名 busy 观察，必须另证过期候选 400 拒绝；非预期 5xx 不可算 PASS。
