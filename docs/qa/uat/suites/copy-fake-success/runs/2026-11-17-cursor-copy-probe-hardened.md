# Run — 2026-11-17 — cursor-copy-probe-hardened

| 元数据 | 内容 |
|---|---|
| Suite | `UAT-SUITE-COPY-FAKE-SUCCESS` |
| Agent | Cursor |
| 环境 | 本机 demo，**局域网 IP** `http://192.168.3.46:55176`（明文 HTTP，非安全上下文）；MCP `http://192.168.3.46:57881/mcp`；容器 `compose-lucy-1` healthy；构建 `79db4352bf25`（含修复的工作树，已提交为 `65f40847` 的内容）；Playwright Chromium headless |
| 开始／结束 | 2026-11-17 ≈21:59 CST（探针约 18 秒） |
| 总判定 | **PASS WITH GAP**（必做 R0／01／02a–02j／03 全绿；缺口见下） |
| 前序 | [首跑 FAIL](2026-11-17-cursor-copy-probe-first.md)（改前基线）；[修复后 PASS WITH GAP](2026-11-17-cursor-copy-probe-after-fix.md)（旧探针，含打桩 Token） |
| 原始证据 | [evidence/2026-11-17-cursor-copy-probe-hardened-probe-result.md](evidence/2026-11-17-cursor-copy-probe-hardened-probe-result.md)（探针 `probe-result.md` 原样，Token 明文已脱敏） |
| 本跑次相对前序的变化 | 去掉 Token 打桩（真实签发＋吊销）；真实 MCP 查询造审计数据；入口编子用例；探针辅助元素挂进模态框内；原始证据进 `runs/` |

| Case ID | 结果 | 证据摘要 |
|---|---|---|
| UAT-COPY-R0 | **PASS** | `isSecureContext=false`；无 `navigator.clipboard`；阳性对照往返＝true |
| UAT-COPY-01 | **PASS** | helper 三个载荷读回＝载荷，**REAL 3/3** |
| UAT-COPY-02a | **PASS** | 版本信息：复制构建提交 — REAL |
| UAT-COPY-02b | **PASS** | 新建 Token：复制 Token 明文 — REAL（读回等于**真实签发**的明文，不再是打桩串） |
| UAT-COPY-02c | **PASS** | 新建 Token：复制当前配置 — REAL（含 `Bearer <真实 Token>`） |
| UAT-COPY-02d | **PASS** | Agent 详情：复制 Token hash — REAL |
| UAT-COPY-02e | **PASS** | 审计对账：复制表排行全文 — REAL（**上一跑为按钮禁用 NOT-RUN；种子查询后按钮可用**） |
| UAT-COPY-02f | **PASS** | 概览：复制 MCP 配置 — REAL |
| UAT-COPY-02g | **PASS** | 连接测试：复制命令 — REAL |
| UAT-COPY-02h | **PASS** | 连接测试：复制 Log — REAL |
| UAT-COPY-02i | **PASS** | 审计：复制问询 ID — REAL（**新增点击**；读回为纯数字问询号） |
| UAT-COPY-02j | **PASS** | 审计：复制触达表清单 — REAL（**新增点击；该按钮在 `role="dialog"` 抽屉内，同时实证对话框内复制路径**） |
| UAT-COPY-03 | **PASS** | `lint:copy-surfaces` 13 个文件／15 个调用点；R4（子用例编号唯一且写入 `cases.md`）通过；`lint-copy-surfaces.test.ts` 18 条通过 |
| UAT-COPY-04 | **NOT-RUN** | 可选；公网演示实例尚未升级到含修复的构建 |

## 真实数据与清理

- 真实签发探针 Token `uat-copy-probe-<时间戳>`（Agent `demo_agent`，30d），跑完**已吊销（HTTP 200）**。跑后核对 `/api/admin/agents`：`demo_agent`＝`p0-demo`、`xx`，`demo_ops`＝`demo-ops`，无 `uat-copy-probe-*` 残留。
- 用该 Token 走真实 MCP：握手＋`lucy_query`（`demo-mysql`／`superstore_orders.order_count`），HTTP 200、`isError=false`，审计页因此出现问询行。审计库里留下少量真实查询痕迹，不删。
- Token 明文只在内存里使用，证据里替换为 `<REAL_TOKEN_REDACTED>`。

## 与上一跑次相比，关掉的缺口

| 上次缺口 | 本次 |
|---|---|
| 新建 Token 打桩（违反「全真」原则第 3 条） | **关闭**：真实签发并吊销，吊销失败＝整轮 FAIL |
| 审计对账入口按钮禁用，NOT-RUN | **关闭**：02e REAL |
| 审计 ID／触达表清单未点 | **关闭**：02i／02j REAL |
| 对话框内复制路径无探针独立实证 | **关闭**：02j 在抽屉（`role="dialog"`）内 REAL |
| 02 颗粒度粗、无稳定子编号 | **关闭**：02a–02j，登记表＋门禁（R4）强制 |
| 原始证据只在临时目录 | **关闭**：原样留档到 `runs/evidence/` |

## 同类排查补记（调用方层，静态）

6 个 helper-only 入口不是「没检查」：它们没被浏览器点到，但已**逐个读过调用方**，确认都只在 `result.ok` 为真时才提示成功（行策略表身份、启用表路径经 `copyTextWithToast`；连接概览路径、接入向导第 6 步、撰写说明、信任列用户 ID 都显式判 `result.ok`）。全部 15 个调用点读完后，另有一处同类缺陷：`Onboarding.tsx` 的 `writeMcpConfigToClipboard` 把返回值对象当布尔用（`!copiedOk` 恒为假），复制失败仍提示「MCP 配置已复制」。点击探针在 helper 成功时看不出，所以 02f 一直是 REAL；已修（先红后绿）并加静态门禁 R5。全仓库未发现第二套复制实现。

## 仍存缺口（所以仍是 PASS WITH GAP）

1. **6 个 helper-only 入口**未逐个点击：行策略表身份（需已配置行策略的表行）、连接概览路径（需缺失 Manifest 警告）、启用表 Manifest 路径（需空态提示）、接入向导第 6 步与撰写说明（已完成接入的实例向导步骤不可达）、信任列用户 ID（该控件无成功态，仅失败时提示）。均由 UAT-COPY-01 的共享 helper 真读回承载。要点到它们需要改动 demo 的行策略／接入状态，超出本套件的无副作用边界，需另行授权。
2. **公网演示实例**未升级，UAT-COPY-04 未跑。
3. `webui/tests/e2e/specs/clipboard-fallback.spec.ts` 仍打桩且跑回环；判定力由本套件承担，该 e2e 不作为 UAT 证据。

## 备注

- 是否使用 `docker restart`：否；本跑次没有改容器。
- 未触碰 ACL／角色／连接配置；写入的只有一个已吊销的探针 Token 与若干审计问询行。
- **≠ 可上线**。
