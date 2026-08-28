// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HelpCenter } from "../pages/HelpCenter";
import { navGroups, topLevelEntry } from "../app/navigation";

function renderHelp(path = "/help") {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false }
    }
  });
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url === "/api/help/handbook") {
      return new Response(
        JSON.stringify({
          ok: true,
          data: {
            id: "system-handbook",
            title: "Project Lucy 系统使用与运维手册",
            sourcePath: "docs/SYSTEM_HANDBOOK.md",
            updatedAt: "2026-07-29T12:00:00.000Z",
            etag: "sha256:abc",
            toc: [
              { id: "faq-quick-reference", level: 2, title: "0. 常见问题速查" },
              { id: "faq-developer", level: 3, title: "0.1 面向开发者" },
              { id: "faq-admin", level: 3, title: "0.2 面向管理员" },
              { id: "faq-agent-integration", level: 3, title: "0.3 面向接入协作者" },
              { id: "system-overview", level: 2, title: "1. 系统概述与架构拓扑" },
              { id: "quick-start", level: 2, title: "2. 快速上手" },
              { id: "deployment-checklist", level: 3, title: "3.1 部署向导与上线检查" },
              { id: "overview-action-required", level: 4, title: "系统概览待处理事项" },
              { id: "database-connections", level: 3, title: "3.2 数据库接入" },
              {
                id: "database-connection-boundary",
                level: 4,
                title: "WebUI 与 ktx.yaml 的职责边界"
              },
              {
                id: "database-connection-shapes",
                level: 4,
                title: "连接形态与配置字段"
              },
              {
                id: "database-connection-operations-runbook",
                level: 4,
                title: "新增数据库连接（运维 Runbook）"
              },
              {
                id: "database-connection-acl-sync",
                level: 4,
                title: "Agent 可见性与 ACL 同步"
              },
              { id: "connection-overview-metrics", level: 4, title: "连接概览指标说明" },
              { id: "semantic-layer", level: 3, title: "3.3 语义层维护" },
              { id: "semantic-status-and-enabled-status", level: 4, title: "语义状态与启用表范围状态" },
              { id: "admin-governance", level: 3, title: "3.5 访问治理 Admin" },
              {
                id: "admin-role-agent-token-guide",
                level: 4,
                title: "什么时候配置角色、Agent 和 Token"
              },
              {
                id: "webui-admin-break-glass",
                level: 4,
                title: "丢失管理员账号或密码时如何恢复（break-glass）"
              },
              { id: "eval", level: 3, title: "3.6 质量评测 Eval" },
              { id: "yaml-delivery-runbook", level: 3, title: "3.7 YAML 文件规范与交付验收" },
              { id: "yaml-type-overview", level: 3, title: "3.7.1 YAML 类型总览" },
              { id: "yaml-delivery-checklist", level: 3, title: "3.7.6 GO / NO-GO 交付 checklist" },
              { id: "mcp-integration", level: 2, title: "4. Agent / 客户端接入指南" },
              { id: "configuration-reference", level: 2, title: "5. 配置与环境变量速查" },
              { id: "troubleshooting", level: 2, title: "6. FAQ 与排障指南" },
              { id: "mcp-401", level: 3, title: "6.5 MCP 返回 401" },
              { id: "webui-entry-map", level: 3, title: "1.5 WebUI 入口速查（6+1 侧栏地图）" }
            ],
            markdown: [
              "# Project Lucy 系统使用与运维手册",
              "",
              "| 项 | 内容 |",
              "|---|---|",
              "| 文档类型 | System Handbook |",
              "| 事实来源 | `webui/server/`, `webui/src/` |",
              "",
              "## 目录",
              "",
              "- [1. 系统概述与架构拓扑](#1-系统概述与架构拓扑)",
              "- [2. 快速上手](#2-快速上手)",
              "- [3. 功能模块操作指南](#3-功能模块操作指南)",
              "  - [3.1 部署向导与上线检查](#31-部署向导与上线检查)",
              "  - [3.2 数据库接入](#32-数据库接入)",
              "",
              "## 0. 常见问题速查",
              "",
              "本节是按用户问题组织的快速入口。每条答案给下一步判断；完整操作以正文章节为准。",
              "常见问题按三种角色分组：开发者 / 管理员 / 接入协作者。",
              "第 6 章 FAQ 与排障指南 是配套的故障排查 deep dive。",
              "",
              "### 0.1 面向开发者",
              "",
              "| 问题 | 快速答案 | 详见 |",
              "| --- | --- | --- |",
              "| 我在哪里新建数据库连接？ | `WebUI` 不新建物理连接；先在 `ktx.yaml` 和 secret 文件声明连接，再回 `WebUI` 管理已声明连接。 | [3.2 数据库接入](#32-数据库接入)、[WebUI 与 ktx.yaml 的职责边界](#webui-与-ktxyaml-的职责边界) |",
              "| 数据库密码应该放在哪里？ | 用 `file:`、`env:` 或 `Docker` secrets；不要把明文密码写进 `ktx.yaml`、文档、`commit message` 或聊天记录。 | [连接形态与配置字段](#连接形态与配置字段)、[5.2 ktx.yaml](#52-ktxyaml) |",
              "| 点了刷新本地目录，刷新后的表在哪里看？ | `/connections` 看 reload 状态，`/connections/whitelist` 看可纳入启用表范围的表，`WebUI` 首页 `/` 看已进入语义建模的表。 | [刷新本地目录](#刷新本地目录) |",
              "| 为什么提示“未发现本地 manifest”？ | `ktx.yaml` 声明了 `Schema` 或启用表范围，但本地 `semantic-layer/<conn>/_schema/<schema>.yaml` 缺失或未包含目标表。 | [6.1 为什么提示“未发现本地 manifest”？](#61-为什么提示未发现本地-manifest) |",
              "| `YAML` 改完后为什么 `Agent` 仍然搜不到新口径？ | `WebUI` 读文件即可看到；`KTX` / `MCP` 检索需要 `ktx admin reindex`，并且还要用 `sl read` 确认 `overlay` 已合并到目标 `source`。 | [6.3 配置文件改动后什么时候生效？](#63-配置文件改动后什么时候生效)、[3.7.6.2 KTX 合并与索引检查](#3762-ktx-合并与索引检查) |",
              "| 我应该改 `manifest` 还是 `overlay`？ | 物理表结构和物理列描述在 `manifest`；`grain`、`measures`、`segments`、派生列和业务补丁在 `overlay`。 | [3.3 语义层维护](#33-语义层维护)、[3.7.1 YAML 类型总览](#371-yaml-类型总览) |",
              "| 新增指标怎样才算可以交付？ | 不能只看 `reindex` 或单个 `sl validate`；必须通过静态检查、`sl read`、真实 query、`MCP smoke` 和最终 `GO / NO-GO` 门槛。 | [3.7.6 GO / NO-GO 交付 checklist](#376-go--no-go-交付-checklist) |",
              "| 评测用例和运行历史在哪里？ | 用 `/eval/cases` 维护评测用例，用 `/eval/runs` 看运行历史，用 `/eval/monitor` 看趋势监控。 | [3.6 质量评测 Eval](#36-质量评测-eval) |",
              "| `/catalog` 的「语义状态」和 `/connections/enabled-tables` 的「状态」有什么关系？ | 共用 `GET /api/sources` 的 `completion`。`/catalog` 展示四态完成度；启用表范围页先看 `enabled_tables`，再把非 `done` 收成「已启用，待补语义」。 | [语义状态与启用表范围状态](#语义状态与启用表范围状态)、[系统概览待处理事项](#系统概览待处理事项) |",
              "| `/overview`「待处理事项」里「N 张表待补语义」怎么算？ | 按表计数：只统计已进入启用表范围（`enabled_tables`）且出现在本地 `Manifest` 的表。`N` = 这些表中 `completion !== done` 的数量；未启用的 `Manifest` 表不计入。`done` 需同时有表描述、`grain`、主键、全部非 `hidden` 列描述和至少一个 `measure`。 | [系统概览待处理事项](#系统概览待处理事项)、[3.3 语义层维护](#33-语义层维护) |",
              "| 「待处理事项」其它条目分别统计什么？ | `Catalog` 待处理当前与语义缺口同数；待发布看 `/api/diff` 文件数；无评测看是否已有评测运行记录。近 7 天 `ACL` 拒绝只在「访问风险」指标卡展示，不进入待处理事项。计数为 0 不展示。 | [系统概览待处理事项](#系统概览待处理事项) |",
              "",
              "### 0.2 面向管理员",
              "",
              "| 问题 | 快速答案 | 详见 |",
              "| --- | --- | --- |",
              "| 什么时候该建角色，什么时候该建 `Agent` / `Token`？ | 角色 = 可复用的权限边界；`Agent` = 要对审计负责的人/机器人；`Token` = 某台设备或某个客户端的接入凭证。先角色、再 `Agent`、最后签发 `Token`。 | [什么时候配置角色、Agent 和 Token](#什么时候配置角色agent-和-token) |",
              "| 同一人多台电脑要建几个 `Agent`？ | **一个** `Agent`，按设备或客户端各发一个 `Token`。只有权限边界不同时才拆成多个 `Agent`。 | [什么时候配置角色、Agent 和 Token](#什么时候配置角色agent-和-token) |",
              "| `Agent` 返回 `Access denied` 时先查哪里？ | 先看客户端里的 `decision_reason`，再打开 `/admin/audit` 或查 `/api/admin/audit?outcome=denied`，对照 `role` 的连接、表和工具授权。 | [6.2 JSON-RPC Access denied / decision_reason 怎么查？](#62-json-rpc-access-denied--decisionreason-怎么查)、[3.5 访问治理 Admin](#35-访问治理-admin) |",
              "| `expires_at` 到期后 `token` 会自动失效吗？ | 会。`MCP` Proxy 在鉴权时校验 `expires_at`（不再只是 `metadata`）；到期或不可解析的值一律视为未授权（401）。要提前下线可在 `Admin` 撤销 `token`；到期后仍建议撤销，避免配置残留。 | [3.5 访问治理 Admin](#35-访问治理-admin)、[6.5 MCP 返回 401](#65-mcp-返回-401) |",
              "| 忘记 `WebUI` 管理员账号或密码怎么办？ | 自托管**不提供邮箱找回**。有其他所有者时由其重置；否则由能读写部署配置的人按 `break-glass` 清空 `admins.yaml` 后重新引导。 | [丢失管理员账号或密码时如何恢复（break-glass）](#丢失管理员账号或密码时如何恢复break-glass) |",
              "| 新连接什么时候对 `Agent` 可见？ | `ktx.yaml`、`manifest` / `overlay`、启用表范围、`KTX reindex`、`access.yaml` `role` / `ACL` 都就绪后才可见。 | [Agent 可见性与 ACL 同步](#agent-可见性与-acl-同步)、[新增数据库连接（运维 Runbook）](#新增数据库连接运维-runbook) |",
              "",
              "### 0.3 面向接入协作者",
              "",
              "| 问题 | 快速答案 | 详见 |",
              "| --- | --- | --- |",
              "| `MCP` 返回 401 是什么原因？ | 通常是未带 `Bearer` `token`、`token` hash 不匹配、`token` 已撤销、`expires_at` 已到期、环境变量未展开或进程读取了另一份 `access` 配置。 | [6.5 MCP 返回 401](#65-mcp-返回-401) |",
              "| 本地开发应该访问哪个端口？ | 页面端口以启动日志为准；常见开发入口是 `Vite 5173`，`API 5174`，`Lucy MCP Proxy 7879`。`Docker` / demo 宿主端口可能是 `55176` 等映射端口。 | [2.2 本地启动](#22-本地启动)、[4.1 接入地址](#41-接入地址) |",
              "",
              "## 1. 系统概述与架构拓扑",
              "",
              "Lucy 是本地语义补充工作台。",
              "",
              "### 1.5 WebUI 入口速查（6+1 侧栏地图）",
              "",
              "本节是侧栏可见入口的镜像视图。",
              "事实源唯一为 `webui/src/app/App.tsx` `navGroups` + `topLevelEntry`（v0.2 起由 `webui/src/app/navigation.ts` 导出）。",
              "`webui/docs/06-navigation-ia.md` §3 当前为待同步 IA 文档（含旧路径），不与代码并列称为权威源。",
              "架构调整时，请先改 `webui/src/app/navigation.ts`，再同步 §1.5 表格，最后开 follow-up 工单修 06 spec §3 / §4。",
              "",
              "| 分组 | 二级菜单 | 路径 | 一句话用途 |",
              "| --- | --- | --- | --- |",
              "| 系统概览 | 系统概览 | `/overview` | 查看 Lucy MCP、KTX Runtime、语义资产和 `Agent` 接入状态，集中处理异常与待办。 |",
              "| 数据接入 | 连接概览 | `/connections` | 管理数据库连接、`Schema` 与 `Schema Manifest`，并查看连通性和本地目录同步状态。 |",
              "| 数据接入 | 启用表范围 | `/connections/enabled-tables` | 配置各连接进入语义层的表范围，并审阅保存前变更。 |",
              "| 语义建模 | 语义资产 | `/catalog` | 管理表、字段、指标、分群与关联等结构化语义资产。 |",
              "| 语义建模 | 业务 Wiki | `/wiki` | 管理业务口径、指标说明与分析指引等业务文档。 |",
              "| 语义发布 | 发布工作台 | `/publish/workbench` | 审阅并校验语义与 `Wiki` 变更，同步索引后使其对 `Agent` 生效。 |",
              "| 语义发布 | 发布记录 | `/publish/history` | 查看历次语义发布的变更范围、执行结果与操作记录。 |",
              "| 质量评测 | 评测用例 | `/eval/cases` | 管理数据问答与语义质量的评测用例及预期结果。 |",
              "| 质量评测 | 运行历史 | `/eval/runs` | 查看评测运行记录、通过率、结果明细与失败诊断。 |",
              "| 质量评测 | 趋势监控 | `/eval/monitor` | 监控评测通过率、失败集中度与质量漂移趋势。 |",
              "| 质量评测 | 安全评测候选 | `/eval/security-candidates` | 从访问拒绝日志中提取权限与数据隔离场景，审定后转为安全评测用例。 |",
              "| 访问治理 | 使用概况 | `/admin/usage` | 查看 `Agent`、`Token` 和数据表的活跃度、调用量与响应耗时。 |",
              "| 访问治理 | Agent | `/admin/agents` | 管理 `Agent` 身份、角色、`Token` 及数据访问边界。 |",
              "| 访问治理 | 角色权限 | `/admin/roles` | 管理角色的数据库连接、数据表与 `MCP` 工具授权范围。 |",
              "| 访问治理 | 访问日志 | `/admin/audit` | 按问询和工具调用追溯 `Agent` 访问行为、权限裁决与执行耗时。 |",
              "| 访问治理 | MCP 调试台 | `/admin/mcp-playground` | 预览 `Agent` 的 `MCP` 工具权限裁决，并执行受控接入试调。 |",
              "| 访问治理 | 配置审计 | `/admin/config-audit` | 查看各类配置与内容资产的写入记录、变更内容和操作者。 |",
              "| 系统设置 | 品牌外观 | `/admin/branding` | 配置客户 `Logo`、产品名称与品牌副标题。 |",
              "| 系统设置 | 登录账户 | `/admin/admins` | 管理 `WebUI` 登录账户，并配置所有者或运维角色。 |",
              "",
              "> 事实源唯一为 `webui/src/app/App.tsx` `navGroups` + `topLevelEntry`（`webui/src/app/navigation.ts` 导出）；`webui/docs/06-navigation-ia.md` §3 当前为待同步 IA 文档。",
              "",
              "## 2. 快速上手",
              "",
              "### 2.2 本地启动",
              "",
              "`ktx up` 启动依赖；`WebUI` 默认监听 `5173`，API 默认 `5174`，MCP 默认 `7879`。",
              "",
              "### 3.1 部署向导与上线检查",
              "",
              "| 步骤 | Ready 条件 | 检查方法 | 异常处理 |",
              "|---|---|---|---|",
              "| 1 | `ktx.yaml` 已存在 | 查看项目根目录 | 补齐配置 |",
              "",
              "#### 系统概览待处理事项",
              "",
              "「待处理事项」按表计数：总数减去 `completion` 为 `done` 的表。",
              "",
              "### 3.2 数据库接入",
              "",
              "WebUI 不负责新建物理数据库连接。新增连接的 host、port、database、username、password、driver 等字段由运维在 `ktx.yaml` 和 secret 文件中配置。",
              "",
              "#### 刷新本地目录",
              "",
              "`/connections` 看 reload 状态，`/connections/whitelist` 看可纳入启用表范围的表。",
              "",
              "#### WebUI 与 ktx.yaml 的职责边界",
              "",
              "WebUI 是已声明连接的管理界面，不承担物理数据库连接的创建与凭据管理。",
              "",
              "#### 连接形态与配置字段",
              "",
              "通用模板见 `ktx.yaml`。",
              "",
              "#### 新增数据库连接（运维 Runbook）",
              "",
              "按 10 步顺序操作。",
              "",
              "#### Agent 可见性与 ACL 同步",
              "",
              "新增连接后必须同步 `webui/config/access.yaml` 的 role。",
              "",
              "#### 连接概览指标说明",
              "",
              "「已发现表数」统计本地 Schema Manifest 已读到的表，不是远端物理库实时表数。",
              "",
              "### 3.3 语义层维护",
              "",
              "维护 manifest / overlay、启用表范围与 reindex。",
              "",
              "#### 语义状态与启用表范围状态",
              "",
              "`/catalog` 的「语义状态」直接显示 `completion`；启用表范围的「状态」再叠上 `enabled_tables`。",
              "",
              "### 3.5 访问治理 Admin",
              "",
              "在 `/admin` 维护 Agent / Role / Token / 审计。",
              "",
              "#### 什么时候配置角色、Agent 和 Token",
              "",
              "角色管权限边界，`Agent` 管审计身份，`Token` 管接入凭证。一人一 `Agent`，多 `Token` 同权。",
              "",
              "#### 丢失管理员账号或密码时如何恢复（break-glass）",
              "",
              "自托管不提供邮箱找回。优先由其他所有者在 `/admin/admins` 重置；无人可登录时清空 `admins.yaml` 后以 `LUCY_WEBUI_AUTH=required` 重新 bootstrap。",
              "",
              "### 3.6 质量评测 Eval",
              "",
              "在 `/eval/cases` 维护用例，`/eval/runs` 看历史，`/eval/monitor` 看趋势。",
              "",
              "### 3.7 YAML 文件规范与交付验收",
              "",
              "FAQ 可跳到 [KTX 合并与索引检查](#3762-ktx-合并与索引检查)。",
              "",
              "#### 3.7.1 YAML 类型总览",
              "",
              "manifest / overlay / new source / descriptions 等 7 类。",
              "",
              "#### 3.7.6 GO / NO-GO 交付 checklist",
              "",
              "只有全部检查通过才允许 GO。",
              "",
              "##### 3.7.6.2 KTX 合并与索引检查",
              "",
              "必须执行 `sl read`。",
              "",
              "### 5.2 ktx.yaml",
              "",
              "`ktx.yaml` 是项目级配置入口。",
              "",
              "## 4. Agent / 客户端接入指南",
              "",
              "### 4.1 接入地址",
              "",
              "MCP 接入地址 `http://127.0.0.1:7879/mcp`。",
              "",
              "## 5. 配置与环境变量速查",
              "",
              "`LUCY_AGENT_TOKEN` 由环境变量注入。",
              "",
              "## 6. FAQ 与排障指南",
              "",
              "故障排查 deep dive。",
              "",
              "### 6.1 为什么提示“未发现本地 manifest”？",
              "",
              "`semantic-layer/<conn>/_schema/<schema>.yaml` 缺失或未包含目标表。",
              "",
              "### 6.2 JSON-RPC `Access denied` / `decision_reason` 怎么查？",
              "",
              "先看客户端里的 `decision_reason`，再打开 `/admin/audit`。",
              "",
              "### 6.3 配置文件改动后什么时候生效？",
              "",
              "WebUI 读文件即可看到；KTX / MCP 检索需要 `ktx admin reindex`。",
              "",
              "### 6.4 WebUI 页面打不开",
              "",
              "检查端口与 `WebUI` 启动日志。",
              "",
              "### 6.5 MCP 返回 401",
              "",
              "未带 `Bearer` `token`、`token` hash 不匹配或 `token` 已撤销。",
              "",
              "### 6.6 KTX upstream 不可用",
              "",
              "等待上游恢复或切换到 staging。",
              "",
              "### 6.7 为什么白名单表保存失败？",
              "",
              "`TABLE_NOT_SCANNED` 表示表不在本地 manifest。",
              "",
              "### 6.8 安全边界速查",
              "",
              "禁止写 `.ktx/secrets/`；`ktx.yaml` diff 会剥离 secret 类键。",
              "",
              "### 6.9 最小健康检查清单",
              "",
              "至少跑通 `/api/health`、`/api/project`、`/api/catalog/reload`。"
            ].join("\n")
          }
        })
      );
    }
    if (url.startsWith("/api/help/search")) {
      const parsed = new URL(url, "http://localhost");
      const q = parsed.searchParams.get("q") ?? "";
      if (!q.trim()) {
        return new Response(JSON.stringify({ ok: true, data: { query: "", items: [] } }), {
          status: 200
        });
      }
      if (q.includes("已发现表数")) {
        return new Response(
          JSON.stringify({
            ok: true,
            data: {
              query: q,
              items: [
                {
                  sectionId: "connection-overview-metrics",
                  title: "连接概览指标说明",
                  snippet: "「已发现表数」统计本地 Schema Manifest 已读到的表…"
                }
              ]
            }
          }),
          { status: 200 }
        );
      }
      return new Response(JSON.stringify({ ok: true, data: { query: q, items: [] } }), {
        status: 200
      });
    }
    return new Response(JSON.stringify({ ok: false, error: { code: "NOT_FOUND", message: "not found" } }), { status: 404 });
  });
  vi.stubGlobal("fetch", fetchMock);

  // HelpCenter.useEffect 会调用 element.scrollIntoView；jsdom 29 不实现该方法，
  // 未主动 mock 的测试（包括 §1.5 dirty 改动与本任务新增 M58 测试）需要兜底。
  if (typeof Element.prototype.scrollIntoView !== "function") {
    Element.prototype.scrollIntoView = vi.fn();
  }

  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <HelpCenter />
      </MemoryRouter>
    </QueryClientProvider>
  );
  return { fetchMock };
}

function flushRequestAnimationFrame() {
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb: FrameRequestCallback) => {
    cb(0);
    return 0;
  });
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  // 重置 scrollIntoView 兜底，避免 vi.fn() 实例在测试间泄漏。
  Element.prototype.scrollIntoView = undefined as unknown as typeof Element.prototype.scrollIntoView;
});

describe("HelpCenter", () => {
  it("renders the handbook TOC and markdown content", async () => {
    const { fetchMock } = renderHelp();

    expect(await screen.findByRole("heading", { name: "系统手册" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "常见问题速查" })).toHaveAttribute("href", "/help?section=faq-quick-reference");
    expect(screen.getByRole("link", { name: "系统概述与架构拓扑" })).toHaveAttribute("href", "/help?section=system-overview");
    expect(screen.getByRole("link", { name: "部署向导与上线检查" })).toHaveAttribute("href", "/help?section=deployment-checklist");
    expect(screen.getByRole("link", { name: "YAML 文件规范与交付验收" })).toHaveAttribute("href", "/help?section=yaml-delivery-runbook");
    expect(screen.getByRole("link", { name: "GO / NO-GO 交付 checklist" })).toHaveAttribute("href", "/help?section=yaml-delivery-checklist");
    expect(screen.getByRole("link", { name: "Agent / 客户端接入指南" })).toHaveAttribute("href", "/help?section=mcp-integration");
    // TOC 折叠时不应出现 level-4 链接（§0 内部 anchor 链不算），只在 toc 子树内查。
    const toc = await screen.findByLabelText("系统手册目录");
    expect(within(toc).queryByRole("link", { name: "Agent 可见性与 ACL 同步" })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "0. 常见问题速查" })).toBeInTheDocument();
    expect(screen.getByText("我在哪里新建数据库连接？")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "3.2 数据库接入" })).toHaveAttribute("href", "#32-数据库接入");
    expect(screen.getByText(/Lucy 是本地语义补充工作台/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "KTX 合并与索引检查" })).toHaveAttribute("href", "#3762-ktx-合并与索引检查");
    expect(screen.getByRole("link", { name: "KTX 合并与索引检查" })).not.toHaveAttribute("target");
    expect(screen.getByRole("heading", { name: "3.7.6.2 KTX 合并与索引检查" })).toHaveAttribute("id", "3762-ktx-合并与索引检查");
    expect(screen.getByText("docs/SYSTEM_HANDBOOK.md")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/help/handbook",
      expect.objectContaining({ credentials: "same-origin" })
    );
  });

  it("scrolls to the section from the section query parameter", async () => {
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    flushRequestAnimationFrame();

    renderHelp("/help?section=mcp-integration");

    await waitFor(() => {
      expect(scrollIntoView).toHaveBeenCalledWith({ behavior: "smooth", block: "start" });
    });
  });

  it("scrolls to the FAQ quick reference section from a stable section id", async () => {
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    flushRequestAnimationFrame();

    renderHelp("/help?section=faq-quick-reference");

    const activeLink = await screen.findByRole("link", { name: "常见问题速查" });
    expect(activeLink).toHaveAttribute("aria-current", "location");
    expect(document.getElementById("faq-quick-reference")).toBeInTheDocument();
    await waitFor(() => {
      expect(scrollIntoView).toHaveBeenCalledWith({ behavior: "smooth", block: "start" });
    });
  });

  it("renders the deployment checklist as a real markdown table", async () => {
    renderHelp("/help?section=deployment-checklist");

    const article = await screen.findByRole("article");
    const deploymentSection = document.getElementById("deployment-checklist");
    expect(deploymentSection).toBeInTheDocument();
    const table = within(deploymentSection as HTMLElement).getByRole("table");

    expect(screen.getByRole("heading", { name: "3.1 部署向导与上线检查" })).toBeInTheDocument();
    expect(screen.queryByText("系统手册加载中...")).not.toBeInTheDocument();
    expect(within(table).getByRole("columnheader", { name: "步骤" })).toBeInTheDocument();
    expect(within(table).getByRole("columnheader", { name: "Ready 条件" })).toBeInTheDocument();
    expect(within(table).getByText("补齐配置")).toBeInTheDocument();
    expect(article).not.toHaveTextContent("| 步骤 | Ready 条件 | 检查方法 | 异常处理 |");
  });

  it("scrolls to the YAML delivery checklist section from a stable section id", async () => {
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    flushRequestAnimationFrame();

    renderHelp("/help?section=yaml-delivery-checklist");

    await waitFor(() => {
      expect(scrollIntoView).toHaveBeenCalledWith({ behavior: "smooth", block: "start" });
    });
  });

  it("renders the database connection operations runbook section tree and content for an active level-4 section", async () => {
    const { fetchMock } = renderHelp("/help?section=database-connection-acl-sync");

    // Boundary statement + capability table must be present in the markdown.
    expect(
      await screen.findByText(/WebUI 不负责新建物理数据库连接/)
    ).toBeInTheDocument();
    // All four level-4 anchors must surface as toc links with stable hrefs.
    // 限定到 TOC 子树，避免命中 §0 内部 anchor 链。
    const tocNav = await screen.findByLabelText("系统手册目录");
    expect(
      within(tocNav).getByRole("link", { name: "WebUI 与 ktx.yaml 的职责边界" })
    ).toHaveAttribute("href", "/help?section=database-connection-boundary");
    expect(
      within(tocNav).getByRole("link", { name: "连接形态与配置字段" })
    ).toHaveAttribute("href", "/help?section=database-connection-shapes");
    expect(
      within(tocNav).getByRole("link", { name: "新增数据库连接（运维 Runbook）" })
    ).toHaveAttribute(
      "href",
      "/help?section=database-connection-operations-runbook"
    );
    expect(
      within(tocNav).getByRole("link", { name: "Agent 可见性与 ACL 同步" })
    ).toHaveAttribute("href", "/help?section=database-connection-acl-sync");
    // Sections are rendered as anchors with the stable id.
    expect(
      document.getElementById("database-connection-operations-runbook")
    ).toBeInTheDocument();
    expect(
      document.getElementById("database-connection-acl-sync")
    ).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/help/handbook",
      expect.objectContaining({ credentials: "same-origin" })
    );
  });

  it("scrolls to the database connection operations runbook section from a stable section id", async () => {
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    flushRequestAnimationFrame();

    renderHelp("/help?section=database-connection-operations-runbook");

    await waitFor(() => {
      expect(scrollIntoView).toHaveBeenCalledWith({ behavior: "smooth", block: "start" });
    });
  });

  it("renders the handbook header metadata as separate chips with translation defense", async () => {
    renderHelp();

    const header = await screen.findByTestId("page-header");
    expect(within(header).getByText("无需登录即可查看")).toBeInTheDocument();
    expect(within(header).getByText("来源")).toBeInTheDocument();
    expect(within(header).getByText("docs/SYSTEM_HANDBOOK.md")).toHaveAttribute("translate", "no");
    expect(within(header).getByText(/更新时间/)).toBeInTheDocument();
    expect(within(header).getByRole("link", { name: "返回系统概览" })).toHaveAttribute("href", "/overview");
    expect(within(header).getByRole("navigation", { name: "面包屑" })).toHaveTextContent("系统帮助");
    expect(within(header).queryByText(/\/\s*系统手册/)).not.toBeInTheDocument();
    // Source path and updated time must not be glued together without a separator.
    expect(header).not.toHaveTextContent("docs/SYSTEM_HANDBOOK.md2026");
  });

  it("marks the deep-link section as current in the TOC and scrolls to it", async () => {
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    flushRequestAnimationFrame();

    renderHelp("/help?section=database-connection-acl-sync");

    // active-section 的 TOC 链接需要定位到 TOC 子树内（§0.2 也引用同名 anchor）
    const tocNav = await screen.findByLabelText("系统手册目录");
    const activeLink = await within(tocNav).findByRole("link", { name: "Agent 可见性与 ACL 同步" });
    expect(activeLink).toHaveAttribute("aria-current", "location");
    expect(document.getElementById("database-connection-acl-sync")).toBeInTheDocument();
    await waitFor(() => {
      expect(scrollIntoView).toHaveBeenCalledWith({ behavior: "smooth", block: "start" });
    });
  });

  it("does not render the leading handbook metadata table in the article body", async () => {
    renderHelp();

    const article = await screen.findByRole("article");
    expect(within(article).queryByText("文档类型")).not.toBeInTheDocument();
    expect(within(article).queryByRole("heading", { name: "目录" })).not.toBeInTheDocument();
    expect(within(article).getByRole("heading", { name: /系统概述与架构拓扑/ })).toBeInTheDocument();
  });

  it("does not scroll when the section query parameter does not match any section", async () => {
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    flushRequestAnimationFrame();

    renderHelp("/help?section=does-not-exist");

    expect(await screen.findByRole("heading", { name: "系统手册" })).toBeInTheDocument();
    // Give the rAF callback (if scheduled) a chance to run.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  // ----- Phase 3: Help §0 FAQ scenario groups (M58 / spec 60) -----

  it("renders §0 with three scenario sub-sections", async () => {
    renderHelp("/help?section=faq-quick-reference");

    await waitFor(() => {
      expect(
        screen.getByRole("heading", { name: /常见问题速查/ })
      ).toBeInTheDocument();
      expect(
        screen.getByRole("heading", { name: /面向开发者/ })
      ).toBeInTheDocument();
      expect(
        screen.getByRole("heading", { name: /面向管理员/ })
      ).toBeInTheDocument();
      expect(
        screen.getByRole("heading", { name: /面向接入协作者/ })
      ).toBeInTheDocument();
    });
  });

  it("deep links to §0.1 / §0.2 / §0.3 sub-sections resolve to independent <section> ids", async () => {
    renderHelp("/help");

    await waitFor(() => {
      expect(document.querySelector("section#faq-developer")).toBeInTheDocument();
      expect(document.querySelector("section#faq-admin")).toBeInTheDocument();
      expect(document.querySelector("section#faq-agent-integration")).toBeInTheDocument();
    });

    // 三个 section 必须各自独立、不嵌套
    expect(
      document.querySelector("section#faq-developer section#faq-admin")
    ).toBeNull();
    expect(
      document.querySelector("section#faq-admin section#faq-agent-integration")
    ).toBeNull();
  });

  it("TOC links for §0 sub-sections point to the new alias section ids", async () => {
    renderHelp("/help");

    await waitFor(() => {
      expect(
        screen.getByRole("heading", { name: /面向开发者/ })
      ).toBeInTheDocument();
    });

    // §0 主标题 + 三个子节都要在 TOC 里以正确 href 出现
    expect(
      screen.getByRole("link", { name: "常见问题速查" })
    ).toHaveAttribute("href", "/help?section=faq-quick-reference");

    const developerLinks = screen.getAllByRole("link", { name: "面向开发者" });
    expect(developerLinks.length).toBeGreaterThan(0);
    developerLinks.forEach((link) => {
      expect(link.getAttribute("href")).toBe("/help?section=faq-developer");
    });

    const adminLinks = screen.getAllByRole("link", { name: "面向管理员" });
    adminLinks.forEach((link) => {
      expect(link.getAttribute("href")).toBe("/help?section=faq-admin");
    });

    const integrationLinks = screen.getAllByRole("link", {
      name: "面向接入协作者"
    });
    integrationLinks.forEach((link) => {
      expect(link.getAttribute("href")).toBe(
        "/help?section=faq-agent-integration"
      );
    });
  });

  it("renders §0 key terms as inline code per A/B tiers", async () => {
    renderHelp("/help?section=faq-quick-reference");

    await waitFor(() => {
      expect(document.querySelector("section#faq-developer")).toBeInTheDocument();
      expect(document.querySelector("section#faq-admin")).toBeInTheDocument();
      expect(document.querySelector("section#faq-agent-integration")).toBeInTheDocument();
    });

    // 收集 §0 三个子 section 的 <code> 文本集合（A 档"必须 inline code"验证）
    const codeTexts: string[] = [];
    const sectionIds = ["faq-developer", "faq-admin", "faq-agent-integration"];
    for (const id of sectionIds) {
      const sec = document.querySelector(`section#${id}`);
      if (!sec) throw new Error(`expected section#${id}`);
      sec.querySelectorAll("code").forEach((n) => {
        const t = n.textContent ?? "";
        if (t) codeTexts.push(t);
      });
    }

    // 收集 §0 三个子 section 剥离 <code>、heading、内部引用链接后的纯文本
    // heading/TOC 无法局部 notranslate；"详见"列链接文本引用既有 handbook 标题，二者不纳入本测试失败范围。
    const rawTexts: string[] = [];
    for (const id of sectionIds) {
      const sec = document.querySelector(`section#${id}`);
      if (!sec) continue;
      const clone = sec.cloneNode(true) as HTMLElement;
      clone
        .querySelectorAll("code, h1, h2, h3, h4, h5, h6, a[href^='#']")
        .forEach((c) => c.remove());
      rawTexts.push(clone.textContent ?? "");
    }
    const rawTextJoined = rawTexts.join("\n");
    const fullTextJoined = codeTexts.join("\n");

    // A 档：必须出现且必须 inline code 化
    const tierA = [
      "Agent",
      "MCP",
      "YAML",
      "Schema",
      "KTX",
      "access.yaml",
      "ktx.yaml",
      "overlay",
      "reindex",
      "grain",
      "measures",
      "segments",
      "Bearer",
      "metadata",
      "Admin",
      "API",
      "GO / NO-GO",
      "MCP smoke",
      "sl read",
      "sl validate",
      "decision_reason",
      "expires_at",
      "Docker",
      "Vite 5173",
      "API 5174",
      "Lucy MCP Proxy 7879",
      "WebUI",
      "file:",
      "env:",
      "commit message",
      "source",
      "role",
      "token",
      "ACL",
      "Access denied"
    ];
    for (const term of tierA) {
      // 1. 剥离 <code>、heading、内部引用链接后正文不得包含该术语（不得裸奔）
      expect(
        rawTextJoined.includes(term),
        `A-tier term "${term}" appears in §0 raw text (not inline code)`
      ).toBe(false);
      // 2. <code> 节点文本集合至少包含该术语一次（必须 inline code 化）
      expect(
        fullTextJoined.includes(term),
        `A-tier term "${term}" missing from §0 inline code`
      ).toBe(true);
    }

    // B 档：若出现则必须 inline code 化；不出现则跳过
    const tierB = [
      "Manifest",
      "Catalog",
      "Role",
      "Endpoint",
      "Eval Run",
      "Runtime",
      "enabled_tables",
      "tools/list",
      "tools/call",
      "OK"
    ];
    for (const term of tierB) {
      const appearsAnywhere =
        fullTextJoined.includes(term) || rawTextJoined.includes(term);
      if (!appearsAnywhere) continue;
      // 若出现，必须只在 <code> 内（剥离 code、heading、内部引用链接后不再出现）
      expect(
        rawTextJoined.includes(term),
        `B-tier term "${term}" appears in §0 raw text (not inline code)`
      ).toBe(false);
    }
  });

  it("Q&A deep links in §0 point to real handbook anchors (DOM-based)", async () => {
    renderHelp("/help");

    await waitFor(() => {
      expect(document.querySelector("section#faq-developer")).toBeInTheDocument();
    });

    // 收集 §0 三个子 section 内的所有内部深链
    const internalHrefs = new Set<string>();
    for (const id of ["faq-developer", "faq-admin", "faq-agent-integration"]) {
      const sec = document.querySelector(`section#${id}`);
      if (!sec) continue;
      sec.querySelectorAll("a[href^='#']").forEach((a) => {
        const href = a.getAttribute("href") ?? "";
        if (href.length > 1) internalHrefs.add(href);
      });
    }
    expect(internalHrefs.size).toBeGreaterThan(0);

    // 每个 href 必须能解析到 help-content 内的真实 id
    // 用 getElementById 替代 CSS.escape —— vitest jsdom 环境下 CSS.escape 不可用
    const content = screen.getByTestId("help-content");
    internalHrefs.forEach((href) => {
      const id = href.replace(/^#/, "");
      expect(
        content.querySelector(`[id="${id}"]`) ?? document.getElementById(id),
        `dead link: ${href}`
      ).toBeTruthy();
    });
  });

  it("§0 contains no forbidden terms", async () => {
    renderHelp("/help?section=faq-quick-reference");
    await waitFor(() =>
      screen.getByRole("heading", { name: /常见问题速查/ })
    );

    const ids = [
      "faq-quick-reference",
      "faq-developer",
      "faq-admin",
      "faq-agent-integration"
    ];
    const combinedText = ids
      .map((id) => document.querySelector(`section#${id}`)?.textContent ?? "")
      .join("\n");

    expect(combinedText).not.toMatch(
      /财政部舱单|舱单|替代测试|上传报价包|添加架构|目标架构|模式清单|重新加载资产/
    );
  });

  it("§6 FAQ 与排障指南 section count and titles are preserved", async () => {
    renderHelp("/help?section=troubleshooting");
    await waitFor(() =>
      screen.getByRole("heading", { name: /FAQ 与排障指南/ })
    );

    const expectedFaqTitles = [
      /6\.1 为什么提示/,
      /6\.2 JSON-RPC/,
      /6\.3 配置文件改动/,
      /6\.4 WebUI 页面打不开/,
      /6\.5 MCP 返回 401/,
      /6\.6 KTX upstream/,
      /6\.7 为什么白名单表保存失败/,
      /6\.8 安全边界速查/,
      /6\.9 最小健康检查清单/
    ];
    for (const title of expectedFaqTitles) {
      expect(
        screen.getByRole("heading", { name: title }),
        `expected §6 to keep ${title}`
      ).toBeInTheDocument();
    }
  });

  it("§1.5 renders the 6+1 WebUI Entry Map heading and section id", async () => {
    renderHelp("/help?section=webui-entry-map");
    await waitFor(() =>
      screen.getByRole("heading", { name: /WebUI 入口速查（6\+1 侧栏地图）/ })
    );
    expect(document.querySelector("section#webui-entry-map")).not.toBeNull();
  });

  it("§1.5 table has 4 columns and 19 rows that mirror navigation.ts", async () => {
    renderHelp("/help?section=webui-entry-map");
    await waitFor(() =>
      screen.getByRole("heading", { name: /WebUI 入口速查（6\+1 侧栏地图）/ })
    );

    const section = document.querySelector("section#webui-entry-map");
    expect(section).not.toBeNull();
    if (!section) throw new Error("section#webui-entry-map missing");

    // First <table> in the section is the entry map table.
    const table = section.querySelector("table");
    expect(table).not.toBeNull();
    if (!table) throw new Error("entry map table missing");

    const headers = table.querySelectorAll("thead th");
    expect(headers.length).toBe(4);

    const bodyRows = table.querySelectorAll("tbody tr");
    expect(bodyRows.length).toBe(20);

    // Every visible column must mirror the shared navigation module so the
    // handbook cannot drift from the current menu labels, paths, or copy.
    const expectedItems = [topLevelEntry, ...navGroups.flatMap((g) => g.items)];
    const expectedGroups = [
      topLevelEntry.label,
      ...navGroups.flatMap((g) => g.items.map(() => g.title))
    ];
    bodyRows.forEach((tr, idx) => {
      const cells = tr.querySelectorAll("td");
      expect(cells[0]?.textContent).toBe(expectedGroups[idx]);
      expect(cells[1]?.textContent).toBe(expectedItems[idx]?.label);
      expect(cells[3]?.textContent).toBe(expectedItems[idx]?.description);
    });

    // Path column (3rd cell) must be wrapped in <code> for each of the 19
    // sidebar-visible entries — translation defense contract.
    const expectedPaths = [
      topLevelEntry.to,
      ...navGroups.flatMap((g) => g.items.map((i) => i.to))
    ];
    bodyRows.forEach((tr, idx) => {
      const pathCell = tr.querySelectorAll("td")[2];
      expect(pathCell?.querySelector("code")?.textContent).toBe(expectedPaths[idx]);
    });
  });

  it("§1.5 blockquote cites the single source of truth (App.tsx + navigation.ts)", async () => {
    renderHelp("/help?section=webui-entry-map");
    await waitFor(() =>
      screen.getByRole("heading", { name: /WebUI 入口速查（6\+1 侧栏地图）/ })
    );
    const section = document.querySelector("section#webui-entry-map");
    if (!section) throw new Error("section#webui-entry-map missing");
    const blockquote = section.querySelector("blockquote");
    expect(blockquote).not.toBeNull();
    const codeRefs = Array.from(blockquote?.querySelectorAll("code") ?? []).map(
      (c) => c.textContent
    );
    expect(codeRefs).toContain("webui/src/app/App.tsx");
    expect(codeRefs).toContain("webui/src/app/navigation.ts");
    // 06 spec is explicitly flagged as 旧路径 / 待同步 IA 文档
    expect(codeRefs).toContain("webui/docs/06-navigation-ia.md");
  });

  it("§1.5 contains no forbidden terms", async () => {
    renderHelp("/help?section=webui-entry-map");
    await waitFor(() =>
      screen.getByRole("heading", { name: /WebUI 入口速查（6\+1 侧栏地图）/ })
    );
    const section = document.querySelector("section#webui-entry-map");
    const text = section?.textContent ?? "";
    expect(text).not.toMatch(
      /财政部舱单|舱单|替代测试|上传报价包|添加架构|目标架构|模式清单|重新加载资产/
    );
  });

  it("renders a handbook search box and finds 已发现表数", async () => {
    const { fetchMock } = renderHelp();
    const input = await screen.findByLabelText("搜索系统手册");
    expect(input).toBeInTheDocument();

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/help/handbook",
        expect.objectContaining({ credentials: "same-origin" })
      )
    );

    fireEvent.change(input, { target: { value: "已发现表数" } });

    expect(await screen.findByTestId("help-search-results")).toBeInTheDocument();
    expect(await screen.findByText("连接概览指标说明")).toBeInTheDocument();
    expect(screen.getByText(/统计本地 Schema Manifest 已读到的表/)).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringMatching(/^\/api\/help\/search\?q=/),
      expect.objectContaining({ credentials: "same-origin" })
    );

    fireEvent.click(screen.getByRole("link", { name: /连接概览指标说明/ }));
    await waitFor(() => {
      expect(screen.queryByTestId("help-search-results")).not.toBeInTheDocument();
    });
    expect(document.getElementById("connection-overview-metrics")).toBeInTheDocument();
  });

  it("shows an empty search state when nothing matches", async () => {
    renderHelp("/help?q=完全不存在的关键词xyz");
    expect(await screen.findByTestId("help-search-empty")).toHaveTextContent(
      "未找到与「完全不存在的关键词xyz」相关的手册内容。"
    );
  });
});
