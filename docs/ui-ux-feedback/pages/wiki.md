# Business Wiki Feedback

本页记录 `/wiki` 业务 Wiki 页面级 UI/UX 反馈。状态按当前代码修复与复核情况更新。

## UX-WIKI-001: Wiki 页面打开后全局主菜单消失

Status: Verified
Route: /wiki
Area: App shell navigation
Severity: P0
Reported: 2026-08-02

### Feedback
打开 `/wiki` 后左侧主菜单消失，无法从业务 Wiki 回到系统概览、语义资产、访问治理等主模块。

### Evidence
- Screenshot: ../assets/wiki/UX-WIKI-001-003.png
- Browser check before fix confirmed `/wiki` lacked `.pl-sidebar`, while `/catalog` rendered the global sidebar.

### Expected
`/wiki` 使用与其它一级路由一致的全局 App shell；主导航可见，`业务 Wiki` 导航项高亮。

### Browser Check
1. Open `/wiki`.
2. Verify the global sidebar is visible.
3. Verify `语义建模 -> 业务 Wiki` has `aria-current="page"`.

### Notes
Fixed in `webui/src/app/App.tsx`, `webui/src/app/app.css`, and `webui/src/__tests__/app-shell.test.tsx`. Browser verification passed on 2026-08-02 at `http://127.0.0.1:55176/wiki`: `.pl-sidebar` visible and active nav is `业务 Wiki`.

## UX-WIKI-002: 多 folder 能力没有产品化入口

Status: Verified
Route: /wiki
Area: New document and upload flows
Severity: P1
Reported: 2026-08-02

### Feedback
页面只显示 `global`，看起来不能新建子 Wiki 项目；需要核实 Lucy 是否支持多 folder，并开放可发现入口。

### Evidence
- Screenshot: ../assets/wiki/UX-WIKI-001-003.png
- Code/API check before fix confirmed `GET /api/wiki` recursively reads `wiki/**/*.md`, and upload preview accepts keys such as `kx/folder-preview.md` and `ops/playbooks/folder-preview.md`.

### Expected
底层继续只写 `wiki/**/*.md`，但 UI 允许在新建文档和上传 Markdown 时选择已有目录或输入新子目录。

### Browser Check
1. Open `/wiki`.
2. Click `新建文档`, enter a new target directory, and verify the draft key uses that directory.
3. Upload a Markdown file, enter a new target directory in preflight, and verify the target path updates before confirmation.

### Notes
Fixed in `webui/src/pages/WikiEditor.tsx`, `webui/src/components/WikiNewDocumentDialog.tsx`, `webui/src/components/WikiUploadPreflight.tsx`, and `webui/src/lib/slRef.ts`. Browser verification passed on 2026-08-02: scoped create can target `ops/playbooks`, and the preview updates to `wiki/ops/playbooks/new-note.md`.

## UX-WIKI-003: 初始文档库首页粗糙且主动作重复

Status: Verified
Route: /wiki
Area: Markdown library home
Severity: P1
Reported: 2026-08-02

### Feedback
初始进入 `/wiki` 后页面层级粗糙，不知道该如何使用；`上传 Markdown` 和 `新建文档` 在 PageHeader 与首页卡片中各出现一次，造成重复。

### Evidence
- Screenshot: ../assets/wiki/UX-WIKI-001-003.png
- Browser check before fix confirmed `上传 Markdown` and `新建文档` each rendered twice in the initial page DOM.

### Expected
根路径首页只保留一处主动作区；文档库正文聚焦目录概览和文档列表，不重复 PageHeader 动作。

### Browser Check
1. Open `/wiki`.
2. Verify `上传 Markdown` appears once.
3. Verify `新建文档` appears once.
4. Verify the document library body shows directory groups and document entries without duplicate action buttons.

### Notes
Fixed in `webui/src/components/WikiLibraryHome.tsx` and `webui/src/pages/WikiEditor.tsx`. Browser verification passed on 2026-08-02: exact visible `上传 Markdown` count is 1 and exact visible `新建文档` count is 1.

## UX-WIKI-004: 目录层级与新建子目录能力不可发现

Status: Verified
Route: /wiki
Area: Wiki directory tree
Severity: P1
Reported: 2026-08-02

### Feedback
`目录` 中如何新建二级目录不清楚；`global` 看起来像唯一父级，不知道是否可以创建平级目录或子目录。

### Evidence
- Screenshot: ../assets/wiki/UX-WIKI-004-006.png
- Browser check confirmed the left directory only shows `global` and one Markdown document. `新建文档` dialog has a `目标目录` input, but the directory tree itself has no visible create affordance.

### Expected
左侧目录区域明确支持多个平级目录和多级子目录；目录 Header 和目录行提供新建入口，输入新目录后通过 Markdown key 自然生成目录。

### Browser Check
1. Open `/wiki`.
2. Verify the left directory Header has a create action.
3. Verify directory rows have scoped create actions.
4. Create a draft with target directory `ops/playbooks` and verify the target preview is `wiki/ops/playbooks/new-note.md`.

### Notes
Fixed in `webui/src/lib/wiki.ts`, `webui/src/components/WikiTree.tsx`, `webui/src/pages/WikiEditor.tsx`, and `webui/src/components/WikiNewDocumentDialog.tsx`. Non-browser verification passed by request: `npm test -- --run src/__tests__/wiki.test.tsx`, `npm run lint:terminology`, `npm run build`, and `git diff --check`. Browser verification passed on 2026-08-02: directory Header create action and `在 global 下新建文档` scoped action are visible.

## UX-WIKI-005: 目录计数没有单位导致含义不清

Status: Verified
Route: /wiki
Area: Wiki directory tree
Severity: P2
Reported: 2026-08-02

### Feedback
`global` 右侧的 `1` 不知道是目录数还是 Markdown 文档数。

### Evidence
- Screenshot: ../assets/wiki/UX-WIKI-004-006.png
- Code check confirmed the value is `group.pages.length`, meaning Markdown document count under that directory.

### Expected
目录计数必须带单位，例如 `1 篇`。如果未来同时展示目录数和文档数，应写成 `2 个子目录 · 3 篇`。

### Browser Check
1. Open `/wiki`.
2. Locate the `global` directory row.
3. Verify the count is displayed as `1 篇`, not a bare `1`.

### Notes
Fixed in `webui/src/lib/wiki.ts`, `webui/src/components/WikiTree.tsx`, `webui/src/components/WikiLibraryHome.tsx`, and `webui/src/__tests__/wiki.test.tsx`. Browser verification passed on 2026-08-02: tree and library count badges both display `1 篇`.

## UX-WIKI-006: 默认首页卡片被拉伸导致大面积留白

Status: Verified
Route: /wiki
Area: Markdown library home layout
Severity: P1
Reported: 2026-08-02

### Feedback
`/wiki` 默认首页右侧区域留白过大，文档库 summary 和目录列表像两个巨大的空卡片。

### Evidence
- Screenshot: ../assets/wiki/UX-WIKI-004-006.png
- Browser check measured `.pl-wiki-library-home` at about `608px` high, with grid rows split to about `302px` and `290px`; content itself only needs a compact height.

### Expected
默认首页按内容高度自然收缩，summary band 与目录列表紧凑排列，1280x720 视口下文档列表出现在首屏上半区。

### Browser Check
1. Open `/wiki` at a normal desktop viewport.
2. Verify the summary band is compact.
3. Verify the directory list is directly below the summary band without large blank card height.

### Notes
Fixed in `webui/src/components/WikiLibraryHome.tsx`, `webui/src/pages/WikiEditor.tsx`, and `webui/src/app/app.css`. Browser verification passed on 2026-08-02 at 1920x1080: `.pl-wiki-library-home` measured about `203px` high, with compact summary and directory list.

## UX-WIKI-007: 新建目录与新建文档未拆分且不支持空目录

Status: Verified
Route: /wiki
Area: Wiki directory actions
Severity: P1
Reported: 2026-08-02

### Feedback
页面上有两个 `+`，点击后弹窗均为 `新建文档`；用户预期 `新建目录` 和 `新建文档` 是两个独立操作，并明确要求支持空目录独立存在。

### Evidence
- Screenshot: ../assets/wiki/UX-WIKI-007-plus-actions.png
- Screenshot: ../assets/wiki/UX-WIKI-007-new-document-dialog.png
- Browser check after M50 confirmed two `+` buttons exist: Header `新建 Wiki 目录或文档` and directory row `在 global 下新建文档`; both open the `新建文档` dialog.

### Expected
`新建目录` 与 `新建文档` 拆成独立操作；空目录可创建、展示为 `0 篇`，刷新后仍存在，并可作为上传 Markdown 或新建文档的目标目录。

### Browser Check
1. Open `/wiki`.
2. Verify the directory Header no longer exposes ambiguous bare `+` actions.
3. Click `新建目录` and create `ops`.
4. Refresh `/wiki`.
5. Verify `ops 0 篇` is still visible.
6. Create `ops/playbooks` as an empty subdirectory.
7. Verify `ops -> playbooks 0 篇` is visible.
8. Click `在此目录新建文档` for `ops/playbooks` and verify the new document dialog defaults to `ops/playbooks`.

### Notes
Fixed in `webui/server/wiki.ts`, `webui/server/index.ts`, `webui/server/fs-safe.ts`, `webui/src/lib/wiki.ts`, `webui/src/components/WikiTree.tsx`, `webui/src/components/WikiLibraryHome.tsx`, `webui/src/components/WikiNewDirectoryDialog.tsx`, `webui/src/pages/WikiEditor.tsx`, and related tests. Non-browser verification passed by request: `npm test -- --run server/__tests__/wiki.test.ts src/__tests__/wiki.test.tsx`.

Browser verification passed on 2026-08-02 after Docker rebuild. Run id `m56-msbye4tr` confirmed split create actions, top-level empty directory `m56-msbye4tr-top`, child empty directory `m56-msbye4tr-top/moved`, scoped document creation/upload targets, and persistence in the directory tree.

## UX-WIKI-008: 顶层空目录创建不可发现且预览路径与实际路径不一致

Status: Verified
Route: /wiki
Area: Wiki new directory dialog
Severity: P1
Reported: 2026-08-02

### Feedback
用户此前追问 `global` 是否唯一父级、是否可以有平级目录或子目录。M51 后端支持多级目录，但浏览器复核发现前端 `新建目录` 对顶层空目录的表达仍不清楚，并出现预览路径与实际创建路径不一致。

### Evidence
- Browser check on 2026-08-02 at `http://127.0.0.1:55176/wiki`.
- In `新建目录`, clearing `父级目录` and entering `top-empty-msbpfakg` showed preview `wiki/top-empty-msbpfakg/`.
- After clicking `创建目录`, the actual directory action menu was `global/top-empty-msbpfakg 目录操作`, meaning the directory was created under `global/` rather than top-level `wiki/top-empty-msbpfakg/`.
- Browser check after Docker rebuild on 2026-08-02 still failed: clearing `父级目录` in `新建目录` reverted to `global`, and the preview became `wiki/global/browser-top-<timestamp>/`, so top-level sibling directory creation remains undiscoverable.

### Expected
`新建目录` must make top-level and child-directory creation unambiguous:

- If `父级目录` is empty, preview and submitted API request should both create top-level `wiki/<目录名>/`.
- If the product wants `global` as the default parent, the input and preview must explicitly show `wiki/global/<目录名>/` and not imply top-level creation.
- Users must have a discoverable way to create top-level sibling directories, so `global` does not appear to be the only parent.

### Browser Check
1. Open `/wiki`.
2. Click `新建目录`.
3. Clear `父级目录`, enter a unique directory name such as `ops-empty`.
4. Verify the preview is `wiki/ops-empty/`.
5. Click `创建目录`.
6. Verify the directory operation menu is `ops-empty 目录操作`, not `global/ops-empty 目录操作`.
7. Refresh `/wiki` and verify `ops-empty 0 篇` still appears as a top-level sibling of `global`.

### Notes
Discovered during post-Docker browser verification for `UX-WIKI-007`. Reopened after Docker-rebuild browser verification because the dedicated browser check still failed.

Fixed by M56 follow-up in `webui/src/pages/WikiEditor.tsx`, `webui/src/components/WikiNewDirectoryDialog.tsx`, and related tests: top-level creation now submits `{ path: name }` instead of silently nesting under `global`. Non-browser verification passed by request: `npx vitest run --maxWorkers=1 --run server/__tests__/wiki.test.ts src/__tests__/wiki.test.tsx`, `npm run build`, `npm run lint:ia-boundary`, and `git diff --check`.

Browser verification passed on 2026-08-02 after Docker rebuild. Run id `m56-msbye4tr` created top-level directory `m56-msbye4tr-top`; the directory appeared as a top-level sibling with action menu `m56-msbye4tr-top 目录操作`, not under `global`.

## UX-WIKI-009: Markdown 覆盖和编辑缺少版本记录与恢复能力

Status: Verified
Route: /wiki
Area: Wiki document governance
Severity: P1
Reported: 2026-08-02

### Feedback
用户上传同一 Markdown 两次后，页面没有位置展示首次创建日期、最新上传日期、上传记录或变更记录；进一步追问是否需要支持版本恢复，例如保留最近 5 版 Markdown、历史预览和恢复到指定版本。

### Evidence
- Browser check on 2026-08-02 confirmed the selected document page only exposes `下载 Markdown`、`上传覆盖`、`编辑` actions.
- Browser check confirmed page text does not contain `上传记录`、`首次创建`、`最新上传`、`创建日期` or `更新日期`.
- Upload overwrite preflight can replace `global/demo-superstore.md` with the local file `指标服务表设计草案.md`, creating a high-risk overwrite path without in-product restore.

### Expected
业务 Wiki 应提供企业级版本治理：

- 每篇 Markdown 默认保留最近 5 版。
- 支持 `版本记录`，展示创建、编辑保存、上传覆盖和恢复记录。
- 支持历史 Markdown 预览和当前版本 Diff。
- 支持 `恢复此版本`，恢复前展示 `恢复预检`。
- 恢复动作本身也生成新版本，保证审计链不断裂。

### Browser Check
1. Open `/wiki?key=global/demo-superstore.md`.
2. Click `版本记录`.
3. Verify recent versions are listed with operation type, timestamp, title and upload source filename when applicable.
4. Click `查看` on a historical version and verify Markdown preview and Diff are visible.
5. Click `恢复此版本` and verify `恢复预检` is shown.
6. Click `确认恢复` and verify the current document content is restored.
7. Open `版本记录` again and verify a new `恢复` record exists.

### Notes
Fixed in `webui/server/wiki.ts`, `webui/server/index.ts`, `webui/server/fs-safe.ts`, `webui/src/pages/WikiEditor.tsx`, `webui/src/components/WikiVersionHistoryDialog.tsx`, `webui/src/components/WikiRestorePreflight.tsx`, and related tests. Non-browser verification passed by request: `npm test -- --run server/__tests__/wiki.test.ts src/__tests__/wiki.test.tsx`.

Browser verification passed on 2026-08-02 after Docker rebuild at `http://127.0.0.1:55176/wiki`: selected document shows `版本记录`; a seeded document with `create` + `upload_replace` versions displayed `保留最近 5 版 Markdown 快照`, `上传覆盖`, source file `指标服务表设计草案.md`; historical `查看` showed Markdown preview and Diff; `恢复此版本` opened `恢复预检`; `确认恢复` restored current content and added a new `恢复` record.

## UX-WIKI-010: 目录操作菜单缺少删除能力

Status: Verified
Route: /wiki
Area: Wiki directory actions
Severity: P1
Reported: 2026-08-02

### Feedback
点击目录行右侧的三个点后，只能看到 `新建子目录` 和 `在此目录新建文档`，没有 `删除` 操作；这不符合企业级资源治理预期。

### Evidence
- User screenshot showed directory row overflow menu with only `新建子目录` and `在此目录新建文档`.
- User feedback explicitly called out missing `删除` button.
- Browser check after Docker rebuild on 2026-08-02 confirmed the `global 目录操作` menu still only contains `新建子目录` and `在此目录新建文档`; no delete action is present.

### Expected
目录操作菜单应提供可发现、受保护的删除能力：

- 空目录可删除。
- 非空目录删除前必须清晰说明影响范围，并要求确认。
- 删除结果应刷新目录树和文档库首页。
- 删除操作应进入审计 / 变更记录，避免误删不可追踪。

### Browser Check
1. Open `/wiki`.
2. Click a directory row `...` menu.
3. Verify menu contains `删除目录`.
4. For an empty directory, click `删除目录` and verify confirmation dialog appears.
5. Confirm deletion and verify the directory disappears after refresh.
6. For a non-empty directory, verify the UI blocks deletion or requires an explicit high-risk confirmation.

### Notes
New ledger item created from 2026-08-02 user feedback. Browser verification after Docker rebuild confirmed the issue remained open.

Fixed by M56 in `webui/server/wiki.ts`, `webui/server/index.ts`, `webui/server/fs-safe.ts`, `webui/src/components/WikiTree.tsx`, `webui/src/components/WikiDeleteDirectoryDialog.tsx`, `webui/src/pages/WikiEditor.tsx`, and related tests. Non-browser verification passed by request: `npx vitest run --maxWorkers=1 --run server/__tests__/wiki.test.ts src/__tests__/wiki.test.tsx`, `npm run build`, `npm run lint:ia-boundary`, and `git diff --check`.

Browser verification passed on 2026-08-02 after Docker rebuild. Empty directory delete was visible and enabled; non-empty directory `m56-msbye4tr-top` showed disabled `删除目录` with title `该目录下仍有 Markdown 文档或子目录，请先移动或删除内容。`.

## UX-WIKI-011: Markdown 文档缺少移动目录能力

Status: Verified
Route: /wiki
Area: Wiki document actions
Severity: P1
Reported: 2026-08-02

### Feedback
`Demo Superstore` 缺少移动 folder 的能力；用户无法把现有 Markdown 文档移动到其它目录。

### Evidence
- User feedback explicitly mentioned `Demo Superstore` lacks move-folder capability.
- Current selected-document actions focus on `下载 Markdown`、`版本记录`、`上传覆盖`、`编辑`，未形成独立 `移动` 流程。
- Browser check after Docker rebuild on 2026-08-02 confirmed selected `global/demo-superstore.md` only shows `下载 Markdown`、`版本记录`、`上传覆盖`、`编辑`; no `移动` / `移动到目录` action is visible.

### Expected
已保存 Markdown 文档应支持移动目录：

- 文档操作区提供 `移动到目录`。
- 可选择已有目录或输入新目录。
- 移动前展示目标路径预检。
- 移动后目录树、URL、当前文档内容和版本记录保持一致。
- 移动操作应保留历史版本链，并生成 `move` 记录。

### Browser Check
1. Open `/wiki?key=global/demo-superstore.md`.
2. Locate document-level actions.
3. Verify there is a `移动到目录` action.
4. Move the document to a test directory.
5. Verify URL,目录树和文档正文仍指向移动后的文档。
6. Open `版本记录` and verify a `移动` record exists.

### Notes
New ledger item created from 2026-08-02 user feedback. Browser verification after Docker rebuild confirmed the issue remained open.

Fixed by M56 in `webui/server/wiki.ts`, `webui/server/index.ts`, `webui/src/components/WikiMoveDocumentDialog.tsx`, `webui/src/pages/WikiEditor.tsx`, and related tests. Follow-up hardening ensures move preview responses cannot overwrite a newer target-directory preview, and the move API now always blocks target-key conflicts instead of accepting hidden overwrite. Non-browser verification passed by request: `npx vitest run --maxWorkers=1 --run server/__tests__/wiki.test.ts src/__tests__/wiki.test.tsx`, `npm run build`, `npm run lint:ia-boundary`, and `git diff --check`.

Browser verification passed on 2026-08-02 after Docker rebuild. Run id `m56-msbye4tr` moved `global/m56-msbye4tr-upload.md` to `m56-msbye4tr-top/moved/m56-msbye4tr-upload.md`; URL, directory tree, document body, and `版本记录` all reflected the moved document, including a `移动` history entry.

## UX-WIKI-012: 下载 Markdown 的作用域不清晰

Status: Verified
Route: /wiki
Area: Wiki document actions
Severity: P2
Reported: 2026-08-02

### Feedback
`下载 Markdown` 的位置虽然好，但用户没有看到明确的“选定 md”能力，不确定按钮默认下载当前文档还是全部下载。

### Evidence
- User feedback asked whether `下载 Markdown` 默认是全部下载。
- 当前按钮文案缺少作用域提示；在选中文档页才出现，但用户仍需要推断。
- Browser check after Docker rebuild on 2026-08-02 confirmed the selected-document action is still labeled `下载 Markdown`, has no tooltip, and does not show `下载当前 Markdown` anywhere on the page.

### Expected
下载命令应明确作用域：

- 单文档页按钮文案或 tooltip 明确为 `下载当前 Markdown`。
- 如未来支持批量下载，应提供独立 `下载全部` / `导出目录` 操作，不能和当前文档下载混用。
- 下载前如存在未保存编辑，应继续提示下载的是已保存版本。

### Browser Check
1. Open `/wiki?key=global/demo-superstore.md`.
2. Locate download action.
3. Verify visible text or tooltip makes scope clear as current selected Markdown.
4. Open `/wiki` library home and verify no ambiguous single-document download action appears.

### Notes
New ledger item created from 2026-08-02 user feedback. Browser verification after Docker rebuild confirmed the issue remained open.

Fixed by M56 in `webui/src/pages/WikiEditor.tsx` and related tests: selected-document download is labeled `下载当前 Markdown` and the library home does not expose a single-document download action. Non-browser verification passed by request: `npx vitest run --maxWorkers=1 --run server/__tests__/wiki.test.ts src/__tests__/wiki.test.tsx`, `npm run build`, `npm run lint:ia-boundary`, and `git diff --check`.

Browser verification passed on 2026-08-02 after Docker rebuild. Selected document pages show `下载当前 Markdown`; the `/wiki` library home does not show an ambiguous single-document download action.

## UX-WIKI-013: 上传后文件不可发现且覆盖预检目标表达不清

Status: Verified
Route: /wiki
Area: Wiki upload flow
Severity: P1
Reported: 2026-08-02

### Feedback
用户上传电脑“下载”目录中的 `指标服务表设计草案.md` 后，在目录中没有看到该 Markdown；二次上传同一位置时出现 `上传覆盖预检`，但目标路径 / 覆盖对象表达让用户觉得怪。

### Evidence
- User feedback stated uploaded `指标服务表设计草案.md` was not visible in the directory.
- User screenshot of `上传覆盖预检` showed目标为 `wiki/global/demo-superstore.md`，解析摘要标题却是 `指标服务表设计草案`，容易让用户误解是文件名覆盖还是当前文档内容覆盖。
- Browser check after Docker rebuild on 2026-08-02 confirmed the selected-document page still exposes `上传覆盖`; automated file chooser control was unavailable in the current browser harness, so the full upload-preflight reproduction remains pending.

### Expected
上传流程必须让“本地文件名、目标 Wiki 路径、覆盖对象”三者清晰一致：

- 上传新文档后，目录树应立即显示新文档，且当前选中该文档。
- 上传覆盖时，预检应清楚展示“本地文件名”和“将覆盖的 Wiki 文档路径 / 标题”。
- 如果本地文件名与目标 Wiki key 不一致，应突出警告并要求确认。
- 二次上传同一文件时，应能解释为什么进入覆盖流程。

### Browser Check
1. Open `/wiki`.
2. Upload a local Markdown file such as `指标服务表设计草案.md` as new document.
3. Verify the directory tree shows `指标服务表设计草案` or对应标题，并且当前选中该文档。
4. Upload the same file again to the same target.
5. Verify `上传覆盖预检` clearly shows local filename, target Wiki path, existing title and proposed title.
6. Confirm or cancel and verify no ambiguous state remains.

### Notes
New ledger item created from 2026-08-02 user feedback. Related but not covered by `UX-WIKI-009`: version history mitigates recovery risk, while this item tracks upload target discoverability and preflight wording. Full browser reproduction still needs a file-upload-capable harness or manual file selection.

Fixed by M56 in `webui/server/wiki.ts`, `webui/server/index.ts`, `webui/src/components/WikiUploadPreflight.tsx`, `webui/src/pages/WikiEditor.tsx`, and related tests. Upload preview and commit now carry the local `sourceFileName`, display the `wiki/<key>` target path, show existing/proposed titles, warn on basename mismatch, and commit from the current preflight result to avoid stale target state. Non-browser verification passed by request: `npx vitest run --maxWorkers=1 --run server/__tests__/wiki.test.ts src/__tests__/wiki.test.tsx`, `npm run build`, `npm run lint:ia-boundary`, and `git diff --check`.

Browser verification passed on 2026-08-02 after Docker rebuild. New upload preflight showed local filename `m56-msbye4tr-upload.md`, target path `wiki/global/m56-msbye4tr-upload.md`, and selected the new document after commit. Overwrite preflight for `m56-msbye4tr-top/moved/m56-msbye4tr-upload.md` showed local filename `m56-msbye4tr-replacement.md`, target Wiki path, current overwritten title, proposed title, basename mismatch warning, and Diff.

## UX-WIKI-014: Wiki 目录小三角与首页目录树视觉噪音

Status: Verified
Route: /wiki
Area: Wiki sidebar directory tree, Markdown library home
Severity: P2
Reported: 2026-08-03

### Feedback
`/wiki` 多处使用 `▼` / `▶` / `▾` / `▸` 等小三角 glyph：左侧目录 row 把它们当作展开 / 收起 affordance，右侧文档库又把它们当作纯装饰。统一问题：
1. 目录 toggle 中的 `▶` / `▼` 视觉语义与光标反馈（cursor / hover underline）不一致，用户分不清"可点 / 不可点"。
2. 右侧 Markdown 文档库里的 `▾` 是不可点装饰却长得像可展开控件，造成误导。
3. 全文多区域叠加 `font-semibold`（左侧 `目录` 标题、目录 row、文档库分组标题、hero title），同屏粗体过多。

### Evidence
- 2026-08-03 browser check at `http://127.0.0.1:55176/wiki`：左侧目录 row 渲染 `▶` / `▼`；右侧 Markdown 文档库的目录 group header 渲染 `▾`。
- `webui/src/components/WikiTree.tsx:135` 与 `webui/src/components/WikiLibraryHome.tsx:73` 命中 `▾` / `▼` / `▶` 字符。
- `webui/src/app/app.css` `.pl-wiki-tree-group-toggle` / `.pl-wiki-tree-group-caret` / `.pl-wiki-library-group-title` / `.pl-wiki-sidebar-title` 均使用 `font-semibold`。

### Expected
- 移除所有 `▼` / `▶` / `▾` / `▸` glyph；目录 row 用 row hover、`aria-expanded` 与可访问名称表达展开 / 收起，不依赖视觉字符。
- 目录名 / 文档库分组名 / 文档库 hero title 等不再大面积 `font-semibold`，统一收敛到 `font-medium`，让"可操作文档"成为视觉焦点。
- thead / 强语义保留 `font-semibold`（例如 `wiki-read-title`、`pl-wiki-preflight-title`）以维持全局 PageHeader 与 dialog 标题的视觉锚点。

### Browser Check
1. Open `/wiki`.
2. Verify 可见 DOM 文本不再出现 `▼` / `▶` / `▾` / `▸`。
3. Verify 左侧目录 row 仍是可点击 button，`aria-expanded` 表达展开状态。
4. Verify 目录名 / 文档库分组名 / sidebar 标题字重明显减弱。

### Notes
Fixed by M64 in `webui/src/components/WikiTree.tsx`（移除 `▶` / `▼` 字符，仅保留 label + count；toggle 暴露 `title` 表达"展开 / 收起"）、`webui/src/components/WikiLibraryHome.tsx`（目录 group 不再渲染，改为 Markdown 文档列表）、`webui/src/app/app.css`（`.pl-wiki-sidebar-title` 改 `font-medium`、`.pl-wiki-tree-group-toggle` 改 `font-medium` 并补 `cursor-pointer`、`.pl-wiki-library-group-title` 隐藏、`pl-wiki-tree-page--active` 改 `font-medium`、`.pl-wiki-tree-group-caret` 隐藏占位）和 `webui/src/__tests__/wiki.test.tsx`（新增 `Wiki home and tree visual clarity (M64)` describe block）。Non-browser 验证通过：`npm test -- src/__tests__/wiki.test.tsx`（59/59）、`npm run lint:terminology`、`npm run build`、`git diff --check`。

Browser verification passed on 2026-08-04 after Docker rebuild at `http://127.0.0.1:55176/wiki`. inspect observed: visible DOM text contained no `▼` / `▶` / `▾` / `▸` glyph at all; directory toggle buttons rendered as real `<button>` with `aria-expanded="true"` / `"false"`, `aria-label` like `global 1 篇，收起目录`, plus `title` 表达 展开/收起 (source `WikiTree.tsx` 改为 `title={isOpen ? "收起 ${display} 目录" : "展开目录"}`); `WikiTree` 与 `app.css` 字符级 grep `▼▶▾▸` 在仓库内不再命中（仅 `TableEditor.tsx` 历史残留，与本工单范围无关）。

## UX-WIKI-015: Wiki 首页从目录树复述改为 Markdown 文档列表

Status: Verified
Route: /wiki
Area: Markdown library home IA
Severity: P1
Reported: 2026-08-03

### Feedback
`/wiki` 首页 hero `Markdown 文档库 / 按目录管理业务口径文档 / 当前收录 N 篇 Markdown 文档，分布在 N 个目录中。` 信息价值低：标题与左侧目录重复，subtitle 是产品话术，统计句是唯一有用信息。右侧再用 `DirectorySection` 递归渲染完整目录 group + 文档列表，又跟左侧 `WikiTree` 重复。两层重复让用户进入首页后不知道该看哪一边。

### Evidence
- 2026-08-03 browser check at `http://127.0.0.1:55176/wiki`：右侧第一屏可见 4 个目录 group（`global` / `kx` / `poc` / 根目录）以及 hero 大字标题；左侧 `pl-wiki-tree` 也展示同一组目录结构。
- `webui/src/components/WikiLibraryHome.tsx` 命中 `Markdown 文档库` kicker、`按目录管理业务口径文档` title、`<DirectorySection>` 递归展开。

### Expected
- hero 退化为紧凑 summary band，仅保留 `当前收录 N 篇 Markdown 文档，分布在 N 个目录中。`；`Markdown 文档库` 仅保留为 `aria-label` / section label，不再与 PageHeader 抢视觉。
- 右侧主体改为 flat Markdown 文档列表：每行展示 `MD` 徽标 + 文档标题 + `wiki/<key>` 路径 metadata。
- 列表为空时显示 `还没有 Wiki 文档。` 与主操作入口。

### Browser Check
1. Open `/wiki`.
2. Verify 不再出现 `按目录管理业务口径文档` 文案。
3. Verify summary 文案 `当前收录 N 篇 Markdown 文档，分布在 N 个目录中。` 仍然存在。
4. Verify 右侧只展示 Markdown 文档列表（含标题 + 路径 metadata），不再渲染目录 group header。
5. Verify 空 fixture 下显示 `还没有 Wiki 文档。` 并不破坏主操作入口。

### Notes
Fixed by M64 in `webui/src/components/WikiLibraryHome.tsx`（移除 hero、移除 `<DirectorySection>`，新增 flat `<ul data-testid="wiki-library-documents">` + `<li data-testid="wiki-library-document">`；保留 `buildWikiDirectoryTree` 仅用于 `directoryCount` 统计）和 `webui/src/app/app.css`（`.pl-wiki-library-summary` / `.pl-wiki-library-documents` / `.pl-wiki-library-document*` 新增，旧的 `.pl-wiki-library-hero` / `.pl-wiki-library-group*` 类收敛为占位以兼容外部选择器）。Non-browser 验证通过：`npm test -- src/__tests__/wiki.test.tsx`（59/59，含 `collapses the /wiki home hero to the statistics summary and renders a Markdown document list (M64)` 与既有的 `renders the neutral Markdown library home when the key is empty` / `renders empty directories from the API as independent resources`）。

Browser verification passed on 2026-08-04 after Docker rebuild at `http://127.0.0.1:55176/wiki`. inspect + text-query observed: visible DOM no longer contained `按目录管理业务口径文案` hero 标题；`data-testid="wiki-library-summary"` rendered text `当前收录 2 篇 Markdown 文档，分布在 11 个目录中。`；`data-testid="wiki-library-documents"` contained two `<li>` rows, each with `MD` 徽标 + 标题 + `wiki/<key>` 路径 metadata (`demo-superstore` / `wiki/global/demo-superstore.md` 和 `m56-msbye4tr upload validation` / `wiki/m56-msbye4tr-top/moved/m56-msbye4tr-upload.md`)；没有 `.pl-wiki-library-group-title` 目录 group header 渲染。

## UX-WIKI-016: 上传 Markdown 预检目标与解析摘要层级不清

Status: Verified
Route: /wiki
Area: Wiki upload preflight IA
Severity: P2
Reported: 2026-08-03

### Feedback
`上传 Markdown 预检` 目标 section 包含 `目标` section title + `目标目录` input + `目标 Wiki 路径` preview + `将新建 Markdown 文档。` 段落；标题与说明混在一起，`.md` 文件路径与目录共用 `<code className="pl-wiki-preflight-target">` 难以一眼分清。解析摘要里 `本地文件名 / 目标 Wiki 路径 / 目标位置 / 上传后标题 / 关联表` 五个字段挤在一段裸 `<dl>`，`<dt>` / `<dd>` 没有视觉层级，`关联表` 段落到 `<dl>` 之外成为游离 `<p>`。

### Evidence
- 2026-08-03 browser check at `http://127.0.0.1:55176/wiki` 的上传预检：目标 section 同时含 `目标` 标题、`目标目录` 输入框、`wiki/...md` 路径 code、`将新建 Markdown 文档。` 段落；解析摘要 `<dt>` 与 `<dd>` 同字号无对比；`关联表` 段落在 `<dl>` 之后。
- `webui/src/components/WikiUploadPreflight.tsx` 命中 `目标` / `目标目录` / `将新建 Markdown 文档。` / 游离的 `关联表` `<p>`。

### Expected
- 目标 section 区分 `目标目录` input（仅 create mode）、`目标 Wiki 路径` 路径预览、新建 / 覆盖 status badge；不再用大段说明文字。
- 解析摘要用两列 description list：`<dt>` 12px muted，`<dd>` 14px 正文或 500（标题值）；`关联表` 进入 `wiki-upload-summary-refs` row。
- 新增 scoped CSS（`.pl-wiki-preflight-summary-list` / `.pl-wiki-preflight-summary-row` / `.pl-wiki-preflight-summary-label` / `.pl-wiki-preflight-summary-value` / `.pl-wiki-preflight-target-status` / `.pl-wiki-upload-target-path`），仅影响 upload preflight；保存 / 恢复 / 移动预检继续使用 `.pl-wiki-preflight-*` 共享样式，不被污染。

### Browser Check
1. Open `/wiki`，点击 `上传 Markdown`，选择测试 `.md` 文件进入预检，不点击最终确认。
2. Verify 目标 section 同时含 `目标目录` 输入框 + `目标 Wiki 路径` 预览 + 新建 / 覆盖 status badge，不再出现 `将新建 Markdown 文档。` 段落。
3. Verify 解析摘要每行是稳定两列 description list（label / value），`关联表` 进入 summary row。

### Notes
Fixed by M64 in `webui/src/components/WikiUploadPreflight.tsx`（目标 section 拆为 `目标目录` input + `目标 Wiki 路径` `<dl>` preview + `wiki-upload-target-status` badge；解析摘要每个 row 加 `pl-wiki-preflight-summary-label` / `pl-wiki-preflight-summary-value` className；新增 `wiki-upload-summary-refs` row 容纳 `关联表`）、`webui/src/app/app.css`（新增 scoped 规则）和 `webui/src/__tests__/wiki.test.tsx`（新增 `separates 目标目录 / 目标 Wiki 路径 / status badge in the upload preflight (M64)`）。Non-browser 验证通过：`npm test -- src/__tests__/wiki.test.tsx`（59/59）。

Browser verification passed on 2026-08-04 after Docker rebuild by `upload_files` 选中 `webui/inbox/m64-upload-test.md` 进入预检 modal 并取消。inspect + text-query on the M64 testids observed: `wiki-upload-target-path` rendered `目标 Wiki 路径\nwiki/global/m64-upload-test.md`; `wiki-upload-target-status` rendered `将新建 Markdown 文档`（`create` 模式 badge）；`wiki-upload-summary-source` = `本地文件名\nm64-upload-test.md`; `wiki-upload-summary-target` = `目标 Wiki 路径\nwiki/global/m64-upload-test.md`; `wiki-upload-summary-existing` = `目标位置\n新建文档`; `wiki-upload-summary-title` = `上传后标题\nM64 上传预检浏览器验证`; `wiki-upload-summary-refs` = `关联表\n未声明关联表`（独立 row，不再游离）；目标区不再有 `将新建 Markdown 文档。` 整段 paragraph。

## UX-WIKI-017: Wiki 目录 row 展开/收起 affordance 偏弱

Status: Open
Route: /wiki
Area: Wiki sidebar directory tree
Severity: P3
Reported: 2026-08-04

### Feedback
M64 移除 `▶` / `▼` glyph 后，目录 toggle button 仅靠 `cursor-pointer` + hover bg + `aria-expanded` 表达可点。鼠标未悬停时行与普通 label 视觉差异极小，屏幕阅读器用户以外难以看出"这里可点"。需补视觉 affordance 但不能再走装饰三角 glyph 老路。

### Evidence
- 2026-08-04 browser check at `http://127.0.0.1:55176/wiki`：mouse-off 状态下 `global 1 篇，收起目录` / `test 0 篇，收起目录` 行与同位置非 toggle 文本在 font / color / background 上几乎无差别。
- `webui/src/components/WikiTree.tsx` 当前 toggle 仅依赖 `cursor-pointer`（className 内联）+ `aria-expanded` + `title`。
- 与 `README` 跨页面主题索引中 `chevron affordance` 主题直接相关。

### Expected
- 目录 row 在未 hover 状态下也保留可识别 affordance：可使用 chevron svg icon（向下 / 向上，箭头不依赖 unicode 字符），或加 4px 宽的 active marker / 持续可见的图标列。
- 保留 `aria-expanded` / `aria-label` / `title` 不变；新增 chevron 用 `aria-hidden="true"` 避免重复 announce。
- 与 README 规则 "展开/收起 affordance 不得使用不可交互或语义不清的装饰三角 glyph" 一致——chevron svg 是 icon 不是 glyph。

### Browser Check
1. Open `/wiki`.
2. Verify 鼠标未悬停时，目录 row 仍有可识别 affordance（chevron icon / active marker / 可见图标列）。
3. Verify 点击行仍能展开 / 收起，`aria-expanded` 与 `aria-label` 同步更新。
4. Verify chevron 方向与展开状态一致（展开时向下 / 收起时向右）。
5. Verify 屏幕阅读器只 announce `aria-label`，不重复 announce chevron。

### Notes
2026-08-04 由 M64 浏览器复核发现并登记，等候选 wave（M65 候选）排期。建议修复文件：`webui/src/components/WikiTree.tsx`（toggle 内部加 chevron svg，`aria-hidden`）+ `webui/src/app/app.css`（chevron 旋转动效）+ `webui/src/__tests__/wiki.test.tsx`（新增 describe 块断言 chevron 存在且与 `aria-expanded` 联动）。

## UX-WIKI-018: Wiki 首页统计 "N 个目录" 与 sidebar 空目录视觉冲突

Status: Open
Route: /wiki
Area: Markdown library home IA
Severity: P3
Reported: 2026-08-04

### Feedback
`/wiki` 首页 summary `当前收录 2 篇 Markdown 文档，分布在 11 个目录中。` 的 "11 个目录" 与左侧 sidebar 大量 `0 篇` 空目录（`test` / `top-empty-*` / `xxx` / `xxx22` / `ux-wiki-007-*` / `playbooks` 等）视觉冲突：用户读 "11" 去 sidebar 数到一堆 0 篇会疑惑 "为什么这么多空目录也算目录"。这反映当前 `buildWikiDirectoryTree` 把任意 `directories[]` entry 都计入 `directoryCount`，未区分"实际承载文档的目录"与"仅声明存在的空目录"。

### Evidence
- 2026-08-04 browser check at `http://127.0.0.1:55176/wiki`：summary 数字 "11 个目录"；sidebar `aria-expanded="true"` 顶层目录含 `global` / `m56-msbye4tr-top` 等，但 child 节点里有 9 个 `0 篇` 空目录。
- `webui/src/components/WikiLibraryHome.tsx` 当前 `directoryCount` 来自 `buildWikiDirectoryTree` 对 `directories[]` 的全部 entry count。
- 与 README 跨页面主题索引中 `empty-state clarity` 主题相关，需要产品拍板口径。

### Expected
- 产品口径需要先决定 "summary 数字应该统计什么"：
  - 选项 A：仅统计实际承载文档的目录（`pages > 0`），忽略空目录 → 数字更接近用户直观感受但与 sidebar 总数不一致。
  - 选项 B：保留全部目录计数，但 sidebar 加 "隐藏空目录" 折叠 / 筛选，用户主动选择看哪些。
  - 选项 C：summary 改为 `当前收录 2 篇 Markdown 文档，分布在 2 个有内容的目录 + 9 个待填充空目录中。`（最透明但 sentence 偏长）。
- 在产品口径敲定前，Open 状态保留，不强行修复。

### Browser Check
1. Open `/wiki`.
2. 读取 summary 数字。
3. 数 sidebar 里 0 篇空目录数。
4. 若 product decision 已确定，verify summary 数字与口径一致。
5. 若口径为 A，verify sidebar 仍有完整目录（仅 summary 数字收敛）；若口径为 B，verify 有"隐藏空目录"交互。

### Notes
2026-08-04 由 M64 浏览器复核发现并登记，依赖产品口径决定。等候选 wave（待定）排期，不在 M65 / M66 强修复范围内。Demo fixture 的空目录来自 `webui/server/wiki.ts` 的 fixture 数据，本身不是 bug；bug 在 UI 口径而不是数据。
