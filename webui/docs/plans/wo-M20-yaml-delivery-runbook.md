# M20 YAML Delivery Runbook And Self-Check Work Order

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make Lucy Help Center capable of long-term self-service YAML operations by adding a complete YAML file specification, delivery checklist, common error guide, and Agent self-check protocol to the system handbook.

**Architecture:** This is a documentation-first safety gate. The single user-facing fact source remains `docs/SYSTEM_HANDBOOK.md`, served by the existing Help API. M20 adds structured runbook content and targeted tests so humans and Agent tools can perform consistent GO / NO-GO checks before YAML reaches customer runtime.

**Tech Stack:** Markdown, existing Help API, existing TOC parser in `webui/server/help.ts`, Vitest, React Help Center smoke tests if UI behavior changes. No external dependency, no LLM service, no MCP exposure.

**Source Spec:** [../24-yaml-delivery-runbook-spec.md](../24-yaml-delivery-runbook-spec.md)

---

## Context For Developer

Read these documents before editing:

- `webui/docs/24-yaml-delivery-runbook-spec.md`
- `docs/SYSTEM_HANDBOOK.md`
- `docs/design-system-handbook-help.md`
- `docs/DEVELOPMENT.md`
- `webui/docs/17-static-catalog-loading-spec.md`
- `webui/docs/21-connection-catalog-upload-ux-spec.md`
- `webui/docs/23-semantic-asset-publish-export-spec.md`

Read these files for Help behavior:

- `webui/server/help.ts`
- `webui/server/__tests__/help.test.ts`
- `webui/src/pages/HelpCenter.tsx`
- `webui/src/__tests__/help-center.test.tsx`

Incident context to preserve in generic form:

- A manifest file under `_schema/` was valid.
- Two business semantic YAML files were intended to augment existing `ai_metric_*` manifest sources.
- Their filenames and `name` values created new `international_*` sources instead.
- Their `table:` fields pushed them toward independent source semantics.
- One overlay repeated an incomplete `columns:` block, causing measure / segment expressions to reference missing columns.
- `admin reindex` success did not prove the target source had received the intended measures.

Non-negotiable boundaries:

- Do not write customer-specific secrets, hosts, usernames, passwords, or token values into docs.
- Do not move YAML delivery rules into `webui/config/data-qa-instructions.md`.
- Do not modify `CLAUDE.md`.
- Do not expose Help content to MCP tools.
- Do not implement runtime upload validation in M20 unless explicitly approved as follow-up.
- Preserve Help API's fixed bundled handbook source.
- Treat existing dirty worktree changes as user-owned unless directly part of this work order.

---

## Task 1: Update Handbook Information Architecture

**Files:**

- Modify: `docs/SYSTEM_HANDBOOK.md`
- Test: `webui/server/__tests__/help.test.ts`

**Step 1: Add the new section to the top TOC**

Add a new item under current module guide / FAQ structure:

```markdown
- [3.7 YAML 文件规范与交付验收](#37-yaml-文件规范与交付验收)
```

If the handbook TOC is manually maintained, keep the visible order:

```text
3. 功能模块操作指南
  3.1 ...
  3.7 YAML 文件规范与交付验收
4. Agent / 客户端接入指南
```

**Step 2: Add a failing Help TOC test**

In `webui/server/__tests__/help.test.ts`, extend the TOC expectations or add a focused test for the new stable heading alias:

```ts
expect(parseHelpToc("## 3.7 YAML 文件规范与交付验收")).toEqual([
  { id: "yaml-delivery-runbook", level: 2, title: "3.7 YAML 文件规范与交付验收" }
]);
```

Expected before implementation: FAIL if `help.ts` has no alias.

**Step 3: Add stable section aliases**

Modify `webui/server/help.ts`:

```ts
[/YAML 文件规范与交付验收|YAML Delivery/i, "yaml-delivery-runbook"],
[/Schema manifest 规范|Schema Manifest/i, "yaml-schema-manifest"],
[/Manifest augmentation overlay|augmentation overlay|Overlay 规范/i, "yaml-augmentation-overlay"],
[/GO \/ NO-GO|交付 checklist|交付验收/i, "yaml-delivery-checklist"],
[/Agent 自检协议/, "yaml-agent-self-check"]
```

**Step 4: Run the focused test**

Run:

```bash
cd <PROJECT_ROOT>/webui
npm test -- help
```

Expected: PASS.

**Step 5: Commit**

Commit after Task 1 if the repository state is clean enough to commit only these files:

```bash
git add docs/SYSTEM_HANDBOOK.md webui/server/help.ts webui/server/__tests__/help.test.ts
git commit -m "docs(help): add yaml delivery handbook section anchors"
```

---

## Task 2: Write YAML Type Reference

**Files:**

- Modify: `docs/SYSTEM_HANDBOOK.md`

**Step 1: Add YAML type overview**

Create section:

```markdown
### 3.7 YAML 文件规范与交付验收

#### 3.7.1 YAML 类型总览
```

Include a table with:

- `ktx.yaml`
- `semantic-layer/<conn>/_schema/<schema>.yaml`
- `semantic-layer/<conn>/<source>.yaml` as manifest augmentation overlay
- `semantic-layer/<conn>/<source>.yaml` as new semantic source
- `wiki/**/*.md` frontmatter
- `evals/<domain>/eval/*-eval-cases.yaml`
- `webui/config/access.yaml`

**Step 2: Add ownership and upload safety**

For each YAML type include:

- Path.
- Purpose.
- Maintainer.
- Whether hand upload is allowed.
- Required post-change validation.

**Step 3: Add examples**

Add one minimal safe example each for:

- Schema manifest.
- Existing source augmentation overlay.
- New semantic source with warning label.
- `access.yaml` table selector tied to source names.

Use sanitized names only. Do not include real customer hosts or credentials.

**Step 4: Self-review**

Run:

```bash
rg -n "password:|token:|Authorization|<REDACTED>|CHANGE-ME" docs/SYSTEM_HANDBOOK.md
```

Expected:

- No real secret values.
- Examples use placeholders only.

---

## Task 3: Write Manifest / Overlay Hard Rules

**Files:**

- Modify: `docs/SYSTEM_HANDBOOK.md`

**Step 1: Add Schema Manifest rules**

Include these hard rules:

- Manifest lives under `_schema/`.
- Top-level shape is `tables:`.
- Physical columns use `descriptions:`.
- Column-level `description:` is forbidden for physical columns.
- Do not hand-write derived `expr` columns into manifest.
- Do not hand-edit physical column structures as a substitute for scanning.

**Step 2: Add Manifest Augmentation Overlay rules**

Include these hard rules:

- Filename equals manifest source name.
- Top-level `name` equals manifest source name.
- Default no `table:` for augmentation overlays.
- Default no repeated physical `columns:`.
- Derived columns may appear in overlay `columns:` only when they have `expr`.
- Derived columns must not reuse manifest physical column names.
- Measures and segments can use singular `description:`.

**Step 3: Add New Semantic Source warning**

Document that a new source is a deliberate advanced operation and requires:

- Business reason.
- ACL update.
- Wiki / Eval update.
- Agent smoke update.
- `sl read` and real query validation.

**Step 4: Add anti-pattern examples**

Add short bad / good examples:

```yaml
# Bad: intended overlay creates a new source
name: international_country_metrics
table: chatbi.ai_metric_international_country_daily
```

```yaml
# Good: augments existing manifest source
name: ai_metric_international_country_daily
```

Keep examples generic and sanitized.

---

## Task 4: Add GO / NO-GO Checklist

**Files:**

- Modify: `docs/SYSTEM_HANDBOOK.md`

**Step 1: Add static file checklist**

Checklist must include:

- Paths.
- Filename / `name` equality.
- `table:` presence / absence.
- Repeated `columns:` detection.
- Description field shape.
- Expression column references.
- Unexpected new source files.

**Step 2: Add KTX validation checklist**

Include commands:

```bash
ktx --project-dir /data/lucy admin reindex --force
ktx --project-dir /data/lucy sl validate <source-name> --connection-id <conn>
ktx --project-dir /data/lucy sl read <source-name> --connection-id <conn>
```

Make clear:

- `reindex` success alone is not enough.
- Single new source `validate` success alone is not enough.
- `sl read` must prove the target source contains full physical columns and intended measures / segments.

**Step 3: Add query and MCP smoke**

Include:

```bash
ktx --project-dir /data/lucy sl --connection-id <conn> query \
  --measure <source>.<measure> \
  --dimension <source>.<dimension> \
  --limit 5 \
  --execute \
  --max-rows 5
```

Include smoke questions:

```text
Lucy 能读取什么数据？
<指定日期> <业务核心指标> 是多少？
<指定日期> 按平台拆分的 <业务核心指标> 是多少？
```

**Step 4: Add final gate**

Final wording:

```markdown
只有全部 checklist 通过，才允许把 YAML 包交付客户或发布到正式 `/data/lucy`。
```

---

## Task 5: Add Common Error Playbook

**Files:**

- Modify: `docs/SYSTEM_HANDBOOK.md`

**Step 1: Add symptoms table**

Include at least:

- `segment references unknown column(s)`.
- `Unrecognized key: "description"`.
- `reindex scanned` count unexpectedly increases.
- original source has `measures: []`.
- MCP `table_forbidden`.
- Agent chooses wrong source.
- `MANIFEST_PARSE_FAILED`.

**Step 2: Add diagnostic commands**

Use:

```bash
rg -n "^name:|^table:|^columns:|description:|descriptions:" semantic-layer/<conn>
find semantic-layer/<conn> -maxdepth 2 -type f -name "*.yaml" | sort
ktx --project-dir /data/lucy sl read <source-name> --connection-id <conn>
curl -s "http://127.0.0.1:5174/api/admin/audit?outcome=denied&limit=20"
```

**Step 3: Update existing FAQ**

Patch:

- `6.1 为什么提示“未发现本地 manifest”？`
- `6.3 配置文件改动后什么时候生效？`
- `6.7 为什么白名单表保存失败？`
- `6.9 最小健康检查清单`

Add cross-links to `3.7`.

---

## Task 6: Add Agent Self-Check Protocol

**Files:**

- Modify: `docs/SYSTEM_HANDBOOK.md`

**Step 1: Add Agent inputs**

Document required inputs:

- File list and content.
- Target project root.
- Target connection id.
- Target manifest `_schema/*.yaml`.
- Target Agent role / `access.yaml` when available.
- Business smoke questions.

**Step 2: Add required output template**

Add:

````markdown
## 结论
GO / NO-GO

## 阻断项
- [P0] ...

## 风险项
- [P1] ...

## 文件级检查
| 文件 | 类型 | 结论 | 理由 |

## 必须修改
1. ...

## 验收命令
```bash
...
```

## GO 门槛
- [ ] ...
````

**Step 3: Add agent rules**

Agent must not:

- Declare GO from `reindex` success alone.
- Declare GO from one `validate` on an unintended new source.
- Ignore ACL for newly created sources.
- Modify or reveal secrets.
- Write customer YAML without explicit user approval.

---

## Task 7: Update Help Tests And Build

**Files:**

- Modify: `webui/server/__tests__/help.test.ts`
- Modify: `webui/src/__tests__/help-center.test.tsx` only if UI assumptions change

**Step 1: Extend TOC tests**

Assert the handbook TOC contains:

- `yaml-delivery-runbook`
- `yaml-augmentation-overlay`
- `yaml-delivery-checklist`
- `yaml-agent-self-check`

**Step 2: Add content smoke test**

If a server test reads the real bundled handbook, assert markdown contains:

```text
reindex 成功
GO / NO-GO
Manifest augmentation overlay
```

**Step 3: Run tests**

Run:

```bash
cd <PROJECT_ROOT>/webui
npm test -- help
npm test -- --run
npm run build
```

Expected:

- All tests pass.
- Build passes with only known Vite chunk-size warning.

---

## Task 8: Register Docs Indexes

**Files:**

- Modify: `webui/docs/README.md`
- Modify: `webui/docs/plans/README.md`
- Optionally Modify: `docs/project-overview.md`

**Step 1: Register spec**

Add:

```markdown
| [24-yaml-delivery-runbook-spec.md](24-yaml-delivery-runbook-spec.md) | YAML 交付规范与自助运维手册：manifest/overlay/new source 分型、GO/NO-GO checklist、Agent 自检协议 | 产品 / 文档 / 运维 / Agent |
```

**Step 2: Register work order**

Add:

```markdown
| [wo-M20-yaml-delivery-runbook.md](wo-M20-yaml-delivery-runbook.md) | M20 | YAML 交付规范进入 Help Center：用途、规则、常见错误、交付 checklist 与 Agent 自检协议 |
```

**Step 3: Final review**

Run:

```bash
git diff -- docs/SYSTEM_HANDBOOK.md webui/docs/24-yaml-delivery-runbook-spec.md webui/docs/plans/wo-M20-yaml-delivery-runbook.md webui/docs/README.md webui/docs/plans/README.md webui/server/help.ts webui/server/__tests__/help.test.ts
```

Check:

- No secret values.
- No customer-specific file paths except generic `/data/lucy`.
- No MCP runtime instructions pollution.
- Help section names match test aliases.

**Step 4: Commit**

Commit only M20 files:

```bash
git add docs/SYSTEM_HANDBOOK.md webui/docs/24-yaml-delivery-runbook-spec.md webui/docs/plans/wo-M20-yaml-delivery-runbook.md webui/docs/README.md webui/docs/plans/README.md webui/server/help.ts webui/server/__tests__/help.test.ts
git commit -m "docs(help): add yaml delivery runbook plan"
```
