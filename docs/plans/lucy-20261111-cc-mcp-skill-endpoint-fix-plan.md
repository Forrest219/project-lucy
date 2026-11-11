# Claude Code Skill 通道失效修正 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让本仓库 Claude Code / Codex 默认 `.mcp.json` 指向现行可用的 Lucy 主面 `/mcp`，使 `lucy_skill_search` / `lucy_skill_read` 可真实调用；并用静态门禁 + 本机 CC 取证防止回退到已关闭的 `/mcp/skills`。

**Architecture:** 不复活 legacy `/mcp/skills` passthrough，也不把业务 Skill 改挂到 CC 内置 `Skill` 工具。现行产品合同是：客户端只挂一个 `lucy` HTTP MCP → Proxy `/mcp`；业务 Skill 经 ACL 工具面发现/读取。修正仓库根 `.mcp.json`、对齐误导文档，并加「禁止 `/mcp/skills` 客户端配置」的静态断言与可选 live smoke。

**Tech Stack:** 仓库根 `.mcp.json`；Node 测试（`node --test`）；本机 `/Users/forrest/.local/bin/claude`（`--print` + `stream-json`）；既有 demo Proxy（默认宿主机 `57881→7879`）。

**Evidence (pre-fix):** `inbox/cc-skill-probe/FINDINGS.md` 及同目录 `cc-*.stream.jsonl`。

## Global Constraints

- **不**重新开启 `LUCY_PROXY_SKILLS_PASSTHROUGH` / 客户模式下的 `/mcp/skills`（企业安全整改 T04-3 仍有效）。
- **不**实现尚未落地的独立 `lucy-skills/` MCP server（`docs/specs/lucy-skills-mcp-spec.md` 仍是未收口规划，本计划不把它当交付入口）。
- **不**把 `skills/**` 业务 Skill 注册进 `~/.claude/skills` 冒充「已修复」——那是另一条通道，且绕开 Role ACL。
- Token 只走环境变量插值（`${LUCY_LOCAL_TOKEN}` 或客户侧 `${LUCY_AGENT_TOKEN}`）；明文 token 不得写入仓库。
- 本计划属接入配置 / 文档 / 门禁修复，**不**改 Proxy 业务逻辑；若触及 0.30 运行代码须另获开发授权（本计划默认不改 `webui/server/**` 运行路径）。
- 本地脚本须兼容 stock macOS bash 3.2；新增测试用 `node --test`。

## Design Lock（已选定）

| 选项 | 做法 | 结论 |
|---|---|---|
| A | `.mcp.json` → 单一 `lucy` → `…/mcp` | **采用**（与 `DEVELOPMENT.md` / 系统手册现行接入口径一致） |
| B | 开发态重开 `/mcp/skills` passthrough | **拒绝**（无对象 ACL；上游 server 未交付；与安全整改冲突） |
| C | 导出到 CC 原生 Skill 目录 | **拒绝为本 bug 的主修复**（可另立项；不能替代 MCP ACL 读） |

**URL 默认值：** 仓库主开发路径是 Docker demo，公共 MCP 默认为 `http://127.0.0.1:57881/mcp`（compose：`LUCY_DEMO_PROXY_HOST_PORT` → 容器 `7879`）。宿主直跑 WebUI 时本地改为 `http://127.0.0.1:7879/mcp`。门禁只强制 **pathname = `/mcp`** 且 **禁止 `/mcp/skills`**，不把端口写死为唯一合法值。

---

## File Map

| 文件 | 职责 |
|---|---|
| `.mcp.json` | 仓库默认 CC/Codex MCP 入口（修正目标） |
| `scripts/smoke/mcp-client-config-guard.mjs` | 静态校验 `.mcp.json` 形状 |
| `scripts/smoke/mcp-client-config-guard.test.mjs` | 上述守卫的单测 + 对仓库实文件断言 |
| `scripts/smoke/cc-lucy-skill-probe.mjs` | 可选：本机 CC 对 `lucy_skill_*` 的取证脚本（失败写 inbox） |
| `docs/governance/DEVELOPMENT.md` | 本地接入步骤与 Skills 现状表述对齐 |
| `webui/config/data-qa-instructions.md` | 去掉「等待 lucy-skills MCP」误导句 |
| `docs/specs/lucy-skills-mcp-spec.md` | 在头部加「客户端默认入口」现行口径脚注（不重开实现） |
| `docs/plans/lucy-20261111-cc-mcp-skill-endpoint-fix-plan.md` | 本计划 |

---

### Task 1: 修正仓库根 `.mcp.json`

**Files:**
- Modify: `.mcp.json`
- Test: Task 2 的守卫会锁住形状

**Interfaces:**
- Consumes: 本机 / demo 已签发的 Agent token（经 `${LUCY_LOCAL_TOKEN}`）
- Produces: 单一 server `lucy`，`type: http`，`url` 以 `/mcp` 结尾，`Authorization: Bearer ${LUCY_LOCAL_TOKEN}`

- [ ] **Step 1: 把 `.mcp.json` 改成下列内容（整文件替换）**

```json
{
  "mcpServers": {
    "lucy": {
      "type": "http",
      "url": "http://127.0.0.1:57881/mcp",
      "headers": {
        "Authorization": "Bearer ${LUCY_LOCAL_TOKEN}"
      }
    }
  }
}
```

- [ ] **Step 2: 确认文件中不再出现 `lucy-skills` 或 `/mcp/skills`**

```bash
rg -n 'lucy-skills|/mcp/skills' .mcp.json
```

Expected: 无匹配。

- [ ] **Step 3: 连通性冒烟（demo 已 healthy 时）**

```bash
export LUCY_LOCAL_TOKEN  # 使用本机已有 demo Agent token，勿写入仓库
curl -sS -o /tmp/lucy-mcp-init.json -w '%{http_code}\n' -X POST 'http://127.0.0.1:57881/mcp' \
  -H "Authorization: Bearer ${LUCY_LOCAL_TOKEN}" \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"mcp-json-fix","version":"0"}}}'
```

Expected: HTTP `200`；body 的 `result.instructions` 含 `lucy_skill_read` 或 Governed Domain Skills 段（token 角色已授予 Skill 通道时）。

- [ ] **Step 4: Commit（仅在用户明确要求提交时执行）**

```bash
git add .mcp.json
git commit -m "$(cat <<'EOF'
fix: point repo .mcp.json at Lucy /mcp instead of dead /mcp/skills

EOF
)"
```

---

### Task 2: 静态门禁 — 禁止客户端再指向 `/mcp/skills`

**Files:**
- Create: `scripts/smoke/mcp-client-config-guard.mjs`
- Create: `scripts/smoke/mcp-client-config-guard.test.mjs`
- Modify: `package.json`（仅当仓库已有对应 `smoke:*` 脚本登记习惯时增加一条；否则测试可直接 `node --test` 调用）

**Interfaces:**
- Consumes: 仓库根 `.mcp.json` 文本 / 解析后的对象
- Produces: `assertMcpClientConfig(config) → void`（违规 throw）；`loadRepoMcpJson(repoRoot) → object`

- [ ] **Step 1: 写失败单测（先于实现）**

Create `scripts/smoke/mcp-client-config-guard.test.mjs`:

```js
import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertMcpClientConfig, loadRepoMcpJson } from "./mcp-client-config-guard.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

test("rejects legacy lucy-skills /mcp/skills client entry", () => {
  assert.throws(
    () =>
      assertMcpClientConfig({
        mcpServers: {
          "lucy-skills": {
            type: "http",
            url: "http://localhost:7879/mcp/skills",
            headers: { Authorization: "Bearer ${LUCY_LOCAL_TOKEN}" }
          }
        }
      }),
    /mcp\/skills|lucy-skills/
  );
});

test("accepts single lucy server on /mcp", () => {
  assert.doesNotThrow(() =>
    assertMcpClientConfig({
      mcpServers: {
        lucy: {
          type: "http",
          url: "http://127.0.0.1:57881/mcp",
          headers: { Authorization: "Bearer ${LUCY_LOCAL_TOKEN}" }
        }
      }
    })
  );
});

test("repo .mcp.json passes the guard", () => {
  const cfg = loadRepoMcpJson(repoRoot);
  assert.doesNotThrow(() => assertMcpClientConfig(cfg));
  const lucy = cfg.mcpServers.lucy;
  assert.equal(typeof lucy.url, "string");
  assert.match(lucy.url, /\/mcp$/);
  assert.doesNotMatch(lucy.url, /\/mcp\/skills/);
});
```

- [ ] **Step 2: 跑测确认失败（实现前）**

```bash
node --test scripts/smoke/mcp-client-config-guard.test.mjs
```

Expected: FAIL — `Cannot find module` 或 repo 文件仍含 `/mcp/skills`。

- [ ] **Step 3: 实现守卫**

Create `scripts/smoke/mcp-client-config-guard.mjs`:

```js
import fs from "node:fs";
import path from "node:path";

export function loadRepoMcpJson(repoRoot) {
  const file = path.join(repoRoot, ".mcp.json");
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

export function assertMcpClientConfig(config) {
  if (!config || typeof config !== "object") {
    throw new Error("mcp client config must be an object");
  }
  const servers = config.mcpServers;
  if (!servers || typeof servers !== "object") {
    throw new Error("mcpServers missing");
  }
  for (const [name, server] of Object.entries(servers)) {
    if (name === "lucy-skills") {
      throw new Error("legacy server name lucy-skills is forbidden in repo client config");
    }
    const url = server && typeof server.url === "string" ? server.url : "";
    if (!url) throw new Error(`mcp server ${name} missing url`);
    let pathname;
    try {
      pathname = new URL(url).pathname.replace(/\/+$/, "") || "/";
    } catch {
      throw new Error(`mcp server ${name} has invalid url: ${url}`);
    }
    if (pathname === "/mcp/skills" || pathname.startsWith("/mcp/skills/")) {
      throw new Error(`mcp server ${name} must not target legacy /mcp/skills (got ${url})`);
    }
    if (name === "lucy" && pathname !== "/mcp") {
      throw new Error(`mcp server lucy url pathname must be /mcp (got ${pathname})`);
    }
  }
  if (!servers.lucy) {
    throw new Error("repo client config must define mcpServers.lucy");
  }
}
```

- [ ] **Step 4: 再跑测**

```bash
node --test scripts/smoke/mcp-client-config-guard.test.mjs
```

Expected: 全部 PASS（Task 1 已改 `.mcp.json`）。

- [ ] **Step 5: Commit（仅用户要求时）**

```bash
git add scripts/smoke/mcp-client-config-guard.mjs scripts/smoke/mcp-client-config-guard.test.mjs .mcp.json
git commit -m "$(cat <<'EOF'
test: guard repo .mcp.json against legacy /mcp/skills

EOF
)"
```

---

### Task 3: 文档口径对齐（防再次误配）

**Files:**
- Modify: `webui/config/data-qa-instructions.md`（Skill 路由句）
- Modify: `docs/governance/DEVELOPMENT.md`（§Skills 现状中「独立 lucy-skills MCP」表述）
- Modify: `docs/specs/lucy-skills-mcp-spec.md`（头部状态旁加现行客户端入口脚注）

**Interfaces:**
- Consumes: Task 1 的单一 `/mcp` 口径
- Produces: 文档不再把 `/mcp/skills` 或「等待独立 lucy-skills server」写成**当前**客户端必配路径

- [ ] **Step 1: 改 `webui/config/data-qa-instructions.md` 相关句**

将类似「等待后续 lucy-skills MCP server 提供路由」改为：

```markdown
- Fallback instructions 不自动加载 Skill；如需复用已发布业务 Skill，必须由客户端经主面 `/mcp` 显式调用可见的 `lucy_skill_search` / `lucy_skill_read`（或等价 Resource 读）。不要配置已关闭的 `/mcp/skills` passthrough。
```

- [ ] **Step 2: 改 `DEVELOPMENT.md` Skills 现状 bullet**

把「将由独立的 `lucy-skills` MCP server 提供（P1.5）」改为明确分层：

```markdown
- 业务 Skill 的 Agent 读取通道：现行经 Lucy MCP Proxy 主面 `/mcp` 的 `lucy_skill_search` / `lucy_skill_read`（受 Role 通道授予 + Skill `roles_allowed`）。
- 独立 `lucy-skills` MCP server / `/mcp/skills` passthrough：规划见 `docs/specs/lucy-skills-mcp-spec.md`，**不是**当前客户端默认接入；仓库 `.mcp.json` 不得再指向该路径。
```

并确认同文件「配置 `.mcp.json`」示例已是 `/mcp`（若仍正确则不动 JSON 示例）。

- [ ] **Step 3: 在 `lucy-skills-mcp-spec.md` 头部「状态」下追加脚注（不改状态收口结论）**

```markdown
> **现行客户端接入（2026-11-11）：** 仓库与手册默认 `.mcp.json` 只挂主面 `/mcp`。本 Spec 描述的 `/mcp/skills` 与并列 `lucy-skills` server 仍属未交付规划；不得作为当前 CC/Codex 配置模板。
```

- [ ] **Step 4: 抽查手册未把 `/mcp/skills` 写成唯一推荐**

```bash
rg -n 'mcp/skills|lucy-skills' docs/SYSTEM_HANDBOOK.md docs/runbooks docs/governance/DEVELOPMENT.md webui/config/data-qa-instructions.md docs/specs/lucy-skills-mcp-spec.md
```

Expected: 手册接入示例仍是 `/mcp`；`/mcp/skills` 仅出现在「已关闭 / 规划 / 安全」语境。

---

### Task 4: 本机 CC 验证脚本 + 验收清单

**Files:**
- Create: `scripts/smoke/cc-lucy-skill-probe.mjs`
- Optional evidence out: `inbox/cc-skill-probe/cc-post-fix.stream.jsonl`

**Interfaces:**
- Consumes: `claude` 二进制、`LUCY_LOCAL_TOKEN`、可达的 `/mcp`、已授予 Skill 通道的 Agent
- Produces: exit `0` 当 stream 中出现 `lucy_skill_read` 成功且返回正文长度 ≥ 100；否则非 0 并写证据路径

- [ ] **Step 1: 实现探针脚本（核心断言）**

Create `scripts/smoke/cc-lucy-skill-probe.mjs` with behavior:

1. Resolve `claude` as `/Users/forrest/.local/bin/claude` if present, else `PATH` 上的 `claude`（**不要**用会 `cd` 到其他目录的 shell function）。
2. Write a temp mcp config pointing at `process.env.LUCY_PUBLIC_MCP_URL || 'http://127.0.0.1:57881/mcp'` with `Authorization: Bearer ${LUCY_LOCAL_TOKEN}`（脚本启动前要求 env 已 export；脚本可把 token 写入**临时** mcp 文件，跑完删除，永不 commit）。
3. Run:

```bash
"$CLAUDE_BIN" -p '强制调用 lucy_skill_search(query=杜邦) 再 lucy_skill_read(skill_name=dupont)。最终只报告 read 返回字符数与是否含 ROE。不要查数。' \
  --output-format stream-json --verbose \
  --mcp-config "$TMP_MCP" --strict-mcp-config \
  --permission-mode bypassPermissions
```

4. Parse stream-json：找到 `mcp__*__lucy_skill_read` 的 tool_result；`content` 文本长度必须 `>= 100`；不得仅匹配 `/^\\n+$/`。
5. 同时断言 stream **未**出现内置 `Skill` 对 `dupont` 的成功（允许失败 / 不调用）；本探针成功判据只看 MCP `lucy_skill_read`。
6. 失败时把 stream 落到 `inbox/cc-skill-probe/cc-post-fix.stream.jsonl`。

- [ ] **Step 2: 跑探针（demo healthy + token 已 export）**

```bash
export LUCY_LOCAL_TOKEN  # demo Agent token
node scripts/smoke/cc-lucy-skill-probe.mjs
```

Expected: exit 0；stdout 含 `lucy_skill_read_ok` 与 `content_chars>=100`。

- [ ] **Step 3: 负例（可选，手工）— 临时指回 `/mcp/skills` 应失败**

用临时 mcp 文件指向 `http://127.0.0.1:57881/mcp/skills` 再跑同一脚本：Expected 非 0（连接失败或无工具），证明守卫与探针方向一致。

- [ ] **Step 4: 验收清单（人工勾选，写入 PR / 收口笔记）**

| ID | 检查项 | 通过标准 |
|---|---|---|
| V1 | `.mcp.json` 形状 | server=`lucy`，url pathname=`/mcp`，无 `lucy-skills` / `/mcp/skills` |
| V2 | 静态门禁 | `node --test scripts/smoke/mcp-client-config-guard.test.mjs` PASS |
| V3 | Proxy tools/list | 会话可见 `lucy_skill_search` 与 `lucy_skill_read`（角色已授予时） |
| V4 | 直连 read | `tools/call lucy_skill_read skill_name=dupont` 正文 ≥ 100 字符且含 `ROE` 或中文规程关键词 |
| V5 | CC strict 会话 | `--mcp-config` 仅仓库 `.mcp.json`（或等价 temp）时，能真实调用 `lucy_skill_read`，非 ToolSearch 空换行 |
| V6 | 内置 Skill 非目标 | `Skill(skill=dupont)` 仍可为 `Unknown skill`——**不**作为本修复失败条件 |
| V7 | 安全不回退 | 客户/默认模式下 `GET/POST /mcp/skills` 仍 404；未设置 passthrough |

---

### Task 5: 回归防呆（轻量挂钩）

**Files:**
- Modify: 既有 smoke 聚合入口（若存在 `package.json` 的 `smoke:p1*` / `lint:*` 列表则追加；没有则在本计划收口笔记写明「按需 `node --test scripts/smoke/mcp-client-config-guard.test.mjs`」）

- [ ] **Step 1: 定位现有登记方式**

```bash
rg -n 'p1-skills-smoke|mcp-client|smoke:' package.json scripts/smoke/*.mjs | head -40
```

- [ ] **Step 2: 若已有 skills/mcp smoke 聚合，把 `mcp-client-config-guard.test.mjs` 加入同一入口；否则保持独立命令，并在 PR 描述写清必跑命令**

必跑命令（最小集）：

```bash
node --test scripts/smoke/mcp-client-config-guard.test.mjs
```

可选（有 CC + token + demo）：

```bash
node scripts/smoke/cc-lucy-skill-probe.mjs
```

---

## Out of Scope

- 实现 `lucy-skills/` 独立 MCP server 或重开 passthrough
- 云端 `lucy-tencent-cloud` 角色补授 `lucy_skill_*`（本机修好后若云端仍无 Skill 工具，另开 ACL/角色任务）
- 把业务 Skill 同步进 `.claude/skills` / Cursor `.cursor/skills`
- 修改 `lucy_skill_read` 服务端实现（已证实主面返回全文正常）

## Self-Review

1. **Spec coverage:** 坐实 bug = 错误客户端入口；本计划覆盖配置修正、防回归门禁、文档、CC 验证；不碰已关闭 passthrough。
2. **Placeholder scan:** 无 TBD；命令与期望输出已写明。
3. **Consistency:** 全程单一入口名 `lucy` + pathname `/mcp`；验证以 `lucy_skill_read` 正文长度为准，不以 CC 内置 `Skill` 为准。
