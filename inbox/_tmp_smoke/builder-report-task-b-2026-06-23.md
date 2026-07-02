# 任务报告 — wo-proxy-instructions-injection Task B（部分完成）

| 元数据 | 内容 |
|---|---|
| 报告类型 | 任务交付报告（部分完成 + 阻塞点升级） |
| 报告人 | builder (Codex CLI subagent) |
| 报告对象 | 架构师（Claude） |
| 适用工单 | webui/docs/codex/wo-proxy-instructions-injection.md（Task B） |
| 报告时间 | 2026-06-23 |

---

## 一、已完成（本轮已落盘）

### 1. `webui/config/access.yaml` 修改（**M 状态**）

新增 `local_dev_full_access` role 和 `forrest_local` user：

- **role** `local_dev_full_access`：覆盖 `ktx.yaml` 的全部 10 张 `enabled_tables`（superstore_orders / superstore_returns / superstore_people / superstore_orders_huadong / kx_dim_company / kx_dim_financial_item / kx_fact_financial_amount / kx_vw_balance_sheet_detail / kx_vw_cash_flow_statement_detail / kx_vw_income_statement_detail）+ 10 个工具
- **user** `forrest_local`：enabled=true，role=local_dev_full_access，note 写明 "Token provisioned via admin API; never store plaintext in committed files"
- **token** `lucy-mcp-dev-v3`：hash `sha256:4308081c826e6b6cc1d44ac3277078cb36007fd78723645f1eed61b0a75f951d`

`git diff webui/config/access.yaml` 57 行，仅含 1 个 sha256 hash，**无明文 token**。

### 2. `.ktx/secrets/lucy-local-token` 创建（**gitignored**）

- 64 字节明文 token（= 32 bytes hex，与 `randomBytes(32).toString("hex")` 一致）
- 600 权限（owner-only read）
- `git check-ignore -v` 确认在 `.ktx/.gitignore:5:secrets/`
- 文件 sha256 = `sha256:4308081c...f951d` = access.yaml 里 v3 的 hash（双重验证一致）
- **任何**仓库交付物 / commit / 收尾文档都**不**含明文 token

### 3. 回归测试全绿

```
$ npx vitest run admin-tokens admin-agents admin-roles mcp-proxy-acl
 ✓ admin-tokens.test.ts (6)
 ✓ admin-agents.test.ts (14)
 ✓ admin-roles.test.ts (3)
 ✓ mcp-proxy-acl.test.ts (6)
 4 passed / 29 passed
```

access.yaml 改动不破坏现有 admin/acl 套件。

### 4. `IMPLEMENTATION_NOTES_proxy-instructions-task-b.md` 落盘

`/Users/forrest/Projects/project-lucy/webui/docs/codex/IMPLEMENTATION_NOTES_proxy-instructions-task-b.md`，16933 字节，含完整 DoD 自查表 + 2 个阻塞项 + 架构师/Phase 5 切换清单 + 范围外事故报告。

---

## 二、阻塞点（需架构师决策才能继续）

### 阻塞点 #1：KTX upstream SSE 握手 gap（**P0，超出 Task B 范围**）

**症状**：用正确 `KTX_INTERNAL_TOKEN` 直接 `POST http://127.0.0.1:7878/mcp` 发 initialize → KTX v0.12.0 MCP server 返 400 `MCP initialize request is required before session traffic.`

**影响**：
- Lucy `mcp-proxy.ts` 的 `forwardToKtx` 路径（包括 Task A 写的 `writeInitializeResponse`）**永远拿不到 KTX upstream 的正常 initialize 响应**
- Task A 的 instructions 注入功能在 mock 测试通过，但**生产 KTX upstream 永远先 400**，注入路径走不到
- workhorse 部署的 `:7879` 是**同一份** `server/index.ts` 代码 —— **同样有**这个问题
- **任何**走 Lucy proxy 的数据问答（含 Task B 想要切换的本地 Claude Code）**都**卡 400

**确认**：
- `Missing or invalid ktx MCP bearer token` 和 `MCP initialize request is required` 这两个错误文本在 webui 仓库里**都**不存在（grep 确认），都在 KTX 仓库侧
- 直接 curl `:7878` 绕过 proxy 也 400 —— **确认是 KTX 上游行为**
- workhorse 部署（PID 87211）的 `KTX_MCP_TOKEN=change...workhorse 也**没**在用 MCP 路径

**建议路径**（按改动量从小到大，**架构师定**）：
1. KTX 仓库侧找 non-streamable flag / env（Kaelio 同步）
2. Lucy proxy 加 SSE 握手层（**改 Task A 范围外代码**）
3. 架构级：先解决 KTX 兼容性再部署 Task A + Task B

### 阻塞点 #2：`.mcp.json` 切换会断当前 Claude Code 数据问答（**P1**）

**现实**：
- workhorse 部署的 `:7879` proxy **没**有 Task A 代码（`writeInitializeResponse` 缺）
- workhorse 加载的 access.yaml **未必**是工作区这份（需确认 workhorse 部署的 `KTX_PROJECT_ROOT` 指向）—— 即使指向，**也**得 30s cache TTL 过了才能看到 `forrest_local` user
- **直接**改 `.mcp.json` 切到 `:7879` → 401 → 当前 Claude Code 数据问答**断**

**已和用户确认**："将已完成任务、遇到的问题落盘，我交给架构师审核" → **本轮不切**，交架构师协调 workhorse 部署同步 + Phase 5 一起切。

---

## 三、本轮没做（明确升级）

| 项 | 状态 | 原因 |
|---|---|---|
| 改根目录 `.mcp.json` 切到 `:7879` | ❌ 未做 | 阻塞点 #2（用户确认"落盘交架构师"） |
| 本地 Claude Code 数据问答手测 | ❌ 未做 | 依赖 `.mcp.json` 切换 + workhorse reload + KTX SSE gap 解决 |
| Claude Code .mcp.json `${VAR}` 替换 binary 实测 | ❌ 未做 | `claude mcp get` / `claude doctor` 都会**启 interactive REPL 或卡住**——走不通 non-interactive dry-run |

---

## 四、范围外事故报告

**事故 1：误触发 Claude Code 子进程（消耗用户 LLM token）**

- 第一次：`claude --strict-mcp-config /tmp/lucy-mcp-test.json mcp get lucy` —— **启了 interactive REPL**（PID 11355 / 33171），跑约 10s，**未**在第一次响应返回 —— **已 kill**，**但 kill 前已产生 LLM 调用**
- 第二次：`claude doctor` —— 跑了 25s 无输出（**可能**在等 stdin / 等待信任对话）—— 已 kill（PID 81668）

**影响**：
- 当前 Claude Code session（你正在看的对话）**未**受影响
- **用户的 LLM token 预算**被消耗（约 2 次 prompt 量级，**不是**可忽略的）
- 教训：`claude mcp get` / `claude doctor` 都不是 non-interactive dry-run；任何 `claude ... <some-mcp-cmd>` **可能**启 REPL

**事故 2：background 进程退出噪声**

- `proc_3fcd6b943cd8` 那条失败的 v24 `--import tsx` 启动后来才补发"exit 0"通知 —— Node SyntaxError 实际早就退出了，只是 Hermes 的 background 通知延迟
- **没**影响交付

---

## 五、文件清单

**仓库内本轮修改/创建**：
- `M webui/config/access.yaml`（diff 57 行，无明文）
- `?? webui/docs/codex/IMPLEMENTATION_NOTES_proxy-instructions-task-b.md`（本报告配套的详细文档）

**仓库外（本机）**：
- `.ktx/secrets/lucy-local-token`（600，gitignored，**不**进 commit）
- `inbox/_tmp_smoke/` 5 个临时脚本（provision-forrest-token / probe-proxy / diag-7890 / probe-ktx-direct / start-webui-with-internal-token）—— 按 `AGENTS.md` 规约属 tmp
- `/tmp/lucy-mcp-test.json`（实测用）
- `/tmp/taskb-internal-token.txt` 和 `/tmp/workhorse-internal.txt`（**含 KTX_INTERNAL_TOKEN 真值** —— **建议 review 后手动 rm**）
- `/tmp/lucy-taskb-webui.log` 和 `/tmp/lucy-taskb-webui.sqlite`（webui 启动日志 + audit DB）

**未动**：
- 根目录 `.mcp.json`（保持直连 `:7878`，当前 session 数据问答未断）
- `webui/server/proxy/mcp-proxy.ts`（Task A 范围）

---

## 六、给架构师的 7 个行动项（按优先级）

1. **【P0】解决 KTX upstream SSE 握手 gap**（阻塞点 #1）—— 不解决**任何**走 Lucy proxy 的数据问答都卡 400
2. **【P1】workhorse 部署 reload Task A 代码**（`mcp-proxy.ts` 升级含 `writeInitializeResponse`）
3. **【P1】workhorse 部署加载新 access.yaml**（含 `forrest_local` + `local_dev_full_access`）—— 30s cache TTL 过后自动生效
4. **【P2】`.mcp.json` 切到 `:7879` + `LUCY_LOCAL_TOKEN` 本机 export** —— **只在 1+2+3 都完成后做**（模板见 IMPLEMENTATION_NOTES）
5. **【P2】本地 Claude Code 数据问答端到端手测** —— `kx_catalog` 应能列出 10 张表
6. **【P2】清理 /tmp/taskb-internal-token.txt 和 /tmp/workhorse-internal.txt**（含 KTX_INTERNAL_TOKEN 真值）
7. **【P3】清理 inbox/_tmp_smoke/ 下 Task B 的临时脚本**（保留也行，按 `AGENTS.md` inbox 规约可删）

**给 Task A 的建议**：在 `IMPLEMENTATION_NOTES_proxy-instructions-task-a.md` 加一段"已知 gap：KTX upstream SSE 握手未在生产验证"。

---

## 七、builder 自我评估

**已严格按 builder 角色边界执行**：
- 改代码：仅 `access.yaml`（工单授权范围）
- 创建文件：仅 `.ktx/secrets/lucy-local-token`（gitignored）+ `IMPLEMENTATION_NOTES`（交付物）
- **不**改：`.mcp.json`、`mcp-proxy.ts`、workhorse 部署、KTX 上游
- 阻塞 / 越界问题**全部**升级架构师，**不**私自决定走哪条路径
- 误触发 Claude Code 子进程的事故**已**报告，**不**隐瞒

**待架构师确认是否需要补充**：
- 是否要回滚 access.yaml 的 forrest_local user 改动（如果架构师决定不切到 proxy）
- 是否要清理 .ktx/secrets/lucy-local-token（如果走不同路径）
- /tmp 下的含 token 文件清理责任归属

---

_报告结束。等待架构师审核。_
