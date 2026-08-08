# 分表 E2E-WEBUI：WebUI 真实浏览器 E2E

| 元数据 | 内容 |
|---|---|
| 文档名称 | 分表 E2E-WEBUI：WebUI 真实浏览器 E2E |
| 文档类型 | QA / E2E |
| 版本 | v1.0 |
| 撰写日期 | 2026-08-08 |
| 撰写人 | Cursor Agent |
| 适用范围 | 测试集 `E2E-WEBUI`：Lucy WebUI 真实浏览器回归 |
| 输出位置 | `docs/qa/suite-webui-browser.md` |
| 父指引 | [`e2e-sop.md`](e2e-sop.md) |

> **先读父指引** [`e2e-sop.md`](e2e-sop.md)。本分表是入口卡；**用例正文、分层矩阵、Fixture 约定**在活文档中维护，避免双份漂移。

## 1. 本分表证明什么

用户视角的点击 / 输入 / 跳转 / Toast / 术语 / `translate="no"` 结构扫描；覆盖数据接入 → 语义建模 → Wiki → 语义发布主链路。

## 2. 执行入口

| 项 | 路径 |
|---|---|
| 活文档（用例 + 原则） | [`lucy-webui-e2e-test-suite.md`](lucy-webui-e2e-test-suite.md) |
| Selector 契约 | [`selector-contract.md`](selector-contract.md) |
| 影响映射 | [`impact-map.json`](impact-map.json) |
| 变更日志 | [`changelog.md`](changelog.md) |

## 3. 通过标准（摘要）

- 断言落在 selector 契约表登记的 `data-testid` / aria 上。  
- Forbidden terms 0 命中；专业英文节点带翻译防御。  
- 写入只落 Fixture Project，不污染真实仓库 tracked 状态。  
- 准入分层与用例 ID 以活文档为准。

## 4. 与其它测试集边界

| 不要用本分表做 | 改用 |
|---|---|
| 新 domain 上传语义并对 gold | [`suite-semantic-onboard-mcp-eval.md`](suite-semantic-onboard-mcp-eval.md) |
| Agent 最终答案 + SOW 证据包 | [`suite-agent-mcp.md`](suite-agent-mcp.md) |
