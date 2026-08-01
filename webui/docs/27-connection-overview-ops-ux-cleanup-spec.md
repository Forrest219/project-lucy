# Connection Overview Operations UX Cleanup Spec

| 元数据 | 内容 |
|---|---|
| 文档名称 | Connection Overview Operations UX Cleanup Spec |
| 文档类型 | Product / Frontend / Backend Contract / Operations UX Spec |
| 版本 | v0.1 |
| 撰写日期 | 2026-07-31 |
| 适用范围 | Lucy WebUI 数据库接入模块：`/connections` 连接概览、添加 Schema Drawer、上传 YAML Drawer、连通测试 Drawer、相关 API contract、术语 lint 与 Vitest |
| 架构决议 | 连接概览必须明确区分 Connection 级操作、Schema 级操作与行级操作；行内上传 Manifest 必须绑定当前 Schema；连通测试必须把可排障的原始输出作为一等诊断内容展示 |
| 事实源 | `webui/src/pages/connections/ConnectionOverview.tsx`、`webui/src/components/catalog/CatalogAssetUploadDrawer.tsx`、`webui/src/components/AddSchemaDrawer.tsx`、`webui/src/components/connections/ConnectionTestResultPanel.tsx`、`webui/server/ktx.ts` |
| 关联文档 | `webui/docs/00-product-terminology-standard.md`、`webui/docs/11-connection-whitelist-test-ux-refresh.md`、`webui/docs/21-connection-catalog-upload-ux-spec.md`、`webui/docs/25-connection-module-terminology-ia-refresh-spec.md`、`webui/docs/26-database-connection-operations-runbook-spec.md`、`docs/DEVELOPMENT.md` |

## 1. 决策摘要

连接概览已经完成从动态 ingest 到本地 Catalog / YAML 资产管理的收敛，但当前主界面仍存在几个运维高频痛点：

1. 行内 `上传 Manifest` 与卡片全局 `上传 YAML` 使用同一个 Drawer，但标题和入口语义没有充分区分，容易让用户误以为仍需手动选择目标 Schema。
2. 添加 Schema 表单在 MySQL 类数据源中显示 `Schema 或 database`，与系统术语标准的 `Schema` 主术语冲突。
3. 上传 YAML Drawer 的说明、文件入口与源码编辑区争抢纵向空间，源码编辑体验不足。
4. 连接级、Schema 级和行级操作边界不够清晰，卡片 Footer 承载过多不同层级动作。
5. 连通测试日志面板不是排障主面板；当 stdout / stderr 为空或未展开时，运维无法快速复制命令和日志复现问题。

本规格将数据库接入主界面整理为面向运维的工作台：顶部处理 Connection 健康与本地 Catalog 刷新，中部以 Schema 资产表为主，行内动作只处理当前 Schema，底部提供 Schema / YAML 资产维护入口，连通测试 Drawer 总是提供可复制的终端诊断出口。

## 2. 目标与非目标

### 2.1 目标

| 目标 | 说明 |
|---|---|
| 降低误选 Schema 风险 | 行内上传 Manifest 时锁定当前 Schema，禁止下拉误选 |
| 统一术语 | UI 主术语固定使用 `Schema`，数据库类型差异只出现在辅助说明 |
| 提升上传效率 | YAML 源码区适合阅读、粘贴、轻量编辑几十至上百行 Manifest |
| 明确操作层级 | Connection 级、Schema 级、行级动作在布局和文案上分区 |
| 强化连通测试排障 | 原始命令、stdout、stderr、exit code 和耗时可见、可复制 |
| 可测试可审阅 | 所有用户可见文案、交互分支与日志契约有 Vitest / API 测试覆盖 |

### 2.2 非目标

| 非目标 | 理由 |
|---|---|
| 不新增物理数据库连接表单 | WebUI 不接管 host / port / username / password，边界见 `26` |
| 不实现完整 IDE | 本轮只要求 Manifest 上传场景的轻量 YAML 编辑能力；Monaco / CodeMirror 可作为后续增强 |
| 不把 Catalog Reload 改成物理扫描 | 刷新本地目录仍只读取本地 YAML / `ktx.yaml` |
| 不自动生成 Manifest | 本轮只优化受控上传和诊断，不新增数据库扫描生成链路 |
| 不改变 YAML 写入安全边界 | 上传仍走既有受控 API、路径计算、校验和本地目录刷新 |

## 3. Terminology Compliance

This feature follows `webui/docs/00-product-terminology-standard.md`.

New terms:

- None.

Required UI terms:

| 概念 | UI 主术语 | 禁止文案 |
|---|---|---|
| 数据库 Schema | `Schema`、`Schema 名称`、`目标 Schema` | `database 名` 作为 Label、`架构`、`模式` |
| Schema manifest | `Manifest`、`Schema Manifest`、`缺失 Manifest`、`上传 Manifest` | `清单`、`模式清单`、`舱单` |
| YAML upload | `上传 YAML`、`上传该 Schema 的 YAML` | `上传清单`、`上传报价包` |
| Connection test | 页面标题 `连通测试`，按钮 `测试连接` / `重新测试连接` | `替代测试` |
| Catalog reload | `刷新本地目录` | `重新扫描数据库`、`触发 ingest` |

Browser translation defense remains mandatory for professional terms, file paths, command lines, Schema names, connection IDs, YAML code and log output:

```tsx
<span className="notranslate" translate="no">Schema Manifest</span>
```

## 4. Information Architecture

### 4.1 Connection Card Layout

Each connection card must expose three operation zones:

```text
Connection Card
├─ Header / top-right actions
│  ├─ 测试连接
│  └─ 刷新本地目录
├─ Schema asset table
│  └─ 操作 column: 维护白名单 / 上传 Manifest / 查看错误 / 重新上传 Manifest
└─ Table footer / asset actions
   ├─ 添加 Schema
   └─ 上传 YAML
```

The previous M21 footer shape:

```text
[添加 Schema] [上传 YAML] [测试连接] [刷新本地目录]
```

is superseded for future implementation by the three-zone layout above.

### 4.2 Operation Levels

| 操作 | Level | Placement | Behavior |
|---|---|---|---|
| `测试连接` | Connection | Card header or top-right action bar | Opens `ConnectionTestDrawer` and runs / re-runs `ktx connection test <connectionId>` |
| `刷新本地目录` | Connection | Card header or top-right action bar | Calls Catalog reload for this connection only |
| `添加 Schema` | Schema list | Table footer / bottom toolbar | Opens `AddSchemaDrawer` for the connection |
| `上传 YAML` | Schema list / asset | Table footer / bottom toolbar | Opens upload Drawer with Schema selector enabled |
| `维护白名单` | Row | Last column `操作` | Navigates to whitelist filtered by row Schema |
| `上传 Manifest` | Row | Last column `操作` | Opens upload Drawer with row Schema locked |
| `查看错误` / `重新上传 Manifest` | Row | Last column `操作` | Shows manifest validation error or opens locked upload Drawer |

### 4.3 Table Column Contract

The Schema asset table columns should be:

| Column | Content |
|---|---|
| `Schema` | Schema name, `notranslate`, stable `data-testid` |
| `Manifest 状态` | `已存在` / `缺失 Manifest` / `解析失败` |
| `本地表数` | Table count from local Catalog |
| `操作` | Consistent row actions as link buttons or an action menu |

The row action column must avoid distributing unrelated text links across other cells.

## 5. Upload YAML Drawer

### 5.1 Entry Contract

| Entry | Schema selector | Title / target display | Default filename |
|---|---|---|---|
| Row action `上传 Manifest` | Locked | `上传 openclaw_db 的 Schema Manifest` or title + `目标 Schema：openclaw_db` | `openclaw_db.yaml` |
| Schema-specific button `上传该 Schema 的 YAML` | Locked | Same locked target behavior | `<schema>.yaml` |
| Global/card action `上传 YAML` | Enabled | `上传 demo-mysql 的 Schema Manifest` and `Schema` selector | First configured Schema or empty |

Locked mode must not render an enabled select. It may render a read-only target row:

```text
目标 Schema：openclaw_db
```

The target Schema text must use `notranslate` / `translate="no"`.

### 5.2 Drawer Copy

Top copy must be short and non-duplicative:

```text
目标路径由系统计算；会校验连接、Schema、YAML 结构、文件大小与目标路径。提交前会自动校验，写入成功后会自动刷新本地目录。
```

Avoid adding a second large gray hint box repeating the same content. The file dropzone may remain, but it should be visually compact and clearly interactive.

Recommended layout:

```text
[Title]
[Short notice]
[Target Schema or Schema selector]
[Filename]
[File picker / dropzone, compact]
[YAML source editor, large]
[Validation panel]
[Overwrite checkbox if needed]
[Cancel] [上传并刷新本地目录]
```

### 5.3 YAML Source Editor

MVP requirements:

| Requirement | Acceptance |
|---|---|
| Monospace font | `font-mono` or explicit stack including JetBrains Mono / Consolas / Menlo |
| Larger height | Minimum height at least `18rem` on desktop; remains usable on small screens |
| Resizable | `resize: vertical` or equivalent |
| Tab indentation | Pressing Tab inserts two spaces inside the editor |
| YAML example | Placeholder remains valid English YAML; no Chinese keys |
| Translation defense | Editor, placeholder examples, filenames and paths are protected where applicable |

Optional if low-risk:

| Enhancement | Note |
|---|---|
| Line numbers | May be CSS-only or via lightweight controlled overlay |
| Full-screen editor mode | Useful when avoiding a heavy editor dependency |
| YAML formatting button | Must be explicit; do not silently rewrite user YAML before upload |
| CodeMirror / Monaco | Allowed only if bundle and implementation complexity stay acceptable |

## 6. Add Schema Drawer

### 6.1 Label And Helper Text

The field label must be stable:

```text
Schema 名称
```

Database-type nuance belongs in helper text, not the Label:

| Engine / driver | Helper text |
|---|---|
| MySQL | `MySQL 中通常对应 database 名。` |
| Doris / StarRocks | `Doris / StarRocks 使用 MySQL wire protocol 时，通常填写 database 名。` |
| Postgres | `PostgreSQL 中请填写 schema，不是 database。` |
| Unknown | `填写要纳入该连接治理的 Schema。` |

The validation messages may keep `Schema 名` wording, for example `Schema 名不能为空`.

### 6.2 Upload Handoff After Success

After adding a Schema, the success step may offer:

```text
上传 Schema Manifest
刷新本地目录
完成
```

The `上传 YAML` button from this success state is Schema-specific and must open the upload Drawer in locked mode for the newly added Schema.

## 7. Connection Test Drawer

### 7.1 Backend Contract

`POST /api/connections/:connId/test` should return a diagnostic payload that makes CLI reproduction possible.

Recommended response shape:

```ts
export type ConnectionTestResult = {
  status: "ok" | "error";
  latencyMs?: number;
  detail?: string;
  reason?: string;
  command: string;
  args: string[];
  exitCode: number | null;
  stdout: string;
  stderr: string;
};
```

Compatibility requirement:

- Existing optional `stdout` / `stderr` consumers must keep working during migration.
- New fields can be added without removing `detail` / `reason`.
- `command` should be safe to display as `ktx connection test <connectionId>`.
- stdout / stderr must be redacted before returning if future KTX output can include secrets.

### 7.2 Frontend Log View

The Drawer must treat raw logs as a first-class diagnostic component:

| UI Element | Requirement |
|---|---|
| Header | `原始诊断日志 (ktx connection test stdout/stderr)` |
| Log frame | Terminal-style, dark or high-contrast, monospace, fixed max height, scrollable |
| Empty state | If stdout/stderr/detail/reason are all empty, show `ktx 未返回原始日志输出` and still show command / exit code |
| Copy command | Copies `ktx connection test <connectionId>` |
| Copy log | Copies stdout and stderr with labels |
| Metadata | Shows exit code, latency, status and driver metadata when available |

The log frame should be expanded by default after a failed test and may be collapsed by default after a successful test if the summary is clear.

### 7.3 State Synchronization

Connection card status and Drawer result must continue sharing one source of truth:

- Opening `测试连接` from the card may auto-run the test.
- Re-running from the Drawer must update the card status.
- Closing and reopening the Drawer should show the latest cached result unless a new test is running.

## 8. Accessibility And Responsive Behavior

1. All Drawer close buttons must have accessible names and stable dimensions.
2. Row actions must be keyboard reachable in DOM order.
3. Copy buttons must provide success / failure feedback via toast or inline status.
4. YAML editor must not trap focus except for intentional Tab insertion; Shift+Tab should still allow focus escape if implemented.
5. The Schema table must remain horizontally usable on narrow screens; row actions may collapse into a menu if necessary.
6. Text must fit inside buttons and cells without overlap at mobile and desktop widths.

## 9. Acceptance Criteria

### 9.1 Product Acceptance

- From a row with Schema `openclaw_db`, clicking `上传 Manifest` opens a Drawer where `openclaw_db` is selected and cannot be changed.
- From global/card `上传 YAML`, the Drawer allows selecting a configured Schema.
- Add Schema Drawer label is `Schema 名称`; no Label says `Schema 或 database 名`.
- MySQL / Doris / StarRocks / Postgres helper text explains database-specific nuance without changing the Label.
- Upload Drawer has one concise rule explanation, a compact file picker, and a larger YAML source editor.
- Connection card visually separates `测试连接` / `刷新本地目录` from `添加 Schema` / `上传 YAML` and row actions.
- The Schema table has a unified `操作` column.
- Connection test Drawer always shows a diagnostic log view with command, stdout/stderr or a meaningful empty state, and copy controls.

### 9.2 Testing Acceptance

Required focused tests:

```bash
cd /Users/zhangxingchen/Projects/project-lucy/webui
npm test -- --run src/__tests__/connection-overview.test.tsx
npm test -- --run src/__tests__/catalog-asset-upload.test.tsx
npm test -- --run src/__tests__/add-schema-drawer.test.tsx
npm test -- --run src/__tests__/connection-test.test.tsx
npm test -- --run server/__tests__/ktx.test.ts
npm run lint:terminology
```

Recommended full verification:

```bash
cd /Users/zhangxingchen/Projects/project-lucy/webui
npm test
npm run build
```

### 9.3 Non-Regression

- No UI text contains banned terminology from `00-product-terminology-standard.md`.
- No raw secret, password file content or token is added to docs, tests, logs or snapshots.
- Existing Catalog asset upload validation and overwrite confirmation remain intact.
- Existing Add Schema write path still runs connection test before writing `ktx.yaml`.
- Existing static Catalog reload semantics remain unchanged.
