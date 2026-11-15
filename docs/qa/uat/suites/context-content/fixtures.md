# Fixtures — UAT-SUITE-CONTEXT-CONTENT

| 键 | 值 | 备注 |
|---|---|---|
| WebUI | `http://127.0.0.1:55176` | 以当次端口为准 |
| Health | `http://127.0.0.1:55176/api/health` | 记录 `gitSha` |
| MCP Proxy | `http://127.0.0.1:57881/mcp` | pathname 必须 `/mcp` |
| Compose | `deploy/compose/docker-compose.demo.yml` | |
| Lucy 容器 | `compose-lucy-1` | |
| WebUI 登录凭据 | `/Users/forrest/Desktop/lucywebui logi.txt`（若缺失则 `/Users/forrest/Projects/config-for-agents/lucywebui logi.txt`） | 路径 only；2026-11-15 首跑用后者 |
| 内容播种 | **仅** Admin API（Cookie `lucy_admin_session`） | 禁止写仓库 tracked `wiki/`／`skills/` |
| Wiki key 形态 | `uat-ctx-wiki-<run-nonce>.md` | run-nonce＝小写 hex；**本文件不写具体 nonce** |
| Skill URI | `lucy-skill://uat-ctx/skill-<run-nonce>` | domain／name 均 `^[a-z0-9_-]+$` |
| Role／Agent 前缀 | `uat-ctx-content-{allow\|deny-nochan\|deny-noacl}-<run-nonce>` | 一身份一 agent |
| 通道工具（allow／deny-noacl） | `wiki_search`／`wiki_read`／`lucy_skill_search`／`lucy_skill_read` | 同一 Role |
| 宿主 A | Claude Code CLI `claude -p` | adapter `scripts/e2e/adapters/claude-code.mjs`；`--strict-mcp-config` |
| 宿主 B | Cursor Agent CLI | adapter `scripts/e2e/adapters/cursor-cli.mjs`；**套件级必做**（全局 registry `cursor-cli.required` 仍可为 false） |
| Token 绑定 | 每身份×阶段：单 server 生成配置 + env Bearer | cwd＝仓库外；明文不进 tracked |
| 播种脚本 | `node scripts/uat/seed-context-content.mjs` | Admin Cookie 播种＋R0-SEED；每次复跑新 nonce |
| 判定脚本 | `node scripts/uat/judge-context-content.mjs` | INDEX PASS 须可由其 JSON 复算 |
| 证据目录 | `inbox/uat-ctx-content-<date>/` | gitignored；含判定 JSON、nonce 指纹；首跑样例可对照 |

## 固定答问句（写入 Skill `triggers`；不含 nonce）

```
UAT context content canary question for skill retrieval
```

（跑次可另选等价固定句，但须与当次 Skill `triggers` **逐字一致**，并写入跑次记录。）

## 禁止

- 把 Bearer／密码／原始 nonce 写入 runs／INDEX／本 fixtures／设计  
- 同会话并列 allow＋deny 两个 MCP server  
- 同 agent 签两 token 冒充两身份  
- 用 GUI 冒充本套件 Cursor 半边（委托人已裁定 Agent CLI）  
