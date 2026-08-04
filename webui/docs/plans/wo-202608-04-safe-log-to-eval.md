# 202608-GOV-04 Safe Log-to-Security-Eval Work Order

> **Status: 202608 P1 Active 缺口（NOT Deferred）**
>
> 截至本工单落盘：
>
> - 当前仓库**只有** spec（`webui/docs/65-safe-log-to-eval-spec.md`）和本 work order；
> - **没有** `server/eval/security-candidates.ts`；
> - **没有** `server/__tests__/security-eval-candidates.test.ts`；
> - **没有** `src/__tests__/security-eval-candidates.test.tsx`；
> - **没有** `scripts/verify-202608-safe-log-to-security-eval.mjs`；
> - 没有 `security_eval_candidate` / `security_eval_candidate_review` 表，没有对应的 `/api/eval/security-candidates/*` 路由。
>
> minimax 接到本工单后**第一件事**就是 `ls` / `grep` 确认以上文件/路由确实不存在，然后从零实现并自检。**不要假定已有脚手架**。

## Minimax Prompt

请在 `/Users/zhangxingchen/Projects/project-lucy/webui` 中实现 202608-GOV-04 Safe Log-to-Security-Eval。

本任务是 202608 **P1 Active 缺口**，不是 Deferred。当前仓库只有 spec / work order，没有 `server/eval/security-candidates.ts`、对应测试或 verifier。请完整实现并验证。

必须先阅读：

- `../docs/DEVELOPMENT.md`
- `../docs/eval-quiz-conventions.md`
- `../docs/lucy-202608-upgrade-execution-control.md`
- `docs/00-product-terminology-standard.md`
- `docs/46-eval-yaml-exchange-and-result-archive-spec.md`
- `docs/65-safe-log-to-eval-spec.md`
- `server/eval/db.ts`
- `server/eval/cases.ts`
- `server/proxy/audit.ts`
- `server/admin/audit.ts`

目标：只把 denied / forbidden / raw query / sensitive metadata 等安全与权限日志转成 Security Candidate Pool，经 Reviewer Evidence 后才可晋升为 P0 security Eval。不要实现通用业务 Log-to-Eval。

开始前记录：

```bash
cd /Users/zhangxingchen/Projects/project-lucy
git status --short
```

### 前置存在性校验（开工必跑，确认本工单确属 P1 Active 缺口）

```bash
test -f webui/server/eval/security-candidates.ts            && echo "FAIL: security-candidates.ts 已存在" || echo "OK: security-candidates.ts 缺"
test -f webui/server/__tests__/security-eval-candidates.test.ts   && echo "FAIL: server 测试已存在" || echo "OK: server 测试缺"
test -f webui/src/__tests__/security-eval-candidates.test.tsx    && echo "FAIL: UI 测试已存在"   || echo "OK: UI 测试缺"
test -f scripts/verify-202608-safe-log-to-security-eval.mjs && echo "FAIL: verifier 已存在" || echo "OK: verifier 缺"
grep -RIn "security_eval_candidate" webui/server/eval webui/server/index.ts || echo "OK: security_eval_candidate 表 / 路由未注册"
grep -RIn "/api/eval/security-candidates" webui/server || echo "OK: /api/eval/security-candidates 路由未注册"
```

如果任一 `FAIL` 出现，**先停下来回报用户**：本工单可能已经被前序 minimax 局部实现，避免覆盖别人工作。

## Scope

1. 新建 `server/eval/security-candidates.ts`。
2. 在 Eval SQLite 中新增 `security_eval_candidate` 和 `security_eval_candidate_review`。
3. 新增 API：
   - `GET /api/eval/security-candidates`
   - `POST /api/eval/security-candidates/extract`
   - `POST /api/eval/security-candidates/:id/review`
   - `POST /api/eval/security-candidates/:id/promote/preview`
   - `POST /api/eval/security-candidates/:id/promote`
4. 从 `access_log` / `trace_events` / `evidence_events` 抽取 denied / forbidden / raw query / sensitive metadata 候选。
5. Redaction fail-closed。
6. Promotion 必须检查 reviewer evidence。
7. UI 可新增轻量入口或复用 Eval pages。
8. 新增测试：
   - `server/__tests__/security-eval-candidates.test.ts`
   - `src/__tests__/security-eval-candidates.test.tsx`
9. 新增自检脚本：`../scripts/verify-202608-safe-log-to-security-eval.mjs`。

## Allowed Files

Expected files (新建, P1 缺口 — 当前全部不存在):

- `webui/server/eval/security-candidates.ts` — candidate pool、redaction、reviewer、promotion preview / commit 全部主流程。
- `webui/server/__tests__/security-eval-candidates.test.ts`
- `webui/src/__tests__/security-eval-candidates.test.tsx`
- `scripts/verify-202608-safe-log-to-security-eval.mjs` — 根目录 verifier，与 `docs/lucy-202608-upgrade-execution-control.md` §7 Verification Matrix 中的 GOV-04 行命令口径一致。

May modify (最小化、只为接入本工单):

- `webui/server/eval/db.ts` — 仅追加 `security_eval_candidate` / `security_eval_candidate_review` 两张表的建表与迁移；**不动**既有 `eval_case` / `eval_run` 等表的 schema。
- `webui/server/eval/index.ts`（或当前 eval 路由注册文件） — 仅注册本工单新增的 `/api/eval/security-candidates/*` 五个路由；既有 eval 路由不动。
- `webui/src/pages/eval/**` — 允许新增轻量 Security Candidates 入口；如选择复用 CaseList / CaseEditor，仅追加 tab / section，不重写已有组件。
- 既有 reviewer / actor 工具类型（仅在测试断言中读取，不修改生产语义）。

Do not modify (本工单禁止触碰):

- `webui/server/admin/agents.ts`、`webui/server/admin/roles.ts`、`webui/server/admin/tokens.ts` 以及 governance gate 模块（`wo-202608-GOV-03` 范围）除非有集成测试明确证明必要。
- `webui/server/trace/**`、`webui/server/proxy/audit.ts`、`webui/server/proxy/mcp-proxy.ts` —— Trace 事件契约由 `wo-202608-01` 锁定，本工单**只读** `trace_events` / `evidence_events`，不改事件 schema 或写入路径。
- `webui/server/admin/audit.ts`、`webui/server/admin/risk-review.ts`、`webui/server/admin/release-readiness-package.ts` —— Risk Review / Release Readiness 由 `wo-202608-06` 负责；如果发现需要它们报告 candidate count，本工单只读其当前接口，不修改实现，除非测试证明需要最小兼容性 fix（且必须在 commit message 标注）。
- `webui/src/pages/admin/**` —— 属 `wo-202608-GOV-02` / `wo-202608-06`；本工单可在 Eval UI 新增入口，但不写 Admin 页面。
- `.ktx/secrets/**`、生产 `.ktx-ui/audit.sqlite`、生产 `.ktx-ui/eval/**`、`semantic-layer/**`。
- FDE Copilot（`wo-202608-05-fde-copilot-candidate`，Deferred）、Static Lint / Reindex（Deferred-202608-02）、Dynamic RLS / CLS（202608 已删除）相关文件。

## Implementation Notes

- Security Candidate 与正式 Eval YAML 物理隔离。
- Promotion preview 返回 diff，不立即写文件。
- 不保存 Token / secret / 个人联系方式。
- 不要把 `token`、`secret`、`api_key` 等语义词本身当作凭证泄露；只有高熵凭证字符串或已知签名格式才 fail-closed。
- 不让 AI actor 成为 reviewer。
- 不处理普通高频业务问题，本轮只处理 security / permission negative cases。
- If Release Readiness Package is present, it may report candidate counts once tables exist; do not rewrite the package implementation unless tests require a small compatibility fix.

## Acceptance Criteria

- denied tool log becomes P0 security candidate。
- forbidden table log becomes P0 security candidate。
- raw query forbidden log becomes P0 security candidate。
- high-entropy credential string rejected。
- semantic Token / API key usage remains candidate。
- unreviewed promotion fails。
- reviewed promotion preview returns valid P0 security Eval diff。

## Verification

WebUI Vitest:

```bash
cd /Users/zhangxingchen/Projects/project-lucy/webui
npm test -- server/__tests__/security-eval-candidates.test.ts src/__tests__/security-eval-candidates.test.tsx server/__tests__/eval-cases.test.ts server/__tests__/eval-runs.test.ts
```

Root verifier:

```bash
cd /Users/zhangxingchen/Projects/project-lucy
node scripts/verify-202608-safe-log-to-security-eval.mjs
npm run lint:terminology
```

Browser check: not required.

## Code Review Checklist

- [ ] No unreviewed candidate can enter formal Eval.
- [ ] Redaction failure is fail-closed.
- [ ] Reviewer evidence has actor metadata.
- [ ] This work order does not implement generic business Log-to-Eval.
- [ ] 以下 5 个 P1 缺口文件全部新建并随本工单 commit：
  - [ ] `webui/server/eval/security-candidates.ts`
  - [ ] `webui/server/__tests__/security-eval-candidates.test.ts`
  - [ ] `webui/src/__tests__/security-eval-candidates.test.tsx`
  - [ ] `scripts/verify-202608-safe-log-to-security-eval.mjs`
  - [ ] Eval SQLite 中新增 `security_eval_candidate` 与 `security_eval_candidate_review` 两张表的迁移
- [ ] `/api/eval/security-candidates*` 五个路由在 eval 路由注册文件中出现，并已注册到 OpenAPI / 路由清单。
- [ ] 所有 SQLite 测试使用 `:memory:` 或独立 temp SQLite 文件，未触碰生产 `.ktx-ui/eval/**`。
