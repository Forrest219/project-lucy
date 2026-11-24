# Run — 2026-11-17 — cursor-copy-probe-after-fix

| 元数据 | 内容 |
|---|---|
| Suite | `UAT-SUITE-COPY-FAKE-SUCCESS` |
| Agent | Cursor |
| 环境 | 本机 demo，**局域网 IP** `http://192.168.3.46:55176`（明文 HTTP，非安全上下文）；容器 `compose-lucy-1` healthy；构建 `79db4352bf25`（`gitDirty=true`，含 `clipboard.ts` 修复的工作树）；Playwright Chromium headless；经 `npm run demo:upgrade` 平滑升级（volume 保留） |
| 开始／结束 | 2026-11-17 ≈21:38 CST（探针约 14 秒） |
| 总判定 | **PASS WITH GAP**（必做 R0／01／02／03 全绿；缺口见下） |
| 前序 | [首跑 FAIL](2026-11-17-cursor-copy-probe-first.md)（改前基线，同一探针、同一环境） |
| 证据 | `inbox/uat-copy-fake-success-2026-11-17-fixed/probe-result.{json,md}`（临时目录，可删） |

| Case ID | 结果 | 证据摘要 |
|---|---|---|
| UAT-COPY-R0 | **PASS** | `isSecureContext=false`；无 `navigator.clipboard`；阳性对照往返＝true |
| UAT-COPY-01 | **PASS** | 三个载荷（`ascii-40hex`／`cjk-multiline`／`long-3k`）：`execCommand` 调用瞬间选区＝载荷，粘贴读回＝载荷＝**REAL 3/3**（改前 FAKE-SUCCESS 3/3，选区为空串） |
| UAT-COPY-02 | **PASS** | 7 个可点入口全部 **REAL**（界面提示已复制，剪贴板读回正确）；1 个 NOT-RUN（审计对账，按钮禁用） |
| UAT-COPY-03 | **PASS** | `lint:copy-surfaces` 13 个文件／15 个调用点一致；`lint-copy-surfaces.test.ts` 14 条通过 |
| UAT-COPY-04 | **NOT-RUN** | 可选；公网演示实例尚未升级到含修复的构建，没有复核对象 |

## 改前／改后对照（UAT-COPY-02）

| 入口 | 改前（首跑） | 改后 |
|---|---|---|
| 版本信息：复制构建提交 | FAKE-SUCCESS | **REAL** |
| 新建 Token：复制 Token 明文 | FAKE-SUCCESS | **REAL** |
| 新建 Token：复制当前配置 | FAKE-SUCCESS | **REAL** |
| Agent 详情：复制 Token hash | FAKE-SUCCESS | **REAL** |
| 审计对账：复制表排行全文 | NOT-RUN（按钮禁用） | NOT-RUN（按钮禁用） |
| 概览：复制 MCP 配置 | FAKE-SUCCESS | **REAL** |
| 连接测试：复制命令 | FAKE-SUCCESS | **REAL** |
| 连接测试：复制 Log | FAKE-SUCCESS | **REAL** |

## 缺口（所以是 PASS WITH GAP，不是 PASS）

1. **审计对账复制**：demo 无审计数据，按钮禁用，未被点击验证。
2. **8 个 helper-only 入口**（审计 ID／触达表、行策略表身份、连接概览路径、启用表路径、接入向导第 6 步、撰写说明、信任列用户 ID）：demo 数据不可达，未逐个点击；其可信度由 01 承载（共用同一 helper，01 已 REAL）。
3. **公网演示实例**未复核（UAT-COPY-04）；修复尚未提交合入、未随任何发布构建出包。
4. **对话框内复制**：helper 对「在 Radix 对话框／抽屉内触发」做了挂载位置处理并有单测，但探针所点的入口里没有明确落在对话框内的，真实浏览器下该路径未被探针独立证实。

## 备注

- 修复前后用**同一探针、同一环境**对照；探针本身未因修复改动。
- 是否使用 `docker restart`：否；平滑升级保留 volume（ACL／账号／审计未动）。
- 未写入真实 Token（新建 Token 签发请求在浏览器里打桩）；凭据未打印。
- **≠ 可上线**；**≠** 修复已合入主线（工作树未提交）。
