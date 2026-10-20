# Business Eval 能力清单

| 元数据 | 内容 |
|---|---|
| 文档名称 | Business Eval 能力清单 |
| 文档类型 | Checklist |
| 版本 | v1.0 |
| 撰写日期 | 2026-10-18 |
| 撰写人 | Cursor Agent |
| 委托人 | xingchen |
| 基于材料 | [`evals/superstore/eval/superstore-eval-cases.yaml`](../../evals/superstore/eval/superstore-eval-cases.yaml)；[`evals/agent_reliability/eval/agent-reliability-eval-cases.yaml`](../../evals/agent_reliability/eval/agent-reliability-eval-cases.yaml)；[`scripts/e2e/contracts/case-catalog.yaml`](../../scripts/e2e/contracts/case-catalog.yaml) 的 UX-02 / UX-03 / UX-04；[`docs/plans/2026-10-11-eval-result-policy-context-upgrade.md`](../plans/2026-10-11-eval-result-policy-context-upgrade.md) |
| 适用范围 | 已挂接的业务能力绿到阻塞线还是良好线。证据是否齐读 [`e2e-release-checklist.md`](e2e-release-checklist.md) |
| 输出位置 | `docs/qa/business-eval-checklist.md` |
| 行定义 | [`checklists/business-eval-rows.yaml`](checklists/business-eval-rows.yaml) |

## Terminology Compliance

本清单遵守 [`webui/docs/00-product-terminology-standard.md`](../../webui/docs/00-product-terminology-standard.md)。下列说法只用于 QA 文档，不进入 WebUI、API 错误或测试里的用户可见文案。

| 概念 | 使用范围 | 含义 |
|---|---|---|
| 能力行 | 本清单 | 一项业务能力，挂到已有 eval case 与真实 Agent 变体 |
| 证据行 | E2E 发布证据清单 | 一组冻结场景的证据是否到齐 |
| 阻塞线 | 本清单 | 发布能力所要求的已挂接用例全部通过 |
| 良好线 | 本清单 | 阻塞线已达到，且该行良好链接也全部通过 |

## 1. 这张表回答什么

客户发布仍由 `npm run gate:customer-release` 签发。本清单把已经存在的 superstore、agent_reliability 用例，以及同一能力上的真实 Agent 变体，收成七行能力记分板。

第一版只挂这些已有编号。`chatbi_intl` 的文本题在结果轴与策略轴分开之前不进入阻塞分母，本版不为它们编造链接。

本文件不记录某次运行的 passed / failed。颜色写到该 run 的 `checklist-projection.json`：

```bash
npm run e2e:real:project-checklists -- --run inbox/e2e/<runId>/run.json --eval <evidence.json>
```

`good_line: unlinked` 的良好线在投影里保持 blocked。`BE-EXPERIENCE` 读 `<runDir>/experience.json`：负责人、问题、连贯和口径都齐，且连贯、口径未被改写，该行才是 passed。投影不修改本文件，也不改 `gate:customer-release`。

## 2. 着色

每行两条线。

- **阻塞线（eval 档）**：该行 `blocking.eval` 里的用例全部通过。
- **阻塞线（发布档）**：eval 档达到，并且 `blocking.e2e` 里已挂的变体全部通过。没有挂 e2e 变体时，发布档与 eval 档读同一批 eval 链接。
- **良好线**：阻塞线已达到，且 `good` 链接全部通过。`good_line: unlinked` 或 `good` 为空时，良好线保持 blocked，阻塞线仍可单独变绿。
- 链接指向的用例尚未运行，或链接缺失，该线是 blocked。失败的已运行用例使该线 failed。

生产坏案例先写成 eval case，或先写成 catalog 变体并更新 lock，再在本清单加一行指向它。清单本身不增加分母。

## 3. 能力行

| 行 | 能力 | 阻塞线 | 良好线 |
|---|---|---|---|
| `BE-BASE` | 基础数值：订单数、销售额、利润率、加权折扣 | `superstore-ordercount-001/002`、`superstore-profit-001`、`superstore-discount-001/002`；发布档加 UX-02-V01～V04 | 再通过 measure 名与等价 SQL：`superstore-discount-004`、`superstore-ordercount-003`、`superstore-profit-002` |
| `BE-ANTIPATTERN` | 反模式：`COUNT(*)` 当订单数、漏掉有效订单过滤、行数与订单数混用 | `superstore-ordercount-004`、`superstore-filter-001/002` | 未挂接。等结果轴与策略轴分开后再补链接，在此之前保持 blocked |
| `BE-PATH` | 路径与 Join：跨表路径、segment 定义、内建度量引导 | `superstore-join-001/002`、`superstore-segment-001`；发布档加 UX-02-S01 | 未挂接，保持 blocked |
| `BE-BOUNDARY` | 空结果、NULL 与 0、未定义口径时明示缺口 | `superstore-degradation-001`；发布档加 UX-03-V01～V03 | 未挂接。澄清后再作答的用例还不存在，保持 blocked |
| `BE-REFUSE` | 预算不可用、情景标注、实现单价、部分交付、停止无增益重试 | `agent-reliability-budget-unavailable-001`、`agent-reliability-hybrid-label-001`、`agent-reliability-realized-price-001`、`agent-reliability-partial-delivery-001`、`agent-reliability-retry-budget-001`；发布档加 UX-02-V05、UX-03-V04 | 未挂接，保持 blocked |
| `BE-MULTITURN` | 多轮口径不漂移，模板错误不改题 | `superstore-multiturn-001`；发布档加 UX-04-V01、UX-04-S02 | 未挂接，保持 blocked |
| `BE-EXPERIENCE` | 指定负责人用同一批真实问句复核连贯性与口径 | 无 case id | 无 case id。两线都固定 blocked |

## 4. 体验轨证据形状

`BE-EXPERIENCE` 不进入自动分母。将来投影脚本只在下面文件存在时读取它；缺文件保持 blocked。

路径：`inbox/e2e/<runId>/experience.json`

```json
{
  "operator": "<name>",
  "runId": "<runId>",
  "questions": ["<与本 run gold 登记表相同的问题文本>"],
  "coherent": true,
  "metricUnchanged": true,
  "notes": ""
}
```

`operator` 是指定负责人。`questions` 使用该 run 已登记的问题文本。`coherent` 记录回答是否连贯。`metricUnchanged` 记录口径有没有被改写。本清单不接受在 YAML 或本文里手填 passed。

## 5. 未纳入本版分母

[`evals/chatbi_intl/eval/chatbi_intl-eval-cases.yaml`](../../evals/chatbi_intl/eval/chatbi_intl-eval-cases.yaml) 的文本题留在原套件里。结果轴与策略轴分开之前，它们不挂到上面任一行，也不另开一行充数。
