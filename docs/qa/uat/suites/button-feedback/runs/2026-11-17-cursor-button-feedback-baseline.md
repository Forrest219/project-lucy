# Run — 2026-11-17 — cursor-button-feedback-baseline

| 元数据 | 内容 |
|---|---|
| Suite | `UAT-SUITE-BUTTON-FEEDBACK` |
| Agent | Cursor |
| 环境 | 本机 demo `http://127.0.0.1:55176`（回环）；容器 `compose-lucy-1` healthy；Playwright Chromium headless |
| 被测构建 | **修复前**：容器镜像不含本轮工作树里的 P1-42 修复（`ApiDownloadLink`、NewToken 警示、删除 Agent 回滚处理、`CaseList` 网络异常提示均未部署） |
| 开始／结束 | 2026-11-17 ≈22:32 CST（探针约 46 秒） |
| 总判定 | **FAIL（改前基线）**：必做 01–10 中 9 个 `REAL`，**`UAT-BTN-07` `DOWNLOAD-FAILED`**；S01／S02 `REAL`；G1 PASS（门禁在工作树上通过）。修复已在工作树，**尚未部署到该实例，未复跑** |
| 证据 | [evidence/2026-11-17-cursor-button-feedback-baseline-probe-result.md](evidence/2026-11-17-cursor-button-feedback-baseline-probe-result.md)、同名 `.json` |

| Case ID | 结果 | 证据摘要 |
|---|---|---|
| UAT-BTN-R0 | **PASS** | 登录 200 |
| UAT-BTN-01 | **REAL** | `demo-superstore.md`，392 B |
| UAT-BTN-02 | **REAL** | `demo-mysql-dataforai-superstore_orders.yaml`，5290 B |
| UAT-BTN-03 | **REAL** | `demo_superstore-eval-suite.yaml`，6769 B；「已准备」提示出现在文件到手之后 |
| UAT-BTN-04 | **REAL** | `dataforai.yaml`，7466 B；「已开始下载」。首轮 12 秒窗口内服务端未响应被误判 `SILENT`，已把等待窗口放宽到 45 秒后复跑为 REAL（见下「探针自身的修正」） |
| UAT-BTN-05 | **REAL** | `audit-turns-….csv`，3382 B |
| UAT-BTN-06 | **REAL** | `audit-pack-….zip`，33082 B |
| UAT-BTN-07 | **FAIL（DOWNLOAD-FAILED）** | 服务端对 `/api/admin/audit/reconciliation/export?hours=24` **真实返回 `409 RECONCILIATION_AS_OF_S_UNPROVABLE`**（「无法证明…正式对账读取失败」）；浏览器报下载失败（文件名 `export.json`），**应用界面没有任何说明** |
| UAT-BTN-08 | **REAL** | `config-audit-….csv`，2819 B |
| UAT-BTN-09 | **REAL** | `publish-history-….csv`，105 B |
| UAT-BTN-10 | **REAL** | `lucy-semantic-asset-exp_….zip`，11587 B |
| UAT-BTN-S01 | **REAL** | 真实签发 200，成功屏显示明文，警示与 `runtimeAck` 一致（探针内置一致性判定）；Token 已吊销（HTTP 200） |
| UAT-BTN-S02 | **REAL** | 同标签再签发：真实 `409 TOKEN_LABEL_TAKEN`，界面报错，未进入成功屏 |
| UAT-BTN-G1 | **PASS** | `lint:button-feedback`：16 触发点／4 裸 fetch／8 写入调用，无违规；`lint-button-feedback.test.ts` 17 条全过（含删除 Agent 的原始写法反例） |

## 本轮缺陷（均为按钮级）与处置

| # | 缺陷 | 发现方式 | 处置（工作树，未部署） |
|---|---|---|---|
| D1 | 10 个链接式导出（裸 `<a href="/api/…" download>`）：服务端拒绝时只有浏览器下载栏知道，应用界面静默；对账导出在 demo 上真实触发 | 探针 `UAT-BTN-07` 实测 `DOWNLOAD-FAILED` | 新增 `ApiDownloadLink`／`downloadApiFile`：先读状态再保存，拒绝时 Toast 说明原因；超过 100 MB 退回浏览器原生下载（主路径逃生）；门禁 B5 禁止裸 API 链接。单测 `download-api-file.test.ts` 8 条、`api-download-link.test.tsx` 5 条 |
| D2 | `DELETE /api/admin/agents/:userId` 在写入回滚（`rolled_back`）时仍回 `ok:true, written:true`，界面提示「已删除」 | 静态排查 `writeAccessYaml` 全部调用点，对照 §14.3.2 三态契约 | 非 `committed` 走 `accessWriteResponseBody`（500／503）。单测 `admin-agents.test.ts`：修复前红（200），修复后绿；门禁 B4 守住该形态 |
| D3 | 新建 Token 在 `runtimeAck≠true` 时仍显示成功屏而无任何说明，Token 可能暂不可用 | 静态排查读 `runtimeAck` 的写入入口（Spec 14 §0.3） | 成功屏在 `runtimeAck≠true` 时显示警示，明文仍可见（不隐藏，避免 Token 孤立）。单测 `new-token.test.tsx` 2 条 |
| D4 | `CaseList` 下载 Eval YAML：`fetch` 抛网络错误时无提示（未处理的 Promise 拒绝） | 静态排查 3 处裸 `fetch` | 捕获并 Toast；单测 `eval-cases.test.tsx` 2 条（网络失败红→绿；HTTP 失败作防回退） |

## 排查后**排除**的疑点（不是缺陷，已核实）

- Token 吊销／Agent 内 Token 撤销提示「新请求将立即拒绝」：代理认证时直接查 `revoked_tokens`（`proxy/audit.ts`），吊销在 YAML 写入前已落库，与 `runtimeAck` 无关，该说法成立。
- 本轮盘点了 68 处成功提示（`toast.success` 等）并按「提示是否以请求真成功为前提」分类；除 D2／D3／D4 外，走 `ApiError` 抛错的保存调用未发现提前报成功的写法。该盘点是人工分类，**不是**机器全覆盖证明；机器可守的部分已落入门禁 B3／B4。

## 探针自身的修正（不是产品缺陷）

- `UAT-BTN-04` 首轮 `SILENT`：服务端当时 15 秒内未响应，探针 12 秒窗口过短。已放宽到 45 秒，并在 suite.md 里写明「慢≠静默」。按钮在等待期间显示「下载中…」；响应到达后下载并提示。
- 「下载 Manifest」在每个 Schema 行的「更多」折叠菜单里，探针改为逐行展开直到出现可见按钮。

## 缺口（PASS WITH GAP 之外的未完成项）

1. **修复未部署、未复跑**：D1–D4 的修复在工作树，实例仍是旧构建。要翻绿须 `demo:upgrade` 后复跑同一探针（预期 `UAT-BTN-07` 变为 `HONEST-FAILURE`：无文件，Toast 说明 409 原因）。工作树里还有他人未提交的访问关系图改动，升级会一并带入，须先确认。
2. **6 个入口 NOT-RUN**（原因见 cases.md「NOT-RUN 清单」）。
3. **真实失败场景有限**：低权限账号被拒、网络层失败、`runtimeAck=false` 在 demo 上都无法真实触发，只在单测覆盖，不是 UAT 证据。
4. **`UAT-BTN-07` 的 409 本身**（对账「按账本上界 S 精确重建」在 demo 数据上证明不了）是否合理，属功能问题，**不在本套件范围**，未评判。
