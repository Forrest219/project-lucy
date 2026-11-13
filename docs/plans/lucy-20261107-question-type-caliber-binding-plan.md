# 问题类型口径绑定 实施 Plan

| 元数据 | 内容 |
|---|---|
| 文档类型 | 实施计划（Plan） |
| 版本 / 日期 | v0.9 / 2026-11-08 |
| 状态 | **v0.9；R4 已授予；实现已合入；功能合同已收口（2026-11-13）**（SC-01–SC-30；见证据审计）；配套 Spec v0.9。**不宣称可上线** |
| 授权边界 | **已授权改代码（本条范围）**。R4：2026-11-08；主体 Claude Code；Cursor Agent review。不构成发布取证／可上线。 |
| 验收 | Spec SC-01–SC-30 逐条有证据（授权实现后执行；SC-30 真实进程故障）；`npm run lint:spec-docs` 退出 0；相关 vitest 全绿；SC-17c 真实进程局部故障。**不构成发布取证，不表示可上线** |
| 目标分支 / 产品线 | `lucy-v0.30` / `0.30.0` |
| 需求来源 | 清单 P0-1；需求池 REQ-030-027 |
| Spec | [lucy-20261107-question-type-caliber-binding-spec.md](../specs/lucy-20261107-question-type-caliber-binding-spec.md) |
| 评审记录 | [Codex 对抗式评审](../reviews/2026-11-07-question-type-caliber-binding-codex-review.md) |
| 落位依据 | [`docs/governance/DEVELOPMENT.md`](../governance/DEVELOPMENT.md) 落盘清单与 Plan Mode |

## 1. 目标

把「问题类型 → 唯一表 + 固定口径」落成可发布资产 + Proxy 硬门禁；命中后 Agent 无法自行加工口径。

## 2. 开工前置

1. ~~Spec／Plan 终稿确权~~ **已完成**（委托人 2026-11-07）。
2. ~~O1／O2 委托人裁定~~ **已完成**（委托人 2026-11-07；选项「1」＝全采纳闭合包；Spec §4.1／§4.2）。
3. ~~开发授权（R4）~~ **已授予**（委托人 2026-11-08：Claude Code 实现 ＋ Cursor Agent code review）。
4. 术语标准补登记。
5. 复用 `acl.ts` `CanonicalSourceKey`／sourceMap（禁止自写前缀拼接）。
6. `npm run lint:spec-docs` 绿（存量 WARN 除外）。

> **授权已生效**：可执行 S0–S5 实现 Task；完成后不得自称可上线，须另走发布取证。

## 3. 文件结构

| 文件 | 动作 | 职责 |
|---|---|---|
| `webui/server/proxy/caliber-binding.ts` | 新建 | BindingSession（含 `commitPhase`／`boundKey`／`caliberSnapshot`）、加载、匹配、D7／D12 校验 |
| `webui/server/proxy/mcp-proxy.ts` | 修改 | begin 临界区；query／explain 注入前门禁 |
| `webui/server/proxy/acl.ts` | 复用／必要时导出 | CanonicalSourceKey、collect 键集 |
| publish／content-mirror／paths | 按 O1 | `caliber-bindings/` |
| 术语标准 | 修改 | 新术语 |
| `__tests__/caliber-binding*.test.ts` | 新建 | SC-01–SC-28 |
| 示例 YAML 夹具 | 新建 | 含 `connectionId`＋`source` |
| Skill 管线 | **不动** | D8 延期 |

## 4. 任务分解

### S0：决策闭合与夹具
- ~~O1／O2 闭合~~ **已完成**（委托人 2026-11-07）。夹具带钉死 `connectionId`；trigger 字母数字码点 ≥4；SC-29／30 故障夹具在 **R4 后**执行。
### S1：加载＋CanonicalSourceKey＋D12＋触发词校验
- 资产解析 `boundKey`；禁键一律 violation；非法／过短 trigger → 发布失败（SC-01）。
- **验证**：SC-01、SC-07、SC-08、SC-15、SC-15b、SC-26。
### S2：BindingSession／快照／commitPhase
- 四态；深拷贝快照；D11；SC-17*／25／27／28。
### S3：query／explain 门禁
- 对照快照；双工具同码；SC-10–13、SC-18、SC-21。
### S4：O1 发布／加载（须 O1 闭合）
- ① 路径／种类／快照字节／删除分类／发布历史接线；② 消费回执、`activeGeneration` 提交凭据及重启恢复；③ 绑定独立变更与混合整批同步；④ begin generation＋内容有效性互斥复核（`registryActivationCommitExclusion`）。非 KTX 镜像。
- **验证**：SC-19、SC-22–24、SC-28–30；SC-30 真实进程局部故障。
### S4b：O2 触发匹配（须 O2 闭合）
- NFKC＋`toLowerCase` 子串；分别匹配；非分词；`Straße`／`STRASSE` 与内部标点反例。
- **验证**：SC-01、SC-04–06。
### S5：术语与镜像
- SC-14；绑定**不**入 KTX `CONTENT_DIR_NAMES`。
### S6：实现完成后由 Cursor Agent code review；记录回链；**不**自动宣称可上线。

## 5. 验收／完成定义

- SC-01–SC-30 有证据（R4 后执行）；未授权前不得收口、不得宣称可上线。
- 偏离 query：上游计数 0；explain：本条拒绝码。
- 未授权前无运行代码合入；**不宣称可上线**。

## 6. 风险

| 风险 | 缓解 |
|---|---|
| 实现偏离 Spec／漏 SC | Cursor Agent review；SC 证据门禁 |
| 热读资产漂移 | D5 快照；SC-23／28 |
| 部分提交放行 | commitPhase；SC-17c |
| 额外参数绕过 | D12；SC-15b |
| 短 trigger 误命中 | SC-01 最小长度；发布失败 |

## 7. 产品线序

本条＝Spec 批次 **S1** 主角。下一批 S2：P0-2∥P0-A。


## 变更记录

| 版本 | 日期 | 说明 |
|---|---|---|
| v0.9 | 2026-11-08 | R4 授予；允许 Claude Code 实现 |
| v0.8 | 2026-11-07 | 委托人闭合 O1／O2；对齐 Spec v0.8；仍待 R4 |
| v0.7 | 2026-11-07 | 对齐 Spec v0.7 R2 补丁；SC-29／30；S4 四段 |
| v0.6 | 2026-11-07 | 对齐 Spec v0.6 O1／O2 完整草案；S4／S4b；草案≠闭合 |
| v0.5 | 2026-11-07 | 对齐 Spec v0.5 定稿；O1／O2 仍前置 |
