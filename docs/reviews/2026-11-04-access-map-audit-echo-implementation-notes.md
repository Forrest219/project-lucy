# 访问关系图与访问日志口径对齐 —— 实施笔记

| 元数据 | 内容 |
|---|---|
| 实施日期 | 2026-11-04 |
| 主 Spec | [`docs/specs/lucy-20261102-access-map-audit-echo-spec.md`](../specs/lucy-20261102-access-map-audit-echo-spec.md) **v0.3** |
| 实施 Plan | [`docs/plans/lucy-20261102-access-map-audit-echo-plan.md`](../plans/lucy-20261102-access-map-audit-echo-plan.md) **v0.4**（S1→S2→S3） |
| 出口修订 | [`lucy-20261104-access-map-echo-exit-revision-spec.md`](../specs/lucy-20261104-access-map-echo-exit-revision-spec.md)／[Plan](../plans/lucy-20261104-access-map-echo-exit-revision-plan.md)（**已批准交付开发**） |
| 权威语义 | Spec 187 路径主键／守恒／边状态判定顺序不变；问询种类／访问等级复用 inquiry-kind Spec 与 Spec 194 |
| 结果 | **功能合同已收口（2026-11-04）**。S1–S3 已落地；SC-14 逐边在出口；SC-12 页序子句已拆出。本条收口不表示可上线。收口前一度回写的「功能合同未收口」是出口修订过渡态，已作废，不得当作现值 |
| 未做 | push、浏览器走查、Playwright、镜像／部署、客户环境、Spec 187 全量历史 SC 重跑。主 Spec C 类闭口已于 2026-11-04 批准 |

> 实施笔记不是现行状态。现行状态以 Spec 头部「状态」行为准。

---

## 一、改动摘要

### S1（服务端）

- 新建 `webui/server/admin/access-map-echo.ts`：严格解析 `inquiryKind`／`accessGrade`；D6 `resolveTurn`；`buildBandED`；复用 `inquiryKindOfTurn`／`inquiryKindMatches`／`accessGrade`；推断重建失败 → access `unavailable`。
- `access-map.ts`：`AccessMapQuery` 增字段；`parseAccessMapQuery` 非法 → 400；参数缺席 → management／exclude_connect；构图吃集合 E；`deniedCalls=\|D\|`；`meta.echo.enteringAllowCallCount`（结构筛选前）。

### S2（UI）

- `AccessMap.tsx`：主工具条「问询种类」「访问等级」下拉；「问询计入」分段与 trust-hint 移除；关联口径沉入「口径与快照」弱入口；E 空提示点名筛选。
- `AccessMapLegend.tsx`：图例前缀「关联口径：…」。
- 组件测试覆盖 SC-01–SC-09、SC-17–SC-18。

### S3（文档／lint）

- Spec 187 §4.2／§5.2／§6.3／§7.4 + chart-first／术语指针。
- 索引镜像。

### 收口前出口修订（2026-11-04 批准交付开发）

- 主 Spec SC-14：`p1-access-map.test.ts` 逐边 `accessCalls` ↔ `accessCallIds.size`，并断言不得用 Σ `accessCalls` 冒充 `enteringAllowCallCount`。
- 主 Spec SC-12：页序子句拆出；页序用例标题标注「过程证据」。
- 出口修订期间主 Spec／Plan／索引曾回写为「功能合同未收口」。该过渡态已作废，不得当作现值；现行状态是功能合同已收口。

---

## 二、SC 证据落点（主 Spec）

| ID | 证据 |
|---|---|
| SC-01、SC-02、SC-04–SC-08、SC-17、SC-18 | `webui/src/__tests__/access-map.test.tsx` |
| SC-03、SC-09（服务端）、SC-10–SC-11、SC-12（五态+unavailable）、SC-13–SC-16、SC-19 | `webui/server/__tests__/p1-access-map.test.ts` |
| SC-12 页序 | **拆出**；夹具仍在，标过程证据 |
| SC-14 逐边 | `p1-access-map.test.ts` SC-14（含 `mergeLayers`／`accessCallIds`） |
| SC-20 | Spec 187／chart-first／术语／索引 |

---

## 三、已知缺口

无阻塞收口的缺口。主 Spec C 类功能合同已于 2026-11-04 批准收口。

---

## 四、lint／vitest（出口修订验收）

```bash
cd webui && npx vitest run --maxWorkers=1 server/__tests__/p1-access-map.test.ts -t "SC-14"
cd /Users/forrest/GitHub/project-lucy && npm run lint:spec-docs
```

（结果写入本轮会话；通过后勾销出口修订 Plan §6。）
