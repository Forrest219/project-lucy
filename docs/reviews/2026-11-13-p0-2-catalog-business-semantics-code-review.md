# P0-2 Catalog 业务语义暴露 · Code Review（Cursor Agent）

| 元数据 | 内容 |
|---|---|
| 文档类型 | 实现 code review（**不是** Spec） |
| 日期 | 2026-11-13 |
| 评审人 | Cursor Agent（Wave A Task 1） |
| 实现主体 | Cursor coder（R4，2026-11-08） |
| 实现 commit | `39512177`（`source-descriptions.ts`＋`catalog-business-semantics.test.ts`）；`91a9dfc3`（`mcp-proxy.ts`／`acl.ts` 接线，与 P0-A／P0-3 共享插入点） |
| 对象 | Spec／Plan **v0.6**；SC 证据见 [证据审计](2026-11-13-catalog-business-semantics-sc-evidence-audit.md) |
| 复测 | `cd webui && npx vitest run catalog-business-semantics --reporter=dot` → **23 passed / 0 failed**（2026-11-13 Cursor 复核） |

## 结论

**PASS（实现层）** —— 主路径对齐 Spec v0.6 §4.1／D0–D10 与 SC-01–SC-17；本轮复测与证据审计一致（23/23）。残余仅为验收债／nits（见 Findings）。**本 CR 不表示可上线**／不做发布取证。

## 已对齐（摘要）

| 项 | 证据 |
|---|---|
| D0 先最终集合再增补描述 | `assembleCatalogSources` 仅对入参 `visibleSources` 装配；SC-07／SC-09 |
| D4a 可见性裁剪／装配隔离 | 不可见专属标记不进最终 JSON（SC-06）；`degradedGlobal` 空集无 LKG 描述（SC-07） |
| D2／D4 缺描述态 | 空／仅空白 → `description: null`＋`descriptionState: "missing"`（SC-04） |
| D3 只取 `descriptions.db` | `descriptions.ai` 不进 assemble／磁盘索引（SC-05） |
| D6／O3 描述字符预算 8192 | `MAX_TOTAL_DESCRIPTION_CHARS`；截断后零预算条目仍保留、条数不变（SC-08） |
| D7 排序（首期降级） | `sourceName.localeCompare`（Spec §4.1 显式降级）；SC-10 |
| D10 overlay 可信绑定／grain | `boundPhysicalTable`、失配不写 grain；SC-14／SC-16／SC-17 |
| 零列预览 | 目录响应不返回列／列样例；与 P0-A 相邻约束不触发（Spec §metadata） |
| D8 Visible Scope 瘦身 | 生产 formatter 省略 `description`／`descriptionState`／`grain`（SC-12） |
| 身份四字段不变 | SC-02／SC-11 薄 ACL 回归 |
| 错误隔离 | 单文件损坏不清空全索引（SC-09）；`failedConnections`／`failedSourceKeys` 健康态标记 |

## Findings

### F-R1 [nit] SC-08 未断言整包 MCP `content[0].text` 体积

合同明确只约束新增描述 UTF-16 字符预算（D6）；当前以可注入 budget 夹具＋常量 `8192` 锁 O3。若日后要硬上限整包序列化体积，须另开 Spec／决策行。

### F-R2 [nit] SC-11 为薄回归而非全量 `lucy_read_source` 套件

与 Spec「现有用例／不回归」口径一致；不挡本轮 PASS。

### F-R3 [nit] D4b 可见原文侧信道仍 defer

SC-06 用专属标记断言错装配，不宣称内容级零泄漏；符合 Spec D4b。

### F-R4 [nit] commit `91a9dfc3` 与 P0-A／P0-3 共享 Proxy 差分

本条 CR 审查范围以 `source-descriptions.ts` 与 `catalog-business-semantics.test.ts` 为主；共享接线已 spot-check 目录 enrichment 调用链，不替代 P0-A／P0-3 各自实现 CR。

## 对 Spec D／SC 的裁定

| 范围 | 裁定 |
|---|---|
| 可见性裁剪（D4a） | **接受** |
| 缺描述态（D2／SC-04） | **接受** |
| 零列预览（首期不返回列） | **接受**（符合 Spec 与 P0-A 边界） |
| D7 字母序降级 | **接受**（合同显式降级，非实现偏离） |
| SC-01–SC-17 | **接受**（与 [证据审计](2026-11-13-catalog-business-semantics-sc-evidence-audit.md) 一致） |

## 下一步

1. 可选：F-R1 若产品要整包体积上限，单独立项。  
2. Wave A 其余条目按 [治理优化 Plan](../plans/lucy-20261113-p0-governance-optimization-plan.md) 独立落盘 CR。  
3. **不得**宣称可上线。
