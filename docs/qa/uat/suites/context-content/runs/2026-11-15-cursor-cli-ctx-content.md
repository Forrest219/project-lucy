# UAT-SUITE-CONTEXT-CONTENT — Cursor Agent CLI

| 字段 | 值 |
|---|---|
| 日期 | 2026-11-15 |
| Agent | Cursor Agent CLI 2026.11.05-86047df |
| 环境 | cwd=`/tmp/uat-ctx-content-host-cursor` 单 server MCP |
| gitSha | `9d59337de500c778a6cee773f1bdeb41c7af837e` |
| 总账 | P1-30／REQ-030-051 |
| runNonceFp | `9c173b17bd42` |
| 证据 | `inbox/uat-ctx-content-2026-11-15/` |

## 结果摘要

| Case | 结果 |
|---|---|
| UAT-R0 | **PASS** |
| UAT-CTX-R0-SEED | **PASS** |
| UAT-CTX-WIKI-01 | **PASS** |
| UAT-CTX-WIKI-01S | **BLOCKED** |
| UAT-CTX-WIKI-02 | **PASS** |
| UAT-CTX-WIKI-03 | **PASS** |
| UAT-CTX-WIKI-04 | **PASS** |
| UAT-CTX-SKILL-01 | **PASS** |
| UAT-CTX-SKILL-02 | **PASS** |
| UAT-CTX-SKILL-03 | **PASS** |
| UAT-CTX-SKILL-04 | **PASS** |

## 宿主场景（allow）

### WIKI-02
- usedWiki=true; hasNonce=true
- 答复摘录（已脱敏）：

```
Using only the `lucy` MCP tools — discovering `wiki_read`, then fetching the exact wiki key.Wiki read succeeded. Canary body marker: **[NONCE]**
```

### SKILL-02
- usedSearch=true; usedRead=true; hasNonce=true
- 答复摘录（已脱敏）：

```
I'll run the Lucy UAT with only the `lucy` MCP tools: discover `lucy_skill_search` / `lucy_skill_read`, then search and read the canary skill.**Canary body marker: `[NONCE]`**

Skill `skill-[RUN]` (domain `uat-ctx`) was retrieved via `lucy_skill_search` and read via `lucy_skill_read` at `lucy-skill://uat-ctx/skill-[RUN]`. Per the skill SOP, when asked the canary question, the answer must include that marker.
```

## 备注
- 未设 cwd 时误连工作区其他 Lucy server；cwd 隔离后 PASS

## 判定
本宿主：**PASS**
