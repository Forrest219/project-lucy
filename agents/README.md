# Agents — Vibe Coding 多角色协作角色库

| 元数据 | 内容 |
|---|---|
| 文档名称 | Agents — Vibe Coding 多角色协作角色库 |
| 文档类型 | Other |
| 版本 | v1.0 |
| 撰写日期 | 2026-06-17 |
| 撰写人 | Codex |
| 委托人 | 待确认 |
| 基于材料 | 用户审阅意见、docs/DEVELOPMENT.md、AGENT_PIPELINE.md、agents/*.md、/Users/zhangxingchen/Projects/AGENTS.md |
| 适用范围 | project-lucy vibe coding 角色库入口与调用约定 |
| 输出位置 | /Users/zhangxingchen/Projects/project-lucy/agents/README.md |

本目录提供一组**通用角色定义**，供 vibe coding 会话按需调用。每个角色是一个视角与产出标准的封装，**可独立调用**，不依赖前序角色，也不强制走完整流水线。

## 与本仓库其他治理文档的关系

> **先看这里，避免混读。**

| 文件 | 管什么 | 优先级 |
|------|--------|--------|
| [`docs/DEVELOPMENT.md`](../docs/DEVELOPMENT.md) | project-lucy 开发治理（Plan Mode、红线、工单边界） | **高于本目录**：有冲突以 DEVELOPMENT.md 为准 |
| [`CLAUDE.md`](../CLAUDE.md) | KTX 数据问答运行时上下文 | 与本目录**无关**，互不污染 |
| 本目录（`agents/`） | 通用 vibe coding 角色库，与项目内容无关 | 可在其他仓库复用 |

---

## 5 个角色一句话

| 角色 | 一句话职责 | 文件 |
|---|---|---|
| **pm** | 把 Human 的模糊需求提炼成 PRD（含关键用户文案；opt-in 时写 RELEASE_NOTES） | [pm.md](pm.md) |
| **architect** | 梳理上下文 + 写 SPEC（含 UI 结构/状态、Backout Plan） | [architect.md](architect.md) |
| **coder** | 按 SPEC 实现、修 bug、补测试、处理 reviewer 反馈 | [coder.md](coder.md) |
| **tester** | 对照 SPEC 验证实现 + 回归 | [tester.md](tester.md) |
| **reviewer** | 合规 + 真实风险 + 上线审计两维复核 | [reviewer.md](reviewer.md) |

## 如何在 vibe coding 中调用

直接在对话里切换视角即可，例如：

- "以 **architect** 视角分析这次改动会影响哪些模块"
- "切到 **coder**，按上面的 SPEC 把这段实现出来"
- "用 **reviewer** 两维清单复核一下这段"
- "**pm** 帮我把这个需求写成 PRD，跑一遍 Non-Goals 审查"

调用约定：

1. **角色独立可调**：不需要先有 PRD 才能调 architect，也不需要先有 SPEC 才能让 reviewer 看一段代码 —— 角色文件描述的是视角与输出标准，不是流水线契约。
2. **产出默认走对话**：vibe 模式下 PRD / SPEC / IMPLEMENTATION_NOTES / TESTER_PASS / 两维报告等以消息形式产出。**仅在 Human 明确要求"落盘"时**才写文件。
3. **栈无关**：角色文件里凡是命令示例（type-check / lint / test 等）都按"本项目实际命令"理解；命令名不清楚时先问 Human，不要假定 `pytest` / `npm run` 等具体栈。
4. **落盘位置由项目约定**：本目录不规定 PRD / SPEC 等落在哪里。若项目有专门的治理路径（如 `docs/`、OpenSpec、`changes/`），按项目规则放；没有就问 Human。

## 何时升级到"完整交付模式"

以下任一条满足，建议显式启用 [`AGENT_PIPELINE.md`](../AGENT_PIPELINE.md) 的完整流水线，把制品都落盘：

- 改动涉及 schema 迁移 / 公共接口契约 / 不可逆操作
- 需要事后审计或对外发布说明
- 团队协作交接（不只是单人 vibe）
- Human 明确要求"按流水线走"

否则保持 vibe 模式，角色随用随调。
