# Agent 执行流水线（完整交付模式 · 可选）

| 元数据 | 内容 |
|---|---|
| 文档名称 | Agent 执行流水线（完整交付模式 · 可选） |
| 文档类型 | Other |
| 版本 | v1.0 |
| 撰写日期 | 2026-06-17 |
| 撰写人 | Codex |
| 委托人 | 待确认 |
| 基于材料 | 用户审阅意见 1-8、docs/governance/DEVELOPMENT.md |
| 适用范围 | project-lucy 完整交付模式下的 vibe coding 多角色交接流程 |
| 输出位置 | docs/agent-pipeline.md（2026-09-25 自仓库根迁入） |

> **本流水线是可选的"完整交付模式"，不是必经流程。**
> Vibe coding 中可单独调用任一角色（如"切到 architect 看这段"、"以 reviewer 视角复核"），不需要走完整链路。
> 注：本文曾引用的 `agents/` 角色库已不在本仓库内，角色仅以下表职责描述为准。
> 所有落盘的正式 Markdown 制品必须包含元数据表。
>
> **优先级**：与 [`docs/governance/DEVELOPMENT.md`](governance/DEVELOPMENT.md) 冲突时以 `governance/DEVELOPMENT.md` 为准。本流水线只规定"完整交付模式"下的角色交接节奏，不覆盖仓库开发治理（Plan Mode、红线、Spec 落位）。

单独调用内部 CLI 做开发或 UAT 时，可直接查阅 [kscc 调用参考](#kscc-调用参考)。

---

## 参与角色（5 个）

| 短名 | 职责（一句话） | 详情 |
|------|--------------|------|
| **pm** | 需求 → PRD（含关键用户文案，opt-in 时含 RELEASE_NOTES） | — |
| **architect** | Context_Summary + SPEC（含 UI 结构/状态、Backout Plan） | — |
| **coder** | 按 SPEC 实现、修 bug、补测试、处理 Refactor（terminal 执行权限，自愈 ≤ 3 次） | — |
| **tester** | 验证 SPEC 合规 + 回归 | — |
| **reviewer** | 合规 + 真实风险 + 上线审计两维复核 | — |
| **Human** | 业务确认 / 最终验收 | — |

---

## 流水线阶段跳转

```
Human 提需求
    ↓
[阶段 0] pm → PRD.md ──► Human 确认（门控）
    ↓
[阶段 0/一] architect → Context_Summary.md + SPEC.md（UI 涉及时含 §6，Backout 触发时含 §5 Backout Plan）
    ↓
[阶段一] architect + coder 澄清对齐
    ↓
[阶段一后] tester → 测试骨架（仅当 SPEC §7 Mocks & Fixtures 触发 TDD 模式时）
    ↓
[阶段二] coder → 实现 → Pre-handoff Checklist 全绿 → IMPLEMENTATION_NOTES.md → 移交 Tester
    ↓
[阶段二] tester → TESTER_PASS.md / TESTER_FAIL.md（失败 → 回 coder 修复 → tester 重验）
    ↓
[阶段三] reviewer → SPEC_Compliance_Check.md + RealWorld_Risk_Check.md（含上线审计项）
         FAIL → Refactor_Instructions.md → coder 修复 → tester 重验 → reviewer 再审（最多 2 次）
    ↓
[阶段四 · opt-in] pm → RELEASE_NOTES.md（用户可见变化总结），架构师确认 SPEC §5 Backout Plan 可执行
    ↓
Human 最终 review + 合并 / 发布
```

---

## 制品清单

| 阶段 | 执行者 | 产出文件 | 必须 |
|------|--------|---------|------|
| 0 | pm | `PRD.md` | ✅ |
| 0/一 | architect | `Context_Summary.md` | ✅ |
| 0/一 | architect | `SPEC.md` | ✅ |
| 一后 | tester | 测试骨架文件（`tests/` 下，命名与功能对应） | SPEC §7 触发 TDD 模式时 |
| 一 | coder | `Clarification_Questions.md` | 如有 |
| 二 | coder | `IMPLEMENTATION_NOTES.md` | ✅ |
| 二 | coder | `SPEC_GAP_REPORT.md` | 如有 |
| 二 | coder | `IMPLEMENTATION_BLOCKER.md` | 自愈 3 次后仍失败时 |
| 二 | tester | `TESTER_PASS.md` / `TESTER_FAIL.md` | ✅ |
| 三 | reviewer | `SPEC_Compliance_Check.md` | ✅ |
| 三 | reviewer | `RealWorld_Risk_Check.md` | ✅ |
| 三 | reviewer | `Refactor_Instructions.md` | 如有 |
| 四 | pm | `RELEASE_NOTES.md` | opt-in（需要发布说明时） |

> 落盘目录由项目约定，本流水线不强制。仓库若有特定治理规则（如 OpenSpec、`docs/`、`changes/`），按那套规则落位。

---

## 迭代上限

| 场景 | 上限 |
|------|------|
| coder 自愈循环 | 3 次 |
| reviewer 返工 | 2 次 |
| 超限 | 人工介入，暂停流水线 |

---

## 铁规则

1. **coder 可以修实现，不可以私改 SPEC**
2. **Human 确认 PRD 前，coder 不得进入实现阶段**
3. **完整交付模式下，所有交接均为文件交接，不以口头上下文传递**（Vibe 模式不强制）
4. **reviewer 不直接修改代码**，只输出审阅结论和 `Refactor_Instructions.md`；修复由 coder 执行
5. **Final Approval 必须输出 SPEC 合规 + 真实风险两维报告**
6. **禁止救急方案；紧急例外走 ADR 登记，过期阻塞**
7. **交接制品命名严格遵循制品清单**
   - coder 阶段唯一合法交接文件名：`IMPLEMENTATION_NOTES.md`
   - 新增制品名须先修改本文件制品清单

> 规则编号永不重用、永不跳号。废止的规则保留编号并标注 `(Deprecated)`。

## kscc 调用参考

本机实测基线为 `@kc/kscc` 1.3.8、macOS arm64（2026-11-22）。`kscc` 默认进入交互会话，脚本用 `-p`（`--print`）。新环境先运行 `command -v kscc` 和 `kscc --version`。工具由团队内部渠道提供，运行需要有效登录态和可达的内部模型服务。

### 最小烟测

在可信的空临时目录运行。实测退出码为 0，JSON 中 `type` 为 `result`、`subtype` 为 `success`、`is_error` 为 `false`，`result` 为 `KSCC_OK`。

```bash
kscc -p --safe-mode --no-session-persistence --no-chrome --tools '' \
  --system-prompt 'Follow the short synthetic test instruction in the user prompt.' \
  --output-format json -- 'Reply with exactly KSCC_OK.'
```

自动化采集工具调用时用 `--output-format stream-json --verbose`，每行一个 JSON 事件。读取 `system/init` 的实际模型和版本、`assistant` 的工具调用、`result` 的最终结果。上层执行器限制整次等待时间，捕获退出码和 stderr，检查最终事件及用例断言。`--no-session-persistence` 关闭会话落盘，跑次证据由调用方采集和脱敏。

### 开发调用

在本次任务的 worktree 中运行。交接内容包含任务边界、Spec／Plan 或 Issue 路径、允许修改的文件、验收命令和交付物。向文件工具提供绝对路径。以下示例从 worktree 根目录发起只读审查。

```bash
repo_root="$(pwd -P)"
review_path="$repo_root/docs/agent-pipeline.md"
kscc -p --permission-mode plan --tools 'Read,Grep,Glob' \
  --strict-mcp-config --no-chrome --no-session-persistence --output-format json -- \
  "先读 $repo_root/AGENTS.md 和 $repo_root/docs/governance/DEVELOPMENT.md。
只检查 $review_path，给出带路径和行号的发现。"
```

实施已授权的任务时，可用 `--permission-mode acceptEdits --tools 'Read,Edit'`，按任务需要追加工具。临时夹具实测 `plan` 能读取文件且文件内容保持一致，`acceptEdits` 完成指定修改。主执行方核对工具调用或 diff，并运行验收命令。`-p` 会跳过工作区信任对话，只在可信目录使用。仓库的开发授权、工作流和复核要求见 [开发治理](governance/DEVELOPMENT.md)。

### Lucy MCP / UAT 调用

从本次 Docker demo／compose 实例复制 Lucy MCP URL，以用例角色的测试 Token 建立一份仓库外的私有 JSON 文件（权限 `0600`）。`KSCC_LUCY_MCP_CONFIG` 指向该文件的绝对路径。字段模板如下，端点与认证约定见 [Lucy Agent 接入指南](runbooks/agent-integration-guide.md)。

```json
{
  "mcpServers": {
    "lucy": {
      "type": "http",
      "url": "<LUCY_PUBLIC_MCP_URL>",
      "headers": {
        "Authorization": "Bearer <LUCY_AGENT_TOKEN>"
      }
    }
  }
}
```

在可信的空临时目录中运行单工具诊断，测试角色须能看到 `lucy_catalog`：

```bash
kscc -p --no-session-persistence --no-chrome --tools '' \
  --setting-sources project --strict-mcp-config --mcp-config "${KSCC_LUCY_MCP_CONFIG:?}" \
  --permission-mode dontAsk --allowedTools 'mcp__lucy__lucy_catalog' \
  --output-format stream-json --verbose -- \
  '请调用 lucy_catalog 一次，列出当前角色可访问的数据资产。'
```

`--strict-mcp-config` 只加载显式传入的 MCP 配置。`--safe-mode` 会禁用 MCP，适用于前面的模型烟测。本机 HTTP 夹具已验证 `Authorization` 请求头、`initialize`、`tools/list`、`tools/call` 和流式结果。

2026-11-22 用这组 MCP 参数连接本机 Lucy Docker demo（`e9cb2423`），kscc 1.3.8 执行 `UAT-CATSEM-01` **PASS**。流式轨迹记录了一次空参 `lucy_catalog` 调用，3 条 demo 数据源均带可读业务描述和 `descriptionState=present`。复测时用 `tool_use_id` 对齐工具请求与结果并断言返回字段。实测进程耗时 6,814 ms，详见 [测试台跑次](qa/uat/suites/catalog-business-semantics/runs/2026-11-22-codex-kscc-catsem-01.md)。

正式 UAT 按套件的真实提问、工具权限和断言执行，将实际客户端版本、模型、环境、脱敏工具调用、断言与耗时写入对应的 `runs/`，并关联用例编号。WebUI 用例还需前台浏览器和即时计时。用例入口与证据规则见 [测试台](qa/uat/INDEX.md)及 [UAT 约定](qa/uat/CONVENTIONS.md)。

### 环境排查与更新

- `--version` 成功但 `--help` 报「获取可用模型失败」或「获取登录链接失败」时，先检查内部网络和登录态。`~/.kscc/logs/` 写入报 `EPERM` 时，检查当前执行环境是否允许 kscc 写本机日志。本次在有内部网络和本机日志写权限的环境中通过。
- `kscc mcp --help`、`kscc mcp add --help` 可查子命令。`kscc mcp list` 和 `kscc mcp get <name>` 会对已批准的端点做健康检查。
- 同版本、同执行环境直接复用本节。升级或发现行为差异时，重跑受影响的烟测，更新这里的实测版本和结果。
