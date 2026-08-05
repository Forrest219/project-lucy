# Connection Card Connectivity Health Summary Spec

| 元数据 | 内容 |
|---|---|
| 文档名称 | Connection Card Connectivity Health Summary Spec |
| 文档类型 | Spec |
| 版本 | v1.0 |
| 撰写日期 | 2026-08-06 |
| 撰写人 | Composer |
| 委托人 | zhangxingchen |
| 基于材料 | 产品确认：系统健康度缺 DB 连通 / ms；建议落在 `/connections` 卡右侧摘要；进页自动探一次；`POST /api/connections/:connId/test`；`ConnectionTestDrawer` / `ConnectionTestResultPanel`；Spec 27 / 39 / 44；Spec 107 并行探库先例 |
| 适用范围 | `/connections` 连接卡 Header 右侧；连通探测与 Drawer 结果同源；术语与 UI/UX 台账 |
| 输出位置 | `webui/docs/108-connection-card-connectivity-health-summary-spec.md` |

| 字段 | 内容 |
|---|---|
| Spec 编号 | 108 |
| 关联工单 | `webui/docs/plans/wo-202608-41-connection-card-connectivity-health-summary.md` |
| 关联页面 | `/connections`；`ConnectionTestDrawer` |
| 关联台账 | `docs/ui-ux-feedback/pages/connections.md`（`UX-CONNECTIONS-028`～`030`） |
| 上游 Spec | Spec 27（连通测试 Drawer）；Spec 39 §8.1（卡首行「最近连通测试」）；Spec 44（产品化；本 Spec 修订其「不新增测试入口」）；Spec 107（分连接并行探测、失败隔离） |
| 状态 | Implemented |
| 日期 | 2026-08-06 |
| 范围 | 连接卡右侧连通健康摘要；进页并行探测；与 Drawer 共用结果；延迟分级 |

### Changelog

| 版本 | 变更 |
|---|---|
| v1.0 | 初稿并落地：卡右侧健康摘要、进页探测、Drawer 同源 |

## 1. 背景

Lucy 已有按需 `ktx connection test`（含 `latencyMs`）与完整诊断 Drawer，但：

1. `/api/health` 与 Overview「系统状态」不包含数据库连通 / 延迟。
2. Spec 44 后连接卡去掉「测试连接」按钮，运维无法在概览页一眼看到「通不通、多少 ms」。
3. Spec 39 要求卡首行展示「最近连通测试」，尚未落地。

产品确认：在 `/connections` **每张连接卡右侧**放连通健康摘要；**每次打开该页执行一次探测**（不挡首屏）。

## 2. 目标

1. 每个 Connection 卡 Header 右侧展示紧凑连通健康摘要：状态 + 响应延时 ms + 探测时间。
2. `/connections` 挂载后，对每个连接**并行**调用既有 `POST /api/connections/:connId/test`；失败隔离。
3. 点击摘要打开既有 `ConnectionTestDrawer`；卡摘要与 Drawer 共用同一结果源。
4. 延迟分级与诊断面板一致（&lt;200 / ≤1000 / &gt;1000）。
5. 术语 / Spec 44 交叉引用 / UI/UX 台账同步。

## 3. 非目标

| 非目标 | 理由 |
|---|---|
| 不改 `/api/health` / k8s liveness | 探真实库不得绑进程探活 |
| 不把连通纳入 `/overview` 四卡条 | Spec 43；本单只做连接页详情面 |
| 不在卡上展开 stdout/stderr | 完整诊断仍归 Drawer |
| 不在 footer 恢复大号「测试连接」主按钮 | Spec 44 降噪；入口改为右侧摘要 |
| 不做浏览器验证（本轮） | Vitest + terminology + build + code review |
| 不替代 Spec 107 库内目录探测 | 连通健康 ≠ 库内表数；可并行打库 |

## 4. Terminology Compliance

Follows `webui/docs/00-product-terminology-standard.md`.

| Canonical Term | UI 主术语 | 禁止文案 | 说明 |
|---|---|---|---|
| Connection Health Summary | 连通健康 | 数据库健康度（作主标签）、DB Health | 卡右侧摘要区 |
| Connectivity Probe | 连通探测 | 心跳、Ping（作主标签） | 进页自动 `connection test` |
| Response Latency | 响应延时 | RTT、延迟（可作 tooltip） | 单位 ms；与诊断面板同词 |
| Connectivity OK | 通 | 正常（卡摘要优先用「通」；面板 banner 可保留「正常」） | `status=ok` 且 &lt;200ms |
| Connectivity Slow | 偏慢 | 慢 | 200–1000ms |
| Connectivity Attention | 需关注 | 很慢 | &gt;1000ms |
| Connectivity Down | 不通 | 失败（可作次级） | `status=error` 或探测异常 |
| Probing | 探测中… | 测试中…（卡摘要） | 首屏异步态；Drawer 内可保留「测试中...」 |

Protected：Connection id、`ktx connection test`、`ms`、数值、ISO/本地时间。

## 5. 产品行为

### 5.1 加载策略

- `/connections` 在 `project` 就绪后，对每个 Connection **并行**发起连通探测（React Query，`POST` 作 queryFn）。
- **每次进入页面探测一次**：`staleTime: 0`，离开再进入会重新探测；同页内 React Strict Mode 双挂载不得打出重复用户可见闪烁即可（queryKey 去重）。
- 不挡首屏：连接卡本地资产先渲染；摘要区显示「探测中…」。
- 单连接失败不影响其它连接与 Schema 表。
- Drawer「重新测试连接」：`refetch` 该连接 query，成功后卡摘要与 Drawer 同步更新。

### 5.2 卡右侧摘要

落在 Header 右侧 meta 区（与只读提醒 / 配置同步时间同列），**可点击**：

| 状态 | 展示 | tone |
|---|---|---|
| loading（尚无 data） | `探测中…` | muted |
| ok，&lt;200ms | `通 · N ms` + 时间 | success |
| ok，200–1000ms | `偏慢 · N ms` + 时间 | warning |
| ok，&gt;1000ms | `需关注 · N ms` + 时间 | danger |
| error / 请求失败 | `不通`（有 ms 则附带）+ 可选时间 | danger |

- 摘要**不是**完整诊断面板；不得塞 stdout/stderr。
- `aria-label`：`连通健康 · <connId> · <状态文案>`。
- 点击 → 打开该连接的 `ConnectionTestDrawer`（可带当前 result / pending）。

### 5.3 与 Spec 44 / Spec 107 关系

- **修订 Spec 44**：允许连接卡通过「连通健康摘要」作为连通诊断入口；仍禁止 footer 恢复并列大号「测试连接」文案按钮。
- Spec 107「库内表数」与本探测均可进页连库；文案与 testId 分离，避免用户把「重新拉取库内目录」与「连通健康」混为一谈。

## 6. API

复用既有：

### `POST /api/connections/:connId/test`

响应不变：`{ ok: true, data: ConnectionTestResult }`（含 `status`、`latencyMs`、`command`、stdout/stderr 等）。

本单不新增后端端点。

## 7. 验收标准

1. 打开 `/connections`，每张卡右侧出现连通健康摘要；挂载后发起并行 test。
2. 探测中不阻塞 Schema 表与 KPI。
3. 成功/失败/偏慢分级正确；点击打开 Drawer 且结果一致。
4. Drawer 重新测试后卡摘要更新。
5. 无浏览器验证；Vitest + `lint:terminology` + `build` 通过。

## 8. Design System Compliance（交付）

- Referenced docs：`27-connection-overview-ops-ux-cleanup-spec.md`；`44-connection-overview-productization-spec.md`；本 Spec
- Follows：卡 Header 右侧 meta；摘要可点击；Drawer 诊断一等
- Exceptions：卡摘要用「通」而非面板「正常」，以缩短扫读宽度
- Deviations：无
