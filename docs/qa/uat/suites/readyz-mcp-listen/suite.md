# UAT-SUITE-READYZ-MCP-LISTEN — readyz 与 MCP 监听就绪一致性

| 元数据 | 内容 |
|---|---|
| Suite ID | `UAT-SUITE-READYZ-MCP-LISTEN` |
| 总账 ID | **P1-46**／REQ-030-067（前方报告 **P0-03**） |
| 目标 | 看守「Web `/api/readyz` 已 200，但 MCP 端口尚未可 initialize」的启动空窗 |
| 合同回链 | [Spec](../../../../specs/lucy-20261118-readyz-mcp-listen-consistency-spec.md) SC-01–SC-06；前方报告 §3.3／§4.1 P0-03；证据 E23 |
| cases | [cases.md](cases.md) |
| fixtures | [fixtures.md](fixtures.md) |
| runs | [runs/](runs/) |

## 全真性

真实容器冷启动；真实 HTTP 打 `readyz`；真实 MCP `initialize`（直连映射端口，避免仅测反代）。**禁止**以「稍后重试成功」关单。

## 必做／可选

| 必做 | 可选 |
|---|---|
| UAT-RML-R0、UAT-RML-01、UAT-RML-02、UAT-RML-03 | UAT-RML-04（经 HTTPS 测试反代，对照前方 502 形态） |

## 持续节奏

| 时机 | 跑哪些 |
|---|---|
| 改前基线 | R0、01–03；允许记录「偶发首次失败」为 FAIL |
| 含本修复候选 | 至少 3 次独立冷启动全部必做 PASS |
| 改动 `markWebuiWarmupComplete`／`proxy.listen` 顺序 | 全套 |

## 边界

- 只覆盖**启动窗口**；不证明客户稳态 502／503。
- 样本不证明「每次历史提交都必现」；关单看修复后连续冷启动。
- INDEX：**NOT RUN**。
