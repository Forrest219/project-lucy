# 访问日志调用链故事线 Plan

| 元数据 | 内容 |
|---|---|
| 文档版本 / 日期 | **v0.1** / 2026-11-04 |
| 目标版本 / 优先级 | 不绑定产品版本号 / **P1**。功能编号无，不进入 v0.25 登记册 |
| 主 Spec | [`docs/specs/lucy-20261104-audit-call-storyline-spec.md`](../specs/lucy-20261104-audit-call-storyline-spec.md) |
| 权威语义 | Spec 194 / `lucy-20261102-audit-inquiry-kind` 的访问等级与问询 ID；本 Plan 修订 Spec 125 主表直展 SQL 的呈现密度 |
| 状态 | **v0.1 功能合同已收口（2026-11-04）**。SC-01–SC-16 关闭。本条收口不表示可上线 |
| 授权边界 | 2026-11-04 用户批准落地 Spec 并执行。范围：审计读取 API、问询抽屉调用明细、调用流水主表、调用 CSV 故事列、术语 §4.7。不授权镜像、部署、浏览器签字、KTX、git commit |
| 验收 | 以主 Spec §7 SC-01–SC-16 为准 |
| 实施主体 | Lucy WebUI：`webui/src/lib/audit-call-storyline.ts`、`Audit.tsx`、`webui/server/admin/audit.ts` |

## 1. 目标

1. 问询详情调用链默认排除连接级，展示动作 / 意图 / 结果摘要 / 相对上步。
2. 调用流水主表故事列优先；Agent、访问上下文、调用来源、生成 SQL 正文进入展开区。
3. CSV / 证据包取证列不删；追加 `call_action` / `call_intent` / `call_result_summary`。
4. 故事字段确定性派生，验收样例语义对齐问询 `376`。

## 2. 开工前置

| ID | 条件 | 状态 |
|---|---|---|
| P1 | 主 Spec v0.1 已落盘，D1–D9 可实施 | 满足 |
| P2 | 用户批准 Spec 并执行推进 | 满足（2026-11-04） |
| P3 | 基线：`audit-call-storyline` 单测、`admin-audit`、`audit.test`、`admin-audit-turns` | 开工时确认 |

## 3. 文件落点

| 路径 | 改动 |
|---|---|
| `webui/src/lib/audit-call-storyline.ts` | 新建派生函数 |
| `webui/src/lib/audit-call-storyline.test.ts` | SC-02–SC-05、SC-13 |
| `webui/server/admin/audit.ts` | 问询详情字段；CSV 故事列；export-metadata |
| `webui/src/lib/types.ts` | `AuditTurnCallLog` 扩展 |
| `webui/src/pages/admin/Audit.tsx` | 抽屉与调用流水列 |
| `webui/src/__tests__/audit.test.tsx` / `admin-audit-turns.test.tsx` | SC-06–SC-10 |
| `webui/docs/00-product-terminology-standard.md` | §4.7 |

## 4. 分阶段实施

### S1 纯函数与 API

- 实现 `buildCallStoryLine`；扩展 `mapAccessLogRow`。
- 调用 CSV 追加三列并更新字段说明。

### S2 问询抽屉

- 默认排除连接级 +「显示连接级」。
- L1：访问等级、动作、意图、结果摘要、相对上步；展开取证。

### S3 调用流水主表

- L1 故事列；身份 / SQL 进展开。
- 修正组件测试列头断言。

### S4 术语与文档索引

- §4.7；`docs/README.md` / `docs/plans/README.md` 登记。

## 5. 验收

对照主 Spec SC-01–SC-16。最低命令：

```bash
cd webui && npx vitest run src/lib/audit-call-storyline.test.ts src/__tests__/audit.test.tsx src/__tests__/admin-audit-turns.test.tsx
cd webui && npx vitest run server/__tests__/admin-audit.test.ts -t "CSV field metadata"
npm run lint:spec-docs
```

## 6. 完成定义

- [x] SC-01–SC-16 对应自动化绿或文档项已登记
- [x] 问询抽屉默认看不到连接握手噪声
- [x] 调用流水主表能区分宽查失败与缩指标成功（意图不同）
- [x] CSV 仍含 `generated_sql` 等取证列，并含故事三列
- [x] 未改 KTX；未回写 `access_log`

## 7. 风险

| 风险 | 缓解 |
|---|---|
| 主表去掉 Agent 影响扫一眼 | 筛条保留 Agent；展开保留调用方 |
| Spec 125 习惯依赖直展 SQL | 展开一行即见；CSV 不变 |
| 结果摘要误泄露敏感串 | 故事派生对 `password=` 等做与页面一致的脱敏 |
