# P0-1 口径绑定 · Code Review（Cursor Agent）

| 元数据 | 内容 |
|---|---|
| 文档类型 | 实现 code review（**不是** Spec） |
| 日期 | 2026-11-08 |
| 评审人 | Cursor Agent（委托人指定） |
| 实现主体 | Claude Code（R4） |
| 对象 | Spec／Plan v0.9 实现；说明见 `inbox/2026-11-08-p0-1-claude-code-impl-notes.md` |
| 复测 | 首轮 68 passed → F-R1 后 **75 passed**（2026-11-08 Cursor 复核） |

## 结论

**PASS（实现层）** —— 主路径对齐 Spec；**F-R1 已由 Claude Code 修复并复测 75 passed**（Cursor 复核关闭）。残余仅为 should-fix／验收债（SC-29／30、explain 强断言）。仍**不宣称可上线**／不做发布取证。

## 已对齐（摘要）

| 项 | 证据 |
|---|---|
| O2 `N(s)` 唯一算法 | `caliber-binding-text.ts`；`Straße`／`STRASSE`、内部标点反例有测 |
| 闸序 ACL → 口径 → 行权限 | `mcp-proxy.ts` ~4205 在 `applyLucyQueryForcedFilters` ~4271 之前；explain 同路径 |
| 深拷贝快照／禁止热读 | session 模块＋门禁只读 `caliberSnapshot` |
| D11 preparing／committed | begin 临界区＋restorePrior；SC-17* 有测 |
| 未入 KTX 镜像 | `CONTENT_DIR_NAMES` 仍无 `caliber-bindings` |
| 偏离零上游 | Proxy 夹具本地计数 HTTP；SC-07／08／15b 等 |

## Findings

### F-R1 [must-fix] D12 白名单漏掉 Spec D7 采集别名 — **CLOSED**

已纳入 `CALIBER_SOURCE_ALIAS_KEYS`，并显式校验别名解析＝`boundKey`（避免「进白名单不管」旁路）。单测＋Proxy 共 7 条；Cursor 复测 **75 passed**。详见实现说明 §7。

### F-R2 [should-fix] SC-29／SC-30 证据缺口（实现说明已自报）

- SC-29：缺「降 draft」「扫描失败」「依赖读取失败」＋「恢复 begin → unresolved、旧 Session 不变」端到端。
- SC-30：有 `setCaliberBindingFaultHooks`，无真实进程局部故障测。

不挡本轮 PASS；进入功能验收前须补或书面降级登记。

### F-R3 [should-fix] explain「无成功体」断言偏弱

Proxy 测主要靠文案／缺 `plan_only`；建议断言本地 explain handler 计数为 0（与 query 上游计数对称）。

### F-R4 [nit] SC-05 缺「输入顺序变化」变体；SC-14 依赖存量 lint 债

可后续补；SC-14 勿把存量 Plan lint 失败算本条回归。

## 对实现说明 B1–B11 的裁定

| 项 | 裁定 |
|---|---|
| B1 白名单 | **接受**（F-R1 已扩 D7 别名并显式校验） |
| B2／B3／B4 归一与 filter 边界 | 接受；有 SC-26／SC-15 支撑 |
| B5 可见性＝任一数据面 capability | 接受 |
| B6 两阶段凭据 | 接受 |
| B7 draft 也校验触发词 | 接受（整批 fail-closed） |
| B8 可选 ContentPaths 字段 | 接受 |
| B9 无作者面 UX | 符合 Spec 非目标 |
| B10 Skill 不动 | 符合 D8 |
| B11 lint 存量 | 接受；勿绑死本条收口 |

## 下一步

1. ~~F-R1~~ **已关闭**。  
2. 可选第二波：F-R2（SC-29／30）、F-R3（explain 零调用计数）。  
3. 未 git commit；需要时可另发提交／继续验收指令。**不得**宣称可上线。
