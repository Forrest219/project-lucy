# P1-54 严口径复跑（选项 2 后）— 2026-11-22

| 元数据 | 内容 |
|---|---|
| 文档名称 | UAT-SUITE-MCP-UPGRADE-COMPATIBILITY P1-54 S5 strict rerun |
| 文档类型 | Test Report |
| 版本 | v1.0 |
| 撰写日期 | 2026-11-22 |
| 撰写人 | Cursor |
| 委托人 | xingchen |
| 基于材料 | Plan `lucy-20261122-p154-s5-strict-no-new-deny-multi-agent-plan.md`；委托人选项 2；`inbox/p154-s5-strict-20261122/rerun/results/mcp-compatibility-candidate.json` |
| 适用范围 | 严口径硬门禁取证；**≠ INDEX PASS**；≠ 可上线 |
| 输出位置 | docs/qa/uat/suites/mcp-upgrade-compatibility/runs/2026-11-22-cursor-p154-s5-strict-rerun.md |

## 环境

- WebUI：`http://127.0.0.1:55176`；MCP：`http://127.0.0.1:57881/mcp`
- CompatConfigProfile：`sha256:957326482275fcc47a6c81e0462fa9085103af6b30fcaad5612297a80e733053`
- suiteDigest：`sha256:9725b9a4b1e69800e8c92f485cb193b91696ac13d8867bdda2af325c751578fc`
- Agent：`kimi-code-cli`；`--agent-concurrency 3`；`--budget-escape`
- 03b：委托人选项 2（scoped 行隔离成交／跟 P1-72）
- JOIN-01／ACL-03a：控制面 measure／join 形状修正（v2）后复跑

## 总判定

**candidate status＝PASS**（三维均 PASS）

| 轴 | 判定 |
|---|---|
| functionalCompatibility | PASS |
| serviceLatency | PASS |
| agentLatency | PASS |

## 严口径硬门禁

| 门禁 | 结果 |
|---|---|
| 零 `new deny` | **PASS** |
| 零 `expected denial becoming allow` | **PASS** |
| 34／34 案级 status PASS | **PASS** |

日志附注 `isError observed in MCP attempts`＝预期 deny 身份的 tools/call 错误信封，**不**构成 new-deny。

## INDEX

**不回写 PASS**（Plan D6）。本跑次供 P1-54 S5 功能合同收口证据；共享套件 INDEX 仍可由发布轨另决。
