# Eval YAML Exchange And Optional Result Archive Spec

| 元数据 | 内容 |
|---|---|
| 文档名称 | Eval YAML Exchange And Optional Result Archive Spec |
| 文档类型 | Product / UX / API / Data Contract Spec |
| 版本 | v0.1 |
| 撰写日期 | 2026-08-01 |
| 关联页面 | `/eval/cases`、`/eval/cases/:domain`、`/eval/runs`、`/eval/monitor` |
| 关联工单 | `webui/docs/plans/wo-M43-eval-yaml-exchange-and-result-archive.md` |
| 事实源 | `evals/<domain>/eval/<domain>-eval-cases.yaml`、`.ktx-ui/eval/**`、`scripts/eval-runner.mjs`、`webui/server/eval/**`、`webui/src/pages/eval/**` |
| 关联规范 | `webui/docs/00-product-terminology-standard.md`、`webui/docs/03-api-spec.md`、`webui/docs/04-data-model.md`、`docs/eval-quiz-conventions.md`、`docs/design-eval-monitoring.md`、`docs/DEVELOPMENT.md` |

## 1. 问题背景

当前质量评测模块把“评测用例管理”和“服务器触发 Eval Run”放在同一条主路径上。这个模型适合开发环境或托管环境，但不适合普通私有化客户：

1. 多数客户服务器没有 LLM，也不会在服务器上安装或登录 Claude Code / Hermes agent。
2. 普通用户可能在自己的电脑上有 Claude Code、Hermes 或其他 Agent 执行器。
3. 多数客户没有独立测试数据集，只有生产只读数据、人工抽样或首次运行得到的 baseline。
4. 如果 WebUI 强制编排本机 Agent、流式回写状态或要求跑完后上传结果，会让主流程变复杂。

本规格把质量评测模块拆成更简单的产品边界：

```text
WebUI 管评测用例资产和可选结果证据
用户本机自由运行 Agent / Runner
结果是否归档到 WebUI 由用户选择
```

服务器无 LLM 时，WebUI 不再假装可以自动执行评测。它必须清楚表达当前能力是“评测用例资产管理 + 本地运行指引 + 可选结果归档”。

## 2. 产品决策

本规格作出四个产品级决策：

1. Eval YAML 是 Lucy 可识别的协议文件，不是自由格式文档。
2. WebUI 支持上传、校验、编辑和下载标准 Eval YAML。
3. 用户在本机使用 Claude Code / Hermes / 其他 runner 运行下载的 Eval YAML。
4. 运行结果上传到 WebUI 是可选能力，仅用于验收证据、历史查询和趋势监控。
5. WebUI 必须提供标准离线 runner 或等价的一键命令，避免 Result JSON 依赖 Agent prompt 自行拼格式。

不再把“服务器运行 Eval”作为普通用户主路径。服务器运行仍可作为高级能力保留，但必须在检测到服务器 Agent runtime 可用时才展示或启用。

## 3. 目标用户与职责边界

| 角色 | 责任 | WebUI 应提供 |
|---|---|---|
| 语义资产 Owner | 维护评测用例、定义预期口径、下载给本机 runner | 上传 / 下载 Eval YAML、结构化编辑、schema 校验 |
| 普通业务用户 | 在本机 Agent 或人工流程中运行 / 复核评测 | 下载用例、查看本地运行命令、可选上传结果 |
| 管理员 / 审计方 | 查看归档结果、验收记录、趋势 | 结果导入、运行历史、趋势监控、suite hash 匹配 |
| 运维工程师 | 保障 Lucy WebUI、MCP Endpoint、只读数据访问 | 不需要在服务器安装 LLM 或 Agent |

## 4. 能力分层

| 模式 | 服务器需要 LLM | 用户本机需要 Agent | 是否需要结果上传 | 适用场景 |
|---|---:|---:|---:|---|
| Case 管理 / 人工验收 | 否 | 否 | 否 | 建立质量标准、培训、人工 UAT |
| 本地 Agent 运行 | 否 | 是 | 否 | 用户自测、开发调试 |
| 本地 Agent 运行 + 结果归档 | 否 | 是 | 可选 | 团队验收、审计、趋势 |
| 服务器托管 Eval Run | 是 | 否 | 自动写入 | 企业托管环境、CI gate |

主路径为前三类；第四类为高级能力。

## 5. Eval YAML 识别契约

Lucy 不依赖 LLM 读取 Eval YAML。上传与下载都必须围绕同一套 deterministic schema。

### 5.1 Canonical Suite Schema

标准 Eval YAML 顶层必须包含：

```yaml
lucy_eval_schema_version: 1
kind: lucy_eval_suite
suite_id: kx_financial_v2026_08
domain: kx_financial
title: KX Financial Eval Suite
snapshot:
  mode: live_readonly
  snapshot_date: "2026-08-01"
runner_hints:
  default_mcp_endpoint: ""
  supported_runners:
    - claude_code
    - hermes
cases:
  - id: kx-financial-income-001
    case_type: single_turn
    question: 查询 2024 年营业收入
    expected_source: semantic_layer
    expected_measures:
      - operating_revenue
    sql_assertions:
      - type: required_ast
        value: operating_revenue
        reason: 必须使用营业收入口径
    result_assertions:
      - value_type: scalar
        compare_mode: approx
        numeric_tolerance: 0.01
        data:
          operating_revenue: 123456.78
```

Required fields:

| 字段 | 规则 |
|---|---|
| `lucy_eval_schema_version` | 必须为正整数；MVP 只接受 `1` |
| `kind` | 必须为 `lucy_eval_suite` |
| `suite_id` | 全局稳定 ID，只允许 `[a-z0-9][a-z0-9_-]*` |
| `domain` | 必须匹配 `evals/<domain>/eval/` 的安全路径片段 |
| `cases[]` | 至少 1 条 |
| `cases[].id` | suite 内唯一，只允许安全 ID |
| `cases[].case_type` | `single_turn` / `multi_turn` |
| `cases[].question` | `single_turn` 必填；`multi_turn` 可用 `turns[]` |
| `expected_source` | `semantic_layer` / `raw_sql_fallback` / `manual_debug_only` |

Legacy YAML 兼容：

- 现有 `evals/<domain>/eval/<domain>-eval-cases.yaml` 可继续读取。
- 上传 legacy YAML 时，WebUI 必须在 dry-run 中展示“将迁移为 Lucy Eval Suite v1”的 canonical preview。
- 下载默认输出 canonical v1；如保留 legacy download，必须标记为兼容格式，不作为推荐路径。

### 5.2 Suite Hash

下载 YAML 时，后端必须计算 `suite_hash`：

```text
suite_hash = sha256(canonical_json(EvalSuite without suite_hash))
```

规则：

- hash 基于标准内部模型，而不是用户上传文件的原始空格、注释或 key 顺序。
- hash 必须随下载文件一起展示，可写入 YAML 顶层：

```yaml
suite_hash: sha256:abc123...
```

- 上传结果时必须带 `suite_id` 与 `suite_hash`。
- 如果 hash 不匹配，WebUI 不得静默当作当前标准 suite 的结果；必须进入 hash mismatch preview。

错配处理：

| 情况 | 行为 |
|---|---|
| `suite_id` 不存在 | 拒绝导入，提示先上传对应 Eval YAML |
| `suite_hash` 匹配 | 正常归档为 `hash_status=matched`，可进入趋势和质量门禁 |
| `suite_hash` 不匹配，`case_id` 均能匹配当前 suite | 允许归档为 `hash_status=mismatch` / `import_variant=local_variant`；默认进入运行历史，不进入趋势和质量门禁 |
| `suite_hash` 不匹配，且用户同时上传本地 Eval YAML | 先 dry-run 导入本地 Eval YAML，确认后更新当前 WebUI Eval YAML，再按新 hash 归档 |
| `case_id` 不存在 | 阻断未知 case；Preview 必须列出未知 case，并提示先同步本地 Eval YAML |

hash mismatch preview 必须提供清晰选择：

| 选择 | 行为 |
|---|---|
| 归档为本地变体 | 写入运行历史，标记 `hash_status=mismatch`，默认排除趋势和质量门禁 |
| 同步本地 Eval YAML 后归档 | 要求用户上传本地 Eval YAML，先更新 suite，再重新计算 hash |
| 取消导入 | 不写入任何 run |

## 6. Result JSON 归档契约

WebUI 不解析 terminal 文本。可选归档只接受结构化结果 JSON。

```json
{
  "lucy_eval_result_version": 1,
  "suite_id": "kx_financial_v2026_08",
  "suite_hash": "sha256:abc123",
  "domain": "kx_financial",
  "runner": {
    "kind": "hermes",
    "version": "0.0.0",
    "model": "claude-sonnet-4-6"
  },
  "started_at": "2026-08-01T10:00:00.000Z",
  "finished_at": "2026-08-01T10:05:00.000Z",
  "results": [
    {
      "case_id": "kx-financial-income-001",
      "status": "PASS",
      "duration_ms": 12000,
      "sql": "select ...",
      "actual": { "operating_revenue": 123456.78 },
      "expected": { "operating_revenue": 123456.78 },
      "failures": [],
      "final_text": "2024 年营业收入为 ..."
    }
  ]
}
```

Required behavior:

| 项 | 规则 |
|---|---|
| 版本 | MVP 只接受 `lucy_eval_result_version: 1` |
| 结果粒度 | 一条 `results[]` 对应一个 `case_id` |
| 状态 | `PASS` / `FAIL` / `SKIPPED` / `ERROR` |
| SQL | 如 runner 捕获到 SQL，必须原样归档；不要求所有 runner 都能提供 |
| failure | `FAIL` / `ERROR` 必须有 `failures[]` 或 `error_message` |
| 隐私 | 不允许上传 token、secret、password、Authorization header |

导入后映射到现有 `eval_run` / `eval_run_case` 数据模型：

| Result JSON | Eval DB |
|---|---|
| `suite_id` / `suite_hash` | `eval_run` 扩展字段或 metadata JSON |
| `domain` | `eval_run.domain` |
| `runner.kind` | `eval_run.triggered_by` 或 runner metadata |
| hash 匹配结果 | `eval_run` 扩展字段或 metadata JSON 中的 `hash_status` |
| `results[].case_id` | `eval_run_case.case_id` |
| `results[].status` | `eval_run_case.status` |
| `results[].sql` | `eval_run_case.sql` |
| `actual` / `expected` | `actual_raw` / `expected_raw` |

MVP 必须优先复用现有 `eval_run` / `eval_run_case`。如字段语义不够清晰，只允许增加少量扩展字段或 metadata JSON，例如 `suite_id`、`suite_hash`、`runner_metadata`、`import_source`、`hash_status`。不要在 MVP 新增 suite revision 引擎；版本历史交给 Git / 代码仓库。

## 7. 标准离线 Runner

WebUI 不编排用户本机 Agent，但必须提供标准离线 runner，确保 Result JSON 格式稳定。

推荐命令：

```bash
node lucy-eval-runner.mjs --suite kx_financial.yaml --output result.json
```

MVP runner 职责：

| 职责 | 要求 |
|---|---|
| 读取 Eval YAML | 按 `lucy_eval_schema_version: 1` 校验 suite |
| 调用 Agent adapter | 支持 Claude Code；Hermes 可先作为 adapter 扩展点 |
| 执行 case | 将 `question` / `turns[]` 交给本机 Agent，并收集输出 |
| 校验断言 | 本地执行 sql / result / text matcher 的确定性校验 |
| 输出 Result JSON | 生成严格符合 `lucy_eval_result_version: 1` 的 `result.json` |
| 本地预检 | 写出前先校验 Result JSON schema，减少上传失败 |

下载 Eval YAML 时，WebUI 必须提供至少一种标准 runner 获取方式：

1. 随下载包附带 `lucy-eval-runner.mjs`。
2. 或在 Drawer 中提供可复制的一键命令，指向仓库内已存在 runner。
3. 或提供 `npx` / npm package 命令，但不得要求客户服务器联网。

不允许只依赖 Prompt 要求 Claude Code / Hermes 自行输出 JSON。Agent 可以负责回答和工具调用，Result JSON 的包装与 schema 校验必须由标准 runner 完成。

## 8. 用户体验

### 8.1 评测用例页面

`/eval/cases/:domain` Header 不得平铺多个评测资产按钮。右侧只保留一个主 CTA 和一个下拉菜单。

| 区域 | 内容 | 规则 |
|---|---|
| 主 CTA | 状态自适应 | 无 suite 时为 `上传 Eval YAML`；有 suite 时默认为 `下载 Eval YAML`；近期有待归档结果上下文时可切为 `上传运行结果` |
| 菜单 | `评测套件 (YAML)` | 包含 `上传 Eval YAML`、`下载 Eval YAML`、`查看本地运行命令`、`上传运行结果` |
| 高级入口 | `服务器运行` | 仅服务器 Agent 可用时展示，或收进高级区域 |

按钮数量约束：

- Header 不得同时平铺 `上传 Eval YAML`、`下载 Eval YAML`、`上传运行结果` 三个按钮。
- Domain 切换、搜索、筛选不与资产动作抢主视觉层级。
- `上传运行结果` 必须在菜单中可见；如产品数据证明它最高频，可作为主 CTA 替换 `下载 Eval YAML`，但仍只能保留一个主 CTA。

页面空态：

```text
还没有评测用例
上传 Lucy Eval YAML，或从模板创建第一组评测用例。
```

服务器没有 LLM 时，页面不得显示误导性失败态。应显示：

```text
当前服务器未配置 Agent runtime。你仍可下载 Eval YAML，在本机 Claude Code 或 Hermes 中运行；结果可选择上传归档。
```

### 8.2 上传 Eval YAML

上传流程：

```text
选择 YAML
  -> YAML parse
  -> schema validate
  -> canonical preview
  -> suite hash preview
  -> domain / case diff
  -> 确认导入
```

校验错误必须可定位到字段：

```text
cases[3].id 缺失
cases[5].result_assertions[0].compare_mode 不支持
domain "kx financial" 不是安全 ID
```

### 8.3 下载 Eval YAML

下载内容必须包含：

- canonical suite YAML
- `suite_id`
- `suite_hash`
- `lucy_eval_schema_version`
- runner hints
- 标准 runner 或标准 runner 命令

下载 Drawer 必须展示标准 runner 命令：

```bash
node lucy-eval-runner.mjs --suite kx_financial.yaml --output result.json
```

Hermes profile 或 Claude Code 命令可作为 runner adapter 说明，但不得替代标准 runner 输出 Result JSON。

### 8.4 上传运行结果

上传流程：

```text
选择 Result JSON
  -> JSON parse
  -> result schema validate
  -> suite_id / suite_hash check
  -> case_id match
  -> import preview
  -> 确认归档为 Eval Run
```

若 `suite_hash` 不匹配，Preview 必须展示：

- 当前 WebUI suite hash。
- Result JSON 中的 suite hash。
- 影响的 case 数。
- 归档为本地变体后是否进入趋势和质量门禁。
- “同步本地 Eval YAML 后归档”的入口。

导入成功后，跳转到 `/eval/runs/:runId`。

## 9. API 草案

MVP API 可按以下契约实现。最终路径可在 `webui/docs/03-api-spec.md` 合并时统一。

| Method | Path | 用途 |
|---|---|---|
| `POST` | `/api/eval/suites/import` | 上传 Eval YAML，支持 `dryRun` |
| `GET` | `/api/eval/suites/:domain/download` | 下载 canonical Eval YAML |
| `POST` | `/api/eval/results/import` | 上传 Result JSON，支持 `dryRun` |

`POST /api/eval/suites/import` body:

```json
{
  "dryRun": true,
  "filename": "kx_financial-eval-suite.yaml",
  "content": "lucy_eval_schema_version: 1\n..."
}
```

Response:

```json
{
  "ok": true,
  "data": {
    "domain": "kx_financial",
    "suiteId": "kx_financial_v2026_08",
    "suiteHash": "sha256:abc123",
    "caseCount": 27,
    "format": "canonical_v1",
    "warnings": [],
    "diff": "..."
  }
}
```

`POST /api/eval/results/import` response:

```json
{
  "ok": true,
  "data": {
    "runId": 42,
    "domain": "kx_financial",
    "totalCases": 27,
    "passCount": 25,
    "failCount": 2,
    "suiteHashMatched": true,
    "hashStatus": "matched"
  }
}
```

## 10. 数据与安全要求

| 领域 | 要求 |
|---|---|
| 文件路径 | 上传 suite 只能写入 `evals/<domain>/eval/<domain>-eval-cases.yaml` 或 `.ktx-ui/eval/suites/**` 受控路径 |
| 只读数据 | 本规格不新增数据库写能力；runner 执行仍遵守 `safety_contract.readonly` |
| Secret 防护 | Eval YAML 与 Result JSON 导入必须扫描 `password`、`token`、`secret`、`authorization` 等明显敏感字段 |
| 大小限制 | YAML / JSON 上传大小 MVP 上限 2MB；超过时提示使用资产包流程 |
| Case 数量 | 单次 Eval YAML 导入 MVP 上限 500 条 case；超过时提示拆分 suite |
| 审计 | 确认导入 Eval YAML 和确认归档结果必须写审计事件 |
| 翻译防御 | `Eval YAML`、`Result JSON`、`suite_id`、`suite_hash`、文件名、case id 必须添加 `translate="no"` 与 `notranslate` |

## 11. Terminology Compliance

This feature follows `webui/docs/00-product-terminology-standard.md`.

New terms registered for this spec:

| Canonical Term | UI 主术语 | 说明 |
|---|---|---|
| Eval YAML | Eval YAML | Lucy 可识别的质量评测用例协议文件 |
| Result JSON | Result JSON | 本地 runner 输出、可选上传归档的结构化结果文件 |
| Eval Suite | 评测套件 | 一组同 domain 的评测用例及 suite metadata |
| Suite Hash | suite hash | canonical suite 的 sha256 指纹，用于防止结果错配 |
| Local Runner | 本地 runner | 用户本机 Claude Code、Hermes 或其他执行器 |
| Standard Runner | 标准 runner | Lucy 提供的离线运行脚本或一键命令，负责输出标准 Result JSON |
| Server Run | 服务器运行 | 在 WebUI 服务器所在环境触发的高级 Eval Run |

Required UI terms:

| 概念 | UI 主术语 | 禁止文案 |
|---|---|---|
| Evaluation | 质量评测 | 质量评价 |
| Evaluation Case | 评测用例 | 案例管理、Case 管理作为主标题 |
| Upload Eval YAML | 上传 Eval YAML | 上传测试文件、导入任意 YAML |
| Download Eval YAML | 下载 Eval YAML | 下传 YAML |
| Upload Result JSON | 上传运行结果 | 强制回传、提交作业 |
| Local Runner | 本地 runner | 远程 Agent、服务器 Agent 混用 |
| Standard Runner | 标准 runner | Prompt 约束、让 Agent 自己拼 JSON |
| Optional Archive | 可选归档 | 必须上传、强制同步 |

浏览器翻译防御要求：

- `Eval YAML`、`Result JSON`、`YAML`、`JSON`、`suite_id`、`suite_hash`、`case_id`、`Claude Code`、`Hermes` 必须保护。
- 文件名、路径、hash、case id、domain id 使用 `<code translate="no" className="notranslate">`。
- 普通中文提示不要整段 `translate="no"`。

## 12. 验收标准

- `/eval/cases/:domain` 支持上传 Eval YAML dry-run，并能指出 schema 错误。
- 下载 Eval YAML 输出 canonical v1，包含 `suite_id` 与 `suite_hash`。
- 下载路径提供标准 runner 或标准 runner 命令，能生成符合 `lucy_eval_result_version: 1` 的 Result JSON。
- 服务器未配置 Agent runtime 时，页面仍可完成上传、下载和结果导入，不显示阻断性错误。
- 上传 Result JSON 可 dry-run 校验 `suite_id`、`suite_hash` 与 `case_id`。
- `suite_hash` 不匹配时可归档为本地变体，但默认不进入趋势和质量门禁。
- Header 不平铺三个资产按钮，只保留一个主 CTA 和一个 `评测套件 (YAML)` 菜单。
- 结果导入成功后进入现有运行历史，并可在 `/eval/runs/:runId` 查看。
- 原有服务器 Eval Run 能力不被删除，但不再是普通用户主 CTA。
- 术语 lint 通过，新增 UI 文案遵守 `webui/docs/00-product-terminology-standard.md`。

## 13. 非目标

- 不在本轮实现本机 Agent 编排、长连接、流式回写或 self-hosted runner 注册。
- 不要求用户上传结果；本地 terminal 报告是合法结束点。
- 不要求客户提供独立测试数据库。
- 不实现 LLM 自动生成 Eval YAML。
- 不实现 suite revision 引擎；MVP 版本历史交给 Git / 代码仓库。
- 不改变 Lucy MCP Proxy 的数据问答 instructions。
- 不把 Quiz HTML 编辑器纳入本轮。

## 14. Backout

如本规格实现后需要回滚：

1. 保留已有 `evals/**` 文件，不删除用户上传的评测用例。
2. 关闭上传 / 下载 / 结果导入入口。
3. 保留原 `/eval/runs` 服务器运行路径。
4. 新增的 `eval_run` metadata 字段或 Result JSON artifact 可只读保留，不影响现有 `eval_run` 展示。

---
_Spec by Codex · 2026-08-01_
