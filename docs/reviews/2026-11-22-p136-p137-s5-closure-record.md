# P1-36／P1-37 scoped S5 收口记录

| 元数据 | 内容 |
|---|---|
| 文档名称 | P1-36／P1-37 scoped S5 收口记录 |
| 文档类型 | Checklist |
| 版本 | v1.0 |
| 撰写日期 | 2026-11-22 |
| 撰写人 | Cursor Agent |
| 委托人 | xingchen |
| 基于材料 | [裁定包](../../inbox/20261122-1630-p136-p137-decision-pack.md)；委托人勾选「推荐默认全 A/B + 授权改 Spec／收口」；沙箱 Tier-A 跑次；Spec v1.1 |
| 适用范围 | 开发台功能合同 scoped 收口；≠ 整套 UAT PASS；≠ 可上线；未 commit／push |
| 输出位置 | `docs/reviews/2026-11-22-p136-p137-s5-closure-record.md` |

## 裁定结果（委托人 2026-11-22）

```
P1-36: F-3=A; F-2=B; TRC=B
P1-37: U1=A; GAP=B
授权改 Spec／收口：是
```

| 条 | 决议 | 合同落点 |
|---|---|---|
| P1-36 F-3=A | SC-06 改文案对齐 §6.2 | 仅协议／wiki 强制主状态≠unknown；其他 `tools/call` 保持 v2p5-1 |
| P1-36 F-2=B | 诊断包 `spans.csv` 即可 | SC-05／收口范围；正式 `mode=complete`／F-02 另期 |
| P1-36 TRC=B | TRC-07／08／09 另期 | 写入收口范围；不挡 scoped S5 |
| P1-37 U1=A | Spec 对齐描述索引指纹缓存 | 关掉旧 instructions 缓存验收项 |
| P1-37 GAP=B | MCPX-02／05／06／08 残余缺口另期 | 写入收口范围 |
| U3b | 保持不入出口 | MCPX-09／10 BLOCKED（伴生） |

## 收口结论

| 条目 | 结果 |
|---|---|
| P1-36／REQ-030-057 | **S5｜功能合同已收口（scoped）** |
| P1-37／REQ-030-058 | **S5｜功能合同已收口（scoped）** |
| 可上线 | **否** |
| 整套 UAT PASS | **否**（测试台仍 PASS WITH GAP） |

## 证据链

| 条目 | 指针 |
|---|---|
| P1-36 UAT | [2026-11-17-claude-wide-sandbox-tierA](../qa/uat/suites/trace-span-ledger/runs/2026-11-17-claude-wide-sandbox-tierA.md)（TRC-01–06／10／11） |
| P1-37 UAT | [2026-11-17-claude-wide-sandbox-tierA](../qa/uat/suites/mcp-ux-resilience/runs/2026-11-17-claude-wide-sandbox-tierA.md)（R0／01／03／04／07／11／12＋02／05／06／08 已验子集） |
| 实现取证 | [2026-11-17-p1-36-p1-37-implementation-evidence.md](2026-11-17-p1-36-p1-37-implementation-evidence.md) |
| 裁定包 | [inbox/20261122-1630-p136-p137-decision-pack.md](../../inbox/20261122-1630-p136-p137-decision-pack.md) |

## 镜像清单（已落）

| 镜像面 | 状态 |
|---|---|
| P1-36／37 Spec／Plan | S5＋收口范围＋v1.1 changelog |
| 总账表行＋分节＋变更行 | 同句 |
| 需求池 REQ-030-057／058 | 同句 |
| `docs/README.md`／`docs/plans/README.md` | 同句 |
| e2e-ledger | 同句；GAP-UAT 标注残余另期 |

## 非目标确认

未改运行代码、未补跑 TRC-07／08／09、未修 F-02、未宣称整套 UAT PASS、未出包、未 push、未宣称可上线。可选 P1-58／59／42／44 **未**纳入本批。
