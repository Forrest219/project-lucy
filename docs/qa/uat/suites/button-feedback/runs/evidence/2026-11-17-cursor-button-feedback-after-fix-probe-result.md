# UAT-SUITE-BUTTON-FEEDBACK 探针结果

- 实例：http://127.0.0.1:55176
- 开始：2026-11-17T14:44:39.442Z
- 汇总：{"REAL":11,"HONEST-FAILURE":1,"NOT-RUN":6}

| 入口 | 用例 | 判定 | 文件名 | 字节 | 备注 |
|---|---|---|---|---|---|
| 审计：导出 | UAT-BTN-05 | REAL | audit-turns-20261117-224440-000003.csv | 3382 |  |
| 审计：导出审计证据包 | UAT-BTN-06 | REAL | audit-pack-20261117T144441Z-837adcfd.zip | 33082 |  |
| 审计对账：导出对账证据包 | UAT-BTN-07 | HONEST-FAILURE | - | - | 导出失败：无法证明基础事实、归属修订、关联与聚合可按账本上界 S 精确重建，正式对账读取失败 |
| 配置审计：导出 CSV | UAT-BTN-08 | REAL | config-audit-20261117-224447.csv | 3527 |  |
| 发布记录：导出 CSV | UAT-BTN-09 | REAL | publish-history-20261117-224449.csv | 105 |  |
| Wiki：下载已保存版本 | UAT-BTN-01 | REAL | demo-superstore.md | 392 |  |
| 表编辑器：导出 YAML | UAT-BTN-02 | REAL | demo-mysql-dataforai-superstore_orders.yaml | 5290 |  |
| 评测用例：下载 Eval YAML | UAT-BTN-03 | REAL | demo_superstore-eval-suite.yaml | 6769 | Eval YAML 已准备，可在本地 runner 中运行 |
| 连接：下载 Manifest | UAT-BTN-04 | REAL | dataforai.yaml | 7466 | Schema Manifest 已开始下载 |
| 目录：批量下载语义维护包 | UAT-BTN-10 | REAL | lucy-semantic-asset-exp_20261117_144534_763_42ba280b.zip | 11587 |  |
| 目录：批量校验后下载 CSV 报告 | - | NOT-RUN | - | - | 需要先运行批量校验任务得到报告链接；该任务会占用校验队列，本轮不执行 |
| 引导：下载编写说明 | - | NOT-RUN | - | - | 引导流程已完成的实例不再渲染该入口；需要全新实例才能点到 |
| 评测运行详情：下载 JSON | - | NOT-RUN | - | - | Demo 实例没有评测运行记录，页面不可达 |
| 评测运行详情：下载 MD | - | NOT-RUN | - | - | Demo 实例没有评测运行记录，页面不可达 |
| 发布记录：导出恢复包 | - | NOT-RUN | - | - | Demo 实例没有已发布版本，恢复抽屉不可达 |
| 语义资产导出按钮（组件） | - | NOT-RUN | - | - | 组件已导出但没有任何页面挂载，用户没有入口 |

| 保存用例 | 判定 | HTTP | 备注 |
|---|---|---|---|
| UAT-BTN-S01 新建 Token：真实签发成功 | REAL | 200 |  |
| UAT-BTN-S02 新建 Token：同标签再次签发（真实 4xx） | REAL | 409 | TOKEN_LABEL_TAKEN |

- Token 吊销：成功（HTTP 200，标签 uat-btn-probe-1794926735381）
