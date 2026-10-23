# 真实用户 E2E 运行手册

| 元数据 | 内容 |
|---|---|
| 文档名称 | 真实用户 E2E 运行手册 |
| 文档类型 | Other（Runbook） |
| 版本 | v1.1（R4 v4 方案 A） |
| 撰写日期 | 2026-10-18 |
| 撰写人 | Claude（Cursor Builder） |
| 委托人 | xingchen |
| 基于材料 | [Spec](../specs/lucy-20261018-enterprise-security-and-real-e2e-spec.md) §6–§8；[real-e2e-clients.yaml](../qa/real-e2e-clients.yaml) v4；[manual-gui-e2e-checklist.md](../qa/manual-gui-e2e-checklist.md) |
| 适用范围 | 在受保护 runner 或开发机上执行 security-integration / 真实浏览器 / 真实 CLI 客户端证据，并收集人工 GUI 清单；不替代客户 K8s 上线门禁 |
| 输出位置 | `docs/runbooks/real-user-e2e.md` |

## 1. 三层自动证据 + 一层人工证据

| 层 | 入口 | 产出 | 能证明什么 |
|---|---|---|---|
| security-integration | `npm run e2e:real:security` | `security.json` | 真实 Lucy HTTP/SQLite 拒绝/允许 |
| 真实浏览器 | `npm run e2e:real:management` | `management.json` | 桌面 Chromium 管理旅程 |
| 真实 CLI 客户端 | `npm run e2e:real:agent` | `agent.json` | Codex / Claude Code / OpenClaw 自主查数 |
| 人工 GUI | checklist | `results/manual/*.json` → `manualClients` | WorkBuddy + Cursor Agent GUI（永远人工） |

## 2. 准备

```bash
node scripts/e2e/lib/catalog.mjs --check
npm run e2e:real:prepare -- --run-id local-20261018-0100 --mode local
# Postgres：docker 起库后 apply schema + seed-data，并将 run.json db.applied=true
```

## 3. 自动 CLI（Codex / Claude Code / OpenClaw）

| 产品 | 二进制 | 凭据 | adapter |
|---|---|---|---|
| Codex | `codex` | `OPENAI_API_KEY` | `scripts/e2e/adapters/codex.mjs` |
| Claude Code | `claude` | `ANTHROPIC_API_KEY` 或 `claude login` | `scripts/e2e/adapters/claude-code.mjs` |
| OpenClaw | `openclaw` | `OPENCLAW_API_KEY`（若产品要求） | `scripts/e2e/adapters/openclaw.mjs` |

```bash
export OPENAI_API_KEY=...
export ANTHROPIC_API_KEY=...   # 或已 claude login
# export OPENCLAW_API_KEY=...
export LUCY_REAL_E2E_CAPABILITIES=ktx-upstream,postgres,agent-client,network-profile
npm run e2e:real:agent -- --run inbox/e2e/<runId>/run.json
```

## 4. 人工 GUI（WorkBuddy / Cursor Agent）

按 [`docs/qa/manual-gui-e2e-checklist.md`](../qa/manual-gui-e2e-checklist.md) 执行；结果写入 `inbox/e2e/<runId>/results/manual/{workbuddy,cursor}.json`，并进入 evidence.`manualClients`。缺包则 verifier `manual_client_missing`（blocked）。

## 5. 已知限制

- OpenClaw 本机可能未安装 → 自动层 BLOCKED。
- Agent askPlan 仍有部分 `handler_not_implemented`。
- 同 OS 用户 isolation 失败属预期；local 可用 `--allow-unisolated-local`，不可用于 release。
- 客户 GO 另需 amd64 K8s + trusted runner（R8）。
