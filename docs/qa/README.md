# docs/qa — QA / E2E 文档地图

| 元数据 | 内容 |
|---|---|
| 文档名称 | docs/qa 文档地图 |
| 文档类型 | Other |
| 版本 | v1.4 |
| 撰写日期 | 2026-08-08；v1.4 2026-10-18 |
| 撰写人 | Cursor Agent |

## 结构

```text
docs/qa/
  e2e-sop.md                         ← E2E SOP 总指引（先读）
  suite-webui-browser.md             ← 分表 E2E-WEBUI
  suite-semantic-onboard-mcp-eval.md ← 分表 E2E-ONBOARD-EVAL（含 KSC / Spider2 §14）
  suite-agent-mcp.md                 ← 分表 E2E-AGENT（含 Spider2 §5 可选）
  suite-user-journey.md              ← 分表 E2E-USER-JOURNEY（用户逐步操作剧本）
  e2e-release-checklist.md           ← 客户发布证据行（二元，挂冻结目录）
  business-eval-checklist.md         ← 业务能力行（阻塞线 / 良好线）
  checklists/                        ← 上面两份清单的行定义 YAML
  lucy-webui-e2e-test-suite.md       ← WebUI 用例活文档（被分表引用）
  selector-contract.md / impact-map.json / changelog.md
```

分层与 `npm` 门禁总表：[`docs/governance/test-layers-and-release-gates.md`](../governance/test-layers-and-release-gates.md)。

| 文档 | 角色 |
|---|---|
| [`audit-trust-and-admin-investigation-acceptance.md`](audit-trust-and-admin-investigation-acceptance.md) | **未执行**：审计可信度与管理员调查 EA-01–36，Claude 举证、Codex 独立评审；不替代已有客户发布门禁 |
| [`e2e-sop.md`](e2e-sop.md) | **总指引**：测试集总表、选用决策、共同约定 |
| [`smoke-test-design-upgrade-spec.md`](smoke-test-design-upgrade-spec.md) | **Fast / Full Smoke 自动化测试任务设计升级规范** |
| [`suite-webui-browser.md`](suite-webui-browser.md) | 分表 `E2E-WEBUI` |
| [`suite-semantic-onboard-mcp-eval.md`](suite-semantic-onboard-mcp-eval.md) | 分表 `E2E-ONBOARD-EVAL`（主题实例含 Spider2 Pilot §14） |
| [`suite-agent-mcp.md`](suite-agent-mcp.md) | 分表 `E2E-AGENT`（Spider2 Agent 抽样见 §5） |
| [`suite-user-journey.md`](suite-user-journey.md) | 分表 `E2E-USER-JOURNEY`（用户逐步操作剧本；Agent 可执行） |
| [`e2e-release-checklist.md`](e2e-release-checklist.md) | 客户发布证据行：冻结场景收成 10 行，只回答证据齐不齐 |
| [`business-eval-checklist.md`](business-eval-checklist.md) | 业务能力行：阻塞线与良好线，挂已有 eval case 与 UX 变体 |
| [`lucy-webui-e2e-test-suite.md`](lucy-webui-e2e-test-suite.md) | WebUI 用例正文（活文档） |
| [`selector-contract.md`](selector-contract.md) | Selector 契约 |
| [`changelog.md`](changelog.md) | 变更日志 |
| [`impact-map.json`](impact-map.json) | 影响映射 |

**不**为 Spider2 新建第四个 `E2E-*` 测试集：装载/MCP/gold → ONBOARD；Agent 抽样 → AGENT。

## 升级功能专项

[升级功能 Checklist](upgrade-feature-checklist.md) 将 14 条客户升级说明映射到可执行桌面浏览器、HTTP/MCP 与支线测试。`npm run e2e:upgrade -- --ktx-bin /absolute/path/to/ktx` 创建隔离实例；结果保留环境边界，不替代客户发布门禁。

## 选用

见 [`e2e-sop.md`](e2e-sop.md) §2–§3。
