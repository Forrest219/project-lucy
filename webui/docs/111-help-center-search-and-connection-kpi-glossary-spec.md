# Help Center Search and Connection KPI Glossary Spec

| 元数据 | 内容 |
|---|---|
| 文档名称 | Help Center Search and Connection KPI Glossary Spec |
| 文档类型 | Spec |
| 版本 | v1.0 |
| 撰写日期 | 2026-08-05 |
| 撰写人 | Composer |
| 委托人 | zhangxingchen |
| 基于材料 | `/help` 无搜索能力反馈；`/connections`「已发现表数」语义无处可查；`docs/design-system-handbook-help.md` M15-P1-2；`webui/docs/73-connections-terminology-and-upload-drawer-consistency-spec.md` |
| 适用范围 | `/help` 手册内关键词搜索；连接概览 KPI / 列头术语写入系统手册并可被搜索命中 |
| 输出位置 | `webui/docs/111-help-center-search-and-connection-kpi-glossary-spec.md` |

| 字段 | 内容 |
|---|---|
| Spec 编号 | 111 |
| 关联工单 | `webui/docs/plans/wo-202608-44-help-center-search-and-connection-kpi-glossary.md` |
| 关联页面 | `/help`、`/connections`（仅术语说明，不改连接页 UI） |
| 关联设计 | `docs/design-system-handbook-help.md` §5.3 / M15-P1-2 |
| 状态 | Implemented |
| 日期 | 2026-08-05 |

## 1. 背景

1. `/help` 已可 TOC 跳转与 `?section=` 深链，但无关键词搜索，用户无法按 UI 文案定位说明。
2. 连接概览列头「已发现表数」与 KPI「服务器目录已发现表」在产品内有 hover hint，但 `docs/SYSTEM_HANDBOOK.md` 未出现这些字面量；即使实现搜索，当前也会零命中。
3. 设计文档 M15-P1-2 已定义 `GET /api/help/search`，后端与前端均未落地。

## 2. 目标

1. 在 `/help` 提供手册内关键词搜索：输入即查、结果跳转对应章节。
2. 实现设计已约定的 `GET /api/help/search?q=&limit=`。
3. 在系统手册中补充连接概览 KPI / 列头术语说明，使搜索「已发现表数」「已启用表数」「服务器目录已发现表」「未启用表」均可命中可读解释。
4. 在术语标准中登记上述 KPI 正式名，避免后续 UI / 手册 / 断言漂移。

## 3. 非目标

- 不做 Help Drawer / 上下文 `?` 抽屉（仍属 M15-P1-1，本单不实现）。
- 不做 LLM / RAG / 跨文档搜索；不搜索 `wiki/`、不开放任意 `docs/*.md`。
- 不改 `/connections` 页面布局、列计算或 API。
- 不改 Command Palette 全局导航搜索。
- 不做浏览器验证（默认按仓库浏览器测试约束；本单以单测 + 搜索 API 测试验收）。
- 不在本单补齐 GFM 表格增强或代码复制（M15-P1-3）。

## 4. Terminology Compliance

遵循 `webui/docs/00-product-terminology-standard.md`。本单新增 / 登记术语：

| Official Name | UI Label (zh) | Config / Alias | Forbidden | Notes |
|---|---|---|---|---|
| Discovered Tables | 已发现表数 | 服务器目录已发现表、`localCatalogTables` | 本地表数（已废弃列头）、物理表数、远端表数 | 本地 Schema Manifest 已读到的表数；非 DB 实时扫描 |
| Enabled Tables Count | 已启用表数 | `enabled_tables` | 启用表数（旧列头，仅兼容旧文档） | 来自 `ktx.yaml` `enabled_tables` |
| Unenabled Tables | 未启用表 | — | 未白名单表（主导航禁用） | 已发现但未进入 `enabled_tables`；缺 Manifest 的未知表不计入 |

既有术语继续使用：`Schema Manifest`、`Catalog`、`刷新本地目录`、`启用表范围`、`连接概览`。专业英文与路径继续 `notranslate` / `translate="no"`。

## 5. 设计与实现

### 5.1 Search API

`GET /api/help/search?q=<keyword>&limit=20`

| 项 | 约定 |
|---|---|
| 数据源 | 仅 `docs/SYSTEM_HANDBOOK.md`（与 handbook 同源） |
| 匹配范围 | 章节标题 + 正文纯文本（忽略 code fence 内可选：本单 **包含** fence 外正文与标题；fence 内命令可匹配，但不单独成章） |
| 空 query | 返回 `{ query: "", items: [] }`，不报错 |
| 过长 query | `ERR_HELP_QUERY_TOO_LONG`（上限 80 字符） |
| 排序 | 标题命中优先，其次正文命中次数 / 首次出现位置 |
| snippet | 纯文本片段，前后可截断；**不含 HTML**；高亮由前端完成 |
| sectionId | 与 TOC / `?section=` 稳定 id 一致（走既有 `SECTION_ALIASES`） |

响应形状（与设计一致）：

```json
{
  "ok": true,
  "data": {
    "query": "已发现表数",
    "items": [
      {
        "sectionId": "connection-overview-metrics",
        "title": "连接概览指标说明",
        "snippet": "「已发现表数」统计本地 Schema Manifest 已读到的表..."
      }
    ]
  }
}
```

### 5.2 HelpCenter UI

- 在 TOC 上方或页头下方增加搜索框，复用 `pl-whitelist-search` / `pl-whitelist-search-input` 视觉模式（或新增 `pl-help-search*`，尺寸对齐 360×38）。
- 有 query 时展示结果列表（标题 + snippet）；点击结果 → `/help?section=<sectionId>`，保留既有 scrollIntoView。
- 无结果时展示明确空态：「未找到与「…」相关的手册内容」。
- URL 可选同步：`/help?q=<keyword>` 与 `section` 可共存；清空搜索恢复完整阅读态。
- 前端对 snippet / 标题做关键词分段高亮（参考 CommandPalette），不渲染后端 HTML。

### 5.3 手册内容（可搜前提）

在 `docs/SYSTEM_HANDBOOK.md`：

1. **§0 常见问题速查** 增加一行：  
   「连接概览上的「已发现表数」是什么？」→ 链到新小节。
2. 在 **§3.2 数据库接入** 下、靠近「刷新本地目录」处新增 H4：  
   **连接概览指标说明**（alias id：`connection-overview-metrics`）。
3. 正文必须字面出现：`已发现表数`、`已启用表数`、`服务器目录已发现表`、`未启用表`，并给出对照表：

| UI 文案 | 含义 | 来源 |
|---|---|---|
| 已发现表数 / 服务器目录已发现表 | Manifest 已读入本地 Catalog 的表 | `semantic-layer/<conn>/_schema/<schema>.yaml` |
| 已启用表数 | 已纳入启用范围 | `ktx.yaml` `enabled_tables` |
| 未启用表 | 已发现但未启用 | 发现 − 启用（缺 Manifest 未知表不计） |

4. 说明：**不是**远端物理库实时表数；刷新动作是「刷新本地目录」。
5. 顺带将同段过时路径 `/connections/whitelist` 校正为 `/connections/enabled-tables`（与当前导航一致），避免搜「启用表范围」落到错误地址。

### 5.4 `SECTION_ALIASES`

在 `webui/server/help.ts` 增加：

```ts
[/连接概览指标说明/, "connection-overview-metrics"]
```

并将该 H4 纳入与「刷新本地目录」同级的 TOC 可见集合（沿用现有 DATABASE_OPS H4 allowlist 机制）。

## 6. 验收标准

1. `/help` 有可用搜索框；输入「已发现表数」至少返回 1 条，且 `sectionId=connection-overview-metrics`。
2. 点击结果跳转 `/help?section=connection-overview-metrics`，正文可见该术语解释。
3. 搜「token」仍能命中 Token / Access 相关段（回归设计验收）。
4. 空 query 不报错、结果为空；超过 80 字符返回 `ERR_HELP_QUERY_TOO_LONG`。
5. 术语标准已登记 Discovered / Enabled Count / Unenabled Tables。
6. 相关单测通过；本单不要求浏览器测试。

## 7. 测试要求

- `webui/server/__tests__/help.test.ts`：search API（命中、空 query、过长、sectionId 稳定）。
- `webui/src/__tests__/help-center.test.tsx`：搜索框渲染、结果列表、点击跳转 `section`、无结果空态；断言「已发现表数」可经 mock search 展示。
- 可选：手册内容断言（读真实 handbook fixture 或集成测）确认字面量存在。
