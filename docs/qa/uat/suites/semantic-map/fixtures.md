# UAT-SUITE-SEMANTIC-MAP · fixtures

## 环境

| 项 | 要求 |
|---|---|
| 栈 | 本机 demo compose；默认 **lean**（`npm run demo:upgrade`） |
| 规模项 | `UAT-SM-13` 须 **scale**（`demo:upgrade:scale`）或 `customer-stability`；开跑前对应 `uat:scale-baseline` 退出 0 |
| 账号 | 可登录管理员 |
| 视口 | 1920×1080 前台 |

## 必做夹具（lean）

| 用途 | 来源 | 核对 |
|---|---|---|
| 连接 `demo-mysql` | demo seed | Catalog 可见 |
| overlay formal joins | `semantic-layer/demo-mysql/superstore_orders.yaml` → returns／people | SC-03／UAT-SM-03 |
| **SM-03 跑前前提** | 运行实例（容器内文件或只读 API）确认 Manifest 表节点 `superstore_orders` **无** `joins` 段 | **不成立 → UAT-SM-03 BLOCKED**，换表／重建夹具后重跑；不得照跑冒充并集判别力 |
| 负对照表 | `superstore_returns`／`superstore_people`：无自身 formal 出边、仅被 orders 引用 | UAT-SM-04 |
| Schema／表 | `dataforai` 下 superstore_* | 岛钻取 |

## 可选夹具

| 用例 | 造数 | 降级 |
|---|---|---|
| UAT-SM-07 | **首选**：Playwright／浏览器 DevTools 对投影 `GET` route.abort 或返回 503；**单岛失败**：使单 Schema Manifest 不可读（隔离卷临时损坏该 `_schema` 文件后刷新，跑后还原）；stale／pending：按 `display-snapshot` 合同触发 grace／stale（判定：降级组件文案出现） | 无法注入 → BLOCKED；降级须委托人授权（CONVENTIONS） |
| UAT-SM-11 | 隔离 project／临时卷：在 `semantic-layer/<conn>/_schema/<schema>.yaml` 与 `<source>.yaml` 为同 `(from,to)` 写入不同 `on` 的 formal joins；等待快照代次推进后再打开地图；跑次末还原文件并 reindex／刷新 | 无隔离卷 → SKIPPED／BLOCKED 并写原因 |
| UAT-SM-12 | 默认 demo 已有 `demo-mysql`＋`lucy-ops`；在临时 overlay 用限定名指向另一连接表；或延迟全站索引注入「未判定」 | **第二连接不可用** → SKIPPED（不得写「单连接环境」——与默认 demo 事实不符） |
| UAT-SM-13 | scale-baseline／customer-stability 水位 | lean → 不得 PASS |

## 写请求断言（UAT-SM-09）

**默认拒绝**：本页触发的请求（含非用户手势的自动请求），除 GET／HEAD 及白名单（静态资源、会话探活、既有 auth status 等只读）外，**一律 FAIL**。

已知写路径（辅助对照，非穷尽豁免）：`PUT /api/sources/...`、`POST /api/semantic-assets/validate`、`POST /api/semantic-assets/export`、`POST /api/semantic-assets/reindex`、`POST /api/semantic-assets/.../import`、publish／batch 写路径、joins 写路径。

## 清理

- 可选夹具须跑次末还原或使用隔离 project。
- 不得污染默认 demo 卷导致其他套件假红。
