# P1-53 SC-01–SC-25 证据审计（X_REL）

| 元数据 | 内容 |
|---|---|
| 文档名称 | P1-53 SC 证据审计 |
| 文档类型 | Review |
| 版本 | v1.0 |
| 撰写日期 | 2026-11-22 |
| 撰写人 | Cursor Agent |
| 委托人 | xingchen |
| 基于材料 | [P1-53 Spec v1.1](../specs/lucy-20261118-mcp-upgrade-compatibility-spec.md) §7；[四入口跑次](../qa/uat/suites/mcp-upgrade-compatibility/runs/2026-11-22-cursor-p153-xrel-four-entry.md)；[candidate](../qa/uat/suites/mcp-upgrade-compatibility/runs/2026-11-22-cursor-p153-certify-candidate.md)；`scripts/e2e/__tests__/mcp-compatibility*.test.mjs` |
| 适用范围 | 发布取证 SC 逐条指针；**≠ 可上线** |
| 输出位置 | `docs/reviews/2026-11-22-p1-53-sc-evidence-audit.md` |

## 总判定

**SC-01–SC-25＝CLOSED**（demo 全真四入口＋契约／接线测）。本条通过 ≠ 各模块无问题 ≠ 可上线。

## 逐条

| ID | 结果 | 证据指针 |
|---|---|---|
| SC-01 | CLOSED | `mcp-upgrade-journeys-schema-smoke`／`mcp-upgrade-question-bank`；suiteDigest `sha256:9725b9a4…` |
| SC-02 | CLOSED | kimi-code-cli 全题库；报告未外推未测宿主；[candidate](../qa/uat/suites/mcp-upgrade-compatibility/runs/2026-11-22-cursor-p153-certify-candidate.md) |
| SC-03–SC-08 | CLOSED | 34／34 案 PASS（业务／追问／join／多库／ACL／ESC 同形） |
| SC-03b | CLOSED | COMPAT-OPS／QB-OPS-01–11 在分母；fingerprint 匹配 |
| SC-09 | CLOSED | capture→POST 同 client／model／suite／config 指纹；[四入口](../qa/uat/suites/mcp-upgrade-compatibility/runs/2026-11-22-cursor-p153-xrel-four-entry.md) |
| SC-10 | CLOSED | 判定器负控＋全真零 deny→allow／零 new deny |
| SC-11 | CLOSED | `batchWallClockMs`／samples 字段在 candidate／instance JSON |
| SC-12 | CLOSED | `mcp-compatibility.test.mjs` D11／D16a；全真 agentLatency PASS |
| SC-13 | CLOSED | 样本下限 mcp≥20／agent≥3；相对门禁单测 |
| SC-14 | CLOSED | 证据包 verifier 负控＋当前候选真实 Agent 全链路 |
| SC-15 | CLOSED | digest／指纹不匹配拒证单测；缺 Token→BLOCKED（洁净 env 下 `run-mcp-compatibility.test.mjs`） |
| SC-16 | CLOSED | `mcp-compatibility-evidence`／`wiring`：缺／FAIL／ci-subset → releaseReady=false |
| SC-17 | CLOSED | wiring：Compose／K8s hook；ROLLBACK_VERIFY 接线；health 不单独放行 |
| SC-18 | CLOSED | 私有基线 0600；公开 JSON 无 Bearer；基线在 inbox private |
| SC-19 | CLOSED | profile apply＋fingerprint；错包 BLOCKED 单测 |
| SC-20 | CLOSED | `lint:status-funnel`；e2e-ledger 勾连 |
| SC-21 | CLOSED | 入口互不冒充单测；ci-subset 不得 releaseReady |
| SC-22 | CLOSED | 三维聚合；DEGRADED 不得整体 PASS 负控 |
| SC-23 | CLOSED | capture 无历史文件可首次捕获；upgrade 分离且依赖 candidate PASS；全真四入口 |
| SC-24 | CLOSED | 双证据 schema＋verifier 重读重算单测；candidate／instance 文件齐 |
| SC-25 | CLOSED | 开跑前 fingerprint 匹配；apply／backup 目录见 inbox closure |

## 自动化摘要

- `mcp-compatibility`／`evidence`／`wiring`／`config-profile`／journeys／question-bank：**89 pass／0 fail**
- `run-mcp-compatibility.test.mjs`（洁净 env）：**21 pass／0 fail**
