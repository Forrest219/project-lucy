# Agent 名册 —— 功能合同收口记录

| 元数据 | 内容 |
|---|---|
| 日期 | 2026-11-01（Asia/Shanghai） |
| Spec | [`docs/specs/lucy-20261030-agent-roster-spec.md`](../specs/lucy-20261030-agent-roster-spec.md)（收口后 **v1.3**） |
| Plan | [`docs/plans/lucy-20261030-agent-roster-plan.md`](../plans/lucy-20261030-agent-roster-plan.md) |
| 台账号 | 无。不进入 v0.25 升级台账，不另派 WebUI 流水号 |
| 层级 | **功能合同** |
| 结论 | **SC-01–SC-15 全部关闭。** 本条收口**不表示可上线**——移动窄屏、Docker 重建、客户交付不在本条出口 |
| 授权 | PM 2026-11-01 批准「B 档 + 形态搭车」批次 |

---

## 一、本条为什么值得单独记一笔：**Spec 状态行只反映了设计定稿**

盘点阶段发现本条与 login-accounts 的 **Spec 状态行与实施 Plan 互相矛盾**：

| 来源 | 内容 |
|---|---|
| Spec 状态行（`:8`，收口前） | 「**v1.2 已定稿**。第 3 轮 Codex 确认可定稿，阻塞 0，高 0」——只讲了**设计定稿**，没讲后续实施 |
| 实施 Plan 状态行（`:9`） | 「**v1.2 已定稿**。**S1、S2 已按本 Plan 实现，SC-01–SC-15 已执行并通过**（2026-10-30，记录见 §5）」 |

Plan 的 §5.1 给出**逐条 SC → 测试文件 → 测试名**的对照表，Plan 头部「验收」行也写着「SC-01–SC-15 已执行并通过。命令与结果见 §5」。

**结论**：设计与实施在 2026-10-30 就已完成并留痕，**是 Spec 状态行没跟上**。本次收口把 Spec 状态行更正到与事实一致，并**按 Plan 的既有记录逐条复核**（不直接采信）。

## 二、出口矩阵结果（逐条 SC → 用例）

**证据等级：本地自动化（vitest）＋ 本地工程门禁。** 无 CI job 证据，无客户环境证据。

| SC | 结果 | 证据落点 |
|---|---|---|
| SC-01 | 通过 | `agent-list.test.tsx`「renders stability-and-adoption top metrics（SC-01）」 |
| SC-02 | 通过 | `agent-list.test.tsx`「renders prioritized table columns for ops value（SC-02）」 |
| SC-03 | 通过 | `agent-list.test.tsx`「SC-03 已启用的行没有状态标记，未启用的行在显示名旁标「已禁用」」 |
| SC-04 | 通过 | `agent-list.test.tsx`「SC-04 Token 格按可用数与配置数写主行与次行」 |
| SC-05 | 通过 | `agent-list.test.tsx`「SC-05 仅连接可以被看见，但不进活跃 Agent 分子」 |
| SC-06 | 通过 | `agent-list.test.tsx`「SC-06 闲置行不带「仅连接」标记」 |
| SC-07 | 通过 | `agent-list.test.tsx`「SC-07 指标不可用的行显示「—」，只有 metricsState=unavailable 写「数据不可用」」 |
| SC-08 | 通过 | `agent-list.test.tsx`「SC-08 近 7 天活跃四档互斥、且不改变行序」 |
| SC-09 | 通过 | `agent-list.test.tsx` 三支——去掉 `windowStart` 时协议量大于 0 仍是仅连接、协议量为 0 不再是；去掉 `windowEnd` 时协议量为 0 不标仅连接；缺整个 `summary` 时协议量大于 0 可标仅连接、协议量为 0 不标 |
| SC-10 | 通过 | `object-detail-drawer.test.tsx` 四支——指标可用时抽屉展示协议请求量与两个时间、业务调用量读 `usageCallsLast7d`；指标可用但时间为空时写「未使用」和「未访问」；指标可用且协议量为 null 或缺失时写「—」不写成 0；指标不可用时五个值都是「—」且正文不出现「未使用」或「未访问」 |
| SC-11 | 通过 | `agent-list.test.tsx`「SC-11 名册不再提示凭据 prefix 冲突」 |
| SC-12 | 通过 | `kpi-contracts.test.ts`「SC-12 名册不再登记「近 N 使用过的凭据」，其它条目仍指向本页」 |
| SC-13 | 通过 | **既有接口测试，未另写服务端测试**：`admin-agents.test.ts`「separates protocol requests from business usage and keeps all-time last access」（`protocolCallsLast7d`、`lastSeen`）、「marks used-credential metrics partial when con…」 |
| SC-14 | 通过 | `agent-list.test.tsx`「SC-14 a-time 在窗口内是仅连接，最近 MCP 访问改成窗口终点后不再是」 |
| SC-15 | 通过 | `agent-list.test.tsx`「SC-15 窗口内的业务时间不构成仅连接，协议量大于 0 仍是」 |

**实测（2026-11-01 复跑）**：`agent-list.test.tsx` / `kpi-contracts.test.ts` / `object-detail-drawer.test.tsx` —— **3 文件 / 82 条全绿**。

## 三、这些用例**不是空转**（S1 退出条件的反证表）

Plan §5.1 记录了一组**反证**：把设计里的某条判定拿掉，哪些 SC 应当失败。

| 拿掉什么 | 应当失败的 SC |
|---|---|
| 删掉时间条款 | SC-07、SC-08、SC-14、SC-15 |
| 把缺失的 `windowStart` 当成没有下界 | SC-09 |
| 把闲置写成「业务调用量为 0」 | SC-05、SC-07、SC-08、SC-09（两支）、SC-14、SC-15 |
| 抽屉去掉「先判指标是否可用」的守卫 | SC-10 不可用分支 |

这组反证说明每个 SC 都挂在**具体判定的失效**上，不是「断言一个常量」的空用例。

## 四、残余

1. **移动窄屏验证、Docker 重建、客户交付未执行**——按 Spec「闭口层级」**不在本条出口**，不构成收口阻塞。
2. **SC-13 复用既有接口测试，未另写服务端测试**——这是 Plan 的既定选择（该条验证的是接口已分开的 `protocolCallsLast7d` 与业务调用量口径，不是本条新增的服务端行为）。
3. **本条不改三层分类、恒等式、活跃 Agent 分子**——用量口径继续以 Spec 155／189 为准（Spec「与既有 Spec 的关系」已冻结）。

## 五、不在本次收口里

- **Docker 重建、客户交付、客户环境验证**——本条收口**不表示可上线**，也不构成客户包验收。
- **整库旅程、跨模块故障演练、证据等级**——归发布取证层（该层目前**没有承载本轮已收口功能的已执行 Spec**——形态搭车后有 2 份交付／构建契约类声明了该层，但均未执行，见 [`2026-11-01-spec-closure-inventory.md`](2026-11-01-spec-closure-inventory.md) §五）。

## 六、复现命令

```bash
cd /Users/forrest/GitHub/project-lucy/webui
CLEAN_PATH=$(printf '%s' "$PATH" | tr ':' '\n' | grep -v "minimax" | tr '\n' ':')
env PATH="$CLEAN_PATH" npx vitest run --maxWorkers=1 \
  src/__tests__/agent-list.test.tsx \
  src/__tests__/kpi-contracts.test.ts \
  src/__tests__/object-detail-drawer.test.tsx
```

> 必须用干净 PATH：本机 `/Users/forrest/.minimax/shims/rm` 是 `mavis-trash` 垫片，非交互子进程里 `rm -rf` 会挂死不返回。
