# Connection Create — Secret Write Spike (Phase A)

| 元数据 | 内容 |
|---|---|
| 文档名称 | Connection Create Secret Write Spike |
| 文档类型 | Plan / Verification |
| 版本 | v1.0 |
| 撰写日期 | 2026-08-20 |
| 基于材料 | Spec 124（设计分支）；产品批准 Phase A 独立验证分支 |
| 输出位置 | `webui/docs/plans/wo-202608-58a-connection-create-secret-write-spike.md` |
| 状态 | Implemented（API + 安全单测；无 UI） |

## Scope（本分支）

- `safeWriteNewSecretPassword` / `safeRemoveSecretPasswordIfExists`：仅允许 `.ktx/secrets/<connId>-password`
- `createConnection()` + `POST /api/connections`（默认 `dryRun:true`）
- connection test 失败 → yaml + secret **整单回滚**
- 通用 `safeWrite` / `assertReadable` 对 `.ktx/secrets/**` 仍拒绝

## Out of Scope

- CreateConnectionDrawer / Overview CTA
- Spec 26 / handbook FAQ 翻转
- WebUI Auth、编辑/删除连接

## Automated checks

```bash
cd webui
npx vitest run \
  server/__tests__/fs-safe.secret-password.test.ts \
  server/__tests__/project.create-connection.test.ts \
  server/__tests__/api.create-connection.test.ts \
  server/__tests__/fs-safe.test.ts
```

## Manual security verification checklist

1. **dryRun 默认**：`POST /api/connections` 不带 `dryRun:false` → 不落盘 secret、不改 `ktx.yaml`；响应无明文密码。
2. **成功路径**：`dryRun:false` + mock/真 `ktx connection test` 成功 → 出现 `.ktx/secrets/<id>-password`（建议 `0600`），`ktx.yaml` 仅 `file:` 引用。
3. **测试失败回滚**：故意错误密码 → HTTP 非 2xx、`CONNECTION_TEST_FAILED`；无残留 secret；`ktx.yaml` 恢复原样。
4. **拒绝覆盖**：预置同名 secret 文件 → `SECRET_ALREADY_EXISTS`（409）；yaml 不变。
5. **拒绝覆盖连接**：已有 `connId` → `CONNECTION_ALREADY_EXISTS`（409）。
6. **通用 fs-safe 仍 DENY**：`safeWrite(project, ".ktx/secrets/…")` 与 `assertReadable` 仍 403。
7. **路径攻击**：含 `..`、非法文件名、symlink secrets 目录 → 拒绝写入。

## API sketch

```http
POST /api/connections
Content-Type: application/json

{
  "id": "demo-mysql",
  "driver": "mysql",
  "host": "db.internal",
  "port": 3306,
  "database": "analytics",
  "username": "lucy_ro",
  "password": "<once>",
  "schemas": ["analytics"],
  "dryRun": false
}
```
