# 运维问数可问治理面：Codex 交叉审阅

- 审阅方式：本机 Codex CLI 0.163.0，`/Users/forrest/.local/bin/codex exec -s read-only --skip-git-repo-check -C /Users/forrest/GitHub/project-lucy`，只读；各轮修订由实施代理落地。
- 对象：`lucy-20261101-ops-evidence-askable-governance` Spec／Plan。
- 原始摘录：`inbox/codex-review-ops-evidence-askable-governance-roundN.txt`（可删工作副本）。

## 第 1 轮

对象是 Spec／Plan **v0.1**。结论：**退回修订（不定稿）。** 阻塞 2，高 6，中 1，低 1。

1. **R01｜阻塞｜窗口／投影刷新／一致性未闭合** — 须冻结形态、窗口入口、快照身份、失效与失败传播。
2. **R02｜阻塞｜Q4 混用 Agent／会话分类，且把窗口无连接称作从未连接** — 须冻结单位、命名与集合关系；降级须削减承诺。
3. **R03｜高｜图可问对等未完整映射到源与 SC** — 补事实→源→SC 清单；对账用真实 API 字段。
4. **R04｜高｜ops_calls 与 ops_agent_activity 被写成可替换但事件集不等价** — 冻结唯一事件集。
5. **R05｜高｜Q5 从「上线以来从未访问」滑成「窗口未访问」，拒答可假关闭** — 冻结分子或显式推迟。
6. **R06｜高｜Q6 分子／分母可两套算法** — 唯一公式 + 反例 SC。
7. **R07｜高｜新源无 SELECT 安全验收** — 禁列扩展到全部新投影。
8. **R08｜高｜旧实例升级／enabled_tables／生效路径缺失** — 补迁移合同。
9. **R09｜中｜ops_tokens 承接跨 Agent 同 label 聚合限制未披露** — 冻结行键与归因范围。
10. **R10｜低｜Plan 漏 `lint:ia-boundary`／落盘清单全项**。

已核对无问题：授权边界、闭口层级、文件身份与索引、149 人口扩展方向、D3 复用路径算法、P2 安全范围声明、术语／DS 形态小节、未混入浏览器／客户出口。

**定稿条件（第 1 轮）**：关闭 R01–R10；开工前冻结项写入合同后再审。定稿仍不构成开发授权。

## 第 1 轮后修订（→ Spec／Plan v0.2）

| 项 | 处理 |
|---|---|
| R01 | D13 物化投影 + Governance Snapshot；D14 失败传播；§4.1；SC-18 |
| R02 | D16 Agent 三类标签；废除「从未连接」终身措辞；SC-07 |
| R03 | §5.4 图事实清单；真实 API 字段；SC-08b–h |
| R04 | D15 运维问数事件集；SC-05b 不等价断言 |
| R05 | D17／D18 上线以来从未访问；`deferred_anchor`；§1.2 禁止假关闭 |
| R06 | D19 唯一活跃率公式；SC-12 反例 |
| R07 | D21＋SC-16 新源禁列 |
| R08 | D22＋SC-17 旧实例 enabled_tables／资产升级 |
| R09 | D23 `(agent_id, token_label)` + 披露 |
| R10 | Plan S4 四门禁 + 落盘清单 11 项；SC-19 |

## 第 2 轮

对象是 Spec／Plan **v0.2**。结论：**退回修订（不定稿）。** 阻塞 1，高 5，中 1。R01–R10：闭合 5／部分 5。新发现 N01（高）旧源被快照流程误伤；N02（中）「同 v0.1」悬空引用。摘录：`inbox/codex-review-ops-evidence-askable-governance-round2.txt`。

残留／新项：R01 快照生命周期、R03 清单漏 rawCalls／confirmedUnauthorized／coverage 去重、R05 历史完整性、R08 旧 Role 授权、R09 Token 双重合同、N01、N02。

## 第 2 轮后修订（→ v0.3）

| 项 | 处理 |
|---|---|
| R01 | D25–D27 唯一键／注入窗／原子发布／TTL；SC-20–22 |
| R03 | §5.4 补 raw／denied／confirmedUnauthorized；D28 pathKey 覆盖率 |
| R05 | D17＋`deferred_history`；生命周期；SC-11 反例 |
| R08 | D22 不写 access.yaml；运营显式扩权；SC-17a–e |
| R09 | D23 **修正** access-map 为 `(user_id,token_label)`；SC-10b |
| N01 | 旧源查询分支；SC-01 |
| N02 | 去掉「同 v0.1」；§1.1 六问原文 |

## 第 3 轮

对象是 Spec／Plan **v0.3**。结论：**仍不可定稿。** 阻塞 1（N02 决策悬空），高 2（R01-a 查询合同、R01-b 查询键与物化代次混淆）。摘录：`inbox/codex-review-ops-evidence-askable-governance-round3.txt`。

已闭合（本轮确认）：R03、R05、R08、R09、N01。

**最小定稿补丁大纲（Codex）**：① 恢复 D16／D18／D19 全文；② 真实 `lucy_query` JSON 与参数处理顺序；③ 区分 query_key 与 materialization_id。

## 第 3 轮后修订（→ v0.4；三轮结束）

按第 3 轮最小补丁落修 Spec／Plan **v0.4**。**未再开第 4 轮 Codex**（用户上限三轮）。是否接受整包定稿，待 PM 逐条定夺后确认。定稿仍不构成开发授权。

## PM 定夺

| 日期 | 议题 | 定夺 | Spec 落点 |
|---|---|---|---|
| 2026-11-01 | Q5／30 天／热库 | **C**：近 30 天未访问即可；不上线满 30；不证明「从未」 | v0.5：D17／D18／§1.1／SC-11 |
| 2026-11-01 | Q4 访问深度 | **MECE 五档**（最深水位）：无记录／仅连接／浏览未问／查数未问／问询活跃；默认窗 30 上海日；会话作第二层 | v0.6：D16／§4.3／SC-07 |
| 2026-11-01 | 图 vs 论述 | **图静态、论述动态，不必对等**；弱化「图可问对等」硬合同 | v0.7：D1／D3／D20／§1／§5.4 |
| 2026-11-01 | Token 调用量 | **E**：问数按 `(Agent,label)`；不改图；不对齐图数字 | v0.7：D23／SC-10＊ |
| 2026-11-01 | 旧 Role 扩权 | **A**：运营显式；ensure 不写 access.yaml；模板带齐新源；无自动迁移 | v0.8：D22／§4.7／SC-17＊ |
| 2026-11-01 | 传窗编码 | **A**：`gov.*` filters + Proxy 剥光；不扩顶层字段、不另造工具；完整名单＋未知拒绝；缺省 30 上海日 | v0.9：D27／§4.1／SC-22 |

## 文档定稿与复审

- 2026-11-01：用户确认 PM 定夺齐套后，Spec／Plan **v0.9 文档定稿**落盘（仍不授开发）。
- 同日 Codex CLI **定稿后复审**（第 4 轮，对象 v0.9）。摘录：`inbox/codex-review-ops-evidence-askable-governance-round4.txt`。

## 第 4 轮（定稿复审）

结论：**需小修后维持定稿。** 阻塞 0，高 3。不重开 PM 产品选择。

1. **高｜Q4 五档不穷尽** — 仅失败的 `lucy_begin_question` 等默认用量落入无档；③ 不能只写「最深至浏览／准备」。
2. **高｜`calendar_days=30` 端点未冻结** — 「含今日」vs「仅完整日」会导致 Q5／Q4／Q6 相反。
3. **高｜Plan §3 仍写修改图 Token GROUP BY** — 违反 D23＝E。

已闭合：N02 悬空引用、R01-a 编码分流（窗语义待第 2 项）、R01-b 代次、Q5＝C、图≠论述、旧 Role＝A。

## 第 4 轮后小修（→ v0.9.1，维持定稿）

| 项 | 处理 |
|---|---|
| Q4 穷尽 | ③ 改为「轻量业务未问」＝默认用量∧无查数∧无真实问询；SC-07 补仅失败 begin |
| 日历窗 | §4.1 冻结含今日半开公式；SC-24 |
| Plan E | 删除图 Token GROUP BY 修正；改为问数侧聚合 |
