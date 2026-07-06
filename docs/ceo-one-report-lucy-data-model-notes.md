# CEO 一眼报 Lucy 服务层数据模型理解笔记

| 元数据 | 内容 |
|---|---|
| 文档名称 | CEO 一眼报 Lucy 服务层数据模型理解笔记 |
| 文档类型 | Data Model Notes |
| 版本 | v0.1 |
| 撰写日期 | 2026-07-06 |
| 适用范围 | CEO 一眼报 MVP：DAU、营业收入-广告、IDM 分品类广告、CEO 快照对账 |

## 1. 当前结论

原始报告中的 MVP 表和 SQL 可以作为有效来源依据，但不适合作为 Lucy/KTX 的直接授权资产。Lucy 需要一层专用服务层表或只读视图，承接原 SQL 的过滤、聚合、字段裁剪、权限隔离和可解释元数据。

当前向大数据平台要 DDL，是为了分析现有报表相关表的结构和数据分布。先让平台提供 MVP 已涉及的 `rpt`、`sdm`、`idm`、`odm`、`dw`、`ods`、业务库表的 DDL 和样例数据；`lucy_ceo_*` 是我们理解现有模型之后，再设计的目标服务层建议。

口径可以后续再议；当前阶段先把模型粒度、分子分母、可分析维度和可授权边界搞清楚。

## 2. MVP 源模型理解

### 2.1 产品活跃日表

目标服务层表建议命名为 `lucy_ceo_app_active_daily`。

| 项 | 内容 |
|---|---|
| 业务用途 | CEO 一眼报 DAU 页、FineBI 活跃分析类问题 |
| 建议粒度 | `dt, market, platform, pkg_name, device_brand`，其中 `device_brand` 可为空或归为 `ALL` |
| 核心指标 | DAU 不含后台刷新、DAU 含后台刷新、启动次数不含后台刷新、启动次数含后台刷新、MAU、活跃次日留存率 |
| 原始来源线索 | `rpt.rpt_app_aty_basic_1d_d`、`rpt.rpt_app_basic_1d_d`、`sdm.sdm_app_act_1d_d`、`dw.dw_flow_app_pkg_cm_m`、`sdm.sdm_app_act_1m_m`、`rpt.rpt_app_aty_retain_1d_d`、`sdm.sdm_app_aty_retain_1d_d` |
| 聚合原则 | DAU、启动次数按互斥维度求和；人均打开次数用 `sum(start_cnt_noback) / sum(dau_noback)` 重算；留存率用分子分母重算 |

这个表解决“产品活跃 DAU”。它不应和广告 DAU 混成一个字段，因为广告 DAU 来自友盟/广告域，业务含义和产品活跃 DAU 不同。

### 2.2 广告位收入日表

目标服务层表建议命名为 `lucy_ceo_ad_position_daily`。

| 项 | 内容 |
|---|---|
| 业务用途 | 营业收入-广告页按广告位、广告库存、曝光、点击、填充、eCPM 分析 |
| 建议粒度 | `dt, country, platform, position_id` |
| 核心指标 | 广告收入、曝光量、请求量、有效库存、填充量、点击量、库存、有效库存率、填充率、eCPM |
| 原始来源线索 | `mojicom.ad_advertiser_req_fill_data`、`mojicom.ad_feed_inventory_dat`、`mojicom.adclick_adid_data`、`ods.ods_ad_positions`、`rpt.rpt_splash_stock_data`、`rpt.rpt_brand_year_data_day` |
| 聚合原则 | 收入、曝光、请求、点击、库存类指标按粒度求和；eCPM 用 `sum(ad_revenue) / sum(ad_impressions) * 1000` 重算 |

这个表只承载广告位经营明细，不建议把广告 DAU 重复挂在每个广告位行上。否则 Agent 很容易误用 `sum(ad_dau)`，导致 DAU 和 ARPU 放大。

### 2.3 广告流量日表

目标服务层表建议命名为 `lucy_ceo_ad_traffic_daily`。

| 项 | 内容 |
|---|---|
| 业务用途 | 广告 DAU、广告 ARPU、人均打开次数的统一分母层 |
| 建议粒度 | `dt, country, platform` |
| 核心指标 | 广告 DAU、总打开次数 |
| 原始来源线索 | `odm_umeng_all_threeends`，其上游 SQL 线索为 `sum(act_num) as dau`、`sum(start_num) as start_num`，并将 `AndroidLite` 合并为 `Android` |
| 聚合原则 | 平台内 DAU、打开次数可以求和；跨平台汇总前需确认用户去重规则。人均打开次数用 `sum(total_opens) / sum(ad_dau)` 重算 |

这是从 POC 模型中拆出来的关键改进。POC 表里 `ad_dau` 和 `total_opens` 会在广告位或收入品类行重复出现，靠 `max()` 做保护；真实服务层应把它们独立成分母事实表。

### 2.4 分品类广告收入日表

目标服务层表建议命名为 `lucy_ceo_ad_revenue_type_daily`。

| 项 | 内容 |
|---|---|
| 业务用途 | IDM 治理层品牌/电商/效果/外包广告收入分析 |
| 建议粒度 | `dt, country, platform, revenue_type` |
| 核心指标 | 分品类广告收入、分品类广告曝光 |
| 原始来源线索 | `idm_ad_revenue_a_d`，报告描述为广告收入指标卡日维度数据；关联 `odm_umeng_all_threeends` 提供 DAU 和打开次数 |
| 聚合原则 | 收入、曝光按品类求和；ARPU 与人均打开次数不要在本表直接用重复分母列计算，应与 `lucy_ceo_ad_traffic_daily` 按 `dt,country,platform` 关联后计算 |

这个拆分能避免“分品类收入表重复携带广告 DAU”的建模陷阱。收入事实和流量分母分表后，KTX semantic layer 可以明确 join 和 measure，Agent 生成 SQL 的错误空间会小很多。

### 2.5 CEO 指标快照表

目标服务层表建议命名为 `lucy_ceo_metric_snapshot`。

| 项 | 内容 |
|---|---|
| 业务用途 | CEO 一眼报前端值、截图值、导出值的回归对账 |
| 建议粒度 | `snapshot_dt, source_page, metric_code, dimension_key` |
| 核心字段 | 指标编码、指标名称、指标值、单位、维度说明、快照来源、容差规则、证据等级 |
| 原始来源线索 | CEO 一眼报前端截图、导出数据、原始 docx 的指标清单和数据溯源章节 |
| 聚合原则 | 快照表不做业务聚合，作为 benchmark ground truth 使用；同一 key 应唯一 |

这个表不是业务宽表，而是验收基准表。它用于 eval 和回归，证明 Lucy 回答的数值能追溯到业务认可的 CEO 一眼报展示值。

### 2.6 指标目录表

目标服务层表建议命名为 `lucy_ceo_metric_catalog`。

| 项 | 内容 |
|---|---|
| 业务用途 | 给 KTX/Wiki/Skill 提供指标语义、owner、证据等级和待确认事项 |
| 建议粒度 | `metric_code` |
| 核心字段 | 指标编码、指标中文名、owner、来源页面、来源表线索、公式、粒度、维度、单位、描述、证据等级、待确认事项 |
| 原始来源线索 | CEO 一眼报 V1.3 的 `指标清单`、`指标口径/计算规则`、`数据溯源`、`FineDataLink 数仓` 章节 |

指标目录可以先进 Lucy 服务层，也可以先以 Wiki/semantic metadata 形式维护。若由大数据平台落表，后续 KTX 扫描、检索和审计会更完整。

## 3. 推荐服务层表清单

| 优先级 | 表/视图 | 是否 MVP 必需 | 说明 |
|---|---|---|---|
| P0 | `lucy_ceo_app_active_daily` | 是 | 产品 DAU 与启动次数事实表 |
| P0 | `lucy_ceo_ad_position_daily` | 是 | 营业收入-广告页广告位经营事实表 |
| P0 | `lucy_ceo_ad_traffic_daily` | 是 | 广告 DAU 与打开次数分母事实表 |
| P0 | `lucy_ceo_ad_revenue_type_daily` | 是 | IDM 分品类广告收入事实表 |
| P0 | `lucy_ceo_metric_snapshot` | 是 | CEO 前端对账与 eval 基准表 |
| P1 | `lucy_ceo_metric_catalog` | 强烈建议 | 指标字典，可先由 Lucy 侧维护，后续平台化 |
| P1 | `lucy_ceo_member_daily` | 后续 | 会员 DAU、会员收入、漏斗等 |
| P1 | `lucy_ceo_intl_ad_daily` | 后续 | 国际化广告 DAU、收入、ARPU、eCPM |
| P1 | `lucy_ceo_intl_member_daily` | 后续 | 国际化会员 DAU、订阅、收入等 |

## 4. 现有表 DDL 需要包含的内容

请大数据平台按每张现有相关表提供以下最低材料。当前阶段目的是分析现有表结构、数据结构和粒度，不要求平台先建设 Lucy 专用服务层。

| 材料 | 必需性 | 说明 |
|---|---|---|
| `CREATE TABLE` 或 `CREATE VIEW` DDL | 必需 | 包含字段类型、字段注释、表注释；如果没有注释，也请提供现有原始 DDL |
| 表级说明或粒度说明 | 必需 | 如果已知，请说明表的业务用途、主日期字段、分区字段、常用聚合粒度 |
| 刷新频率和完成时间 | 必需 | 日更/月更、每天几点前完成；暂不要求完整 SLA 描述 |
| 样例数据 | 必需 | 每表至少 10 行脱敏样例，覆盖主要枚举 |
| 历史覆盖范围 | 必需 | 可查起止日期，是否可回溯 |
| 常用查询 SQL | 建议 | 如果现有报表有可提供 SQL，可附上；没有则先不要求 |
| 对账基准 | 建议 | 与 CEO 前端、FineBI、FineVis 或导出值的同日对账样例 |

当前默认约定：

- 日期和时区：统一按北京时间东八区自然日理解，不单独要求平台解释时区。
- 枚举值：先从样例数据中归纳，例如 `platform`、`country`、`revenue_type`、`position_id`；除非样例无法覆盖主要枚举，再追加询问。
- 权限范围：当前只做结构分析，暂按大数据平台可提供全量字段处理，不单独要求列级或行级授权说明。
- 上游来源映射：当前不要求。我们从这些现有表的 DDL 和样例开始分析，之后再设计 Lucy 专用服务层。

## 5. 大数据平台提供给我们的现有表结构清单

请大数据平台按下表提供现有资产的结构信息、刷新频率/完成时间、样例数据和历史覆盖范围。这些表或报表数据集来自 CEO 一眼报 V1.3 的数据溯源和 FineDataLink 数仓章节，用于我们分析现有数据模型，不代表最终会直接暴露给 Lucy。

| 优先级 | 现有表/数据集 | 所属范围 | 需要重点看什么 |
|---|---|---|---|
| P0 | `rpt.rpt_app_aty_basic_1d_d` | DAU | 国内 iOS/Android 活跃、启动次数、设备品牌维度、含/不含后台刷新字段 |
| P0 | `rpt.rpt_app_basic_1d_d` | DAU | Harmony 端活跃、新增、启动、使用时长等基础指标 |
| P0 | `sdm.sdm_app_act_1d_d` | DAU | 国际 DAU、国际人均打开次数、日粒度活跃 |
| P0 | `dw.dw_flow_app_pkg_cm_m` | DAU | 国内 MAU、包名维度、月度口径 |
| P0 | `sdm.sdm_app_act_1m_m` | DAU | 国际 MAU、月度口径 |
| P0 | `rpt.rpt_app_aty_retain_1d_d` | DAU | 国内活跃次日留存率相关分子分母 |
| P0 | `sdm.sdm_app_aty_retain_1d_d` | DAU | 国际或 SDM 层活跃留存明细/汇总 |
| P0 | `mojicom.ad_advertiser_req_fill_data` | 营业收入-广告 | 广告请求、填充、收入、平台、广告位等字段 |
| P0 | `mojicom.ad_feed_inventory_dat` | 营业收入-广告 | 信息流/广告库存字段；表名请平台确认是否为 `_dat` 或 `_data` |
| P0 | `mojicom.adclick_adid_data` | 营业收入-广告 | 广告点击、曝光、广告位关联字段 |
| P0 | `ods.ods_ad_positions` | 营业收入-广告 | 广告位维表，重点看 `position_id`、广告位名称、业务分类 |
| P0 | `rpt.rpt_splash_stock_data` | 营业收入-广告 | 开屏广告库存、有效库存、填充、曝光等汇总字段 |
| P0 | `rpt.rpt_brand_year_data_day` | 营业收入-广告 | 品牌广告日维度收入或年度目标相关字段 |
| P0 | `odm_umeng_all_threeends` | 广告 DAU/打开次数 | 友盟三端 DAU 和打开次数，重点看 `act_num`、`start_num`、平台合并规则 |
| P0 | `idm_ad_revenue_a_d` | IDM 分品类广告收入 | 品牌/电商/效果/外包广告收入、曝光、DAU、打开次数等治理层字段；schema 请平台确认 |

非 `rpt` 类 P0 表请提供：

- DDL：`CREATE TABLE` 或 `CREATE VIEW`，包含字段类型、字段注释、表注释。
- 表级说明或粒度说明：说明主日期字段、分区字段、常用维度、是否存在重复分母字段。
- 刷新频率和完成时间：例如日更，每天几点前完成。
- 样例数据：至少 10 行脱敏样例，覆盖主要平台、国家、广告品类、广告位等枚举。
- 历史覆盖范围：可查起止日期，是否可回溯。

`rpt` 来自 finreport 系统，优先按报表数据集资产索取信息，不只按数据库表索取 DDL。每个 `rpt` 数据集请提供：

- 报表资产信息：报表名称、路径、模板或数据集名称、owner、当前是否仍在使用。
- 数据集定义：数据集 SQL、数据源连接名、参数列表、默认参数值、过滤条件、排序或分页逻辑。
- 字段清单：字段名、中文显示名、类型、是否为计算字段、字段表达式。
- 报表侧计算：单元格公式、汇总公式、前端计算字段、条件过滤、维度展开方式。
- 样例结果：至少 10 行脱敏查询结果，尽量覆盖主要平台、包名、广告位或品牌维度。
- 刷新和缓存：finreport 是否实时查询、定时抽取、缓存结果；每天几点后数据稳定。
- 背后物理表或视图：如果 `rpt` 数据集背后确实引用物理表/视图，再提供对应 DDL；如果只是报表 SQL 或虚拟数据集，则无需强行提供 DDL。

如果某张表或 `rpt` 数据集已被替代或不再使用，请平台标注当前有效替代表/数据集，并提供替代资产的同类材料。

## 6. 表名前缀的初步理解

以下是基于当前补充信息和常见数仓分层命名的初步理解，最终以大数据平台解释为准。

| 前缀 | 常见含义 | 在本次分析中的理解 |
|---|---|---|
| `rpt` | finreport 报表系统资产 | 优先理解为 finreport 报表数据集或报表层资产；需要看数据集 SQL、参数、报表侧计算和样例结果，DDL 仅在背后有物理表/视图时需要 |
| `sdm` | subject data mart / service data mart | 主题数据集市层，通常面向某一业务主题沉淀相对稳定的汇总数据 |
| `idm` | integrated data mart / intermediate data mart | 集成/指标数据集市层，通常承接跨源整合后的指标或宽表 |
| `odm` | operational data mart / original data mart | 贴近业务过程或运营域的加工层，可能比 `ods` 更业务化 |
| `dw` | data warehouse | 数仓公共层，常见于宽表、汇总表或公共事实表 |
| `ods` | operational data store | 贴源层，通常更接近业务系统原始结构 |
| `mojicom`、`ad` 等业务库名 | 业务系统库或业务域 schema | 广告后台、业务系统或应用域数据源 |

例如 `rpt.rpt_app_aty_basic_1d_d` 可以拆开理解为：

- 第一个 `rpt`：schema 或 database。
- 第二个 `rpt_`：表名前缀，表示报表层。
- `app_aty_basic`：应用活跃基础指标。
- `1d_d`：通常表示日粒度日表。

因此，`rpt` 当前不应简单当成普通数仓物理表。对 `rpt`，核心不是先要 DDL，而是先还原 finreport 的数据集定义和报表侧计算；只有当它背后确实落到物理表或视图时，DDL 才是必要材料。

## 7. 当前不急着定的口径

以下口径可以等模型和数据样例齐了再议：

- 产品 DAU 默认使用含刷新还是不含刷新。
- AndroidLite 是否永久并入 Android。
- 跨平台 DAU 是否可直接相加，还是需要用户级去重。
- 广告 ARPU 默认用广告收入除以广告 DAU，还是保留收入除以打开次数的 APP 层口径。
- 国际化广告 DAU 是否默认剔除 3 天新用户。
- MAU 是滚动 30 日还是自然月去重。

这些问题会影响 measure 定义，但不影响当前先建立 Lucy 服务层表的粒度和字段边界。

## 8. 下一步动作

1. 把本笔记第 5 节的 P0 现有表清单发给大数据平台，要求他们提供 DDL、表级说明、刷新频率/完成时间、样例数据和历史覆盖范围。
2. 拿到 DDL 和样例后，先判断每张表的实际粒度、主日期字段、维度枚举、是否存在重复分母字段，尤其是广告 DAU、打开次数、MAU、留存分母。
3. 基于现有表结构，再确定 `lucy_ceo_*` 专用服务层应该拆几张表、每张表的字段和粒度。
4. 目标服务层 DDL 通过后，再用 KTX scan/ingest 生成 schema，写 semantic overlay，并建立 CEO 前端对账 eval。
