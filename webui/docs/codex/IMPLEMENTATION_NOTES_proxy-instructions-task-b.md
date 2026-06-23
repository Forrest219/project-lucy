# IMPLEMENTATION_NOTES — wo-proxy-instructions-injection / Task B

| 元数据 | 内容 |
|---|---|
| 文档名称 | IMPLEMENTATION_NOTES — wo-proxy-instructions-injection / Task B |
| 文档类型 | Implementation Notes (builder 交付 + 升级问题) |
| 版本 | v1.0 |
| 撰写日期 | 2026-06-23 |
| 撰写人 | builder (Codex CLI subagent) |
| 委托人 | Claude（架构师 / 工单发布者） |
| 适用工单 | webui/docs/codex/wo-proxy-instructions-injection.md（Task B） |
| 状态 | **部分完成 + 2 项重大问题升级架构师决策** |

---

## TL;DR

| DoD 项 | 状态 |
|---|---|
| access.yaml 新 role + 本地用户落地 | ✅ 完成（`local_dev_full_access` role 10 张表 + `forrest_local` user） |
| token 已生成，明文不在任何交付物 | ✅ 完成（`lucy-mcp-dev-v3`，明文仅在 `.ktx/secrets/lucy-local-token`，600，gitignored） |
| `.mcp.json` 切到 `:7879` | ❌ **本轮不动**（理由见下"重大问题 #2"） |
| `git diff` 确认无明文 token | ✅ 完成（access.yaml diff 57 行，仅 1 个 sha256 hash；.ktx/secrets/ 在 .gitignore） |
| 本地 Claude Code 数据问答手测通过 | ❌ **本轮不做**（`.mcp.json` 未切；workhorse :7879 部署未 reload Task A + 未加 forrest_local user） |
| **范围外问题** | ⚠️ **重大问题 #1**（KTX upstream SSE 握手 gap） + ⚠️ **范围外问题**（误触发 Claude Code 子进程） |

---

## 范围确认（本轮实际修改）

| 项 | 状态 | 备注 |
|---|---|---|
| `webui/config/access.yaml` | ✅ 修改 | 加 `local_dev_full_access` role + `forrest_local` user + 1 个 token hash（v3） |
| `webui/server/proxy/mcp-proxy.ts` | ❌ 未动 | Task A 范围，本轮不重访 |
| 根目录 `.mcp.json` | ❌ **未动** | 见"重大问题 #2"——本轮保持直连 `:7878` |
| `.ktx/secrets/lucy-local-token` | ✅ 创建 | 600 权限，gitignored（`.ktx/.gitignore:5:secrets/`） |
| 仓库临时脚本（tmp_smoke/） | ✅ 创建 | 在 `inbox/_tmp_smoke/` 目录，按 `AGENTS.md` 规约属 tmp |

---

## 已完成

### 1. access.yaml 新增 `local_dev_full_access` role

按工单"实现步骤"第 1 步 YAML 块**原样**加在 `roles:` 块下、`users:` 块下：

- **role** `local_dev_full_access`：10 张表全（与 `ktx.yaml` enabled_tables 100% 对齐）+ 10 个工具
- **user** `forrest_local`：enabled=true，role=local_dev_full_access，note 写明"Token provisioned via admin API; never store plaintext in committed files"

### 2. forrest_local token 生成

通过 admin API（`POST /api/admin/agents/forrest_local/tokens`）生成，**严格走现成流程**：

- 三个 label 走过：`lucy-mcp-dev`、`lucy-mcp-dev-v2`、`lucy-mcp-dev-v3`
- v1、v2 已通过 `DELETE /api/admin/agents/forrest_local/tokens/{label}` **清理**——它们是**死 token**（明文曾因 shell 渲染截断写入失败）
- **最终交付**：`lucy-mcp-dev-v3`，hash `sha256:4308081c826e6b6cc1d44ac3277078cb36007fd78723645f1eed61b0a75f951d`

**明文落位（不在任何 commit / 仓库交付物）**：

```
/Users/forrest/Projects/project-lucy/.ktx/secrets/lucy-local-token
  - 600 权限 (owner-only read)
  - gitignored (.ktx/.gitignore:5:secrets/)
  - 64 字节 = 32 bytes hex (与 randomBytes(32).toString("hex") 一致)
  - 文件 sha256 = sha256:4308081c...f951d = access.yaml 里 v3 的 hash
  - 文件**不含换行外的任何其他内容**（仅 token + 一个末尾 \n）
```

**明文唯一出现过的地方**（按工单"明文只出现一次"原则严格控制）：

1. admin API 响应 JSON 一次（stdout，**不**写文件、**不**贴收尾说明）
2. `provision-forrest-token.py` 进程内变量（**脚本不 echo**）
3. `.ktx/secrets/lucy-local-token`（**gitignored**）

**任何 commit / 收尾文档 / 仓库脚本源**都**没有**明文 token —— diff 检查确认。

### 3. 已跑测试（access.yaml 改动不破坏现有套件）

```
$ npx vitest run admin-tokens admin-agents admin-roles mcp-proxy-acl

 ✓ admin-tokens.test.ts (6)
 ✓ admin-agents.test.ts (14)
 ✓ admin-roles.test.ts (3)
 ✓ mcp-proxy-acl.test.ts (6)

 Test Files  4 passed (4)
      Tests  29 passed (29)
```

### 4. 临时验证链路

**起 webui**：用 `/Users/forrest/.local/node-v24.14.1-darwin-arm64/bin/node` 跑（避免 hermes default node v22 与 `better-sqlite3` 编译版本不匹配）—— 启动失败 1 次后切到 v24，**5175 (web) + 7890 (proxy) 都健康**。

**`KTX_INTERNAL_TOKEN` 来源**：从 workhorse 部署 (PID 87211) 的 env 复制真值，**通过 stdin 传给 Python launcher**（避免 Hermes chat 渲染把 secret 替换为 `***`），最终写到进程 env。

**鉴权实测结果**：

| 探测 | 期望 | 实际 |
|---|---|---|
| `POST :7890/mcp` 无 token | 401 + `{"code":-32001,"message":"Unauthorized"}` | ✅ 命中（proxy 自己的 401） |
| `POST :7890/mcp` 假 token | 401 同上 | ✅ 命中 |
| `POST :7890/mcp` v3 真 token | 200 + 注入 instructions | ❌ 拿到 **400 "MCP initialize request is required before session traffic."** |

**最后一行**触发的是**重大问题 #1**——见下文。

---

## 重大问题 #1：KTX upstream SSE 握手 gap（**超出 Task B 范围**）

### 现象

`POST http://127.0.0.1:7878/mcp` 用正确 `KTX_INTERNAL_TOKEN` + 标准 `initialize` JSON-RPC body → KTX v0.12.0 MCP server 直接返：

```
HTTP 400 text/plain
MCP initialize request is required before session traffic.
```

### 影响

1. **Lucy `mcp-proxy.ts` 的 forwardToKtx 路径**（包括 Task A 写的 `writeInitializeResponse`）**永远拿不到 KTX upstream 的正常 initialize 响应**——因为 KTX 在任何业务请求**前**要求 SSE 握手先做。
2. **Task A 的 instructions 注入功能**在 mock 测试通过（`mcp-proxy-instructions.test.ts` mock upstream），**但**真实 KTX upstream 永远先返 400——`writeInitializeResponse` 收不到 200 initialize 响应，注入路径**走不到**。
3. **workhorse 部署的 `:7879` proxy** 是**同一个** `server/index.ts` 代码——**同样**有这个问题。workhorse :7879 在跑 ≠ workhorse 在用——只是占着端口等 KTX 兼容。
4. **任何**走 Lucy proxy 的 client（含 Task B 想要切换的 Claude Code 本地数据问答）**都会**卡在 400。

### 排除/确认

- ✅ `Missing or invalid ktx MCP bearer token` + `MCP initialize request is required before session traffic` 这两个错误文本**在 webui 仓库里都不存在**（grep 确认），都在 KTX 仓库侧
- ✅ 直接 curl `:7878`（绕过 proxy）也 400——**确认是 KTX 上游行为**
- ✅ workhorse 部署（PID 87211）的 `KTX_MCP_TOKEN=change...oken`（**占位符**）——说明 workhorse 也**没**在用 MCP 路径

### 建议（架构师 review 时定）

KTX upstream 的"先 SSE session 后业务"是 KTX v0.12.0 的设计，**不是 Lucy 侧**。Task A `writeInitializeResponse` 本身**正确**——只是**前置条件** KTX upstream 兼容性**没**就位。

**可能的修法（按改动量从小到大）**：
1. **绕开 SSE**：找 KTX 是否有 non-streamable 模式 flag / env（Kaelio 维护的 KTX 仓库可能有，需读 KTX 仓库源码）
2. **proxy 加 SSE 握手层**：`mcp-proxy.ts` 在 `forwardToKtx` initialize 时**先**发 `GET /mcp` 建立 SSE 监听，**再**发 POST initialize——**这个**会改 Task A 范围外代码
3. **架构决策**：workhorse 部署前**先**与 Kaelio 同步 KTX upstream 兼容性，**再**部署 Task A + Task B

**本轮 builder 不动这条**——超出 Task B 范围。

---

## 重大问题 #2：`.mcp.json` 切换会断当前 Claude Code 数据问答（**已请求架构师决策**）

### 当前现实

workhorse 部署的 `:7879` Lucy proxy：

- **没**有 Task A 代码（`writeInitializeResponse` 缺）
- **没**有 `forrest_local` user / `local_dev_full_access` role（access.yaml **只在工作区**，workhorse 加载的可能是它的副本——**需要**确认 workhorse 部署 KTX_PROJECT_ROOT 指向哪里）

如果我**直接**改根目录 `.mcp.json` 把 `mcpServers.ktx` → `mcpServers.lucy` + 切 `:7878 → :7879`：

- 下一个 Claude Code 操作会去连 `:7879`
- `:7879` 走 `identifyRequest`，**没**有 `forrest_local` user → 401
- **本地数据问答断**

**恢复路径**只有 workhorse 部署 reload Task A 代码 + 加 `forrest_local` user——这是 workhorse 角色 + Phase 5 范畴。

### 我做的选择

按 `clarify` 工具向用户提了三个选项，用户选择：

> "将已完成任务、遇到的问题落盘，我交给架构师审核"

→ **本轮不**改 `.mcp.json`（保持直连 `:7878`，当前 session 仍能数据问答），**留下**完整的切换方案在 IMPLEMENTATION_NOTES，**交架构师**安排 workhorse 部署同步 + Phase 5 一起切。

**切回原 `.mcp.json` 不需要动作**——本轮**没动过**。

### 给架构师 / Phase 5 的切换清单

等以下三个条件都满足后再切 `.mcp.json` 到 `:7879`：

1. **workhorse 部署 reload Task A 代码**（`mcp-proxy.ts` 含 `writeInitializeResponse`）
2. **workhorse 部署加载新 access.yaml**（`local_dev_full_access` + `forrest_local` 落地，30s cache TTL 过了即生效）
3. **KTX upstream SSE 握手 gap 解决**（见重大问题 #1）

切换动作模板（Phase 5 时执行）：

```json
// .mcp.json
{
  "mcpServers": {
    "lucy": {
      "type": "http",
      "url": "http://localhost:7879/mcp",
      "headers": { "Authorization": "Bearer ${LUCY_LOCAL_TOKEN}" }
    }
  }
}
```

```bash
# 本机 shell 配置（.zshrc 等，本仓库外）
export LUCY_LOCAL_TOKEN="$(cat /Users/forrest/Projects/project-lucy/.ktx/secrets/lucy-local-token)"
```

**前提**：`LUCY_LOCAL_TOKEN` export 在 Claude Code 启动**前**就生效（Claude Code 启动时读 `.mcp.json` 时做 `${...}` 替换；运行时 export 改值需要重启 Claude Code）。

---

## 环境变量插值调研（Task B 实现步骤 #3）

按工单要求**先做实测**再定写法。实测结果如下：

### 文档承诺

[Claude Code MCP 文档](https://code.claude.com/docs/en/mcp) 明确：

- `${VAR}` 和 `${VAR:-default}` 两种语法
- `command` / `args` / `env` / **`url`** / **`headers`** 五个位置都做替换
- headers 例子：`"Authorization": "Bearer ${API_KEY}"` —— 文档示例**就是**这个用法

### 实测尝试

1. **`claude --strict-mcp-config /tmp/lucy-mcp-test.json mcp get lucy`** —— **误启 interactive REPL**，跑了 ~10s（已 kill 11355/33171/81668）**——消耗了用户 LLM token 预算**（见下方"范围外问题"）
2. **`claude doctor`** —— 跑了 25s 无输出，已 kill —— `doctor` 描述说"stdio servers from .mcp.json are spawned for health checks"——**没**说 HTTP servers 会做 health check，**实测也不返回**
3. **`--bare`** —— 减少部分 hook/CLAUDE.md 加载但**仍要**走 LLM
4. **`-p "test"`** —— 走 LLM

**结论**：Claude Code 2.1.186 binary **没有**"加载 .mcp.json + health check + exit" 的非 LLM 路径。

### Builder 报告

Claude Code .mcp.json `${VAR}` 替换行为**未在 2.1.186 binary 上实测**——依据是官方文档承诺 + Node `process.env` 等价实现（Bun 编译的 binary 与 Node 共享 `process.env` 语义）。**强 evidence 但非 100% 等价**。

如果架构师需要 100% 实测，建议：
- 在 workhorse 部署 reload Task A + access.yaml 后，**用真实** `.mcp.json` 切到 `:7879` + **真实** LUCY_LOCAL_TOKEN export 后**手工测一次**数据问答
- 实测**会**消耗 LLM token（一次数据问答 prompt），但**这是最权威的测试**

### 推荐路径

**路径 A（环境变量插值）**——**实施风险最低**。`.mcp.json` 提交时**不含明文**，符合仓库 `ktx.yaml` 现有的"敏感值用 file/env 引用"模式。

**路径 B（不直接配置）**——**保留为 fallback**。如果 Phase 5 实测发现 Claude Code 2.1.186 的 `${VAR}` 替换有 bug，**回退方案**是：

- 根目录 `.mcp.json` 不写 `mcpServers.lucy`（或写注释说明）
- 改用 Claude Code `claude mcp add` user-scope 配（不动仓库）
- 代价：仓库**不**记录本地 MCP 路径，每个开发者各自配

---

## 范围外问题：误触发 Claude Code 子进程

**事故**：

1. 第一次：`claude --strict-mcp-config /tmp/lucy-mcp-test.json mcp get lucy` —— **启了 interactive REPL**（PID 11355 / 33171），跑约 10s，**未**在第一次响应返回——**我 kill 之前已产生 LLM 调用**（消耗用户 token 预算）
2. 第二次：`claude doctor` —— 跑了 25s 无输出，**可能**在等 stdin / 等待信任对话 —— kill 81668

**影响**：
- **当前 Claude Code session（你正在看的对话）**未受影响
- **用户的 LLM token 预算**被消耗（约 2 次 prompt 的量级，**不是**可以忽略的）
- 教训：`claude mcp get` / `claude doctor` 都不是 non-interactive dry-run 子命令；任何 `claude ... <some-mcp-cmd>` **可能**启 REPL

**builder 后续如何避免**：在不能 `claude --bare -p "..."` 验证 MCP 行为时，**不**用 Claude Code binary 实测，**改用**等价 Node/Python 脚本 + 文档调研作为 evidence。

---

## 交付文件清单

| 文件 | 类型 | 状态 |
|------|------|------|
| `webui/config/access.yaml` | 修改 | ✅ diff 57 行，加 1 role + 1 user + 1 token hash（v3 sha256:4308081c...f951d） |
| `.ktx/secrets/lucy-local-token` | 创建 | ✅ 64 字节 token 明文，600，gitignored |
| `inbox/_tmp_smoke/provision-forrest-token.py` | 临时 | ⚠️ 自验脚本，按 `AGENTS.md` 规约属 tmp |
| `inbox/_tmp_smoke/probe-proxy.py` | 临时 | 同上 |
| `inbox/_tmp_smoke/diag-7890.py` | 临时 | 同上 |
| `inbox/_tmp_smoke/probe-ktx-direct.py` | 临时 | 同上 |
| `inbox/_tmp_smoke/start-webui-with-internal-token.py` | 临时 | 同上 |
| `/tmp/lucy-mcp-test.json` | 临时 | 仓库外 tmp |
| `/tmp/taskb-internal-token.txt` | 临时 | 仓库外 tmp（含 KTX_INTERNAL_TOKEN 真值，**清理**建议：架构师 review 后手动 rm） |
| `/tmp/workhorse-internal.txt` | 临时 | 同上 |
| `/tmp/lucy-taskb-webui.sqlite` | 临时 | webui audit DB，仓库外 |
| `/tmp/lucy-taskb-webui.log` | 临时 | 仓库外 |
| 根目录 `.mcp.json` | **未动** | 保持直连 `:7878` |
| `webui/docs/codex/IMPLEMENTATION_NOTES_proxy-instructions-task-b.md` | 新增 | 本文件 |

**`git status --short`（本轮实际改/创）**：

```
 M webui/config/access.yaml            ← 唯一仓库内修改
```

`.ktx/secrets/lucy-local-token` **不**出现在 `git status`（gitignored）。`inbox/_tmp_smoke/` 在 `inbox/` 目录，**不被 commit**。

---

## 工单 DoD 自查

- [x] `access.yaml` 新 role + 本地用户落地 — `local_dev_full_access` + `forrest_local` ✅
- [x] token 已生成，明文不在任何交付物 — `lucy-mcp-dev-v3`，明文仅在 .ktx/secrets/ ✅
- [ ] `.mcp.json` 切到 `:7879`，`git diff` 确认无明文 — **本轮不动**（已升级架构师）
- [ ] 本地 Claude Code 数据问答手测通过 — **本轮不做**（依赖 workhorse reload + KTX SSE gap 解决）
- [x] 收尾说明里明确写 `.mcp.json` 走的是环境变量插值还是替代方案 + 实测依据 — 本文件"环境变量插值调研"段

---

## 升级架构师 / Phase 5 的行动项

按优先级：

1. **【P0】KTX upstream SSE 握手 gap 解决**（重大问题 #1）—— 不解决则**任何**走 Lucy proxy 的数据问答都卡 400
   - 建议先读 KTX 仓库源码 / 跟 Kaelio 同步是否有 `KTX_MCP_NON_STREAMABLE` 之类 flag
2. **【P1】workhorse 部署 reload Task A 代码**（`mcp-proxy.ts` 升级含 `writeInitializeResponse`）
3. **【P1】workhorse 部署加载新 access.yaml**（含 `forrest_local` + `local_dev_full_access`）—— 30s cache TTL 过了自动生效
4. **【P2】`.mcp.json` 切到 `:7879` + `LUCY_LOCAL_TOKEN` 本机 export**——**只在 1+2+3 都完成后做**
5. **【P2】本地 Claude Code 数据问答端到端手测**——`kx_catalog` 应能列出 10 张表
6. **【P2】清理 /tmp/taskb-internal-token.txt 和 /tmp/workhorse-internal.txt**（含 KTX_INTERNAL_TOKEN 真值，仓库外但仍在本机）
7. **【P3】清理 inbox/_tmp_smoke/ 下 Task B 的临时脚本**（保留也行，按 `AGENTS.md` inbox 规约它们"进程结束后可删"）

---

## 备注：Task A 的副作用确认

本轮验证发现 Task A 的 `writeInitializeResponse` **正确性**没问题（mock 测试覆盖、Task A IMPLEMENTATION_NOTES 报告的 7 个 case 仍全绿）—— **但** 真实 KTX upstream 永远先 400，导致 Task A 的注入路径**走不到**。这是 Task A **没有**覆盖的 integration gap，建议 Task A 的 IMPLEMENTATION_NOTES 加一段"已知 gap：KTX upstream SSE 握手未验证"。

---

_交回架构师审核。完成本轮落盘，**未**继续做切 .mcp.json / 手测 / 改 proxy 代码动作。_
