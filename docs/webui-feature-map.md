# Lucy WebUI 功能地图

| 元数据 | 内容 |
|---|---|
| 文档名称 | Lucy WebUI 功能地图 |
| 文档类型 | Design |
| 版本 | v1.0 |
| 撰写日期 | 2026-06-19 |
| 撰写人 | Claude Thinker |
| 委托人 | zhangxingchen |
| 基于材料 | project-lucy/docs/user-guide, project-lucy/webui (01–07 docs, src/pages, config/access.yaml, scripts/eval-runner.mjs) |
| 适用范围 | 交付 Builder / Reviewer / Minimax M3 开发 |
| 输出位置 | project-lucy/docs/webui-feature-map.md |

---

> **历史状态说明（2026-06-29）**：本文是 2026-06-19 的缺口分析快照，保留用于追溯当时 Admin、Eval、Audit 等模块的开发动机；它不再作为当前 WebUI 实现状态源。当前模块状态以 `docs/webui-impl-status.md` 和 `docs/project-overview.md` 为准，产品化验收以 `docs/lucy-platform-goal-checklist.md` 为准。

## 0. 阅读说明

- 视角 = 用户视角，按 **数据工程师 / 管理员 / Agent 消费者（只读 ref）** 分组。WebUI 当前主要服务前两类。
- 状态标记：
  - 完全实现 = WebUI 已经能让用户在浏览器里完成全流程操作。
  - 部分实现 = 后端能力或文件落盘已存在，但 WebUI 入口缺失或只覆盖一部分能力。
  - 缺失 = 用户文档（user-guide）承诺过的能力，但代码层既无 UI 也无后端落地。
- 数据来源：本文保留当时快照；其中“当前 WebUI 路由仅...”等描述已过期。当前 WebUI 已包含 Onboarding、Connections、Eval、Admin/Audit 等模块，见 `docs/webui-impl-status.md`。
- 推断：本文档中的「价值」一句话基于 `user-guide/product-intro.html` 和 `concepts.html` 的措辞总结；如与产品文案有偏差，以 user-guide 为准。

---

## 1. 数据工程师视角

数据工程师 = 维护 KTX 语义层（表、字段、measures、segments、joins）、Wiki 知识库、eval/quiz case 的角色。
WebUI 是他们日常工作的本机工作台（`localhost:5173 / 5174`）。

### 1.1 语义层维护

| 功能 | 状态 | 用户价值（一句话） | 落点（代码/文档） |
|---|---|---|---|
| 浏览所有语义层表（按 schema、状态、关键字筛选） | 完全实现 | 在 300 张表里 30 秒定位到要补的表，不用打开终端 grep YAML | `src/pages/Catalog.tsx`, `GET /api/sources` |
| 看到每张表的完成度状态（未开始/部分/完成/校验失败） | 完全实现 | 知道工作队列里下一张该处理谁，避免重复打开已完工的表 | `server/completion.ts`, `StatusBadge` |
| 编辑表描述、字段描述（人工描述与 AI 描述分桶） | 完全实现 | 补充业务口径时不会被 AI 生成的旧描述污染，保留可追溯审计 | `TableEditor.tsx`, ADR-03 |
| 编辑行粒度 grain | 完全实现 | 让 Agent 知道一行代表什么业务单位，避免误用 `COUNT(*)` | overlay `semantic-layer/<conn>/<table>.yaml` |
| 编辑 measures（业务指标定义） | 完全实现 | 把"利润率""加权折扣"等公司口径固化下来，杜绝同名多口径 | `MeasureForm.tsx`, ADR-10 overlay |
| 编辑 segments（常用过滤分群） | 完全实现 | 把"仅正向金额""排除已删除"等业务规则一次写好，所有问题复用 | `SegmentForm.tsx`, ADR-10 overlay |
| 维护 joins：候选 / 拒绝 / 已确认三态 | 完全实现 | 让 Agent 走可信的关联路径，避免随机选 join key | `JoinEditor.tsx`, `.ktx-ui/join-candidates.json` |
| 字段 `role` / `visibility` / `tags` 编辑 | 缺失 | （承诺：标注时间维度、隐藏字段、打业务标签）user-guide 间接提及但 ktx schema 当前不支持 | ADR-10 明确「不落盘」 |
| 字段 `tags`（业务标签） | 缺失 | 给字段打"金融敏感""客户隐私"等业务标签 | 仅在 user-guide 的 "language" 段隐含 |
| 保存前看 unified diff | 完全实现 | 防止误改 YAML，每次落盘前确认到行级 | `DiffViewer.tsx`, `previewDiff` |
| 保存后自动 `ktx sl validate` | 完全实现 | 改完就知道改对没，不用切到终端 | `server/ktx.ts validateSource` |
| 批量校验本次会话改过的 source | 完全实现 | 收尾时一键回归，确认没人把其他表带坏 | Review 页 `POST /api/validate-changed` |

### 1.2 业务 Wiki / 知识库

| 功能 | 状态 | 用户价值 | 落点 |
|---|---|---|---|
| 列出所有 `wiki/**/*.md` | 完全实现 | 看到全公司的口径文档清单，避免重复造 | `GET /api/wiki` |
| 创建/编辑 Wiki Markdown（含 frontmatter `summary/tags/sl_refs/refs/usage_mode`） | 完全实现 | 让"利润率怎么算"这类长文档跟语义层联动 | `WikiEditor.tsx` |
| 从表编辑器一键创建关联 Wiki（`?sl_ref=<table>`） | 完全实现 | 维护表的时候顺手把业务背景写下来 | `WikiEditor` 的 `sl_ref` query 参数 |
| Wiki 编辑保存前 diff | 完全实现 | 同语义层，避免误覆盖既有口径 | `previewDiff` 复用 |
| 全文/Tag/sl_ref 搜索 | 缺失 | 几十篇 Wiki 时按业务 tag 找比按文件名找快 | 仅有简单列表，无搜索框 |

### 1.3 Skill 管理

| 功能 | 状态 | 用户价值 | 落点 |
|---|---|---|---|
| 创建/编辑/版本化 Skill | 缺失 | product-intro 把 Skill 列为"增值服务·M6"；当前 WebUI 既无路由也无 API | product-intro.html §features.Skill 管理 |

> 推断：Skill 作为「资深分析师判断路径的肌肉记忆」，在 user-guide 中被描述为 M6 增值服务，但 webui task-list（05）和 progress 没有任何 Skill 模块的工单。当前如果要维护 Skill，只能直接编辑 `skills/` 目录的文件（KTX 上游能力）。

### 1.4 Eval / Quiz 管理（当前几乎全靠手写 YAML/HTML）

| 功能 | 状态 | 用户价值 | 落点 |
|---|---|---|---|
| 浏览/搜索 eval case 列表 | 缺失 | 100+ case 时不用 grep 文件 | `eval-runner.mjs --list-cases` 是 CLI，无 WebUI |
| WebUI 增/删/改 eval case | 缺失 | 不用记 YAML schema 就能新增覆盖矩阵里的 case | YAML 在 `evals/<domain>/eval/*-eval-cases.yaml` |
| 触发 eval run（选 case + 选 Agent） | 缺失 | 改完语义层一键跑回归 | 只有 `node scripts/eval-runner.mjs` CLI |
| 单次 run 的通过率 / 失败明细 | 缺失 | 出问题的 case 立刻知道为什么挂 | runner 产物 `.ktx-ui/eval/latest.{md,json}` 没被前端消费 |
| 对比 golden answer 与实际答案 | 部分实现 | runner 已经做了断言比对，但只能在终端看 | runner CLI 输出 |
| 持续质量趋势图（按时间） | 缺失 | 看到准确率下降的拐点，触发回归排查 | product-intro 承诺 "Ops Dashboard"，未实现 |
| 漂移告警阈值配置 | 缺失 | 准确率跌破 90% 自动通知 | user-guide 的 Eval 闭环图未落代码 |
| Quiz 管理（人类测验） | 缺失 | 用 WebUI 编辑题目而不是改 HTML | 当前 quiz 在 `evals/<domain>/*-quiz-cases.html` |

### 1.5 数据源 / 连接配置

| 功能 | 状态 | 用户价值 | 落点 |
|---|---|---|---|
| 查看已配置连接（不含密码） | 完全实现 | 知道当前 WebUI 在编辑哪个 ktx 项目 | `GET /api/project` |
| 在 WebUI 添加/修改数据源 | 缺失 | 配置新连接还得手写 `ktx.yaml` | 安全考虑：密码在 `.ktx/secrets/`，WebUI 不读不写 |

---

## 2. 管理员视角

管理员 = 控制 Agent 实例能用哪些工具、查哪些表、保留多久日志的人。
当前在 WebUI 里**没有管理员页面**，全部能力靠手编辑 `webui/config/access.yaml` 和 spec 07 的 MCP Proxy。

### 2.1 Agent 实例与 Token 管理

| 功能 | 状态 | 用户价值 | 落点 |
|---|---|---|---|
| 列出所有 Agent 实例（每个用户 = 一个 Agent） | 部分实现 | 当前只能 cat `access.yaml` 看 | `webui/config/access.yaml` |
| 创建 Agent 实例 | 缺失 | 给新加入的同事一键签发一个 Agent | 需要手写 yaml + 重启 |
| 生成 PAT / Bearer Token | 缺失 | user-guide 提到 "PAT or Token" 配置 | spec 07 用 sha256 hash，token 明文需手工生成 |
| Token 撤销 | 部分实现 | spec 07 设计了 `revoked_tokens` 表，但没 UI | DB schema 存在；缺接口和页面 |
| Token rotation / 过期 | 缺失 | 90 天强制换 key 这种安全合规 | access.yaml 仅 `created` 字段，无 `expires_at` |

### 2.2 工具 / 资源权限管控

| 功能 | 状态 | 用户价值 | 落点 |
|---|---|---|---|
| 表级 ACL（每个 Agent 能查哪些表） | 部分实现 | yaml 落盘并被代理消费，但无可视化编辑 | `acl.ts` + `access.yaml.users[].allow.tables` |
| 工具级 ACL（每个 Agent 能调哪些 MCP 工具） | 部分实现 | 同上，wildcards 支持 | `access.yaml.users[].allow.tools` |
| 全局 deny 工具（`sql_execution` 等） | 部分实现 | 配在 yaml `defaults.deny_tools`，无 UI | `access.yaml.defaults.deny_tools` |
| 列级 / 行级权限 | 缺失（明确不做） | product-intro §scope 已声明 v1.0 不实现 | 出于聚焦范围排除 |

### 2.3 访问日志与审计

| 功能 | 状态 | 用户价值 | 落点 |
|---|---|---|---|
| MCP 调用全量记录到 SQLite | 完全实现 | 谁查了什么表、SQL、用时全部可查 | `audit.ts`, `.ktx-ui/audit.sqlite.access_log` |
| WebUI 查看访问日志（分页、按用户/工具过滤） | 缺失 | spec 07 §Phase 3 列为可选，未做 | 需要 `GET /api/audit` |
| 拒绝调用的告警（denied 行多了通知） | 缺失 | 看到张三反复访问没授权的表 → 安全事件 | 无告警机制 |
| 历史归档到对象存储（180 天+） | 缺失 | product-intro 承诺"180 天热查 + 永久归档" | 当前只有本机 SQLite |
| 用量统计（TPM / 表热度 / 慢查询） | 缺失 | 容量规划 / 性能优化 | 数据有，未聚合展示 |

### 2.4 KTX MCP Proxy 配置

| 功能 | 状态 | 用户价值 | 落点 |
|---|---|---|---|
| Proxy 启停状态查看 | 缺失 | 不知道代理是不是在跑 | spec 07 §10 Phase 1 端口 7879 |
| `KTX_INTERNAL_TOKEN` 自动生成 / 轮换 | 缺失 | 当前要手工设置环境变量 | spec 07 §9 |
| `access.yaml` 热加载状态 | 部分实现 | 已设计 30s TTL，但无状态反馈 | `access.yaml` 注释提及 |

---

## 3. Agent 消费者视角（只读，参考）

> 不是 WebUI 主战场。Agent 通过 MCP 与 KTX 对话，不直接使用 WebUI。但 user-guide 的 product-intro 承诺了 "Provenance Footer"、"安全红线" 等 runtime 行为，列在此供 Reviewer 对照。

| 承诺 | 状态 | 备注 |
|---|---|---|
| 每个回答附 Source tier / Tables / Measures / Freshness | 落在 Agent prompt 层（CLAUDE.md），WebUI 不参与 | 不是 WebUI 责任 |
| 写操作 / 跨源 Join 强阻断 | 由 eval runner `safety_contract` + ktx 只读账号实现 | 见 `safety_contract` 段 |
| 准确率 21% → 95%+ | 由语义层 + Skill + Eval 三者综合 | WebUI 是其中的「语义层维护」入口 |

---

## 4. 总结：WebUI 缺口排序

按用户痛点和实现复杂度，缺口排序：

1. **管理员视角全空白**：Agent 实例、Token、ACL 三件套完全没有 UI，目前管理员要会改 yaml + 算 sha256 + 重启。优先级 P0。
2. **Eval 配置与监控全空白**：runner 已经能跑，但 case 编辑、触发、结果展示、趋势监控四步都只能 CLI。优先级 P0。
3. **访问日志可视化**：数据已经在 SQLite 里，缺一个 `GET /api/audit` + 一个 Audit 页面。优先级 P1。
4. **Skill 管理**：user-guide 列为 M6 增值服务，当前完全缺位。优先级 P2（依赖 KTX 上游 Skill schema 稳定）。
5. **数据源配置**：因为密码安全考虑（fs-safe 禁读 `.ktx/secrets/`），可能永远只保留只读视图。优先级 P3。

本文档与后续两份详细设计（`design-agent-permissions.md` / `design-eval-monitoring.md`）对应缺口 1、2。
