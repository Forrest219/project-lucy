# Lucy 双层 Release Notes 设计（自 0.30 起）

| 元数据 | 内容 |
|---|---|
| 文档类型 | 过程设计（非功能 Spec；**不构成开发授权**） |
| 版本 / 日期 | v0.1 / 2026-11-07 |
| 状态 | 设计已获委托人认可；待决定是否写入治理正文／开落地 Plan |
| 受众 | 发版／交付、产品叙述、本仓库 agent |
| 借鉴 | [Cursor Release Notes](https://cursor.com/docs/release-notes) 的主题叙事与体验段落 |
| 决策摘要 | 对外叙事 + 对内台账分文件；CHANGELOG 保留为工程层；落地时写一句草稿，发版前扩写定稿 |

## 变更

| 版本 | 日期 | 内容 |
|---|---|---|
| v0.1 | 2026-11-07 | 首立。委托人选定：受众双出口（C）、混合累积（C）、保留 CHANGELOG（A）、实施方案 1（三文件并行） |

---

## 1. 目标与非目标

### 1.1 目标

自产品线 `0.30.0` 起，每版同时具备：

1. **对外产品叙事**——客户／终端用户可读，风格接近 Cursor：按产品主题分节，写「你会看到／能做什么」，修复单独归 Fixes。
2. **对内发版台账**——延续 `docs/releases/v0.25.0-release-notes.md` 的诚实口径：版本状态、本版不主张、验证记录、客户边界、已知问题，并与 `docs/releases/vX.Y.Z.json` 对齐。
3. **工程变更层**——`CHANGELOG.md` 继续记录 Added／Fixed／Changed 短句，供开发、agent 与出包脚本使用。

### 1.2 非目标

- 不上独立营销站、RSS 或周更时间线（可后置）。
- 不取消或合并掉 `CHANGELOG.md`。
- 不把对内台账改成用户读物，也不把对外叙事写成证据边界说明书。
- 本设计本身不授权改 `release-package` 工作流；制品映射变更须另开落地 Plan／授权。

---

## 2. 三层文件与职责

| 层 | 文件 | 受众 | 写什么 | 不写什么 |
|---|---|---|---|---|
| **工程** | `CHANGELOG.md` → `## 0.30.0`（开发期可用 `## Unreleased`，收口时并入版本节） | 开发／agent／出包脚本 | Added／Fixed／Changed 短句；可带 REQ／路径 | 用户故事语气；digest／runner／CI 证据 |
| **对外叙事** | 草稿：`docs/releases/drafts/0.30.0-user.md`；定稿：`docs/releases/v0.30.0-user-facing.md` | 客户／终端用户 | 按产品主题分节；体验段落；`### Fixes` | 验证记录、不主张表、CI run id、镜像 digest、内部 WO |
| **对内台账** | `docs/releases/v0.30.0-release-notes.md` + `docs/releases/v0.30.0.json` | 发版／交付／验收 | 版本状态、本版不主张、客户边界、验证记录、已知问题；可链到 user-facing | 营销式长卖点正文（增益摘要可链出去） |

后续小版本沿用同一命名：`drafts/<ver>-user.md`、`v<ver>-user-facing.md`、`v<ver>-release-notes.md`、`v<ver>.json`。

### 2.1 硬规则

1. **三层互不替代。** 客户包内的 `lucy-release-notes.md` 默认应来自 **user-facing**（落地时再改打包脚本／约定）；台账与 json 留在仓内取证。
2. **可追性。** 用户草稿每条尽量带 `REQ-030-xxx` 或 0.30 清单 ID；CHANGELOG 同行可同 ID。
3. **诚实性。** 未落地／未授权／未验收的能力只进草稿 `### 暂缓` 或台账「本版不主张」，不得进入对外定稿正文。
4. **与 0.30 冻结衔接。** 现行阶段仅允许建草稿主题骨架与占位；**获开发授权并落地后**才往草稿追加一句用户可见事实。

---

## 3. 迭代中怎么写（落地 checklist）

### 3.1 阶段与动作

| 阶段 | 动作 | 改哪些文件 |
|---|---|---|
| Spec／Plan 评审（当前冻结落地） | 建用户草稿骨架：按 0.30 产品主题空节；已终稿确权项可加「占位标题 + REQ」；不写体验正文 | 只建／改 `docs/releases/drafts/0.30.0-user.md`；台账可只留标题骨架 |
| 获开发授权并落地 | PR／闭口时做「三点同步」（§3.2） | CHANGELOG + 用户草稿；台账一般不动 |
| 功能 Deferred／砍掉 | 从草稿正文挪到 `### 暂缓` 或删占位；台账「不主张」在收口时统一写 | 草稿；收口时台账 |
| 版本收口／打 tag 前 | 润色对外定稿 + 填台账证据（§4） | 草稿 → user-facing；release-notes + json；CHANGELOG 收口 |

### 3.2 落地时「三点同步」

对每个**用户可见**变更，同一实现 PR（或紧随的 docs PR）必须：

1. **CHANGELOG**：一行工程短句（`Added`／`Fixed`／`Changed` 等），有 REQ 则带上。
2. **用户草稿**：在对应主题下加 **一句** 用户可见事实（白话、说结果不说实现）。
3. **不做**：此时不写 Cursor 长段落；不写 digest／CI；不用「本版已交付」语气描述未验收能力。

非用户可见变更（纯内部 harness、门禁、文档治理）→ 只写 CHANGELOG（或仅 commit），**不进用户草稿**。

**正反例**

- 好：`访问日志可按调用链读完一轮问询的轮次与尝试。`
- 坏：`重构 AuditStoryline store 并对齐 AccessMap projection。`

### 3.3 Agent／人的触发点

- Spec 头部变为已交付／可验收，或实现 PR 合并前：检查三点是否齐。
- 清单池跟进状态：实现中 → 已合入时确认草稿有一句；→ Deferred 时确认不在对外正文。
- **禁止**：未授权实现却往用户草稿写「本版已支持」。

### 3.4 草稿最小结构

```markdown
# Lucy 0.30.0 — 用户可见草稿（非正式）

> 落地时只追加一句要点；发版前再扩写定稿。不得把未授权／未落地能力写成定稿语气。

## 问数与调用链
- (REQ-030-xxx) …

## 访问治理
- …

## Fixes
- …

## 暂缓（不得进定稿）
- …
```

主题名跟 [0.30 核心方向](lucy-20261107-lucy-0-30-core-direction.md)／P0 产品面走，不跟内部 WO 号走。首版骨架建立时可按当时 P0 面调整节名。

---

## 4. 发版润色与双出口收口

### 4.1 收口顺序

1. **冻结范围**：对照清单池 + Spec 头部，列出本版主张／不主张；未落地、未验收一律进台账「不主张」，并从用户定稿删除（或仅留在草稿「暂缓」）。
2. **CHANGELOG 收口**：`Unreleased` → `## 0.30.0`；工程条目与主张范围一致。
3. **扩写对外定稿**：`drafts/0.30.0-user.md` → `docs/releases/v0.30.0-user-facing.md`：
   - 按产品主题分 `###`；每条 2–5 句体验描述；
   - 修复归 `### Fixes`；
   - 无「版本状态／验证记录／digest」段落；
   - 可选文首 2–3 句「本版主题」总述。
4. **写对内台账**：`v0.30.0-release-notes.md`（版本状态、相对上版增益可链到 user-facing、本版不主张、客户边界、验证记录、已知问题）+ `v0.30.0.json`。
5. **制品映射**：客户包 `lucy-release-notes.md` ← user-facing；台账与 json 不充当客户说明书。
6. **交叉检查**：
   - user-facing 每条能在 CHANGELOG 或草稿找到来源；
   - user-facing 不出现 runner／digest／「不主张」表；
   - 台账「不主张」与 user-facing 正文交集为空。

### 4.2 对外文风

- 中文为主；专有名词可保留英文。
- 一条一个结果；可写「之前怎样 → 现在怎样」；避免堆内部功能名。
- 对标 Cursor 的主题感与可读性，篇幅按 Lucy 版本幅度控制，不追求等长。

### 4.3 与 0.30 现行阶段

- **现在可做**：建 `drafts/0.30.0-user.md` 主题骨架；将本设计要点摘入 `docs/governance/DEVELOPMENT.md`（或发版 runbook）——须另获「写入治理」确认。
- **不可做**：未授权／未落地能力写成定稿语气；擅自改 `release-package` 除非另授权。
- **首版试点**：`0.30.0` 正式收口时跑通双出口；之后版本同一套路。

---

## 5. 与现有资产的关系

| 现有资产 | 关系 |
|---|---|
| `docs/releases/v0.25.0-release-notes.md` | 对内台账模板；0.30 台账继续此结构，增益叙述改为链到 user-facing |
| `docs/governance/release-ci.md` §4 `lucy-release-notes.md` | 语义上应改为打包 user-facing；**改脚本属落地工作，本设计不自动执行** |
| `docs/runbooks/lucy-release-train-workflow.md` | 收口 checklist 可增加「三点同步／双出口交叉检查」项（落地时改） |
| `docs/plans/lucy-20261107-lucy-0-30-feature-inventory-pool.md` | 主张范围与暂缓的权威跟进源之一；RN 不另立优先级 |
| `docs/user-guide/release-notes.html` | 若继续给用户看，应与 user-facing 同源或由其生成；避免第三套正文 |

---

## 6. 落地后续（需另授权）

本设计批准后，建议的可选下一步（**每一项仍须委托人明示**）：

1. 写入治理摘录（`DEVELOPMENT.md` 或 release runbook 短节）。
2. 创建 `docs/releases/drafts/0.30.0-user.md` 主题骨架（可与治理摘录同批）。
3. 开 Plan：发版收口时 user-facing → `lucy-release-notes.md` 的打包映射与交叉检查。
4. `0.30.0` 正式发版时首次执行 §4 全流程。

---

## 7. 决策记录

| 项 | 选择 |
|---|---|
| 受众 | C：对外叙事 + 对内台账分两份 |
| 累积时机 | C：落地写一句草稿要点；发版前扩写 Cursor 风格 |
| CHANGELOG | A：保留为工程第三层 |
| 组织方式 | 方案 1：三文件并行 |
| §1–§3 设计 | 2026-11-07 委托人接受 |
