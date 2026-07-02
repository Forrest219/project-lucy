# Builder → Reviewer 自检清单

| 元数据 | 内容 |
|---|---|
| 版本 | v1.0 |
| 日期 | 2026-06-29 |
| 依据 | `inbox/lucy-platform-progress-audit-2026-06-29.md` |
| Reviewer | zhangxingchen |
| Builder | Codex / minimax |
| 临时文件位置 | `inbox/`（本文件可随任务结束后删除） |

Builder 在提交 PR / 标记 review 前，必须逐项自检并在右列填写结果。Reviewer 依据此清单做接收验收。

---

## P0：API Spec 漂移修复（Release Gate 阻断项）

> 预计改动 ~10 分钟 + 1 次 CI 全流程验证。**不通过不能 release。**

### 改动范围

| # | 检查项 | Builder 自检结果 |
|---|---|---|
| P0-1 | `webui/docs/03-api-spec.md` Audit 小节新增 `GET /api/admin/audit/:id/sources` 条目 | |
| P0-2 | `webui/docs/03-api-spec.md` Audit 小节新增 `GET /api/admin/audit/turns` 条目 | |
| P0-3 | `webui/docs/03-api-spec.md` Audit 小节新增 `GET /api/admin/audit/turns/:turnId` 条目 | |
| P0-4 | `webui/docs/03-api-spec.md` Audit 小节新增 `POST /api/admin/audit/conversation-turns/purge` 条目 | |
| P0-5 | 4 条新增路径与 `webui/server/admin/audit.ts` 中对应 `app.get/post(...)` 的字符串**完全一致**（大小写、斜杠、参数名均相同） | |
| P0-6 | `git diff --name-only` 仅包含 `webui/docs/03-api-spec.md`，无其他意外改动 | |

### 本地验证命令（必须全部通过）

| # | 命令 | 预期结果 | Builder 实际结果 |
|---|---|---|---|
| P0-7 | `npm run lint:spec` | 退出码 0，无 `FAIL` 行 | |
| P0-8 | `PATH=/Users/forrest/.local/node-v24.14.1-darwin-arm64/bin:$PATH npm --prefix webui test` | 31 test files / 186 tests passed | |
| P0-9 | `PATH=/Users/forrest/.local/node-v24.14.1-darwin-arm64/bin:$PATH npm --prefix webui run build` | Build 通过，无 error（chunk 警告可接受） | |
| P0-10 | `npm run security:baseline` | `0 warning(s)` / PASS | |
| P0-11 | `npm run smoke:p0:business-eval` | Superstore + KX Financial 全部 PASS | |

### CI 验证

| # | 检查项 | Builder 自检结果 |
|---|---|---|
| P0-12 | GitHub Actions `spec-and-webui` job 绿（PR 上 CI 全绿，或附截图证明） | |
| P0-13 | 若 Docker daemon 可用：`npm run smoke:p0:docker` PASS（不可用时注明原因） | |

---

## P1：交付前应该完成项

> 不阻断 release gate，但遗留会误导后续 agent / 开发者；建议与 P0 同 PR 或紧接 P0 后处理。

### P1-A：本机 Node 版本统一（消除 ABI 不一致）

**二选一，明确选项后执行并记录：**

| # | 检查项 | Builder 自检结果 |
|---|---|---|
| P1-A1 | 已选定策略：`[ ] Node 22 rebuild` 或 `[ ] Node 24 文档化` | |
| P1-A2 | **若选 Node 22 rebuild**：在 Node 22 环境执行 `npm --prefix webui ci`（fresh install），`npm --prefix webui test` 通过（无需 PATH 前缀） | |
| P1-A3 | **若选 Node 24 文档化**：`docs/DEVELOPMENT.md`（或 README）中明确写明"本机开发需 Node ≥ 24"；CI workflow `node-version` 已同步更新为 `24` | |
| P1-A4 | 无论哪种策略，`npm --prefix webui test` 在**说明文档描述的环境**下无需特殊 PATH 即可通过 | |

### P1-B：`docs/webui-feature-map.md` 历史化或刷新

**背景：** 该文档写于 2026-06-19，称 Admin/Eval/Audit 多项「缺失」，但当前代码已有 `/admin/agents`、`/admin/audit`、`/eval/cases`、`/eval/runs`、`/eval/monitor` 路由和测试，与实现严重背离，会误导 Agent。

| # | 检查项 | Builder 自检结果 |
|---|---|---|
| P1-B1 | 已选定策略：`[ ] 在文档头加历史注记` 或 `[ ] 按实现全量刷新` | |
| P1-B2 | **若加历史注记**：文档顶部有显眼 banner，注明「本文档为 2026-06-19 历史快照，当前实现已超前，以 `docs/webui-impl-status.md` 为准」 | |
| P1-B3 | **若全量刷新**：Admin（Agents/Audit/Roles/MCP Tools）、Eval（Cases/Runs/Monitor）行的状态已更新为「完全实现」，落点列已补路由和测试文件引用 | |
| P1-B4 | 无论哪种策略，`docs/webui-feature-map.md` 不再包含与现有路由矛盾的「缺失」判断 | |

### P1-C：`docs/version-matrix.md` §5 MCP Client Matrix 对齐

**背景：** checklist 标注 Claude Code / Codex / Openclaw / Hermes / Cursor 五客户端已于 2026-06-24 人工验收，但 version-matrix 仍写"project-local usage exists / not verified"。

| # | 检查项 | Builder 自检结果 |
|---|---|---|
| P1-C1 | `docs/version-matrix.md` §5 表中 Claude Code 行更新为 `verified`，Notes 列注明验收日期 2026-06-24 | |
| P1-C2 | Codex 行同步更新为 `verified` | |
| P1-C3 | Openclaw / Hermes / Cursor 三行已存在或新增，状态均为 `verified`，Notes 注明 2026-06-24 人工验收 | |
| P1-C4 | Cloud-hosted agent 行保持 `not verified`（未变动） | |

### P1-D：`webui/docs/codex/progress.md` 标注历史态

**背景：** 该文件最后更新 2026-06-16，仅覆盖 M0-M5，不应再被作为当前 WebUI 范围依据引用。

| # | 检查项 | Builder 自检结果 |
|---|---|---|
| P1-D1 | 文件顶部已加注：「本文档为 Codex 开发阶段历史构建日志（截至 M5），不代表当前 WebUI 完整功能范围。当前状态见 `docs/webui-impl-status.md`。」 | |
| P1-D2 | 未被 `docs/product-docs-index.md` 或其他活跃文档的「当前状态」章节引用（若有引用，已改为历史注释或删除） | |

---

## 签收条件（Reviewer 视角）

Reviewer 接收 PR 时，期望看到：

1. **P0 全绿**：P0-1 ～ P0-13 全部通过（CI 截图或 Actions 链接），且 `lint:spec` 输出无 FAIL 行。
2. **P1 已处理或已明确延期**：P1-A/B/C/D 各项有明确结果列，若某项选择延期需写明理由和后续 issue 编号。
3. **无额外改动**：P0 PR 的 `git diff` 不包含非目标文件；若 P1 合并进同 PR，改动范围在预期内。
4. **无新 lint 告警**：`npm run lint:spec` 除修复项外，warn 数不增加。

---

_Reviewer: zhangxingchen | 2026-06-29_
