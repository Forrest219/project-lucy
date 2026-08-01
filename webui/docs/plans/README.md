# Codex 执行总纲 — KTX WebUI

本目录是交给 **codex** 执行开发的工单包。codex 按 **M0 → M5 串行**领取工单，每个里程碑产出一个可验收增量。
本文件是**全局约定 + 护栏 + 完成定义**，每个工单前都默认适用。

## 0. 作业环境（必读）

| 项 | 值 |
| --- | --- |
| 工作目录 | `/Users/forrest/Projects/project-lucy/webui`（**所有路径相对此**） |
| ktx 项目根 | `/Users/forrest/Projects/project-lucy`（webui 操作的目标项目） |
| Node | v24（实测 24.14） |
| 运行 | `npm run dev`（前 5173 / 后 5174） · 测试 `npm test`（vitest） |

> ⚠️ 用户的 `codex` 是 shell 函数会 `cd ~/Workspace`。codex 启动后**第一步必须确认 cwd 切到 `/Users/forrest/Projects/project-lucy/webui`** 再作业。

### 0.1 开工前置检查（每张工单通用，开工前跑一遍）

```bash
pwd                       # 必须 = /Users/forrest/Projects/project-lucy/webui
node -v                   # ≥ v20（本机 v24.14）
command -v ktx            # ktx 在 PATH（本机 /Users/forrest/.local/node-current/bin/ktx）
git -C /Users/forrest/Projects/project-lucy status --short   # 记录开工前的脏文件基线
```
- **联网**：仅 M0 的 `npm install` 需要联网一次；其余里程碑默认离线可跑。
- ktx 的调用参数与 schema 支持**已探测并记录**在 `../01-architecture.md §9`，开工只需按需做**一次 sanity 复验**，不要从零重新探测。
- 各工单末尾若有「本单特异前置」只列该单独有项（如某里程碑依赖前一里程碑产物）。

## 1. 必读设计文档（事实源，不要另起炉灶）

| 文档 | 内容 |
| --- | --- |
| `../README.md` | 产品 MVP 方案（= PRD，验收口径） |
| `../01-architecture.md` | 架构、组件边界、**10 条 ADR**、安全模型 |
| `../02-arch-spec.md` | 模块契约、目录骨架、脚手架计划、测试策略 |
| `../03-api-spec.md` | REST API 契约 + 统一错误 envelope |
| `../04-data-model.md` | 内部模型 ↔ 真实 YAML 映射、完成度算法 |
| `../05-task-list.md` | 里程碑任务与验收（本工单包据此细化） |

冲突时优先级：**ADR > arch-spec > api/data-model > task-list > README**。发现设计本身有问题，**停下来报告**，不要自行改设计。

## 2. 全局护栏（每个工单都适用，违反即不合格）

1. **写入只经 `fs-safe.ts`**。允许写 `semantic-layer/ wiki/ .ktx-ui/`；禁止 `.ktx/secrets/ raw-sources/ .git/`。任何模块禁止直接 `fs.writeFile`。
2. **YAML 就地补丁**（ADR-01）：`parseDocument → 改 CST 节点 → toString()`。**严禁** parse→JS对象→dump（会毁掉 `"on"` 引号、注释、key 顺序、未知键）。
3. **表地址 = `conn + schema + table`**（ADR-02），不是 `conn/source`。
4. **人工描述写 `descriptions.human`**，保留既有 `descriptions.ai`（ADR-03）。
5. **错误 envelope 必检**（ADR-09）：API 失败返回 `{ok:false,error}`；前端 `apiClient` 必须先判 `ok===false` 再用 `data`，**绝不**回退渲染空/假数据。
6. **仅绑 `127.0.0.1`**，无鉴权。`/api/project` 必须剥离 password 值。
7. **增量字段**按 ADR-10 分层：`grain/measures/segments` 写 `semantic-layer/<conn>/<table>.yaml` overlay；`role/visibility/tags` 暂不写正式 YAML。保存后用 `ktx sl validate <table> --connection-id <conn>` 校验。
8. **不碰 secrets**：不返回 `.ktx/secrets/**` 内容，不解析 `password: file:` 指向的文件。

## 3. 每个里程碑的「完成定义」(DoD)

一个里程碑算完成，须**全部**满足：
- [ ] 工单列出的交付文件均已创建/修改
- [ ] 相关单元测试存在且 `npm test` 全绿
- [ ] 涉及护栏的安全/round-trip 用例有覆盖
- [ ] 用**真实数据**（`dataforai` / `dataforai`）跑过冒烟，并在收尾说明里贴结果
- [ ] 不引入对后续里程碑的破坏；改动可被 `git diff` 清晰看到
- [ ] 收尾给出：改了哪些文件、怎么验证的、已知遗留

## 4. 串行交付节奏

M0 → M1 → M2 → M3 →（M4、M5 可并行）→ M6。M6 依赖 M3 已完成的 fs-safe `ALLOW_FILES` 通道与 ktx CLI 封装。**每个里程碑结束后停下来交回**给用户/协调者确认，再领下一张工单。不要一口气从 M0 冲到 M6。

## 5. 工单清单

| 工单 | 里程碑 | 主题 |
| --- | --- | --- |
| [wo-M0-scaffold.md](wo-M0-scaffold.md) | M0 | 脚手架 + fs-safe 安全基座 |
| [wo-M1-readonly-catalog.md](wo-M1-readonly-catalog.md) | M1 | 项目读取 + 只读目录/单表 |
| [wo-M2-table-editor-diff.md](wo-M2-table-editor-diff.md) | M2 | 就地补丁 + 单表编辑 + diff 预览 |
| [wo-M3-save-validate.md](wo-M3-save-validate.md) | M3 | 落盘写回 + ktx validate + Review 页 |
| [wo-M4-measures-segments-joins.md](wo-M4-measures-segments-joins.md) | M4 | measures/segments/joins + sidecar |
| [wo-M5-wiki.md](wo-M5-wiki.md) | M5 | Wiki 编辑器 |
| [wo-M6-schema-onboarding.md](wo-M6-schema-onboarding.md) | M6 | Schema Onboarding（给已有连接加 schema） |
| [wo-M7-deployment-connection-ux-refresh.md](wo-M7-deployment-connection-ux-refresh.md) | M7 | 部署向导与连接概览体验升级 |
| [wo-M11-agent-admin-enterprise-delivery.md](wo-M11-agent-admin-enterprise-delivery.md) | M11 | Agent Admin 企业级交付体验升级 |
| [wo-M12-role-admin.md](wo-M12-role-admin.md) | M12 | Role Admin 角色配置管理 |
| [wo-M13-ingest-first-class-ux.md](wo-M13-ingest-first-class-ux.md) | M13 | Ingest 一等功能化：连接/Schema/白名单入口与诊断闭环 |
| [wo-M16-system-overview-runtime-monitoring.md](wo-M16-system-overview-runtime-monitoring.md) | M16 | 系统概览运行状态监控：`/onboarding` 去向导化 |
| [wo-M19-semantic-asset-publish-export.md](wo-M19-semantic-asset-publish-export.md) | M19 | 语义资产自助发布与安全导出：上传 manifest/overlay、Validate Gate、reindex、secrets hard block |
| [wo-M20-yaml-delivery-runbook.md](wo-M20-yaml-delivery-runbook.md) | M20 | YAML 交付规范进入 Help Center：用途、规则、常见错误、交付 checklist 与 Agent 自检协议 |
| [wo-M21-connection-module-terminology-ia-refresh.md](wo-M21-connection-module-terminology-ia-refresh.md) | M21 | 数据库接入模块术语与 IA 刷新：Connection 中心化、Schema / Manifest / Catalog 术语治理 |
| [wo-M22-database-connection-operations-runbook.md](wo-M22-database-connection-operations-runbook.md) | M22 | 数据库连接运维 Runbook：通用新增连接边界、配置、ACL 与验收 |
| [wo-M24-catalog-reload-result-ops-ux.md](wo-M24-catalog-reload-result-ops-ux.md) | M24 | 本地目录刷新结果运维体验：卡片内状态栏、Schema 资产列表优先、inline 缺失 Manifest 诊断 |
| [wo-M25-connection-semantic-boundary-automation.md](wo-M25-connection-semantic-boundary-automation.md) | M25 | 数据库接入与语义层维护边界自动化：asset kind、上传校验、IA lint 与 Review checklist |
| [wo-M26-help-markdown-rendering.md](wo-M26-help-markdown-rendering.md) | M26 | Help Center Markdown 渲染修复：系统手册表格、安全渲染、深链与回归测试 |
| [wo-M31-table-whitelist-catalog-reload-layout-stability.md](wo-M31-table-whitelist-catalog-reload-layout-stability.md) | M31 | 表白名单刷新反馈与布局稳定性：Toast 成功反馈、Schema 内缺失 Manifest 诊断、工具栏和行内操作降噪 |
| [wo-M37-lucy-webui-positioning-control-plane.md](wo-M37-lucy-webui-positioning-control-plane.md) | M37 | Lucy WebUI 品牌定位升级到 Data Agent Ops Control Plane：品牌区副标题、术语标准 v0.2、过期设计 spec 备注与测试断言 |
| [wo-M39-system-overview-enterprise-ops-polish.md](wo-M39-system-overview-enterprise-ops-polish.md) | M39 | 系统概览企业级运维控制台 polish：`/overview` 主入口、顶栏上下文、待处理事项治理、Metric-first 快照与 MCP 配置 Drawer |
| [wo-M44-connection-overview-visual-simplification.md](wo-M44-connection-overview-visual-simplification.md) | M44 | 连接概览视觉收敛修复：移除工作目录、去双层方框、刷新状态右移、Schema 表新增启用表数与术语降噪 |

## 6. 如何把工单喂给 codex

每张工单顶部都有「codex 直投 prompt」块，可整段贴给 codex。建议一次只投一个里程碑的工单，跑完验收再投下一个。

## 7. 独立工单（非 M0-M5 主线）

以下工单改动范围在 `webui/server/proxy/` 等独立模块，与 M0-M5 语义层编辑器主线互不冲突，可并行领取：

| 工单 | 主题 |
| --- | --- |
| [wo-proxy-instructions-injection.md](wo-proxy-instructions-injection.md) | Lucy MCP Proxy initialize instructions 注入（Task A）+ 本地仓库切换到走 proxy（Task B），两个 Task 串行 |

---
_工单包 by Claude (特工队协调者) · 2026-06-15_
