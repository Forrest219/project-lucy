# P1-35 SC-E01–E30 证据审计

| 元数据 | 内容 |
|---|---|
| 文档名称 | P1-35 SC-E 证据审计 |
| 文档类型 | Review |
| 版本 | v1.0 |
| 撰写日期 | 2026-11-22 |
| 撰写人 | Cursor Agent（Track B／T35-1） |
| 委托人 | xingchen |
| 基于材料 | Spec `lucy-20261116-source-ambiguity-mcp-escape-spec.md` §5；UAT `UAT-SUITE-SOURCE-AMBIGUITY-ESCAPE`；Nov-17 CR；本机 vitest 2026-11-22 |
| 适用范围 | P1-35 功能合同收口证据；≠ 可上线 |
| 输出位置 | `docs/reviews/2026-11-22-p1-35-sc-e-evidence-audit.md` |

## 1. 复跑

| 命令 | 结果 |
|---|---|
| `npx vitest run --maxWorkers=1 server/__tests__/source-ambiguity-tolerance.test.ts server/__tests__/source-ambiguity-gate.test.ts server/__tests__/source-join-graph.test.ts server/__tests__/answer-verifiability.test.ts`（cwd=webui） | **4 files／82 tests PASS** |
| 测试台 INDEX | `UAT-SUITE-SOURCE-AMBIGUITY-ESCAPE`＝**PASS**；最新跑次 [2026-11-18-cursor-sag-escape-post-rebuild](../qa/uat/suites/source-ambiguity-mcp-escape/runs/2026-11-18-cursor-sag-escape-post-rebuild.md)（含 ESC-11） |

## 2. Nov-17 FAIL CR 处置

| ID | Nov-17 判定 | 2026-11-22 处置 |
|---|---|---|
| **CR-01** | never_begun＋多钉选 plain allow 违反旧 SC-E06 | **已 Spec 确权取代**：Spec §4.1 v0.4 修订＋测试注释「委托人 2026-11-17 确权」；`source-ambiguity-tolerance.test.ts` never_begun 连通→档①／未连通→tolerated 锁死 |
| **CR-02** | instructions／工具描述与 keys=0 硬拦相反 | **已修**：`webui/config/data-qa-instructions.md:51` 明示「没有任何带来源限定的引用…命中多个来源」仍拦截 |
| **CR-03** | join 节点丢 schema | **已修**：`source-join-graph.ts:104-105` 完整身份节点；夹具 `CR-03: same sourceName in two schemas…` |
| CR-04+ | 多为 P1-36／37 或应修 | **不挡本条出口**（本条出口＝SC-E＋ESCAPE；导出脱敏等归他行） |

## 3. SC-E 证据矩阵（摘要）

| SC | 证据 | 判定 |
|---|---|---|
| E01／E13 | `source-ambiguity-gate.test.ts`「SC-E01/E13」；UAT ESC-01 | 满足 |
| E02／E10 | Spec v0.4 改硬线；父 SAG-01 v3＋ESCAPE | 满足 |
| E03／E04 | UAT ESC-02／ESC-03 | 满足 |
| E05／E14 | 被 E24 取代；gate＋tolerance `pin_outside_hits` | 满足 |
| E06 | gate「SC-E06 never_begun + unique pin」；v0.4 多钉选见 CR-01 处置 | 满足 |
| E07／E08／E09 | tolerance「SC-E07/E08」「SC-E09 F1」；UAT ESC-08 | 满足 |
| E11 | 父 O2／既有 gate（read_source 不纳入） | 满足 |
| E12 | 本审计＋vitest 套件 | 满足 |
| E15–E19 | gate ACL／explain／E19 健康失败 | 满足 |
| E20–E24 | tolerance 同名 it | 满足 |
| E25 | `answer-verifiability.test.ts`「D13 sourceSelection」 | 满足 |
| E26 | tolerance 审计 JSONL `tolerated-events` | 满足 |
| E27–E29 | tolerance 硬线／跨连接／cap | 满足 |
| E30 | Spec 单端 join；join-graph＋tolerance E21／E22 | 满足 |

无空行阻断 GAP。UAT ESC-01～11 见 INDEX PASS 跑次。

## 4. 结论

**可进入实现 CR／S5 候选**。本审计 ≠ 可上线。
