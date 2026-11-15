# Fixtures — UAT-SUITE-EQUIV-GUARD

| 键 | 值 | 备注 |
|---|---|---|
| 测试目录 | `webui/server/__tests__/equivalence/` | 命令 `npm --prefix webui run test:equivalence`（`vitest run --maxWorkers=1`）；也包含在 `npm --prefix webui test` 里 |
| 冻结旧实现 | `legacy/*.legacy.ts` | 文件头 `FROZEN REFERENCE`：改前行为的原样拷贝，只给测试当对照，**运行代码不得 import** |
| 改前金样本 | `golden/*.json` | 用**改前**代码在固定种子数据上生成；`UPDATE_EQUIVALENCE_GOLDEN=1` 才会重写，须按 suite「想改金样本」流程 |
| 数据 | 各测试内用固定种子（`fixtures.ts` 的 `rng`）造审计库；含并列时间戳、重写行、非 ISO 时间、仅连接／仅浏览会话、含逗号／引号／换行／公式前缀的 CSV 字段、边界行数（0、1、片长±1、多片） | 合成，不含客户数据 |
| 规模用例 | F-6 约 40,000 个 `access_log` 行号的 as-of 证明（超过 SQLite 变量上限 32,766）；旧实现在此规模必然 `too many SQL variables` | 证明「改后不爆」且结果等价于分片后的旧实现 |
| 登记册 | `equivalence-manifest.test.ts` 的 `FINDINGS` | 现有 F-1…F-7、F-idx、F-yield |

## 受守卫文件（改动即须跑 UAT-EQ-01／02）

- `webui/server/proxy/audit-as-of-proof.ts`、`webui/server/proxy/sqlite-in-chunks.ts`、`webui/server/proxy/audit.ts`（索引段）
- `webui/server/admin/audit.ts`、`audit-inquiry-pack-rows.ts`、`audit-local-timestamp.ts`、`yield-slices.ts`、`reconciliation.ts`
- `webui/server/admin/inferred-turn-maintainer.ts`、`access-map-echo.ts`、`ui-usage.ts`、`daily-question-kpi.ts`

## 已知覆盖不到

- 没有为 `audit/export-pack`（HTTP 413）与 v2 导出完整路径（409 `integrity_or_relation_failed`，合成夹具缺派生列）造完整性合法夹具；这两条的**导出内容**不在等价守卫里，只有它们共用的 `presentCallRows`／CSV 渲染被守卫。
- `linkedHandshakeRows` 仍有同类无界 `IN` 展开，未改、未守卫，见 Spec 风险。
- 多人并发、客户 amd64、浏览器页面层：不在范围。

## 禁止

- 为让红灯变绿而重生金样本或改冻结旧实现。
- 让运行代码 import `legacy/`。
- 把本套件绿写成性能通过（性能看 UAT-EQ-03）。
