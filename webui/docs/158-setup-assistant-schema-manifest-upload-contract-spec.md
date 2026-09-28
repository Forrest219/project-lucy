# 接入向导：Schema Manifest 上传走已有接口

| 元数据 | 内容 |
|---|---|
| 文档名称 | 接入向导：Schema Manifest 上传走已有接口 |
| 文档类型 | Spec |
| 版本 | v0.1 |
| 撰写日期 | 2026-09-28 |
| 撰写人 | Cursor |
| 委托人 | xingchen |
| 基于材料 | 2026-09-28 缺陷报告（`POST /api/catalog/assets` 与 `assetKind: "manifest"`）；对 `http://127.0.0.1:55176` 的只读路由探测；`Step2UploadManifest.tsx`、`Step4SemanticOverlay.tsx`、`webui/src/lib/catalog-assets.ts`、`webui/server/catalog-assets.ts`；Spec 31 / 114 / 130 / 157；`webui/docs/00-product-terminology-standard.md` |
| 适用范围 | `/connections` 接入向导第 2 步 Schema Manifest 上传，以及第 4 步不再提交表级 YAML |
| 输出位置 | `webui/docs/158-setup-assistant-schema-manifest-upload-contract-spec.md` |

| 字段 | 内容 |
|---|---|
| Spec 编号 | 158 |
| 关联页面 | `/connections` 上的接入向导 |
| 上游 Spec | Spec 130（接入向导）；Spec 31（Schema Manifest 主入口在 `/connections`，表级 YAML 不在此页）；Spec 114（表详情导入 YAML）；Spec 157（无现成 YAML 的选表路径，已批准） |
| 状态 | Implemented（Gate B 已批准，2026-09-28） |
| 日期 | 2026-09-28 |
| 范围 | 让已有 Schema Manifest 的上传走 `POST /api/catalog/assets/upload`；覆盖确认、校验错误与目录刷新；向导内停止提交 semantic overlay |

本文件只修正向导与现有上传接口的契约。Spec 157 的「从数据库读取表结构」仍以该 Spec 为准；它的「我已有 Schema Manifest」必须按本文写入。

Gate B（2026-09-28）同时批准本文件与 Spec 157。入口文案、按钮层级和流程状态以 Spec 157 v0.3 为准；`confirmOverwrite`、`assetKind: "schema_manifest"` 与校验错误以本文为准。第 2 步 ghost 使用「结束并稍后继续」，不再保留「稍后上传 Schema Manifest」。第 4 步默认文案为「暂不补充业务语义，使用数据库字段信息继续」。

## 1. 当前失败

第 2 步把有效的 Schema Manifest 提交到不存在的路由，并使用后端不接受的 `assetKind`。YAML 内容不是失败原因。

`Step2UploadManifest.tsx` 当前请求：

```text
POST /api/catalog/assets
{ connectionId, schema, assetKind: "manifest", filename, content }
```

已注册的受控上传只有：

| 方法与路径 | 用途 |
|---|---|
| `POST /api/catalog/assets/validate` | 校验，不写文件 |
| `POST /api/catalog/assets/upload` | 校验通过后写入 `semantic-layer/<connection>/_schema/<schema>.yaml` |
| `GET /api/catalog/assets/uploads` | 读取上传记录 |
| `GET /api/catalog/assets/schema-manifest` | 读取已有 Schema Manifest |

`CatalogAssetKind` 只有 `schema_manifest`。兼容字段是 `assetType: "schemaManifest"`。2026-09-28 对运行实例的只读探测：

| 请求 | 结果 |
|---|---|
| `POST /api/catalog/assets` | 404，`Route POST /api/catalog/assets not found` |
| 校验 `assetKind: "manifest"` | `ASSET_KIND_UNSUPPORTED` |
| 校验 `assetKind: "schema_manifest"` | 通过；目标路径由服务端计算 |
| 校验 `assetKind: "semantic_overlay"` | `ASSET_KIND_ROUTE_MISMATCH` |
| 空请求体上传 | 400，`ASSET_KIND_REQUIRED` |

目标文件已存在且未带 `confirmOverwrite: true` 时，上传返回 409，`TARGET_EXISTS`。连接概览的 `CatalogAssetUploadDrawer` 已按此契约实现。向导直接调用通用 `apiPost`，绕过了 `CatalogAssetUploadRequest`。

成功回调丢掉响应，只把步骤改成 3，也不刷新 `project`、`connections`、`sources`、Catalog reload 与上传记录。因此即使路由改对，向导仍不会显示解析表数，连接概览的 Manifest 状态也可能仍是旧的。

第 4 步高级模式调用同一个不存在的路由，并发送 `assetKind: "semantic_overlay"`。基础模式不发请求。单元测试没有点击第 2 步上传；Playwright 黄金路径拦截 `POST /api/catalog/assets` 并返回成功，未匹配的 `/api/**` 也返回 `{ ok: true }`，所以错误契约被测成通过。

## 2. 目标

1. 第 2 步只通过 `validateCatalogAsset()` 与 `uploadCatalogAsset()` 提交 Schema Manifest。
2. 请求体 `assetKind` 固定为 `schema_manifest`。不发送 `manifest`、`semantic_overlay` 或 `asset_package`。
3. 目标路径仍只由服务端计算。客户端 `filename` 只作为原始文件名。
4. 校验失败停在第 2 步，展示服务端 `errors` 的 `message`。不出现路由 404。
5. 目标文件已存在时，先确认覆盖，再带 `confirmOverwrite: true` 上传。
6. 上传成功后展示解析表数，刷新与 `CatalogAssetUploadDrawer` 相同的查询，然后进入第 3 步。
7. 第 4 步不再上传表级 YAML。基础字段语义继续进入第 5 步。
8. 向导测试只认可 `/api/catalog/assets/upload` 与 `schema_manifest`。未知 `/api/**` 不得被 mock 成成功。

## 3. Non-Goals

- 不新增 Catalog Asset 路由，不扩大 `CatalogAssetKind`。
- 不把 semantic overlay 写入 `/api/catalog/assets/upload`。
- 不在向导内调用 `POST /api/sources/:conn/:schema/:table/import` 或 `POST /api/semantic-assets/publish`。
- 不实现 Spec 157 的读库主按钮、空步骤关闭和「结束并稍后在连接概览继续」。
- 不改连接概览抽屉、表详情导入 YAML、语义资产发布的现有行为。
- 不改第 1、3、5、6 步的既有门禁。

## 4. 第 2 步

复用连接概览已有的校验与上传函数。向导不另写 URL。

| 时机 | 动作 |
|---|---|
| 内容为空 | 不请求。主按钮禁用 |
| 内容、连接、Schema 或文件名变化 | 调用 `POST /api/catalog/assets/validate` |
| `valid=false` | 停在第 2 步，列出 `errors[].message`。主按钮不可上传 |
| `valid=true` 且 `exists=false` | 允许上传 |
| `valid=true` 且 `exists=true` | 显示「确认覆盖现有 YAML」。未勾选时不可上传 |
| 点击上传 | `POST /api/catalog/assets/upload`。仅覆盖分支带 `confirmOverwrite: true` |
| 上传返回 409 | 停在第 2 步，展示服务端「目标 YAML 已存在，请确认覆盖后重试。」并露出覆盖确认 |
| 上传成功 | 显示「已解析 N 张表」，N 取 `validation.tables`。进入第 3 步 |

成功后失效的查询与 `CatalogAssetUploadDrawer` 相同：`catalogReloads`、`catalogAssetUploads`、`project`、`connections`、`sources`，以及该连接的 `connectionTables`。

请求体：

```ts
{
  connectionId,
  schema,
  assetKind: "schema_manifest",
  filename,
  content,
  confirmOverwrite // 仅当用户确认覆盖时为 true
}
```

文件名、目标路径、`Schema`、`Schema Manifest` 的 DOM 节点保持 `translate="no"` 与 `notranslate`。展开上传时，上传是该面板里唯一 primary。第 2 步的 ghost 是 Spec 157 的「结束并稍后继续」。覆盖确认、`schema_manifest` 与校验错误仍以本文为准。

## 5. 第 4 步

表级 YAML 的入口仍在表目录、表详情「导入 YAML」和「上传语义资产」。向导位于 `/connections`，不新增第三条写入入口。

| 模式 | 行为 |
|---|---|
| 基础模式 | 不发上传请求。按钮文案为「暂不补充业务语义，使用数据库字段信息继续」。已有至少 1 张启用表时进入第 5 步 |
| 原高级模式 | 从向导移除。不保留会调用 `/api/catalog/assets` 的控件 |

移除后用一句说明替代高级上传区：单表 YAML 在表详情导入；多文件在语义资产里上传语义资产。说明中的 `Schema Manifest`、`semantic overlay`、路径保持防翻译。禁止文案：裸「上传 YAML」、`assetKind`、路由 404 原文。

这收紧 Spec 130 §3.4 与 Spec 157 伪代码中的「custom YAML upload remains optional」。两处都改为指向本文。

## 核心流程（伪代码）

```text
step2Submit(content, filename):
  if content is blank:
    keep the upload control disabled
    return

  validation = POST /api/catalog/assets/validate
    with assetKind = "schema_manifest"
  if validation.valid is false:
    show validation.errors
    stay on step2
    return
  if validation.exists and confirmOverwrite is not true:
    show the existing overwrite confirmation
    stay on step2
    return

  result = POST /api/catalog/assets/upload
    with the same body
    and confirmOverwrite only when validation.exists
  if status is 409 and code is TARGET_EXISTS:
    show the server message
    require overwrite confirmation
    stay on step2
    return
  if status is not success:
    show the server error message
    stay on step2
    return

  invalidate catalogReloads, catalogAssetUploads, project,
    connections, sources, connectionTables(connectionId)
  show "已解析 {result.validation.tables} 张表"
  open step3

step4:
  require enabledTables.count > 0
  adopt basic field semantics
  do not post catalog assets or semantic overlay content
  open step5
```

失败顺序：先看校验错误，再看是否需要覆盖确认，最后才提交上传。不得先 POST 到 `/api/catalog/assets`。

## 6. 测试

1. 向导单测断言上传 URL 为 `/api/catalog/assets/upload`，请求体含 `connectionId`、`schema`、`assetKind: "schema_manifest"`、`filename`、`content`。
2. 覆盖场景断言第二次请求才带 `confirmOverwrite: true`。
3. Playwright 黄金路径改为拦截 `/api/catalog/assets/upload`，并断言上述字段。未匹配的 `/api/**` 返回 404。
4. 删除对 `POST /api/catalog/assets` 的成功 mock。
5. `assetKind: "manifest"` 的失败继续由 `webui/server/__tests__/api.catalog-assets.test.ts` 覆盖，不在向导里再实现一套校验。
6. `catalog-asset-upload.test.tsx` 保持通过，确认连接概览抽屉未被改动。

## 7. 验收

1. 在接入向导选择有效 Schema Manifest 后，Network 只有 `POST /api/catalog/assets/validate` 与 `POST /api/catalog/assets/upload`。
2. 上传请求的 `assetKind` 为 `schema_manifest`。
3. 成功提示含服务端返回的解析表数，并向导进入第 3 步。
4. 关闭向导后，该 Schema 行的 Manifest 状态为已存在。
5. 重复上传同一目标时，不出现无说明失败；确认覆盖后写入成功。
6. 非法 YAML 显示结构化校验错误，页面没有 `Route POST /api/catalog/assets not found`。
7. 第 4 步没有会提交表级 YAML 的控件；基础模式仍可进入第 5 步。
8. 向导单测与 Playwright 不再把 `/api/catalog/assets` mock 成成功。

## Terminology Compliance

This feature follows `webui/docs/00-product-terminology-standard.md`.

New terms:

- None

| 说法 | 用途 | 不使用 |
|---|---|---|
| 上传 Schema Manifest | 第 2 步主动作 | 裸「上传 YAML」、上传舱单 |
| Schema Manifest | 资产类型与成功对象 | 把表级 YAML 叫 Manifest |
| 确认覆盖现有 YAML | 409 与 `exists=true` 的确认，沿用连接概览抽屉 | 静默覆盖 |
| 已解析 N 张表 | 上传成功，N 来自 `validation.tables` | 本地表数、物理表数 |
| 导入 YAML | 指向表详情既有入口（Spec 114） | 在向导里写「上传 semantic overlay」按钮 |
| 上传语义资产 | 指向既有发布入口 | 把连接向导做成资产包入口 |

## Design System Compliance

引用 `webui/docs/design-system/10-components-button.md` 与连接概览上传抽屉的既有校验反馈。

- 第 2 步仍只有一个 primary。覆盖确认使用已有勾选，不新增危险主按钮。
- 校验错误沿用现有 `role="alert"` 危险提示，不新增颜色 token。
- 上传进行中沿用按钮 loading 文案「正在上传...」。
- 第 4 步去掉高级上传后，不另做新的模式切换样式。
