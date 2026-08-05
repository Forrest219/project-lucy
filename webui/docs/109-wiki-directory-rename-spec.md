# Business Wiki Directory Rename Spec

| 元数据 | 内容 |
|---|---|
| 文档名称 | Business Wiki Directory Rename Spec |
| 文档类型 | Spec |
| 版本 | v1.1 |
| 撰写日期 | 2026-08-06 |
| 撰写人 | Composer |
| 委托人 | zhangxingchen |
| 基于材料 | `/wiki` 浏览器核实（`UX-WIKI-044`）；用户要求单独开「目录重命名」Spec；前序 Spec 53 / 55 / 58 / 105 |
| 适用范围 | `/wiki`：目录重命名（单段改名）、子孙 Markdown / 空目录资源路径改写、预检与版本追溯 |
| 输出位置 | `webui/docs/109-wiki-directory-rename-spec.md` |

| 字段 | 内容 |
|---|---|
| Spec 编号 | 109 |
| 关联工单 | `webui/docs/plans/wo-202608-42-wiki-directory-rename.md` |
| 关联页面 | `/wiki` |
| 关联台账 | `docs/ui-ux-feedback/pages/wiki.md`（`UX-WIKI-044`） |
| 上游 Spec | Spec 53（空目录资源）、Spec 55（版本 `rename` 预留）、Spec 58（目录治理，本能力曾为非目标）、Spec 105（Explorer IA，明确延期重命名） |
| 状态 | Implemented |
| 日期 | 2026-08-06 |
| 范围 | 目录 `...` →「重命名目录」；预检 + commit API；路径前缀批量改写；URL `?dir=` 跟随；不实现跨父级「移动目录」 |

### Changelog

| 版本 | 变更 |
|---|---|
| v1.0 | 初稿：承接 `UX-WIKI-044`；定义 UX / API / 数据契约 / 验收 |
| v1.1 | Implemented：server rename + UI + Vitest；`UX-WIKI-044` → Fixed |

## 1. 背景

浏览器与代码核实确认：

1. 目录行 `...` 菜单仅有：新建子目录 / 在此目录新建文档 / 删除目录。
2. Spec 58 / M51 / M56 / Spec 105 均将「目录重命名」列为非目标；无 rename API。
3. 台账 `UX-WIKI-044` 状态为 **Open**，期望独立 Spec 提供重命名（含路径下文档与空目录资源迁移、冲突预检）。
4. 现场存在测试残留目录名（如 `ux-wiki-007-msbpd1qu`、`m56-msbye4tr-top`），用户无法在 UI 内改名清理。

本 Spec 兑现 Spec 105 Non-Goal 中「需独立 Spec」的延期项。

## 2. 目标

1. 目录 `...` 菜单增加主术语 **重命名目录**（Attu 资源旁操作模式）。
2. 支持将目录路径最后一段改名（同父级下改名），例如 `global/xxx` → `global/playbooks`。
3. 一次提交原子改写：
   - 该目录及其子孙空目录在 `wiki/.lucy-directories.json` 中的 path；
   - 该前缀下全部 Markdown 文档的 filesystem key 与版本历史索引；
   - 物理目录 / 文件路径（经 `fs-safe`）。
4. 提供 preview + commit；冲突、非法名、根目录等在预检阶段阻断。
5. 成功后：刷新 `queryKeys.wiki`；若当前 `?dir=` 落在被改写前缀内，URL 改写到新 path；Toast「目录已重命名」。
6. 台账 `UX-WIKI-044` → `Fixed`（实现后）；浏览器复核另议。

## 3. 非目标

| 非目标 | 理由 |
|---|---|
| 跨父级「移动目录」（改变父路径） | 复杂度与冲突面更大；本轮只做同父级最后一段改名 |
| 批量重命名 / 拖拽改名 | 可后置 |
| 非空目录递归删除策略变更 | 仍遵 Spec 58 |
| 改变 UX-WIKI-020（树默认不混排文档） | 与重命名无关 |
| 改变 Spec 105 右栏递归文档列表口径 | 另开需求；本单不改 Explorer IA |
| 文档 basename 重命名（改 `.md` 文件名） | 已有「移动到目录」；文档改名可后置 |
| 本轮浏览器验证 | 默认按 DEVELOPMENT 约束；除非工单明确要求 |

## 4. Terminology Compliance

Follows `webui/docs/00-product-terminology-standard.md`。

本 Spec 登记：

| Canonical Term | UI 主术语 | 允许补充说法 | 禁止文案 | 说明 |
|---|---|---|---|---|
| Rename Wiki Directory | 重命名目录 | 修改目录名 | 重命名 folder、改名 folder | 同父级下修改目录路径最后一段 |
| Directory Rename Preflight | 重命名预检 | 重命名确认 | 覆盖预检混用 | 展示源路径、目标路径、影响文档/子目录数 |
| Source Wiki Directory | 当前目录路径 | 源目录 | — | 改名前 `wiki/<path>/` |
| Target Wiki Directory | 目标目录路径 | 新目录 | — | 改名后 `wiki/<path>/` |

Protected / `notranslate`：`Wiki`、`Markdown`、目录 path、Wiki key、version id。

实现时若 `00-product-terminology-standard.md` 尚无上表条目，工单 Phase 0 须先补登记再写 UI 文案。

## 5. Target UX

### 5.1 入口

目录行 `...` 菜单顺序：

1. 新建子目录  
2. 在此目录新建文档  
3. **重命名目录**（本单新增）  
4. 删除目录  

禁用：

| 条件 | 行为 |
|---|---|
| 伪「根目录」桶（path 为空） | 不展示或禁用；Toast / disabledReason：「根目录不可重命名。」 |
| 正在提交中 | 按钮 loading / disabled |

### 5.2 对话框

标题：`重命名目录`

字段：

| 字段 | 控件 | 说明 |
|---|---|---|
| 当前目录路径 | 只读 `code` | `wiki/<sourcePath>/` |
| 新目录名称 | 单行 input | 仅单个路径段；不得含 `/`、`.`、`..`、前导 `.` |
| 目标目录路径 | 只读预览 | `wiki/<parent>/<newName>/`；顶层则为 `wiki/<newName>/` |
| 影响摘要 | 只读 | 将改写的 Markdown 文档数、子目录数（含自身） |

主按钮：`确认重命名`（预检通过且无 blocking 冲突时启用）。  
次按钮：`取消`。

Dirty 编辑态：与新建/删除目录相同——先 confirm 放弃未保存内容。

### 5.3 成功后导航

| 当前状态 | 成功后 |
|---|---|
| `?dir=<source>` 或 `?dir` 为 source 子孙 | 写 `?dir=<rewritten>` |
| `?key=` 落在 source 前缀下 | 写新 key（前缀替换） |
| 其他 | 仅刷新树；保持当前 URL |

## 6. Data and API Contract

### 6.1 Preview

```http
POST /api/wiki/directories/rename/preview
```

Request:

```json
{
  "sourcePath": "m56-msbye4tr-top",
  "newName": "playbooks"
}
```

`newName` 必须是单个目录名（不是完整 path）。目标 path = `parent(sourcePath) + "/" + newName`（顶层则仅为 `newName`）。

Response `data`：

```json
{
  "sourcePath": "m56-msbye4tr-top",
  "targetPath": "playbooks",
  "newName": "playbooks",
  "documentCount": 1,
  "directoryCount": 2,
  "documents": [
    {
      "sourceKey": "m56-msbye4tr-top/moved/m56-msbye4tr-upload.md",
      "targetKey": "playbooks/moved/m56-msbye4tr-upload.md"
    }
  ],
  "directories": [
    {
      "sourcePath": "m56-msbye4tr-top",
      "targetPath": "playbooks"
    },
    {
      "sourcePath": "m56-msbye4tr-top/moved",
      "targetPath": "playbooks/moved"
    }
  ],
  "conflicts": [],
  "warnings": []
}
```

### 6.2 Commit

```http
POST /api/wiki/directories/rename
```

同 preview request body。成功响应：

```json
{
  "ok": true,
  "data": {
    "sourcePath": "m56-msbye4tr-top",
    "targetPath": "playbooks",
    "renamedDocuments": 1,
    "renamedDirectories": 2,
    "writtenFiles": ["wiki/playbooks/", "wiki/playbooks/moved/m56-msbye4tr-upload.md"]
  }
}
```

### 6.3 Errors

| Code | Status | Meaning |
|---|---:|---|
| `WIKI_DIRECTORY_NOT_FOUND` | 404 | 源目录不存在（无 metadata 且无前缀文档/子目录） |
| `WIKI_DIRECTORY_INVALID` | 400 | `newName` / path 非法；或 `newName` 与当前段相同 |
| `WIKI_DIRECTORY_CONFLICT` | 409 | 目标 path 已被目录或文件占用；或某目标 Wiki key 已存在 |
| `WIKI_DIRECTORY_RENAME_ROOT` | 400 | 试图重命名空 path / 根桶 |

### 6.4 实现约束

1. 全部写入走 `fs-safe.ts` allowlist（仅 `wiki/`）。
2. Markdown 改写优先复用 `moveWiki` 的历史携带逻辑（按文档循环，或抽共享 `rewriteWikiKey`）；每篇版本 `operation` 可为 `move`（已有）或新增记录 `rename` 若仅路径前缀变化——**推荐统一 `move`**，避免双轨；若用 `rename`，须同步更新 Spec 55 / 版本 UI 文案表。
3. `wiki/.lucy-directories.json`：删除所有 `sourcePath` 前缀条目，写入对应 `targetPath` 条目（保留 `createdAt`，更新 `updatedAt`）。
4. 物理层：先确保目标目录树，再移动文件，最后删除空的源目录树；任一步失败须可诊断（不要静默半完成；实现可选用临时 staging 或严格预检 + 顺序写）。
5. 不把历史快照暴露进 `GET /api/wiki` pages / `wiki_search`（维持 Spec 55）。

### 6.5 `03-api-spec.md`

实现工单必须登记：

- `POST /api/wiki/directories/rename/preview`
- `POST /api/wiki/directories/rename`

## 7. 前端接线

| 位置 | 变更 |
|---|---|
| `WikiTree` | `onRenameDirectory?: (directory: string) => void`；菜单项「重命名目录」 |
| `WikiEditor` | Dialog 状态；调用 preview/commit；成功后 `navigateToDirectory` / `navigateTo` |
| 新组件 | `WikiRenameDirectoryDialog`（对齐 `WikiDeleteDirectoryDialog` / Move 预检密度） |
| types / queryKeys | 请求响应类型；成功后 invalidate `queryKeys.wiki` |

## 8. 测试要求（非浏览器）

Vitest：

- 菜单含「重命名目录」；根桶禁用。
- preview：同名段 → invalid；目标冲突 → conflicts / 409。
- commit：空目录仅改 metadata + 文件系统目录；含文档时 keys 与 history 前缀替换。
- URL：`?dir=old` 成功后变为 `?dir=new`；`?key=old/...` 变为新 key。
- UX-WIKI-020 回归：默认树仍不混排文档行。

命令：

```bash
cd webui
npm test -- --run src/__tests__/wiki.test.tsx
npm run lint:terminology
npm run build
```

## 9. 验收标准

- [ ] Spec / Plan / `webui/docs/README.md` / `plans/README.md` / `03-api-spec.md`（实现时）已登记
- [ ] `00-product-terminology-standard.md` 已补「重命名目录」术语（若原先缺失）
- [ ] `UX-WIKI-044` → `Fixed`；Notes 指向 Spec 109
- [ ] 台账 README 维护记录已更新
- [ ] 上述 Vitest / lint / build 通过
- [ ] Spec 58 / 105 Non-Goal 交叉引用改为「见 Spec 109」

## 10. 风险与边界

- 大目录下文档多时，逐文件 move + history 携带可能较慢；首版可接受同步完成，必要时后续加进度。
- 半失败（部分文件已写）是最高风险；预检必须穷尽目标冲突，commit 顺序与错误处理要在 Review 重点看。
- 同父级改名不等于「移动目录」；若产品后续要拖到另一父级，另开 Spec，勿偷加。
- 不在本单修复 Spec 105 右栏递归列表是否「像混入目录」的观感问题。
