# P0-2 Catalog 业务语义暴露 · SC-01–SC-17 证据审计

| 元数据 | 内容 |
|---|---|
| 文档名称 | P0-2 SC-01–SC-17 证据审计 |
| 文档类型 | Checklist / Evidence |
| 版本 | v1.0 |
| 撰写日期 | 2026-11-13 |
| 撰写人 | Tester (Task 2c) |
| 委托人 | xingchen |
| 基于材料 | Spec `docs/specs/lucy-20261107-catalog-business-semantics-spec.md` §7；`webui/server/__tests__/catalog-business-semantics.test.ts` |
| 适用范围 | 功能合同收口证据；镜像同次回写 Spec／Plan／清单／README |
| 输出位置 | `docs/reviews/2026-11-13-catalog-business-semantics-sc-evidence-audit.md` |

## 测试基线

```bash
cd webui && npx vitest run \
  server/__tests__/catalog-business-semantics.test.ts
```

| 项 | 结果 |
|---|---|
| Test Files | **1 passed** |
| Tests | **23 passed / 0 failed** |
| 时长 | ~1.0s（与 field-exposure 同跑时合计 ~1.0s） |
| O3 预算数值 | **8192**（已闭合 2026-11-08；`MAX_TOTAL_DESCRIPTION_CHARS` 与 SC-08 夹具一致） |
| `npm run lint:spec-docs` | 失败项均为**其他** Spec／Plan 基线外违规；**本条 Spec／Plan 未出现在失败列表**（SC-13） |

无回归：本轮未改生产／测试代码；相对既有套件为全绿。

## SC 清单（CLOSED / OPEN）

### 纯函数装配 · `catalog-business-semantics.test.ts`

| ID | 状态 | 证据 |
|---|---|---|
| SC-01 | CLOSED | `SC-01/SC-03: present description returns raw value` |
| SC-02 | CLOSED | `SC-02 shape keys: four identity fields retained first` |
| SC-03 | CLOSED | 同 SC-01/SC-03（原值逐字；含未截断前提） |
| SC-04 | CLOSED | `SC-04: missing / blank db → missing` |
| SC-05 | CLOSED | `SC-05: descriptions.ai never enters assemble/JSON`；`SC-05 disk: manifest descriptions.ai never appears in indexes or catalog JSON` |
| SC-08 | CLOSED | `SC-08: budget truncates then zeros subsequent; entry count unchanged`（O3＝8192） |
| SC-10 | CLOSED | `SC-10: assembleCatalogSources sorts by sourceName.localeCompare`（SC-08 亦断言条目序） |
| SC-14 | CLOSED | `SC-14: grain from overlay only when bindings match; omit otherwise` |
| SC-15 | CLOSED | `SC-15: leading/trailing spaces preserved when present` |
| SC-16 | CLOSED | `SC-16: snapshot table T_old must not pick up rebound M_new`；`SC-16 disk: rebound assets after snapshot do not attach M_new` |
| SC-17 | CLOSED | `SC-17(1)`／`SC-17(2)`／`SC-17(3)`；`SC-17 disk: overlay ahead of manifest must not write G_new on old table` |

### 磁盘索引／D4a 隔离／可见性

| ID | 状态 | 证据 |
|---|---|---|
| SC-06 | CLOSED | `SC-06: invisible source marker never assembled into visible entries` |
| SC-07 | CLOSED | `SC-07: member set equals D0 final; degradedGlobal empties without LKG descriptions`；`SC-07: unreadiness filter member set = D0 (ops connection excluded)` |
| SC-09 | CLOSED | `SC-09: corrupt single file does not wipe others; missing root → missing` |
| SC-11 | CLOSED | `SC-11: lucy_read_source identity fields still resolve (thin ACL regression)`；`assemble does not mutate identity fields of input sources` |
| SC-12 | CLOSED | `SC-12: production Visible Scope formatter omits description fields` |

### 文档／门禁

| ID | 状态 | 证据 |
|---|---|---|
| SC-13 | CLOSED | `lint:spec-docs` 对本 Spec／Plan **未报**基线外违规；Terminology Compliance 小节形状合规。全仓其它文档失败与本条无关 |

## 计数

| | |
|---|---|
| CLOSED | **17 / 17** |
| OPEN | **0** |
| 本轮新增测试 | 无 |
| 本轮改动代码／测试文件 | **无** |

## Nits（不挡收口）

1. **SC-08** 用可注入 budget 夹具验证截断算法；另断言 `MAX_TOTAL_DESCRIPTION_CHARS === 8192` 锁 O3 常量。未另起「整包 MCP text 体积」断言（本条合同明确只约束描述字符预算）。
2. **SC-11** 为薄 ACL 回归（identity 字段仍可 resolve），非全量 `lucy_read_source` 行为套件；与 Spec「现有用例／不回归」口径一致。
3. **SC-06** 用专属标记断言错装配，避免与 D4b「可见原文可提及受限名」冲突。

## 建议 Spec 状态句

功能合同证据侧：**SC-01–SC-17 均可标关闭**。建议镜像统一改为：

> **功能合同已收口**（SC-01–SC-17 证据关闭；实现已落地；2026-11-13）。**本条收口不表示可上线。**
