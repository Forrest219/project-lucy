# Lucy 轻量概念注册表（ontology-lite）Plan

| 元数据 | 内容 |
|---|---|
| 文档类型 / 版本 | 实施计划 / **v0.4** |
| 日期 / 目标版本 | 2026-11-09 / 产品线 `0.30.0`（分支 `lucy-v0.30`）；清单 **P1-10**；**不挡**原 P0 |
| 台账号 | 无（0.30 台账未建立） |
| 状态 | **v0.6；R2-F＋R4 已闭合（2026-11-09）；一期 CLI 已落地（S0–S7／`npm run concepts`）；待效果门**（P1-10／REQ-030-031；交付序 CLI→效果门→WebUI→MCP）。本条不表示可上线；**不含** WebUI／MCP |
| 授权边界 | R2-F＋R4 已闭合（R4：2026-11-09）。授权范围＝本 Plan S0–S7 一期 CLI 实现与测试；**不**表示可上线；**不含** WebUI／MCP |
| 验收 | S0–S7 各自出口见 §验收；本条总出口＝Spec SC-01–SC-17 全部关闭；**不**含 WebUI／MCP；**不**含效果门后的人审页 |
| 对应 Spec | [lucy-20261108-concept-registry-ontology-lite-spec.md](../specs/lucy-20261108-concept-registry-ontology-lite-spec.md)（**v0.6-draft**） |
| 需求池条目 | REQ-030-031 |
| 清单条目 | P1-10 |
| 评审记录 | [Codex 对抗评审](../reviews/2026-11-09-concept-registry-ontology-lite-codex-review.md)（过程对抗；**不构成终稿确权**） |

## 变更记录

| 版本 | 说明 |
|---|---|
| v0.1-draft | 首开 Plan：S0–S7、CLI／`concepts/` 落点 |
| v0.2-draft | Codex R1 修订：对齐 Spec v0.4（D13–D19、SC-09–12）；钉死内容根、Binding 身份、匹配、权威一致性、原子写、差分白名单、门禁登记；状态镜像同句 |
| v0.3-draft | Codex R2 修订：对齐 Spec v0.5（D13 项目根、D15 确定性置信、D16 不变量、D17 候选失效、D19／F-08 白名单、D20 id 围栏、D21 list／show 即时冲突；SC-13／14） |
| v0.4-draft | Codex R3 后作者侧闭合：currentlyMatches、固定 diff 基线、文件名／id 一致、conceptsDir 禁 symlink；验收 SC-01–17 |
| v0.4 | **R2-F＋R4**：委托人 2026-11-09 明示认可并授权进入开发；实现中 |

> **For agentic workers（获 R4 后）:** 按 S0→S7 执行。未获 R4 前禁止改运行代码。一期 **不改 WebUI**。

**Goal:** CLI + `concepts/` 注册表：扫描概念候选与冲突，人定权威；一期不碰 MCP／WebUI。

**Architecture:** Node ESM：`model`／`store`／`scan`／`cli` 分离；内容根解析对齐 `paths.ts`；`concepts/` 不进 KTX `CONTENT_DIR_NAMES`。

**Tech Stack:** Node.js ESM、`yaml`、`node:fs`／`node:path`、`node --test`。

## Global Constraints

- Spec D11／D13–D21；SC-01–SC-17
- 一期 WebUI／MCP 热路径零产品行为变更
- 扫描不得自动 canonical；不得改 summary；权威不变量失败关闭
- 一期不做 `skill` kind、不做 `possible_merge`
- stock macOS bash 3.2 兼容（若加 shell 包装）
- **未授权实现前步骤不得开工**

---

## 目标

1. 落地 `<contentRoot>/concepts/<id>.yaml`（Spec §4）。
2. CLI：`scan`／`list`／`show`／`set-canonical`／`reject`／`summary`。
3. 夹具关闭 Spec SC-01–SC-17。
4. 登记 `npm` 命令与测试入口到测试门禁文档（F-08）。

## 开工前置

1. **终稿确权 + R4 开发授权**（未授权前 S0–S7 不得开始）。
2. Spec／Plan 索引齐；`lint:spec-docs` 对本对无新增阻塞。
3. 术语登记纳入 R4 范围（S0 写 `webui/docs/00-product-terminology-standard.md`）。
4. 冻结边界：不改 `webui/src/**`、`webui/server/proxy/**`、不新增浏览器 API、不把 `concepts` 加入 KTX 镜像名单。
5. 与已授权 P0 争文件时 P0 优先。

## 文件结构

| 路径 | 职责 |
|---|---|
| `scripts/concepts/content-root.mjs` | D13 内容根解析 |
| `scripts/concepts/model.mjs` | 校验、不变量、Conflict、匹配／置信、bindingId／sameRef |
| `scripts/concepts/store.mjs` | 原子读写 YAML；扫描合并策略 |
| `scripts/concepts/scan.mjs` | 读 semantic-layer／wiki；遍历已有∪proposal |
| `scripts/concepts/cli.mjs` | 子命令 |
| `scripts/concepts/seed-whitelist.yaml` | 收入／资产种子（Spec §4.4 schema） |
| `scripts/concepts/__tests__/*.test.mjs` | `node --test` |
| `package.json` | `"concepts": "node scripts/concepts/cli.mjs"`；可选 `"concepts:test": "node --test scripts/concepts/__tests__/*.test.mjs"` |
| `docs/governance/test-layers-and-release-gates.md` | 登记上述命令（§2 Current Commands；是否进 CI＝否／仅本机） |
| `webui/docs/00-product-terminology-standard.md` | 术语 |
| **禁止改动** | `webui/server/proxy/**`、`webui/src/**`、为 concepts 新增 server 路由、`paths.ts` 的 `CONTENT_DIR_NAMES` 扩容 |

### 差分边界（D19／SC-05／SC-08）

允许：
- `scripts/concepts/**`
- `package.json`：**仅** `scripts.concepts` 与 `scripts.concepts:test` 键（内容级比对；其他键变化＝越界）
- `webui/docs/00-product-terminology-standard.md`
- `docs/governance/test-layers-and-release-gates.md`（命令登记）
- 本条 Spec／Plan／review／`docs/README.md`／`docs/plans/README.md`／清单与需求池中本条镜像行
- 试点报告（`inbox/`，可不入库）

收口检查：S0 写入 `CONCEPTS_DIFF_BASE=<commit>`（或环境变量）。检查集合＝  
`git diff --name-only $BASE`（已提交相对基线）∪ `git diff --name-only --cached` ∪ `git diff --name-only` ∪ `git ls-files --others --exclude-standard`。  
路径白名单过滤；`package.json` 相对 `$BASE:package.json` 做脚本键内容级 diff。  
反例须真实失败（含**先提交再检查**）：改 `query-guardrails` 并 commit；新增 server 路由并 commit；改其他 scripts 键；未跟踪越界文件。

### 注册表／CLI 合同

见 Spec §4–§5。CLI：

```text
node scripts/concepts/cli.mjs <cmd> [--content-root <dir>] [--whitelist <file>]
# 默认内容根：D13；默认白名单：scripts/concepts/seed-whitelist.yaml
scan [--report <path>]
list [--conflicts-only]
show <conceptId>
set-canonical <conceptId> <bindingId> --summary <text>
reject <conceptId> <bindingId>
summary <conceptId> --text <text>
```

### 浏览器验证

- 不适用：一期不改变用户可见 WebUI 表面。

---

## 实施步骤

| 步骤 | 内容 | 产出 | 关联验收 |
|---|---|---|---|
| S0 | 术语；`seed-whitelist.yaml`；门禁文档登记 `concepts`／`concepts:test` | 术语＋种子＋门禁行 | 前置、F-08、D7 |
| S1 | `content-root.mjs`＋`model.mjs`：D13／§4.2–4.5／Conflict | 单测 | SC-02／06／07／10／12 |
| S2 | `store.mjs`：原子写、扫描合并、不变量 | 单测 | SC-03／04／07／11 |
| S3 | `scan.mjs`：逻辑 sourceName、§4.4 匹配、已有∪proposal、broken_canonical | 夹具内容根单测 | SC-01／02／06／09／12 |
| S4 | `cli.mjs`＋package.json 脚本 | CLI 测试 | SC-01／03／04 |
| S5 | 差分白名单检查脚本或收口清单自动化 | 越界失败证明 | SC-05／08 |
| S6 | 试点 scan 收入／资产；报告 `inbox/` | 效果门输入 | 非 SC |
| S7 | SC-01–SC-17 落点；四 lint；状态镜像同句；收口记录 | 收口 | 全 SC |

**依赖**：S0→S1→S2→S3→S4→S5→S6→S7。

### 关键夹具（必须落进测试）

```js
// SC-10 content root
// flag > env > yaml > default; cwd≠projectRoot 仍解析到 projectRoot/config

// SC-12 noise
// text "资产管理人员" + alias "资产" => no high/medium candidate

// SC-07 invariant
// canonical=A + role(B)=canonical => load/save throws

// SC-03/04
// after set-canonical/reject, rescan keeps role+summary; evidence append-only on protected

// SC-09
// delete last asset for canonical concept => broken_canonical; canonical+summary kept

// SC-11
// mock rename fail => exit non-zero; file bytes unchanged
```

---

## 验收

### 步骤出口

| 步骤 | 出口判定 |
|---|---|
| S0 | 术语已登记；白名单符合 §4.4；`test-layers-and-release-gates.md` 已登记命令 |
| S1 | SC-02／06／07／10／12 有直接断言 |
| S2 | SC-03／04／07／11 有直接断言 |
| S3 | SC-01／02／06／09／12 有直接断言；逻辑名路径正确 |
| S4 | 六子命令；非法 bindingId 非 0 |
| S5 | 白名单外路径失败；反例文档化 |
| S6 | 试点报告可给效果门 |
| S7 | SC-01–SC-17 关闭；lint 四件套；镜像同句 |

### 门禁

| 命令 | 期望 |
|---|---|
| `npm run concepts:test`（或 `node --test scripts/concepts/__tests__/*.test.mjs`） | 全绿 |
| `npm run lint:spec-docs` | 本 Spec／Plan 无新增阻塞 |
| `npm run lint:spec` / `lint:terminology` / `lint:ia-boundary` | exit 0 |

### 证据等级

本机自动化＋lint。试点报告非硬门禁。客户／Agent 准备率／WebUI／MCP 不在出口。

## 完成定义

- [ ] Spec SC-01–SC-17 全部关闭并写入收口记录
- [ ] CLI 与 `concepts/` 形状符合 Spec §4–§5
- [ ] 差分边界未越界；原子写失败保权威
- [ ] 测试门禁文档已登记新命令
- [ ] 状态镜像与 Spec 头部**同一句现值**
- [ ] 收口注明「不表示可上线」；效果门／WebUI／MCP 为后续

## 风险

| 风险 | 缓解 |
|---|---|
| 别名噪声 | §4.4＋SC-12 |
| 双源真理 | 只写 `concepts/` |
| 未授权开工 | 开工前置 |
| 差分漏网 | D19＋SC-05 反例 |
| 写入中断丢权威 | D18＋SC-11 |

## 回滚

还原 `scripts/concepts/**`、package.json 脚本键、术语行；删除内容根 `concepts/`。无 WebUI／MCP／DB 迁移。

## 本 Plan 自检（对照 Spec v0.4）

| Spec | Plan |
|---|---|
| D13–D19／§4–§5 | S1–S5 Global Constraints |
| SC-01–SC-17 | 步骤出口与夹具 |
| F-08 门禁登记 | S0＋完成定义 |
| 状态同句 | 头部状态＝Spec 状态句 |
