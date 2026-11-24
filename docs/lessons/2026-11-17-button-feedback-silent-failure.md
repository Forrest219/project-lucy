# 错题：下载／导出／保存按钮的成功反馈不以真实结果为前提（静默失败与误报成功）

| 元数据 | 内容 |
|---|---|
| 日期 | 2026-11-17 |
| 标签 | `ux-regression` `gate-gap` `sev-low` |
| 环境 | 本机 demo Docker（`http://127.0.0.1:55176`，修复前构建）；工作树分支 `lucy-v0.30` |
| 相关 | 总账 **P1-42**／REQ-030-063｜前序错题 [2026-11-17-clipboard-http-fake-success](2026-11-17-clipboard-http-fake-success.md)｜测试台 `UAT-SUITE-BUTTON-FEEDBACK`｜门禁 `webui/scripts/lint-button-feedback.mjs`｜Spec 14 §0.3 |
| 状态 | `open`（四处缺陷已在**工作树**修复并有单测；本机 demo 已升级并改后复跑 **PASS WITH GAP**；待提交合入后关闭；见 §6） |

## 1. 症状与影响

P1-40 复盘时的追问「同类问题为什么没一并查」，把范围扩到下载／保存／导出（仅按钮级）。四类现象：

| # | 现象 | 严重度 |
|---|---|---|
| D1 | 10 个导出链接是裸 `<a href="/api/…" download>`。服务端拒绝时，失败只出现在浏览器下载栏，应用界面静默。demo 上**对账导出真实命中**：`409 RECONCILIATION_AS_OF_S_UNPROVABLE`，用户点了没有任何说明 | 低（可用性）；对用户**不透明** |
| D2 | `DELETE /api/admin/agents/:userId` 在写入回滚时仍回 `ok:true, written:true`，界面提示「已删除」 | 中：真实写入失败被报成功（单测复现 200，应为 500） |
| D3 | 新建 Token 在 `runtimeAck≠true` 时无任何提示，成功屏照常出现，Token 可能暂时不可用 | 低 |
| D4 | Eval YAML 下载：`fetch` 抛网络异常时无提示（未处理的 Promise 拒绝） | 低 |

## 2. 复现要点

- D1：登录 demo，打开审计对账页，点「导出对账证据包」。探针：Playwright `download` 事件 `failure()` 非空，应用界面无 Toast。
- D2：单测 `webui/server/__tests__/admin-agents.test.ts` 把 `writeAccessConfigFileWithAuditClosure` 覆盖为 `rolled_back`，HTTP 200（修复前）→ 500（修复后）。
- D3／D4：单测（`new-token.test.tsx`、`eval-cases.test.tsx`）；`runtimeAck=false` 与网络层失败在真实实例上无法触发，**只放单测，不进 UAT**。

## 3. 根因

| 层 | 结论 |
|---|---|
| D1 | 浏览器原生下载把 HTTP 错误体当作文件或直接失败，应用拿不到状态码。没有统一入口，每处自己写 `<a download>` |
| D2 | `writeAccessYaml` 返回结果对象而非抛错；该路由没有检查 `status`，把「写入器返回了」当成「写成功了」。与 P1-40 同形：**把 API 的返回当成效果的证据** |
| D3 | Spec 14 §0.3 要求写入类成功仅当 `runtimeAck === true`；创建 Token 的前端没有读该字段 |
| D4 | `fetch` 只处理了 `!ok` 分支，没有处理抛错分支 |

## 4. 为何漏检

- P1-40 的门禁只盯「复制」；下载、保存是同一类原则，却没有独立登记表，也没有「成功提示以结果为前提」的统一断言。
- 现有 UAT 只验「功能能用」，没有一条用真实失败验证「失败有说明」。
- 单测大量 mock 了 `fetch` 与写入器，从未让写入器返回非成功态。
- `admin-agents.test.ts` 在 HEAD 上就整体变红（审计 mock 缺 `MAX(id)` 查询），**没有人发现这条测试已死**，其覆盖的删除路径因此无人看守。

## 5. 举一反三（已落地）

- **统一入口**：`ApiDownloadLink`／`downloadApiFile` 先 `fetch` 判状态再保存；超过 100 MB 退回原生下载（主路径逃生，大文件仍能下）；失败 Toast 带原因。
- **登记表＋门禁**（`lint:button-feedback`，接入 `pretest`）：B1 下载触发点必须登记；B2 登记为 `click` 的必须有测试台用例；B3 裸 `fetch` 必读 `.ok`；B4 服务端 `writeAccessYaml` 必须处理非 `committed`；B5 禁止裸 API 下载链接。基线 16 个触发点。
- **探针**：`npm run uat:button-feedback`，真实 Chromium 监听 `download` 事件；失败只用真实 4xx。

### 排查后排除（不是缺陷）

Token 吊销提示「新请求将立即拒绝」成立：代理认证时直接查 SQLite `revoked_tokens`（`proxy/audit.ts`），不依赖 `runtimeAck`。

## 6. 后续动作

| 动作 | 状态 |
|---|---|
| 工作树修复 D1–D4＋单测＋门禁＋探针＋测试台文档 | 已完成（2026-11-17） |
| 部署到本机 demo 并复跑探针 | 已完成：`UAT-BTN-07` 由 `DOWNLOAD-FAILED` 变 `HONEST-FAILURE`；复跑中还修了探针自身的 Toast 快照过晚缺陷（误判 SILENT） |
| 提交合入 | 待委托人指示 |
| 对账导出在 demo 数据下 409 是否合理 | 功能问题，**不在本错题范围**，未评判 |
| 6 个入口 NOT-RUN | 见 `docs/qa/uat/suites/button-feedback/cases.md` |
| 单测既有红灯：`webui/server/` 下 37 个文件共 314 条在 HEAD 即失败（与本轮改动无关，已用干净 HEAD worktree 逐文件对比） | **未修**，另开 |

## 7. 证据指针

- 跑次：`docs/qa/uat/suites/button-feedback/runs/` 下 baseline（FAIL）与 after-fix（PASS WITH GAP），均含 `evidence/`
- 门禁与单测：`webui/scripts/__tests__/lint-button-feedback.test.ts`；`webui/src/__tests__/{download-api-file,api-download-link,new-token,eval-cases}.test.*`；`webui/server/__tests__/admin-agents.test.ts`
