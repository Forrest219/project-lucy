# Module 2 Eval 配置与监控 — 代码审查报告

| 元数据 | 内容 |
|---|---|
| 文档名称 | Module 2 Eval 配置与监控代码审查 |
| 文档类型 | Review |
| 版本 | v1.0 |
| 撰写日期 | 2026-06-19 |
| 撰写人 | Claude Reviewer (claude-sonnet-4-6) |
| 委托人 | zhangxingchen |
| 基于材料 | project-lucy/docs/design-eval-monitoring.md (922行)；git diff 范围内新增/修改文件共 13 个 |
| 适用范围 | 合并前最终质量门；适用于 PR review 决策 |
| 输出位置 | project-lucy/docs/review-module2-eval-monitoring.md |

---

## 总体判定：REQUEST CHANGES

存在 2 条 [CHANGE]（正确性问题）和 3 条 [SUGGEST]，无 [BLOCK]。必须修复 [CHANGE] 后方可合并。

---

## P0：安全性

**P0.1 命令注入风险分析**

`runner.ts:99-111` — `domain` 参数来自用户请求体，经 `casesPath = \`evals/${domain}/eval/${domain}-eval-cases.yaml\`` 拼入 spawn args 数组（非 shell 字符串）。由于使用 `spawn("node", args, ...)` 而非 `exec(shell_string)`，参数作为离散数组元素传递，无 shell 注入风险。但 `domain` 未经格式校验：

- `caseIds`（`mode=ids` 时，`runner.ts:77-78`）直接将用户提供的字符串数组展开为 `--case <id>` 参数。同样因使用 args 数组不存在 shell 注入；但若某个 id 恰好以 `--` 开头（如 `--cases`），node 进程不会解析为 flag（已明确位于第二个位置参数后），无实际风险。

- 结论：P0 级命令注入风险不成立，spawn 调用方式安全。

**P0.2 路径穿越分析**

`cases.ts:86-90` — `casesRelPath(domain)` 对 `domain` 做了 `/`、`\`、`..` 字符过滤，且最终调用 `fs-safe.ts::assertReadable` / `safeWrite`，后者做了符号链接解析（`realpath`）+ 路径前缀白名单验证（ALLOW 列表包含 `evals`）。`evals/../../secrets` 路径会被 `normalizeRelative` 捕获为 `../../secrets` 后抛 `ForbiddenPathError`。路径穿越防护到位。

`monitor.ts:21,34` — CONFIG_REL 硬编码为 `.ktx-ui/eval/monitor-config.json`，走 `safeWrite`；`.ktx-ui` 在 ALLOW 列表中。写路径安全。

---

## P1：正确性

**[CHANGE] P1.1 `coverage` 模式不可用**

`runner.ts:75-85` — `CaseSelection.mode === "coverage"` 分支没有任何实现：未从 YAML 中按 `coverage` 字段过滤 case id，`caseIds` 保持空数组，导致最终行为与 `mode=all` 完全相同（runner 不传 `--case` 参数时跑全集）。

设计文档 §4.B 明确定义了 `{ "mode": "coverage", "coverage": "anti_pattern" }` 语义（`webui/src/lib/types.ts` 也有对应类型）。前端 `RunList.tsx` 虽然目前 UI 只暴露 `all` 和 `failed_in_last` 两个选项，但后端接口已声明此模式，若外部 POST 进来会静默跑全集而非报错，语义欺骗性强。

→ 建议：补充 `coverage` 分支，从 YAML 加载 cases 并按 `coverage` 字段过滤出 `caseIds`；或在接收到 `mode=coverage` 时返回 400 `UNSUPPORTED_SELECTION_MODE`，明确标记为未实现。

**[CHANGE] P1.2 runner 进程退出码语义判定错误**

`runner.ts:176` — 退出逻辑：
```ts
const status = code === 0 ? "succeeded" : (summary ? "succeeded" : "failed");
```
`eval-runner.mjs:768` 明确定义：`process.exit(summary.fail === 0 ? 0 : 1)`，即有 FAIL case 时退出码为 1。上述逻辑会把"有 FAIL case、exitCode=1、但 JSON 解析成功"的情况判为 `succeeded`，而实际上应该是"run 完成但有失败 case"。

设计文档 §3.B RunStatus 定义 `succeeded = runner 正常退出，结果已落库`；`failed = runner crash 或 precheck 失败`。按此定义，exitCode=1 且 JSON 可解析应为 `succeeded`（run 完成了）。但若 exitCode 非 0 且 JSON 无法解析（runner crash），才是 `failed`。现有实现恰好与此逻辑一致，但表达式令人费解，且存在一个边缘 bug：exitCode=0 但 JSON 解析失败（stdout 为空）时，`code === 0` 分支直接返回 `succeeded`，此时 `passCount=0 failCount=0 totalCases=0` 写入 DB，掩盖了 runner 输出丢失的情况。

→ 建议：将状态逻辑明确为 `const status = summary !== null ? "succeeded" : "failed"`，不依赖 exitCode，并在 `summary === null` 时保留 stderr 日志用于 debug。

**P1.3 SSE 事件格式与前端解析匹配（已确认正确）**

`runner.ts:43` — SSE 广播格式为 `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`，符合 EventSource 规范。`RunDetail.tsx:58-73` 用 `es.addEventListener("progress", ...)` 解析，`e.data` 已由浏览器原生解析（去掉 `data: ` 前缀），无需再手动 split。格式匹配正确。

**P1.4 并发 run 检测（已确认正确）**

`runner.ts:66-68` — 查询 `status='running' OR status='queued'`，存在则抛 `RunnerBusyError(409)`，在 INSERT 之前检查。`eval-runs.test.ts` 中有对应场景测试。正确。

**P1.5 YAML 注释保留（已确认正确）**

`cases.ts` 全程使用 `yaml` 包（`parseDocument` + `Document.toString`），未用 `js-yaml` 的 `load/dump`。`upsertCaseInDoc` 操作 AST 节点而非序列化再解析。`eval-cases.test.ts:99-147` 有注释保留场景测试且测试编写正确。

**P1.6 runs.sqlite 与 audit.sqlite 隔离（已确认正确）**

`db.ts:53-54` — 路径为 `.ktx-ui/eval/runs.sqlite`（或环境变量 `LUCY_EVAL_DB` 覆盖）。`proxy/audit.ts` 用的是独立文件（未见共用）。隔离正确。

**P1.7 runner 结果字段映射（存在偏差，不阻塞但需关注）**

`runner.ts:196-206` — 将 `c.pass`、`c.sql`、`c.failures`、`c.finalText` 等字段从 summary.cases 中读取。`eval-runner.mjs:656-658` 的 entry 结构为 `{ pass, failures, id, ... }`。`c.sql` 字段在 `eval-runner.mjs` 的 entry 中未见明确赋值（搜索 entry 构造逻辑为 line 647-668，未赋 sql）。`c.finalText` 同理。这意味着 DB 中 `eval_run_case.sql` 和 `final_text` 字段始终为 null，不影响通过率统计，但 RunDetail 中 SQL 展示功能不生效。这属于设计文档 §1.3 提及的 fixture 假设问题，建议 spike 阶段核实 entry 结构。

---

## P2：架构对齐

**P2.1 envelope 一致性（已确认正确）**

所有新端点返回 `{ ok: true, data: ... }` 或通过 `index.ts` 的全局 `setErrorHandler` 统一返回 `{ ok: false, error: { code, message } }`。枚举值与 ADR-09 约定一致。

**P2.2 dryRun 惯例（已确认正确）**

`cases.ts:300` — `const dryRun = request.body.dryRun !== false`，即不传或传 `true` 时默认 dry run，符合设计文档约定。

**P2.3 Non-Goals 合规（已确认正确）**

未发现引入 Quiz 编辑器、告警发送（仅 UI 展示 banner）、cron 调度、并发 run、外部图表库。

**P2.4 SVG 折线图（已确认正确）**

`Monitor.tsx:13-127` — 完全使用原生 SVG，无外部图表库依赖。

**P2.5 设计文档 `GET /api/eval/domains/:domain` 端点缺失**

设计文档 §4.A 列出 `GET /api/eval/domains/:domain`（返回 domain 元数据 + case 索引 + lastRun 摘要）。实现中仅有 `GET /api/eval/domains`（列全部）和 `GET /api/eval/cases/:domain`（列 cases）。单 domain 的详情端点未实现，`lastRun` 字段也未在 `EvalDomainInfo` 中出现。前端 `CaseList.tsx` 目前不依赖此端点，影响范围有限，但接口约定不完整。

→ 建议：作为后续补充，或在此 PR 的 TODO 中记录。

---

## P3：代码质量

**[SUGGEST] P3.1 runner.ts 中存在未使用的 import**

`runner.ts:2-3` — `createWriteStream`（来自 `node:fs`）、`readFile` 和 `mkdir`（来自 `node:fs/promises`）被导入但在整个文件中从未调用。`writeFile` 在 `child.on("close")` 内用动态 import 引入，而非使用顶层导入。

→ 建议：删除 `createWriteStream`、`readFile`、`mkdir` 三个死 import；统一改用顶层静态 import `writeFile`，去掉 `child.on("close")` 内的动态 import。

**[SUGGEST] P3.2 CaseEditor.tsx "YAML 预览" tab 显示的是 JSON 而非 YAML**

`CaseEditor.tsx:437` — "YAML 预览" tab 的内容用 `JSON.stringify(form, null, 2)` 渲染，实际是 JSON 格式，与 tab 标签"YAML 预览"不符，对用户有误导。

→ 建议：改用 `import { stringify } from "yaml"` 序列化 form 对象，或将 tab 标签改为"JSON 预览"。

**[SUGGEST] P3.3 SSE keepalive 在客户端断开时可能多次调用 clearInterval**

`runner.ts:367,374` — `reply.raw.on("close")` 注册了两次 listener，分别用于从 sseClients 删除 reply 和清除 keepalive 定时器。Node.js 允许重复注册，两者均可正常工作，但 clearInterval 被调用两次（keepalive catch 块内也有一次）不会报错，只是略显冗余。可合并为一个 close listener。

---

## 必须修复后才能合并的项目

| # | 位置 | 问题 |
|---|---|---|
| 1 | `runner.ts:75-85` | `coverage` 模式静默退化为全跑，接口语义欺骗性强，需要补实现或返回明确错误 |
| 2 | `runner.ts:176` | runner 退出码 1（有 FAIL case）但 JSON 可解析时被错误标记为 `succeeded`，exitCode=0 但 JSON 为空时也标为 `succeeded`，需修正状态判定逻辑 |

---

## 2026-06-21 状态更新

本审查报告保留为历史 review 记录。后续静态核对显示，本报告的两条 CHANGE 已不再按原描述成立：

| 原条目 | 当前状态 | 当前证据 |
|---|---|---|
| P1.1 `coverage` 模式静默退化为全跑 | 已处理为明确拒绝 | `webui/server/eval/runner.ts` 在 `caseSelection.mode === "coverage"` 时返回 `UNSUPPORTED_SELECTION_MODE` |
| P1.2 runner status 判定 | 已按 summary 判定 | `webui/server/eval/runner.ts` 当前使用 `summary !== null ? "succeeded" : "failed"` |
| P2.5 `GET /api/eval/domains/:domain` 缺失 | 已实现 | `webui/server/eval/cases.ts` 已注册 `GET /api/eval/domains/:domain` |

仍需关注但不阻塞当前 spec 整改：

- runner 输出中的 `sql` / `finalText` 是否稳定，需要 fixture 锁定。
- CaseEditor “YAML 预览”是否仍显示 JSON，需在 UI 整理时复核。
- SSE keepalive 与死 import 属代码质量项，可后置。

新的整改事实源：

- 审计报告：`inbox/spec-audit-2026-06-21.md`
- 整改计划：`inbox/spec-remediation-plan-2026-06-21.md`
- Thinker 交付审阅：`inbox/thinker-review-spec-delivery-2026-06-21.md`
