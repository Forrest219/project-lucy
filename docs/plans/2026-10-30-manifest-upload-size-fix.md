# Manifest 上传容量修复实施计划

**状态：** 用户于 2026-10-30 批准，按本会话继续实施。

**目标：** 完整导入约 1.16 MiB 的 Schema Manifest，统一 Lucy 资产文件与 HTTP 容量检查。

**架构：** 复用 `webui/server/semantic-limits.ts`，单 YAML 上限为 8 MiB；只有实际携带 YAML 或 ZIP 内容的三条资产路由使用 32 MiB 请求体上限。发布和批量校验请求只携带引用，维持默认限制。KTX 与生产数据库均不变。

**技术：** TypeScript、Fastify、Vitest；API 与临时文件验证，不做浏览器测试。

## 实施步骤

1. 在 `webui/server/__tests__/api.catalog-assets.test.ts` 补大 Manifest 上传、UTF-8 文件边界与 HTTP 边界回归；在语义资产测试补大文件及 ZIP 通道回归。先复现失败。
2. 修改 `semantic-limits.ts`，把 `maxSingleYamlBytes` 提升为 8 MiB；`catalog-assets.ts` 读取共享值，删除独立限额。对仍使用独立容量常量的资产导出服务同步引用共享值并按单 YAML 自检。
3. 修改 `index.ts` 的目录 Manifest validate/upload、semantic-assets validate 三条路由，显式设置共享 HTTP 上限；按 UTF-8 字节检查 JSON 大小，大小错误返回中文且保留错误码。
4. 更新容量契约 Spec、API 说明与既有容量断言，执行相关 API、导入导出与共享限额测试，以及术语 lint。
5. 在临时项目用本次两个真实 Manifest 验证校验、上传落盘和目录可见性，记录表/字段数；原始生产元数据不进入 Git。

## 核心流程（伪代码）

```text
指定资产内容路由：bodyLimit = shared.maxHttpBodyBytes
请求原始字节超限 -> HTTP 413 + 中文错误，不执行处理函数
每份 YAML 的 UTF-8 字节数超限 -> 既有文件错误码，不写入
通过容量检查 -> 既有 Schema、类型、路径、覆盖确认与审计检查
成功 -> 既有落盘和本地目录刷新
导出：采用相同单文件/总量上限，超限明确拒绝
```

## 验收与范围

- 8 MiB 文件边界可进入业务校验；多 1 字节拒绝，中文按字节计。
- 32 MiB 请求边界到达处理函数；多 1 字节返回中文 413；无关路由仍保持默认 1 MiB。
- 两个真实文件完整保留 `ads` 的 3 个对象/44 个字段与 `ods_db` 的 298 个对象/6,449 个字段。
- 原有路径安全、覆盖确认、包导入导出及相关服务回归通过。
- 现有 200 张表批量选择上限不变；此次不执行远端部署、发版、镜像构建或产品升版。

## Terminology Compliance

遵循 `webui/docs/00-product-terminology-standard.md`，新增产品术语：无。仅调整服务端错误文案，无 UI 视觉或交互变更。

## 本地验证记录

- 6 个相关测试文件、111 项测试通过，包括大文件校验/落盘、HTTP 与单 YAML 边界、普通接口原有限制、原有路径安全/覆盖确认、ZIP 及维护包往返。
- 两份实际 Manifest 在临时项目完成 API 校验、上传与目录刷新；写入内容逐字节相同，目录包含 301 个对象、6,493 个字段。没有连接或修改远端实例与生产数据库。
- 术语检查通过；`git diff --check` 通过。
- 全项目 `tsc --noEmit` 尚未通过：当前与隔离 HEAD 基线均有 73 条已有类型错误，规范化文件路径与行号后逐项一致，没有新增类型错误。此记录不把既有失败视为通过。
- 本地过程证据保存在 `inbox/starrocks-production-manifests-20261030/`；生产元数据不提交 Git。代码、测试和契约文档同批提交；未构建客户镜像或执行远端升级。
