# P0-3 表级歧义门闩 · SC-01–SC-26 证据审计

| 元数据 | 内容 |
|---|---|
| 文档名称 | P0-3 SC-01–SC-26 证据审计 |
| 文档类型 | Checklist / Evidence |
| 版本 | v1.0 |
| 撰写日期 | 2026-11-13 |
| 撰写人 | Tester |
| 委托人 | xingchen |
| 基于材料 | Spec `docs/specs/lucy-20261107-source-ambiguity-gate-spec.md` §7；Plan；实现复审／独立复验 `docs/reviews/2026-11-13-source-ambiguity-gate-implementation-review.md`；`source-ambiguity-gate*.test.ts`；`catalog-business-semantics.test.ts`（描述投影／健康态串联） |
| 适用范围 | 功能合同收口证据；状态镜像同次回写 Spec／Plan／清单／README |
| 输出位置 | `docs/reviews/2026-11-13-source-ambiguity-gate-sc-evidence-audit.md` |

## 测试基线

```bash
cd webui && npx vitest run --maxWorkers=1 \
  server/__tests__/source-ambiguity-gate.test.ts \
  server/__tests__/source-ambiguity-host-confirm-http.test.ts \
  server/__tests__/catalog-business-semantics.test.ts
```

| 项 | 结果 |
|---|---|
| Test Files | **3 passed** |
| Tests | **48 passed / 0 failed** |
| 分文件 | `source-ambiguity-gate.test.ts` 23；`source-ambiguity-host-confirm-http.test.ts` 1；`catalog-business-semantics.test.ts` 24 |
| 时长 | ~1.6–2.2s |
| `npm run lint:spec-docs` | 失败项均为**其他** Spec／Plan 基线外违规；**本条 Spec／Plan 未出现在失败列表**（SC-14） |

无回归：本轮未改生产代码；相对独立复验基线 48/48 全绿。

## SC 清单（CLOSED / OPEN）

### Instructions／命中算法 · `source-ambiguity-gate.test.ts`

| ID | 状态 | 证据 |
|---|---|---|
| SC-01 | CLOSED | `SC-01/02/22: ASK_FIRST fragment matches md and forbids silent auto-pick` |
| SC-02 | CLOSED | 同上（四路径／begin 描述无「可无门闩省略」） |
| SC-20 | CLOSED | `SC-20: Chinese sentence hits two description-backed sources`；`SC-20 production: bare permissions allow; buildMatchableSourcesForGate denies Chinese description dual-hit` |
| SC-22 | CLOSED | 同 SC-01/02/22 |

### Gate 核心路径 · `source-ambiguity-gate.test.ts`＋HTTP

| ID | 状态 | 证据 |
|---|---|---|
| SC-03 | CLOSED | `SC-03/04: dual description hit denies query and explain with executed=false` |
| SC-04 | CLOSED | 同上（explain 同拦、未进本地成功体） |
| SC-05 | CLOSED | `SC-05/19: qualified source does not exempt; field ambiguity may ride along` |
| SC-06 | CLOSED | `SC-06: true zero/single hit allows; read_failed does not fake single hit` |
| SC-07 | CLOSED | `SC-07/17: host attested confirmation allows; agent self-fill / stale generation deny`（O1＝`confirmedSourceKey` 已裁定） |
| SC-15 | CLOSED | `SC-15: never_begun + asserted source is context_missing even for single lexical hit` |
| SC-19 | CLOSED | 同 SC-05/19 |
| SC-21 | CLOSED | `SC-21: lucy_read_source is not gated (O2=no)` — O2 已闭合为不纳入 |
| SC-23 | CLOSED | `SC-23: mcp-proxy inserts gate before local explain success body` |
| SC-24 | CLOSED | `SC-24: catalog_read_failure denies (no fake zero/single hit)` |

### 确认／身份／Binding · `source-ambiguity-gate.test.ts`＋`source-ambiguity-host-confirm-http.test.ts`

| ID | 状态 | 证据 |
|---|---|---|
| SC-10 | CLOSED | `SC-10: begun_bound skips gate; lost_or_conflict → caliber unresolved; never_begun gates` |
| SC-16 | CLOSED | `SC-16: unknown filter/order_by ghost.amount retained as unresolved`；`SC-16: dual-connection same name + multi-ref conflict denies`；`SC-16 ACL: ghost.amount stays unresolved for gate; not ACL table set` |
| SC-17 | CLOSED | `SC-07/17: host attested…`；`SC-17 HTTP admit: same MCP Bearer without person+host attestation cannot confirm`；`same Bearer without person+host attestation gets 403; query still deny with zero upstream` |

### 候选／repair／描述健康态

| ID | 状态 | 证据 |
|---|---|---|
| SC-08 | CLOSED | `SC-08/09/11/13/18: allow-list + repair five-evidence; no auto-pick; no usableCandidates text` |
| SC-09 | CLOSED | 同上（走既有 `denialAllowList`／`buildRepairClosure`） |
| SC-11 | CLOSED | 同上（无「已选定成交」） |
| SC-12 | CLOSED | `SC-12: missing skips description; truncated matches only prefix` |
| SC-13 | CLOSED | 同 SC-08/09/11/13/18（中文主称＋对象级集合） |
| SC-18 | CLOSED | 同 SC-08…；另 `SC-18 defaults: unwired evidence is fail-closed unknown, not all-true` |
| SC-25 | CLOSED | `SC-25: description read_failed projected as missing still denies`；`SC-25 production: dual-hit schema + one corrupt overlay → read_failed deny (not single-hit allow)` |
| SC-26 | CLOSED | `SC-26: description text may mention hidden table; object sets stay clean` |

### 文档／门禁

| ID | 状态 | 证据 |
|---|---|---|
| SC-14 | CLOSED | `lint:spec-docs` 对本 Spec／Plan **未报**基线外违规；术语小节形状合规。全仓其它文档失败与本条无关 |

## 计数

| | |
|---|---|
| CLOSED | **26 / 26** |
| OPEN（编号 SC） | **0** |
| 本轮新增测试 | 无 |
| 本轮改动代码／测试文件 | **无** |

## 残余（不挡收口）

1. **SUGGEST ASK_FIRST 双写**（实现复审）：`ASK_FIRST_SECTION` 与 `data-qa-instructions.md` 各写一份先问条文；当前正文一致，D13 单一渲染片段未落地。**OPEN、非阻断**——不对应编号 SC 失败；SC-01／02／22 已断言片段与 md 一致且禁静默选表。
2. **catalog-business-semantics.test.ts** 中的 SC-xx 编号属 **P0-2** 合同面；本审计仅将其计入同次 48/48 回归与描述投影健康态串联，不把 P0-2 SC ID 并入本条 CLOSED 计数。
3. **CHANGE journey** 夹具（corrupt JSON fail-closed）支撑 D10，不单列 SC。

## 建议 Spec 状态句

> **v0.5；R2-F＋R3（O1／O2／O4）＋R4 已闭合（2026-11-08）；实现已合入；复审 BLOCK／CHANGE 已修；独立复验 PASS（2026-11-13）；SC-01–SC-26 证据关闭（2026-11-13，见 [证据审计](2026-11-13-source-ambiguity-gate-sc-evidence-audit.md)）。功能合同已收口（2026-11-13）。本条收口不表示可上线**
