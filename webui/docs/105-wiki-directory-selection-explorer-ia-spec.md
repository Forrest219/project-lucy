# Business Wiki Directory Selection Explorer IA Spec

| 元数据 | 内容 |
|---|---|
| 文档名称 | Business Wiki Directory Selection Explorer IA Spec |
| 文档类型 | Spec |
| 版本 | v1.0 |
| 撰写日期 | 2026-08-06 |
| 撰写人 | Composer |
| 委托人 | zhangxingchen |
| 基于材料 | `/wiki` 浏览器核查（目录缺重命名入口、层级字号弱、左右无分割）；用户认可参考 [Attu](https://github.com/zilliztech/attu) 三栏 Explorer 做「交互对齐 P1」；前序 Spec 49 / 52 / 58 / 71 / 74 |
| 适用范围 | `/wiki` 工作区：目录选中驱动右栏、面板分区视觉、空态；不实现目录重命名 API |
| 输出位置 | `webui/docs/105-wiki-directory-selection-explorer-ia-spec.md` |

| 字段 | 内容 |
|---|---|
| Spec 编号 | 105 |
| 关联工单 | `webui/docs/plans/wo-202608-38-wiki-directory-selection-explorer-ia.md` |
| 关联页面 | `/wiki` |
| 关联台账 | `docs/ui-ux-feedback/pages/wiki.md`（`UX-WIKI-041`～`044`）；跨页面主题 `explorer panel selection ia` |
| 上游 Spec | Spec 49（MD 文档库首页）、Spec 52（目录树）、Spec 58（目录治理，重命名仍为非目标）、Spec 71 / 74（树内容模型 UX-WIKI-020） |
| 状态 | Implemented |
| 日期 | 2026-08-06 |
| 范围 | Attu 式：选目录 → 右栏该目录文档列表；选文档 → 阅读/编辑；无选中空态；中栏面板视觉；修订 `/wiki` 默认首页为「先选目录」 |

### Changelog

| 版本 | 变更 |
|---|---|
| v1.0 | 初稿并落地：`?dir=` 选中态、右栏过滤、面板视觉、空态；重命名登记台账 Open；文档态点回父目录走 `directoryPanelActive` |

## 1. 背景

浏览器核查确认 `/wiki` 三点问题：

1. 目录 `...` 菜单无「重命名目录」（且 Spec 58 明确非目标、无 API）。
2. `global` 及子目录统一 `12px` muted，层级弱。
3. 中栏目录与右栏 MD 同白底、无竖分割，不像资源浏览器。

用户认可参考 Attu Explorer：**不必造第四栏**（Lucy 已有全局侧栏 + Wiki 中栏 + 主区），而是把中栏做成可选择的资源面板，右栏跟随选中态。

## 2. 目标

1. URL 增加目录选中态：`?dir=<wiki-directory-path>`。
2. 点击目录行：选中该目录并驱动右栏；**仅当右栏已是该目录的 library 视图时**，再次点击才展开/收起。文档打开时点击高亮父目录回到 `?dir=`。
3. 右栏在 `dir` 选中且无 `key` 时，只列出该目录前缀下的 Markdown 文档（与树「N 篇」递归口径一致）。
4. `/wiki` 无 `key` / `sl_ref` / `dir` 时展示 Attu 式空态：「从左侧选择目录或文档」。
5. 中栏实体化面板：浅底 + 圆角 + 边框 / 与主区竖分割；目录行字号升至 `text-sm`，选中高亮。
6. 打开文档时树高亮所属目录；`navigateTo(key)` 清除 `dir`（`key` 优先）。
7. 台账登记并更新 Fixed / Open；跨页面主题与治理规则补一条。

## 3. 非目标

| 非目标 | 理由 |
|---|---|
| 目录重命名 / 递归路径改写 API | Spec 58 非目标；需独立 Spec；本单台账 `UX-WIKI-044` Open |
| 去掉全局 `.pl-sidebar` 或改成 Attu 连接列表 | 破坏全站壳 |
| 四栏（导航 + 目录 + 列表 + 预览） | 1280 首屏与 Attu 自身也不做四栏 |
| 中栏可拖拽改宽 | 可后置 |
| 改变 UX-WIKI-020（树默认不混排文档） | 仍只在搜索或当前打开文档时显示文档行 |
| 本轮浏览器验证 | 用户约束：结束后只做 code review |

## 4. Terminology Compliance

Follows `webui/docs/00-product-terminology-standard.md`.

| Canonical Term | UI 主术语 | 说明 |
|---|---|---|
| Wiki Directory | Wiki 目录 / 目录 | `?dir=` 路径段 |
| Selected Directory | 当前目录 | 中栏选中高亮 |
| Markdown 文档 | Markdown 文档 | 右栏列表项 |

路径、目录名、`Wiki`、`Markdown` 继续 `notranslate`。

## 5. URL 与状态模型

| URL | 右栏 |
|---|---|
| `/wiki`（无 key / sl_ref / dir） | 空态：从左侧选择目录或文档 |
| `/wiki?dir=global` | 该目录下文档列表（含子孙路径文档） |
| `/wiki?key=global/foo.md` | 阅读/编辑（既有）；树选中态 = 文档父目录 |
| `/wiki?sl_ref=...` | 既有解析，优先于 dir |

规则：

- `key` / `sl_ref` 解析出文档时，忽略 `dir` 对右栏模式的影响（仍可读 `dir` 但不渲染 library）。
- `navigateTo(key)` 写 `{ key }`（保留 `sl_ref` 若有），**不**保留 `dir`。
- `navigateToDirectory(dir)` 写 `{ dir }`，清 `key`；若 dirty 则与切文档同样 confirm。
- `dir` 非法或空字符串：视为未选中。

## 6. 中栏 WikiTree

1. 新增 `selectedDirectory` + `onSelectDirectory(path)`。
2. 目录行 click：
   - 若右栏已是该目录 library（`directoryPanelActive`）且行已选中 → 仅 toggle 展开/收起。
   - 否则 → `onSelectDirectory(path)` 且强制展开（含从文档态点回父目录）。
3. 选中行：`pl-wiki-tree-group--active` + `aria-current="true"`（或等价）。
4. UX-WIKI-020 不变。
5. 行菜单仍为：新建子目录 / 在此目录新建文档 / 删除目录（无重命名）。

## 7. 右栏 WikiLibraryHome

Props 扩展：`selectedDirectory: string | null`。

| 状态 | UI |
|---|---|
| `selectedDirectory` 为空 | 空态区：短文案「从左侧选择目录或文档」；`data-testid="wiki-library-select-prompt"` |
| 有选中且文档数 > 0 | 摘要「当前目录 `wiki/<dir>` · N 篇」+ 过滤后的文档列表 |
| 有选中且 0 篇 | 空态「此目录还没有 Markdown 文档」；`data-testid="wiki-library-directory-empty"` |

过滤：`page.key === dir` 不可能（key 含 `.md`）；使用 `page.key === `${dir}/...`` → `page.key.startsWith(dir + "/")`。

不再在无选中时渲染「全库扁平列表」（修订 Spec 49 / M64 默认首页行为；层级仍只在中栏树）。

## 8. 视觉（Attu 面板语言）

| 元素 | 要求 |
|---|---|
| `.pl-wiki-sidebar` | `bg-bg-subtle`、`rounded-md`、`border border-border-default`、内边距；可选略加宽至 ~260px |
| `.pl-wiki-main` | 与中栏有清晰分割：`border-l` 或 layout `gap-0` + 边框相接 |
| `.pl-wiki-tree-group-toggle` | `text-sm`、默认 `text-fg-default`/`font-medium`；弃用过弱的 `text-xs text-fg-muted` 作为主标签 |
| 选中行 | `bg-bg-selected`（或等价 token） |
| 计数 pill | 可保持 `text-[10px]`，不与目录名抢层级 |

## 9. 测试要求（非浏览器）

Vitest：

- `/wiki` 无参数 → 出现 `wiki-library-select-prompt`，不出现全库文档列表。
- 点击目录 → URL 含 `dir=`；右栏仅该前缀文档。
- 空目录 → `wiki-library-directory-empty`。
- 点文档 → `key=`，进入阅读态；树目录带 active。
- UX-WIKI-020：默认树无文档行；搜索后仍出现。
- CSS：`.pl-wiki-sidebar` 规则含 border / bg；`.pl-wiki-tree-group-toggle` 含 `text-sm`。

命令：

```bash
cd webui
npm test -- --run src/__tests__/wiki.test.tsx
npm run lint:terminology
npm run build
```

## 10. 验收标准（非浏览器）

- [ ] Spec / Plan / `webui/docs/README.md` / `plans/README.md` 已登记
- [ ] `UX-WIKI-041`～`043` → `Fixed`；`UX-WIKI-044` → `Open`（重命名延期）
- [ ] 台账 README 维护记录 + 主题 + 治理规则已更新
- [ ] 上述 Vitest / lint / build 通过
- [ ] 本轮不做浏览器验证；结束后 code review

## 11. 风险与边界

- 改变默认首页会让「一眼扫全库文档」变弱；换取 Attu 式选中驱动。全库搜索仍可用中栏搜索框。
- 新建文档/目录成功后的跳转：若落到 `?key=`，符合「打开文档」；若需停留在目录视图，后续可增强，本单不强制。
- 目录重命名仍禁止在本单偷加假按钮。
