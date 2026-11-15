> 落盘后记：第三轮评审结束后，按本文「还差哪一句」改了 fixtures／cases（含删掉 SQL 对照、写死 Role v2、补 `field_exposure_unavailable`）。没有第四轮评审。下面是评审原文。

# 结论：BLOCK

只读复核；未跑 UAT、未改仓内文件、未写 PASS。

## 抽查实现（三处指定核对）

| 核对点 | 结果 |
|---|---|
| mcp-proxy.ts filters 校验：「field+op+value 再加 `or` 键」 | **不会**先返回 `filters_field_required`。`invalidFilterFieldReason`（`webui/server/proxy/mcp-proxy.ts:1536-1560`）只查 field/op/value，不查多余键；只有纯 `{or:[...]}` 才命中 `:1543`。入参校验确实先于 ACL（`:4232-4236` vs `:4772`）。 |
| row-policy.ts 对带 `or` 键对象 | 返回 `row_policy_query_shape_forbidden`（`row-policy.ts:401` FORBIDDEN_FILTER_TREE_KEYS 含 `or`，`:430-435`）。cases.md:126 的写法可达。 |
| `scope_intersection_empty` | 只是审计 `decision_reason`（`mcp-proxy.ts:3624-3630`，由 `row-policy.ts:686-711` 推导）；客户端收到的是 0 行成功响应。 |

## 仍成立的发现

**R3-01｜BLOCK｜fixtures.md:59-61 ／ cases.md:70-78** — 行级列规则与 fallback 自相矛盾，被授权的分支没有可执行程序：

1. 受限侧同样不能按该列分组 → ROW-02 的「只有本人那一个分组」「与对照格逐值一致」在受限侧没有「那一格」可比（核心分母的必做断言落空）；
2. 两侧跨引擎：SQL 格绕过语义层（segments／口径／暴露裁剪），lucy_query 格走语义层 → 差值被记成行权限 FAIL（假红），正是本轮要防的失真；
3. 前提本身是错的：demo 的 `superstore_orders.yaml` 无 `table:` ＝ 真 Manifest overlay，物理列整体可作维度（P0-A Spec E9／E10；`lint-semantic-yaml.py` OVERLAY_MISSING_TABLE 注释），仓库 demo eval 就按 `dimensions:[superstore_orders.region]` 分组并有 gold（`examples/docker-demo/project-template/evals/demo_superstore/eval/demo_superstore-eval-cases.yaml:194`、`examples/docker-demo/mysql/_baseline.json#sales_by_region`）。所以「不能按 region 分组」这个分支在 demo 不成立。

**R3-02｜SHOULD｜fixtures.md:35（承 R2-04②）** — 「它还改 `KTX_VERSION`。若 KTX 版本被改掉，本轮 BLOCKED」是假前提：`KTX_VERSION` 是 build arg（`Dockerfile:22/46`），overlay 里是同名运行期变量且与默认同值，运行期只读 `LUCY_BUNDLED_KTX_VERSION`（`webui/server/index.ts:749`）→ 该条件永不触发；真正会毁掉本套件的是同一 overlay 的 `LUCY_UPSTREAM_FORCED_PREDICATE_PROVEN=true`（悄悄废掉 Gate-Off），文档没写。

**R3-03｜SHOULD｜fixtures.md:15、47 ／ cases.md:32** — 临时 Role 形状没写死：WebUI 存角色必写 `permission_model_version: 2`（`webui/src/pages/admin/RoleDetail.tsx:356`），v2 下每张表必须声明 `row_access`（`acl.ts:1121-1133`）：不写 → `role_resolution_failed:<role>:v2_row_access_required`（`acl.ts:1481-1485`）＋ Agent 写 constraints 时 `constraints_source_not_in_capability`；写 `all` → 角色级就是「全部行」，与 R0 第 5 步字面冲突（那条本意指 demo 的 `demo_readonly` 覆盖三张表）。另：同时用 scoped Role 与 Agent constraints 时同表是 AND（`acl.ts:1821`），值不同 → `final_rows_unsatisfiable`（`agent-constraints.ts:283-284/389/405`），Agent 创建被拒；夹具未二选一。

**R3-04｜SHOULD｜cases.md:18** — 「其他闸」清单缺 `field_exposure_unavailable`（`acl.ts:3466-3471`），demo 侧 GAP-UAT-P0-A-EXPOSURE 正是它的温床；命中时无记录口径（FAIL 还是 BLOCKED 由跑次自选）。

**R3-05｜NIT｜cases.md:66 vs fixtures.md:55** — cases 仍写「预览或 explain」，与 fixtures 钉死的「`lucy_explain_query` → `finalRowsNonTrue=true`；角色预览不能单独当证据」冲突；且字段是布尔 `finalRowsNonTrue`，不是「FinalRows 为 scoped」（`row-policy.ts:539/563`）。

**R3-06｜NIT｜cases.md:125 vs 131** — 向量 2 未写源限定名：强制谓词叶子字段是 `${sourceName}.${field}`（`row-policy.ts:375`），审计归零判定也要求限定名（`:658`）→ 裸 `region` 时归零照样发生但审计理由不出现。

**R3-07｜NIT｜cases.md:73** — 「任选两人互换」未定义互换什么、期望怎么判。

**R3-08｜NIT｜fixtures.md:13/65 vs cases.md:126** — 读候选步骤未写「按该列分组」；fixtures「filter 只用 `{field, op, value}`」与 ROW-05 向量 3 故意多带 `or` 键字面冲突。

## R2 逐条状态

| R2 | 状态 |
|---|---|
| R2-01 | 闭合（形状可达，见上表） |
| R2-02 | 闭合 |
| R2-03 | 半闭合 → 转 R3-01 |
| R2-04① | 闭合（Gate-On overlay 只设 proven，命令齐） |
| R2-04② | **仍成立** → R3-02 |
| R2-05 | 闭合（.cursor 规则 10 已含 P0-A） |
| R2-06 | 闭合（P1-29／REQ-030-050 承接行已进总账＋需求池＋台账；cases.md:161 也写了） |
| R2-07 | 闭合 |
| R2-08 | 闭合（码与 `acl.ts:3519-3520`、`:1610-1614` 一致） |
| R2-09 | 闭合（cases.md:18），但清单不全 → R3-04 |
| R2-10 | 闭合（suite.md:30 补 REQ；fixtures.md:55 钉死 explain），cases.md:66 残留 → R3-05 |

## 还差哪一句文档

1. **R3-01**（fixtures.md:59-61，删掉 SQL fallback 分支）补：「行级列必须同时满足：① 该 source 的物理列（manifest 里有，可被编译闸绑定）；② 同一 source 在 lucy_query 里能作 dimensions 分组维度（demo 的 `superstore_orders.region` 满足：`superstore_orders.yaml` 是真 Manifest overlay，物理列由 `_schema/dataforai.yaml` 提供）。**对照与受限两侧必须是同一次 lucy_query、同一分组维度、同一 measures、同一 segments**；SQL 只能作旁证，不得作对照格。两侧无法用同一次 lucy_query 表达 → 记 BLOCKED（夹具）。」
2. **R3-02**（fixtures.md:35）改写为：「禁止用 `docker-compose.ac-p1-by01.yml` 整份 overlay：它带 `LUCY_UPSTREAM_FORCED_PREDICATE_PROVEN=true`（会让 Gate-Off 静默失效），另带 `KTX_VERSION`（build arg 同名运行期变量，不改镜像内捆绑 KTX 版本）与 `POSTHOG_DISABLED=1`。」
3. **R3-03**（fixtures.md:47）补：「临时 Role `uat-row-policy-role`：v2（`permission_model_version: 2`），每张表 `row_access: all`（角色级不收窄），`allow.tools` 含 lucy_query／lucy_explain_query／lucy_catalog；个人收窄只在 Agent `constraints.sources[]`。R0 第 5 步的「全部行 Role」指 demo 的 `demo_readonly`（覆盖三张表），不指本套件临时 Role 的 `row_access: all`。Role 的 row_policy 与 Agent 的 constraints 同表是 AND，值不同 → `final_rows_unsatisfiable`，二者只选其一。」
4. **R3-04**（cases.md:18）：并入 `field_exposure_unavailable`（与 `caliber_binding_violation`／`field_not_exposed` 同记 BLOCKED（其他闸）＋记实际码）。
5. **R3-05**（cases.md:66）：改成「用 `lucy_explain_query` 确认 `finalRowsNonTrue=true`；角色级预览不算证据」。
6. **R3-06**（cases.md:125）：补「行级列条件写源限定名 `<source>.<行级列>`（与向量 3 同格式）」。
7. **R3-07**（cases.md:73）：写死互换对象与可判期望（如「交换 u01/u12 的 scope 后，u01 看到的应是原 u12 那一格」）。
8. **R3-08**（fixtures.md:13/65）：读候选补「按该列分组」；查询形状补「除 UAT-ROW-05 向量 3 外」。

报告落盘：`~/.claude/plans/uat-uat-pass-delegated-flute.md`（仓内未动）。
