# 202608 Spec Branch Isolation Implementation Plan

> **For Minimax:** Use this plan as the execution entry. Do not implement any product code in this task.

**Goal:** Move the frozen Lucy 202608 spec / plan / task documents into a clean isolated branch without disturbing the current `main` working tree.

**Architecture:** Use a dedicated git worktree created from `origin/main`, then apply a patch containing only the 202608 documentation artifacts. The current `/Users/zhangxingchen/Projects/project-lucy` working tree may be dirty, so do not switch branches in place and do not stage unrelated files from it.

**Tech Stack:** Git worktree, git diff / apply, Markdown docs, repository lint scripts.

---

## 0. Read First

Before running commands, read:

- `docs/DEVELOPMENT.md`
- `docs/lucy-202608-reliable-delivery-upgrade-spec.md`
- `docs/lucy-202608-upgrade-execution-control.md`
- `docs/plans/README.md`

Hard constraints:

- Do not edit product code.
- Do not run browser checks.
- Do not switch the current dirty main worktree onto a new branch.
- Do not stage unrelated current worktree changes.
- Do not read `.ktx/secrets/**`.

## 1. Branch And Worktree

Target branch:

```text
codex/202608-reliable-delivery-specs
```

Target worktree:

```text
/Users/zhangxingchen/Projects/project-lucy-202608-specs
```

## 2. File Allowlist

The patch for this task must include only these files or directories:

```text
docs/lucy-202608-reliable-delivery-upgrade-spec.md
docs/lucy-202608-upgrade-execution-control.md
docs/lucy-202608-dynamic-rls-poc-spec.md
docs/plans/README.md
docs/plans/wo-202608-00-spec-branch-isolation.md
docs/plans/wo-202608-06-dynamic-rls-poc.md
webui/docs/62-trace-evidence-kernel-spec.md
webui/docs/63-static-lint-reindex-diagnosis-spec.md
webui/docs/64-tiered-publish-gate-spec.md
webui/docs/65-safe-log-to-eval-spec.md
webui/docs/66-fde-copilot-candidate-spec.md
webui/docs/plans/wo-202608-01-trace-evidence-kernel.md
webui/docs/plans/wo-202608-02-static-lint-reindex-diagnosis.md
webui/docs/plans/wo-202608-03-tiered-publish-gate.md
webui/docs/plans/wo-202608-04-safe-log-to-eval.md
webui/docs/plans/wo-202608-05-fde-copilot-candidate.md
docs/README.md
docs/project-overview.md
webui/docs/README.md
webui/docs/plans/README.md
```

Explicitly exclude:

```text
Dockerfile
docker-compose*.yml
customer-config.example/**
examples/**
scripts/*.mjs
webui/server/**
webui/src/**
webui/config/**
webui/pnpm-lock.yaml
```

## 3. Task Steps

### Task 1: Record Current Main Worktree State

Run:

```bash
cd /Users/zhangxingchen/Projects/project-lucy
git branch --show-current
git status --short
```

Expected:

- Branch is current working branch, usually `main`.
- There may be many unrelated dirty files.
- Do not clean or revert them.

### Task 2: Export A Docs-only Patch From Current Worktree

Run from current worktree:

```bash
cd /Users/zhangxingchen/Projects/project-lucy
git diff -- docs/README.md docs/project-overview.md webui/docs/README.md webui/docs/plans/README.md > /tmp/lucy-202608-specs.patch
git diff --no-index /dev/null docs/lucy-202608-reliable-delivery-upgrade-spec.md >> /tmp/lucy-202608-specs.patch
git diff --no-index /dev/null docs/lucy-202608-upgrade-execution-control.md >> /tmp/lucy-202608-specs.patch
git diff --no-index /dev/null docs/lucy-202608-dynamic-rls-poc-spec.md >> /tmp/lucy-202608-specs.patch
git diff --no-index /dev/null docs/plans/README.md >> /tmp/lucy-202608-specs.patch
git diff --no-index /dev/null docs/plans/wo-202608-00-spec-branch-isolation.md >> /tmp/lucy-202608-specs.patch
git diff --no-index /dev/null docs/plans/wo-202608-06-dynamic-rls-poc.md >> /tmp/lucy-202608-specs.patch
git diff --no-index /dev/null webui/docs/62-trace-evidence-kernel-spec.md >> /tmp/lucy-202608-specs.patch
git diff --no-index /dev/null webui/docs/63-static-lint-reindex-diagnosis-spec.md >> /tmp/lucy-202608-specs.patch
git diff --no-index /dev/null webui/docs/64-tiered-publish-gate-spec.md >> /tmp/lucy-202608-specs.patch
git diff --no-index /dev/null webui/docs/65-safe-log-to-eval-spec.md >> /tmp/lucy-202608-specs.patch
git diff --no-index /dev/null webui/docs/66-fde-copilot-candidate-spec.md >> /tmp/lucy-202608-specs.patch
git diff --no-index /dev/null webui/docs/plans/wo-202608-01-trace-evidence-kernel.md >> /tmp/lucy-202608-specs.patch
git diff --no-index /dev/null webui/docs/plans/wo-202608-02-static-lint-reindex-diagnosis.md >> /tmp/lucy-202608-specs.patch
git diff --no-index /dev/null webui/docs/plans/wo-202608-03-tiered-publish-gate.md >> /tmp/lucy-202608-specs.patch
git diff --no-index /dev/null webui/docs/plans/wo-202608-04-safe-log-to-eval.md >> /tmp/lucy-202608-specs.patch
git diff --no-index /dev/null webui/docs/plans/wo-202608-05-fde-copilot-candidate.md >> /tmp/lucy-202608-specs.patch
```

Expected:

- `/tmp/lucy-202608-specs.patch` exists.
- The patch contains docs only.

### Task 3: Inspect Patch Scope

Run:

```bash
cd /Users/zhangxingchen/Projects/project-lucy
grep -E "^(diff --git|\\+\\+\\+ b/|--- a/)" /tmp/lucy-202608-specs.patch
```

Expected:

- Every path is in the allowlist.
- No product code, config, Docker, example template, or lockfile paths appear.

If any excluded path appears, stop and report. Do not apply the patch.

### Task 4: Create Clean Worktree Branch

Run:

```bash
cd /Users/zhangxingchen/Projects
git -C project-lucy fetch origin
git -C project-lucy worktree add project-lucy-202608-specs origin/main -b codex/202608-reliable-delivery-specs
```

Expected:

- `/Users/zhangxingchen/Projects/project-lucy-202608-specs` exists.
- New worktree is on `codex/202608-reliable-delivery-specs`.

If the branch already exists, stop and ask the coordinator whether to reuse it or create a suffix branch such as `codex/202608-reliable-delivery-specs-v2`.

### Task 5: Apply Patch In Clean Worktree

Run:

```bash
cd /Users/zhangxingchen/Projects/project-lucy-202608-specs
git apply /tmp/lucy-202608-specs.patch
```

Expected:

- Patch applies cleanly.
- No conflict markers.

If patch application fails, do not hand-edit product files. Report the failed hunks and stop.

### Task 6: Verify Worktree Scope

Run:

```bash
cd /Users/zhangxingchen/Projects/project-lucy-202608-specs
git status --short
git diff --name-only
```

Expected changed paths are only the allowlist paths in section 2.

Also run:

```bash
git diff --name-only | grep -Ev '^(docs/lucy-202608-|docs/plans/|webui/docs/(README.md|plans/README.md|plans/wo-202608-|6[2-6]-)|docs/README.md|docs/project-overview.md)$' || true
```

Expected:

- No output.

### Task 7: Documentation Self-checks

Run:

```bash
cd /Users/zhangxingchen/Projects/project-lucy-202608-specs
npm run lint:terminology
npm run lint:spec
```

Expected:

- `lint:terminology` has no failures in the newly staged 202608 files.
- If global lint fails because of pre-existing unrelated files, record exact file and line in the execution summary.
- Do not fix unrelated lint failures in this branch.

### Task 8: Review Required 202608 Invariants

Run:

```bash
cd /Users/zhangxingchen/Projects/project-lucy-202608-specs
rg -n "Execution Waves|202608-06|busyTimeout|:memory:|Test Runner Boundaries|Work Order|high-entropy|P0 security candidate|Browser check: not required" docs/lucy-202608-upgrade-execution-control.md webui/docs/62-trace-evidence-kernel-spec.md webui/docs/65-safe-log-to-eval-spec.md webui/docs/plans/wo-202608-*.md docs/plans/wo-202608-06-dynamic-rls-poc.md
```

Expected evidence:

- `202608-06` is in Wave B and parallel with `202608-02` / `202608-03`.
- `busyTimeout` and temp DB isolation are present.
- Test runner boundaries are present.
- Safe Log-to-Eval distinguishes high-entropy credentials from semantic words.
- Every Work Order says browser check is not required.

### Task 9: Stage Docs-only Changes

Run:

```bash
cd /Users/zhangxingchen/Projects/project-lucy-202608-specs
git add docs/lucy-202608-reliable-delivery-upgrade-spec.md \
  docs/lucy-202608-upgrade-execution-control.md \
  docs/lucy-202608-dynamic-rls-poc-spec.md \
  docs/plans/README.md \
  docs/plans/wo-202608-00-spec-branch-isolation.md \
  docs/plans/wo-202608-06-dynamic-rls-poc.md \
  webui/docs/62-trace-evidence-kernel-spec.md \
  webui/docs/63-static-lint-reindex-diagnosis-spec.md \
  webui/docs/64-tiered-publish-gate-spec.md \
  webui/docs/65-safe-log-to-eval-spec.md \
  webui/docs/66-fde-copilot-candidate-spec.md \
  webui/docs/plans/wo-202608-01-trace-evidence-kernel.md \
  webui/docs/plans/wo-202608-02-static-lint-reindex-diagnosis.md \
  webui/docs/plans/wo-202608-03-tiered-publish-gate.md \
  webui/docs/plans/wo-202608-04-safe-log-to-eval.md \
  webui/docs/plans/wo-202608-05-fde-copilot-candidate.md \
  docs/README.md \
  docs/project-overview.md \
  webui/docs/README.md \
  webui/docs/plans/README.md
git diff --staged --name-only
```

Expected:

- Only allowlist files are staged.

### Task 10: Commit

Run:

```bash
cd /Users/zhangxingchen/Projects/project-lucy-202608-specs
git commit -m "docs(202608): split reliable delivery specs and work orders"
```

Expected:

- Commit succeeds.
- Commit contains docs only.

### Task 11: Post-commit Summary

Run:

```bash
cd /Users/zhangxingchen/Projects/project-lucy-202608-specs
git status --short
git show --stat --oneline --no-renames HEAD
```

Expected:

- Worktree is clean.
- Commit stat contains only docs / webui docs Markdown files.

## 4. Do Not Do

- Do not implement `Trace / Evidence Kernel`.
- Do not implement Dynamic RLS POC.
- Do not edit `webui/server/**` or `webui/src/**`.
- Do not run browser checks.
- Do not resolve unrelated global lint failures.
- Do not stage unrelated dirty files from `/Users/zhangxingchen/Projects/project-lucy`.

## 5. Handoff After Commit

After the spec branch commit exists, future development branches should fork from:

```text
codex/202608-reliable-delivery-specs
```

Suggested follow-up branches:

- `codex/202608-trace-evidence-kernel`
- `codex/202608-static-lint`
- `codex/202608-publish-gate`
- `codex/202608-safe-log-to-eval`
- `codex/202608-fde-copilot`
- `codex/202608-dynamic-rls-poc`

Minimax should execute one Work Order per branch.
