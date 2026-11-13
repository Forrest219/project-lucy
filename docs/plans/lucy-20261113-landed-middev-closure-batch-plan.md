# 已开发／中间态收口批次 Plan（W0→W1→W2）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** 集中收口「已完成开发」与「开发中间态」功能证据；**不**推进已暂停的 P0-6／7／B 的 R2-F／R4／实现。

**Architecture:** 三波串行。W0 固化 Wave A 实现 CR 文档（可含已发生的 O 闭合文档记账，但标明 R2-F 暂停）。W1 为已实现 P1 补实现 CR。W2 处理连接热重载中间态（关 E2E 或书面降级）。

**Tech Stack:** Markdown／`docs/reviews/`；Vitest；可选 live-e2e／verify 脚本。不改 KTX。

| 元数据 | 内容 |
|---|---|
| 版本／日期 | **v0.1**／2026-11-13 |
| 状态 | **可执行**。委托人批准 W0→W1→W2；多 Agent Task |
| 授权边界 | W0／W1 默认只动文档与测试复跑；W2 若需补 E2E 代码须在 Task 内明示且不扩 scope。**禁止**开 P0-6／7／B 实现 |
| 暂停线 | P0-6／7／B：**R2-F／R4／开发一律不推进** |

## Global Constraints

- Spec 头部状态为事实源；镜像同句。
- CR PASS ≠ 可上线。
- 不把 SC 证据审计／acceptance 默认可替代实现 CR（P1-13 除外：可书面登记「acceptance 代替实现 CR」）。
- 用户未再要求前：W0 **允许 git commit**（本批次收口需要）；其后各 Task 默认仍可 commit（本 Plan 授权文档收口提交）。
- 术语标准遵守。

---

## W0 — Wave A 文档落盘提交

### Task W0-1: 预检与文件清单

- [ ] 列出 WAVE_A／O_CLOSE／SHARED 三类路径
- [ ] 确认四份实现 CR 文件存在且 Spec／Plan 已回链
- [ ] 确认治理优化 Plan 已在 `docs/plans/README.md` 索引
- [ ] 报告 → `.superpowers/sdd/w0-1-report.md`

### Task W0-2: 提交文档（推荐单提交，信息分节）

因清单池／README 同时含 Wave A CR 与 O 闭合记账，**允许一个 commit**，message 必须分节写清：

1. Wave A：P0-2／A／4／5 实现 CR 落盘与镜像  
2. 记账：P0-6／7／B O＝S／E／F 已闭合；**R2-F 按委托人指示暂停**  
3. ≠ 可上线；无运行代码

- [ ] `git add` 相关 docs（含未跟踪 CR／决策纸／治理 Plan）
- [ ] `npm run lint:spec-docs`（允许既有基线；无本波新阻塞）
- [ ] HEREDOC commit
- [ ] `git status` 干净或仅剩无关文件
- [ ] 报告 → `.superpowers/sdd/w0-2-report.md`

---

## W1 — 已实现 P1 实现 CR

### Task W1-1: P1-11 Ops 概念控制面 — 实现 CR

- [ ] 复跑 Spec 所指自动化（SC-01–SC-22 相关 vitest）
- [ ] 写 `docs/reviews/2026-11-13-p1-11-concept-registry-ops-code-review.md`
- [ ] Spec／Plan／清单回链；清单版本 bump
- [ ] 报告 → `.superpowers/sdd/w1-1-report.md`

### Task W1-2: P1-12 预算阈值放宽 — 实现 CR

- [ ] 复跑相关测或定点断言默认 60／300
- [ ] 写 `docs/reviews/2026-11-13-p1-12-question-budget-threshold-code-review.md`
- [ ] 回链；bump
- [ ] 报告 → `.superpowers/sdd/w1-2-report.md`

### Task W1-3: P1-14 预算复盘审计 — 实现 CR

- [ ] 复跑相关测
- [ ] 写 `docs/reviews/2026-11-13-p1-14-question-budget-retrospective-audit-code-review.md`（实现层；区别于既有 Claude Spec 评审）
- [ ] 回链；bump
- [ ] 报告 → `.superpowers/sdd/w1-3-report.md`

### Task W1-4: P1-13 处理

- [ ] 二选一写进清单／Spec：**A)** 书面「发布取证 acceptance 代替实现 CR」；或 **B)** 补实现 CR
- [ ] 推荐默认 **A**（已有 acceptance 证据齐）
- [ ] 报告 → `.superpowers/sdd/w1-4-report.md`

### Task W1-5: W1 提交

- [ ] 汇总 commit（docs only）
- [ ] 报告 → `.superpowers/sdd/w1-5-report.md`

---

## W2 — 连接热重载中间态

### Task W2-1: 现状审计

- [ ] 对照 `lucy-20261112-connection-create-execution-runtime-reload-plan.md`：OPEN 项列表（E2E-CON-07／E2E-MCP-02／UAT-CONN-RELOAD-01 等）
- [ ] 核对主机代码／容器 verify 已闭合证据
- [ ] 报告 → `.superpowers/sdd/w2-1-report.md`

### Task W2-2: 收口路径执行（默认书面降级＋门禁边界）

默认路径（除非审计证明 E2E 可当日绿）：

- [ ] 写 `docs/reviews/2026-11-13-connection-reload-middev-closure.md`：区分「进程级／单测已收口」vs「浏览器 live E2E 仍 OPEN」
- [ ] Plan／相关 Spec 头部镜像：中间态收口口径；OPEN E2E 登记为**已知债／不挡本波文档收口**或排期
- [ ] **不**强行 `demo:upgrade` 除非环境代理可用且 Task 明示
- [ ] 报告 → `.superpowers/sdd/w2-2-report.md`

### Task W2-3: W2 提交与总收束

- [ ] commit
- [ ] 更新本 Plan 勾选；清单若需旁路「中间态」一行则补
- [ ] 报告 → `.superpowers/sdd/w2-3-report.md`

---

## 完成定义

| 波 | Done when |
|---|---|
| W0 | Wave A CR 在 git 历史中可追溯；O 闭合文档已记账且标明 R2-F 暂停 |
| W1 | P1-11／12／14 有实现 CR；P1-13 有 A 或 B 书面结论 |
| W2 | 连接重载中间态有明确收口记录（绿 E2E 或已知债） |

## 非目标

- P0-6／7／B 的 R2-F／R4／实现
- 旁路扫表／Skill／桑基入池（可另开 W3）
- 宣称可上线／0.30 核心完成
