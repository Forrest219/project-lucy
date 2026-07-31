# project-lucy Agent 开发入口

本仓库的开发治理规则见 [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md)。
数据问答运行时指导走 Lucy MCP Proxy 的 `initialize` instructions 注入（内容来源 [`webui/config/data-qa-instructions.md`](webui/config/data-qa-instructions.md)，机制见 [`webui/docs/07-mcp-auth-proxy-spec.md`](webui/docs/07-mcp-auth-proxy-spec.md) §4.4），不再由 [`CLAUDE.md`](CLAUDE.md) 承载——`CLAUDE.md` 现在只做指引，不得再写入数据问答规则正文；如发现回归，请改回纯引用。

Vibe coding 双核角色协作（thinker / builder）的角色库见 [`agents/README.md`](agents/README.md)，按需调用，非必经流程。

## 全系统术语规范

所有 WebUI、API 用户可见错误、Toast、Modal、Drawer、测试断言、Spec、Plan、Runbook 的术语必须遵守
[`webui/docs/00-product-terminology-standard.md`](webui/docs/00-product-terminology-standard.md)。

新模块新增产品概念时，必须先补充术语标准或在功能 Spec 的 `Terminology Compliance`
小节登记，再写 UI 文案、API 用户可见错误或测试断言。专业英文术语、数据库对象名、
文件名、路径和 URL 的 DOM 节点必须按标准添加浏览器翻译防御。

## 临时文件落位

默认临时文件、一次性审计输出、过程性报告落在仓库根目录 [`inbox/`](inbox/)。
`inbox/` 定位为 tmp 文件夹，进程结束后可随时删除。

项目本身的正式 spec、代码、配置、运行时上下文不属于此约定；这些文件仍按
[`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md) 的落位规则维护。
