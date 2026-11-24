# MCP 客户端 Skill 入口修正 — 收口记录

| 元数据 | 内容 |
|---|---|
| 日期 | 2026-11-11 |
| Spec | [`docs/specs/lucy-20261111-mcp-client-skill-endpoint-fix-spec.md`](../specs/lucy-20261111-mcp-client-skill-endpoint-fix-spec.md) |
| Plan | [`docs/plans/lucy-20261111-mcp-client-skill-endpoint-fix-plan.md`](../plans/lucy-20261111-mcp-client-skill-endpoint-fix-plan.md) |

## 结论

功能合同 **v0.1 已收口**。本条收口不表示可上线。

## SC 逐条

| ID | 结果 | 证据 |
|---|---|---|
| SC-01 | 通过 | `.mcp.json` → `lucy` / `…/mcp` |
| SC-02 | 通过 | 无 `lucy-skills`／`/mcp/skills` |
| SC-03–SC-05 | 通过 | `npm run smoke:p1:mcp-client-config:test` 3/3 |
| SC-06 | 通过 | `webui/config/data-qa-instructions.md` |
| SC-07 | 通过 | `docs/governance/DEVELOPMENT.md` Skills 现状 |
| SC-08 | 通过 | `lucy-skills-mcp-spec.md` 头部脚注 |
| SC-09 | 通过 | `package.json` + `test-layers-and-release-gates.md` |
| SC-10 | **通过（2026-11-11 复测）** | Docker demo healthy 后：① `cc-lucy-skill-probe.mjs` → `lucy_skill_read_ok content_chars=2050`（exit 0）；② CC `--strict-mcp-config` 全真会话：`lucy` connected；`lucy_skill_search` count=1；`lucy_skill_read` 2050 字符含 ROE；内置 `Skill(dupont)` → `Unknown skill`（非失败条件）。说明：仓库 `.mcp.json` 的 `${LUCY_LOCAL_TOKEN}` 在本机 CC 2.1.x 下若指向过期 settings env 会 401；全真复测对同一 `/mcp` URL 使用 demo seed `lucy-demo-agent-token`（与 `p0-demo-docker-smoke` 默认一致） |
| SC-11 | 通过 | 未写入开启 passthrough 的默认配置；未改 Proxy 使 `/mcp/skills` 默认可用 |

## 门禁

- `npm run smoke:p1:mcp-client-config:test` PASS
- `npm run lint:spec-docs` PASS
- `node scripts/smoke/cc-lucy-skill-probe.mjs` PASS（demo healthy + seed token）
