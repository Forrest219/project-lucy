# P0-1 问题类型口径绑定 · SC-01–SC-30 证据审计

| 元数据 | 内容 |
|---|---|
| 文档名称 | P0-1／REQ-030-027 SC-01–SC-30 证据审计 |
| 文档类型 | Checklist / Evidence |
| 版本 | v1.1 |
| 撰写日期 | 2026-11-13 |
| 撰写人 | Tester（Task 2b）→ parent 收口（SC-22 夹具闭合） |
| 委托人 | xingchen |
| 基于材料 | Spec `docs/specs/lucy-20261107-question-type-caliber-binding-spec.md` §7；CR `docs/reviews/2026-11-08-p0-1-caliber-binding-code-review.md` |
| 适用范围 | 功能合同收口证据；镜像由 parent 同次回写 |
| 输出位置 | `docs/reviews/2026-11-13-question-type-caliber-binding-sc-evidence-audit.md` |

## 结论（收口门禁）

| 项 | 值 |
|---|---|
| 功能合同可收口？ | **是** |
| OPEN SC | **无**（SC-01–SC-30 全部 CLOSED） |
| Spec／Plan／清单／README | **功能合同已收口（2026-11-13）** |
| 本条收口不表示可上线 | 仍成立 |

## 测试基线

```bash
cd webui && npx vitest run --maxWorkers=1 \
  server/__tests__/caliber-binding.test.ts \
  server/__tests__/caliber-binding-proxy.test.ts
```

| 项 | 结果 |
|---|---|
| Test Files | **2 passed** |
| Tests | **80 passed / 0 failed** |
| 时长 | ~1.9s |
| 相对 v1.0 审计（76） | +4（SC-22 混合整批／候选失败不推进／KTX 后提交失败／生产装配序） |
| `npm run lint:spec-docs` | 失败项均为**其他** Spec／Plan；**本条 Spec／Plan 未出现在失败列表**（SC-14） |

## SC 清单（CLOSED）

| ID | 状态 | 证据（摘要） |
|---|---|---|
| SC-01–SC-21 | CLOSED | 见 v1.0 审计映射；`caliber-binding.test.ts`／`caliber-binding-proxy.test.ts` |
| SC-22 | **CLOSED** | `SC-22：generation 切换后新 begin 可读`；`SC-22：绑定独立变更与混合整批同一提交窗口推进一代`；`SC-22：绑定候选失败时不推进绑定基线`；`SC-22：模拟 KTX 成功后绑定提交失败 → 绑定 generation 不推进`；`SC-22／O1 生产装配序：候选校验 → reindex → 绑定提交`（`index.ts` 源码序锁） |
| SC-23–SC-28 | CLOSED | 见 v1.0 |
| SC-29 | CLOSED | D11 写入前改／删／降 draft／依赖失败多变体 |
| SC-30 | CLOSED | fault-hook 三窗口＋恢复／新 begin |

## 计数

| | |
|---|---|
| CLOSED | **30／30**（含 15b／17a–c） |
| OPEN | **0** |

## Nits（不挡收口）

1. SC-05 缺「输入顺序变化」独立变体（CR F-R4）。
2. SC-11 未接真 `forced_filters` 行权限夹具。
3. SC-17a 预算关闭时 ② 分支不可触发。
4. SC-20 无并发锁压测。
5. SC-21／F-R3 explain 本地 handler 零调用计数仍偏弱。

## 书面降级

**未采用。** 委托人 2026-11-13 批准补测收口；SC-22 以自动化闭合，不降级。

## 收口状态句

> **v0.9；R2-F＋R3（O1／O2）＋R4 已闭合（2026-11-08）；实现已合入；CR PASS；SC-01–SC-30 证据关闭（2026-11-13，见本审计）。功能合同已收口（2026-11-13）。本条收口不表示可上线**
