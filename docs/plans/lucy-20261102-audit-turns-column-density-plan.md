# 访问日志问询记录列密度 Plan

| 元数据 | 内容 |
|---|---|
| 文档版本 / 日期 | **v0.3** / 2026-11-02 |
| 目标版本 / 优先级 | 不绑定产品版本号 / **P2**。功能编号无 |
| 主 Spec | [`docs/specs/lucy-20261102-audit-turns-column-density-spec.md`](../specs/lucy-20261102-audit-turns-column-density-spec.md) |
| 状态 | **v0.3 已实施，功能合同未收口。本条收口不表示可上线**。S0–S3 完成；v0.3 补客户端/会话换行与问询时长上下双行 |
| 授权边界 | 2026-11-02 用户批准方案 1 并授权落地；授权 demo Docker **平滑**重建（保留账号 / ACL / audit volume）。不授权 `--fresh`、客户镜像、git commit、功能合同收口签字 |
| 验收 | 以主 Spec §5 SC-01–SC-08 为准 |
| 实施主体 | `webui/src/pages/admin/Audit.tsx`、`webui/src/app/app.css`、`webui/src/__tests__/admin-audit-turns.test.tsx` |

## 1. 目标

问询记录表按 Spec 方向调整列密度：收窄问询 ID / 开始时间 / 两计数列，放宽问询时长 / 问询种类 / 结果；开始时间双行；三档视口观感优于改前。倍数可微调。

## 2. 开工前置

| ID | 条件 | 状态 |
|---|---|---|
| P1 | 主 Spec v0.1 已落盘 | 满足 |
| P2 | 用户批准方案 1 并授权执行与平滑重建 | 满足（2026-11-02） |
| P3 | 改前基线可取：`/admin/audit` 问询记录有数据 | 开工时确认 |

## 3. 文件落点

| 路径 | 改动 |
|---|---|
| `webui/src/app/app.css` | `.pl-audit-turns-table { table-layout: fixed; … }`；列宽类；收紧 `.pl-audit-turn-id-cell`；计数列表头允许换行 |
| `webui/src/pages/admin/Audit.tsx` | 开始时间改 `AuditDateTime`；补 `pl-audit-turns-col-kind` / `pl-audit-turns-col-budget`；计数列表头去掉强制 nowrap |
| `webui/src/__tests__/admin-audit-turns.test.tsx` | SC-01/03/05 DOM 断言 |
| `inbox/audit-turns-column-density-*` | SC-08 三视口基线与改后证据（tmp，不入库要求） |

不改：`webui/server/admin/audit.ts`、调用流水表、CSV、术语标准。

## 4. 分阶段实施

### S0 改前取证

在 1280×800、1512×982、1920×1080 记录表头列宽 JSON 与截图到 `inbox/`。

### S1 组件测试先行

在 `admin-audit-turns.test.tsx` 增加断言：

- 开始时间单元格存在 `.pl-audit-date-time` 与 `data-part="date"` / `data-part="time"`
- `th.pl-audit-turns-col-kind`、`th.pl-audit-turns-col-budget` 存在
- `th.pl-audit-turns-col-calls` / `th.pl-audit-turns-col-budget` 不含 `whitespace-nowrap`
- `table.pl-audit-turns-table` 仍在

先跑失败，再改实现。

### S2 布局与双行时间

1. `Audit.tsx` 问询记录「开始时间」单元格改为 `<AuditDateTime value={entry.startedAt} />`。
2. 表头 / 对应单元格挂上 Spec §4 列 class。
3. `app.css`：

```css
.pl-audit-turns-table {
  table-layout: fixed;
  min-width: 72rem;
}
.pl-audit-turns-col-id { width: 7rem; }
.pl-audit-turn-id-cell {
  width: 7rem;
  min-width: 6rem;
  max-width: 7rem;
}
.pl-audit-turns-col-time { width: 6rem; }
.pl-audit-turns-col-duration { width: 7.5rem; }
.pl-audit-turns-col-kind { width: 5.75rem; }
.pl-audit-turns-col-calls { width: 3.5rem; }
.pl-audit-turns-col-budget { width: 3.75rem; }
.pl-audit-turns-col-result { width: 9rem; }
.pl-audit-turns-table th.pl-audit-turns-col-calls,
.pl-audit-turns-table th.pl-audit-turns-col-budget {
  white-space: normal;
  line-height: 1.25;
  vertical-align: bottom;
}
```

实施中可按观感微调 rem，保持 Spec 方向。

### S3 Docker 平滑重建与三视口验收

```bash
BUILDPLATFORM=linux/arm64 npm run demo:upgrade
```

不使用 `--fresh`。重建后打开 WebUI，复测三档视口，写入改后证据；人工确认 SC-08。

## 5. 验收

| SC | 落点 |
|---|---|
| SC-01–SC-03、SC-05、SC-07 | 组件测试 + CSS |
| SC-04、SC-06、SC-08 | 三视口列宽 JSON / 截图对比 |

## 6. 完成定义

- S0–S3 完成；SC-01–SC-08 有证据
- WebUI 地址可打开（demo 默认 `http://127.0.0.1:55176`）
- 未做 git commit（除非用户另授）
- 本条收口不表示可上线

## 7. 风险

| 风险 | 缓解 |
|---|---|
| `fixed` 后摘要 / 表列被挤 | 保留 `min-width` 与横滚；摘要列不强制过窄 |
| ID 列过窄导致复制点击困难 | 下限约 6rem；流水号通常 ≤4 位 |
| Docker 重建耗时长 | 用缓存 `demo:upgrade`，不清 volume |
