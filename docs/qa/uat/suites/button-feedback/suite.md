# UAT-SUITE-BUTTON-FEEDBACK — 按钮级成功反馈真实性（下载／保存／导出）

| 元数据 | 内容 |
|---|---|
| Suite ID | `UAT-SUITE-BUTTON-FEEDBACK` |
| 总账 ID | **P1-42**／REQ-030-063 |
| 目标 | P1-40（复制假成功）同类排查：下载、保存、导出类按钮的界面反馈，是否以动作的**可观察结果**为前提。下载＝浏览器真收到一个非空、文件名正确、不是错误体的文件；保存＝请求真成功才显示成功，失败诚实显示。并让「新增下载入口不登记就进不了仓库」 |
| 范围边界 | **仅按钮级**。不判断导出内容对错、字段完整性、业务功能、权限语义、性能、移动端 |
| 合同回链 | 错题 [2026-11-17-button-feedback-silent-failure](../../../../lessons/2026-11-17-button-feedback-silent-failure.md)；前序 [UAT-SUITE-COPY-FAKE-SUCCESS](../copy-fake-success/suite.md)；Spec 14 §0.3（写入类成功仅当 `runtimeAck === true`）；勾连 [e2e-ledger](../../../../governance/e2e-ledger.md) |
| cases | [cases.md](cases.md) |
| fixtures | [fixtures.md](fixtures.md) |
| runs | [runs/](runs/) |
| 自动化 | 探针 `npm run uat:button-feedback`（= `scripts/uat/button-feedback-download-probe.mjs`）；登记门禁 `npm --prefix webui run lint:button-feedback`（接入 `pretest`）；登记表 `webui/scripts/download-surfaces.manifest.json` |

## 必做／可选

| 必做 | 可选 |
|---|---|
| UAT-BTN-R0、UAT-BTN-01 … UAT-BTN-10（下载入口）、UAT-BTN-S01／S02（保存，真实结果）、UAT-BTN-G1（门禁） | 登记为 `not-run` 的入口：实例具备前置数据后再点（见 cases.md「NOT-RUN 清单」） |

## 判定口径

探针在真实 Chromium 里点击入口，监听浏览器的 `download` 事件，并读取界面新出现的 Toast／文案。

| 单入口判定 | 含义 | 套件影响 |
|---|---|---|
| `REAL` | 收到文件；非空；文件名与入口匹配；不是 `{"ok":false…}` 错误体 | 通过 |
| `HONEST-FAILURE` | 没有收到文件，且界面明确提示了失败原因 | 通过（按钮级诚实）；若失败由环境数据造成，记 GAP 供人复核 |
| `DOWNLOAD-FAILED` | 浏览器报告下载失败，而应用界面没有任何说明 | **FAIL**（失败被藏在浏览器下载栏里） |
| `SILENT` | 没有文件，也没有任何提示 | **FAIL** |
| `FAKE-SUCCESS` | 界面提示成功，但浏览器没有收到文件 | **FAIL** |
| `EMPTY-FILE`／`ERROR-BODY-AS-FILE`／`BAD-NAME` | 收到的文件是空的／是错误体／文件名与入口不符 | **FAIL** |
| `NAVIGATED-AWAY` | 点击把用户带离当前页（通常落到原始 JSON 错误页） | **FAIL** |
| `NOT-RUN` | 入口当前实例不可达或前置数据缺失 | 须写原因；登记为 `click` 的入口 NOT-RUN 记 PASS WITH GAP |

## 失败只用真实失败

- 不做网络故障注入、不 mock、不打桩。网络层失败（`fetch` 抛错）、`runtimeAck=false` 这类**无法真实触发**的分支，只放单测（`eval-cases.test.tsx`、`download-api-file.test.ts`、`new-token.test.tsx`、`admin-agents.test.ts`），不进 UAT，也不能当 UAT 证据。
- 真实失败来源：同一 Agent 同标签再次签发 Token（服务端真实 `409 TOKEN_LABEL_TAKEN`，`UAT-BTN-S02`）；以及实例当下就会拒绝的导出（2026-11-17 基线里对账导出真实返回 `409 RECONCILIATION_AS_OF_S_UNPROVABLE`，`UAT-BTN-07`）。
- 做不到的真实失败（例如低权限账号导出被拒）：demo 没有对应账号，**标 NOT-RUN，不造替身**。

## 持续节奏

| 时机 | 跑哪些 |
|---|---|
| 新增／搬动任何下载、导出入口，或改动 `ApiDownloadLink`／`downloadApiFile` 之后 | G1 先红灯 → 补登记表与探针步骤 → 重跑 R0／01–10 |
| 每次 `pretest`（自动） | G1（登记门禁） |
| 改动 Token 创建页、写入类接口的响应契约之后 | S01／S02 |
| 客户 amd64 出包前（软证据，人工执行；需 demo Docker＋Playwright，不进 PR CI） | `npm run uat:button-feedback`：01–10 无缺陷判定 |

## 出口（翻绿判据）

同一探针在同一类实例上：01–10 **无** `DOWNLOAD-FAILED`／`SILENT`／`FAKE-SUCCESS`／`EMPTY-FILE`／`ERROR-BODY-AS-FILE`／`BAD-NAME`／`NAVIGATED-AWAY`，S01／S02 为 `REAL`，G1 PASS。不得靠改探针、放宽判定或把入口移出登记表翻绿。

## 边界

- 本套件是**看守**：登记＋发现问题＋回归；**≠ 功能合同收口**，**≠ 可上线**。
- 全真：S01 真实签发 `uat-btn-probe-*` Token，结束前一定吊销（吊销失败＝整轮 FAIL）。Token 明文不进证据；下载文件只记大小与哈希前缀，不落盘内容。
- 密码只从凭据文件读入进程，不打印、不落盘、不入证据。
- 回环地址可用：下载判定不依赖安全上下文（与 P1-40 不同）。
