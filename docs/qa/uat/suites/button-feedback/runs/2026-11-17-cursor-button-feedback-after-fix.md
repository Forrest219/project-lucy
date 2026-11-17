# Run — 2026-11-17 — cursor-button-feedback-after-fix

| 元数据 | 内容 |
|---|---|
| Suite | `UAT-SUITE-BUTTON-FEEDBACK` |
| Agent | Cursor |
| 环境 | 本机 demo `http://127.0.0.1:55176`（回环）；`demo:upgrade` 平滑升级后（保留配置，`preserved=true`），容器 `compose-lucy-1` healthy，构建带 `gitDirty=true`（含工作树未提交修复，以及另一会话未提交的访问关系图改动）；Playwright Chromium headless |
| 开始／结束 | 2026-11-17 ≈22:44 CST（探针约 59 秒） |
| 总判定 | **PASS WITH GAP**：必做 01–10 无缺陷判定（9 个 `REAL`，`UAT-BTN-07` 由 `DOWNLOAD-FAILED` 变为 **`HONEST-FAILURE`**）；S01／S02 `REAL`；G1 PASS。缺口：6 个入口 NOT-RUN；07 的 409 由 demo 数据真实造成，非产品缺陷但也没有成功导出过；低权限／网络层失败只有单测 |
| 对照 | 改前基线 [FAIL](2026-11-17-cursor-button-feedback-baseline.md) |
| 证据 | [evidence/2026-11-17-cursor-button-feedback-after-fix-probe-result.md](evidence/2026-11-17-cursor-button-feedback-after-fix-probe-result.md)、同名 `.json` |

| Case ID | 结果 | 证据摘要 |
|---|---|---|
| UAT-BTN-R0 | **PASS** | 登录 200 |
| UAT-BTN-01…06、08…10 | **REAL** | 文件名与字节数与基线一致（01 392 B、02 5290 B、03 6769 B、04 7466 B、05 3382 B、06 33082 B、09 105 B、10 11587 B）；08 配置审计 CSV 3527 B（比基线大，因探针每轮签发／吊销 Token 追加审计行） |
| UAT-BTN-07 | **HONEST-FAILURE** | 无文件；Toast：「导出失败：无法证明基础事实、归属修订、关联与聚合可按账本上界 S 精确重建，正式对账读取失败」；页面未跳走。服务端对该端点真实返回 `409`（curl 直测约 10 ms）。**改前同一点击：浏览器报下载失败、界面无任何说明** |
| UAT-BTN-S01 | **REAL** | 200，成功屏明文可见，警示与 `runtimeAck` 一致；Token 已吊销（HTTP 200） |
| UAT-BTN-S02 | **REAL** | 真实 `409 TOKEN_LABEL_TAKEN`，界面报错，未进入成功屏 |
| UAT-BTN-G1 | **PASS** | `lint:button-feedback` PASSED；`lint-button-feedback.test.ts` 17 条全过 |

## 探针自身的缺陷（本轮发现并修正，不是产品缺陷）

第一次改后跑 `UAT-BTN-07` 判成 `SILENT`。排查：curl 直测该端点约 10 ms 返回 409；真实浏览器手动点击，Toast 在 0–3 秒内出现。**根因在探针**：旧 `clickDownload` 先等满 45 秒的 `download` 事件，才读一次 Toast 快照，而 Toast 只停留数秒，读到时早已消失。

修正：下载事件与 Toast 并行观察并累计；失败 Toast 出现后 3 秒没有文件即判 `HONEST-FAILURE`，成功 Toast 出现后 10 秒没有文件仍判 `FAKE-SUCCESS`，两者窗口内有文件到达则按文件判。**判定规则未放宽**：没有任何反馈仍是 `SILENT`，成功提示但无文件仍是 `FAKE-SUCCESS`。修正后同一实例复跑得到上表结果。上面「总判定」以修正后的跑次为准；第一次改后跑（`SILENT`）不作为证据留档。

## 缺口

1. 6 个入口 NOT-RUN（原因见 cases.md「NOT-RUN 清单」）。
2. 07 在 demo 上从未导出成功过，所以「对账证据包能下到文件」没有在 demo 上被真实观察到；该 409 是否合理属功能问题，不在本套件范围。
3. 低权限被拒、网络层失败、`runtimeAck=false` 只有单测覆盖，不是 UAT 证据。
4. 修复仍在工作树，**未提交**；公网实例未升级（探针只在本机 demo 跑）。
5. `ApiDownloadLink` 在内存里缓存文件（100 MB 以内），超过则退回原生下载，该降级路径没有 UAT 覆盖（需要 100 MB 以上的真实导出）。
