# 移除部署许可与激活码

| 元数据 | 内容 |
|---|---|
| 文档名称 | 移除部署许可与激活码 |
| 文档类型 | Product / Runtime Spec |
| Spec 编号 | 175 |
| 版本 | v0.2 |
| 撰写日期 | 2026-10-18 |
| 委托人 | xingchen |
| 状态 | **已批准（2026-10-18，xingchen）**。v0.2 改为删除实现。本文件不包含实现 |
| 适用范围 | 部署许可运行时门禁、许可 API、治理台页面、签发脚本、导航与系统手册 |
| 关联工单 | `webui/docs/plans/wo-202610-26-suspend-deployment-license.md` |
| 上游 | [`docs/licensing/design-deployment-license.md`](../../docs/licensing/design-deployment-license.md)（设计归档，不再指导交付）、企业安全 Spec §3.3 与 SEC-15 |

### Changelog

| 版本 | 变更 |
|---|---|
| v0.2 | 不保留许可代码、签发脚本和 `license.yaml`。当前没有已签发的客户环境；正在运行的 demo 卷里也没有该文件 |
| v0.1 | 曾规定暂停门禁并保留实现，便于以后用开关恢复。该方案作废 |

## 1. 问题

部署许可用来做私有化收费：厂商离线签发激活码，所有者在治理台输入，`LUCY_LICENSE_MODE=enforce` 时限制 MCP 数据调用和 Agent 席位。

产品决定保持可自由使用。没有已签发的客户环境。2026-10-18 检查正在运行的 demo 卷 `compose_lucy-demo-data`，`.ktx-ui/` 下没有 `license.yaml`。因此不需要把编解码、签发脚本或许可文件留在仓库里当恢复开关。

## 2. 目标

1. 使用 Lucy 不需要激活码。MCP 内容通道和 Agent 创建不再读取部署许可。
2. 删除许可实现：服务端模块、管理 API、治理台页面、前端许可客户端、签发脚本和签发基线检查。
3. 导航、命令面板、系统手册和选择器契约不再出现「部署许可」或「激活码」。
4. 若某个数据卷上仍有 `.ktx-ui/license.yaml`，启动时删除该文件。不迁移、不备份进产品数据。

## 3. 非目标

- 不改变一次性引导密钥、登录账户、Agent Token 或数据授权。
- 不新增替代的注册码、在线 License Server 或席位上限。
- 不清理历史审计里已经写过的 `license_missing`、`license_expired` 或 `license_activate`。这些记录留在审计库，只是以后不会再新增。
- 不在本 Spec 中改代码。
- 许可设计文档保留为归档，标明不再指导交付。恢复收费必须新写 Spec，不从已删除代码里找开关。

## 4. 修订关系

| 原规定 | 本 Spec 之后 |
|---|---|
| 许可设计 G1–G3：签发、激活、`enforce` 拒绝 | 作废。实现删除 |
| 许可设计 §7：`LUCY_LICENSE_MODE` 选择 `off` / `warn` / `enforce` | 变量不再被读取。Chart 与 compose 不设置它 |
| 企业安全 Spec §3.3：各 MCP 内容通道执行许可裁决 | 删除该裁决。Bearer、吊销、过期、Agent enabled 与角色解析保持 |
| 企业安全 Spec SEC-15：inactive / expired / invalid 列入内容通道拒绝分母 | 从当前分母去掉。将来若新 Spec 恢复许可，再单独定义一致性 |
| 术语标准中的部署许可、激活码、Agent 席位 | 词条改为历史对照，产品界面和用户可见错误不再使用 |

## 核心流程（伪代码）

```text
admitMcp(request):
  verify bearer, revocation, expiry, agent enabled, role
  # 不再调用 loadLicenseSnapshot 或 assertLicenseAllowsMcp
  continue object ACL and data ACL

createOrEnableAgent(request):
  existing admin auth and ACL validation
  # 不再调用 enforceAgentSeatLimit
  write access.yaml

startup():
  if exists(.ktx-ui/license.yaml):
    delete the file
    do not copy it elsewhere
  do not read LUCY_LICENSE_MODE
  do not read LUCY_LICENSE_VERIFY_SECRET
  health does not grow a license field

GET or POST /api/admin/license:
  route removed
  no LICENSE_SUSPENDED body

GET /admin/license:
  navigate to /overview
  do not render an activation form
```

删除范围：

| 删除 | 保留并摘掉许可调用 |
|---|---|
| `webui/server/license/` | `webui/server/index.ts` 的路由注册 |
| `webui/server/__tests__/license.test.ts` | `webui/server/proxy/mcp-proxy.ts` |
| `webui/src/pages/admin/LicenseSettings.tsx` | `webui/server/proxy/admission.ts` |
| `webui/src/lib/license.ts` | `webui/server/admin/agents.ts` |
| `scripts/release/license-issue.mjs` | `webui/server/admin/ui-usage.ts` 的页面目录项 |
| `scripts/release/verify-license-baseline.mjs` | 导航、路由、系统手册、帮助中心测试、冒烟 |

## 5. 管理台

- 主导航和命令面板去掉「部署许可」，包括关键词「激活码」「License」「席位」「付费」。
- 删除 `/admin/license` 页面。直接打开该路径时进入 `/overview`。
- 系统手册的系统设置表去掉「部署许可」行。
- `docs/qa/selector-contract.md` 去掉 `license-*` 选择器。
- 冒烟不再请求 `/api/admin/license`，也不再断言激活码区域可见。只覆盖该页的用例删除，并改其上游清单。

## 6. 部署与数据

- 客户 Chart 与 demo compose 不设置 `LUCY_LICENSE_MODE` 或 `LUCY_LICENSE_VERIFY_SECRET`。
- 不增加 Helm values 来打开许可。
- 已知数据卷没有 `license.yaml`。启动删除只覆盖「文件意外存在」这一种情况，避免旧字符串留在卷里。
- 交付材料不把激活码列为使用前提。

## 7. 验收

- SC-1 仓库中不再存在 `webui/server/license/`、`scripts/release/license-issue.mjs`、`scripts/release/verify-license-baseline.mjs`、`LicenseSettings.tsx`、`webui/src/lib/license.ts`。MCP 与 Agent 写入路径不再引用这些模块。
- SC-2 未设置任何许可变量时，MCP 内容通道不返回 `license_missing` 或 `license_expired`。Bearer 无效仍是 401。创建 Agent 不返回 `LICENSE_REQUIRED` 或 `LICENSE_SEAT_LIMIT`。
- SC-3 进程环境仍带有 `LUCY_LICENSE_MODE=enforce` 时，行为与 SC-2 相同，进程可以启动。
- SC-4 `GET` 与 `POST /api/admin/license` 都不是许可 API。没有 200 的许可快照，也没有激活写入。
- SC-5 侧栏、命令面板和系统手册没有「部署许可」。访问 `/admin/license` 后地址为 `/overview`，页面没有激活码输入框。
- SC-6 数据卷上若放置一份 `.ktx-ui/license.yaml`，进程启动后该文件不存在。当前 demo 卷本来没有该文件，升级后仍然没有。
- SC-7 数据授权拒绝、引导密钥和登录账户行为与本 Spec 实施前一致。`/api/health` 不新增许可字段。

## Terminology Compliance

This feature follows `webui/docs/00-product-terminology-standard.md`.

New terms:
- None

Removed from the product:
- 「部署许可」「激活码」「Agent 席位」不再出现在导航、页面、系统手册或用户可见错误中。
- 不使用「授权码」「License Key」，也不把激活码称为 Token。

## Design System Compliance

引用 `webui/docs/design-system/20-patterns-page-layout.md` 的既有导航与页面跳转。本次删除一个设置页，并把旧路径送到 `/overview`。不新增按钮、颜色、网格或空状态。
