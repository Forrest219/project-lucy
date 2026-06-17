# Codex 工单进度

更新时间：2026-06-16

## 已完成

| 工单 | 状态 | 说明 |
| --- | --- | --- |
| M0 脚手架 + fs-safe | 完成 | Vite/React/Fastify 基座、`fs-safe`、health API、基础测试完成。 |
| M1 只读目录 | 完成 | `/api/project`、`/api/sources`、单表读取、Catalog、只读 TableEditor 完成。 |
| M2 编辑 + diff 预览 | 完成 | YAML 就地补丁、描述编辑、grain overlay dryRun、diff preview 完成。 |
| M3 保存 + Review | 完成 | `dryRun:false` 保存、`safeWrite`、`validateSource(execFile)`、Review 页、diff/validate-changed API 完成。 |
| M4 measures/segments/joins | 完成 | measures/segments overlay、candidate/rejected sidecar、formal join 写正式 YAML、JoinEditor/MeasureForm/SegmentForm 完成。 |
| M5 Wiki 编辑器 | 完成 | wiki 扫描/读取/创建/编辑、frontmatter round-trip、TableEditor 创建关联 wiki 入口完成。 |

## 当前验证状态

| 项 | 状态 | 结果 |
| --- | --- | --- |
| 单元/API 测试 | 通过 | `npm test`：10 个测试文件、30 个用例通过。 |
| 类型检查 | 通过 | `npx tsc --noEmit` 通过。 |
| 构建 | 通过 | `npm run build` 通过；`dist/` 为验证产物，不纳入交付。 |
| 真实 ktx validate | 通过 | `POSTHOG_DISABLED=1 ktx sl validate superstore_orders --connection-id mysql-aliyun --json` 成功。 |
| API 全链路验收 | 通过 | `npm run acceptance:api` 覆盖 project/sources/dryRun/save/diff/validate-changed/join sidecar/wiki/护栏。沙箱内 `tsx` IPC 会被拒，已用提权执行通过。 |

## 真实验收产物

| 路径 | 说明 |
| --- | --- |
| `semantic-layer/mysql-aliyun/superstore_orders.yaml` | M4 overlay 验收产物，含 grain/measures/segments。 |
| `.ktx-ui/join-candidates.json` | M4 candidate join sidecar 验收产物。 |
| `wiki/global/m5-acceptance.md` | M5 wiki/frontmatter 验收产物。 |

## 未闭环

- 浏览器点击式 UI 全链路验收尚未完成：Catalog 搜索/筛选、TableEditor Save、Review、JoinEditor、WikiEditor 需要在浏览器里逐项点通。
- 最终人工判定尚未完成：需要确认上述真实验收产物是否保留，是否需要进入提交范围。

## 建议下一步

1. 跑 `npm run acceptance:api` 作为 API 级回归。
2. 启动 `npm run dev` 做浏览器 UI 冒烟。
3. 复核 `git status --short`，决定保留或清理真实验收产物。
