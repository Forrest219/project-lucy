# UAT-SUITE-CONTEXT-CONTENT 落地 Plan

| 治理字段 | 内容 |
|---|---|
| 状态 | 执行进度以本文件原Task勾选和已有跑次为准；本次仅补齐文档形态，未复跑本计划业务验收，当前候选结果待验。 |
| 授权边界 | 仅本计划既有Task所列范围，原审批和禁止项见正文；本次文档治理修订不新增运行代码、提交、部署或发布授权。 |
| 验收 | 以本文件验收小节、Task通过标准及已链接证据为准；历史结果不代表当前候选已复测。 |

> **For agentic workers:** 按任务勾选推进；本波为**测试台落地**（文档／夹具约定／判定脚本骨架），**不改** Proxy／WebUI 运行代码。

**Goal:** 将已定稿设计挂入 0.30 需求台＋测试台，使 Wiki／Skill「真读真用＋ACL」可按双宿主（Claude Code CLI＋Cursor Agent CLI）复跑。

**Architecture:** 设计 SOT＝`docs/design/design-2026-11-15-uat-context-content-wiki-skill.md`；测试台＝`docs/qa/uat/suites/context-content/`；总账＝**P1-30／REQ-030-051**（**不得**占用已登记的 P1-29／REQ-030-050）。

**Tech Stack:** Markdown UAT 树；`scripts/uat/judge-context-content.mjs`；复用 `scripts/e2e/adapters/{claude-code,cursor-cli}.mjs` 与 `answer-assertions.mjs`（后续跑次扩展）。

## Global Constraints

- 不改运行时代码；≠ 可上线；≠ 功能合同收口  
- Token／密码只写文件路径；nonce 不进 tracked fixtures／runs／INDEX（只写指纹）  
- Cursor＝Agent CLI（套件必做）；`real-e2e-clients.yaml` 的 `cursor-cli` 全局 `required` 保持 false，本套件写**套件级必做例外**  
- 落盘顺序：suite 目录 → 总账 → INDEX（`NOT RUN`）

---

### Task 1: 定稿标注＋ID 校正

- [x] 设计状态改为定稿；总账号改为 **P1-30／REQ-030-051**（避开已占用的 P1-29／050）
- [x] 本 Plan 落盘

### Task 2: 测试台 suite 树

- [x] `suite.md`／`cases.md`／`fixtures.md`／`runs/.gitkeep`

### Task 3: 三台勾连

- [x] 执行总账入池 P1-30；需求池 REQ-030-051  
- [x] `e2e-ledger.md` 挂行  
- [x] `INDEX.md` NOT RUN  
- [x] `check-e2e-ledger.mjs` REQUIRED（latestRun 空）  
- [x] `CONVENTIONS.md` 编号＋判定词  
- [x] `docs/README.md` 设计索引  
- [x] registry 套件级例外说明  

### Task 4: 判定脚本骨架

- [x] `scripts/uat/judge-context-content.mjs`（无跑次时 exit 0／说明 NOT RUN；有跑次时检查双宿主文件）

### Task 5: 校验

- [x] `npm run lint:e2e-ledger` 通过；`judge-context-content.mjs` → `NOT_RUN`

## 目标（治理补齐）

将Wiki/Skill真读真用与ACL的已定稿设计挂入需求台与测试台。

## 开工前置（治理补齐）

先核对设计SOT、P1-30/REQ-030-051及双宿主套件级要求；不占用P1-29编号。

## 验收（治理补齐）

核对Task 1–5套件树、勾连、判定脚本与lint输出；无跑次时NOT_RUN是预期，不能解释为UAT PASS。

## 完成定义（治理补齐）

设计、总账、INDEX和e2e互相回链，脚本骨架能诚实报告NOT_RUN；真实双宿主执行仍是后续测试。

## 风险（治理补齐）

nonce或凭据不可进tracked fixtures/runs；骨架落地不能替代Wiki/Skill实际ACL验收。
