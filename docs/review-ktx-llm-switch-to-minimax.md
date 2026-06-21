# KTX LLM Backend 切换：Claude Code -> MiniMax

> **状态**: Implemented
> **日期**: 2026-06-21
> **范围**: `ktx.yaml` LLM provider 与 6 个 KTX 内部 LLM role
> **影响等级**: 高

## 1. 结论

`project-lucy` 的 KTX 内部 LLM backend 已从本地 `claude-code` 切换为 MiniMax
Anthropic-compatible API。

最终采用 **KTX `anthropic` backend 直连 MiniMax**，不使用 LiteLLM proxy，也不修改 KTX
源码。

原因：

- KTX 0.12.0 的 `anthropic` backend 支持 `api_key` 和 `base_url` 覆盖。
- MiniMax 提供 Anthropic Messages API 兼容接口。
- 直连方案少一层本地 proxy，配置和回滚都更简单。

## 2. 当前配置

`ktx.yaml` 的 LLM 配置应保持为：

```yaml
llm:
  provider:
    backend: anthropic
    anthropic:
      api_key: env:MINIMAX_API_KEY
      base_url: https://api.minimaxi.com/anthropic/v1
  models:
    default: MiniMax-M3
    triage: MiniMax-M3
    candidateExtraction: MiniMax-M3
    curator: MiniMax-M3
    reconcile: MiniMax-M3
    repair: MiniMax-M3
    # NOTE: 高风险审查（reviewer skill）跑在 Claude Code 主会话里，模型由用户 /model 选定，不在此处控制。
  promptCaching:
    enabled: false
```

关键点：

- `MINIMAX_API_KEY` 只从环境变量读取，禁止写入代码库、`docs/`、`inbox/` 或 `ktx.yaml`。
- `base_url` 必须是 `https://api.minimaxi.com/anthropic/v1`。KTX 使用 Anthropic SDK/AI SDK provider
  时会在 base URL 后追加 `messages` 路径；不带 `/v1` 会导致 `404 Page not found`。
- 6 个 KTX 内部 role 当前统一使用 `MiniMax-M3`。
- `promptCaching.enabled: false` 是有意设置，避免 Anthropic prompt caching provider options
  与 MiniMax 兼容性不一致。

## 3. 影响范围

受影响的是 KTX 内部 LLM 任务：

| Role | 当前模型 |
|---|---|
| `default` | `MiniMax-M3` |
| `triage` | `MiniMax-M3` |
| `candidateExtraction` | `MiniMax-M3` |
| `curator` | `MiniMax-M3` |
| `reconcile` | `MiniMax-M3` |
| `repair` | `MiniMax-M3` |

不受此配置控制：

- `skills/reviewer` 等高风险审查仍跑在外层 Claude Code / Codex 主会话中。
- 外层 coding agent 的模型由用户当前会话选择，不由 `ktx.yaml` 控制。

## 4. 验证记录

已完成：

```bash
ktx status --validate
ktx status --fast --json
```

结果：

- `ktx.yaml` schema valid。
- KTX 能读取到 `backend: anthropic`。
- KTX 能读取到 `model: MiniMax-M3`。

带临时 `MINIMAX_API_KEY` 的验证结果：

- `ktx status` 显示 `Ready`。
- KTX LLM health check 使用 `https://api.minimaxi.com/anthropic/v1` 返回 `{"ok":true}`。
- `ktx wiki "test query"` 返回本地 wiki 检索结果。

未完成 / 待继续验证：

- 结构化输出最小测试曾超时，中断后未判定通过。
- `scan.enrichment`、`candidateExtraction`、`curator`、`reconcile`、`repair` 仍需要用小样本继续验证。

## 5. 操作方法

运行 KTX 前，在同一个 shell 中注入环境变量：

```bash
export MINIMAX_API_KEY='...'
ktx status
```

不要把 key 写入仓库文件。如果需要长期使用，优先放在本机 shell secret 管理位置，并确保不会被 git
跟踪或被日志输出。

## 6. 回滚

本次执行过程中在本机 `inbox/` 生成过两个临时备份：

- `inbox/ktx.yaml.before-minimax-20260621.bak`：切换 MiniMax 前的 Claude Code 配置。
- `inbox/ktx.yaml.before-minimax-m3-20260621.bak`：从 MiniMax M2.7 切到 MiniMax M3 前的配置。

`inbox/` 是临时目录，可随时删除；长期回滚依据应以 git 历史或下方手动配置为准。

回滚到 Claude Code：

```yaml
llm:
  provider:
    backend: claude-code
  models:
    default: sonnet
    triage: haiku
    candidateExtraction: sonnet
    curator: sonnet
    reconcile: sonnet
    repair: sonnet
```

回滚到 MiniMax M2.7：

```yaml
llm:
  provider:
    backend: anthropic
    anthropic:
      api_key: env:MINIMAX_API_KEY
      base_url: https://api.minimaxi.com/anthropic/v1
  models:
    default: MiniMax-M2.7-highspeed
    triage: MiniMax-M2.7-highspeed
    candidateExtraction: MiniMax-M2.7-highspeed
    curator: MiniMax-M2.7-highspeed
    reconcile: MiniMax-M2.7-highspeed
    repair: MiniMax-M2.7-highspeed
  promptCaching:
    enabled: false
```

回滚后验证：

```bash
ktx status --validate
ktx status --fast
```

## 7. 风险

| 风险 | 影响 | 缓解 |
|---|---|---|
| MiniMax structured output 与 KTX 期望不完全一致 | scan/ingest 某些阶段失败 | 先跑小样本，再扩大到完整 scan/ingest |
| Tool use / repair loop 兼容性不足 | `candidateExtraction`、`repair` 等任务失败 | 保留 Claude Code 回滚配置 |
| MiniMax API 限流或延迟波动 | KTX 运行变慢或失败 | 降低并发，必要时回滚 |
| 数据出境 / 外发合规 | 业务数据可能进入 MiniMax prompt | 运行前确认当前数据可发往 MiniMax |

## 8. 废弃方案说明

此前评估过 `gateway + LiteLLM proxy + MiniMax`，现不作为默认方案。

原因：

- KTX 的 `gateway` backend 走 AI SDK Gateway provider，不等同于通用 Anthropic-compatible proxy。
- LiteLLM 方案需要额外本地进程和 master key，增加维护面。
- 当前直连 `anthropic` backend 已经能完成 key、endpoint、模型名的基础健康检查。

如果未来需要集中观测、统一限流或多模型路由，再重新评估 LiteLLM。
