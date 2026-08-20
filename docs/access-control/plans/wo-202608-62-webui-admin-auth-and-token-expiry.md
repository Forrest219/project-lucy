# WO-202608-62：WebUI 管理员登录 + Token 失效强制

| 元数据 | 内容 |
|---|---|
| Work Order | wo-202608-62 |
| 设计 | `docs/access-control/design-webui-admin-auth.md` |
| 分支 | `cursor/webui-admin-auth-token-expiry-436b` |
| 状态 | 实施中 |

## Phase A — Token expiry

1. `identity.ts` 校验 `expires_at`
2. Token 创建规范化 date-only
3. 更新 `SYSTEM_HANDBOOK.md` FAQ / §6.5
4. 单测：过期 / 永不过期 / 非法日期

## Phase B — Auth core

1. `admins.yaml` 读写 + scrypt + session cookie
2. `/api/auth/*` + onRequest guard
3. actor 从 Session 注入
4. 单测：open / required / login / bootstrap

## Phase C — UI

1. `/login` 页 + AuthProvider 门禁
2. `/admin/admins` 管理员列表（Owner）
3. 侧栏展示当前管理员与退出
4. 术语标准登记

## Phase D — Docs index

1. 更新 `docs/access-control/README.md` 索引
2. PR 说明含 Design System / Terminology Compliance
