# WO-M43 Eval YAML Exchange And Optional Result Archive

| 元数据 | 内容 |
|---|---|
| 工单号 | M43 |
| 标题 | 质量评测 Eval YAML 上传 / 下载、本地运行指引与可选结果归档 |
| 来源 Spec | `webui/docs/46-eval-yaml-exchange-and-result-archive-spec.md` |
| 撰写日期 | 2026-08-01 |
| 适用范围 | `webui/src/pages/eval/CaseList.tsx`、`webui/src/pages/eval/RunList.tsx`、`webui/src/pages/eval/RunDetail.tsx`、`webui/server/eval/cases.ts`、`webui/server/eval/runner.ts`、`webui/server/eval/db.ts`、`webui/src/lib/types.ts`、`webui/server/__tests__/eval-*.test.ts`、`webui/src/__tests__/eval-cases.test.tsx`、必要时 `scripts/eval-runner.mjs` |
| 上游工单 | Module 2 Eval 配置与监控、M36 Data Agent Ops Platform Global UX、M40 PageHeader Standardization |

## 目标

按 SPEC 落地普通用户可用的质量评测主路径：

1. WebUI 支持上传 Lucy 可识别的 Eval YAML，并执行 deterministic schema 校验。
2. WebUI 支持下载 canonical Eval YAML，包含 `suite_id` 与 `suite_hash`。
3. WebUI 提供标准离线 runner 或等价一键命令，生成稳定的 Result JSON。
4. WebUI 支持可选上传 Result JSON，校验 suite / hash / case 后归档为 Eval Run。
5. `suite_hash` 不匹配时允许归档为本地变体，但默认不进入趋势和质量门禁。
6. 服务器无 LLM / 无 Agent runtime 时，评测用例管理、下载与结果导入仍可用。
7. 原“服务器运行”能力降级为高级能力，不再作为普通用户主 CTA。

## 任务清单

- [x] **T1 Eval Suite schema**：新增 `EvalSuite`、`EvalSuiteCase`、`EvalResultImport` 类型；实现 canonical parse、legacy YAML 读取兼容、safe id 校验、suite hash 计算。
- [x] **T2 Suite import API**：新增 `POST /api/eval/suites/import`，支持 `dryRun`、schema error 定位、canonical preview、diff、确认写入。
- [x] **T3 标准离线 runner**：提供 `lucy-eval-runner.mjs` 或等价一键命令；负责读取 Eval YAML、调用 Agent adapter、执行断言、输出并本地校验 `lucy_eval_result_version: 1` Result JSON。
- [x] **T4 Suite download API**：新增 `GET /api/eval/suites/:domain/download`，输出 canonical v1 YAML，包含 `suite_id`、`suite_hash`、runner hints 和标准 runner 命令 / 文件。
- [x] **T5 Result import API**：新增 `POST /api/eval/results/import`，支持 `dryRun`、Result JSON schema 校验、suite hash 状态判断、case id 匹配、确认后写入 `eval_run` / `eval_run_case`。
- [x] **T6 Eval DB metadata**：优先复用现有 `eval_run` / `eval_run_case`；只增加必要扩展字段或 metadata JSON，例如 `suite_id`、`suite_hash`、`runner_metadata`、`import_source`、`hash_status`；不新增 suite revision 引擎。
- [x] **T7 CaseList UX 收敛**：`/eval/cases/:domain` Header 只保留一个主 CTA 和一个 `评测套件 (YAML)` 下拉菜单；菜单含上传 Eval YAML、下载 Eval YAML、查看本地运行命令、上传运行结果；服务器 Agent 不可用时展示本地运行说明，不阻断页面。
- [x] **T8 Server Run 降级**：将“触发 Eval Run”改为高级入口或仅 runtime 可用时显示；保留原 API 行为，不删除现有服务器运行路径。
- [x] **T9 Result archive UX**：上传 Result JSON 后展示 import preview，确认后跳转 `/eval/runs/:runId`；hash mismatch 时提供“归档为本地变体”“同步本地 Eval YAML 后归档”“取消导入”。
- [x] **T10 本地运行提示**：下载 Drawer 或结果区域提供标准 runner 命令；Claude Code / Hermes 只作为 adapter 说明，不要求 WebUI 编排本机 Agent。
- [x] **T11 安全与术语**：上传内容执行敏感词扫描、大小限制和安全路径校验；新增 UI 文案加翻译防御并通过术语 lint。
- [x] **T12 测试**：覆盖 schema parse、hash 稳定性、legacy migration preview、standard runner result schema、result import mismatch local variant、CaseList 无服务器 Agent 空态、Header 动作收敛、结果导入跳转。
- [x] **T13 验证**：运行术语 lint、前后端聚焦测试、build；浏览器复核按需执行，本轮按用户约束不做浏览器测试。
- [x] **T14 浏览器反馈修复：真实下载**：`下载 Eval YAML` 必须触发浏览器文件下载，同时保留页面内本地运行命令和 YAML 预览。
- [x] **T15 浏览器反馈修复：hash mismatch 三选项**：Result JSON dry-run 出现 hash mismatch 时必须明确提供 `归档为本地变体`、`同步本地 Eval YAML 后归档`、`取消导入` 三个选择，不得用隐式确认替代。
- [x] **T16 Docker 浏览器验收**：重建 Docker 后访问 `/eval/cases/kx_financial`，真实验证下载事件、YAML 预检、Result JSON mismatch 三选项、归档跳转和 `/eval/runs` 服务器运行降级入口。

## 实现顺序

1. 后端先实现 schema / hash / dry-run，不写 UI。
2. 接上标准离线 runner 输出契约，确保 runner 生成的 Result JSON 能被后端 dry-run 接受。
3. 接上 suite download，确保“上传 -> 下载 -> runner -> 上传结果”模型稳定。
4. 实现 result import dry-run，再写入现有 Eval DB metadata。
5. 前端改 CaseList 主动作、`评测套件 (YAML)` 菜单和 Drawer / Modal。
6. 最后降级服务器运行入口，避免早期破坏现有 run 路径。

## 验收口径

详见 SPEC §12。最低验收：

- 上传合法 Eval YAML dry-run 通过，并显示 `suite_hash`。
- 上传非法 YAML 能定位字段错误。
- 下载文件能被后端重新 parse，hash 稳定。
- 标准 runner 或等价一键命令能输出通过后端 dry-run 的 Result JSON。
- 上传 Result JSON hash 匹配时生成一条 Eval Run。
- 上传 Result JSON hash 不匹配时可归档为本地变体，并标记 `hash_status=mismatch`。
- hash mismatch 本地变体默认不进入趋势和质量门禁。
- 服务器未配置 Claude Code / Hermes 时，`/eval/cases/kx_financial` 仍可上传、下载和上传结果。
- Header 不平铺上传 / 下载 / 上传结果三个按钮，只保留一个主 CTA 和一个 `评测套件 (YAML)` 菜单。
- `服务器运行` 不是普通用户主路径。

## 验证命令

```bash
cd webui
npm run lint:terminology
npm test -- --run server/__tests__/eval-cases.test.ts server/__tests__/eval-runs.test.ts server/__tests__/eval-api-contract.test.ts
npm test -- --run src/__tests__/eval-cases.test.tsx
npm run build
```

如新增独立 schema helper 或 runner helper：

```bash
cd webui
npm test -- --run server/__tests__/eval-suite-schema.test.ts
npm test -- --run server/__tests__/eval-offline-runner.test.ts
```

## 浏览器复核

手动或 Browser 自动化访问：

```text
http://localhost:5174/eval/cases/kx_financial
http://localhost:5174/eval/runs
```

检查：

- Header 是否只保留一个主 CTA 和一个 `评测套件 (YAML)` 菜单。
- 无服务器 Agent runtime 时是否展示本地运行说明，而不是错误态。
- 上传 Eval YAML dry-run preview 是否展示 case 数、suite hash、diff。
- 下载 YAML 是否包含 `lucy_eval_schema_version`、`suite_id`、`suite_hash` 和标准 runner 命令。
- 上传 Result JSON 成功后是否进入运行详情页。
- hash 错配是否提供 `归档为本地变体`、`同步本地 Eval YAML 后归档`、`取消导入` 三选项，并清晰提示默认不进入趋势和质量门禁。
- 未知 case、schema 错误是否可读且不写入运行历史。

## 风险与边界

| 风险 | 处理 |
|---|---|
| Legacy eval YAML 与 canonical v1 差异较大 | 首轮只做兼容读取和 migration preview，不强制重写所有旧文件 |
| Result JSON 泄露敏感信息 | 导入前扫描明显 secret 字段；RunDetail 展示仍避免 header / token |
| suite hash 受 YAML key 顺序影响 | hash 基于 canonical JSON 内部模型，不基于原始文本 |
| 结果归档污染趋势 | hash mismatch 可进运行历史，但默认排除趋势和质量门禁 |
| UI 动作过多 | Header 只保留一个主 CTA 和一个 `评测套件 (YAML)` 菜单；服务器运行放高级入口 |
| Result JSON 格式百花齐放 | 标准 runner 负责包装和本地 schema 校验，不依赖 Agent prompt 自行拼 JSON |
| 用户误以为必须上传结果 | 文案明确“可选归档”；本地运行完成即可结束 |

## Backout

按 SPEC §14 回滚：

- 隐藏 Eval YAML 上传 / 下载 / Result JSON 上传入口。
- 保留已有 `evals/**` 文件和 `.ktx-ui/eval/**` 证据，不删除用户数据。
- 保留原服务器 Eval Run API 与运行历史展示。
- 新增 `eval_run` metadata 字段和 Result JSON artifact 只读保留，后续迁移清理。

---
_Work order by Codex · 2026-08-01_
