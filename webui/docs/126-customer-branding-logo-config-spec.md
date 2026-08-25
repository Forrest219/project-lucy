# Customer Branding / Logo — Requirements & Design (Tableau-aligned)

| 元数据 | 内容 |
|---|---|
| 文档名称 | Customer Branding / Logo Requirements & Design |
| 文档类型 | 需求 / 设计方案（本轮不落地代码） |
| 版本 | v0.1 |
| 撰写日期 | 2026-08-25 |
| 委托人 | xingchen |
| 参考 | [Tableau Server `tsm customize`](https://help.tableau.com/current/server/en-us/cli_customize.htm)；Tableau Cloud Site Logo；Lucy 现有侧栏品牌区（Spec 67/68，mark ≈ 36×36） |
| 输出位置 | `webui/docs/126-customer-branding-logo-config-spec.md` |
| 状态 | Designed（待确认后再实现） |

## 1. Tableau Server 对照摘要

Tableau 用 `tsm customize`（历史为 `tabadmin customize`）做浏览器端品牌外观，不改产品内核。要点如下。

### 1.1 可定制项

| 位置 | Tableau 选项 | 尺寸（像素） | 推荐 |
|---|---|---|---|
| Header / 导航区 Logo | `--header-logo` 或 `--logo` | 最小 32×32，最大 160×160 | 48×48 |
| 登录页 Logo | `--signin-logo` 或 `--logo` | 最大 3000×3000 | 可与 Header 共用或单独更大图 |
| 导航收起时的小 Logo | `--compact-logo` | 最大（亦为最佳）32×32 | 32×32 |
| 服务器显示名 | `--server-name` | 文案 | 出现在浏览器 Tab、tooltip、部分消息 |
| 浏览器 Tab 图标 | 不可改 | — | — |
| 一键恢复默认 | `--restore-defaults` | — | — |

### 1.2 资产与运维约束（Tableau）

- **格式**：GIF / JPEG / PNG（官方文档未列 SVG / WebP）。
- **路径**：文件路径与文件名**不能含空格**。
- **超限行为**：Header Logo 大于 160×160 会被 **clip**，不是等比缩放后完整展示。
- **背景差异**：Header 与登录页背景色不同；同一张图在两处观感可能不同，因此提供「共用 `--logo`」与「分槽上传」两套路径。
- **生效**：改完后需 `tsm pending-changes apply`（历史上需 restart）；不是纯热更新。
- **备份**：官方建议在 Server 外保留定制图备份；节点间会分发，但**不是可恢复格式**。
- **管理入口**：Server 以 CLI 为主；Tableau Cloud 在 Site Settings 用上传 + 预览 + Save / Reset to Default / Revert。

### 1.3 对 Lucy 的启示（采纳 / 裁剪）

| Tableau 做法 | Lucy 建议 |
|---|---|
| Header + Sign-in 分槽 + 共用一键 | **v1 先共用一张 Logo**（侧栏 + 登录）；预留分槽为 v1.1 |
| Compact 32×32 | Lucy 侧栏无真正「收起只留 icon」产品形态时 **v1 不做 compact 槽**；若后续加折叠，再补 32×32 |
| 32–160 / 推荐 48 | 对齐：上传约束 + UI 展示槽约 **36×36（现有 `.pl-brand-mark`）**，推荐源图 **48×48**，上限 **160×160** |
| 超限 clip | Lucy **拒绝超限文件**（上传失败 + 明确文案），避免静默裁切导致客户以为「坏图」 |
| GIF/JPEG/PNG | v1 同三格式；**WebP 可选允许**；**SVG 默认禁止**（安全面，与 Tableau 一致偏保守） |
| server-name | 对应 Lucy「产品名称」覆盖（侧栏 wordmark / 登录标题）；浏览器 `<title>` / favicon **v1 不做**（Tableau 也改不了 favicon） |
| CLI + apply | Lucy 走 **WebUI 配置页**（客户交付更友好）；落盘可审计；保存后 **热生效**（无需重启进程） |
| Restore defaults | 必须有「恢复默认 Logo / 恢复默认文案」 |

## 2. Lucy 产品目标

客户交付实例可在不改源码的前提下，把侧栏与登录页的品牌 mark / 名称换成客户资产，形成「这是客户的数据 Agent 控制台」的第一眼认知。

成功标准：

1. 运维可在配置页上传 Logo、改产品名称（可选副标题），并预览侧栏与登录效果。
2. 约束清晰（格式、像素、体积），不合规直接拒绝并说明原因。
3. 可一键恢复 Lucy 默认品牌。
4. 未登录也能看到客户 Logo / 名称（登录页）。
5. 变更可审计、可备份（配置文件在项目目录内，随交付包/备份走）。

## 3. 需求（Requirements）

### 3.1 功能需求

| ID | 需求 | 优先级 |
|---|---|---|
| BR-1 | 提供配置页「品牌外观」，入口挂在访问治理（与登录账户同级） | P0 |
| BR-2 | 上传**一张**客户 Logo，同时用于侧栏品牌 mark 与登录页 | P0 |
| BR-3 | 可配置「产品名称」；留空回退默认 `Lucy WebUI` | P0 |
| BR-4 | 可配置「副标题」；留空回退默认 `Data Agent MCP` | P0 |
| BR-5 | 配置页提供侧栏 + 登录缩略预览 | P0 |
| BR-6 | 「恢复默认 Logo」「恢复默认文案」（或分别操作） | P0 |
| BR-7 | 公开读取品牌元数据与 Logo 字节（供登录页） | P0 |
| BR-8 | 写操作需 WebUI 登录会话（开放模式下与其他本地写配置一致） | P0 |
| BR-9 | 写入进入配置审计 | P1 |
| BR-10 | 侧栏 / 登录分槽 Logo（对齐 Tableau header vs signin） | P2 / v1.1 |
| BR-11 | Compact / 折叠侧栏专用 32×32 Logo | P2（有折叠 IA 后再做） |
| BR-12 | Favicon / 浏览器 Tab 标题客户化 | Out of scope v1 |

### 3.2 Logo 资产要求（对齐 Tableau，贴合 Lucy 槽位）

| 项 | Lucy v1 要求 | 说明 |
|---|---|---|
| 格式 | **PNG / JPEG / GIF** | 与 Tableau 一致；禁止 SVG（XSS）；WebP 可作为 v1 可选扩展 |
| 像素 | **最小 32×32，最大 160×160** | 与 Tableau Header Logo 相同 |
| 推荐 | **48×48** | 与 Tableau / Tableau Cloud 推荐一致 |
| 展示槽 | 侧栏 / 登录 mark：**36×36 CSS**（`h-9 w-9`） | 源图按 `object-fit: contain` 装入，不拉伸变形 |
| 宽高比 | 允许非正方形；槽内 contain + 透明底优先 | 超宽 wordmark 图不适合此槽，应引导客户用正方形 mark |
| 文件体积 | ≤ **512 KB** | Tableau 未强调体积；Lucy 补上限防误传 |
| 超限 | **拒绝上传**，不静默 clip | 与 Tableau「clip」不同，对运维更可预期 |
| 文件名 | 服务端规范化为 `logo.<ext>`；客户端原名仅用于校验扩展名 | 不要求客户路径无空格（Web 上传无 CLI 路径问题） |
| 透明底 | 推荐 PNG 透明底 | Lucy 浅色侧栏 / 登录底；深色前景 Logo 更清晰 |
| 颜色提示 | 配置页说明：侧栏与登录背景可能略有差异，建议在预览中确认 | 吸收 Tableau 背景差提示 |

### 3.3 文案要求

| 字段 | UI 主术语 | 默认 | 约束 |
|---|---|---|---|
| 产品名称 | 产品名称 | `Lucy WebUI` | trim 后 ≤ 64 字符；禁控制字符 |
| 副标题 | 副标题 | `Data Agent MCP` | 同上；侧栏第二行 |
| 页面名 | 品牌外观 | — | 禁止「白标 / 换皮」作主术语 |

侧栏品牌链接的 accessible name 仍为「返回系统概览」；Logo `<img>` 用空 alt（装饰性）。

### 3.4 非目标（v1）

- 多租户 / 按 Host 切换品牌
- 主题色、字体、CSS 变量客户化
- Favicon / document title
- 邮件、导出 PDF、MCP 客户端内嵌品牌
- 移动窄屏专用品牌布局

## 4. 设计方案

### 4.1 信息架构

```
访问治理
  … 既有项 …
  品牌外观     →  /admin/branding
  登录账户     →  /admin/admins
```

配置页结构（单页三区，非 dashboard）：

1. **客户 Logo**：当前图 / 上传 / 恢复默认 + 格式与像素说明  
2. **产品名称与副标题**：表单 + 保存  
3. **预览**：侧栏品牌块 + 登录标题示意（只读）

### 4.2 展示模型（消费面）

| 表面 | Logo | 文案 |
|---|---|---|
| 侧栏 `.pl-brand-block` | 有自定义 → `<img>` contain 于 36×36；否则字母 mark（产品名称首字或 `L`） | 生效产品名称 + 副标题 |
| 登录页顶栏 | 同上 | 产品名称 |
| 浏览器 Tab | 不变 | 不变 |

v1 共用一张图；若客户登录页需要更大展示，v1.1 再加「登录页 Logo」槽（对齐 `--signin-logo`，上限可放宽到更大尺寸，但展示仍受登录卡宽度约束）。

### 4.3 数据与存储（设计级）

建议落盘（实现时再定精确 schema）：

- `webui/config/branding.yaml`：文案覆盖 + logo 元数据（contentType、updatedAt、像素校验结果）  
- `webui/config/branding/logo.<ext>`：单一二进制文件  

公开读：`GET` 品牌 JSON + `GET` logo 字节（登录前可用）。  
写入：`PUT` 文案 / `PUT` logo / `DELETE` logo；进配置审计。

### 4.4 上传校验流水线（设计级）

1. 扩展名 ∈ {png, jpg, jpeg, gif}（+ 可选 webp）  
2. MIME 与扩展名一致  
3. 解码后读取宽高；不在 [32,160] 任一边 → 拒绝  
4. 字节数 > 512KB → 拒绝  
5. 通过后覆盖写入，旧扩展名文件删除  
6. 前端预览用返回的 `logoUrl?v=updatedAt` 防缓存

### 4.5 UX 文案要点（配置页帮助）

建议固定说明（中英术语按标准）：

- 推荐 **48×48** PNG（透明底）；允许 32–160。  
- 同一张图用于侧栏与登录页。  
- 超尺寸请缩小后再传（本系统不会自动裁切）。  
- 横向长条 wordmark 不适合此槽，请提供正方形品牌 mark。

### 4.6 权限与安全

- 读：公开（仅品牌元数据与 logo 图，无 secrets）。  
- 写：WebUI 会话；所有者与运维均可（属交付外观，非账户治理）。  
- 禁止 SVG / HTML 伪装；图片按二进制存、按 Content-Type 输出。  
- 配置审计记录 upload / delete / text update。

### 4.7 与现有品牌规范的关系

- Spec 67/68 的「可点击回 `/overview`、accessible name、两行文案节奏」继续有效。  
- 默认无客户 Logo 时，视觉与现网一致（字母 mark + `Lucy WebUI` / `Data Agent MCP`）。  
- 客户化后仍不得破坏 home affordance 与翻译防御（`notranslate` 包产品名称 / 副标题中的专业英文）。

## 5. 术语（待写入术语标准）

| Canonical | UI 主术语 | 禁止 |
|---|---|---|
| Customer Branding | 品牌外观 | 白标、换皮、皮肤（作导航/标题） |
| Customer Logo | 客户 Logo | 头像、图标（作主标签） |
| Product Title | 产品名称 | 站点名、系统名（作主标签） |
| Brand Tagline | 副标题 | 口号、Slogan（作主标签） |

## 6. 分阶段

| 阶段 | 内容 |
|---|---|
| **v1（本方案）** | 共用 Logo + 产品名称 + 副标题 + 配置页 + 公开读 + 恢复默认 + Tableau 对齐的像素/格式约束 |
| **v1.1** | 登录页独立 Logo 槽；可选 WebP；配置审计筛选项 |
| **v2** | 侧栏折叠 compact 32×32；可选 server 显示名进更多系统消息 |

## 7. 待你确认的决策点

1. **SVG**：默认禁止（推荐）还是允许并做严格消毒？  
2. **WebP**：v1 是否允许？  
3. **超限策略**：确认采用「拒绝」而非 Tableau 式「clip」？  
4. **副标题**：客户交付是否常改？若很少改，v1 可只做 Logo + 产品名称。  
5. **分槽**：是否接受 v1 共用一张图，登录页大图放到 v1.1？

## 8. Design System Compliance（设计声明）

- 配置页模式：`design-system/20-patterns-page-layout.md`  
- 不把配置页做成营销 landing / 多 KPI dashboard  
- Toast / 按钮遵循既有组件规范；预览为轻量示意，非新卡片体系  

---

确认上述决策点后，再开实现工单（API + `/admin/branding` + 侧栏/登录消费 + 测试）。本轮不写代码。
