# WO-202609-23：业务 Skill 与发布校验口径

| 元数据 | 内容 |
|---|---|
| 文档名称 | WO-202609-23：业务 Skill 与发布校验口径 |
| 文档类型 | Plan |
| 版本 | v1.1 |
| 撰写日期 | 2026-09-23 |
| 撰写人 | Grok |
| 委托人 | xingchen |
| 基于材料 | 2026-09-23 用户反馈纪要；生产只读核查 `10.69.95.109:8276`；Spec 99 / 108 / 127 / 131 / 144 / 145 |
| 适用范围 | 未来一周的实现顺序与验收入口；不授权改生产配置 |
| 输出位置 | `webui/docs/plans/wo-202609-23-skill-hub-and-publish-clarity.md` |

| 字段 | 内容 |
|---|---|
| 状态 | Draft |
| 权威契约 | [Spec 144](../144-skill-hub-mvp-spec.md)、[Spec 145](../145-publish-validation-count-clarity-spec.md) |
| 验收环境 | 本地或 demo。生产升级另开窗口，使用保留配置的平滑升级 |

### Changelog

| 版本 | 变更 |
|---|---|
| v1.1 | 纳入导航组名决策（Spec 144 v1.1，委托人确认）：「业务 Skill」为「业务上下文」组（原「语义建模」更名）第三项；WP-A 任务拆分为 T1–T6 |

## 1. 任务拆分

| 优先级 | 工作包 | 契约 | 本周动作 |
|---|---|---|---|
| P0 | WP-A 业务 Skill | Spec 144 | 实现只读页、Agent 可见性收紧与导航组更名 |
| P0 | WP-B 行权限 | Spec 99 / 100，不新写 Spec | 在非生产环境按清单验收 |
| P1 | WP-C 发布校验口径 | Spec 145 | WP-A 主路径通过后再做 |
| 不做 | 连接「需关注」、启用表删除疑虑、评测跑通 | 见 §5 | 只向用户说明，不改产品 |

## 2. 执行约束

- 先按 Spec 144、145 实现；工单不扩大 Spec 的 Non-Goals。
- 不读取、不提交客户密钥与生产 `ktx.yaml`。
- 不在 `10.69.95.109:8276` 上删除连接、改启用表、改 Role、点「同步索引并生效」。
- 行权限验收使用 demo 或副本配置，不把生产 Role `procurement_pulsar_eval` 直接改成 scoped。

## 3. WP-A — 业务 Skill（P0）

权威契约为 Spec 144 v1.1：「业务 Skill」是「业务上下文」组（原「语义建模」更名）第三项；「语义发布」流水线不含 Skill。

| 任务 | 内容 | 关键文件 | 验证 |
|---|---|---|---|
| T1 | `agentVisible` 收口：`canAccessSkill` 增加 `status !== "published"` → 拒绝 `skill_not_published`；列表过滤同步生效 | `webui/server/proxy/skill-acl.ts` | SC-144-04、SC-144-05 |
| T2 | 通道统一过滤：`resources/list`、`resources/read`、`lucy_skill_read`、`lucy_skill_search`、`initialize` 目录、`prompts/list`/`prompts/get` 全部走 T1 可见集；核查 `/mcp/skills` 透传面是否绕过 ACL，给出收编或封禁结论 | `webui/server/proxy/mcp-proxy.ts` | SC-144-03、SC-144-04 |
| T3 | `/skills` 只读页：列表（名称、域、状态 Tag、`roles_allowed` 摘要、校验结果）+ Drawer 只读详情（标题、Skill URI、触发词、前置依赖、Markdown 正文）；复用 `GET /api/skills` 与 `GET /api/skills/:domain/:name`；无新建/保存/删除/导出 | `webui/src/` 新增页面与路由 | SC-144-01、SC-144-02 |
| T4 | 导航：`navigation.ts` 组 `title` 改「业务上下文」（`id` 保持 `semantic-modeling` 不变）并新增「业务 Skill」项；同步 `06-navigation-ia.md` 分组表、面包屑表与「6+1 结构」验收句 | `webui/src/app/navigation.ts`、`webui/docs/06-navigation-ia.md` | SC-144-01 |
| T5 | 审计核对：允许与拒绝各至少一条访问审计，reason 与 Spec 144 §5 一致 | 现有请求审计链路 | SC-144-06 |
| T6 | 测试与门禁：`skill-acl.test.ts` 补 draft 用例；MCP 面补 SC-144-03/04/05 用例；`cd webui && npm run lint:terminology` 与导航测试通过 | `webui/server/__tests__/`、`webui/test/` | SC-144-07 |

退出门槛：SC-144-01 至 SC-144-07 全过。未过则不开始 WP-C。

## 4. WP-B — 行权限验收（P0，无新 Spec）

权威行为仍是 Spec 99：`row_access: scoped` 必须带 `row_policy`；`all` 禁止带 `row_policy`；受保护源取数走 `lucy_query`。

在非生产环境对一个专用 Role 逐条记录，不在本工单里改策略语义：

| 检查 | 预期 |
|---|---|
| 表范围为「全部行」 | 查询不被行谓词收窄 |
| 改为「限定行」且条件字段是该表行级字段 | 保存成功；`lucy_query` 只返回满足谓词的行 |
| 条件字段写成度量名或不存在字段 | 保存或编译失败，原因含 `row_policy_field_unresolved` |
| 对 scoped 表调用 `lucy_read_source` 取数 | 拒绝，原因含 `row_policy_requires_wrapped_tool` |
| 生产 Role 仍为「全部行」 | 本周不修改；升级窗口前用验收记录决定是否打开 scoped |

退出门槛：上表有通过/失败记录。失败项另开缺陷，不并入 Spec 144。

## 5. WP-C — 发布校验口径（P1）

仅当 WP-A 退出门槛已过。

| 步骤 | 内容 | 验证 |
|---|---|---|
| C1 | 页眉与步骤条按 Spec 145 伪代码展示进行态与 A/B | SC-145-01、SC-145-02 |
| C2 | 文件数大于表数时展示其余文件说明 | SC-145-03 |
| C3 | 失败与零表分支 | SC-145-04、SC-145-05 |
| C4 | 去掉不带对象的「校验通过 N 张」 | SC-145-06、SC-145-07 |

不点击生产环境的同步按钮。demo 上若需观察同步，单独确认后再做。

## 6. 本周明确不做

| 反馈 | 处理 |
|---|---|
| `fin_mysql` 显示「需关注」 | Spec 108 已定义：响应延时 >1000ms 为「需关注」，「不通」才是失败。现场约 4393ms 且连通测试退出码 0，属于偏慢。删除连接用 Spec 127，由用户在变更窗口自行确认 |
| 临时启用表不敢取消 | 启用表范围的取消勾选不删除物理表。影响预览不在本周开发 |
| 评测跑起来 | 用户已接受延后 |
| KICC 仍见旧配置 | 声明式加载，重启客户端进程后读取新配置；Lucy 本周不改 |

## 7. 一周顺序

1. 确认 Spec 144、145 可开工。
2. 完成 WP-A。
3. 并行或穿插完成 WP-B 记录。
4. WP-A 通过后完成 WP-C。
5. 生产升级不包含在本工单的完成定义里。
