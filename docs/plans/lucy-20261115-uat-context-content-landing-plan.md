# UAT-SUITE-CONTEXT-CONTENT 落地 Plan

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
