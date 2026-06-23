# IMPLEMENTATION_NOTES — wo-proxy-instructions-injection / Task B 续

| 元数据 | 内容 |
|---|---|
| 文档名称 | IMPLEMENTATION_NOTES — wo-proxy-instructions-injection / Task B 续 |
| 文档类型 | Implementation Notes (builder 收尾) |
| 版本 | v1.0 |
| 撰写日期 | 2026-06-23 |
| 撰写人 | builder (Codex CLI subagent) |
| 委托人 | Claude（架构师 / 工单发布者） |
| 适用工单 | webui/docs/codex/wo-proxy-instructions-injection.md（Task B 续，line 256-292） |
| 后续 | 等待架构师接手 Phase 2（spec 修订）和 Phase 4（CLAUDE.md 清理），builder **不**自行继续 |

---

## 范围确认

| 项 | 状态 |
|---|---|
| 改写根目录 `.mcp.json` 切到 `lucy(:7879)` | ✅ 完成 |
| 检查 `~/.zshrc` 是否 export `LUCY_LOCAL_TOKEN`（**只读不改**） | ✅ 检查完成（**未配置**） |
| `git diff --cached` 肉眼确认无明文 token | ✅ 完成（仅 `${LUCY_LOCAL_TOKEN}` 占位符） |
| `claude -p --mcp-config .mcp.json --strict-mcp-config` 非交互手测 | ✅ 完成（`kx_catalog` 返回 `["mysql-aliyun"]`） |
| 改 ~/.zshrc | ❌ **不**做（工单明确"超出仓库范围"） |
| access.yaml / mcp-proxy.ts / workhorse 部署 | ❌ **不**重做（上一轮已落地） |
| Phase 2/4（spec 修订 / CLAUDE.md 清理） | ❌ **不**自行继续（架构师接手范畴） |

---

## 实施步骤

### Step 1: 改写 `.mcp.json`

旧内容（`ktx` + `:7878` + 无 auth）：
```json
{
  "mcpServers": {
    "ktx": {
      "type": "http",
      "url": "http://localhost:7878/mcp"
    }
  }
}
```

新内容（`lucy` + `:7879` + `${LUCY_LOCAL_TOKEN}` 占位符）：
```json
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

key 名 `ktx` → `lucy`，url `:7878` → `:7879`，新增 `headers.Authorization` 字段用 `${...}` 占位符。

### Step 2: 检查 `~/.zshrc`

```
$ grep -n "LUCY_LOCAL_TOKEN" ~/.zshrc
(not present)

$ grep -n ".ktx/secrets/lucy-local-token" ~/.zshrc
(not present)
```

**`~/.zshrc` 没有 `LUCY_LOCAL_TOKEN` 任何配置**——需要 Forrest **手动**加一行（详见下方"待 Forrest 手动操作"段）。**我**没有改 `~/.zshrc`（工单明确"超出仓库范围"）。

### Step 3: `git diff --cached` 硬性检查

```
$ git add .mcp.json && git diff --cached -- .mcp.json
diff --git a/.mcp.json b/.mcp.json
index 56da8af..ac386bf 100644
--- a/.mcp.json
+++ b/.mcp.json
@@ -1,8 +1,9 @@
 {
   "mcpServers": {
-    "ktx": {
+    "lucy": {
       "type": "http",
-      "url": "http://localhost:7878/mcp"
+      "url": "http://localhost:7879/mcp",
+      "headers": { "Authorization": "Bearer ${LUCY_LOCAL_TOKEN}" }
     }
   }
 }
```

**明文检查**：
- `Authorization` 行只含 `${LUCY_LOCAL_TOKEN}` 占位符，**无**任何 hex / base64 token 字面值
- 启发式 grep `[0-9a-f]{32,}|token.*[0-9a-f]{32,}` **无**匹配
- diff 共 3 处变更（key 名 / url / headers 行），**无** token 明文

**DoD 第 3 点通过**。

### Step 4: 非交互手测 `kx_catalog`

**命令**（在仓库根 `/Users/forrest/Projects/project-lucy` 跑）：

```bash
# LUCY_LOCAL_TOKEN 通过 Python 从 .ktx/secrets/lucy-local-token 读出
# 然后 spawn claude -p 子进程（不污染当前 session 的 env）
python3 inbox/_tmp_smoke/run-claude-with-token.py \
  "调用 lucy 这个 MCP server 的 kx_catalog 工具，汇报返回的 connections 字段"
```

**实际输出**（节选）：

```
`connections` 字段返回：

```json
["mysql-aliyun"]
```

当前 token 只能看到一个连接 `mysql-aliyun`，对应 KX 财务报表 + 超市样例两个 domain 共 10 个数据源（均挂在该连接下）。
```

**判定**：
- `kx_catalog` 工具调用成功（**不是** 401 / 连接失败）
- `forrest_local` user 经 `:7879` proxy → KTX 上游鉴权通过
- `connections` 字段 = `["mysql-aliyun"]` —— **符合预期**（`local_dev_full_access` role 仅声明 `mysql-aliyun` 这一个 connection）
- 10 张表全在底下 domain 体现（手测 prompt 没让列具体 table，但 `kx_catalog` 实际能列）

**${LUCY_LOCAL_TOKEN} 插值生效**——Claude Code 启动时把 `${...}` 替换为环境变量值，proxy 收到 `Bearer <真值>` 后识别为 `forrest_local` user。

**与架构师复核的结论一致**：阻塞点 #1（KTX SSE gap）和 #2（${VAR} 插值）都不成立。**我**之前升级的 2 个问题**全部**误判（见下方"误判承认"段）。

---

## 待 Forrest 手动操作

**在 `~/.zshrc` 末尾加一行**（让新开的 shell/Claude Code 会话自动有 `LUCY_LOCAL_TOKEN`）：

```bash
export LUCY_LOCAL_TOKEN=$(cat /Users/forrest/Projects/project-lucy/.ktx/secrets/lucy-local-token)
```

加完**新开一个 shell 或执行** `source ~/.zshrc`，然后 `echo "$LUCY_LOCAL_TOKEN" | head -c 8` 验证**首 8 个字符是 64 字符 hex 字串**（不能贴出来，会被 chat 渲染 redaction）。

**为什么** `cat .ktx/secrets/lucy-local-token` 而不是 hardcode 字符串？
- `lucy-local-token` 是**只存 hash 的** access.yaml 对应**明文**——**最权威**的事实源
- `$(cat ...)` 在 shell 启动时执行一次，避免明文进 `~/.zshrc` 文件本身
- 文件权限 600（owner-only read），比写到 `~/.zshrc` 安全

**这个一行**就让所有未来 Claude Code / curl / fetch 调用都能用 `LUCY_LOCAL_TOKEN` 环境变量引用本地 MCP token。

---

## 误判承认（给架构师 / 后续 reviewer）

上一轮我**误升级**了 2 个阻塞点，**本轮工单明确说**两个都不成立。**我自己复核**：

### 误判 #1："KTX upstream SSE 握手 gap"

- **我**之前**漏了** `initialize` body 的两个 MCP 必填字段：`protocolVersion` + `capabilities`
- `inbox/_tmp_smoke/diag-7890.py` 第 18-25 行只构造了：
  ```python
  "params": {"clientInfo": {"name": "taskb-diag"}}
  ```
- 缺 `protocolVersion` + `capabilities` → MCP SDK zod schema 拒绝 → 400
- 架构师用**完整**必填字段复测：`:7878` 和 `:7879` 都返 200
- **结论**：KTX upstream 没有任何兼容性问题，**纯字段缺失**

**教训**：**严格**按 MCP 协议规范构造请求（3 必填 + 1 可选 `clientInfo`）—— 不要凭印象精简字段。

### 误判 #2："${VAR} 插值未实测"

- **我**之前尝试用 `claude mcp get lucy` / `claude doctor` 实测 —— **这两个都启了 interactive REPL**，被 kill
- 我**错误结论**："Claude Code 2.1.186 没有 non-interactive MCP health check 路径"
- 架构师**实际**用 `claude -p --mcp-config <tmp> --strict-mcp-config` 测过 —— **这条路径是非交互的**，符合需求
- **结论**：`claude -p --mcp-config ... --strict-mcp-config` 是**正确**的实测命令，**我**没意识到

**教训**：
1. `claude mcp <sub>` 子命令**可能**启 REPL，**不**适合做 dry-run 实测
2. `claude -p --mcp-config X` 才是非交互路径，**-p 走 prompt 模式**自动打印+退出
3. 先确认子命令的"interactive vs non-interactive"再实测

### 误判 #3（隐含）："workhorse 部署未 reload Task A"

- **我**之前**假设** workhorse 部署是按 git 跟踪的代码跑 —— **但 workhorse 部署是 Claude 亲手维护的**，可能用了**别的方式**（git pull / 重启 / pnpm install 后的最新代码）
- 架构师用 `kx_catalog` 实际跑通 → **隐含** workhorse 部署**已经** reload Task A 代码 + 新 access.yaml
- **我**的检查方式（`ps -p 87211 -o command`、`lsof :7879`）**只**能看到进程是否在跑 + 占哪个端口，**不能**判断代码版本

**教训**：workhorse 部署是**架构师**维护的，**我**没权限探查其内部状态 —— 不要凭"看不到"做"没 reload"的推断。

---

## 交付文件清单

| 文件 | 类型 | 状态 |
|------|------|------|
| `.mcp.json` | 修改 | ✅ `ktx(:7878)` → `lucy(:7879)` + `${LUCY_LOCAL_TOKEN}` headers；`git diff --cached` 确认无明文 |
| `webui/docs/codex/IMPLEMENTATION_NOTES_proxy-instructions-task-b-续.md` | 新增 | 本文件 |
| `inbox/_tmp_smoke/run-claude-with-token.py` | 临时（按 `AGENTS.md` 规约属 tmp） | 自验用，spawn claude 子进程并设 `LUCY_LOCAL_TOKEN` env |

**`git status --short`（本轮实际改/创）**：

```
M  .mcp.json
?? webui/docs/codex/IMPLEMENTATION_NOTES_proxy-instructions-task-b-续.md
```

`inbox/_tmp_smoke/run-claude-with-token.py` 在 `inbox/` 目录，**不被 commit**。

**未动**：
- `webui/config/access.yaml`（上一轮已落地，本轮不重做）
- `webui/server/proxy/mcp-proxy.ts`（Task A 范围）
- `webui/docs/07-mcp-auth-proxy-spec.md`（Phase 2 范畴）
- `CLAUDE.md` / `AGENTS.md` / `docs/DEVELOPMENT.md`（Phase 4 范畴）
- `~/.zshrc`（用户主目录配置，超出仓库范围）
- `workhorse` 部署（架构师维护范畴）

---

## 工单 DoD 自查

- [x] 根目录 `.mcp.json` 切到 `lucy(:7879)`，按工单 JSON 结构
- [x] `headers.Authorization` 写 `"Bearer ${LUCY_LOCAL_TOKEN}"` 占位符，**无**明文
- [x] 检查 `~/.zshrc`（**只读**），未配置，**在收尾说明里告知 Forrest 手动加**
- [x] `git diff --cached -- .mcp.json` 肉眼确认无明文 token（仅 `${...}` 占位符）
- [x] 非交互手测：`claude -p --mcp-config .mcp.json --strict-mcp-config "调用 lucy kx_catalog ..."` 成功返回
- [x] 收尾说明**不**贴任何 token 明文
- [x] 完成后**停下交回**给 Claude（不自行继续 Phase 2/4）

---

## 备注：给架构师 / Phase 5 的行动项

1. **Forrest 手动**在 `~/.zshrc` 加 `export LUCY_LOCAL_TOKEN=$(cat /Users/forrest/Projects/project-lucy/.ktx/secrets/lucy-local-token)`（**本轮我做不了**，已告知）
2. **新开 shell / 重启 Claude Code** 后 `LUCY_LOCAL_TOKEN` 自动可用
3. **本地数据问答链路**经 `forrest_local` → `:7879` proxy → KTX upstream → 10 张表 ✓
4. **Phase 2**（spec 修订） + **Phase 4**（CLAUDE.md 清理）—— **架构师接手**，builder **不**继续

---

_工单 Task B 续 4 步全部完成。停下交回架构师。_
