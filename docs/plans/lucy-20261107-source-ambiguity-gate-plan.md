# 多表命中先问 + 表级歧义门闩 实施 Plan

| 元数据 | 内容 |
|---|---|
| 文档类型 | 实施计划（Plan） |
| 版本 / 日期 | v0.2-draft / 2026-11-07 |
| 状态 | **v0.2-draft，待严格评审／验收；冻结落地；未授权实现**（2026-11-07）。已并入 0.30 批次第 1 轮评审（形式合规 ＋ 事实性）并已修订；待 0.30 批次第 2 轮对抗式评审。配套 Spec v0.2-draft。本阶段只评审与修订本 Plan，**暂不执行任何实现 Task** |
| 授权边界 | **不授权改代码**。须满足功能清单池 §2.2：R1 形态 → R2 对抗式评审 → R3 开工前 O 项闭合 → R4 委托人开发授权 |
| 验收 | Spec SC-01–SC-14 逐条有证据；`npm run lint:spec-docs` 退出 0；相关 vitest 全绿；歧义未确认请求零上游执行。**不构成发布取证，不表示可上线** |
| 台账号 | 无（`0.30` 台账未建立；待 PM 指派后再登记） |
| 目标分支 / 产品线 | `lucy-v0.30` / `0.30.0` |
| 需求来源 | 清单 P0-3；需求池 REQ-030-024 |
| Spec | [lucy-20261107-source-ambiguity-gate-spec.md](../specs/lucy-20261107-source-ambiguity-gate-spec.md) |
| 落位依据 | [`docs/governance/DEVELOPMENT.md`](../governance/DEVELOPMENT.md) 落盘清单与 Plan Mode |

## 1. 目标

把「多表可能命中时先问」写入动态 instructions，并在 `lucy_query`／`lucy_explain_query` 前增加表级歧义硬门闩：≥2 可见 source 命中则 stop，返回 ACL 裁剪候选；限定名错表仍可拦；不自动选表、不改 ACL。

## 2. 开工前置

1. Spec v0.1 评审通过（或修订至可交付开发）。
2. **O1**（确认载体）、**O3**（无 begin 时词来源／是否硬拦）、**O5**（纯文本 vs 词表资产）由委托人裁定并回写 Spec；**O2**／**O4** 按 Spec 默认或裁定。
3. 明确**开发授权**。
4. 建议 P0-1 Spec 决策表已可读（D8 串联 Active Binding）；P0-2 描述字段非门闩硬前置，但 SC-12 描述断言可标「若已接线」。
5. 术语标准补登记 Source Ambiguity Gate 等。
6. 基线：`npm run lint:spec-docs` 绿（存量 WARN 除外）。

## 3. 文件结构

| 文件 | 动作 | 职责 |
|---|---|---|
| `webui/config/data-qa-instructions.md` | 修改 | 扩展「问询范围确认」至多表命中；修正「代理不实现确认门闩」表述 |
| `webui/server/proxy/mcp-proxy.ts` | 修改 | 动态 instructions 合并该节；query／explain 调用门禁 |
| `webui/server/proxy/source-ambiguity.ts`（或新建 `source-ambiguity-gate.ts`） | 修改／新建 | 表级命中、候选构造；**保留**既有字段级 `ambiguousFieldHint` |
| `webui/server/proxy/query-guardrails.ts` | 修改 | 接入 source 级门禁顺序；限定名不再跳过 source 级判定 |
| `webui/server/proxy/question-experience.ts` | 复用 | `denialAllowList`／`buildRepairClosure`；旅程确认字段若落此 |
| `webui/docs/00-product-terminology-standard.md` | 修改 | 新术语 |
| `webui/server/__tests__/source-ambiguity-gate*.test.ts` | 新建 | SC 覆盖 |

**并行修改冲突热点**：`mcp-proxy.ts`、`query-guardrails.ts` 与 P0-1／P0-2 重叠——授权落地时建议：P0-2 先合描述索引；P0-3 再合 gate／instructions；P0-1 合 binding。或由同一 coder 串行。

## 4. 任务分解

### S0：决策闭合与夹具

- 回写 O1／O3／O5；准备 ≥2 命中／单命中／双角色越权／限定名错表／确认后放行夹具。
- **验证**：开工前必答项闭合。

### S1：Instructions 双路径合并

- 改 `data-qa-instructions.md`；动态拼装插入多表先问节。
- **验证**：SC-01、SC-02。

### S2：表级命中纯函数

- matchVisibleSources；度量摘要；allow-list 裁剪；不新建白名单。
- **验证**：SC-06、SC-08、SC-09、SC-11、SC-12（描述部分可 skip-if）。

### S3：query／explain 门禁与确认

- ACL 后、上游前；限定名不豁免；确认放行；上游计数 0。
- **验证**：SC-03–SC-05、SC-07、SC-13。

### S4：与 P0-1 串联

- Active Binding 存在则跳过本门闩。
- **验证**：SC-10。

### S5：术语与门禁文档

- 术语标准；清单池 P0-3／需求池 REQ-030-024 状态同句。
- **验证**：SC-14。

### S6：对抗式评审与收口准备

- 独立评审；阻断项清零后才可申请开发授权后的合并。
- **验证**：评审记录落 `docs/reviews/` 或 `inbox/` 并回链 Spec。

## 5. 验收

- Spec SC-01–SC-14 逐条有证据（SC-12 描述子句可依赖 P0-2）。
- `npm run lint:spec-docs` 退出码 0；相关 vitest 全绿。
- 未确认多表命中：**本机拒绝且上游执行计数为 0**。
- **不构成发布取证，不表示可上线**。

## 6. 完成定义

- SC-01–SC-14 均有自动化证据（或书面 skip 条件仅限 SC-12 描述子句）。
- instructions 与 tool gate **同批**合入，禁止只合文案。
- 未授权前无运行代码合入；授权后合入须附实现笔记。
- **不宣称可上线**。

## 7. 风险

| 风险 | 缓解 |
|---|---|
| O3 导致无 begin 永不硬拦 | 评审必须显式采纳或改判；配套 P0-6 Eval 强制 begin |
| 与 P0-1／P0-2 改同一文件冲突 | §3 热点串行约定 |
| 误伤宽词（「收入」「数量」） | O5 收紧；确认后放行；SC-06 单命中不拦 |
| 只合 instructions 被报完工 | 完成定义强制双层 |

## 8. 建议实施序（产品线）

本条为 **Spec 批次 S3** 主角，依赖 S1（P0-1）决策可读、受益于 S2（P0-2）描述。评审带宽优先本条与 P0-1 串联用例，不插队 P2 辅线实现。
