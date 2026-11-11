# MCP 客户端 Skill 入口修正 Plan

| 元数据 | 内容 |
|---|---|
| 文档版本 / 日期 | **v0.1** / 2026-11-11 |
| 目标版本 / 优先级 | 不绑定产品版本号 / **P0**。功能编号无 |
| 主 Spec | [`docs/specs/lucy-20261111-mcp-client-skill-endpoint-fix-spec.md`](../specs/lucy-20261111-mcp-client-skill-endpoint-fix-spec.md) |
| 状态 | **v0.1 功能合同已收口（2026-11-11）**。SC-01–SC-11 通过（SC-10 于 Docker 重建后 CC 全真复测闭合）。证据见收口记录。本条收口不表示可上线 |
| 授权边界 | **已授权**：用户同会话要求 Spec／Plan 并推进落地 → 可改 `.mcp.json`、smoke 守卫／探针、接入文档口径、`package.json` 与测试门禁登记。**仍不授权** git commit（除非用户另授）、客户镜像、Docker `--fresh`／重建、重开 `/mcp/skills` passthrough、实现独立 `lucy-skills` server |
| 验收 | 以主 Spec §3 SC-01–SC-11 为准 |
| 实施主体 | 仓库根客户端配置、`scripts/smoke`、治理／接入文档 |
| 收口记录 | [`docs/reviews/2026-11-11-mcp-client-skill-endpoint-fix-closure.md`](../reviews/2026-11-11-mcp-client-skill-endpoint-fix-closure.md) |

## 1. 目标

消除仓库默认 `.mcp.json` 指向已关闭 `/mcp/skills` 导致的 Claude Code Skill「假连通」：默认挂主面 `/mcp`，静态门禁防回流，文档口径对齐，可选 CC 探针证明 `lucy_skill_read` 返回全文。

## 2. 开工前置

| ID | 条件 | 状态 |
|---|---|---|
| P1 | 主 Spec 与本 Plan 同编号落盘 | 满足 |
| P2 | 设计已锁定：单一 `lucy`→`/mcp`；拒绝重开 passthrough／原生 Skill 冒充 | 满足 |
| P3 | 用户明示推进落地 | 满足 |
| P4 | 不改 Proxy Skill ACL 实现 | 合同已写死 |

## 3. 文件落点

| 路径 | 改动 |
|---|---|
| `.mcp.json` | `lucy` → `http://127.0.0.1:57881/mcp` + `${LUCY_LOCAL_TOKEN}` |
| `scripts/smoke/mcp-client-config-guard.mjs` | 静态断言 |
| `scripts/smoke/mcp-client-config-guard.test.mjs` | SC-03–SC-05 |
| `scripts/smoke/cc-lucy-skill-probe.mjs` | SC-10 可选 live |
| `package.json` | `smoke:p1:mcp-client-config:test` |
| `docs/governance/test-layers-and-release-gates.md` | Current Commands 登记 |
| `webui/config/data-qa-instructions.md` | SC-06 |
| `docs/governance/DEVELOPMENT.md` | SC-07 |
| `docs/specs/lucy-skills-mcp-spec.md` | SC-08 脚注 |
| Spec／Plan／索引 | 状态镜像 |

## 4. 分阶段实施

### S1 配置与静态门禁

1. 替换 `.mcp.json`（D1–D4）。
2. 实现守卫 + 单测；`npm run smoke:p1:mcp-client-config:test`。

### S2 文档口径

1. 改 data-qa-instructions／DEVELOPMENT Skills 现状／skills-mcp-spec 脚注。
2. 登记测试门禁命令表。

### S3 CC 探针

1. 实现 `cc-lucy-skill-probe.mjs`（缺依赖 blocked）。
2. 本机依赖齐备时跑通一次。

## 5. 验收

| 项 | 做法 |
|---|---|
| SC-01–SC-05、SC-09 | `node --test scripts/smoke/mcp-client-config-guard.test.mjs` |
| SC-06–SC-08、SC-11 | 文件审查 |
| SC-10 | `node scripts/smoke/cc-lucy-skill-probe.mjs`（或 blocked） |
| 文档门禁 | `npm run lint:spec-docs`（本条相关文件） |

## 6. 完成定义

- SC-01–SC-11 满足；静态测试绿
- 未开启 passthrough；未提交明文 token
- Spec／Plan／索引状态句一致

## 7. 风险

| 风险 | 缓解 |
|---|---|
| Demo 端口与宿主 7879 混淆 | 门禁只锁 pathname；文档注明双端口 |
| 误以为必须修 Proxy | 取证已证明主面 read 正常 |
| CC 内置 Skill 仍 Unknown | 合同 D8：非失败条件 |
| `${LUCY_LOCAL_TOKEN}` 在 CC 侧读到过期 settings env | 重建后使用 demo seed `lucy-demo-agent-token` 或有效 Agent token；探针脚本对临时 mcp 内联 Bearer |

## 浏览器验证

不适用：本条无 WebUI 页面／路由变更，验收以 `.mcp.json` 守卫、`node --test` 与可选 CC CLI 探针为准，不做浏览器人审。
