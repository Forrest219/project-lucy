# UAT-SUITE-STORAGE-READINESS

| 项目 | 内容 |
|---|---|
| 版本 / 日期 | v0.1-draft / 2026-11-20 |
| 总账 / REQ | P1-71／REQ-030-092 |
| 关联 | [Spec](../../../../specs/lucy-20261120-storage-readiness-spec.md) · [Plan](../../../../plans/lucy-20261120-storage-readiness-plan.md) |
| 状态 | NOT RUN；仅设计；0.30 不开发；材料在需求池作下一期目标；开发与执行未授权 |
| 用例 / 夹具 | [cases](cases.md) · [fixtures](fixtures.md) |
| 执行环境 | 未来单独授权后使用隔离本机 Docker、合成数据及真实数据库；当前不启动环境 |
| 最近跑次 | 尚无；不创建伪跑次 |

## 分层与判定

01／02／06／07 包含局部真实进程合同检查，结果回各功能合同；03／04／05／08／09／10 的组合负载、恢复、迁移与回退旅程属发布取证设计，不作为单条功能合同出口。两层分别判定，不用局部 PASS 推定整套通过。

全部用例当前 NOT RUN。没有真实 PostgreSQL 应用实现时不能用 SQL 导入成功替代后端合同或运行旅程。首跑前独立冻结规模、时长、延迟与恢复门槛；不可先跑再放宽判据。

纯 MCP 与数据库用例不强制浏览器。未来覆盖页面时按 CONVENTIONS 补前台浏览器＋即时计时；只验 API 不主张页面通过。规则见 [CONVENTIONS](../../CONVENTIONS.md)。
