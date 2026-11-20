# Fixtures — UAT-SUITE-PAGE-DOM-SCALE

## 1. 参照线（观测口径，不新立合同）

| 指标 | 参照 | 说明 |
|---|---|---|
| primaryReady（前台 SPA） | ≤1000 ms | 沿用 fixtures §5 B 线；5× 线 2000 ms 仅备注 |
| 渲染期 longtask | 单任务 ≤200 ms，>200 ms 记观察 | 感知阈值 |
| consoleErrors | 0 | >0 记观察 |
| API 同窗口 | 分列记录，不套用页面线 | 防止"API 快冒充页面快" |

阈值变更须具名评审与委托人接受；本套件只观测、不改合同。

## 2. 浏览器与计时

系统 Chrome（headed，Playwright `channel:"chrome"`），1920×1080；逐轮断言 `visibilityState=visible`／`document.hidden=false`；协议=侧栏 SPA 点击 → 页面就绪表达式为真 → `performance.now()` 差；longtask 点击前 `PerformanceObserver` 布防；API 用页面内 `fetch` 同窗口采样分列。降级 headless 须跑次标注（本环境 headed 已验证可行）。

## 3. 造数纪律（R-2 教训）

1. 全部真实 API/真实流程，禁 mock、禁直改库（审计/run/release 造数只允许真实调用/真实执行）。
2. 写速率：单会话串行，写间隔 ≥500 ms；造数进程每 30 s 探 `/api/health`，异常即停表记观察，不强行续跑。
3. 前缀统一 `uat_pds_<batch>_<ts>_`（DB 对象 `uat_pds_` 前缀）；逐批记录造数成本（次数/耗时/失败）。
4. 无造数 API 的页面：只观测现状并写"现值非上限"，或 BLOCKED；不得以替身凑数。

## 4. 逐页规模与现状（2026-11-20 盘点）

| 页面 | 列表 API | 现状 | 加压目标 | 清理可行性 |
|---|---|---:|---:|---|
| /admin/tokens | GET /api/admin/tokens | 4 | ≥200 | 可（吊销/删除） |
| /ops/calls | GET /api/admin/audit | 4 行（7d） | ≥300 行 | 不可删（留样本） |
| /publish/history | GET /api/semantic-assets/releases | 0 | 少量真实 + 外推 | 不可删（留样本） |
| /eval/runs | GET /api/eval/runs | 0 | 少量真实 + 外推 | 不可删（留样本） |
| /connections/enabled-tables | PUT /api/connections/:id/enabled-tables | demo-mysql 3 表 | ≥200 张 | 可（DROP + 重置） |
| /admin/access-map | GET /api/admin/access-map | 现状 | 复用审计行 | 配置类还原 |

## 5. 清理（fixtures §7）

- 可清理对象逐批删除并 verify（tokens 吊销、DB 表 DROP、启用范围重置）；记录 verify 前后计数。
- 不可删数据（audit 行/eval run/release 记录）：跑次写明"真实业务数据留作观测样本"，并确认不含敏感内容（全部为 UAT 只读调用/评测产物）。
- 共享 demo 基线对象（9 roles/2 agents/既有连接）不得改动；遗留 `uat_racs_br_*` fixture 已于 2026-11-20 按审批点 D 清理并 verify 9/2。

## 6. 证据槽

跑次记录：候选、规模（API total 与 UI 行数）、每轮 primaryReady/DOM/longtask/consoleErrors、API 分列、造数成本、清理 verify、外推与判定。原始 JSON 落 `inbox/uat-pds-<batch>-<date>/`。
