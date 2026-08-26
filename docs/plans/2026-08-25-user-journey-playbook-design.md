# Lucy 用户旅程剧本设计

| 元数据 | 内容 |
|---|---|
| 文档名称 | Lucy 用户旅程剧本设计 |
| 文档类型 | Design |
| 版本 | v1.0 |
| 撰写日期 | 2026-08-25 |
| 撰写人 | Cursor Grok 4.6 |
| 委托人 | xingchen |
| 基于材料 | 2026-08-25 对话约定；`docs/qa/e2e-sop.md`；`docs/qa/lucy-webui-e2e-test-suite.md`；`webui/docs/00-product-terminology-standard.md`；`webui/src/app/navigation.ts` 现行路由与文案 |
| 适用范围 | 起草并维护测试集 `E2E-USER-JOURNEY`；供后续由 Agent 按剧本做浏览器 / MCP 自动化 |
| 输出位置 | `docs/plans/2026-08-25-user-journey-playbook-design.md`；分表 `docs/qa/suite-user-journey.md` |

## Terminology Compliance

This feature follows `webui/docs/00-product-terminology-standard.md`.

New terms:

| 概念 | UI 主术语 | 英文辅助 | 禁止文案 |
|---|---|---|---|
| 用户旅程剧本 | 用户旅程剧本 | user-journey playbook | 把本分表写成 Playwright spec 或 eval YAML 的替代品 |
| 失败即停 | 失败即停 | fail-stop | 跳过失败步骤继续点 |
| blocked | blocked | blocked | 把环境起不来当成 Pass |

## 1. 目的

为 Lucy 四类真实用户操作（数据工程师 / 分析师 / 管理员 / 客户部署）建立**逐步、可观察、可交给 Agent 执行**的剧本。不替代 Playwright selector 回归、eval 口径评测、Docker smoke。

## 2. 落位与编号

- 分表：`docs/qa/suite-user-journey.md`
- 测试集 ID：`E2E-USER-JOURNEY`（登记于 `docs/qa/e2e-sop.md`）
- 用例 ID：`UJ-<角色>-<序号>`
  - `ENG` WebUI 数据工程师
  - `ANA` Cursor / Lucy MCP 分析师
  - `ADM` WebUI 访问治理管理员
  - `ONB` 系统概览 + MCP 配置（客户部署）

## 3. 第一批 P0（20 条）

数据工程师 7：`ENG-01` 主闭环；`ENG-02` 连接巡检与刷新本地目录；`ENG-03` 添加 Schema；`ENG-04` 上传 Manifest（含覆盖确认）；`ENG-05` 启用表范围；`ENG-06` 维护语义并保存校验；`ENG-07` Wiki 阅读/编辑/保存预检/`sl_ref` 跳转。

分析师 5：`ANA-01` 简单事实；`ANA-02` 维度对比；`ANA-03` Wiki 后查数；`ANA-04` 空结果/失败不得编造；`ANA-05` 追问口径不漂移。

管理员 5：`ADM-01` 建 Agent + Token；`ADM-02` 角色有效权限；`ADM-03` 访问日志；`ADM-04` MCP 调试台；`ADM-05` 撤销 Token / 停用 Agent。

客户部署 3：`ONB-01` 系统概览健康；`ONB-02` 复制 MCP 配置并验 Visible Scope；`ONB-03` 连接卡片连通测试。

质量评测模块、Join 候选、术语扫描、窄屏、越权路径不进本批 P0。

## 4. 环境

| 旅程 | 默认环境 | 写入 |
|---|---|---|
| ENG / ADM | `WEBUI_BASE`（Docker 常 `:55176`，本机 `ktx up` 以实际为准）；`LUCY_PROJECT_DIR` 指向 fixture | 只写 fixture |
| ANA | 已鉴权 Lucy MCP；先 `lucy_catalog` | 只读 |
| ONB | 与 ANA 同实例的 WebUI + MCP | 可复制配置；不改 `customer-config` |

WebUI 与 MCP 禁止跨实例混用。密钥不进剧本与证据。

## 5. 失败即停与证据

- 「必须看见」不满足 → 整条 FAIL，不跳步。
- 环境 / token / Visible Scope 不对 → **blocked**，不当 Pass。
- ANA 查询失败：允许按剧本重试一次；仍失败则结论不可用，禁止用 Wiki 或记忆补数字。
- 证据落 `inbox/uj-<id>-<YYYYMMDD>/`。Token 只记已签发/已撤销与后四位。

## 6. 单步格式

每步四行：操作 / 定位 / 必须看见 / 失败即停。一步一次用户意图。WebUI 用界面中文文案，并括注现行 `data-testid`。MCP 用合格 source key。不写 sleep、不写主观体验。

## 7. 与现有测试分工

| 已有 | 继续负责 |
|---|---|
| Playwright `E2E-*` | selector、术语、翻译防御、越权 |
| eval YAML | 口径 / gold 数字 |
| Docker smoke | 进程健康与基线 SQL |

剧本交叉引用上述 ID。界面文案以 `webui/src` + 术语标准为准；若与旧 Playwright 注释不一致，以现行 UI 为准并在剧本里注明。
