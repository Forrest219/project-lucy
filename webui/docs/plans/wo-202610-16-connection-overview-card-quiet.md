# WO-202610-16 连接概览卡片收纳

| 元数据 | 内容 |
|---|---|
| 工单号 | 202610-16 |
| 标题 | 连接概览拿掉重复运行时徽章，并把页脚五按钮收成添加 Schema 与更多 |
| 状态 | 已实现。SC-1 至 SC-12 的自动化断言通过 |
| 来源 | 2026-10-12 对 `/connections` 的审阅。四层状态在每张卡片上重复；继续向导到删除连接一排同级按钮 |
| 来源 Spec | `webui/docs/163-connection-overview-card-quiet-spec.md` v0.1 |
| 撰写日期 | 2026-10-12 |
| 适用范围 | `webui/src/pages/connections/ConnectionOverview.tsx`、连接卡片样式、`connection-overview` 与 `setup-assistant` 测试。不改 MCP 调试台组件的对外行为 |

## 目标

按 Spec 163，让 `/connections` 在 20 个库时不再重复 80 个运行时徽章，也不再把删除连接和添加 Schema 排成同级按钮。问数进程只有在未加载或不可用时，于列表上方提示一次。

## 任务

- [x] **T1 拿掉卡片运行时。** 连接概览不再渲染 `McpRuntimeStatusPanel`，不再调用 `POST /api/admin/mcp-runtime/canary`。`McpRuntimeStatusPanel` 仍由 MCP 调试台使用。对应 SC-1、SC-12。

- [x] **T2 列表提示。** 指标卡与连接列表之间按 Spec 163 §6 的伪代码渲染至多一条提示。`unknown` 与 `ok` 不提示。状态请求失败时不挡卡片。链接到 `/admin/mcp-playground`，文案为「打开 MCP 调试台」。对应 SC-8 至 SC-11。

- [x] **T3 抬头操作。** 去掉灰底页脚里的五按钮。抬头右侧只留「添加 Schema」和「更多」。步骤小于 6 时，「接入进度 · 第 n 步」可点击并打开向导，`aria-label` 为「继续向导，接入进度 · 第 n 步」，`data-testid` 为 `resume-assistant-{id}`。不再单独渲染「继续向导」按钮和 `connection-assistant-banner-*`。对应 SC-2、SC-3、SC-4。

- [x] **T4 更多菜单。** 菜单顺序和可见说明按 Spec 163 §5。重新拉取库内目录、刷新本地目录、删除连接沿用现有 testid 与现有处理函数。删除连接使用危险色文字，确认仍走 `DeleteConnectionDrawer`。配置同步进行中或失败的状态句留在表下，不放进工具栏。对应 SC-5、SC-6、SC-7。

- [x] **T5 测试与索引。** 改写 `connection-overview.test.tsx` 里锁定页脚五按钮和卡片四层徽章的用例，覆盖 SC-1 至 SC-11。改写 `setup-assistant.test.tsx` 对「继续向导」可见文案的断言。确认 `mcp-playground.test.tsx` 仍要求调试台徽章。`webui/docs/README.md` 中 Spec 163 改为已实现。

## 实现顺序

1. T1 与 T2 一起做，避免徽章去掉后待确认状态没有任何替代、或反过来又在每张卡片上长出来。
2. T3 与 T4 一起做，页脚和抬头不要同时留下两套操作。
3. T5 收口。

## 验收口径

Spec 163 §7 的 SC-1 至 SC-12。少一条不算完成。

## 验证命令

```bash
cd webui
npm run lint:terminology
npx vitest run --maxWorkers=1 src/__tests__/connection-overview.test.tsx src/__tests__/setup-assistant.test.tsx src/__tests__/mcp-playground.test.tsx
```

## 回滚

界面改动集中在连接概览。回滚该页后，调试台、删除 API、目录刷新 API 和接入向导步骤推导保持原样。

## 风险与边界

| 风险 | 处理 |
|---|---|
| 旧测试把五颗 secondary 按钮写成规范 | T5 改测试。实现不得为了让旧断言通过而把按钮放回页脚 |
| 「刷新本地目录」与上传抽屉里的「同步配置变更」暂时并存 | 本工单只改卡片手动刷新。上传抽屉保持 Spec 73 |
| 状态接口较慢 | 加载完成前不显示问数提示，避免先闪一条再消失 |
