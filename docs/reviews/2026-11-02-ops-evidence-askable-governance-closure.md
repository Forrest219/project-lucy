# 运维问数可问治理面 — 功能合同收口

| 元数据 | 内容 |
|---|---|
| 日期 | 2026-11-02 |
| 授权 | 本次要求：评估 Spec，把部署本功能的内容拆出出口，然后收口 |
| 对象 | [Spec v0.9.2](../specs/lucy-20261101-ops-evidence-askable-governance-spec.md)；[Plan](../plans/lucy-20261101-ops-evidence-askable-governance-plan.md) |
| 结论 | **功能合同收口。** 留在出口的 SC 有本机自动化证据。**本条收口不表示可上线。** 功能编号无 |

## 评估

v0.9.1 把三件不同的事写进同一条出口：可问合同（Q1–Q6、快照、`gov.*`、禁列）、已落盘实例的现场扩权与升级说明、以及四门禁这种过程清单。后两件不能证明「问数口径成立」，也不能用客户环境未跑来把合同挂成未收口。

代码侧 W1／W2 物化、语义源、Skill／Wiki、ensure 扩 `enabled_tables` 且不改 `access.yaml`，在收口前已经落在工作区。缺口是证据不齐，以及出口里夹着部署项。

## 拆出，不在本条出口

| 原项 | 原因 |
|---|---|
| SC-17d 扩权后现场查询 | 表选择器放行归 Spec 149。本条只锁模板列全名、ensure 不写 Role、demo 正式 Role 仍只有 W0 |
| SC-17f 升级 runbook | 客户升级说明归交付。Wiki 已写「已落盘 Role 须显式扩表」 |
| SC-19 四门禁 + 落盘清单 | 过程记录，见下文，不是用户可观察承诺 |
| 镜像、Helm、客户环境、v0.25 升级台账 | 继续不进入本条 |

## 这次跑过的测试

```bash
cd webui && npx vitest run --maxWorkers=1 \
  server/__tests__/ops-evidence-governance-s1.test.ts \
  server/__tests__/ops-evidence-governance-s2.test.ts \
  server/__tests__/ops-evidence-governance-closure.test.ts
```

**3 个文件 / 32 条通过。**

仓库根目录四门禁退出码均为 0：`lint:spec-docs`、`lint:spec`、`lint:terminology`、`lint:ia-boundary`。`lint:spec` 有两条与本条无关的既有 WARN（`chatbi_intl` 的 `paired_quiz`、`demo_readonly` 无 `permission_model_version`）。

## 逐条结论

| 编号 | 结论 | 证据落点 |
|---|---|---|
| SC-01 | 通过 | s1：`ops_calls` 带 `gov.*` → `invalid_arguments`。`mcp-proxy` 只在治理源上重建快照，旧源不进入该分支 |
| SC-02 | 通过 | 模板 `connections` 只有 `lucy-ops`，无 `source_scope`（`ops-evidence-role-template.test.ts`） |
| SC-03／04 | 通过 | closure：配置人口含未启用与无流水 Agent；同 label 两枚未过期 Token 的 `available_token_count` 为 2 |
| SC-05／05b | 通过 | closure：协议与 `lucy-ops` 自追问不进 `ops_agent_activity`；业务 `lucy_query` 计 1 |
| SC-06 | 通过 | closure：`silent` 在 `ops_agents`、不在活动表 |
| SC-07／24 | 通过 | s1：五档最深水位，含仅失败 begin；日历窗含今日 |
| SC-08／08b／08c／08d／08e／08i | 通过 | s2：路径数、边 state、节点数、orphan、coverage、raw／denied 对齐 builder |
| SC-08f／23 | 通过 | s2：`focus_token_label` 不改 `grant_paths`；closure：`agent_id` 行滤不进 focus |
| SC-08g | 通过 | closure：不同 trust 的 `query_key` 不同 |
| SC-08h／10c | 通过 | Wiki／Skill 写明不对页面折叠、不对齐图凭证清单 |
| SC-09 | 通过 | s2：`confirmed_unauthorized` 落库 |
| SC-10／10b | 通过 | s1：同 label 跨 Agent 分别为 1 与 2 |
| SC-11／12 | 通过 | s2：授权面 anti-join；deny／探针／同日／跨日／denom |
| SC-13–15 | 通过 | closure：Skill 路由 Q1–Q6 与「必须先改述」；Wiki ACL 只有 `lucy_ops_reader` |
| SC-16 | 通过 | closure：`assertOpsEvidenceViewsSafe`；治理源列不含禁列 |
| SC-17a／b／c／e | 通过 | s1：ensure union 全表且 Role 字节不变；模板 names 为全部 sourceName；demo Role 只有 W0。资产冲突不覆盖沿用 Spec 149 `ops-evidence-assets.test.ts` |
| SC-17d／17f | 拆出 | 见上 |
| SC-18／20／20b | 通过 | s2：失败不切换 pointer；不同 key 不串读；已绑定读者仍读旧代 |
| SC-19 | 拆出 | 四门禁见上，退出码 0 |
| SC-21 | 通过 | closure：构建中途改写 `access.yaml` → `OPS_EVIDENCE_GOVERNANCE_UNREADY`，pointer 为空，`ops_agents` 0 行 |
| SC-22 | 通过 | closure：Spec §4.1 四则 JSON 剥光 `gov.*` |

## 落盘清单

对照 `docs/governance/DEVELOPMENT.md`「新增 Spec / Plan 的落盘清单」：

| # | 结论 |
|---|---|
| 1 | Spec／Plan 文件名未改，编号 `lucy-20261101-ops-evidence-askable-governance` |
| 2 | Spec §6 有路由伪代码；§4.1 有重建顺序 |
| 3 | Spec 有文档类型／版本／状态；Plan 有状态、授权边界、验收 |
| 4 | Plan 含目标、开工前置、验收、完成定义、风险 |
| 5 | Terminology Compliance 含规定句与 `New terms:` |
| 6 | Design System Compliance 为四段式 |
| 7 | `docs/README.md` 与 `docs/plans/README.md` 已改为 v0.9.2 收口 |
| 8 | 无新增命令 |
| 9 | 功能编号无；不进入 v0.25 升级台账 |
| 10 | 四门禁已跑，退出码 0；本表逐条作答 |
| 11 | 闭口层级为功能合同，并写明承诺、出口、不在出口、上线关系 |

## 不在收口里

客户镜像、Helm、集群部署、客户环境验证、已落盘 Role 的人工扩表，都不在这条里。本条收口不表示可上线，也不构成客户包验收。工作区改动仍未提交。
