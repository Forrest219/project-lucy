# 错题：访问日志「调用流水」渲染崩溃，被路由兜底页伪装成「页面资源加载失败，可能是版本已更新」

| 元数据 | 内容 |
|---|---|
| 日期 | 2026-11-18 |
| 标签 | `ux-regression` `gate-gap` `contract-stack` `sev-high` |
| 环境 | 本机 demo Docker（`compose-lucy-1`，修复前 `gitSha=08646e2f…`，修复后 `801b9c02…`；`gitDirty=true`） |
| 相关 | 前序错题 [2026-11-18-db-original-error-not-surfaced](2026-11-18-db-original-error-not-surfaced.md)（同类「错误被吞、文案误导」）· 故事线 Spec [lucy-20261104-audit-call-storyline-spec.md](../specs/lucy-20261104-audit-call-storyline-spec.md) · 存在但未拦住的门禁 [`webui/tests/release-ux/structure.spec.ts`](../../webui/tests/release-ux/structure.spec.ts) |
| 状态 | `mitigated`（页面已恢复、单测已补；路由兜底文案误报、门禁缺口未闭合，见 §6） |

## 1. 症状与影响

- 管理员打开 `/admin/audit?range=30d&view=calls`（访问日志 → 调用流水），页面只显示红字「页面资源加载失败，可能是版本已更新。」和「重试」按钮。用户原话：「打不开」。
- 重试按钮调用 `window.location.reload()`，刷新无效，因为问题不在版本。
- 影响面：访问日志的调用流水整页不可用。问询记录页签不受影响。只要 `auth_failure` 行存在于流水里就会触发（没有 `tool` 字段的行），与用户数据量无关，不是偶发。

## 2. 复现要点

1. 以管理员登录 demo WebUI，打开上面的 URL。
2. 浏览器控制台：`TypeError: Cannot read properties of undefined (reading 'startsWith')`，栈落在 `Audit-*.js` 的调用流水渲染里。
3. 直接请求 `GET /api/admin/audit?range=30d&view=calls` 返回 200，且 `entries` 中含 `eventType: "auth_failure"` 的行（无 `tool`）。
4. 未登录时页面先显示「加载中…」再跳到登录页，这是正常鉴权行为，不是本次故障，但容易与之混淆。

判定条件：页面出现 `route-chunk-error`（`data-testid`）即为本类故障；`pageerror` 为 TypeError 而非 `ChunkLoadError` 即说明不是版本问题。

## 3. 根因

分两层，缺一不可。

**实现（直接原因）**：`GET /api/admin/audit` 按设计把 `auth_failure_log` 行与调用行合并进 `entries`（SC-21，`webui/server/admin/audit.ts`）。`auth_failure` 行没有 `tool`、`durationMs`、`requestId`。前端 `EntryRow` 对每一行都调用 `buildCallStoryLine(toCallStoryInput(entry))`，故事线里 `tool.startsWith(...)` 对 `undefined` 取值，抛出渲染异常。类型 `AuditLogEntry.tool: string` 也没有反映「可缺失」，TypeScript 没有拦住。

**兜底（放大原因）**：`webui/src/app/App.tsx` 的 `RouteChunkBoundary` 用 `getDerivedStateFromError` 捕获**所有**子树渲染错误，然后固定显示「页面资源加载失败，可能是版本已更新」。它的注释写的是「失败的路由 chunk」，但实现没有区分 `ChunkLoadError` 与普通 `TypeError`。结果是任何渲染 bug 都被说成版本问题，并给出一个对这类 bug 无效的「重试」（刷新）。原始错误只在控制台里，管理员看不到。

**合同**：调用流水的故事线合同只描述了 `tool` 存在时的行为，没有写「合并进来的非调用行如何展示」。

## 4. 为何漏检

- `webui/tests/release-ux/structure.spec.ts` 会点遍历侧栏每个一级、二级入口，看 `h1` 与页头，但它的错误文本判定 `errorTextViolations` 只匹配 `Failed to fetch` 与堆栈帧，**不匹配**兜底页的文案，所以「页面资源加载失败」直接放行。该套件也标注 E2E-NAV 已作废、本轮未复跑，等于没有生效的页面打开检查。
- 单测 `audit.test.tsx` 只喂调用行，没有混入 `auth_failure` 行。`audit-call-storyline.test.ts` 只测 `tool` 有值的情形。
- `UAT-SUITE-PAGE-SWEEP`（P1-31）量的是 GET 路由的事件循环耗时与 5xx，不渲染页面、不看前端异常，所以对渲染崩溃无判定力。
- 我在排障第一轮的表述也有偏差：把现象说成「打不开」，并先按鉴权跳转方向找，直到取到控制台栈才定位。若从第一步就看 `pageerror`，可以更早定位。

## 5. 举一反三

1. **合并数据源的前端渲染必须按最弱行形态写**：一个列表混入多种事件类型时，每个类型的必填字段都要当成可缺失处理；类型定义要反映真实形态（`tool?` 而不是 `tool: string`）。
2. **路由兜底边界必须分流**：`ChunkLoadError`（或 `Failed to fetch` 动态导入）才显示「版本已更新／重试」；其余渲染异常显示「本页出错」并附错误类别，原始信息只给管理员。不得把普通 `TypeError` 包装成版本文案。
3. **页面打开检查要看 `pageerror` 与 `route-chunk-error`，而不是只看 h1**：任何新增页面或页签默认纳入，判定失败即 FAIL。
4. **排障先取控制台与栈**，不要先从鉴权或网络方向猜；与「未登录先显示加载中」这类正常行为要分开标注。
5. 凡是新增「合并进列表的非主类型行」（如鉴权失败、拒绝、推断记录），必须同时补一条 fixture 进前端单测与 UAT 页面打开检查。

## 6. 后续动作

| 动作 | 状态 | 说明 |
|---|---|---|
| 调用流水对 `auth_failure` 行单独渲染，故事线对缺 `tool` 做空值防护 | 完成（未提交） | `webui/src/pages/admin/Audit.tsx`、`webui/src/lib/audit-call-storyline.ts`、`webui/src/lib/types.ts` |
| 单测：storyline 缺 tool；audit 页混入 auth_failure 行不崩 | 完成 | `audit-call-storyline.test.ts`、`__tests__/audit.test.tsx`，12/12 通过 |
| 修正 `RouteChunkBoundary`：只有 chunk 加载错误显示版本文案，其余显示「本页出错」并保留错误类别 | 完成（未提交） | 委托人 2026-11-18 授权。`webui/src/app/App.tsx`；单测 `route-chunk-boundary.test.tsx` 3/3 |
| 新建「页面打开异常」UAT，覆盖全部侧栏页面与页签 | 完成（PASS WITH GAP） | 总账 P1-44／REQ-030-065；套件 [`UAT-SUITE-PAGE-OPEN`](../qa/uat/suites/page-open-exceptions/suite.md)；demo 55/55，详情页 NOT-RUN |
| `errorTextViolations` 增加兜底文案判定，并让 `release-ux` 重新复跑 | 未开 | 页面打开判定已由新 UAT 覆盖；`release-ux` 自身未改，仍标注未复跑，另行决定 |
| 线上实例（`10.69.95.109`）是否含本次修复 | 未核对 | 需登录后确认 `gitSha`，未升级 |

## 7. 证据指针

- 崩溃栈：浏览器控制台，`Audit-DN30gZCF.js` 的 `startsWith`（修复前 bundle）；修复后同页无 `pageerror`。
- 兜底页来源：[`webui/src/app/App.tsx`](../../webui/src/app/App.tsx)（`RouteChunkBoundary`，约 300–330 行）。
- 故障行形态：`webui/server/admin/audit.ts` 中 `eventType: "auth_failure"` 的合并段（约 3759–3772 行）。
- 修复后页面截图（浏览器取证，未入库）：调用流水表格可见，`auth_failure` 行显示「鉴权失败」。
