# Agent 管理台高权限警示与个人行限制呈现 Plan

| 元数据 | 内容 |
|---|---|
| 文档版本 / 日期 | **v0.2** / 2026-11-01 |
| 目标版本 / 优先级 | 不绑定产品版本号 / **P2**。功能编号无，不进入 v0.25 登记册 |
| 主 Spec | [`docs/specs/lucy-20261101-agent-admin-high-priv-copy-ux-spec.md`](../specs/lucy-20261101-agent-admin-high-priv-copy-ux-spec.md)（**v0.2 功能合同已收口**） |
| 权威语义 | Spec 100（个人行限制／FinalRows）、Spec 131（lucy_admin／catalog_bound 安全意图）。本 Plan **不改**其编译与授权代数 |
| 状态 | **v0.2 功能合同已收口（2026-11-01）**。D1–D8 已在主 Spec §4 冻结。S1–S3 已落地；SC-01–SC-12 全部关闭（组件测试 69/69；`npm run lint:terminology` exit 0）。实施记录见 [`docs/reviews/2026-11-01-agent-admin-high-priv-copy-ux-implementation-notes.md`](../reviews/2026-11-01-agent-admin-high-priv-copy-ux-implementation-notes.md)。本条收口不表示可上线 |
| 授权边界 | 已授权改 `webui/src` 文案与空态分层、共享常量、相关组件测试、selector-contract 文案行。**不涉及**构建镜像、部署、`git commit`／`git push`（除非用户另授权）、浏览器走查、NewToken 政策句回潮、KTX／ACL runtime。Spec 131 呈现注记已在定稿完成，实施阶段无需再改 |
| 验收 | 以主 Spec §7 SC-01–SC-11 为准；证据为组件测试。SC-12 术语 lint 已拆出 |
| 实施主体 | Lucy WebUI `webui/src` |
| 待拍板 | **已关闭**（2026-11-01）：讨论认可后 D1–D8 按 Spec §4 提议列冻结 |
| 审阅者定稿提示词 | [`docs/prompts/lucy-20261101-agent-admin-high-priv-copy-ux-reviewer-prompt.md`](../prompts/lucy-20261101-agent-admin-high-priv-copy-ux-reviewer-prompt.md)（委托方下发的提示词、**不是 Plan**；2026-11-05 从 `docs/plans/` 归位到 `docs/prompts/`，避免被 Plan 形态门禁误判；Kimi／审阅者；讨论冻结 ≠ 审阅定稿） |

---

## 1. 目标

把 Agent 基本信息上的两处呈现收成可读合同：

1. **高权限警示**：短主句＋次句；去掉 catalog 机制黑话与 Token 过期夹带；Detail／List 共用常量。
2. **个人行限制**：能力保留；空态弱展示；按是否含目录绑定角色切换一句情境说明；「编译≠取数」离开常驻段落。

实施原则：

- 保留 `agent-lucy-admin-role-warning`、`agent-constraints-editor` 等既有 test id。
- 不改 constraints 序列化／保存确认／runtimeAck 合同。
- 不恢复 NewToken 已删政策句（对齐 [`lucy-20261101-new-token-expiry-preset-ux-spec.md`](../specs/lucy-20261101-new-token-expiry-preset-ux-spec.md)）。

## 2. 开工前置

| ID | 条件 | 状态 |
|---|---|---|
| P1 | 主 Spec v0.2 审阅定稿已落盘且 D1–D8 冻结；Spec 131 呈现注记已写 | **满足**（2026-11-01） |
| P2 | 开发授权（用户明确要求改 `webui/src`） | **未满足** — 本轮仅落盘文档 |
| P3 | 相关基线测试可跑：`agent-detail.test.tsx`、`agent-list.test.tsx` | 开工时确认 |

S0 不重开 D1–D8。若实施中发现角色列表缺少 `source_scope` 字段导致 SC-08 无法对任意 catalog_bound 角色分支，允许退化为：目录情境句至少覆盖 `lucy_admin`／`isLucyAdminDataPlaneRole`，并在 Spec 修订记录中登记；不得静默改语义。

## 3. 文件落点

### 3.1 预计修改

| 路径 | 改动 | 阶段 |
|---|---|---|
| `webui/src/lib/lucyAdminRole.ts`（或紧邻新文件） | 导出警示主句／次句常量；可选导出约束帮助文案常量 | S1 |
| `webui/src/pages/admin/AgentDetail.tsx` | 警示结构；constraints 空态／情境句／ⓘ | S1–S2 |
| `webui/src/pages/admin/AgentList.tsx` | 同警示常量与结构 | S1 |
| `webui/src/__tests__/agent-detail.test.tsx` | SC-01–SC-11 相关断言 | S1–S2 |
| `webui/src/__tests__/agent-list.test.tsx` | 警示新文案；与常量一致 | S1 |
| `webui/docs/131-lucy-admin-catalog-bound-role-spec.md` | §5「高权限警示」加「Agent 绑定警示可见文案以主 Spec 为准」注记 | **定稿已完成**（2026-11-01） |
| `docs/qa/selector-contract.md` | 仅当新增 tooltip／确认 test id 时补行 | S2 |

### 3.2 不改

- `webui/server/proxy/agent-constraints.ts` 与 ACL 编译路径。
- `NewToken.tsx`／Token 过期政策句（禁止回潮）。
- Role 详情 `RoleRowPolicyPanel` catalog_bound 禁用提示（已有短文案）。
- KTX、Helm、镜像、术语标准正文（`New terms: None`）。

## 4. 分阶段实施

### S1 高权限警示（D2、D3、D8 的警示部分）

1. 抽出 `LUCY_ADMIN_WARNING_PRIMARY`／`LUCY_ADMIN_WARNING_SECONDARY`（文案以 Spec Terminology 表为准）。
2. AgentDetail／AgentList 渲染主句＋次句；删除旧四层长句与 Token 过期夹带。
3. 更新 `agent-list`／`agent-detail` 中「高权限运维数据面」类断言。

**出口**：SC-01–SC-04。

### S2 个人行限制分层（D4–D7）

1. 空态：标题＋「未设置」＋「添加行限制」；去掉长说明与「未添加个人行限制。」。
2. 同步改 `agent-detail.test.tsx` 中锁死旧空态文案的断言（如「未添加个人行限制」「不表示行级取数已生效」常驻段落），使其对齐 SC-05／SC-10。
3. 非空／添加后：一句 `constraintHelperText`（目录 vs 默认）。
4. 「编译≠取数」迁入 ⓘ tooltip 或确认区；空态／警示条不得常驻。
5. 主标题与 `constraints` 次级分离；断言 SC-06。
6. 覆盖 SC-07／SC-08 的 fixture（业务角色 vs `lucy_admin`）。

**出口**：SC-05–SC-11。

### S3 登记与门禁

1. ~~Spec 131 §5 高权限警示呈现注记指向主 Spec。~~ **定稿已完成**（2026-11-01），实施阶段跳过。
2. `npm run lint:terminology`（SC-12）——已通过：1094 files scanned，exit 0。
3. 主 Spec／本 Plan 状态已改为「功能合同已收口」；证据落点：组件测试 69/69 通过 + `npm run lint:terminology` exit 0 + `docs/reviews/2026-11-01-agent-admin-high-priv-copy-ux-implementation-notes.md`。

**出口**：SC-12；文档状态更新。

## 5. 验收

验收正文是主 Spec §7 的 SC-01–SC-12。本 Plan 不另起编号。

证据要求：

| 证据项 | 落点 |
|---|---|
| SC-01–SC-11 | `webui/src/__tests__/agent-detail.test.tsx` 与／或 `agent-list.test.tsx` |
| SC-04 常量同源 | 对导出常量的单测，或两页渲染文本相等断言 |
| SC-12 | 仓库根 `npm run lint:terminology` 退出码 0 |

浏览器走查、docker 重建不在本条出口；若发版需要，归 [`lucy-20261030-webui-release-ux-review-spec.md`](../specs/lucy-20261030-webui-release-ux-review-spec.md) 必走表面。

## 6. 完成定义

同时满足：

1. D1–D8 未在实施中被静默改写；若必须修订，先改 Spec 再改码。
2. SC-01–SC-12 有自动化或门禁证据并记录在 Spec／Plan 状态段。
3. Spec 131 §5「高权限警示」已有指向主 Spec 的呈现注记（**定稿已满足**）。
4. 未改 ACL／constraints runtime；未回潮 NewToken 政策句。
5. 本条收口不表示可上线。

## 7. 风险

| 风险 | 处置 |
|---|---|
| 角色列表无 `source_scope`，目录情境句覆盖不全 | 见 §2 退化条款；至少覆盖 lucy_admin |
| 旧测试锁死「高权限运维数据面」整句 | S1 同步改断言，禁止为保绿保留旧文案 |
| 空态过弱导致找不到入口 | 保留按钮与 test id；走查若投诉再升 P 开 follow-up，不在本条加 KPI 卡 |

## 8. 落盘清单自检（文档形态）

| # | 要求 | 本条 |
|---|---|---|
| 1 | Spec／Plan 同编号 `lucy-20261101-agent-admin-high-priv-copy-ux` | 是 |
| 2 | Spec 含伪代码或豁免 | 含 §6 伪代码 |
| 3 | Spec／Plan 元数据含状态等 | 是 |
| 4 | Plan 含目标／前置／验收／完成定义／风险 | 是 |
| 5 | Terminology Compliance 含规定句与 New terms | 是 |
| 6 | Design System Compliance 四段式 | 是 |
| 7 | 索引登记 | 本轮写入 `docs/README.md` 与 `docs/plans/README.md` |
| 8 | 无新 CI 命令 | 不适用 |
| 9 | 功能编号元数据为无 | 是 |
| 10 | 落盘后跑 `lint:spec-docs` | 落盘后执行 |
| 11 | 闭口层级 | 是 |
