# UAT 跑次 — P1-80 启用表范围表清单三态诚实展示

| 元数据 | 内容 |
|---|---|
| 文档名称 | P1-80／REQ-030-101 Docker 前台浏览器 UAT |
| 文档类型 | Test Report |
| 版本 | v1.0 |
| 撰写日期 | 2026-11-23 |
| 撰写人 | Cursor Agent |
| 委托人 | xingchen |
| 基于材料 | Spec／Plan SC-01–SC-07；本机 demo 平滑升级后实例 |
| 适用范围 | 测试台本套件结果；≠ 功能合同收口；≠ 可上线 |
| 输出位置 | `docs/qa/uat/suites/enabled-tables-load-state/runs/2026-11-23-cursor-p180-load-state.md` |

## 环境

| 项 | 值 |
|---|---|
| WebUI | http://127.0.0.1:55176 |
| MCP Proxy | http://127.0.0.1:57881 |
| 容器 | `compose-lucy-1` healthy（`npm run demo:upgrade` 平滑升级，保留 volume） |
| `gitSha` | `19b1c314f3d4b3943b834a11e093b66c942bb498`（`gitDirty=true`） |
| 登录 | 管理员（凭据不入库） |
| 视口 | 1920×1080 真实前台浏览器 |
| 方法 | overview 注入 fetch 探针，仅改写 `GET /api/connections/:id/tables`；**未**点击「移出无效启用」；未改磁盘 |

## 结果总表

| 用例 | 结果 | 页面计时（约） | 要点 |
|---|---|---|---|
| `UAT-ETL-R0` | **PASS** | 首屏健康约 &lt;1 s（已登录会话） | 已选 **15/15**；无缺 Manifest／无效启用 |
| `UAT-ETL-01` pending | **PASS** | ~255 ms 至加载文案可见 | `whitelist-tables-loading-demo-mysql`／`lucy-ops`；文案「正在读取表清单…」；无缺 Manifest／无效启用；移出不可见 |
| `UAT-ETL-02` error | **PASS** | ~7.2 s（含 RQ 自动重试） | 「表清单读取失败，请重试。」＋重试按钮；无假阳性；移出不可见 |
| `UAT-ETL-03` empty | **PASS** | ~254 ms | 允许「2 个 Schema 缺少 Manifest」＋无效启用区；移出可见（**未点击**） |
| `UAT-ETL-04` 恢复 | **PASS** | ~252 ms | 解除注入后已选 **15/15**；无缺 Manifest／无效启用 |
| `UAT-ETL-05` 术语 | **PASS** | — | 定稿文案见上；pending／error 未用「缺少 Manifest」冒充 |

**套件判定：PASS**（R0／01–05）。组件单测 SC-01–SC-05：`webui` vitest `table-whitelist-load-state-honesty.test.tsx` **5/5 PASS**（同日）。

## 证据

- 截图：`inbox/uat-p180-load-state-2026-11-23/01-pending.png` … `04-healthy.png`
- 未点击「移出无效启用」；未 PUT enabled-tables；未改 Manifest 文件

## 边界

≠ 功能合同收口；≠ 可上线；不覆盖 display snapshot BUSY／首页超时。
