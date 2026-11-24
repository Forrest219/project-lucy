# 公网企业精简测试设计 — Claude Code 两轮对抗评审 Plan

| 元数据 | 内容 |
|---|---|
| 关联设计 | [`lucy-20261114-cloud-enterprise-smoke-design.md`](lucy-20261114-cloud-enterprise-smoke-design.md) |
| 委托人审批 | 2026-11-14：**批准 Claude Code 做两轮对抗评审** |
| 性质 | 过程对抗；**≠ 设计定稿 ≠ 落地授权 ≠ 终稿确权** |

**Goal:** 对云端企业体验精简测试设计做两轮只读对抗，产出可复查 findings，供 Cursor 修订设计 v0.2 后再开落地 Plan。

**Architecture:** Cursor 写 brief 并驱动 Claude Code；Claude 只读对照 UAT／客户包 checklist／既有「云端≠本机 PASS」约束；R1 与 R2 连续完成；Cursor 验收 findings 后提议设计修订。

## 角色

| 角色 | 做什么 | 不做什么 |
|---|---|---|
| 委托人 | 已批两轮对抗；稍后批设计修订与落地 | 不必亲手写 findings |
| Cursor | brief、驱动、验收、汇总修订建议 | 不把对抗当落地；不伪造评审 |
| Claude Code | 按 brief 写 R1／R2 | 不改设计／代码；不写 secret |

## 产物

| 文件 | 作者 |
|---|---|
| `inbox/20261114-cloud-enterprise-smoke-claude-adversarial-brief.md` | Cursor |
| `inbox/20261114-cloud-enterprise-smoke-adversarial-r1.md` | Claude Code |
| `inbox/20261114-cloud-enterprise-smoke-adversarial-r2.md` | Claude Code |

## 成功标准

1. R1／R2 均有结论行与 findings 表  
2. R2 含相对 R1 的保留／降级／驳回／新增  
3. 无 secret 进库；设计文件除状态行外本波可不改（修订另波）  
4. 明确两轮均不构成落地授权  

## 委托人审批（已闭合）

- [x] 批准 Claude Code 两轮对抗评审（2026-11-14）
- [x] R1／R2 已产出（2026-11-14）：结论均为 **BLOCK**；见 `inbox/20261114-cloud-enterprise-smoke-adversarial-r{1,2}.md`
- [x] 设计 **v0.2 定稿**（2026-11-14）：关闭 R1／R2「落地前必须关闭」16 条；见 [`lucy-20261114-cloud-enterprise-smoke-design.md`](lucy-20261114-cloud-enterprise-smoke-design.md)
- [ ] 落地 Runbook／UAT／S-CLOUD-1（待另授权）
