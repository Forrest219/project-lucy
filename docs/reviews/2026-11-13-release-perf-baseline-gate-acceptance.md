# REQ-030-034 发版性能基线门禁 — SC 验收证据

| 元数据 | 内容 |
|---|---|
| 文档名称 | 发版性能基线门禁 SC 验收证据 |
| 文档类型 | Test Report |
| 版本 | v1.1 |
| 撰写日期 | 2026-11-13 |
| 撰写人 | Cursor |
| 委托人 | xingchen |
| 基于材料 | [Spec](../specs/lucy-20261113-release-perf-baseline-gate-spec.md) v0.2；[Plan](../plans/lucy-20261113-release-perf-baseline-gate-plan.md) Wave 0–2 |
| 适用范围 | 发布取证出口 SC-01–SC-16；**本条通过不表示可上线** |
| 输出位置 | `docs/reviews/2026-11-13-release-perf-baseline-gate-acceptance.md` |

## 结论

**发布取证出口证据齐（2026-11-13）**。Wave 0–2 实现 + 本表证据路径满足 Spec 出口；**≠ 可上线**，**≠ 各模块无问题**。

## SC 矩阵

| ID | 结果 | 证据路径 |
|---|---|---|
| SC-01 | PASS | `npm run perf:release-baseline`；Current Commands 已登记 |
| SC-02 | PASS | `--tier ci-small` 可非零失败退出；省略浏览器 Roles 墙钟（见分档文档） |
| SC-03 | PASS | [`release-perf-baseline-fixture-tiers.md`](../runbooks/release-perf-baseline-fixture-tiers.md)；`FIXTURE_TIER_FLOORS` |
| SC-04 | PASS | Roles 入 `api-warm`／`EXPECTED_CELLS`／release-perf；缺 Roles API 则 runner 失败 |
| SC-05 | PASS | RPB-W3：`inbox/perf-baselines/acceptance-w2/report.json` absolute RPB-W3 p95≈60ms ≤200ms |
| SC-06 | PASS | RPB-S1：`admin-roles` 单测 + release-perf `sourceMapBuilds≤1` |
| SC-07 | PASS | RPB-W4：`agent-list` 冷进页不拉 Roles 单测；runner 合同标记 |
| SC-08 | PASS | RPB-M1–M3：release-perf MCP initialize／tools/list／wiki_search（acceptance-w2 全 pass） |
| SC-09 | PASS | `release-perf-relative` D6 单测；无上版 `baseline-seed`；acceptance-w2 `--previous formal/LATEST` → `relativeMode=compared` |
| SC-10 | PASS | `npm run perf:release-baseline:formal-seed` → `inbox/perf-baselines/formal/LATEST` |
| SC-11 | PASS | 发版列车 P4-9；客户 checklist G7；Current Commands |
| SC-12 | PASS | 夹具真实 Fastify／ACL／审计路径；禁止 mock 权限刷分（沿用 Spec 174 文法） |
| SC-13 | PASS | Spec 174 Agent batch 合同仍由既有 entry-perf／ACL 单测守护；本条未改 deny |
| SC-14 | PASS | Roles 详情／dryRun 仍走 `previewRolePermissionsForAdmin` fresh；列表才 batch |
| SC-15 | PASS | `formal-seed` 拒绝报告中的 Bearer／DSN 模式；fixture Bearer 不写入 report |
| SC-16 | PASS | 状态含开发授权后才改运行路径；R4 口令在 2026-11-13 委托人明示 |

## RPB-W2 说明

- **release-medium**：Playwright `route-query-cold`＋`PERF_ROUTES=roles`，预算 ≤500ms（RPB-W2）。
- **ci-small**：为 PR 时长省略浏览器 Roles；绝对闸记 skip 说明，不冒充已测墙钟。
- **expectations**：Playwright `PERF_EXPECTED` 使用**服务端启动前**的 clean fixture 计数（与 Spec 174 R6 同型）；避免 fixture server seed 后 Manifest 表数与磁盘期望不一致。
- **acceptance-w2（2026-11-13）**：RPB-W2 **pass**，p95 primaryReadyMs ≈ **98.9ms**（limit 500）；报告 `inbox/perf-baselines/acceptance-w2/report.json`，`status=pass`。

## 命令复核（本机）

```bash
cd webui && npx vitest run scripts/__tests__/release-perf-relative.test.ts scripts/__tests__/entry-performance.test.ts server/__tests__/admin-roles.test.ts src/__tests__/agent-list.test.tsx
npm run perf:release-baseline -- --tier ci-small --skip-build --output inbox/perf-baselines/acceptance-ci
npm run perf:release-baseline -- --tier release-medium --skip-build --iterations 3 --warmup 1 \
  --output inbox/perf-baselines/acceptance-w2 --previous inbox/perf-baselines/formal/LATEST/report.json
```
