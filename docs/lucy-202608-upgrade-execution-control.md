# Lucy 202608 Upgrade Execution Control

| 元数据 | 内容 |
|---|---|
| 文档名称 | Lucy 202608 Upgrade Execution Control |
| 文档类型 | Master Plan / Execution Control |
| 版本 | v0.2 |
| 撰写日期 | 2026-08-03；v0.2 更新 2026-08-03（调整 Dynamic RLS POC 并行波次，补充 SQLite 并发与测试 runner 隔离规则） |
| 事实来源 | `docs/lucy-202608-reliable-delivery-upgrade-spec.md` v0.2 |
| 适用范围 | 202608 spec / plan / task 调度、状态追踪、并行执行边界、minimax handoff |

---

## 1. Purpose

本文档是 Lucy 202608 可靠性交付系统升级的总控台，负责跟踪每个 builder-facing spec 与 plan / task 的执行情况、调度顺序、并行边界和验证策略。

总原则：

- 先做 `Trace / Evidence Kernel`，再做所有依赖证据链的上层能力。
- minimax 只负责执行与自我验证，不负责改变产品边界。
- 开发后默认只做 code review 和非浏览器验证；全部通过后再 commit。
- UI / UX 默认复用当前 WebUI 页面结构、PageHeader、Drawer、diff、状态卡片、表格和 Toast 风格。
- 所有计划必须显式列出“禁止事项”和“自我验证脚本”，防止越界实现。

## 2. Execution Waves

| Wave | 顺序 | 可并行 | 内容 | 依赖 | 完成条件 |
|---|---:|---|---|---|---|
| A | 1 | 否 | Trace / Evidence Kernel | 蓝图 v0.2 | trace / evidence 数据契约、append-only store、MCP Proxy 基础写入、自检脚本通过 |
| B | 2 | 是 | Static Lint & Reindex Diagnosis；Tiered Publish Gate；Dynamic RLS POC | Wave A；Dynamic RLS POC 仅依赖冻结 spec 和隔离脚本目录 | lint / diagnosis / gate 都写 trace event；Dynamic RLS POC 输出隔离 evidence；各自单测通过 |
| C | 3 | 是 | Safe Log-to-Eval；FDE Copilot Candidate | Wave A + B 对应接口 | candidate 与正式资产隔离，reviewer evidence / unverified candidate 边界可测 |
| D | 4 | 否 | Cross-wave code review、release gate、commit | A-C | code review 无阻断问题，非浏览器验证通过 |

## 3. Artifact Tracker

| ID | Spec | Plan / Task | Owner 模式 | 状态 | 并行策略 |
|---|---|---|---|---|---|
| 202608-01 | `webui/docs/62-trace-evidence-kernel-spec.md` | `webui/docs/plans/wo-202608-01-trace-evidence-kernel.md` | minimax backend agent | Ready for execution | 串行前置 |
| 202608-02 | `webui/docs/63-static-lint-reindex-diagnosis-spec.md` | `webui/docs/plans/wo-202608-02-static-lint-reindex-diagnosis.md` | minimax semantic tooling agent | Ready after 202608-01 | 可与 202608-03 / 202608-06 并行 |
| 202608-03 | `webui/docs/64-tiered-publish-gate-spec.md` | `webui/docs/plans/wo-202608-03-tiered-publish-gate.md` | minimax publish agent | Ready after 202608-01 | 可与 202608-02 / 202608-06 并行 |
| 202608-04 | `webui/docs/65-safe-log-to-eval-spec.md` | `webui/docs/plans/wo-202608-04-safe-log-to-eval.md` | minimax eval agent | Ready after 202608-01/03 | 可与 202608-05 并行 |
| 202608-05 | `webui/docs/66-fde-copilot-candidate-spec.md` | `webui/docs/plans/wo-202608-05-fde-copilot-candidate.md` | minimax semantic UX agent | Ready after 202608-01/02 | 可与 202608-04 并行 |
| 202608-06 | `docs/lucy-202608-dynamic-rls-poc-spec.md` | `docs/plans/wo-202608-06-dynamic-rls-poc.md` | minimax security agent | Ready for Wave B after specs are frozen | 与 202608-02 / 202608-03 并行；只改 `scripts/rls-poc/**` |

Status values:

- `Ready for execution`: spec 和 plan 已落盘，可交给 minimax。
- `In progress`: minimax 正在执行。
- `Review`: 已实现，等待 code review。
- `Blocked`: 存在阻断问题。
- `Done`: code review 和非浏览器验证通过，允许 commit。

Execution handoff rule:

- 给 minimax 投喂任务时必须使用对应 Work Order 文件，不要只投 Spec。Spec 是规则事实源，Work Order 是执行入口。

## 4. Subagent Dispatch Guidance

并行执行时按文件 ownership 隔离：

| Agent | 可改范围 | 禁止范围 |
|---|---|---|
| Trace agent | `webui/server/trace/**`、`webui/server/proxy/audit.ts`、`webui/server/proxy/mcp-proxy.ts`、trace tests、trace verify script | 不改 Eval promotion、Publish UI、Dynamic RLS |
| Semantic tooling agent | `webui/server/semantic-lint.ts`、`webui/server/semantic-assets*.ts`、semantic lint tests | 不改 MCP Proxy 鉴权、不改 eval case 入库 |
| Publish agent | `webui/server/semantic-assets.ts`、publish API / UI、publish gate tests | 不改 trace event store schema，只调用接口 |
| Eval agent | `webui/server/eval/**`、eval candidate API / UI、eval tests | 不直接修改正式 eval YAML，除非 promotion 测试使用临时 fixture |
| Copilot agent | `webui/server/fde-copilot/**`、Table semantic workbench candidate UI、copilot tests | 不自动写 semantic-layer，不能调用真实外部 LLM |
| Security POC agent | `scripts/rls-poc/**`、`docs/lucy-202608-dynamic-rls-poc-spec.md` 后续 evidence、security tests | 不接入生产查询路径，不改默认 ACL 语义 |

## 5. Global Minimax Instructions

每个 minimax 执行任务都必须遵守：

1. 先读本文件、对应 spec、对应 work order、`docs/DEVELOPMENT.md`、`webui/docs/00-product-terminology-standard.md`。
2. 记录开工前 `git status --short`，不要回滚与本任务无关的既有改动。
3. 不做浏览器检查、移动窄屏检查或 Playwright，除非后续人工明确要求。
4. 默认只跑相关单测、自检脚本、`npm run lint:terminology` 或局部术语扫描。
5. 不读取 `.ktx/secrets/**`，不输出 token 明文，不改生产数据库。
6. 涉及 `semantic-layer` 写入时必须保留 manifest / overlay 分层，不手改 `_schema/*.yaml` 里的人工扩展。
7. 涉及 AI / LLM 的任务必须先实现 deterministic candidate engine；真实模型调用不作为 MVP 必需项。
8. 每个任务完成后进入 code review，review 全部通过后再 commit。
9. 所有 SQLite 相关测试与自检脚本必须使用 `:memory:` 或独立 temp SQLite 文件，禁止竞争真实 `.ktx-ui/audit.sqlite` / `.ktx-ui/eval/*.sqlite`。

## 5.1 Test Runner Boundaries

Minimax 必须严格区分测试 runner：

| 范围 | 命令形态 | 禁止 |
|---|---|---|
| `webui/` 下 TS / TSX 单测 | `cd /Users/zhangxingchen/Projects/project-lucy/webui && npm test -- <test files>` | 不要用根目录 `node --test` 跑 `webui` Vitest 测试 |
| 根目录 `.mjs` 自检脚本 | `cd /Users/zhangxingchen/Projects/project-lucy && node scripts/verify-*.mjs` | 不要用 `npm test` 或 Jest/Vitest 跑 verify 脚本 |
| 根目录 Node 原生测试 | `cd /Users/zhangxingchen/Projects/project-lucy && node --test <test files>` | 不要追加 Jest 专用参数，例如 `--runInBand` |

如果命令失败，先核对 cwd 和 runner，再判断代码问题。

## 6. Verification Matrix

| ID | Required self-validation |
|---|---|
| 202608-01 | `cd /Users/zhangxingchen/Projects/project-lucy/webui && npm test -- server/__tests__/trace-evidence.test.ts server/__tests__/mcp-proxy-trace.test.ts`；`cd /Users/zhangxingchen/Projects/project-lucy && node scripts/verify-202608-trace-evidence.mjs` |
| 202608-02 | `cd /Users/zhangxingchen/Projects/project-lucy/webui && npm test -- server/__tests__/semantic-lint.test.ts server/__tests__/semantic-assets.reindex-diagnosis.test.ts`；`cd /Users/zhangxingchen/Projects/project-lucy && node scripts/verify-202608-static-lint.mjs` |
| 202608-03 | `cd /Users/zhangxingchen/Projects/project-lucy/webui && npm test -- server/__tests__/publish-gate.test.ts src/__tests__/semantic-asset-publish.test.tsx`；`cd /Users/zhangxingchen/Projects/project-lucy && node scripts/verify-202608-publish-gate.mjs` |
| 202608-04 | `cd /Users/zhangxingchen/Projects/project-lucy/webui && npm test -- server/__tests__/eval-candidates.test.ts src/__tests__/eval-candidates.test.tsx`；`cd /Users/zhangxingchen/Projects/project-lucy && node scripts/verify-202608-safe-log-to-eval.mjs` |
| 202608-05 | `cd /Users/zhangxingchen/Projects/project-lucy/webui && npm test -- server/__tests__/fde-copilot-candidates.test.ts src/__tests__/table-editor.test.tsx`；`cd /Users/zhangxingchen/Projects/project-lucy && node scripts/verify-202608-fde-copilot.mjs` |
| 202608-06 | `cd /Users/zhangxingchen/Projects/project-lucy && node --test scripts/rls-poc/dynamic-rls-poc.test.mjs`；`cd /Users/zhangxingchen/Projects/project-lucy && node scripts/verify-202608-dynamic-rls-poc.mjs` |

## 7. Review And Commit Gate

每个 wave 完成后：

- 先做 code review，重点看安全边界、证据链、不可变事件、是否自动落库。
- 再跑该 wave 自检脚本。
- 再跑 `npm run lint:terminology`。若失败来自既有无关文件，必须在收尾说明中列明。
- 不做浏览器检查。
- 全部 review 通过后再 commit；commit message 建议格式：`feat(202608): <scope>`。

## 8. Known Failure Patterns To Prevent

- 把 trace / evidence 做成可覆盖状态表。
- 在 Log-to-Eval 中把访问日志直接写入正式 eval YAML。
- 在 FDE Copilot 中把 LLM 建议直接写入 semantic-layer。
- 在 Publish Gate 中用单一总通过率处理 P0 / P1 / P2。
- 用关键词单独决定 P0 动态提升。
- 在 Dynamic RLS POC 中只证明 happy path，不验证 fail-closed。
- 为新增 UI 单独发明设计风格，破坏当前 WebUI 工作台密度和 PageHeader 模式。

## 9. Terminology Compliance

This control file follows `webui/docs/00-product-terminology-standard.md`.

Protected terms in all child specs / plans: `Agent`、`MCP`、`KTX`、`YAML`、`Trace`、`Evidence`、`Eval`、`SQL AST`、`RLS`、`CLS`、`access.yaml`、`semantic-layer`、`Token`、`Role`、`ACL`。
