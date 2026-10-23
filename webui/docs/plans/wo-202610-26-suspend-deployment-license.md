# WO-202610-26 移除部署许可与激活码

| 元数据 | 内容 |
|---|---|
| 工单号 | 202610-26 |
| 标题 | 删除激活码实现，治理台去掉部署许可入口 |
| 状态 | 已实现（2026-10-18）。未重启 Docker，运行中的容器仍是旧镜像 |
| 来源 | 2026-10-18 产品决定：保持可自由使用。没有已签发环境，demo 卷也没有 `license.yaml`，因此不保留实现 |
| 来源 Spec | `webui/docs/175-suspend-deployment-license-spec.md` v0.2 |
| 撰写日期 | 2026-10-18 |
| 适用范围 | 许可模块、签发脚本、许可 API、`/admin/license`、系统手册。不改引导密钥、登录账户和数据授权 |

v0.1 的「暂停并保留代码」任务作废。代码已按 v0.2 落地。正在运行的 Docker 容器没有重建，页面和门禁要等下次升级镜像后才变。

## 目标

按 Spec 175 v0.2，删除部署许可实现。使用 Lucy 不需要激活码。MCP 和 Agent 写入不再检查许可。治理台不再提供部署许可页。

## 任务

- [x] **T1 摘掉运行时门禁。** 从 `mcp-proxy.ts`、`admission.ts`、`agents.ts` 删除许可判断。内容通道和 Agent 创建不再读取 `license.yaml` 或 `LUCY_LICENSE_MODE`。不在 `/api/health` 增加许可字段。对应 SC-2、SC-3、SC-7。

- [x] **T2 删除许可实现。** 删除 `webui/server/license/`、`webui/server/__tests__/license.test.ts`、`webui/src/pages/admin/LicenseSettings.tsx`、`webui/src/lib/license.ts`、`scripts/release/license-issue.mjs`、`scripts/release/verify-license-baseline.mjs`。`index.ts` 不再注册许可路由。启动时若存在 `.ktx-ui/license.yaml` 则删除，不备份。对应 SC-1、SC-4、SC-6。

- [x] **T3 去掉入口。** 删除主导航、命令面板和界面使用目录中的「部署许可」。`/admin/license` 进入 `/overview`。系统手册、`selector-contract.md` 和冒烟去掉激活码断言与 `/api/admin/license` 请求。对应 SC-5。

- [x] **T4 测试收口。** 更新 MCP 准入测试：设置 `LUCY_LICENSE_MODE=enforce` 时也不产生许可拒绝。更新导航和帮助中心测试。Chart 与 demo compose 不新增许可变量。跑术语检查。对应 SC-3、SC-7。

## 实现顺序

1. T1 先去掉拒绝，避免删除文件的过程中还留着半截调用。
2. T2 删除模块、脚本和意外存在的 `license.yaml`。
3. T3 去掉入口和文档断言。
4. T4 收口测试。

## 验收口径

Spec 175 §7 的 SC-1 至 SC-7。少一条不算完成。

## 验证命令

```bash
cd webui
npm run lint:terminology
npx vitest run --maxWorkers=1 \
  server/__tests__/mcp-admission-all-methods.test.ts \
  src/__tests__/navigation.test.ts \
  src/__tests__/help-center.test.tsx
```

`server/__tests__/license.test.ts` 应随模块删除，不再列入命令。

浏览器只做桌面。登录后确认侧栏和命令面板没有「部署许可」。地址栏打开 `/admin/license`，应落在 `/overview`，页面没有激活码输入框。用已有 Agent Token 调用一次当前环境允许的目录读取或 `lucy_query`，确认拒绝原因不是部署许可。

## 回滚

撤回本工单等于从版本历史恢复被删文件。不从数据卷恢复 `license.yaml`。重新引入收费许可必须新写 Spec，不在本工单中留开关。

## 风险与边界

| 风险 | 处理 |
|---|---|
| 只删页面，MCP 仍调用已删除模块 | T1 先摘调用，T2 再删目录。SC-1 同时检查引用 |
| 只跳过 `tools/call`，其他方法仍检查许可 | T1 要求全部内容通道不再调用许可函数。SC-2 覆盖 |
| 把 `license.yaml` 留在 demo 卷里 | 当前卷没有该文件。T2 对意外存在的文件做删除。SC-6 覆盖 |
| 引导密钥或数据授权被一并放开 | SC-7。本工单不修改这两处 |
