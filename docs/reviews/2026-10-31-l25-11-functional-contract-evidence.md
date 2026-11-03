# L25-11 功能合同收口证据

日期：2026-10-31

2026-10-31 用户批准拆分，L25-11 关闭。本条出口是 FC-01–FC-32。`SEM25` 留在 E2E Spec，未执行，不回开本条。V01–V22 矩阵行不改成通过。G30 仍开。不关闭 G31，不打开 W-B。本条关闭不表示可上线。

命令（仓库 `webui/`）：

```bash
npx vitest run --maxWorkers=1 \
  server/__tests__/semantic-batch-identity.test.ts \
  server/__tests__/semantic-batch-package.test.ts \
  server/__tests__/semantic-batch-scope.test.ts \
  server/__tests__/semantic-batch-checks.test.ts \
  server/__tests__/semantic-batch-tasks.test.ts \
  server/__tests__/semantic-batch-idempotency-audit.test.ts \
  server/__tests__/semantic-batch-mirror-failure.test.ts \
  server/__tests__/semantic-batch-recovery.test.ts \
  server/__tests__/semantic-batch-journal-lifecycle.test.ts \
  server/__tests__/semantic-release-restore-contract.test.ts \
  server/__tests__/publish-coordinator.test.ts \
  server/__tests__/paths.test.ts \
  server/__tests__/api.semantic-batch.test.ts \
  server/__tests__/semantic-batch-functional-contract.test.ts \
  src/__tests__/catalog.test.tsx
```

结果：15 个文件，226 passed。随后为 FC-27 补了「同一 release、新 attempt」断言，并重跑：

```bash
npx vitest run --maxWorkers=1 \
  server/__tests__/semantic-release-restore-contract.test.ts -t "retries the index"
```

结果：1 passed。

## 本轮补上的直接检查

| 编号 | 检查 |
|---|---|
| FC-02 | 同一连接的 `public.orders` 与 `archive.orders` 解析成两个身份 |
| FC-05 | 筛选后的「选择全部筛选结果」只计入筛选命中；服务端 scope 保存全部提交身份 |
| FC-06 | 筛选变化后选择清空，批量下载与批量校验不可用 |
| FC-07 | 导出未启用表之后 `enabled_tables` 不变 |
| FC-12 | 未修改的无 overlay 模板导回为 `no_change`，不创建 overlay |
| FC-13 | 计划同时列出本次候选和无关待同步变更；空 diff 不写发布记录、不调用索引 |
| FC-16 | HTTP 导入拒绝含 `..` 的包，正式文件不变 |
| FC-19 | 任务超时后哨兵文件字节不变 |
| FC-22 | 卸载模块后从磁盘重放同一 `releaseId`。不是已部署进程上的强杀 |
| FC-27 | 索引失败保留已保存文件且生效状态为待确认；重试沿用原 release、终态审计使用新 attempt、不重写内容 |
| FC-28 | 发布窗口持有时，单表保存、Manifest 上传、批量导入、角色保存都是 `PUBLISH_COORDINATOR_BUSY` |
| FC-29 | 未登录和失效会话在 scope、校验、导出、导入、发布五个入口返回 401 `AUTH_REQUIRED`；另一操作者导出和校验返回 409 |
| FC-31 | 默认目录、相对定制目录和 `LUCY_CONTENT_ROOT=.` 都落在临时项目内 |
| FC-32 | 同一非法列类型使单表校验、批量校验和导入预检失败；发布终检调用 `runSemanticTableCheck` |

FC-01、FC-03、FC-04、FC-08–FC-11、FC-14、FC-15、FC-17、FC-18、FC-20、FC-21、FC-23–FC-26、FC-30 沿用上表命令里已经通过的原有检查。

## 没有改成通过的事项

`SEM25-V01`…`SEM25-V22` 未执行。V01–V22 矩阵行未执行。G30 仍开：批量校验只返回报告，不产出可发布计划。不关闭 G31，不打开 W-B。Wave 0b 与客户交付仍是 `blocked_delivery`。本条收口不表示可上线。
