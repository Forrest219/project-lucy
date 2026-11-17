# UAT-SUITE-COPY-FAKE-SUCCESS — 复制按钮假成功看守

| 元数据 | 内容 |
|---|---|
| Suite ID | `UAT-SUITE-COPY-FAKE-SUCCESS` |
| 总账 ID | **P1-40**／REQ-030-061 |
| 目标 | 看守 2026-11-17 错题：明文 HTTP（非安全上下文）下，界面提示「已复制」但系统剪贴板并未写入（假成功）。覆盖所有复制入口，并让「新增复制按钮不登记就进不了仓库」 |
| 合同回链 | 错题 [2026-11-17-clipboard-http-fake-success](../../../../lessons/2026-11-17-clipboard-http-fake-success.md)；Spec 192（[剪贴板非安全上下文降级](../../../../../webui/docs/192-clipboard-non-secure-context-fallback-spec.md)，AC-04／AC-05「禁止谎报成功」）；旅程判定 [suite-user-journey §2.6／2.7](../../../suite-user-journey.md)；勾连 [e2e-ledger](../../../../governance/e2e-ledger.md) |
| cases | [cases.md](cases.md) |
| fixtures | [fixtures.md](fixtures.md) |
| runs | [runs/](runs/) |
| 自动化 | 探针 `npm run uat:copy-probe`（= `scripts/uat/copy-button-fake-success-probe.mjs`）；登记门禁 `npm --prefix webui run lint:copy-surfaces`（接入 `pretest`）；登记表 `webui/scripts/copy-surfaces.manifest.json` |

## 必做／可选

| 必做 | 可选 |
|---|---|
| UAT-COPY-R0、UAT-COPY-01、UAT-COPY-02（子用例 02a–02j）、UAT-COPY-03 | UAT-COPY-04（公网演示实例只读复核；需公网凭据） |

## 判定口径（只认剪贴板读回）

探针在**非回环、明文 HTTP** 的真实 Chromium 里点击入口，同时：

1. 读界面反馈（Toast、按钮文案、状态文案里**新出现**的「已复制／复制失败」）；
2. 先写入哨兵串，点击后用真实 `Ctrl/Cmd+V` 粘贴读回，看剪贴板是否变成目标文本；
3. 拦截 `document.execCommand` 记录调用返回值与调用瞬间的选区内容（证据，不改行为）。

| 单入口判定 | 含义 | 套件影响 |
|---|---|---|
| `REAL` | 说「已复制」且读回等于目标文本 | 通过 |
| `REAL-NO-FEEDBACK` | 读回正确但界面没有任何反馈 | PASS WITH GAP（体验缺口） |
| `FAKE-SUCCESS` | 说「已复制」但读回不是目标文本 | **FAIL** |
| `SILENT` | 没有任何反馈且读回不对 | **FAIL** |
| `HONEST-FAILURE` | 明确提示失败且读回不对：不欺骗，但 Spec 192 AC-02 要求此形态下应复制成功 | **FAIL**（功能缺口，非欺骗） |
| `NOT-RUN` | 入口当前实例不可达或按钮禁用 | 须写原因；登记为 `click` 的入口 NOT-RUN 记 PASS WITH GAP |

## 为什么必须读回、不能 stub

`document.execCommand("copy")` 在**选区为空**时仍可能返回 `true`。把它 stub 成固定布尔值（现行单测与 `clipboard-fallback.spec.ts` 的做法）只能证明代码「走到了降级分支」，证明不了文字真的进了剪贴板。本套件的任何 PASS 都必须来自真实粘贴读回。

## 持续节奏

| 时机 | 跑哪些 |
|---|---|
| 改动 `webui/src/lib/clipboard.ts`、任何复制入口、或升级 Chromium／Playwright 之后 | R0／01／02 |
| 每次 `pretest`（自动） | 03（登记门禁） |
| 新增／搬动复制入口 | 03 先红灯 → 补登记表与 02 的探针步骤 → 重跑 02 |
| 客户 amd64 出包前（软证据，人工执行；需 demo Docker＋Playwright，不进 PR CI） | `npm run uat:copy-probe`：R0／01／02 在一个非回环 HTTP 实例上全 REAL |
| 公网演示实例升级后 | 可选 04 |

## 出口（翻绿判据）

产品修复（不在本条登记范围内，须另获授权）后，同一探针在同一类实例上 **01 三个载荷全部 `REAL`、02 全部可点入口 `REAL`**，套件才可由 FAIL 翻 PASS。不得靠改探针、放宽判定或把入口移出登记表翻绿。

## 边界

- 本套件是**看守**：登记＋发现问题；**≠ 修复授权**，**≠ 功能合同收口**，**≠ 可上线**。
- **回环地址（`127.0.0.1`／`localhost`）是安全上下文，Clipboard API 恒可用，没有判定力**；探针发现 `isSecureContext=true` 一律 BLOCKED。
- **全真，无替身**：新建 Token 真实签发 `uat-copy-probe-*`、用它走真实 MCP 查询产生审计行、结束前一定吊销（吊销失败＝整轮 FAIL）；连接测试是 `ktx connection test` 的只读真跑。Token 明文只在内存里使用，证据里脱敏。
- 密码只从凭据文件读入进程，不打印、不落盘、不入证据。
- 静态门禁只证明「入口都登记了」，**不证明复制可用**；可用性只认 02。
