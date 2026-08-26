# Customer Branding / Logo Config Spec

| 元数据 | 内容 |
|---|---|
| 文档名称 | Customer Branding / Logo Config Spec |
| 文档类型 | Product / UX / API Spec（实现依据） |
| 版本 | v0.2 |
| 撰写日期 | 2026-08-25 |
| 委托人 | xingchen |
| 参考 | [Tableau Server `tsm customize`](https://help.tableau.com/current/server/en-us/cli_customize.htm)；Tableau Cloud Site Logo；Lucy Spec 67/68 |
| 输出位置 | `webui/docs/126-customer-branding-logo-config-spec.md` |
| 状态 | Approved for implementation（v0.2） |

### Changelog

| 版本 | 变更 |
|---|---|
| v0.1 | 对照 Tableau 起草需求与设计；决策点待确认 |
| v0.2 | 拍板五项决策并进入实现：禁 SVG、v1 不做 WebP、超限拒绝、副标题进 v1、登录分槽延后 v1.1 |

## 0. 已批准决策（v0.2）

| # | 决策 | 结论 | 理由 |
|---|---|---|---|
| 1 | SVG | **禁止** | XSS 面；客户交付素材以位图为主；与 Tableau 保守一致 |
| 2 | WebP | **v1 不做** | 运维素材仍以 PNG 为主；解码/验收成本不值 |
| 3 | 超限 | **拒绝上传** | 不静默 clip；错误可预期 |
| 4 | 副标题 | **v1 做** | 侧栏已有第二行；字段成本低 |
| 5 | 登录独立 Logo | **v1.1** | v1 侧栏+登录共用一张正方形 mark |

## 1. Tableau Server 对照摘要

Tableau 用 `tsm customize` 定制浏览器品牌外观。Header Logo：**32–160 px**，推荐 **48×48**；格式 **GIF / JPEG / PNG**；超限 clip；可分槽（header / signin / compact）；可恢复默认。

Lucy v1 对齐像素与格式，改用 WebUI 配置页 + 热生效，超限改为拒绝。

## 2. 产品目标

客户交付实例可在不改源码的前提下，替换侧栏与登录页的品牌 mark / 产品名称 / 副标题。

成功标准：配置页可上传与恢复；约束清晰；登录前可见；变更可审计。

## Terminology Compliance

This feature follows `webui/docs/00-product-terminology-standard.md`.

New terms:

| Canonical Term | UI 主术语 | 允许补充说法 | 禁止文案 | 说明 |
|---|---|---|---|---|
| Customer Branding | 品牌外观 | 客户品牌 | 白标、换皮、皮肤（作导航/标题） | `/admin/branding` |
| Customer Logo | 客户 Logo | Logo | 头像、图标（作主标签） | 侧栏 mark / 登录页共用 |
| Product Title | 产品名称 | wordmark | 站点名、系统名（作主标签） | 默认 `Lucy WebUI` |
| Brand Tagline | 副标题 | tagline | 口号、Slogan（作主标签） | 默认 `Data Agent MCP` |

## 3. 需求

### 3.1 功能

| ID | 需求 | 优先级 |
|---|---|---|
| BR-1 | 配置页「品牌外观」`/admin/branding`，系统设置导航 | P0 |
| BR-2 | 一张客户 Logo → 侧栏 + 登录共用 | P0 |
| BR-3 | 产品名称；空 → `Lucy WebUI` | P0 |
| BR-4 | 副标题；空 → `Data Agent MCP` | P0 |
| BR-5 | 侧栏 + 登录预览 | P0 |
| BR-6 | 恢复默认 Logo；文案可清空回默认后保存 | P0 |
| BR-7 | 公开 `GET` 品牌元数据与 Logo | P0 |
| BR-8 | 写操作需 WebUI 会话（开放模式与其他本地写配置一致） | P0 |
| BR-9 | 配置审计 | P1 |
| BR-10 | 登录独立 Logo 槽 | P2 / v1.1 |
| BR-11 | Compact 32×32 | P2 |
| BR-12 | Favicon / document title | Out |

### 3.2 Logo 资产

| 项 | v1 |
|---|---|
| 格式 | PNG / JPEG / GIF（**禁 SVG、禁 WebP**） |
| 像素 | 宽高均在 **[32, 160]**；任一边越界 → 拒绝 |
| 推荐 | **48×48** PNG（透明底） |
| 展示槽 | 36×36 CSS，`object-fit: contain` |
| 体积 | ≤ **512 KB** |
| 超限 | **拒绝**，不 clip |
| 落盘名 | `webui/config/branding/logo.<ext>` |

### 3.3 文案

产品名称 / 副标题：trim 后 ≤ 64 Unicode 字符；禁控制字符。侧栏品牌链接 accessible name 仍为「返回系统概览」；Logo `alt=""`。

### 3.4 非目标

多租户、主题色、favicon、title、邮件/PDF 品牌、移动窄屏专用布局。

## 4. 设计

### 4.1 IA

系统设置 → 品牌外观 `/admin/branding`（与登录账户同组，顺序在上）。

页面三区：客户 Logo | 产品名称与副标题 | 预览。

### 4.2 API

| 方法 | 路径 | 鉴权 |
|---|---|---|
| GET | `/api/branding` | 公开 |
| GET | `/api/branding/logo` | 公开 |
| PUT | `/api/branding` | 需会话（开放模式可写） |
| PUT | `/api/branding/logo` | 同上 |
| DELETE | `/api/branding/logo` | 同上 |

`GET /api/branding` 返回生效文案 + `productTitleOverride` / `taglineOverride`（空=默认）+ `hasCustomLogo` + `logoUrl`。

`PUT /api/branding/logo` body：`{ filename, contentBase64 }`。

### 4.3 存储

- `webui/config/branding.yaml`
- `webui/config/branding/logo.<ext>`

审计：`assetKind=governance`；`branding.update` / `branding.logo.upload` / `branding.logo.delete`。

### 4.4 上传校验

1. 扩展名 ∈ png/jpg/jpeg/gif  
2. 魔数与扩展名一致  
3. 解码宽高；任一边 ∉ [32,160] → 拒绝  
4. 体积 > 512KB → 拒绝  
5. 覆盖写入并删旧扩展名文件  

### 4.5 消费面

侧栏与登录：有 Logo 用 `<img>`，否则字母 mark；文案用生效值。

## 5. 验收

1. 无配置时与现网默认一致  
2. 上传合规 PNG 后侧栏/登录立即显示；刷新仍在  
3. 改产品名称 / 副标题生效；清空保存后回默认  
4. 恢复默认 Logo → 字母 mark  
5. 超尺寸 / SVG / WebP / 过大文件 → 明确错误  
6. 未登录可读 GET；required 模式未登录不可写  
7. 导航 / Handbook §1.5 / 术语标准同步  
8. 相关单元测试通过  

## 6. Design System Compliance

- 配置页：`20-patterns-page-layout.md`  
- 按钮 / Toast 既有规范；预览为轻量示意  
