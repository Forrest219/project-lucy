# WO-202610-17 添加 Schema 之后读取表结构

| 元数据 | 内容 |
|---|---|
| 工单号 | 202610-17 |
| 标题 | 添加 Schema 成功步只留状态和一颗主按钮，主按钮读取表结构 |
| 状态 | 已实现。SC-1 至 SC-11 的自动化断言通过 |
| 来源 | 2026-10-12 对 `/connections` 添加 Schema 最后一步的审阅。完成、同步配置变更、上传 Schema Manifest 三颗按钮并列 |
| 来源 Spec | `webui/docs/164-add-schema-structure-next-step-spec.md` v0.1 |
| 撰写日期 | 2026-10-12 |
| 适用范围 | `AddSchemaDrawer` 成功步、连接卡片缺 Manifest 的 Schema 行、与接入向导共用的读库写入链路。不改向导步骤和上传抽屉文案 |

## 目标

按 Spec 164，普通运维加完 Schema 后看到一行已添加状态，并直接点「从数据库读取表结构」。读完进入该 Schema 的启用表范围。

## 任务

- [x] **T1 成功步。** `AddSchemaDrawer` 成功步只渲染「✓ 已添加 Schema：{name}」。按 Spec 164 §5 切换主按钮、次按钮和「完成」。去掉「同步配置变更」、Manifest 说明段，以及成功步抬头里的「下一步将先验证连接权限」。对应 SC-1、SC-2、SC-3、SC-7。

- [x] **T2 读库链路。** 主按钮调用现有 `POST /api/connections/:connId/schema-structure`，校验和写入与 `Step2UploadManifest.writeGenerated` 相同。目标已存在时不覆盖。降级字段先走 Spec 157 摘要和「继续生成」。刷新出至少一张表后关闭抽屉，打开 `/connections/enabled-tables?connection={id}&schema={schema}`。不打开接入向导，不写 `enabled_tables`。失败留在抽屉。对应 SC-4、SC-5、SC-6。

- [x] **T3 Schema 行。** 能读库且缺 Manifest 时，行内主动作改为「从数据库读取表结构」，`data-testid` 为 `read-structure-{connectionId}-{schema}`。上传 Manifest 进入「更多」。不能读库时行内仍是上传。已有 Manifest 的行不动。行内入口标题为「准备表结构」，离开按钮为「关闭」，读完去向与 T2 相同。对应 SC-8、SC-9、SC-10。

- [x] **T4 测试与索引。** 改写 `add-schema-drawer.test.tsx` 和 `connection-overview.test.tsx` 中与三按钮、说明段、缺 Manifest 行上传入口冲突的断言，覆盖 SC-1 至 SC-10。确认 `setup-assistant.test.tsx` 仍要求向导的「结束并稍后继续」。`webui/docs/README.md` 登记 Spec 164。对应 SC-11。

## 实现顺序

1. T2 先抽出向导已经在用的读取、校验、写入、刷新，避免抽屉再写一份 Manifest。
2. T1 接上这条链路。
3. T3 复用 T1 的准备动作，不从 Schema 行打开六步向导。
4. T4 收口。

## 验收口径

Spec 164 §7 的 SC-1 至 SC-11。少一条不算完成。

## 验证命令

```bash
cd webui
npm run lint:terminology
npx vitest run --maxWorkers=1 src/__tests__/add-schema-drawer.test.tsx src/__tests__/connection-overview.test.tsx src/__tests__/setup-assistant.test.tsx
```

## 回滚

回滚添加 Schema 成功步和缺 Manifest 行的入口。读库 API、上传抽屉、启用表范围页和接入向导保持原样。

## 风险与边界

| 风险 | 处理 |
|---|---|
| 抽屉再实现一套写 Manifest | T2 必须走向导同一条校验和上传。目标已存在时改为「使用已有 Schema Manifest」 |
| 读完被送进六步向导 | 成功后的地址只允许启用表范围，且带上本次连接和 Schema |
| 旧测试把三颗按钮写成规范 | T4 改测试。实现不得为了旧断言把「同步配置变更」放回成功步 |
| 向导文案被顺手改掉 | T4 用 `setup-assistant.test.tsx` 守住 Spec 157 |
