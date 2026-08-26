# docs/qa — QA / E2E 文档地图

| 元数据 | 内容 |
|---|---|
| 文档名称 | docs/qa 文档地图 |
| 文档类型 | Other |
| 版本 | v1.3 |
| 撰写日期 | 2026-08-08；v1.3 2026-08-25 |
| 撰写人 | Cursor Agent |

## 结构

```text
docs/qa/
  e2e-sop.md                         ← E2E SOP 总指引（先读）
  suite-webui-browser.md             ← 分表 E2E-WEBUI
  suite-semantic-onboard-mcp-eval.md ← 分表 E2E-ONBOARD-EVAL（含 KSC / Spider2 §14）
  suite-agent-mcp.md                 ← 分表 E2E-AGENT（含 Spider2 §5 可选）
  suite-user-journey.md              ← 分表 E2E-USER-JOURNEY（用户逐步操作剧本）
  lucy-webui-e2e-test-suite.md       ← WebUI 用例活文档（被分表引用）
  selector-contract.md / impact-map.json / changelog.md
```

分层与 `npm` 门禁总表：[`docs/test-layers-and-release-gates.md`](../test-layers-and-release-gates.md)。

| 文档 | 角色 |
|---|---|
| [`e2e-sop.md`](e2e-sop.md) | **总指引**：测试集总表、选用决策、共同约定 |
| [`suite-webui-browser.md`](suite-webui-browser.md) | 分表 `E2E-WEBUI` |
| [`suite-semantic-onboard-mcp-eval.md`](suite-semantic-onboard-mcp-eval.md) | 分表 `E2E-ONBOARD-EVAL`（主题实例含 Spider2 Pilot §14） |
| [`suite-agent-mcp.md`](suite-agent-mcp.md) | 分表 `E2E-AGENT`（Spider2 Agent 抽样见 §5） |
| [`suite-user-journey.md`](suite-user-journey.md) | 分表 `E2E-USER-JOURNEY`（用户逐步操作剧本；Agent 可执行） |
| [`lucy-webui-e2e-test-suite.md`](lucy-webui-e2e-test-suite.md) | WebUI 用例正文（活文档） |
| [`selector-contract.md`](selector-contract.md) | Selector 契约 |
| [`changelog.md`](changelog.md) | 变更日志 |
| [`impact-map.json`](impact-map.json) | 影响映射 |

**不**为 Spider2 新建第四个 `E2E-*` 测试集：装载/MCP/gold → ONBOARD；Agent 抽样 → AGENT。

## 选用

见 [`e2e-sop.md`](e2e-sop.md) §2–§3。
