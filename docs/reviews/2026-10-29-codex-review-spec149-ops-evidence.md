## 结论：退回修订

当前两份文档尚不能作为实施基线。主要阻塞是：**资产复制路径与现有内容根机制不符，以及启动补齐连接后没有让 KTX 执行层加载新配置的流程**。此外，物理名冻结、Token 人口和上下文授权仍有需要裁决的契约问题。

## 审阅基线与限制

以本次读取的工作树正文为准，完整阅读了 Spec 149 v1.1、Plan v2.0；对照阅读或定向核对了：

- 治理文档、术语标准，以及 Spec 07、23、04 数据模型、125、127、131、144、151、171、180、189、191。
- `usage-classification.ts`、审计表结构与写入路径、ACL 角色编译与查询授权、目录返回路径。
- 内容根解析、内容镜像、语义层读取、Skill loader、Skill/Wiki 对象 ACL。
- WebUI 启动流程、连接创建与删除、Docker entrypoint、demo Compose、demo ACL 和语义模板。
- Token 创建时的标签约束。本机 KTX 包版本仅作环境核对，未将其等同于 Docker 捆绑版本。

工作树已有其他改动，本次没有修改任何文件；没有执行测试、构建、Docker、服务启动、KTX 命令或数据库查询。以下是静态设计审阅结论，不是运行验收结果。

## 发现列表

### R01｜阻塞｜模板复制到了加载器不读取的位置

**位置：** Spec §5.4、§5.5、§8；Plan T3、T6。见 [Spec:191](/Users/forrest/GitHub/project-lucy/webui/docs/149-ops-evidence-connection-spec.md:191)、[Plan:147](/Users/forrest/GitHub/project-lucy/webui/docs/plans/wo-202609-25-ops-evidence-connection.md:147)。

**问题：** 文档明确复制到 `<projectRoot>/semantic-layer`、`skills`、`wiki`。现有事实源默认是 `<projectRoot>/config/`，还支持环境变量和 YAML 覆盖。相关读取分别见：

- [paths.ts:112](/Users/forrest/GitHub/project-lucy/webui/server/paths.ts:112)
- [skills/loader.ts:161](/Users/forrest/GitHub/project-lucy/webui/server/skills/loader.ts:161)
- [wiki.ts:887](/Users/forrest/GitHub/project-lucy/webui/server/wiki.ts:887)
- [acl.ts:352](/Users/forrest/GitHub/project-lucy/webui/server/proxy/acl.ts:352)

Docker demo 当前也明确使用 `/data/lucy/config`，见 [Compose:79](/Users/forrest/GitHub/project-lucy/deploy/compose/docker-compose.demo.yml:79)。

**影响：** 按文档实现后，复制文件可以成功，但 Proxy 找不到语义、Skill 和 Wiki；根目录里的文件还可能只成为 KTX 镜像侧资产，产生两侧不一致。

**最小修复建议：** 将目标定义为解析后的 `ContentPaths`，沿用现有内容根→项目根镜像机制；把“已存在不覆盖”的判定放在内容事实源。增加默认 `config/`、自定义内容根和 `LUCY_CONTENT_ROOT=.` 三种路径验收。

### R02｜阻塞｜启动确保没有闭合执行层生效流程

**位置：** Spec §8、§10；Plan T2，见 [Plan:91](/Users/forrest/GitHub/project-lucy/webui/docs/plans/wo-202609-25-ops-evidence-connection.md:91)。

**问题：** Docker 先启动 KTX、等待就绪，再启动 WebUI，见 [entrypoint:849](/Users/forrest/GitHub/project-lucy/scripts/runtime/docker-entrypoint.sh:849)、[entrypoint:857](/Users/forrest/GitHub/project-lucy/scripts/runtime/docker-entrypoint.sh:857)、[entrypoint:865](/Users/forrest/GitHub/project-lucy/scripts/runtime/docker-entrypoint.sh:865)。方案却在 WebUI 启动时才写入连接。

KTX 连接配置在 daemon 启动时读取，写文件不会自动生效，见 [mcp-runtime-reload.ts:4](/Users/forrest/GitHub/project-lucy/webui/server/admin/mcp-runtime-reload.ts:4)。同时，WebUI 当前先提交 EffectivePolicy，见 [index.ts:2590](/Users/forrest/GitHub/project-lucy/webui/server/index.ts:2590)；文档没有规定确保逻辑相对这一步的位置。

**影响：** 全新 seed 即使已有 `demo_ops`，也可能出现配置文件已有连接、Proxy 策略未收录，或目录可见但 KTX 不认识连接。读模板和直接查询 SQLite 的夹具不能发现这一问题。

**最小修复建议：** 明确“迁移与视图→连接与资产→镜像→策略编译→执行层加载→开放访问”的启动顺序。选择在 KTX 启动前完成确保，或明确接入 Spec 191 的生效流程及失败状态。增加首次启动与已有卷新增连接的确定性集成验收，无需调用大模型。

### R03｜高｜T0 混淆物理表名与 Role schema，且未绑定目标 KTX 版本

**位置：** Spec §5.2、§6；Plan T0，见 [Spec:145](/Users/forrest/GitHub/project-lucy/webui/docs/149-ops-evidence-connection-spec.md:145)、[Plan:62](/Users/forrest/GitHub/project-lucy/webui/docs/plans/wo-202609-25-ops-evidence-connection.md:62)。

**问题：** 文档要求物理名变化时，`enabled_tables`、Manifest `table:`、Role `schema` 一起使用探测结果。这三者不是同一字段：

- `physicalTable` 来自 Manifest 的 `table:`。
- Role 匹配的 schema 来自 `_schema/*.yaml` 文件名。
- selector 对 schema 单独比较。

见 [acl.ts:377](/Users/forrest/GitHub/project-lucy/webui/server/proxy/acl.ts:377)、[acl.ts:925](/Users/forrest/GitHub/project-lucy/webui/server/proxy/acl.ts:925)。因此目录返回裸表名，不意味着 Role schema 应变为 `ops_calls` 或空值。

另外，T0 写“以当前 CLI 为准”，而 Docker 当前固定 KTX `0.16.0`，见 [Dockerfile:22](/Users/forrest/GitHub/project-lucy/Dockerfile:22)；本机安装包是 `0.12.0`。

**影响：** 冻结出错误组合后，可能出现 selector 零命中、启用表范围不匹配，或开发机通过而镜像查询失败。

**最小修复建议：** 分别冻结 `schemaFile/schema`、`sourceName`、`physicalTable`、`enabled_tables` 的映射；T0 必须绑定交付使用的 KTX 版本，并验证该组合能编译角色及实际执行语义查询。

### R04｜高｜配置冲突分支只警告，没有定义停止提供运维证据的边界

**位置：** Spec §7、§8、SC-08；Plan T2，见 [Spec:333](/Users/forrest/GitHub/project-lucy/webui/docs/149-ops-evidence-connection-spec.md:333)。

**问题：** 已有 `lucy-ops` 指向其他文件、其他 driver，甚至 `readonly=false` 时，方案保留配置并继续复制资产，没有规定连接不可用、授权拒绝或确保失败。

现有能力编译主要检查 source map 与 `enabled_tables`，不会核验这个连接是否指向当前审计库，见 [acl.ts:1188](/Users/forrest/GitHub/project-lucy/webui/server/proxy/acl.ts:1188)。

**影响：** 若错误数据库也有同名视图，已授权 Agent 可以把另一份数据当作本实例调用证据；没有同名视图时则表现为查询故障。SC-08 只验“保留并警告”，不能保证证据来源正确。

**最小修复建议：** 保留“不覆盖”的原则，同时明确冲突时本连接不可提供查询，并返回可验收的未就绪状态。补 driver、路径、readonly 三种冲突的目录与查询断言。

### R05｜高｜去重 Token 标签不能称为业务活跃 Token

**位置：** Spec §5.4、§5.5；Plan Goal、T3、T6，见 [Spec:211](/Users/forrest/GitHub/project-lucy/webui/docs/149-ops-evidence-connection-spec.md:211)。

**问题：** Spec 把业务活跃 Token 定义为 `COUNT(DISTINCT token_label)`，并将与使用概况的差别解释为未与当前配置取交集。但标签只要求在同一 Agent 内唯一，见 [tokens.ts:345](/Users/forrest/GitHub/project-lucy/webui/server/admin/tokens.ts:345)。

例如两个 Agent 都使用标签 `desktop`，两枚活跃 Token 会被算成一个；同一 Agent 删除后重建同标签 Token，也无法区分历史凭据。术语标准还明确禁止把 `token_label` 当唯一身份，见 [术语标准:659](/Users/forrest/GitHub/project-lucy/webui/docs/00-product-terminology-standard.md:659)。

**影响：** Skill 即使严格执行文档，也会给出错误人口，并复用已有业务活跃 Token 术语表达另一种统计。

**最小修复建议：** 在保持不暴露 Token 哈希的前提下，将该统计明确命名为标签统计并登记术语，或取消 Token 数回答能力；若必须回答 Token 人口，先另行定义安全且稳定的身份投影。仅增加 `agent_id` 仍不能解决历史标签复用。

### R06｜高｜“工具只服务那一篇”的授权承诺没有现成实现语义

**位置：** Spec §6，见 [Spec:284](/Users/forrest/GitHub/project-lucy/webui/docs/149-ops-evidence-connection-spec.md:284)；Plan T4、T6。

**问题：** 现有 Skill/Wiki 通道工具不绑定具体对象。对象授权由 frontmatter 决定，目录名、连接权限、prerequisites 均不限制授权，见 [context-acl.ts:4](/Users/forrest/GitHub/project-lucy/webui/server/proxy/context-acl.ts:4)。

新 Role 获得四个通道工具后，也可以读取其他 `roles_allowed: ["*"]` 的已发布 Skill，以及 `allowed_roles: ["*"]` 的 Wiki，包括全局目录中的对象。现有裁决见 [context-acl.ts:119](/Users/forrest/GitHub/project-lucy/webui/server/proxy/context-acl.ts:119)。

**影响：** “只服务本篇、不访问其他 Skill/Wiki”的承诺无法由当前 YAML 实现，且与 Spec 151 的对象 ACL 模型存在冲突。

**最小修复建议：** 明确是否接受现有共享对象语义。若接受，将承诺收敛为“不修改其他对象 ACL”；若要求严格只读本篇，则必须补充授权设计、与 Spec 151 的裁决及测试，不能作为现有工具列表的自然效果。

### R07｜中｜无条件保留已有文件，与固定授权及发布状态保证冲突

**位置：** Spec Goal 7、§5.5、SC-09、SC-16；Plan T6、T8-8。

**问题：** 已有同路径 Skill 若为 `published` 且 `roles_allowed: ["*"]`，启动会原样保留；当前 `demo_readonly` 已具备 Skill 工具，因此能够读取。若已有文件是草稿，则运维 Role 又无法读取。loader 会直接采用已有状态和 ACL，见 [loader.ts:59](/Users/forrest/GitHub/project-lucy/webui/server/skills/loader.ts:59)。

**影响：** SC-09 的字节不变、固定授权仅 `lucy_ops_reader`、SC-16 的不可读取，不能对任意已有文件同时成立。

**最小修复建议：** 为跳过复制后的身份、状态、ACL 不匹配定义明确结果：保留文件并报告冲突，或明确这些保证仅适用于新安装模板。补共享 ACL、草稿、损坏 frontmatter 的已有文件场景。

### R08｜中｜语义模板契约和验收不足以排除“校验通过、查询失败”

**位置：** Spec §5.4；Plan T3、T8，见 [Plan:95](/Users/forrest/GitHub/project-lucy/webui/docs/plans/wo-202609-25-ops-evidence-connection.md:95)。

**问题：** 当前只有 source、指标、维度清单，没有规定 Manifest 与 overlay 的准确分工，尤其没有明确 `call_day` 必须作为带 `expr: date(ts)` 的派生列放入 overlay。上游明确禁止把派生列写入 Manifest，见 [Spec 23:213](/Users/forrest/GitHub/project-lucy/webui/docs/23-semantic-asset-publish-export-spec.md:213)。

视图实际没有 `call_day` 列。若模板将其声明为普通物理列，静态资产校验不能替代 SQLite 执行验证。T8 也没有明确要求经过真实模板和语义编译器验证日期过滤、聚合及过滤后 SQL 明细。

**影响：** 直接查询视图的夹具可以全部通过，仍留下不可用的语义模板。`date(ts)` 本身是正确方向，缺口在落盘结构和运行验收。

**最小修复建议：** 补最小规范 YAML 或明确引用结构约束；未来验收必须使用模板执行固定窗口的日期过滤、四个指标和明细查询。时间边界同时明确采用 UTC 日期还是业务本地日期。

### R09｜中｜自身追问的排除在两张视图中不是同一事件集合

**位置：** Spec §5.3、§8 SQL、SC-04，见 [Spec:406](/Users/forrest/GitHub/project-lucy/webui/docs/149-ops-evidence-connection-spec.md:406)、[Spec:438](/Users/forrest/GitHub/project-lucy/webui/docs/149-ops-evidence-connection-spec.md:438)。

**问题：** `ops_calls` 按事件执行 `NOT EXISTS`；任一 source 命中自身即删除整次调用。`ops_call_tables` 只删除命中的 source 行。同一事件若同时具有自身和其他表来源，会只出现在按表视图。

另外，物理名排除不区分连接：其他 SQLite 连接中真实存在的 `main.ops_calls` 业务表，也会被当作自身追问删除。

**影响：** 两张视图可以给出互相矛盾的调用人口，并误删其他连接的业务事实。当前 SC-04 的单一来源夹具发现不了这些分支。

**最小修复建议：** 明确按事件排除还是按来源行排除，并让两张视图一致；物理名回退匹配应限定适用连接或缺失归属情形。增加混合来源事件和其他连接同名表夹具。

---

以下重点已经核实，不作为问题重复提出：

- **默认用量引用成立。** `defaultUsageConditionSql()` 返回对象，实施时应取 `.sql`；其规则与 Spec 189 一致。`eval_mark` 使用 `COALESCE(..., 0)`，无标记的普通 `demo-mysql` 调用不会因名称标记被排除，见 [usage-classification.ts:229](/Users/forrest/GitHub/project-lucy/webui/server/proxy/usage-classification.ts:229)。WHERE 使用未投影列合法。
- **星号排除有实现落点。** 应改角色编译及能力生成，目录和查询会消费同一编译结果。关键位置是 [resolveCatalogConnections](/Users/forrest/GitHub/project-lucy/webui/server/proxy/acl.ts:1166)、能力派生连接集和查询连接检查。扩权审计还在 [acl.ts:2525](/Users/forrest/GitHub/project-lucy/webui/server/proxy/acl.ts:2525) 重算范围，应保持一致。Spec 已明确覆盖 Spec 131 的冲突，因此不是“完全没有落点”。
- **不调用 `createConnection` 的理由正确。** 该路径确实追加 `database_connection_ids`，见 [project.ts:1622](/Users/forrest/GitHub/project-lucy/webui/server/project.ts:1622)。
- **启动不写 ACL，与 demo 模板预置 Agent 不矛盾。** 二者发生于不同阶段。旧卷没有 `demo_ops` 可以作为明确的升级范围限制；但读模板只证明制品内容，不能证明两拍演示可运行。
- **Skill 格式和基础 ACL 可复用。** 普通 `.md` 文件会被递归扫描；`domain: lucy-ops`、`name: ops-questioning`、`status: published` 合法。正确加载新模板后，现有 ACL 足以拒绝 `demo_readonly`，无需新增 ACL 系统。
- **所列敏感字段没有直接投影。** 两条 SQL 的 SELECT 列表符合列允许集，没有 Token 哈希、问询字段或 `ui_page_views` 等表列。WHERE 读取 `args_summary`、`eval_mark` 不等于返回它们。此结论针对字段投影，不代表对 `error_detail` 等自由文本作了内容脱敏证明。
- **连接删除保护已写到四类资产。** 伪代码、SC-07、T5 和 T8-6 均明确保留审计库、语义、Skill、Wiki；需要在实际删除逻辑前拒绝。该承诺限于删除连接操作，不包含各资产自身的独立删除 API。
- **四个新增主术语已登记。** Spec 与术语标准的运维问数连接、运维问数角色、运维问数 Skill、演示运维问数 Agent 一致。术语方面的实质问题是 R05 的人口定义。

Goals 与任务、验收编号基本能映射，但不是逐项完整闭合：

| Goals | 主要任务 | 验收 |
|---|---|---|
| G1、G5：连接确保及启动不改身份 | T1、T2 | SC-05、08、11 |
| G2、G3：列与行契约 | T1、T3 | SC-02、03、04、06、12、13 |
| G4：显式授权 | T4 | SC-01、10 |
| G6：删除保护 | T5 | SC-07 |
| G7：资产复制及授权 | T3、T6 | SC-09、14、16 |
| G8：问句契约 | T6 | SC-14、17 |
| G9：demo Agent | T7 | SC-15 |

SC-17 刻意采用正文断言、避免日期漂移的自然语言 gold，这本身合理。仍缺的是上述启动生效、内容根、冲突处理及语义执行分支；此外，高权限警示虽有任务，没有对应验收断言，SC-11/T8-9 也应检查整个 `access.yaml` 字节不变，而不只是没有新增 user/token。