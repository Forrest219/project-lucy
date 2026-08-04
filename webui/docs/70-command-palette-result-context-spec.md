# Command Palette Result Context Spec

| 字段 | 内容 |
| --- | --- |
| Spec 编号 | 70 |
| 关联工单 | `webui/docs/plans/wo-M63-command-palette-result-context.md` |
| 关联台账 | `docs/ui-ux-feedback/pages/global-shell.md` `UX-GLOBAL-SHELL-007` |
| 状态 | Draft |
| 日期 | 2026-08-03 |
| 范围 | WebUI 全局命令面板搜索结果 |

## 1. 背景

M60 / M61 已将侧栏搜索入口升级为全局命令面板，并修复了空态倾倒导航列表、路径视觉噪声和空 Enter 隐式跳转问题。后续用户对比 Kaelio docs 搜索结果后指出：Lucy WebUI 当前搜索结果仍像“导航菜单”，缺少搜索结果应有的命中上下文。

对比结论：

- Kaelio docs 搜索结果展示 breadcrumb、页面标题、命中标题、正文片段和代码片段，用户能理解“为什么搜到它”。
- Lucy WebUI 搜索 `语义` 时只展示分组与页面名，右侧重复分组名，用户只能知道“这是一个入口”，不知道页面用途、命中原因或结果优先级。

## 2. 目标

1. 将命令面板结果从导航项升级为页面搜索结果。
2. 为每个结果提供 breadcrumb、标题、说明和可选 route hint。
3. 高亮命中词，解释匹配原因。
4. 建立稳定排序：直接页面标题命中优先，其次 keywords / description，最后 group。
5. 保持 M61 的空态、结果上限、键盘交互和 URL 降噪不回归。

## 3. 非目标

- 不做全文文档搜索。
- 不搜索业务 Wiki 文档正文、Catalog 对象、Schema / Table 实例。
- 不引入远端搜索服务或后端 API。
- 不改变现有路由结构。
- 不做移动窄屏专项验证，除非任务另行要求。

## 4. 数据模型

扩展 `webui/src/app/navigation.ts` 中的导航数据。

### 4.1 NavItem 扩展

新增可选字段：

```ts
type NavItem = {
  id: string;
  label: string;
  to: string;
  iconKey: NavIconKey;
  active: (pathname: string) => boolean;
  description?: string;
  keywords?: string[];
};
```

字段含义：

- `description`: 面向用户的一句页面用途说明，显示在命令面板结果第三行。
- `keywords`: 不一定在 label 中出现、但用户可能搜索的短词，例如 `指标`、`权限`、`审计`、`Wiki`。

### 4.2 CommandEntry 扩展

`webui/src/components/CommandPalette.tsx` 内部 entry 应包含：

```ts
type CommandEntry = {
  id: string;
  groupTitle: string;
  label: string;
  to: string;
  breadcrumb: string[];
  description: string;
  keywords: string[];
};
```

`breadcrumb` 建议为：

- 顶层系统概览：`["Lucy WebUI"]`
- 分组子项：`["Lucy WebUI", group.title]`

## 5. 搜索匹配与排序

### 5.1 归一化

继续使用 trim + lower-case。中文不做分词，保持 substring match。

### 5.2 匹配字段

查询词应匹配：

1. `label`
2. `keywords`
3. `description`
4. `groupTitle`
5. `to`

`to` 只参与匹配，不作为结果主视觉。

### 5.3 排序分数

建议使用简单稳定分数，不引入搜索库：

| 命中位置 | 分数 |
| --- | ---: |
| label startsWith query | 100 |
| label includes query | 90 |
| keyword exact / includes query | 75 |
| description includes query | 55 |
| groupTitle includes query | 40 |
| route includes query | 20 |

排序规则：

1. 分数高者优先。
2. 分数相同保持 `topLevelEntry + navGroups` 原始 IA 顺序。
3. 结果继续最多显示 7 条。

## 6. 视觉设计

### 6.1 面板结构

命令面板保留 M61 的 overlay、输入框、ESC keycap 和空态。查询后结果区应与输入区形成连续搜索面板：

- 输入区与结果区之间用 `1px` subtle border 分隔。
- 结果区 padding 收敛，避免大块空白。
- 结果列表最多 7 条。
- 每条结果高度建议 72-88px。

### 6.2 结果行结构

每条结果：

```text
Lucy WebUI > 语义建模
语义资产                         /catalog
维护 Connection / Schema / Table 的语义资产、字段、指标和发布前审阅。
```

规则：

- breadcrumb 小号 muted。
- title 为主视觉，14-16px semibold。
- description 为 12-13px muted，最多 1 行，超出截断。
- route hint 可放右侧或标题行右侧，12px muted monospace；不得抢占主视觉。
- active state 是整条结果卡片的弱底，不再只是单行 label 背景。

### 6.3 命中高亮

对 label、description、breadcrumb 中命中的 substring 使用高亮样式：

- 不改变布局高度。
- 不使用刺眼品牌大色块。
- 建议 `font-medium` + brand text color 或 subtle underline。
- route hint 可不高亮。

## 7. 文案建议

初始空态：

```text
搜索页面、流程或配置对象
```

无结果：

```text
未找到匹配入口
试试 Connection、发布、评测、角色
```

Result descriptions 建议：

| Entry | Description |
| --- | --- |
| 系统概览 | 查看 Lucy MCP、语义资产与 Agent 接入的健康状态和待处理事项。 |
| 连接概览 | 维护每个 Connection 的 Schema、Manifest 和本地目录刷新状态。 |
| 启用表范围 | 配置 Agent 可访问的表范围，并审阅保存前 YAML 变更。 |
| 语义资产 | 维护表级语义资产、字段、指标、分群和发布前审阅。 |
| 业务 Wiki | 管理业务 Markdown 文档、目录、版本记录和恢复流程。 |
| 发布工作台 | 审阅待发布语义变更，执行校验、导出和发布前检查。 |
| 发布记录 | 查看语义发布历史、归档状态和最近交付记录。 |
| 评测用例 | 维护质量评测用例和 YAML 交换入口。 |
| 运行历史 | 查看评测运行记录、结果详情和失败诊断。 |
| 趋势监控 | 观察近 30 天评测趋势、缺口和质量基线。 |
| Agent 实例 | 管理 Agent、Token、最近访问和权限预览入口。 |
| 角色权限 | 管理 Role、参考模板、MCP 工具范围和待修复状态。 |
| 访问日志 | 查看 ACL 判定、访问审计和风险排查记录。 |
| 配置审计 | 审阅配置变更、发布影响和治理证据。 |

## 8. 测试要求

### 8.1 Unit / Component Tests

更新 `webui/src/__tests__/command-palette.test.tsx`：

- 空态仍不展示 options。
- 空 Enter 仍不导航。
- 查询 `语义` 时结果包含 breadcrumb、title、description。
- `语义资产` 排在 `业务 Wiki` 之前，因为 label 直接命中优先。
- 结果中存在高亮节点，例如 `.pl-command-palette-highlight`。
- 结果不再用大号右侧 group label 作为主视觉。
- route hint 如果存在，使用 muted / monospace class，并带 `translate="no"`。

### 8.2 Navigation Data Tests

更新 `webui/src/__tests__/navigation.test.ts`：

- 每个 `topLevelEntry` / `navGroups[*].items[*]` 都有非空 `description`。
- `keywords` 可选，但如果存在则不能包含空字符串。

### 8.3 Verification Commands

```bash
cd /Users/zhangxingchen/Projects/project-lucy/webui
npm run lint:terminology
npm test -- src/__tests__/command-palette.test.tsx src/__tests__/navigation.test.ts src/__tests__/app-shell.test.tsx
npm run build
git diff --check
```

## 9. 浏览器验收

Docker 重建后执行：

1. 打开 `http://127.0.0.1:55176/overview`。
2. 打开命令面板。
3. 输入 `语义`。
4. 确认结果展示 breadcrumb、页面标题、说明。
5. 确认命中词高亮。
6. 确认 `语义资产` 排在直接相关结果前列。
7. 确认右侧不再重复大号 `语义建模` / `语义发布`。
8. 用键盘 ArrowDown / Enter 选择结果，确认仍正确导航。

## 10. 风险与边界

- Description 过长会压缩结果密度；必须单行截断。
- 高亮实现不能使用 `dangerouslySetInnerHTML`。
- Search metadata 与 Help Center 导航表可能产生重复维护；本轮只让 navigation.ts 成为命令面板搜索源。
- 保持路径和英文技术词的翻译防御，尤其 route hint、Connection、Schema、Table、Agent、MCP。
