# 访问关系图与访问日志口径对齐 —— 实施笔记

| 元数据 | 内容 |
|---|---|
| 实施日期 | 2026-11-04 |
| 主 Spec | [`docs/specs/lucy-20261102-access-map-audit-echo-spec.md`](../specs/lucy-20261102-access-map-audit-echo-spec.md) **v0.3** |
| 实施 Plan | [`docs/plans/lucy-20261102-access-map-audit-echo-plan.md`](../plans/lucy-20261102-access-map-audit-echo-plan.md) **v0.4**（S1→S2→S3） |
| 权威语义 | Spec 187 路径主键／守恒／边状态判定顺序不变；问询种类／访问等级复用 inquiry-kind Spec 与 Spec 194 |
| 结果 | **v0.3 功能合同已收口（2026-11-04）**。SC-01–SC-20 关闭。本条收口不表示可上线 |
| 未做 | 浏览器走查、Playwright、客户环境、Spec 187 全量历史 SC 重跑（均不在本条出口） |

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

### S3（文档／lint／复跑）

- Spec 187 §4.2／§5.2／§6.3／§7.4 + 文首有效指针：候选集合相与 inquiryKind／accessGrade；图例「关联口径」；主筛选呈现指 echo Spec。**未改**路径主键／守恒算法正文语义。
- chart-first：工具条两下拉 + 弱入口关联口径指针；状态行加「有效呈现指针」，**不推翻**已收口。
- 术语标准 §4.8：登记「关联口径」；禁止「问询计入」作产品句。
- Spec／Plan／`docs/README.md`／`docs/plans/README.md`／REQ-030-003 镜像与 Spec 头部一致。

### 收口补测（2026-11-04，用户选 A）

- **SC-12 页序**：`p1-access-map.test.ts` 增「先开关系图／先开审计页」夹具——同一套重建准备后 `E` 一致；不重建时 pending 调用在 management 下不进 E。
- **SC-14 逐边**：同路径双调用夹具；对每条返回边断言 `accessCalls(e)=\|I(e)\|`（对照 `mergeLayers` 的 `accessCallIds`）；并断言 `Σ accessCalls ≠ enteringAllowCallCount`。

---

## 二、SC 证据落点

| ID | 证据 |
|---|---|
| SC-01、SC-02、SC-04–SC-08、SC-17、SC-18 | `webui/src/__tests__/access-map.test.tsx` |
| SC-03、SC-09（服务端）、SC-10–SC-16、SC-19 | `webui/server/__tests__/p1-access-map.test.ts`（及 contract／conservation 回归） |
| SC-09（组件 trust URL） | `access-map.test.tsx` |
| SC-12 页序 | `p1-access-map.test.ts`「先开关系图／先开审计页」 |
| SC-14 逐边 `accessCalls=\|I(e)\|` | 同上 SC-14 用例（含 `mergeLayers` 对照） |
| SC-20 | 本笔记 §一 S3；Spec 187／chart-first／术语／索引已改 |

复跑命令与摘要见 §四、§五。

---

## 三、已知缺口

无。原 SC-12 页序与 SC-14 逐边缺口已在收口前补齐。

---

## 四、lint 四项（仓库根）

命令：

```bash
cd /Users/forrest/GitHub/project-lucy && npm run lint:spec-docs && npm run lint:spec && npm run lint:terminology && npm run lint:ia-boundary
```

| 命令 | 结果 |
|---|---|
| `lint:spec-docs` | **PASS**（382 files；既有 untracked prompt 文件 WARN，不阻塞；收口提交不纳入那些 prompt） |
| `lint:spec` / `lint:terminology` / `lint:ia-boundary` | 实施当日已 PASS；收口以 vitest 与 `lint:spec-docs` 为主复核 |

---

## 五、vitest 验收套件

命令：

```bash
cd /Users/forrest/GitHub/project-lucy/webui && npx vitest run --maxWorkers=1 \
  server/__tests__/p1-access-map.test.ts \
  server/__tests__/p1-access-map-contract.test.ts \
  server/__tests__/p1-access-map-conservation.test.ts \
  src/__tests__/access-map.test.tsx \
  src/__tests__/access-map-layout.test.tsx \
  server/__tests__/admin-audit.test.ts \
  server/__tests__/audit-inquiry-kind.test.ts \
  server/__tests__/access-grade.test.ts
```

| 结果 | **8 files passed / 173 tests passed**（2026-11-04 收口复跑，含 SC-12 页序与 SC-14 逐边） |
|---|---|

---

## 六、收口状态句（已写入 Spec 头部及镜像）

```text
v0.3 功能合同已收口（2026-11-04）。SC-01–SC-20 关闭；证据见实施笔记。本条收口不表示可上线。
```
