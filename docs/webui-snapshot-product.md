# Lucy 桌面端定时截图库 (snapshot-product)

| 元数据 | 内容 |
|---|---|
| 文档名称 | Lucy 桌面端定时截图库 |
| 文档类型 | Implementation Spec |
| 版本 | v0.1 |
| 撰写日期 | 2026-08-02 |
| 撰写人 | 架构师（Claude Thinker） |
| 适用范围 | Lucy WebUI 桌面端全屏自动化截图库的维护与调度 |
| 状态源 | 初版，待 reviewer（架构师自身 review + minimax/codex 实施后回归） |
| 关联文档 | `docs/DEVELOPMENT.md`、`docs/webui-feature-map.md`、`docs/webui-module-guide.md`、`webui/src/app/App.tsx`、`webui/docs/00-product-terminology-standard.md` |

> **当前进度**：本 spec 已收口 7 个核心设计决策，待 minimax/codex 按本 spec 实施 `webui/scripts/snapshot-product.mjs`，由 code 写 launchd plist 调度配置。本 spec 不覆盖 plist 实现细节，仅约定调度接口契约。

---

## 1. 目标与非目标

### 1.1 目标

定期（频率由 code 决定）以桌面端全屏视口（1440×900）自动截取 Lucy WebUI 每个路由页与页内关键按钮点击后的稳态画面，形成**版本化、可重放、可检索**的产品截图库，作为：

- 产品演进的可视化时间线
- reviewer 验收模块能力现状的辅助资料
- 客户沟通与交付物素材来源（按需）

### 1.2 非目标

- 不做移动窄屏截图（项目约定：默认不需要移动窄屏测试，见 `AGENTS.md` §浏览器测试约束）
- 不做交互流（多步骤）截图——只截"按钮点击后的稳态"
- 不做视觉差异比对 / 视觉回归（这是另一条产品线，已有 `tests/golden/`）
- 不录视频、不录动画
- 不截未在 `App.tsx` 注册的私有页面（仅路由表覆盖范围）
- 不写入数据库、不修改任何 YAML / KPI 配置——**纯只读**

---

## 2. 已收口的设计决策

| # | 决策点 | 结果 | 备注 |
|---|---|---|---|
| 1 | 清单来源 | **自动反射** | 解析 `webui/src/app/App.tsx` 提取路由 + 运行时扫描按钮 |
| 2 | 视口尺寸 | **1440×900** | 兼容 MacBook 13"；与现有 `output/overview/overview-1440.png` 对齐 |
| 3 | 运行环境 | **host 跑 Playwright + Chromium，访问 docker 5174** | 复用 `webui/node_modules/playwright` |
| 4 | 截图范围 | **仅稳态**（一图一按钮） | `page.click()` → 等待稳态 → 截图 |
| 5 | 调度方式 | **macOS launchd** | plist 由 code 写，本 spec 只给接口契约 |
| 6 | 调度频率 | **由 code 指定** | 本 spec 不规定 |
| 7 | 按钮黑名单 | **默认全免** | 删除/重置/登出/取消/关闭/跳转型链接默认不点 |

---

## 3. 复用基础

| 资源 | 路径 | 复用方式 |
|---|---|---|
| Playwright + Chromium | `webui/node_modules/playwright` | 直接 `import { chromium } from 'playwright'`，不新增依赖 |
| Playwright 配置 | `webui/playwright.config.ts` | 不复用 webServer（见 §5.2）；其余可参考 |
| 现有截图脚本模板 | `webui/screenshot.mjs`、`webui/scripts/screenshot-overview.mjs`、`webui/scripts/screenshot-connections.mjs` | 参考抓取模式，不重写其功能 |
| 路由权威清单 | `webui/src/app/App.tsx`（210–240 行附近） | **唯一来源**，新脚本不重复声明 |
| 术语规范 | `webui/docs/00-product-terminology-standard.md` | 模块 slug 与按钮标签从规范派生 |
| selector 契约 | `docs/qa/selector-contract.md` | 反射按钮时优先用契约约定的 selector |
| Docker 入口 | `http://localhost:5174/overview`（容器 `project-lucy-lucy-1`） | 截图脚本的统一目标 URL |
| 现有输出目录习惯 | `output/overview/`、`inbox/lucy-screenshots/` | 新增正式库 `var/screenshots/`（已在 `.gitignore`，不发布）；旧路径保留一次性产物 |

**新脚本落位**：`webui/scripts/snapshot-product.mjs`（单一入口，便于定时任务调用）。

---

## 4. 路由与按钮反射（核心设计）

这是 spec 最核心的部分。自动反射意味着**代码即清单**——脚本不需要 manifest YAML 输入，但**必须明确反射策略**。

### 4.1 路由解析

**输入**：`webui/src/app/App.tsx`（含 `<Routes><Route path="..." element={...} />`）

**解析策略**：使用 AST 解析，**不**用正则（避免脆弱）。

- 推荐：`@typescript-eslint/parser` + `@typescript-eslint/scope-manager`，或 `ts-morph`、`@swc/core`
- 若不想引入新依赖，可使用 `webui/node_modules` 里已有的 TypeScript / Babel 解析器（避免新增 `webui/package.json` 依赖）

**解析产物**：路由数组 `[{path, elementComponentName}]`

**已知约束**：
- 仅解析顶层 `<Route>`，递归解析嵌套 `<Route>`（如有）
- 忽略 `path="*"` 通配路由
- 忽略 `index` 路由（用其父路径替代）
- 动态参数路径（如 `:id`）需要 fixture 数据；见 §4.5

### 4.2 Lazy 模块覆盖

`App.tsx` 中可能存在 `React.lazy(() => import(...))` 动态导入。脚本必须能识别 lazy 包装的元素组件：

- 解析 `element` 表达式，提取实际组件名（绕过 `lazy()` 与 `Suspense` fallback）
- 若无法静态解析，**跳过该路由 + 记录警告到 `_warnings.log`**，不中断整体作业

### 4.3 按钮扫描

**输入**：每个路由对应的页面组件（运行时实际渲染的 DOM）

**扫描时机**：`page.goto(route)` → `page.waitForLoadState('networkidle')` → 在当前上下文扫描

**扫描范围**：
- `<button>` 元素（非 `type="hidden"`、非 `disabled`）
- `<a href>` 元素（仅 `#` 开头的锚点视为按钮；外部链接跳过）
- `<input type="button"|"submit">`
- `[role="button"]` ARIA 按钮
- **不**扫描 `<select>`、`<input type="text">` 等表单控件（本任务只截按钮点击后的稳态，不截表单填写）

### 4.4 Selector 优先级

每个按钮必须能稳定定位。优先级（从高到低）：

1. `[data-testid="..."]`（项目若有约定）
2. `[aria-label="..."]`
3. `[data-snapshot-target="true"]`（**新增约定**：见 §4.7，让页面开发者标注必须截图的按钮）
4. 通过文本内容匹配的稳定定位（XPath/CSS 含可见文本）

**Selector 必须满足**：
- 同一按钮多次运行结果稳定
- 不依赖页面随机 ID
- 失败时能落到 fallback（降低截图成本）

**优先级理由**：保证幂等性，避免文本翻译 / 复制粘贴顺序变化导致截图漂移。

### 4.5 黑名单机制

默认黑名单（spec 冻结，不通过配置改）：

| 模式 | 匹配方式 | 默认动作 |
|---|---|---|
| `text=删除` | 文本包含 | 跳过 |
| `text=移除` | 文本包含 | 跳过 |
| `text=重置` | 文本包含 | 跳过 |
| `text=登出\|退出登录\|注销` | 文本正则 | 跳过 |
| `text=取消` | 文本包含 | 跳过 |
| `text=关闭` | 文本包含 | 跳过 |
| `[aria-label*="close" i]` | 属性正则 | 跳过 |
| `[aria-label*="dismiss" i]` | 属性正则 | 跳过 |
| `<a href="...">` 外部跳转 | `href` 以 `http://`、`https://`、`mailto:` 开头 | 跳过（防止离开 Lucy 域） |
| `<a href="/admin/...">` 等受限路由 | href 白名单外 | 跳过（不暴露敏感页） |

**可扩展点**：脚本应支持读取 `webui/scripts/snapshot-product.blacklist.json`（可选）追加自定义规则，**默认文件不存在即走纯默认黑名单**。

### 4.6 路由参数处理

动态路由如 `/connections/:id`、`/catalog/:conn/:schema/:table` 需要 fixture：

- 脚本读取 `webui/scripts/snapshot-product.fixtures.json`（可选）
- 不存在时**跳过该路由 + 记录到 `_skipped.log`**，不中断
- fixture 格式示例：

  ```json
  {
    "/connections/:id": [{"id": "demo-1"}, {"id": "demo-2"}],
    "/catalog/:conn/:schema/:table": [
      {"conn": "mysql_demo", "schema": "public", "table": "orders"}
    ]
  }
  ```

- 每个 fixture 实例生成一个独立子目录（见 §6）

### 4.7 显式标注机制（新增约定）

为支持反射之外的"开发者主动声明"，引入约定属性 `data-snapshot-target="true"`：

- 页面开发者给需要被截图脚本识别的按钮/区块加此属性
- 这是**可选最佳实践**，缺省时脚本按 §4.4 selector 优先级自动识别
- 文档位置：本 spec §10 同步告知 WebUI 开发者（不在本 spec 范围落地）

---

## 5. 执行流

### 5.1 整体流程

```
单次截图作业生命周期：
  1. 读环境变量（见 §7.2）
  2. 健康检查（见 §5.2）—— 失败则 abort
  3. 解析 App.tsx 拿到路由表
  4. 加载 fixtures（若有）
  5. 计算 output 目录：`var/screenshots/{app_tsx_sha}/{YYYY-MM-DD-HHmm}/`
     - 若目录已存在（同 SHA + 同分钟），覆盖（同分钟通常只发生在手工 rerun；自动调度按分钟级自然隔开）
  6. 启动 Chromium，viewport = 1440×900
  7. for route in routes:
       a. goto(route)
       b. 等待 networkidle
       c. 截 {NN}-{route-slug}.png  ← 路由首屏
       d. 扫描按钮（含 fixture 实例化的变体）
       e. for button in (buttons - blacklist):
            i.   page.click(button.selector)
            ii.  page.waitForLoadState('networkidle') 或 waitForSelector(button.wait_for)
            iii. 截 {MM}-{button-slug}.png
            iv.  复原：若点击后发生路由跳转，goto(route) 重新进入；否则按 Esc / 点击取消按钮复原
       f. 关闭本路由的 page.context（每个路由独立 context 隔离）
  8. 写出 _manifest.json（见 §6.4）
  9. 关闭浏览器
```

### 5.2 健康检查

作业启动前必须验证：

```bash
curl -fsS -o /dev/null -w "%{http_code}" http://localhost:5174/overview
```

期望 `200`。否则 abort 并写错误到日志。**此检查由 launchd plist 的前置脚本或 entrypoint 脚本承担**（脚本必须提供 `--healthcheck` 子命令供调度器调用）。

### 5.3 单次作业生命周期（launchd 视角）

```
launchd → com.lucy.snapshot.plist
  → RunAtLoad: false, StartCalendarInterval: {Hour: X, Minute: Y}
  → ProgramArguments: [/path/to/webui/scripts/snapshot-product.mjs]
  → EnvironmentVariables: {LUCY_SNAPSHOT_BASE_URL, LUCY_SNAPSHOT_OUTPUT_DIR, ...}
  → StandardOutPath / StandardErrorPath: var/logs/snapshot-product.{out,err}.log
```

plist 的具体内容由 code 写，本 spec 不规定。

---

## 6. 输出规范

### 6.1 目录结构

输出根：**`var/screenshots/`**（已在 `.gitignore` 内，不会被 github 发布）。

```
var/screenshots/
  {app_tsx_sha_short}/                    # App.tsx 文件内容 SHA-256 前 8 位（按内容分组，非按 git commit）
    {YYYY-MM-DD-HHmm}/                    # 作业执行时间（含分钟，保证同日多次跑各自独立）
      01-overview/                        # 模块子文件夹：每个模块一个，NN + 模块 slug
        01-overview.png                   # 模块首屏
        02-click-connect-data-source.png  # 该模块下第 1 个按钮
        03-click-add-join.png             # 该模块下第 2 个按钮
        ...
        _meta.json                        # 模块级 sidecar（见 §6.4）
      02-connections/                     # 下一个模块
        01-connections.png
        ...
        _meta.json
      _manifest.json                      # 作业级 sidecar
      _errors.json                        # 失败步骤记录（若无则不写）
      _warnings.log                       # 警告（lazy 未解析等）
      _skipped.log                        # 跳过的路由（缺 fixture 等）
```

**结构要点**：
- **每个模块一个子文件夹**（`01-overview/`、`02-connections/` ……）—— 用户硬性要求
- **时间戳精确到分钟**——保证同日多次跑各自独立；仅手工 rerun 同分钟才会幂等覆盖
- **`app_tsx_sha` 而非 `git_sha`**——自动反射的覆盖范围由 App.tsx 决定，与 git commit 关联弱；用文件 SHA 能直接回答"今天的截图反映的是哪个版本的路由表"
- **历史不删**——SHA / 时间变化 → 新目录；旧目录永久保留（无上限，膨胀后单独工单处理）

### 6.2 命名

- 路由目录：`NN-{route-slug}/`，两位序号左补零
- 文件：`NN-{button-slug}.png`，两位序号左补零
- 所有 slug 小写、连字符分隔、ASCII 英文（中文标题写进 sidecar，不入路径）
- 路由 slug 来源：`webui/docs/00-product-terminology-standard.md` 或路径清洗（去掉 `/`、`:`）

### 6.3 视口

固定 `1440×900`。脚本不接受环境变量覆盖（避免环境差异导致不可重放）。如未来需多视口，**新增独立脚本**，不扩本脚本。

### 6.4 Sidecar JSON

**路由级 `_meta.json`**：

```json
{
  "route": "/overview",
  "component": "Onboarding",
  "captured_at": "2026-08-02T01:00:00Z",
  "viewport": {"width": 1440, "height": 900},
  "steps": [
    {"file": "01-overview.png", "kind": "route", "selector": null},
    {"file": "02-click-connect-data-source.png", "kind": "button", "selector": "[aria-label='连接数据源']", "label_cn": "连接数据源"}
  ]
}
```

**作业级 `_manifest.json`**：

```json
{
  "app_tsx_sha256": "abc123...",
  "git_sha": "$(git rev-parse HEAD)",
  "base_url": "http://localhost:5174",
  "captured_at": "2026-08-02T01:00:00Z",
  "routes_total": 16,
  "routes_succeeded": 15,
  "routes_skipped": 1,
  "routes_failed": 0,
  "buttons_total": 87,
  "buttons_clicked": 72,
  "buttons_skipped_blacklist": 12,
  "buttons_failed": 3,
  "duration_ms": 184000
}
```

### 6.5 写入与覆盖策略

- **同 `app_tsx_sha` + 同分钟**：覆盖（幂等；用于人工 rerun 同一作业）
- **同 `app_tsx_sha` + 不同分钟**：新建目录（自动调度同日多次跑各自保留历史）
- **不同 `app_tsx_sha`**：新建目录，旧的保留（**不删历史**）
- 历史目录占用：spec 不设上限；如未来存储压力大，**单独提工单**做归档策略

---

## 7. 调度接口契约（给 code 写 launchd 的约定）

### 7.1 脚本入口

```bash
# 主入口
node webui/scripts/snapshot-product.mjs

# 健康检查（供 launchd 前置探针调用）
node webui/scripts/snapshot-product.mjs --healthcheck
# 期望 stdout: "OK: <base_url> returns 200"
# 期望退出码: 0=健康, 1=不健康
```

### 7.2 环境变量（脚本读取）

| 变量 | 默认 | 说明 |
|---|---|---|
| `LUCY_SNAPSHOT_BASE_URL` | `http://localhost:5174` | docker 暴露的 WebUI 入口 |
| `LUCY_SNAPSHOT_OUTPUT_DIR` | `./var/screenshots` | 截图库根目录（默认路径需在 `.gitignore` 内） |
| `LUCY_SNAPSHOT_VIEWPORT` | `1440x900` | spec 冻结，不建议改 |
| `LUCY_SNAPSHOT_TIMEOUT_MS` | `30000` | 单步超时 |
| `LUCY_SNAPSHOT_DRY_RUN` | `0` | `1` 时只解析与扫描，不写图 |

### 7.3 日志路径

- `var/logs/snapshot-product.out.log`（stdout）
- `var/logs/snapshot-product.err.log`（stderr）
- `var/logs/` 目录若不存在，**脚本需自行创建**

### 7.4 前置健康检查

launchd 的 `ProgramArguments` 第一行建议调用 `--healthcheck`，失败则不进入主流程。**code 在 plist 里实现**。

### 7.5 频率 / 触发

**由 code 决定**——本 spec 不写 plist 内容、不规定 Hour/Minute、不规定 StartInterval vs StartCalendarInterval。code 实现后由架构师 review plist。

---

## 8. 失败处理与重试

| 失败类型 | 行为 | 重试策略 |
|---|---|---|
| 健康检查失败 | abort，写 stderr | 不重试，下次调度自然覆盖 |
| 路由解析失败（App.tsx 不可读） | abort，写 stderr | 不重试，需人工介入 |
| 单个路由失败（goto / networkidle 超时） | 记录到 `_errors.json`，继续后续路由 | 不重试 |
| 单个按钮失败（click / waitFor 超时） | 记录到 `_errors.json`，继续后续按钮 | 不重试 |
| Sidecar JSON 写入失败 | 写到 stderr，主流程继续 | 不重试 |
| 浏览器崩溃 | abort，写 stderr | 不重试 |
| 磁盘满 | abort，写 stderr | 不重试 |

**报警策略**：默认**不接 Slack / 邮件**。失败信息落到 `var/logs/snapshot-product.err.log`，由人工查日志。如未来需主动通知，**单独提工单**。

---

## 9. 与既有脚本的关系

| 既有脚本 | 角色 | 与新脚本关系 |
|---|---|---|
| `webui/screenshot.mjs` | `/overview` 多视口单页工具 | **保留不动**；不替代其多视口能力 |
| `webui/scripts/screenshot-overview.mjs` | IA 评审一次性脚本（产物在 `inbox/lucy-screenshots/`） | **保留不动**；一次性产物不再跑 |
| `webui/scripts/screenshot-connections.mjs` | 连接模块一次性脚本 | **保留不动**；一次性产物不再跑 |

新脚本**只**做"产品截图库定时维护"，不替代既有工具，不重构既有脚本。

---

## 10. 副作用清单（只读保证）

新脚本对系统的影响仅限：

- 读 `webui/src/app/App.tsx`（文件读）
- 读 `webui/scripts/snapshot-product.{blacklist,fixtures}.json`（若存在）
- 写 `var/screenshots/`（截图库；路径已在 `.gitignore` 内）
- 写 `var/logs/snapshot-product.*.log`（日志）

**不**做的事：

- 不修改数据库
- 不修改 `customer-config/`、`semantic-layer/`、`wiki/`、`eval/`、`skills/`、`raw-sources/` 任何文件
- 不修改 `webui/config/access.yaml`、不签发 Token
- 不触发任何 webhook、不发邮件
- 不读密码、密钥、token

---

## 11. 验收口径

| # | 验收项 | 期望 |
|---|---|---|
| 1 | 单次跑产出完整目录 | `output/screenshots/{app_tsx_sha}/{YYYY-MM-DD}/` 含所有成功路由子目录 |
| 2 | 每个路由至少 1 张首屏 | NN-01-{slug}.png 存在 |
| 3 | 按钮图齐全 | 每个非黑名单按钮都有一张 PNG |
| 4 | 视口合规 | 所有 PNG 都是 1440×900 |
| 5 | Sidecar JSON 完整 | 每个路由有 `_meta.json`，每个作业有 `_manifest.json` |
| 6 | 可重放 | 跑两次同一 SHA 的 App.tsx，目录稳定不变 |
| 7 | App.tsx 变更响应 | 改 App.tsx 后产出新 `app_tsx_sha` 目录，旧目录保留 |
| 8 | 黑名单生效 | 删除 / 登出等按钮未被点击，无对应 PNG |
| 9 | 失败隔离 | 单路由失败不影响其他路由 |
| 10 | launchd 注册 | `launchctl list \| grep snapshot` 能看到任务 |
| 11 | 健康检查 | docker 停掉后 `--healthcheck` 返回非 0 |
| 12 | 副作用为零 | 截图作业不修改任何业务文件（git status 干净） |
| 13 | 输出路径不被发布 | `var/screenshots/` 在 `.gitignore` 内；`git check-ignore var/screenshots/foo.png` 返回 0（路径被 ignore） |

---

## 12. 风险与缓解

| 风险 | 缓解 |
|---|---|
| App.tsx 改动频繁导致 `app_tsx_sha` 抖动、目录膨胀 | spec 不设上限；后续单独工单做归档 |
| 反射拿不到按钮（select 用 div 模拟等） | §4.7 引入 `data-snapshot-target` 标注约定 |
| 按钮 click 触发副作用（如自动保存草稿） | §4.5 黑名单 + 每个路由独立 browser context |
| Lazy 模块解析失败 | §4.2 跳过 + 警告日志 |
| 动态路由缺 fixture | §4.6 fixtures 文件缺失时跳过 + 日志 |
| 截图脚本自身 bug 截到敏感页 | §4.5 href 白名单 + §1.2 非目标划清 |
| Playwright 升级导致 selector 失效 | spec 锁 Playwright 大版本（由 package.json 控制） |

---

## 13. 后续待办（不在本 spec 范围）

| # | 事项 | 备注 |
|---|---|---|
| 1 | README 端口同步 | 当前 README 写 3000/3001，实际 5173/5174，独立工单 |
| 2 | `data-snapshot-target` 标注约定的 WebUI 开发者沟通 | 落地到 `webui/docs/` |
| 3 | 截图库归档策略 | 目录膨胀到 GB 级时单独提 |
| 4 | 截图差异比对 / 视觉回归 | 另一条产品线，与本任务分离 |
| 5 | Sidecar 元数据检索工具 | `tools/snapshot-search.mjs` 之类，按需 |
| 6 | launchd plist 的实操配置 | 由 code 写，架构师 review |
| 7 | `output/` 目录历史未被 .gitignore | 现有 `output/overview/*.png`、`output/pdf/*.pdf` 当前会被 git track，是历史小 bug；不在本任务范围，独立工单修 |

---

## 14. 角色边界确认

- **架构师（本文档作者）**：写 spec、review codex 实施
- **minimax/codex**：按本 spec 实施 `webui/scripts/snapshot-product.mjs`，写 launchd plist 配置，写 README/Runbook 增量
- **架构师（review）**：review codex 产出，对照 §11 验收口径首跑

---

## 15. 变更记录

| 版本 | 日期 | 变更 |
|---|---|---|
| v0.1 | 2026-08-02 | 初版：7 个核心设计决策收口，spec 落位 `docs/webui-snapshot-product.md` |
| v0.2 | 2026-08-02 | 用户补充：输出路径改为 `var/screenshots/`（加 `.gitignore` 一行 `var/screenshots/`），时间戳粒度升级 `YYYY-MM-DD-HHmm`（同日多次跑不覆盖），强化"每个模块一个子文件夹"约定，验收加 #13；新增后续待办 #7（`output/` 历史未被 ignore） |