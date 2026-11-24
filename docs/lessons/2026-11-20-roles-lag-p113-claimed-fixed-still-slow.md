# 错题：Roles 卡顿被误判为「P1-13 已修」后客户仍卡，需 P1-58 再修一层

| 元数据 | 内容 |
|---|---|
| 日期 | 2026-11-20 |
| 标签 | `gate-gap` `ux-regression` `contract-stack` `ops-delivery` `sev-high` |
| 环境 | 客户侧曾报 `/api/admin/roles` 数十秒、Wiki「无人可见」；版本核实为 **0.30.0／`3a9f0711`**（已含 P1-13，**不含** P1-58）。本机 demo UAT 仅约 5 个 Role。二次修复提交 `af13b9d5` |
| 相关 | [P1-13 Spec](../specs/lucy-20261113-release-perf-baseline-gate-spec.md)；[UAT-SUITE-ROLES-AGENT-PERF](../qa/uat/suites/roles-agent-page-perf/suite.md)（demo PASS）；[P1-58 Spec](../specs/lucy-20261119-roles-agent-read-responsiveness-spec.md)；[P1-59 Spec](../specs/lucy-20261119-roles-agent-concurrent-edit-spec.md)；实现 `af13b9d5`；[客户版本回传](../../inbox/20261118-1549-customer-lucy-version-check-response/20261118-1549-customer-lucy-version-check-response.md) |
| 状态 | `mitigated`（P1-58／59 Wave1–3 已实现并提交；完整 F58／2×／5×／浏览器仍 NOT RUN；客户实例未用本提交复测 → 未写 `closed`） |

## 1. 症状与影响

- 客户管理面：打开 Wiki／角色相关页时 `GET /api/admin/roles` 长时间无响应；同进程后续请求（如 `/api/wiki`）pending；页上看到空目录或「无人可见」。问数 MCP 路径可正常。
- 代理侧曾对照历史「Roles 列表 N× fresh preview」债，声称「本次 0.30 升级已含 P1-13，问题已修」。
- 现场在已升到 **含 P1-13 的 0.30** 后**仍然卡顿**；委托人再次立项并落地 P1-58／59（`af13b9d5`）。

## 2. 复现要点

判定条件（不必再造客户库也能核对）：

1. `git merge-base --is-ancestor 755fc706 3a9f0711` → **true**（客户构建已含 P1-13 batch）。
2. `git merge-base --is-ancestor af13b9d5 3a9f0711` → **false**（客户构建**没有**展示快照／统计分区）。
3. P1-13 UAT 夹具：demo ~5 Role、列表 API 几十毫秒 → **不能**外推「客户几十～上百 Role + 大审计库仍流畅」。
4. P1-58 Spec §1.3 已写明：单请求共用 `AdminPermissionContext` **已是既有优化**，本条另做跨请求展示复用与 Agent 统计减负——即合同自己区分了「两层债」。

## 3. 根因

分层：

| 层 | 内容 |
|---|---|
| **产品债分层** | **P1-13** 只修「**单次** `GET /api/admin/roles` 内 N× 重建 source map」→ 改为一次 `buildAdminPermissionContext` + 循环 `compileRoleForAdmin`。**未修**：每次列表请求仍全量重编译；无跨请求 singleflight／展示快照；Agent 列表窗口统计与全历史 `lastSeen` 同步 SQLite 压事件循环；名册与统计同包导致一慢全慢。 |
| **第二层债（真·客户续卡）** | **P1-58**：角色展示接入版本化 display snapshot（同键 singleflight、跨请求复用）；Agent 查询拆分／roster↔statistics 分区；网关 HTML 502／503 不再伪装成 JSON 解析错。**P1-59**：对象级并发编辑与恢复（同提交，但不是「卡顿」主因）。 |
| **代理误判** | 把客户「roles 慢 + Wiki 假死」**症状面**直接等同于 P1-13 **已闭合根因**；用 demo 小夹具 PASS 当客户验收；**未先核对客户 `gitSha` 是否已含被声称的修复**。客户已是 `3a9f0711`（有 P1-13）仍慢 → 结论应是「P1-13 不够／另有债」，而不是「升级带上就好了」。 |
| **门禁几何** | `UAT-SUITE-ROLES-AGENT-PERF` 验证的是「batch 后 demo 体感」与发布取证相对基线，**不是**客户 Role 数 × 启用表 × 审计库规模下的列表墙钟；P1-58 的 2×／5× 与完整 F58 当时也未跑。 |

## 4. 为何漏检

1. **症状匹配 ≠ 根因闭合。** 同一 UI 症状可以叠两层性能债；修掉一层后现场继续报同一句话，必须重新量接口与版本，不能复读旧结论。
2. **未做「客户已含修复？」否证。** 版本回传早于二次立项：0.30.0／`3a9f0711` 已含 `755fc706`。若声称「P1-13 已修客户问题」，该否证一步即可推翻。
3. **小夹具绿写成客户绿。** 5 Role／空闲 demo 上 20–60ms，对「角色爆炸 + 同步编译 + 审计统计」零证明力。
4. **总账／Spec 已分条，答复却合并。** 执行总账同时有 P1-13 与后续 P1-58；P1-58 正文明确「不把已实现的 batch 再登记为新成果」。代理答复却把客户续卡并进「P1-13 已修」。
5. **发布取证／页体感 UAT PASS ≠ 客户规模 SLA。** INDEX 上 Roles／Agent 页 PASS 与「客户 Wiki 因 roles 阻塞」可同时为真。

## 5. 举一反三

1. **声称「某客户反馈已在本次升级修复」前，先核对客户 `lucyVersion`＋`gitSha` 是否已是被引用提交的后代。** 已是后代仍复现 → 禁止再写「该提交已修」；应开差集／新债。
2. **性能债按请求几何拆层表述：** 单请求内 N× 重活／跨请求无复用／同步 SQLite 统计／事件循环与探针 —— 不得用一层 PASS 覆盖其余层。
3. **demo 或发布取证小夹具的墙钟，不得单独作为客户规模消单证据。** 客户量级（Role 数、启用表、审计行）未覆盖时，答复上限是「对应债已合入代码／demo 验证」，不是「客户已好」。
4. **总账已有更新条目（如 P1-58）时，禁止把客户同症回流成旧条目「已修」。** 先读新 Spec 的「与旧条关系」段。
5. **Agent 自检句：** 「我引用的修复提交，客户构建里有没有？若有，为什么还慢？」答不上来就不得写已修复。

## 6. 后续动作

| 动作 | 状态 | 说明 |
|---|---|---|
| P1-58／59 Wave1–3 实现落地 `af13b9d5` | 完成 | 展示快照、统计拆分、roster／statistics、并发编辑协议等；≠ 功能合同收口 |
| 完整 F58／F59／浏览器／2×／5× | 未开／NOT RUN | 测试台仍 SMOKE_PASS WITH GAP；登记 ≠ 授权现在打满 |
| 客户实例用含 `af13b9d5` 的镜像复测 Roles／Wiki 墙钟 | 未开 | 维护窗；登记 ≠ 授权打客户 |
| 本错题写入索引，供后续「客户卡顿是否已修」答复引用 | 完成 | 本文件 |

## 7. 证据指针

- 误判语境：对话中对照客户「`/api/admin/roles` 40–50s」答复「P1-13 已在 0.30」；P1-13 UAT 跑次 [2026-11-13-cursor-docker-page-perf](../qa/uat/suites/roles-agent-page-perf/runs/2026-11-13-cursor-docker-page-perf.md)（~5 Role、55ms）。
- 客户已含 P1-13 不含 P1-58：`3a9f0711` 祖先检查；[版本回传](../../inbox/20261118-1549-customer-lucy-version-check-response/20261118-1549-customer-lucy-version-check-response.md)。
- 合同分层：P1-58 Spec §1.3／§2「与 P1-13／Spec 174 的关系」。
- 二次修复：`git show af13b9d5`（`roles.ts` 改走 `getDisplaySnapshot`／`compileAdminRoleListRows`；`agents.ts` roster／statistics）。
