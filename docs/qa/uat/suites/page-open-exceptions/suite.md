# UAT-SUITE-PAGE-OPEN — 二级页面与页签打开异常检查

| 元数据 | 内容 |
|---|---|
| Suite ID | `UAT-SUITE-PAGE-OPEN` |
| 总账 ID | **P1-44**／REQ-030-065（事故修复：页面渲染崩溃被兜底页伪装成版本问题） |
| 触发 | 错题 [2026-11-18-audit-calls-render-crash-misreported](../../../../lessons/2026-11-18-audit-calls-render-crash-misreported.md)：访问日志「调用流水」整页崩溃，界面显示「页面资源加载失败，可能是版本已更新」 |
| 目标 | 管理员登录后，侧栏每个二级入口与每个页签都能打开：没有未捕获异常，没有路由兜底边界，页面有标题或正文，页面自身的 `/api` 没有 5xx |
| 与既有套件的分工 | `UAT-SUITE-PAGE-SWEEP`（P1-31）量 GET 路由的事件循环耗时，不渲染页面；`release-ux` 结构套件只看侧栏壳层，错误文本判定不含兜底文案且已标注未复跑。本套件专门判定**页面能不能打开** |
| 判定器 | `scripts/uat/page-open-probe.mts` 中的 `classify()`，自检：`--selfcheck` |
| 跑次 | [runs/](runs/) |

## 必做／可选

| 必做 | 可选 |
|---|---|
| R0（管理员登录）、PO-01（侧栏二级入口逐个打开）、PO-02（页签逐个点击） | PO-03（详情页：`/admin/agents/:id` 等带参数路由，用真实 id 抽样；当前未做，见边界） |

## 用例

| ID | 判定 | 通过条件 |
|---|---|---|
| R0 | 管理员登录 | 登录成功，`/api/auth/status` 返回 `me`；否则 BLOCKED（退出码 2） |
| PO-01 | 侧栏二级入口 | `navigation.ts` 中每个入口（含 `/help`）打开后：无 `pageerror`，无 `route-chunk-error`，无 `route-render-error`，有 h1 或页头，或正文不少于 20 个非空白字符，页面 `/api` 无 5xx |
| PO-02 | 页签 | 每个 `main` 内的 `[role=tab]` 或分段控件（上限 6 个）逐个点击，点击后重复 PO-01 的判定 |
| PO-03 | 详情页（可选，未做） | 带参数路由以真实 id 打开，同 PO-01 判定 |

## 判定与证据

- 任一检查点 FAIL → 套件 FAIL（退出码 1）。不允许以「已登记越线」或「仅控制台报错」冒充通过。
- `console.error` 只记录，不作为 FAIL 依据：部分页面在演示数据下会打出与渲染无关的请求告警，单独判定会制造噪声。真正的渲染崩溃一定会有 `pageerror` 或兜底边界。
- 证据：`result.json`（逐检查点事实）与 `summary.md`（一表一行），输出到 `inbox/uat-page-open-YYYY-MM-DD/`。

## 边界

- 本机 demo Docker（`http://127.0.0.1:55176`），管理员凭据从仓库外凭据文件读入，不打印、不落盘。
- **未覆盖**：PO-03 详情页（`/admin/agents/:id`、`/skills/:id`、`/catalog/...` 等带参数路由）；页签上限 6 个，超出部分未点。以上两点在跑次里写成 GAP，不写成通过。
- **≠ 客户现场验证**，**≠ 功能合同收口**，**≠ 可上线**。客户实例未升级前，本套件不对其结论负责。
- 本套件不判定页面内容对错、不判定空态文案，只判定「能不能打开」。
