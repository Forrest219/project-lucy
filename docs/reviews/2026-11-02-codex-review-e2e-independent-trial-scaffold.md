# E2E 功能试跑优化：Codex 交叉审阅

- 审阅方式：本机 Codex CLI 0.163.0，`/Users/forrest/.local/bin/codex exec -s read-only --skip-git-repo-check -C /Users/forrest/GitHub/project-lucy`，只读；各轮修订由实施代理落地。
- 对象：`lucy-20261102-e2e-independent-trial-scaffold` Spec／Plan。
- 原始摘录：`inbox/codex-prompt-e2e-trial-roundN.md`、`inbox/codex-review-e2e-trial-roundN.txt`（可删工作副本）。
- 上限：三轮。第 3 轮给出可定稿，未再开第 4 轮。

定稿只覆盖这份设计合同。功能合同未收口，SC-01–SC-13 未执行，运行代码未改，本条收口不表示可上线。

## 第 1 轮

对象是 Spec／Plan **v0.2**。结论：**退回修订，不定稿。** 阻塞 0，高 7，中 2，低 0。摘录：`inbox/codex-review-e2e-trial-round1.txt`。

1. **R01｜高｜SC-07～SC-09 没有完整约束生产调用点** — 夹具可以绕过浏览器 spec 里把 gold 题目写进防换题两边、用 `gold.expected` 拼最终答案的调用点。
2. **R02｜高｜阶段判定没有闭合原 J01-07 成功条件** — 三条反作弊通过不等于阶段通过；缺 typed gold、真实查询、同会话追问和身份／版本绑定。
3. **R03｜高｜纯 protocol 分类与源码不符** — SEM、ACCESS 模板、OBSERVE、LIFECYCLE 含页面操作。
4. **R04｜高｜LIFECYCLE 混用两套升级资产** — `run-upgrade.mjs` 与 `run-upgrade-features.mjs` 的编号和合同不同。
5. **R05｜高｜AGENT 责任域筛选无可验收定义** — 现有 runner 按 `runner === "agent"` 选，不按 owner。
6. **R06｜高｜结果选择没有覆盖实际退出状态链** — 管理腿仍按冻结目录汇总退出。
7. **R07｜高｜已落地 Schema 方案被写成已裁决合同** — 2026-10-25 报告 §5.2 的 PM 二选一仍开着。
8. **R08｜中｜未选中项可能被读成 passed** — 缺通过计数、范围展示和空选择拒绝。
9. **R09｜中｜完成定义漏掉 SC-10 所在的 `j01-schema.test.mjs`。**

已核对无问题：闭口层级、点名文件存在、CONN 的 mixed、gold 自比描述、Schema 函数存在、八阶段连续状态链、缺 Agent 证据不得 passed。

**定稿条件（第 1 轮）**：修齐合同、SC 与 Plan 后再只读复审。不要求真实试跑。

## 第 1 轮后修订（→ Spec／Plan v0.3）

| 项 | 处理 |
|---|---|
| R01 | 判定只走 `judgeMainlineAgent`；浏览器 spec 不直接组三条断言 |
| R02 | 阶段 passed 同时要求 typed gold、`lucy_query`、同会话第二问、`expectedBinding` |
| R03 | §2.1 按文件标 browser／protocol／mixed；SC-11 拒绝纯 protocol 戳记 |
| R04 | LIFECYCLE 只走 `run-upgrade-features.mjs`，不把 UPG25 记成通过 |
| R05 | 排除 `SEC-14-V12` 与 J01 两问 |
| R06 | 有 target 时退出码只看 `selectedIds` |
| R07 | 写明不关闭 §5.2，不代替复验，不宣称 seed／digest 已核对 |
| R08 | 未选中不计入 passed；空选择拒绝 |
| R09 | 验收表列入三份测试文件 |

## 第 2 轮

对象是 Spec／Plan **v0.3**。结论：**退回修订。** 阻塞 0，高 5，中 1，低 0。摘录：`inbox/codex-review-e2e-trial-round2.txt`。

闭合：R03、R07、R08、R09。

部分闭合：

- **R01｜高** — 源码守卫能被别名绕过；缺共用读取路径上的夹具。
- **R02｜高** — `tokenSecretRef` 不是比较字段；缺键会被现有比较器跳过。
- **R04｜高** — `run-upgrade-features.mjs` 自行 prepare，写出 `lucy-upgrade-checklist/v1` 的 `upgrade-checklist.json`；父子 run 未分清。
- **R05｜高** — 全部 AGENT owner 仍含 `SEC-16-V04` 等会被 runner 再滤掉的项。
- **R06｜高** — 各目标 `selectedIds` 未定义；`J25-01` 是单独的主干聚合结果。

新发现：

- **N01｜中** — Plan 把「只有 `finalAnswer` 含金额」写进不得 passed，与 SC-08 的正常对照冲突。

## 第 2 轮后修订（→ Spec／Plan v0.4）

| 项 | 处理 |
|---|---|
| R01 | `loadMainlineAgentEvidence` 再进 `judgeMainlineAgent`；SC-07 要求恢复 gold 自比、gold 拼答案或 trace 冒充时夹具失败 |
| R02 | 必填键含 `tokenLabel` 或 `tokenId`；缺键不得 passed；SC-09 覆盖错误 Token／版本 |
| R04 | 子 run 的 `upgrade-checklist.json` 与合同 `lucy-upgrade-checklist/v1`；SC-13 拒绝 UPG25 顶替 |
| R05 | 可执行名单是 owner 与 `runner === "agent"` 的交集；SC-12 要求完整集合、禁止静默丢项 |
| R06 | `mainline` 的 selectedIds 只有 `J25-01`；分支 id 与 `coversV025` 对照 |
| N01 | 「只有最终答案含正确金额」单列为可以 passed 的正常对照 |

## 第 3 轮

对象是 Spec／Plan **v0.4**。结论：**可定稿。** 阻塞 0，高 0，中 0，低 0。无 N02。摘录：`inbox/codex-review-e2e-trial-round3.txt`。

- **R01：闭合。** 共用读取与判定路径；SC-07 覆盖 gold 自比、gold 拼答案、trace 冒充。
- **R02：闭合。** 秘密引用与 Token 标识分开；必填键和错误 Token／版本有反例。
- **R04：闭合。** 子 run、结果路径、合同名和 selectedIds 来源已写明。
- **R05：闭合。** 交集与完整集合断言已写明。
- **R06：闭合。** 主干只取 `J25-01`；SC-06 经命令包装层看 failed／blocked。
- **N01：闭合。** 正常对照与泄露反例分开。

R03、R07、R08、R09 未被 v0.4 改坏。出口仍是选择器、离线夹具、源码守卫和 `--list`。

**定稿条件：** 本轮残留已满足。定稿不表示开发已授权，也不表示 SC 或真实试跑已通过。
