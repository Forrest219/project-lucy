# P1-27 Ops 概念代码根运行时装配 · Kimi Code 对抗式评审记录

| 元数据 | 内容 |
|---|---|
| 文档类型 | 评审记录（**不是** Spec） |
| 版本 / 日期 | v0.4／2026-11-15 |
| 对象 | [Spec](../specs/lucy-20261115-ops-concept-code-root-runtime-fix-spec.md) · [Plan](../plans/lucy-20261115-ops-concept-code-root-runtime-fix-plan.md)（现行 **v0.5-draft**） |
| 清单／REQ | P1-27／REQ-030-048（**不入核心分母**） |
| 授权边界 | **过程对抗 ≠ 终稿确权 ≠ 开发授权 ≠ 可上线** |
| Brief | `inbox/20261115-p1-27-kimicode-adversarial-brief.md` |

## 总览

| 轮 | 输入稿 | 结果 | 原始产物 |
|---|---|---|---|
| R1（Kimi） | Spec／Plan **v0.1-draft** | **CONDITIONAL**（major 3，minor 3） | `inbox/20261115-p1-27-kimicode-r1.md` |
| 修订 | → **v0.2-draft** | F-01…F-06 已落盘闭合 | Spec／Plan／本记录 |
| R2（Kimi） | v0.2-draft | **CONDITIONAL**（新 minor 3；无新 major） | `inbox/20261115-p1-27-kimicode-r2.md` |
| 修订 | → **v0.3-draft** | R2-01…R2-03 已落盘闭合 | Spec／Plan／本记录 |
| R3（Kimi） | v0.3-draft | **CONDITIONAL**（新 minor 3；无新 major／blocker） | `inbox/20261115-p1-27-kimicode-r3.md` |
| 修订 | → **v0.4-draft** | R3-01…R3-03 已落盘闭合 | Spec／Plan／本记录 |
| 委托人裁决 | 2026-11-15 | **1A／2A／3A／4C** → **v0.5-draft**（`gitDirty` 硬门禁）；送 Codex CLI 终审 | 本记录 |

## 门禁状态

| 项 | 状态 |
|---|---|
| Kimi 过程对抗 | **三轮完成** → v0.4；裁决落盘 → **v0.5-draft** |
| 委托人裁决 | **1A** 写分支纳入本条；**2A** 可控错误码透传；**3A** `gitDirty=false` 硬门禁；**4C** Codex CLI 终审 |
| R2-F 终稿确权 | **进行中**（Codex CLI 终审；过程对抗不构成） |
| 开发授权（R4） | **未**；禁止改运行代码 |

## R1 要点与 v0.2-draft 处置

全文：`inbox/20261115-p1-27-kimicode-r1.md`。结论：**CONDITIONAL**。

| ID | 级别 | 摘要 | v0.2-draft 处置 |
|---|---|---|---|
| F-01 | major | Plan 把 ops-tools／mcp-proxy 标「若需」；读分支无 try/catch＝502＋审计跳号根因 | **已闭合**：Task 2 强制；不变量不得抛；mcp-proxy 默认不改 |
| F-02 | major | D5 软措辞／写路径加载失败未统一稳定码 | **已闭合**：单一码 `ops_concept_runtime_unavailable`；写路径同码 |
| F-03 | major | Plan「或 cwd」可假绿 | **已闭合**：禁 cwd；唯一 `import.meta.url` 祖先查 `store.mjs` |
| F-04 | minor | vitest L254／340／510 whitelist 未枚举 | **已闭合**（后续 R2 扩至全部锚点） |
| F-05 | minor | 复测无 gitSha 门禁 | **已闭合**（后续 R2 加 gitDirty） |
| F-06 | minor | whitelist 首参仍名 projectRoot | **已闭合**：D9／Task 1 改名 codeRoot |

## R2 要点与 v0.3-draft 处置

全文：`inbox/20261115-p1-27-kimicode-r2.md`。结论：**CONDITIONAL**。

| ID | 级别 | 摘要 | v0.3-draft 处置 |
|---|---|---|---|
| R2-01 | minor | 另有 7 处 projectRoot 直接 import 未枚举 | **已闭合**：SC-07／Task 3 全锚点＋rg 0 |
| R2-02 | minor | 读 catch 范围／错误码撒谎 | **已闭合**：整读分支＋分码 |
| R2-03 | minor | 仅比 gitSha，脏树可通过 | **已闭合**：`gitDirty≠true` |

## R3 要点与 v0.4-draft 处置

全文：`inbox/20261115-p1-27-kimicode-r3.md`。结论：**CONDITIONAL**（过程终轮；**≠ R2-F**）。

| ID | 级别 | 摘要 | v0.4-draft 处置 |
|---|---|---|---|
| R3-01 | minor | 写分支 try 外：`getOpsDatabase`／`loadPlanRow`／`enforceOwnerOnly` 仍可上抛 | **已闭合**：D5＋Plan Task 2 Step 3 强制移入 catch／收敛信封 |
| R3-02 | minor | 加载／非加载分码判别器未指定 | **已闭合**：D5／Task 1＝可控错误码；ops-tools catch 透传 `err.code`，无 code→`ops_tool_failed` |
| R3-03 | minor | 文件地图仍只写 L254／340／510 | **已闭合**：文件地图对齐全锚点／Task 3 Step 2 |

## 过程对抗结论（非确权）

- 三轮均 **CONDITIONAL**；major／blocker 已在 v0.2 闭合；R2／R3 minor → v0.4；裁决 1A／2A／3A → **v0.5-draft**。
- **4C**：R2-F 走 Codex CLI 终审（见 `docs/reviews/2026-11-15-codex-review-ops-concept-code-root-runtime-fix.md`）。
- 本 Kimi 记录 **不**构成终稿确权、开发授权或可上线。

## 变更

| 版本 | 内容 |
|---|---|
| v0.1 | R1 落盘＋v0.2 处置；R2／R3 占位 |
| v0.2 | R2 落盘＋v0.3 处置；R3 占位 |
| v0.3 | R3 落盘＋v0.4 处置；三轮过程对抗收束 |
| v0.4 | 委托人 1A／2A／3A／4C → v0.5；送 Codex 终审 |
