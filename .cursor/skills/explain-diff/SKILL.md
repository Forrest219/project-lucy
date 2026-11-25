---
name: explain-diff
description: >-
  Explains a just-finished or named code change (diff, branch, commit range, or
  uncommitted work) in Chinese chat: background, intuition, literate walkthrough,
  then a five-question quiz. Use when the user says explain-diff、解释这次改动、
  explain 这次、考我这次改动、按 SHA 再 explain, or asks for a teaching walkthrough
  of a PR/branch before review. Lightweight: chat only; no HTML/Notion/cloud.
---

# Explain Diff（轻量 · 随仓）

把一次代码改动讲成人能跟上的教材，再出题自检。跨设备靠 **同一 git 范围重跑**，不落云、不写 `/tmp` HTML。

灵感来自 Geoffrey Litt 的 explain-diff；本仓库版刻意轻量。

## 何时用 / 何时不用

**用：** 非琐碎功能改动、跨模块（WebUI / Proxy / ACL / semantic / demo）、准备 review 或授权下一步、换设备后要「按 SHA 再讲一遍」。

**不用：** 单行文案、纯配置包生成、用户只要 `git diff` 摘要、已明确只要 verification/UAT 证据。

## 硬规则

1. **先钉范围，再讲解。** 回复最上方必须有可复制的指纹块（见下）。缺 SHA / 脏工作区说明时不得假装可复现。
2. **默认只输出到当前对话。** 禁止写仓库外 HTML；禁止默认提交 explainer 进 git。用户明确要求落盘时，才写入 `inbox/explain-diffs/`（已 gitignore）。
3. **讲解与测验用中文。** 路径、符号、命令可保留英文。
4. **先探周边再讲 diff。** 不要只念 `git diff`；补读者理解改动所需的既有结构。
5. **测验中等难度。** 需理解实质才能答；禁止纯文件名记忆题或刁钻 trick。
6. **不替代门禁。** 本 skill 管「人是否理解」；对不对仍靠 Spec / 总账 / UAT / 测试与 verification。

## 解析改动范围

按用户指定执行；未指定时按序推断并在指纹里写明假设：

1. 显式 `A..B` / `A...B` / PR URL → 用该范围
2. 「这次」「刚改的」且工作区有未提交变更 → 未提交 + 最近相关提交（分开标注）
3. 当前分支相对默认基线（`main` / `master` / `lucy-v0.35` 等，以仓库实际为准）→ `merge-base...HEAD`
4. 无法唯一确定 → 先问一句范围，再继续

至少跑：`git status -sb`、`git log --oneline -n 15`、`git diff --stat`（及选定范围的 `git diff`）。需要时再读周边文件。

## 指纹块（每次必出）

```text
explain-diff
range: <git 范围或 "working-tree (+ optional SHAs)">
branch: <名或 detached>
base...tip: <shortSHA...shortSHA 或 n/a>
dirty: <yes|no>
topic: <一句话主题>
re-run: 在任意已 pull 的设备上说：按 <range> 再 explain / 再考我
```

## 输出结构（同一条对话内）

### 1. Background

- **宽：** 初学者可跳过的子系统背景（短）
- **窄：** 与本次改动直接相关的既有行为 / 数据流 / 配置面  
先讲「改之前是什么」，再讲「改了什么」。

### 2. Intuition

讲清本质与动机；可用玩具数据或简短 mermaid/列表示意。不堆实现细节。

### 3. Code

按**理解顺序**分组走读（不是字母序堆文件）。每组：意图 → 关键片段 → 为何动这里。点明故意未改之处（若有助于防误解）。

### 4. Quiz

正好 **5** 道选择题；每题 3–4 个选项。出题后 **先等用户作答**，再公布对错与简短解析（可一题一题，或用户一次答完再批改）。

优先覆盖：

- 核心动机 / 不变量
- 「为什么改文件 A 而不是只改 B」
- 对相邻功能的影响面（含「基本无影响」若属实）
- 失败或回滚时先怀疑哪里
- Lucy 相关时至少一题触及其一：未授权 0.30 条目是否误动、ACL/Proxy 边界、Spec/合同与实现是否同句

## 换设备 / 异步

- 不依赖本机文件或云同步。
- 用户带上指纹里的 `range` 说「再 explain / 再考我」→ 重新取 git 内容再讲；可因工作区变化与上次略有出入，以指纹为准说明。
- 同会话续考：直接出题或批改，不必重讲全文，除非用户要求。

## 明确不做

- 完整 Geoffrey HTML / Notion 交互页
- 把 explainer 当 UAT PASS 或功能闭口证据
- 与 `requesting-code-review` / Bugbot 混用成自动找 bug（用户要审缺陷时走那些流程）
