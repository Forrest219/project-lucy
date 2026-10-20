# E2E 发布证据清单

| 元数据 | 内容 |
|---|---|
| 文档名称 | E2E 发布证据清单 |
| 文档类型 | Checklist |
| 版本 | v1.0 |
| 撰写日期 | 2026-10-18 |
| 撰写人 | Cursor Agent |
| 委托人 | xingchen |
| 基于材料 | [`scripts/e2e/contracts/case-catalog.yaml`](../../scripts/e2e/contracts/case-catalog.yaml)；[`manual-gui-e2e-checklist.md`](manual-gui-e2e-checklist.md)；[`e2e-sop.md`](e2e-sop.md) §7 |
| 适用范围 | 客户候选版本的证据是否齐。能力好坏读 [`business-eval-checklist.md`](business-eval-checklist.md) |
| 输出位置 | `docs/qa/e2e-release-checklist.md` |
| 行定义 | [`checklists/e2e-release-rows.yaml`](checklists/e2e-release-rows.yaml) |

## Terminology Compliance

本清单遵守 [`webui/docs/00-product-terminology-standard.md`](../../webui/docs/00-product-terminology-standard.md)。下列说法只用于 QA 文档，不进入 WebUI、API 错误或测试里的用户可见文案。

| 概念 | 使用范围 | 含义 |
|---|---|---|
| 证据行 | 本清单 | 一组冻结场景的证据是否到齐 |
| 能力行 | Business Eval 清单 | 一项业务能力绿到哪一档 |
| 阻塞线 / 良好线 | Business Eval 清单 | 能力行的两档门槛；本清单不使用 |

## 1. 这张表回答什么

客户发布仍由 `npm run gate:customer-release` 签发。本清单把冻结目录里的 32 个场景收成 10 行，用来读「证据齐不齐」。

变体分母留在 [`scripts/e2e/contracts/case-catalog.yaml`](../../scripts/e2e/contracts/case-catalog.yaml) 与 `case-catalog.lock.json`。本清单不把变体抄成一行一条，也不在本文里记录某次运行的 passed / failed。一次运行的颜色写到该 run 的 `checklist-projection.json`：

```bash
npm run e2e:real:project-checklists -- --run inbox/e2e/<runId>/run.json
```

能力行若要带上 eval 结果，加上 `--eval <evidence.json>`。证据文件里的 `cases` 使用 `pass` / `fail` 或 `passed` / `failed`。投影不修改本文件，也不改 `gate:customer-release`。没有结果文件的变体在投影里是 blocked。

浏览器 contract 回归（`e2e:contract:release`）留在夹具实例上，不进入本清单。

## 2. 着色

一行只有 passed、failed、blocked 三态，没有良好档。

- 组内每一个 required 变体都 passed，该行才是 passed。
- 组内任一 required 变体 failed，该行是 failed。
- 组内任一 required 变体 blocked 或尚未运行，该行是 blocked。
- `E2E-GUI` 的分母是两份人工清单都交齐，且 M-01～M-05 每步 passed。缺文件是 blocked。

安全、吊销、审计、门禁反向测试保持二元。生产坏案例先成为 catalog 变体并更新 lock，再决定它落入哪一行。本清单本身不增加分母。

## 3. 证据行

| 行 | 证明什么 | 挂接的场景 |
|---|---|---|
| `E2E-AUTH` | 认证、引导、职责、会话回收与限速 | SEC-01～SEC-05 |
| `E2E-TOKEN` | Token 一次性展示、吊销、错误身份、会话归属 | SEC-06～SEC-08、SEC-21 |
| `E2E-ACL` | 授权对象、Role Set、真行集、绕过输入、策略失效 | SEC-09～SEC-13 |
| `E2E-CONTEXT` | 上下文隔离、文件供应链、间接注入、泄漏扫描 | SEC-14～SEC-17 |
| `E2E-AUDIT` | 可问责审计、审计故障、导出与保留 | SEC-18～SEC-20 |
| `E2E-DELIVERY` | 客户网络、依赖与镜像、amd64 K8s 新装升级恢复 | SEC-22、SEC-23、OPS-01 |
| `E2E-JOURNEY` | 管理到使用、离线 Eval、现场提问与安全候选 | UX-01、UX-06、UX-07 |
| `E2E-AGENT-EVIDENCE` | 真实 Agent 的查询、追踪与重复执行证据是否齐 | UX-02～UX-05 |
| `E2E-GATE` | blocked、skip、dry-run、伪 Trace、旧证据与被改分母不得 READY | GATE-01 |
| `E2E-GUI` | WorkBuddy 与 Cursor Agent GUI 的人工步骤 | M-01～M-05，见 [`manual-gui-e2e-checklist.md`](manual-gui-e2e-checklist.md) |

`E2E-AGENT-EVIDENCE` 只回答证据在不在。金额、口径、拒答和多轮是否达到能力门槛，读 Business Eval 清单里挂到同一变体的能力行。

## 4. 人工 GUI

`E2E-GUI` 的产品是 `real-e2e-clients.yaml` 里 `execution: manual` 的 `workbuddy` 与 `cursor`。步骤与通过标准以人工清单为准：导入本 run 的 MCP、finance 问数对上 gold、越权问句被拒绝、吊销后全通道拒绝、一次提问一条问询。自动化 runner 不驱动这些步骤。
