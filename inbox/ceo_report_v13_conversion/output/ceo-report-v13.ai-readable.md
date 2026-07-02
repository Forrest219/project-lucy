# CEO一眼报数据溯源及验证报告 V1.3

- 来源文件：`temp/CEO一眼报数据溯源及验证报告V1.3(2).docx`
- 转换说明：本文件由 DOCX 自动抽取生成，已对 URL 参数中的口令/token 类字段做脱敏。


## 目录

一、文档编写说明 4

1.业务背景 4

2.规范要求 4

二、CEO一眼报页面 5

1.首页 5

1.1指标清单 5

1.2指标口径/计算规则 7

1.3数据溯源 7

1.4来源环境对比数据 19

1.5 FineDataLink数仓 19

1.6 数据验证结论 21

2.净现金流 22

2.1指标清单 23

2.2指标口径/计算规则 23

2.3数据溯源 23

2.4来源环境对比数据 26

2.5 FineDataLink数仓 26

2.6 数据验证结论 29

3.营业收入 32

3.1指标清单 33

3.2指标口径/计算规则 34

3.3数据溯源 34

3.4来源环境对比数据 36

3.5 FineDataLink数仓 36

3.6 数据验证结论 37

4.营业收入-广告 40

4.1指标清单 41

4.2指标口径/计算规则 41

4.3数据溯源 42

4.4来源环境对比数据 43

4.5 FineDataLink数仓 43

4.6 数据验证结论 44

5.营业收入-会员 45

5.1指标清单 46

5.2指标口径/计算规则 46

5.3数据溯源 46

5.4来源环境对比数据 48

5.5 FineDataLink数仓 48

5.6 数据验证结论 49

6.营业收入-国际化广告 50

6.1指标清单 50

6.2指标口径/计算规则 51

6.3数据溯源 51

6.4来源环境对比数据 52

6.5 FineDataLink数仓 52

6.6 数据验证结论 53

7.营业收入-国际化会员 54

7.1指标清单 55

7.2指标口径/计算规则 55

7.3数据溯源 57

7.4来源环境对比数据 60

7.5 FineDataLink数仓 60

7.6 数据验证结论 61

8.净利润 62

8.1指标清单 63

8.2指标口径/计算规则 63

8.3数据溯源 65

8.4来源环境对比数据 73

8.5 FineDataLink数仓 77

8.6 数据验证结论 82

9.M-ROE 86

9.1指标清单 87

9.2指标口径/计算规则 87

9.3数据溯源 88

9.4来源环境对比数据 88

9.5 FineDataLink数仓 88

9.6 数据验证结论 92

10.负反馈率 94

10.1指标清单 94

10.2指标口径/计算规则 95

10.3数据溯源 95

10.4来源环境对比数据 96

10.5 FineDataLink数仓 98

10.6 数据验证结论 99

11.CLV 101

11.1指标清单 102

11.2指标口径/计算规则 103

11.3数据溯源 103

11.4来源环境对比数据 107

11.5 FineDataLink数仓 107

11.6 数据验证结论 109

12.CLV-国内 113

12.1指标清单 114

12.2指标口径/计算规则 114

12.3数据溯源 115

12.4来源环境对比数据 116

12.5 FineDataLink数仓 116

12.6 数据验证结论 117

13.CLV-国际 119

13.1指标清单 119

13.2指标口径/计算规则 120

13.3数据溯源 121

13.4来源环境对比数据 122

13.5 FineDataLink数仓 122

13.6 数据验证结论 123

14.DAU 124

14.1指标清单 124

14.2指标口径/计算规则 125

14.3数据溯源 125

14.4来源环境对比数据 129

14.5 FineDataLink数仓 129

14.6 数据验证结论 130

15.业务总览-国际化 132

15.1指标清单 133

15.2指标口径/计算规则 133

15.3 FineDataLink数仓 135

16.业务总览-会员 135

17.业务总览-TOB 136

17.1指标清单 136

17.2指标口径/计算规则 136

17.3数据溯源 137

17.4来源环境对比数据 138

17.5 FineDataLink数仓 138

17.6 数据验证结论 139

18.业务总览-广告 140


## 一、文档编写说明


### 1.业务背景

基于CEO一眼报首页、净现金流、营业收入、营业收入-广告、营业收入-会员、营业收入-国际化广告、营业收入-国际化会员、净利润、M-ROE、负反馈率、CLV、CLV-国内、CLV-国际、DAU、业务总览-国际化、业务总览-会员、业务总览-TOB、业务总览-广告，共计18个页面应用指标的数据治理、数据溯源、逻辑处理、数据校验过程编写此文档。


### 2.规范要求

1、保持数据源的一致性，与FineBi看板数据同源。

2、 数据计算处理逻辑的完整性可见，准确性要实现同维度CEO页面数据与FineBi看板校验准确。

3、数据核验时无法与页面前端核对一致的特殊情况做备注说明。

4、鉴于安全因素，财务类数据不允许在阿里云数据库存放， 净现金流、营业收入、净利润、M-ROE共4个页面数据在生产库存储。


## 二、CEO一眼报页面


### 1.首页

[图片占位：1 张，原 DOCX 内嵌图片未 OCR]


#### 1.1指标清单

<!-- table-1 -->
**表格 1**

字段：指标名称 / 统计维度 / 统计频率 / 数据来源方式 / 来源系统 / 系统表名

- 记录 1
  - 指标名称: 友盟单价
  - 统计维度: 国内
  - 统计频率: 日/月
  - 数据来源方式: 系统取数
  - 来源系统: 大数据中心
  - 系统表名: ods_channel_consumption_hand_copy_report_d

- 记录 2
  - 指标名称: 日均活跃渗透率
  - 统计维度: 国内
  - 统计频率: 月
  - 数据来源方式: 手工上传
  - 系统表名: sdm_penetration_rate_a_d

- 记录 3
  - 指标名称: 日均安装渗透率
  - 统计维度: 国内
  - 统计频率: 月
  - 数据来源方式: 手工上传
  - 系统表名: sdm_penetration_rate_a_d

- 记录 4
  - 指标名称: FW国际综合排名
  - 统计维度: 国际
  - 统计频率: 月
  - 数据来源方式: 手工上传
  - 系统表名: sdm_penetration_rate_a_d

- 记录 5
  - 指标名称: 品牌声量占比
  - 统计维度: 国内
  - 统计频率: 日/月
  - 数据来源方式: 系统取数
  - 来源系统: 大数据中心
  - 系统表名: baidu_search_index

- 记录 6
  - 指标名称: 广告营收占比
  - 统计维度: 国内
  - 统计频率: 月
  - 数据来源方式: 手工上传
  - 系统表名: sdm_penetration_rate_a_d

- 记录 7
  - 指标名称: 新增用户占比
  - 统计维度: 国内
  - 统计频率: 周
  - 数据来源方式: 手工上传
  - 系统表名: sdm_user_share_a_d

- 记录 8
  - 指标名称: 现金结余
  - 统计维度: 国内
  - 统计频率: 日/月
  - 数据来源方式: 系统取数
  - 来源系统: 大数据中心

- 记录 9
  - 指标名称: 同类赛道媒体机会
  - 统计维度: 国内
  - 统计频率: 月累/年累
  - 数据来源方式: 手工上传
  - 系统表名: odm_arket_overall_budget_a_d

- 记录 10
  - 指标名称: 同类赛道媒体目标市场
  - 统计维度: 国内
  - 统计频率: 月累/年累
  - 数据来源方式: 手工上传
  - 系统表名: odm_arket_overall_budget_a_d

- 记录 11
  - 指标名称: 同类赛道媒体目标客户
  - 统计维度: 国内
  - 统计频率: 月累/年累
  - 数据来源方式: 手工上传
  - 系统表名: odm_arket_overall_budget_a_d

- 记录 12
  - 指标名称: 客户关系建立
  - 统计维度: 国内
  - 统计频率: 月累/年累
  - 数据来源方式: 系统取数
  - 来源系统: 大数据中心
  - 系统表名: 销售机会数据表 ad_xsy_crm.ad_xsy_crm_custom_entity3 ad_xsy_crm.ad_xsy_crm_entity_type ad_xsy_crm.ad_xsy_crm_user ad_xsy_crm.ad_xsy_crm_department ad_xsy_crm.ad_xsy_crm_opportunity ad_xsy_crm.ad_xsy_crm_field_enum ad_xsy_crm.ad_xsy_crm_user ad_xsy_crm.ad_xsy_crm_account ad_xsy_crm.ad_xsy_crm_custom_entity1 ad_xsy_crm.ad_xsy_crm_stage ad_xsy_crm.ad_xsy_crm_custom_entity4 ad_xsy_crm.ad_xsy_crm_contact 广告开票回款情况 hsar_cust_rec_headers moji_ads_monthly_record_initial moji_invoice_associated moji_invoice_req_headers moji_invoice_headers hsbm_receipt_lines hsbm_receipt_headers hsbm_payment_lines hsbm_payment_headers hspm_rule hspm_rule_data

- 记录 13
  - 指标名称: 获取销售机会
  - 统计维度: 国内
  - 统计频率: 月累/年累
  - 数据来源方式: 系统取数
  - 来源系统: 大数据中心
  - 系统表名: 销售机会数据表 ad_xsy_crm.ad_xsy_crm_custom_entity3 ad_xsy_crm.ad_xsy_crm_entity_type ad_xsy_crm.ad_xsy_crm_user ad_xsy_crm.ad_xsy_crm_department ad_xsy_crm.ad_xsy_crm_opportunity ad_xsy_crm.ad_xsy_crm_field_enum ad_xsy_crm.ad_xsy_crm_user ad_xsy_crm.ad_xsy_crm_account ad_xsy_crm.ad_xsy_crm_custom_entity1 ad_xsy_crm.ad_xsy_crm_stage ad_xsy_crm.ad_xsy_crm_custom_entity4 ad_xsy_crm.ad_xsy_crm_contact 广告开票回款情况 hsar_cust_rec_headers moji_ads_monthly_record_initial moji_invoice_associated moji_invoice_req_headers moji_invoice_headers hsbm_receipt_lines hsbm_receipt_headers hsbm_payment_lines hsbm_payment_headers hspm_rule hspm_rule_data

- 记录 14
  - 指标名称: 提案反馈
  - 统计维度: 国内
  - 统计频率: 月累/年累
  - 数据来源方式: 系统取数
  - 来源系统: 大数据中心
  - 系统表名: 销售机会数据表 ad_xsy_crm.ad_xsy_crm_custom_entity3 ad_xsy_crm.ad_xsy_crm_entity_type ad_xsy_crm.ad_xsy_crm_user ad_xsy_crm.ad_xsy_crm_department ad_xsy_crm.ad_xsy_crm_opportunity ad_xsy_crm.ad_xsy_crm_field_enum ad_xsy_crm.ad_xsy_crm_user ad_xsy_crm.ad_xsy_crm_account ad_xsy_crm.ad_xsy_crm_custom_entity1 ad_xsy_crm.ad_xsy_crm_stage ad_xsy_crm.ad_xsy_crm_custom_entity4 ad_xsy_crm.ad_xsy_crm_contact 广告开票回款情况 hsar_cust_rec_headers moji_ads_monthly_record_initial moji_invoice_associated moji_invoice_req_headers moji_invoice_headers hsbm_receipt_lines hsbm_receipt_headers hsbm_payment_lines hsbm_payment_headers hspm_rule hspm_rule_data

- 记录 15
  - 指标名称: 排期沟通
  - 统计维度: 国内
  - 统计频率: 月累/年累
  - 数据来源方式: 系统取数
  - 来源系统: 大数据中心
  - 系统表名: 销售机会数据表 ad_xsy_crm.ad_xsy_crm_custom_entity3 ad_xsy_crm.ad_xsy_crm_entity_type ad_xsy_crm.ad_xsy_crm_user ad_xsy_crm.ad_xsy_crm_department ad_xsy_crm.ad_xsy_crm_opportunity ad_xsy_crm.ad_xsy_crm_field_enum ad_xsy_crm.ad_xsy_crm_user ad_xsy_crm.ad_xsy_crm_account ad_xsy_crm.ad_xsy_crm_custom_entity1 ad_xsy_crm.ad_xsy_crm_stage ad_xsy_crm.ad_xsy_crm_custom_entity4 ad_xsy_crm.ad_xsy_crm_contact 广告开票回款情况 hsar_cust_rec_headers moji_ads_monthly_record_initial moji_invoice_associated moji_invoice_req_headers moji_invoice_headers hsbm_receipt_lines hsbm_receipt_headers hsbm_payment_lines hsbm_payment_headers hspm_rule hspm_rule_data

- 记录 16
  - 指标名称: 需求确认
  - 统计维度: 国内
  - 统计频率: 月累/年累
  - 数据来源方式: 系统取数
  - 来源系统: 大数据中心
  - 系统表名: 销售机会数据表 ad_xsy_crm.ad_xsy_crm_custom_entity3 ad_xsy_crm.ad_xsy_crm_entity_type ad_xsy_crm.ad_xsy_crm_user ad_xsy_crm.ad_xsy_crm_department ad_xsy_crm.ad_xsy_crm_opportunity ad_xsy_crm.ad_xsy_crm_field_enum ad_xsy_crm.ad_xsy_crm_user ad_xsy_crm.ad_xsy_crm_account ad_xsy_crm.ad_xsy_crm_custom_entity1 ad_xsy_crm.ad_xsy_crm_stage ad_xsy_crm.ad_xsy_crm_custom_entity4 ad_xsy_crm.ad_xsy_crm_contact 广告开票回款情况 hsar_cust_rec_headers moji_ads_monthly_record_initial moji_invoice_associated moji_invoice_req_headers moji_invoice_headers hsbm_receipt_lines hsbm_receipt_headers hsbm_payment_lines hsbm_payment_headers hspm_rule hspm_rule_data

- 记录 17
  - 指标名称: 确认下单
  - 统计维度: 国内
  - 统计频率: 月累/年累
  - 数据来源方式: 系统取数
  - 来源系统: 结算中台
  - 系统表名: 销售机会数据表 ad_xsy_crm.ad_xsy_crm_custom_entity3 ad_xsy_crm.ad_xsy_crm_entity_type ad_xsy_crm.ad_xsy_crm_user ad_xsy_crm.ad_xsy_crm_department ad_xsy_crm.ad_xsy_crm_opportunity ad_xsy_crm.ad_xsy_crm_field_enum ad_xsy_crm.ad_xsy_crm_user ad_xsy_crm.ad_xsy_crm_account ad_xsy_crm.ad_xsy_crm_custom_entity1 ad_xsy_crm.ad_xsy_crm_stage ad_xsy_crm.ad_xsy_crm_custom_entity4 ad_xsy_crm.ad_xsy_crm_contact 广告开票回款情况 hsar_cust_rec_headers moji_ads_monthly_record_initial moji_invoice_associated moji_invoice_req_headers moji_invoice_headers hsbm_receipt_lines hsbm_receipt_headers hsbm_payment_lines hsbm_payment_headers hspm_rule hspm_rule_data

- 记录 18
  - 指标名称: 应收账款
  - 统计维度: 国内
  - 统计频率: 月累/年累
  - 数据来源方式: 系统取数
  - 来源系统: 结算中台
  - 系统表名: 销售机会数据表 ad_xsy_crm.ad_xsy_crm_custom_entity3 ad_xsy_crm.ad_xsy_crm_entity_type ad_xsy_crm.ad_xsy_crm_user ad_xsy_crm.ad_xsy_crm_department ad_xsy_crm.ad_xsy_crm_opportunity ad_xsy_crm.ad_xsy_crm_field_enum ad_xsy_crm.ad_xsy_crm_user ad_xsy_crm.ad_xsy_crm_account ad_xsy_crm.ad_xsy_crm_custom_entity1 ad_xsy_crm.ad_xsy_crm_stage ad_xsy_crm.ad_xsy_crm_custom_entity4 ad_xsy_crm.ad_xsy_crm_contact 广告开票回款情况 hsar_cust_rec_headers moji_ads_monthly_record_initial moji_invoice_associated moji_invoice_req_headers moji_invoice_headers hsbm_receipt_lines hsbm_receipt_headers hsbm_payment_lines hsbm_payment_headers hspm_rule hspm_rule_data

- 记录 19
  - 指标名称: 回款金额
  - 统计维度: 国内
  - 统计频率: 月累/年累
  - 数据来源方式: 系统取数
  - 来源系统: 结算中台
  - 系统表名: 销售机会数据表 ad_xsy_crm.ad_xsy_crm_custom_entity3 ad_xsy_crm.ad_xsy_crm_entity_type ad_xsy_crm.ad_xsy_crm_user ad_xsy_crm.ad_xsy_crm_department ad_xsy_crm.ad_xsy_crm_opportunity ad_xsy_crm.ad_xsy_crm_field_enum ad_xsy_crm.ad_xsy_crm_user ad_xsy_crm.ad_xsy_crm_account ad_xsy_crm.ad_xsy_crm_custom_entity1 ad_xsy_crm.ad_xsy_crm_stage ad_xsy_crm.ad_xsy_crm_custom_entity4 ad_xsy_crm.ad_xsy_crm_contact 广告开票回款情况 hsar_cust_rec_headers moji_ads_monthly_record_initial moji_invoice_associated moji_invoice_req_headers moji_invoice_headers hsbm_receipt_lines hsbm_receipt_headers hsbm_payment_lines hsbm_payment_headers hspm_rule hspm_rule_data

- 记录 20
  - 指标名称: 市场需求
  - 统计维度: 国内
  - 统计频率: 年累
  - 数据来源方式: 手工上传
  - 系统表名: odm_tob_order_goal_a_d

- 记录 21
  - 指标名称: 客户关系建立
  - 统计维度: 国内
  - 统计频率: 年累
  - 数据来源方式: 系统取数
  - 来源系统: CRM系统
  - 系统表名: api获取销售易表 机会表：opportunity 合同表：contract 签单表：tob_order_signing_sheet

- 记录 22
  - 指标名称: 客户需求确认
  - 统计维度: 国内
  - 统计频率: 年累
  - 数据来源方式: 系统取数
  - 来源系统: CRM系统
  - 系统表名: api获取销售易表 机会表：opportunity 合同表：contract 签单表：tob_order_signing_sheet

- 记录 23
  - 指标名称: 方案反馈
  - 统计维度: 国内
  - 统计频率: 年累
  - 数据来源方式: 系统取数
  - 来源系统: CRM系统
  - 系统表名: api获取销售易表 机会表：opportunity 合同表：contract 签单表：tob_order_signing_sheet

- 记录 24
  - 指标名称: 客户确认
  - 统计维度: 国内
  - 统计频率: 年累
  - 数据来源方式: 系统取数
  - 来源系统: CRM系统
  - 系统表名: api获取销售易表 机会表：opportunity 合同表：contract 签单表：tob_order_signing_sheet

- 记录 25
  - 指标名称: 签单
  - 统计维度: 国内
  - 统计频率: 年累
  - 数据来源方式: 系统取数
  - 来源系统: 结算中台
  - 系统表名: api获取销售易表 机会表：opportunity 合同表：contract 签单表：tob_order_signing_sheet

- 记录 26
  - 指标名称: 已开票
  - 统计维度: 国内
  - 统计频率: 年累
  - 数据来源方式: 系统取数
  - 来源系统: 结算中台
  - 系统表名: api获取销售易表 机会表：opportunity 合同表：contract 签单表：tob_order_signing_sheet

- 记录 27
  - 指标名称: 已回款
  - 统计维度: 国内
  - 统计频率: 年累
  - 数据来源方式: 系统取数
  - 来源系统: 结算中台
  - 系统表名: api获取销售易表 机会表：opportunity 合同表：contract 签单表：tob_order_signing_sheet


#### 1.2指标口径/计算规则

友盟单价：友盟统计口径的获客单价，如果是双端友盟新增那就是双端的友盟单价。

日均活跃渗透率：在统计周期(周/月)内，墨迹天气App的活跃用户数（日活/月活）占全网活跃用户数的比例。

日均安装渗透率：在统计周期(周/月)内，墨迹天气App的日均新安装用户数占全网总日均新安装用户数的比例。

FW国际综合排名：ForecastWatch（以下简写为FW）比赛国际排名。

品牌声量占比：搜索“墨迹天气”品牌词的百度指数在搜索各个竞品（包含墨迹天气）品牌词的指数的占比。

广告营收占比：广告营收在总营收中的占比。

新增用户占比：墨迹天气的新安装用户在整体天气大盘的新安装用户的占比。

现金结余：现金结余是指企业在一定时期结束时，实际拥有的可随时支配的现金及现金等价物总额。


#### 1.3数据溯源

数据源


```sql
selectedDB
```
【数据中台】mysql-bfp_read-iscs_irpt-iscs_hsbm-172.16.23.101

【广告后台】mysql-ad_crm-mocrmro1

销售易接口数据

【数据中台】mysql-tblu-motblro1-r-mjtab-s.sql.mojiweather.com

2、数据源SQL逻辑

<!-- table-2 -->
**表格 2**

字段：序号 / 系统表名 / 溯源SQL

- 记录 1
  - 序号: 1
  - 系统表名: 友盟单价：ods_channel_consumption_hand_copy_report_d
  - 溯源SQL:

```sql
select *
from from hive.ods.ods_channel_consumption_hand_copy_report_d
where where stat_date in (select max(stat_date)
from from hive.ods.ods_channel_consumption_hand_copy_report_d)
```

- 记录 2
  - 序号: 2
  - 系统表名: 百度指数：baidu_search_index
  - 溯源SQL:

```sql
SELECT stat_date,sum(weather_and_forcast) `index`
FROM FROM baidu_search_index
GROUP by GROUP by stat_date
```

- 记录 3
  - 序号: 3
  - 系统表名: 销售机会数据表 ad_xsy_crm.ad_xsy_crm_custom_entity3 ad_xsy_crm.ad_xsy_crm_entity_type ad_xsy_crm.ad_xsy_crm_user ad_xsy_crm.ad_xsy_crm_department ad_xsy_crm.ad_xsy_crm_opportunity ad_xsy_crm.ad_xsy_crm_field_enum ad_xsy_crm.ad_xsy_crm_user ad_xsy_crm.ad_xsy_crm_account ad_xsy_crm.ad_xsy_crm_custom_entity1 ad_xsy_crm.ad_xsy_crm_stage ad_xsy_crm.ad_xsy_crm_custom_entity4 ad_xsy_crm.ad_xsy_crm_contact 广告开票回款情况 hsar_cust_rec_headers moji_ads_monthly_record_initial moji_invoice_associated moji_invoice_req_headers moji_invoice_headers hsbm_receipt_lines hsbm_receipt_headers hsbm_payment_lines hsbm_payment_headers hspm_rule hspm_rule_data
  - 溯源SQL:

```sql
子销售数据：
select select axcce3.customEntity3Id, axcce3.name, axcet.label as entityType_name, axcu.name as ownerId_name, axcd.departName as dimDepart_departName, if (axcce3.lockStatus='1','锁定','未锁定') as lockStatus, axcce3.customItem2__c, axcce3.customItem3__c, xsjh.opportunityName, axcce3.customItem5__c, axcce3.customItem6__c, if (axcce3.customItem8__c='1','是','否') as customItem8__c, axcce3.customItem12__c, axcce3.customItem14__c, axcce3.customItem15__c, axcce3.customItem16__c, axcce3.customItem11__c, axcce3.customItem17__c, axcce3.customItem18__c, axcce3.customItem19__c, axcce3.customItem20__c, axcce3.customItem21__c, axcce3.customItem22__c, e3.label as customItem23__c, axcce3.customItem25__c, e6.label as customItem24__c, e7.label as customItem26__c, axcce3.createdAt, cu.name as createdBy, axcce3.updatedAt, u.name as updatedBy, axcce3.customItem28__c, axcce3.customItem27__c
from from ad_xsy_crm.ad_xsy_crm_custom_entity3 as axcce3
left join left
join join ad_xsy_crm.ad_xsy_crm_entity_type axcet ON axcce3.entitytype = axcet.entitytypeid
LEFT JOIN LEFT
JOIN JOIN ad_xsy_crm.ad_xsy_crm_user axcu ON axcce3.ownerid = axcu.userid
LEFT JOIN LEFT
JOIN JOIN ad_xsy_crm.ad_xsy_crm_department axcd ON axcce3.dimdepart = axcd.departmentid
LEFT JOIN LEFT
JOIN JOIN ad_xsy_crm.ad_xsy_crm_opportunity xsjh ON axcce3.customItem4__c = xsjh.opportunityId
LEFT JOIN LEFT
JOIN JOIN ad_xsy_crm.ad_xsy_crm_field_enum AS e3 ON axcce3.customItem23__c = e3.value
AND AND e3.field = 'customItem141'
and and e3.table = 'ad_xsy_crm_opportunity'
LEFT JOIN LEFT
JOIN JOIN ad_xsy_crm.ad_xsy_crm_field_enum AS e6 ON axcce3.customItem24__c = e6.value
AND AND e6.field = 'customItem187__c'
and and e6.table = 'ad_xsy_crm_opportunity'
LEFT JOIN LEFT
JOIN JOIN ad_xsy_crm.ad_xsy_crm_field_enum AS e7 ON axcce3.customItem26__c = e7.value
AND AND e7.field = 'customItem188__c'
and and e7.table = 'ad_xsy_crm_opportunity'
left join left
join join ad_xsy_crm.ad_xsy_crm_user cu ON axcce3.createdBy = cu.userid
LEFT JOIN LEFT
JOIN JOIN ad_xsy_crm.ad_xsy_crm_user u ON axcce3.updatedby = u.userid 子销售机会模块
SELECT SELECT axco.opportunityid, axcet.label as entitytype_name, axcd.departname, axcu.name as user_name, cu1.name sj_name, axco.opportunityname, axca.accountname, e6.label as c_187_name, e7.label as c_188_name,
case case
when when axco.customitem189__c = '1' then '品牌程序化PD'
when when axco.customitem189__c = '2' then '品牌程序化PDB'
when when axco.customitem189__c = '3' then '品牌程序化RTB'
when when axco.customitem189__c = '4' then '品牌直投（项目类）'
when when axco.customitem189__c = '5' then '品牌直投（常规类）'
when when axco.customitem189__c = '6' then '品牌直投（程序化类）' end customitem189__c, axco.customitem136, axco.customitem137, axco.money, a.name as customitem_name, clgs.name customitem179__c, e1.label status_name, axcs.stagename, axco.customitem185__c, e5.label as 168__c_label, e4.label as 167__c_label, e2.label as reason_label, axco.reasondesc, axco.createdAt, cu.name as created_name, axco.leadid, axco.fcastmoney, e3.label as 141__c_label, lxr.contactName customitem176__c, axco.customitem177__c, axco.customItem191__c
FROM FROM ad_xsy_crm.ad_xsy_crm_opportunity AS axco
left join left
join join ad_xsy_crm.ad_xsy_crm_entity_type axcet ON axco.entitytype = axcet.entitytypeid
left join left
join join ad_xsy_crm.ad_xsy_crm_department axcd ON axco.dimdepart = axcd.departmentid
left join left
join join ad_xsy_crm.ad_xsy_crm_user axcu ON axco.ownerid = axcu.userid
left join left
join join ad_xsy_crm.ad_xsy_crm_account axca ON axco.accountid = axca.accountid
left join left
join join ad_xsy_crm.ad_xsy_crm_custom_entity1 a ON axco.customitem138 = a.customentity1id
left join left
join join ad_xsy_crm.ad_xsy_crm_stage axcs ON axco.salestageid = axcs.stageid
left join left
join join ad_xsy_crm.ad_xsy_crm_user cu ON axco.createdby = cu.userid
left join left
join join ad_xsy_crm.ad_xsy_crm_user cu1 ON axco.customitem166__c = cu1.userid
LEFT JOIN LEFT
JOIN JOIN ad_xsy_crm.ad_xsy_crm_custom_entity4 AS clgs ON axco.customitem179__c = clgs.customEntity4Id
LEFT JOIN LEFT
JOIN JOIN ad_xsy_crm.ad_xsy_crm_contact AS lxr ON axco.customitem176__c = lxr.contactId
LEFT JOIN LEFT
JOIN JOIN ad_xsy_crm.ad_xsy_crm_field_enum AS e1 ON axco.status = e1.value
AND AND e1.field = 'status'
and and e1.table = 'ad_xsy_crm_opportunity'
LEFT JOIN LEFT
JOIN JOIN ad_xsy_crm.ad_xsy_crm_field_enum AS e2 ON axco.reason = e2.value
AND AND e2.field = 'reason'
and and e2.table = 'ad_xsy_crm_opportunity'
LEFT JOIN LEFT
JOIN JOIN ad_xsy_crm.ad_xsy_crm_field_enum AS e3 ON axco.customItem141 = e3.value
AND AND e3.field = 'customItem141'
and and e3.table = 'ad_xsy_crm_opportunity'
LEFT JOIN LEFT
JOIN JOIN ad_xsy_crm.ad_xsy_crm_field_enum AS e4 ON axco.customItem167__c = e4.value
AND AND e4.field = 'customItem167__c'
and and e4.table = 'ad_xsy_crm_opportunity'
LEFT JOIN LEFT
JOIN JOIN ad_xsy_crm.ad_xsy_crm_field_enum AS e5 ON axco.customItem168__c = e5.value
AND AND e5.field = 'customItem168__c'
and and e5.table = 'ad_xsy_crm_opportunity'
LEFT JOIN LEFT
JOIN JOIN ad_xsy_crm.ad_xsy_crm_field_enum AS e6 ON axco.customItem187__c = e6.value
AND AND e6.field = 'customItem187__c'
and and e6.table = 'ad_xsy_crm_opportunity'
LEFT JOIN LEFT
JOIN JOIN ad_xsy_crm.ad_xsy_crm_field_enum AS e7 ON axco.customItem188__c = e7.value
AND AND e7.field = 'customItem188__c'
and and e7.table = 'ad_xsy_crm_opportunity' 广告开票回款
SELECT SELECT mri.contract_num AS contract_num, -- 合同号 mri.date_value1 AS start_date, -- 起投日期 mri.date_value2 AS end_date, -- 结束日期 mri.agent_number AS agent_code, -- 代理编码 mri.agent_name AS agent_name, -- 代理名称 mri.merchant_number AS merchant_code, -- 客商编码 mri.merchant_name AS merchant_name, -- 客商名称 mri.settle_amount AS contract_amount, -- 合同金额 mri.htax_amount AS contract_amount_excl_tax, -- 合同金额不含税 mri.hsettle_amount AS contract_amount_tax, -- 合同金额税 mri.currency_code AS currency, -- 币种 mri.big_value1 AS rebate_rate, -- 返点比例 mri.big_value2 AS rebate_amount, -- 返点金额 mri.big_value3 AS run_volume, -- 跑量 mri.big_value3 /1.06 AS run_volume_excl_tax, -- 跑量不含税 mri.big_value3 -ROUND(mri.big_value3 /1.06,2) AS run_volume_tax, -- 跑量税 (
SELECT SELECT SUM((SUBSTRING_INDEX(SUBSTRING_INDEX(a.invoice_amounted_detail, '\n', numbers.n), '\n', -1)))
FROM FROM ( -- 生成一个足够大的数字序列
SELECT SELECT 1 n
UNION ALL UNION ALL
SELECT SELECT 2
UNION ALL UNION ALL
SELECT SELECT 3
UNION ALL UNION ALL
SELECT SELECT 4
UNION ALL UNION ALL
SELECT SELECT 5
UNION ALL UNION ALL
SELECT SELECT 6
UNION ALL UNION ALL
SELECT SELECT 7
UNION ALL UNION ALL
SELECT SELECT 8
UNION ALL UNION ALL
SELECT SELECT 9
UNION ALL UNION ALL
SELECT SELECT 10
UNION ALL UNION ALL
SELECT SELECT 11
UNION ALL UNION ALL
SELECT SELECT 12
UNION ALL UNION ALL
SELECT SELECT 13
UNION ALL UNION ALL
SELECT SELECT 14
UNION ALL UNION ALL
SELECT SELECT 15
UNION ALL UNION ALL
SELECT SELECT 16
UNION ALL UNION ALL
SELECT SELECT 17
UNION ALL UNION ALL
SELECT SELECT 18 -- 可以根据实际情况添加更多数字 ) numbers
WHERE WHERE numbers.n <= (LENGTH(a.invoice_amounted_detail) - LENGTH(REPLACE(a.invoice_amounted_detail, '\n', '')) + 1) ) AS total_invoiced_amount, -- 已开票金额合计 (CASE
WHEN WHEN LEFT(a.invoice_amounted_detail, 1) = '\n' THEN SUBSTRING(a.invoice_amounted_detail, 2) ELSE a.invoice_amounted_detail END) AS invoiced_amount_detail, -- 已开票金额明细 REPLACE((CASE
WHEN WHEN LEFT(a.invoice_date_detail, 1) = '\n' THEN SUBSTRING(a.invoice_date_detail, 2) ELSE a.invoice_date_detail END),'-','/') AS invoice_date_detail, -- 开票日期明细 (
SELECT SELECT SUM((SUBSTRING_INDEX(SUBSTRING_INDEX(b.wapply_amount_detail, '\n', numbers.n), '\n', -1)))
FROM FROM ( -- 生成一个足够大的数字序列
SELECT SELECT 1 n
UNION ALL UNION ALL
SELECT SELECT 2
UNION ALL UNION ALL
SELECT SELECT 3
UNION ALL UNION ALL
SELECT SELECT 4
UNION ALL UNION ALL
SELECT SELECT 5
UNION ALL UNION ALL
SELECT SELECT 6
UNION ALL UNION ALL
SELECT SELECT 7
UNION ALL UNION ALL
SELECT SELECT 8
UNION ALL UNION ALL
SELECT SELECT 9
UNION ALL UNION ALL
SELECT SELECT 10
UNION ALL UNION ALL
SELECT SELECT 11
UNION ALL UNION ALL
SELECT SELECT 12
UNION ALL UNION ALL
SELECT SELECT 13
UNION ALL UNION ALL
SELECT SELECT 14
UNION ALL UNION ALL
SELECT SELECT 15
UNION ALL UNION ALL
SELECT SELECT 16
UNION ALL UNION ALL
SELECT SELECT 17
UNION ALL UNION ALL
SELECT SELECT 18 -- 可以根据实际情况添加更多数字 ) numbers
WHERE WHERE numbers.n <= (LENGTH(b.wapply_amount_detail) - LENGTH(REPLACE(b.wapply_amount_detail, '\n', '')) + 1) )+ IFNULL(d.amount,0) AS total_received_amount, -- 已回款金额合计回款 CONCAT((CASE
WHEN WHEN LEFT(b.wapply_amount_detail, 1) = '\n' THEN SUBSTRING(b.wapply_amount_detail, 2) ELSE b.wapply_amount_detail END),IF(d.receipt_line_id IS NULL,'','\n'),IFNULL(d.amount,'')) AS received_amount_detail, -- 已回款金额明细 REPLACE(CONCAT((CASE
WHEN WHEN LEFT(b.wapply_date_detail, 1) = '\n' THEN SUBSTRING(b.wapply_date_detail, 2) ELSE b.wapply_date_detail END),IF(d.receipt_line_id IS NULL,'','\n'),IFNULL(d.receipt_date,'')),'-','/') AS receipt_date, -- 到账日期 (
SELECT SELECT MAX(STR_TO_DATE(SUBSTRING_INDEX(SUBSTRING_INDEX(b.wapply_date_detail, '\n', numbers.n), '\n', -1), '%Y-%m-%d'))
FROM FROM ( -- 生成一个足够大的数字序列
SELECT SELECT 1 n
UNION ALL UNION ALL
SELECT SELECT 2
UNION ALL UNION ALL
SELECT SELECT 3
UNION ALL UNION ALL
SELECT SELECT 4
UNION ALL UNION ALL
SELECT SELECT 5
UNION ALL UNION ALL
SELECT SELECT 6
UNION ALL UNION ALL
SELECT SELECT 7
UNION ALL UNION ALL
SELECT SELECT 8
UNION ALL UNION ALL
SELECT SELECT 9
UNION ALL UNION ALL
SELECT SELECT 10
UNION ALL UNION ALL
SELECT SELECT 11
UNION ALL UNION ALL
SELECT SELECT 12
UNION ALL UNION ALL
SELECT SELECT 13
UNION ALL UNION ALL
SELECT SELECT 14
UNION ALL UNION ALL
SELECT SELECT 15
UNION ALL UNION ALL
SELECT SELECT 16
UNION ALL UNION ALL
SELECT SELECT 17
UNION ALL UNION ALL
SELECT SELECT 18 -- 可以根据实际情况添加更多数字 ) numbers
WHERE WHERE numbers.n <= (LENGTH(b.wapply_date_detail) - LENGTH(REPLACE(b.wapply_date_detail, '\n', '')) + 1) ) AS latest_receipt_date, -- 最晚到账日期 mri.interval_cont_amt AS interval_contract_amount, -- 区间合同额 mri.interval_con_hs_amt AS interval_contract_amount_excl_tax, -- 区间合同额不含税 mri.interval_reb_amt AS interval_rebate_amount, -- 区间合同返点金额 mri.interval_reb_hs_amt AS interval_rebate_amount_excl_tax, -- 区间合同返点金额不含税 mri.interval_net_full_amt AS interval_net_full_amount, -- 区间合同净额（不扣除现金折扣） mri.interval_net_amt AS interval_net_amount, -- 区间合同净额 mri.belong_group AS belong_group, -- 所属集团 mri.direct_cust_sales AS direct_customer_sales, -- 直客销售 mri.channel_sales AS channel_sales, -- 渠道销售 mri.industry_type AS industry_type, -- 行业 mri.new_old_cust AS new_old_customer, -- 新老客户 mri.cust_type AS customer_type, -- 客户类型 mri.exclusive_proj AS exclusive_project, -- 是否独家代理项目 mri.meteo_proj AS meteorological_project, -- 是否气象营销项目 mri.place_pos AS placement_position, -- 投放位置 mri.discount_sit AS discount_situation, -- 折扣情况 IFNULL(IF(mri.cash_disc_rate is null
or or mri.cash_disc_rate = '',d.rate*-1,mri.cash_disc_rate/100),0) AS cash_discount_rate, -- 现金折扣比例 mri.sale_method AS sales_method, -- 售卖方式 mri.cost_incl_tax AS cost_incl_tax, -- 成本含税 mri.res_cost_incl_tax AS resource_cost_incl_tax, -- 资源成本含税 mri.con_exp_date AS contract_expiry_date, -- 合同到期时间 IF((
SELECT SELECT MAX(STR_TO_DATE(SUBSTRING_INDEX(SUBSTRING_INDEX(b.wapply_date_detail, '\n', numbers.n), '\n', -1), '%Y-%m-%d'))
FROM FROM ( -- 生成一个足够大的数字序列
SELECT SELECT 1 n
UNION ALL UNION ALL
SELECT SELECT 2
UNION ALL UNION ALL
SELECT SELECT 3
UNION ALL UNION ALL
SELECT SELECT 4
UNION ALL UNION ALL
SELECT SELECT 5
UNION ALL UNION ALL
SELECT SELECT 6
UNION ALL UNION ALL
SELECT SELECT 7
UNION ALL UNION ALL
SELECT SELECT 8
UNION ALL UNION ALL
SELECT SELECT 9
UNION ALL UNION ALL
SELECT SELECT 10
UNION ALL UNION ALL
SELECT SELECT 11
UNION ALL UNION ALL
SELECT SELECT 12
UNION ALL UNION ALL
SELECT SELECT 13
UNION ALL UNION ALL
SELECT SELECT 14
UNION ALL UNION ALL
SELECT SELECT 15
UNION ALL UNION ALL
SELECT SELECT 16
UNION ALL UNION ALL
SELECT SELECT 17
UNION ALL UNION ALL
SELECT SELECT 18 -- 可以根据实际情况添加更多数字 ) numbers
WHERE WHERE numbers.n <= (LENGTH(b.wapply_date_detail) - LENGTH(REPLACE(b.wapply_date_detail, '\n', '')) + 1) ) IS NULL,'无回款到账日期',IF(mri.con_exp_date IS NULL,'无合同到期日',DATEDIFF(((
SELECT SELECT MAX(STR_TO_DATE(SUBSTRING_INDEX(SUBSTRING_INDEX(b.wapply_date_detail, '\n', numbers.n), '\n', -1), '%Y-%m-%d'))
FROM FROM ( -- 生成一个足够大的数字序列
SELECT SELECT 1 n
UNION ALL UNION ALL
SELECT SELECT 2
UNION ALL UNION ALL
SELECT SELECT 3
UNION ALL UNION ALL
SELECT SELECT 4
UNION ALL UNION ALL
SELECT SELECT 5
UNION ALL UNION ALL
SELECT SELECT 6
UNION ALL UNION ALL
SELECT SELECT 7
UNION ALL UNION ALL
SELECT SELECT 8
UNION ALL UNION ALL
SELECT SELECT 9
UNION ALL UNION ALL
SELECT SELECT 10
UNION ALL UNION ALL
SELECT SELECT 11
UNION ALL UNION ALL
SELECT SELECT 12
UNION ALL UNION ALL
SELECT SELECT 13
UNION ALL UNION ALL
SELECT SELECT 14
UNION ALL UNION ALL
SELECT SELECT 15
UNION ALL UNION ALL
SELECT SELECT 16
UNION ALL UNION ALL
SELECT SELECT 17
UNION ALL UNION ALL
SELECT SELECT 18 -- 可以根据实际情况添加更多数字 ) numbers
WHERE WHERE numbers.n <= (LENGTH(b.wapply_date_detail) - LENGTH(REPLACE(b.wapply_date_detail, '\n', '')) + 1) )),mri.con_exp_date))) AS overdue_days, -- 逾期天数 mri.con_acc_period AS contract_account_period, -- 合同帐期 mri.belong_area AS customer_belong_area, -- 客户归属区域 mri.season_strat_flag AS seasonal_strategy_flag, -- 是否享受淡季策略 DATE_FORMAT(mri.business_date, '%Y%m') AS year_months, -- 年份月份 mri.exposure AS exposure, -- 曝光 c.UA AS UA, -- UA c.eCPM / c.UA eCPM, IF(mri.sale_method IN('CPS','CPA'),1,IFNULL(IF(mri.belong_group IN ('阿里巴巴集团','京东集团'),ruled.value7,ruled.value4),1)) AS resource_coefficient -- 资源系数
FROM FROM iscs_hsbm.hsar_cust_rec_headers crh
JOIN JOIN iscs_hsbm.moji_ads_monthly_record_initial mri ON crh.contract_num = mri.contract_num
AND AND crh.var_value2 = mri.period_num
LEFT JOIN LEFT
JOIN JOIN (
SELECT SELECT crh.contract_num , crh.invoice_amounted , CONCAT(IFNULL(GROUP_CONCAT(mia2.this_associated_amount SEPARATOR '\n'),''),'\n',IFNULL(mri.invoice_amount,'')) AS invoice_amounted_detail, CONCAT(IFNULL(GROUP_CONCAT(DATE_FORMAT(mih.invoice_date,'%Y-%m-%d') SEPARATOR '\n'),''),'\n',IFNULL(mri.invoice_date,'')) AS invoice_date_detail
FROM FROM iscs_hsbm.hsar_cust_rec_headers crh
LEFT JOIN LEFT
JOIN JOIN (SELECT contract_num,invoice_amount,invoice_date
FROM FROM iscs_hsbm.moji_ads_monthly_record_initial
WHERE WHERE business_type_code = 'BT02-2'
AND AND period_num = '250303初始化'
GROUP BY GROUP BY contract_num,period_num) mri ON crh.contract_num = mri.contract_num
LEFT JOIN LEFT
JOIN JOIN iscs_hsbm.moji_invoice_associated mia ON mia.source_number = crh.cust_rec_number
LEFT JOIN LEFT
JOIN JOIN iscs_hsbm.moji_invoice_req_headers irh ON irh.invoice_req_id = mia.invoice_req_id
AND AND irh.invoice_req_status IN ('INVOICED_SUCCESS' ,'REVERSE_SUCCESS','PART_REVERSE')
LEFT JOIN LEFT
JOIN JOIN iscs_hsbm.moji_invoice_associated mia2 ON irh.invoice_req_id = mia2.invoice_req_id
AND AND mia2.associate_id = mia.associate_id
LEFT JOIN LEFT
JOIN JOIN iscs_hsbm.moji_invoice_headers mih ON mih.invoice_req_id = irh.invoice_req_id
WHERE WHERE crh.var_value1 IN ('BT02-2')
AND AND crh.var_value3 = '开票数据' --
AND AND (CASE
WHEN WHEN #{contractNum} is not null then crh.contract_num= #{contractNum} else 1=1 end)
GROUP BY GROUP BY crh.contract_num ) a ON crh.contract_num = a.contract_num
LEFT JOIN LEFT
JOIN JOIN (
SELECT SELECT e.contract_num , e.wapply_amount , CONCAT(GROUP_CONCAT(IFNULL(-1*pl2.payment_amount,'') SEPARATOR '\n'),'\n',e.wapply_amount_detail) AS wapply_amount_detail, CONCAT(GROUP_CONCAT(IFNULL(ph.payment_date,'') SEPARATOR '\n'),'\n',e.wapply_date_detail) AS wapply_date_detail, e.last_apply_date
FROM FROM (
SELECT SELECT crh.contract_num , crh.wapply_amount , CONCAT(IFNULL(GROUP_CONCAT(ROUND(rl.receipt_amount*IFNULL(mia.this_associated_amount/irh.invoice_tax_amount,1),2) SEPARATOR '\n'),''),'\n',IFNULL(mri.receipt_amount,'')) AS wapply_amount_detail, CONCAT(IFNULL(GROUP_CONCAT(DATE_FORMAT(rh.receipt_date,'%Y-%m-%d') SEPARATOR '\n'),''),'\n',IFNULL(mri.receipt_date,'')) AS wapply_date_detail, MAX(rh.receipt_date) AS last_apply_date
FROM FROM iscs_hsbm.hsar_cust_rec_headers crh
LEFT JOIN LEFT
JOIN JOIN (SELECT contract_num,receipt_amount,receipt_date
FROM FROM iscs_hsbm.moji_ads_monthly_record_initial
WHERE WHERE business_type_code = 'BT02-2'
AND AND period_num = '250303初始化'
GROUP BY GROUP BY contract_num,period_num) mri ON crh.contract_num = mri.contract_num
LEFT JOIN LEFT
JOIN JOIN iscs_hsbm.moji_invoice_associated mia ON mia.associated_number = crh.cust_rec_number
LEFT JOIN LEFT
JOIN JOIN iscs_hsbm.moji_invoice_req_headers irh ON mia.invoice_req_id = irh.invoice_req_id
LEFT JOIN LEFT
JOIN JOIN iscs_hsbm.hsbm_receipt_lines rl ON ((rl.source_match_num = irh.invoice_req_num
AND AND rl.receipt_line_type != 'CASH_DISCOUNT')
OR OR rl.rec_header_id = crh.rec_header_id)
AND AND rl.claim_flag = 'Y'
LEFT JOIN LEFT
JOIN JOIN iscs_hsbm.hsbm_receipt_headers rh ON rl.receipt_header_id = rh.receipt_header_id
WHERE WHERE crh.var_value1 IN ('BT02-2')
AND AND crh.var_value3 = '开票数据' --
AND AND (CASE
WHEN WHEN #{contractNum} is not null then crh.contract_num= #{contractNum} else 1=1 end)
GROUP BY GROUP BY crh.contract_num ) e
LEFT JOIN LEFT
JOIN JOIN iscs_hsbm.hsbm_payment_lines pl ON pl.contract = e.contract_num
LEFT JOIN LEFT
JOIN JOIN iscs_hsbm.hsbm_payment_headers ph ON pl.payment_header_id = ph.payment_header_id
AND AND ph.document_status = 'SUCCESS'
LEFT JOIN LEFT
JOIN JOIN iscs_hsbm.hsbm_payment_lines pl2 ON pl2.payment_header_id = ph.payment_header_id
AND AND pl2.payment_line_id = pl.payment_line_id
GROUP BY GROUP BY e.contract_num ) b ON crh.contract_num = b.contract_num
LEFT JOIN LEFT
JOIN JOIN (
SELECT SELECT mri.contract_num,mri.place_pos,SUM(mri.interval_cont_amt),SUM(mri.exposure),SUM(mri.cost_incl_tax)+SUM(mri.res_cost_incl_tax), IF(mri.place_pos='15日预报上方Banner',49.3,IF(mri.place_pos='穿衣助手三件套',3.7,IF(mri.place_pos='首页天气背景（彩蛋）',10.3,IF(mri.place_pos='天气首页中部',49.3,1)))) UA, ROUND(((SUM(mri.interval_cont_amt)-ROUND(SUM(mri.interval_cont_amt)*mri.big_value1,4)-ROUND(SUM(mri.interval_cont_amt)*mri.cash_disc_rate/100,4)-SUM(mri.cost_incl_tax)-SUM(mri.res_cost_incl_tax))/1.06/SUM(mri.exposure)*1000),4) eCPM
FROM FROM iscs_hsbm.hsar_cust_rec_headers crh
JOIN JOIN iscs_hsbm.moji_ads_monthly_record_initial mri ON crh.contract_num = mri.contract_num
AND AND crh.var_value2 = mri.period_num
GROUP BY GROUP BY mri.contract_num,mri.place_pos ) c ON crh.contract_num = c.contract_num
AND AND mri.place_pos = c.place_pos
JOIN JOIN hscs_hspm.hspm_rule rule ON rule.rule_code = 'ADS_SALES_SOURCE_RULE'
LEFT JOIN LEFT
JOIN JOIN hscs_hspm.hspm_rule_data ruled ON rule.id = ruled.rule_id
AND AND ruled.value1= mri.place_pos
AND AND (c.eCPM / c.UA)>=IF(mri.belong_group IN ('阿里巴巴集团','京东集团'),ruled.value5,ruled.value2)
AND AND (c.eCPM / c.UA) < IF(mri.belong_group IN ('阿里巴巴集团','京东集团'),ruled.value6,ruled.value3)
LEFT JOIN LEFT
JOIN JOIN (
SELECT SELECT rl.receipt_line_id,crh.contract_num AS contract,rl.receipt_amount AS amount,crh.big_value1 AS contract_amount,ROUND(rl.receipt_amount/crh.big_value1,4)+IFNULL(mri.cash_disc_rate,0) AS rate,rh.receipt_date
FROM FROM iscs_hsbm.hsbm_receipt_lines rl
JOIN JOIN iscs_hsbm.hsbm_receipt_headers rh ON rl.receipt_header_id = rh.receipt_header_id
JOIN JOIN iscs_hsbm.hsar_cust_rec_headers crh ON crh.contract_num = rl.contract
AND AND crh.var_value3= '开票数据'
LEFT JOIN LEFT
JOIN JOIN (SELECT DISTINCT contract_num,period_num,cash_disc_rate
FROM FROM iscs_hsbm.moji_ads_monthly_record_initial
WHERE WHERE period_num LIKE '%初%') mri ON mri.contract_num = crh.contract_num
WHERE WHERE rl.receipt_line_type = 'CASH_DISCOUNT'
AND AND rl.claim_flag = 'Y' ) d ON crh.contract_num = d.contract
WHERE WHERE crh.var_value1 IN ('BT02-2')
AND AND crh.var_value3 = '开票数据'
AND AND mri.cancel_flag = 'N' --
AND AND (CASE
WHEN WHEN #{contractNum} is not null then crh.contract_num= #{contractNum} else 1=1 end) --
AND AND mri.contract_num = 'AD202500013'
ORDER BY ORDER BY crh.contract_num
```

- 记录 4
  - 序号: 4
  - 系统表名: api获取销售易表 机会表：opportunity 合同表：contract 签单表：tob_order_signing_sheet
  - 溯源SQL:

```sql
tob-机会表
SELECT SELECT id,entityType,ownerId,opportunityName,accountId,priceId,opportunityType,money,saleStageId,lostStageId,winRate,reason,reasonDesc,closeDate,commitmentFlg,sourceId,projectBudget,actualCost,product,stageUpdatedAt,recentActivityRecordTime,createdAt,createdBy,updatedAt,updatedBy,COMMENT,dimDepart,t erritoryId,lockStatus,campaignId,approvalStatus,STATUS,leadId,opportunityScore,fcastMoney,forecastCategory,duplicateFlg,winReason,winReasonDesc,applicantId,customItem161__c,customItem162__c,customItem164__c,customItem166__c,customItem165__c,customItem167__c,customItem168__c,customItem169__c,customItem170__c,customItem171__c,customItem172__c,customItem173__c,customItem174__c,customItem175__c,customItem176__c,customItem177__c,customItem178__c,customItem179__c,customItem180__c,customItem181__c,customItem182__c,customItem183__c,customItem184__c,customItem185__c,customItem186__c,customItem187__c,customItem188 __c,customItem189__c,customItem190__c,customItem191__c,customItem192__c,customItem193__c,customItem194__c,customItem195__c,customItem196__c,customItem197__c,customItem198__c,customItem199__c,customItem200__c,customItem201__c,customItem202__c,customItem203__c,customItem204__c,customItem205__c,customIte m206__c,customItem207__c
FROM FROM opportunity
ORDER BY ORDER BY ownerId tob-合同表
SELECT SELECT id,entityType,title,accountId,opportunityId,campaignId,amount,STATUS,approvalStatus,payMode,startDate,invoicedAmount,orderAmount,endDate,paymentAmount,invoiceAmountFromInvoice,paymentAmountFromInvoice,invoicedPercentage,paymentPercentage,receiptAmountFromInvoice,invoiceAmount,paymentAmoun tPlanned,invoiceAmountFromOrder,payBack,paymentAmountFromOrder,notPayment,receiptAmountFromOrder,paymentStatus,overdueStatus,paymentPercent,contractContent,contractCode,ownerId,signerId,signDate,territoryId,COMMENT,createdAt,createdBy,applicantId,updatedAt,updatedBy,dimDepart,lockStatus,paymentBalance,invoiceBalanc e,amountUnbilled,receiptAmount,receiptBalance,customItem155__c,customItem158__c,customItem159__c,customItem160__c,customItem161__c,customItem162__c,customItem163__c,customItem164__c,customItem165__c,customItem166__c,customItem167__c,customItem168__c,customItem169__c,customItem170__c,customItem171__c,customItem172__c,customItem173__c,customItem175__c,customItem174__c,customItem176__c,customItem177__c,customItem178__c,customItem180__c,customItem181__c,customItem182__c,customItem183__c,customItem184__c,customItem185__c,customItem186__c,customItem187__c,customItem188__c,customItem189__c,customItem190_ _c,customItem191__c,customItem193__c,customItem192__c,customItem194__c,customItem195__c,customItem196__c,customItem197__c,customItem198__c,customItem199__c,customItem200__c,customItem201__c,customItem202__c,customItem203__c,customItem204__c
FROM FROM contract
ORDER BY ORDER BY ownerId tob-签单表
SELECT SELECT id,contract_num,start_date,end_date,party_site_number,receipt_dept,industry,sub_industry,salesperson,abbreviation,sources_of_leads,customer_categories,service_type,service_content,sign_date,rec_amount,rec_amount_exc_tax,amortization_month,receivable_ending_balance,invoice_amounted,invoiced_revenue,invoiced_tax_amount,uninvoiced_amount,amount_received_previous,amount_received_last_year,amount_received_ytd,uncollected_amount,total_revenue_difference,total_revenue_amount,revenue_previous_year,this_year_jan_amount,this_year_feb_amount,this_year_mar_amount,this_year_apr_amount,this_year_may_amount,this_year_jun_amount,this_year_jul_amount,this_year_aug_amount,this_year_sep_amount,this_year_oct_amount,this_year_nov_amount,this_year_dec_amount,next_year_jan_amount,next_year_feb_amount,next_year_mar_amount,next_year_apr_amount,next_year_may_amount,next_year_jun_amount,next_year_jul_amount,next_year_aug_amount,next_year_sep_amount,next_year_oct_amount,next_year_nov_amount,next_year_dec_amount,the_year_after_next_jan_amount,the_year_after_next_feb_amount,the_year_after_next_mar_amount,the_year_after_next_apr_amount,the_year_after_next_may_amount,the_year_after_next_jun_amount,the_year_after_next_jul_amount,the_year_after_next_aug_amount,the_year_after_next_sep_amount,the_year_after_next_oct_amount,the_year_after_next_nov_amount,the_year_after_next_dec_amount,tenant_id,created_by,last_updated_by,creation_date,last_update_date,object_version_number,invoice_date,substr(STR_TO_DATE(CONCAT(report_month,'-01'),'%Y-%m-%d'),1,7) report_month,contract_ar_due_date,due_date,payment_date,days_past_due
FROM FROM `iscs_irpt`.`tob_order_signing_sheet`
WHERE WHERE tenant_id='10020'
```


#### 1.4来源环境对比数据

友盟单价

[图片占位：1 张，原 DOCX 内嵌图片未 OCR]


#### 1.5 FineDataLink数仓

1、ODM贴源层

<!-- table-3 -->
| 表名 | 描述 | 备注 |
| --- | --- | --- |
| odm_overall_new_retention_a_d | 国内总留存 |  |
| odm_umeng_unit_price_a_d | 友盟单价 |  |
| odm_ad_payment_collection_a_d | 广告开票回款情况 |  |
| idm_crm_custom_entity_a_d | 销售机会数据表 |  |
| idm_crm_custom_module_a_d | 子销售机会模块 |  |
| odm_tob_opportunity_a_d | tob销售机会 |  |
| odm_tob_contract_a_d | tob销售机会 |  |
| odm_tob_order_signing_sheet | TOB签单表 |  |

数据同步过程详见FineDataLink的【odm首页指标】任务。

2、IDM明细层/SDM汇总层

<!-- table-4 -->
| 表名 | 描述 | 备注 |
| --- | --- | --- |
| idm_overall_new_retention_a_d | 新增留存 |  |
| idm_umeng_unit_price_a_d | 友盟单价-日 |  |
| idm_umeng_unit_price_a_m | 友盟单价-月 |  |
| idm_clv_indicator_a_d | clv相关指标-日 |  |
| idm_clv_indicator_a_m | clv相关指标-月 |  |
| idm_tob_funnel_a_d | tob漏斗图数据 |  |
| sdm_overall_new_retention_a_d | 新增次留-日 |  |
| sdm_overall_new_retention_a_m | 新增次留-月 |  |
| sdm_umeng_unit_price_a_d | 友盟单价-日 |  |
| sdm_umeng_unit_price_a_m | 友盟单价-月 |  |
| sdm_clv_indicator_a_d | clv相关指标-日 |  |
| sdm_clv_indicator_a_m | clv相关指标-月 |  |
| sdm_cash_flow_a_d | 现金流-日 |  |
| sdm_cash_flow_a_m | 现金流-月 |  |
| sdm_platform_rate_a_d | 各端活跃次留 |  |
| sdm_platform_rate_a_m | 各端活跃次留日均 |  |
| sdm_platform_ave_rate_a_m | 各端活跃次留日均 |  |

数据同步过程详见FineDataLink的【idm首页指标】、【sdm首页指标】任务。

3、APP应用层

<!-- table-5 -->
| 表名 | 描述 | 备注 |
| --- | --- | --- |
| app_manage_the_cockpit_indicator_a_d | 首页-日维度 |  |
| app_manage_the_cockpit_indicator_a_m | 首页-月维度 |  |
| app_crm_custom_entity_a_d | 首页-广告漏斗 |  |
| app_penetration_rate_a_d | 外部指标月 |  |
| app_user_share_a_d | 外部指标周 |  |
| app_user_share_a_m | 外部指标周均 |  |
| app_inter_member_home_a_d | 业务首页国际化日维度 |  |
| app_inter_member_home_a_m | 业务首页国际化月维度 |  |
| app_tob_funnel_a_d | tob漏斗图数据 |  |
| app_tob_revenuetop_a_d | 营收词云图 |  |
| app_tob_revenuetype_a_d | 营收达成：服务类型及行业类型 |  |
| app_md_baidu_day_a_d | 百度指数-日 |  |
| app_md_baidu_day_a_m | 百度指数-月 |  |
| app_overall_new_retention_a_d | 国内-新增留存-日 |  |
| app_overall_new_retention_a_m | 国内-新增留存-月 |  |

数据同步过程详见FineDataLink的【app首页指标】任务。

4、填报数据存储库表

<!-- table-6 -->
| 数据名称 | 填报模版名称 | 数仓库表 | 备注 |
| --- | --- | --- | --- |
| 日均活跃渗透率 | 营收、安装、活跃(月) | sdm_penetration_rate_a_d |  |
| 日均安装渗透率 | 营收、安装、活跃(月) | sdm_penetration_rate_a_d |  |
| FW国际综合排名 | FW国际综合排名(月) | sdm_penetration_rate_a_d |  |
| 广告营收占比 | 营收、安装、活跃(月) | sdm_penetration_rate_a_d |  |
| 新增用户占比 | 新增用户占比(周) | sdm_user_share_a_d |  |
| 广告同类赛道媒体机会 | LTC-市场大盘预算 | odm_arket_overall_budget_a_d |  |
| 广告同类赛道媒体目标市场 | LTC-市场大盘预算 | odm_arket_overall_budget_a_d |  |
| 广告同类赛道媒体目标客户 | LTC-市场大盘预算 | odm_arket_overall_budget_a_d |  |
| tob市场需求 | TOB-市场需求目标填报 | odm_tob_order_goal_a_d |  |

5、数据更新时点及可查看的业务数据日期

数据更新结束时间：T+1上午十点可查看除CLV、营业收入、净利润T+2的完整数据，T+1晚上九点可查看除CLVT+1的完整数据，CLV更新时间为T+3。


#### 1.6 数据验证结论

友盟单价

[图片占位：1 张，原 DOCX 内嵌图片未 OCR]


### 2.净现金流

[图片占位：1 张，原 DOCX 内嵌图片未 OCR]


#### 2.1指标清单

<!-- table-7 -->
| 指标名称 | 统计维度 | 统计频率 | 数据来源方式 | 来源系统 | 系统表名 |
| --- | --- | --- | --- | --- | --- |
| 净现金流 |  | 日/月 | 系统取数 | 见知 | 现金流水详情表 （银行流水明细） |
| 现金流入 | 收付款分类 | 日/月 | 系统取数 | 见知 | 现金流水详情表 （银行流水明细） |
| 现金流出 | 收付款分类 | 日/月 | 系统取数 | 见知 | 现金流水详情表 （银行流水明细） |
| TOP10现金流入排行 |  | 日/月 | 系统取数 | 见知 | 现金流水详情表 （银行流水明细） |
| TOP10现金流出排行 |  | 日/月 | 系统取数 | 见知 | 现金流水详情表 （银行流水明细） |
| 资产类现金合计 |  | 日/月 | 系统取数 | 见知 |  |
| 资产-应收汇票 |  | 日/月 | 手工统计 | 见知 | 无 |
| 资产-可用资金 |  | 日/月 | 系统取数 | 见知 | 银行账户余额表 |
| 资产-投资理财 |  | 日/月 | 系统取数 | 见知 | 资金台账-投资理财 |
| 账户理财余额 |  | 日/月 | 系统取数 | 见知 | 资金台账-投资理财 |
| 负债类现金合计 |  | 日/月 | 系统取数 | 见知 | 资金台账-融资贷款 |
| 负债-融资贷款 | 金融机构 | 日/月 | 系统取数 | 见知 | 资金台账-融资贷款 |
| 账户活期存款余额 |  | 日/月 | 系统取数 | 见知 | 银行账户余额表 |
| 账户到期理财 |  | 日/月 | 系统取数 | 见知 | 资金台账-投资理财 |
| 账户到期借款 |  | 日/月 | 系统取数 | 见知 | 资金台账-融资贷款 |


#### 2.2指标口径/计算规则

1、净现金流=现金流入-现金流出

以现金流水详情中收付款分类映射表的看板项目归集数据

2、资产类现金合计=应收汇票+可用资金+投资理财

应收汇票：查询时间大于等于票据接收日期、小于票据到期日的票据金额

可用资金：查询时间的银行账户余额

投资理财：查询时间大于等于理财开始时间、小于理财结束时间的理财金额

3、负债合计：查询时间大于等于负债开始时间、小于负债结束时间的金融机构负债金额合计


#### 2.3数据溯源

1、数据源

【数据中台】mysql-bfp_read-iscs_irpt-iscs_hsbm-172.16.23.101

2、数据源SQL逻辑

<!-- table-8 -->
| 序号 | 系统表名 | 溯源SQL |
| --- | --- | --- |
| 1 | 现金流水详情表（银行流水明细） | select transaction_date,-- 交易时间 currency_code ,-- 币种代码, accounting_date,-- 入账日期, payment_amount,-- 付款金额, receipt_amount,-- 收款金额, account_balance,-- 账户余额, cust_bank,-- 对方银行, cust_account_number,-- 对方账号, cust_account_name,-- 对方账户名, business_type,-- 业务类型, business_uses,-- 用途, description ,-- 摘要, postscript ,-- 附言, attribute_category ,-- 收付款分类, attribute1, attribute2, attribute3, attribute4, customer_category_name -- 对方类型 from iscs_hsbm.hsca_flow_detail_info -- 资金流水详情表 where tenant_id='10020' -- 租户 and left(transaction_date,10)>='2023-01-01' |
| 2 | 资金台账-投资理财 | select leder_id,-- 表ID，主键 account_status ,-- 账户状态 currency, -- 币种 invest_name, -- 投资名称 invest_type, -- 付息类型 invest_amount, -- 投资金额 institution, -- 金融机构编码 invest_balance, -- 投资余额 start_date_id, -- 开始日期ID end_date_id, -- 结束日期ID tenant_id, -- 租户ID invest_code -- 投资编号 from iscs_hsbm.cusz_investment_finance_ledger where tenant_id = '10020' -- 租户 |
| 3 | 资金台账-融资贷款 | select leder_id, -- 表ID，主键 currency, -- 币种 enterprise_name, -- 所属企业 loan_type_name, -- 贷款类型 loan_amount, -- 贷款总额 institution_name,-- 金融机构 start_date_id, -- 贷款开始时间 end_date_id, -- 结束日期 status_desc, -- 状态 tenant_id -- 租户ID from iscs_hsbm.cusz_financing_loan_ledger |
| 4 | 汇率定义表 | select rate_date, -- 汇率日期 from_currency_code,-- 被兑换货币CODE to_currency_code, -- 兑换货币CODE rate ,-- 汇率 tenant_id -- 租户 from hscs_hspm.hspm_exchange_rate -- 汇率定义表 |
| 5 | 银行信息表 | select bank_id, -- 银行id bank_code, -- 银行编码 bank_name, -- 银行名称 tenant_id -- 租户id from hscs_hspm.hspm_bank where tenant_id = '10020' -- 租户 |
| 6 | 银行账户余额表 | select bank_id, -- 银行id company_code, -- 公司编码 account_name, -- 账户名称，公司名称 account_number, -- 账户编码 account_alias, -- 最新余额 currency_code, -- 币种 status_code, -- 状态 tenant_id -- 租户ID from hscs_hspm.hspm_bank_accounts -- 银行账户表 where tenant_id = '10020' -- 租户 |


#### 2.4来源环境对比数据

无内容，省略……


#### 2.5 FineDataLink数仓

1、ODM贴源层

<!-- table-9 -->
| 表名 | 描述 | 备注 |
| --- | --- | --- |
| odm_fin_exchange_rate | 汇率定义表 |  |
| odm_hspm_bank_a_d | 银行信息表 |  |
| odm_hspm_bank_accounts_i_d | 银行账户余额表 |  |
| odm_hsca_flow_detail_info_a_d | 资金流水详情表 | transaction_date>='2025-10-01' |
| odm_cusz_financing_loan_ledger_a_d | 资金台账-融资贷款 |  |
| odm_cusz_investment_finance_ledger_a_d | 资金台账-投资理财 |  |

数据获取逻辑详见数据溯源，ETL详见FineDataLink的【odm净现金流】任务。

2、IDM明细层/SDM汇总层

<!-- table-10 -->
| 表名 | 描述 | 备注 |
| --- | --- | --- |
| idm_fin_bank_accounts_a_d | 银行账户每日余额表-历史数据 |  |
| sdm_fin_flow_detail_info_a_d | 资金流水详情表 |  |
| sdm_fin_flow_detail_info_his | 资金流水详情表-历史数据230101-250930 | 初始化执行一次 |
| sdm_fin_bank_accounts_a_d | 银行账户余额表 |  |
| sdm_fin_bank_accounts_his | 银行账户余额表-历史数据230101-251031 | 初始化执行一次 |
| sdm_fin_financing_loan_ledger_a_d | 资金台账-融资贷款 |  |
| sdm_fin_investment_finance_ledger_a_d | 资金台账-投资理财 |  |

数据加工清洗过程详见FineDataLink的【sdm净现金流】任务。

支付宝、微信支付的银行账户余额数据存在T+1的场景，例如：6号的支付宝数据，见知系统在7日上午9点左右汇聚生成，结算中台7日9点后才能拉取完整数据；6号的微信数据，见知系统在7日下午14点左右汇聚生成，结算中台7日14点后才能拉取完整数据。

3、APP应用层

<!-- table-11 -->
| 表名 | 描述 | 备注 |
| --- | --- | --- |
| app_fin_flow_detail_info_a_d | 资金流水详情表 |  |
| app_fin_bank_accounts_a_d | 银行账户余额表 |  |
| app_fin_financing_loan_ledger_a_d | 资金台账-融资贷款 |  |
| app_fin_investment_finance_ledger_a_d | 资金台账-投资理财 |  |

数据同步过程详见FineDataLink的【app净现金流】任务。

4、填报数据存储库表

<!-- table-12 -->
| 数据名称 | 填报模版名称 | 数仓库表 | 备注 | 状态 |
| --- | --- | --- | --- | --- |
| 资金流水详情表历史数据 | 无 | odm_hsca_flow_detail_info_his | 历史数据230101-250930 | 静态数据 |
| 银行账户每日余额表历史数据 | 无 | idm_fin_bank_accounts_a_d | 历史数据230101-251031 | 静态数据 |
| 应收汇票 | 财务指标-净现金流-应收汇票填报 | odm_fin_notes_receivable | 手工录入 | 动态数据 |
| 现金流水收付款分类映射表 | 财务指标-净现金流-指标维护 | idm_fin_mapping | 手工更新 | 动态数据 |

资金流水详情表历史数据


```sql
-- finebi_dashboard.odm_hsca_flow_detail_info_his definition
CREATE TABLE `odm_hsca_flow_detail_info_his` (
```
`transaction_date` varchar(100) DEFAULT NULL COMMENT '交易时间',

`currency_code` varchar(80) DEFAULT NULL COMMENT '币种代码',

`accounting_date` varchar(100) DEFAULT NULL COMMENT '入账日期',

`payment_amount` decimal(20,2) DEFAULT NULL COMMENT '付款金额',

`receipt_amount` decimal(20,2) DEFAULT NULL COMMENT '收款金额',

`account_balance` decimal(20,2) DEFAULT NULL COMMENT '账户余额',

`cust_bank` varchar(80) DEFAULT NULL COMMENT '对方银行',

`cust_account_number` varchar(80) DEFAULT NULL COMMENT '对方账号',

`cust_account_name` varchar(150) DEFAULT NULL COMMENT '对方户名',

`business_type` varchar(30) DEFAULT NULL COMMENT '业务类型：R收入，P支出',

`business_uses` varchar(240) DEFAULT NULL COMMENT '用途',

`description` varchar(240) DEFAULT NULL COMMENT '摘要',

`postscript` varchar(240) DEFAULT NULL COMMENT '附言',

`attribute_category` varchar(30) DEFAULT NULL COMMENT '收款分类',

`attribute1` varchar(150) DEFAULT NULL COMMENT '系统ID',

`attribute2` varchar(150) DEFAULT NULL COMMENT '交易类型',

`attribute3` varchar(150) DEFAULT NULL COMMENT '本方银行名称',

`attribute4` varchar(150) DEFAULT NULL,

`customer_category_name` varchar(100) DEFAULT NULL COMMENT '对方类型'


```sql
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='资金流水详情表230101-250930';
```
银行账户每日余额表历史数据


```sql
-- finebi_dashboard.idm_fin_bank_accounts_a_d definition
CREATE TABLE `idm_fin_bank_accounts_a_d` (
```
`stat_date` date DEFAULT NULL COMMENT '日期',

`bank_name` varchar(100) DEFAULT NULL COMMENT '银行名称',

`company_code` varchar(100) DEFAULT NULL COMMENT '公司编码',

`account_name` varchar(150) DEFAULT NULL COMMENT '账户名称，公司名称',

`account_number` varchar(100) DEFAULT NULL COMMENT '账户编码',

`account_alias` varchar(150) DEFAULT NULL COMMENT '最新余额',

`currency_code` varchar(100) DEFAULT NULL COMMENT '币种',

`rate` varchar(100) DEFAULT NULL COMMENT '汇率'


```sql
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 ROW_FORMAT=DYNAMIC COMMENT='银行账户每日余额表-历史数据';
```
应收汇票


```sql
-- finebi_dashboard.odm_fin_notes_receivable definition
CREATE TABLE `odm_fin_notes_receivable` (
```
`start_time` date DEFAULT NULL COMMENT '票据接收日',

`end_time` date DEFAULT NULL COMMENT '票据到期日',

`drawer` varchar(100) DEFAULT NULL COMMENT '出票人',

`amout` double DEFAULT NULL COMMENT '票据金额'


```sql
) ENGINE=InnoDB DEFAULT CHARSET=utf8 COMMENT='应收汇票表';
```
现金流水收付款分类映射表


```sql
-- finebi_dashboard.idm_fin_mapping definition
CREATE TABLE `idm_fin_mapping` (
```
`projectclass` varchar(100) DEFAULT NULL COMMENT '现金流入流出大类',

`category_type` varchar(100) DEFAULT NULL COMMENT '收付款分类',

`category_name` varchar(150) DEFAULT NULL COMMENT '看板项目'


```sql
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='现金流水收付款分类映射表';
```
5、管驾调度任务配置

<!-- table-13 -->
| 【数据中台】库表 | 【数据中台】更新时间 |
| --- | --- |
| 资金流水详情表iscs_hsbm.hsca_flow_detail_info | 0:00，11:50 |
| 银行账户表hscs_hspm.hspm_bank_accounts | 0:00 |
| 投资理财iscs_hsbm.cusz_investment_finance_ledger | 2:00 |
| 融资贷款iscs_hsbm.cusz_financing_loan_ledger | 2:00 |
| 汇率定义表hscs_hspm.hspm_exchange_rate | 0:00 |

数据更新：每天3:00、12:30自动执行任务；


#### 2.6 数据验证结论

2025-09-30、2025-10-23数据核对一致。


```sql
select
*
, (ifnull( (select
```
sum(invest_balance) as invest_amount -- 投资金额


```sql
from app_fin_investment_finance_ledger_a_d
where start_date_id <= '2025-10-23' and end_date_id > '2025-10-23'),0)
```
+

ifnull((select

sum(account_alias*rate) as account_alias


```sql
from app_fin_bank_accounts_a_d
where left(stat_date,10) = '2025-10-23'),0)
```
+

ifnull((select

sum(amout) as invest_amount -- 投资金额


```sql
from odm_fin_notes_receivable
where start_time <= '2025-10-23' and end_time >= '2025-10-23'),0))/10000 as invest_amount_total -- 汇总值
from (
select
```
'投资理财' as invest_name


```sql
,sum(invest_balance)/10000 as invest_amount -- 投资金额
from app_fin_investment_finance_ledger_a_d
where start_date_id <= '2025-10-23' and end_date_id >= '2025-10-23'
union all
select
```
'可用资金' as invest_name


```sql
,sum(account_alias*rate)/10000 as account_alias
from app_fin_bank_accounts_a_d
where left(stat_date,10) = '2025-10-23'
union all
select
```
'应收汇票' as invest_name


```sql
,sum(amout)/10000 as invest_amount -- 投资金额
from odm_fin_notes_receivable
where start_time <= '2025-10-23' and end_time >= '2025-10-23'
) main
```
[图片占位：1 张，原 DOCX 内嵌图片未 OCR]

[图片占位：2 张，原 DOCX 内嵌图片未 OCR]

[图片占位：2 张，原 DOCX 内嵌图片未 OCR]

资金流水详情表2025-09-30数据一致


```sql
select
```
attribute_category_2


```sql
,postscript
,cust_account_name
,sum(payment_amount + receipt_amount) as amount
,currency_code
from app_fin_flow_detail_info_a_d
where stat_date = '2025-09-30' and attribute_category_1 = '现金流出'
group by attribute_category_2,postscript,cust_account_name,currency_code
order by amount desc
limit 10
```
[图片占位：2 张，原 DOCX 内嵌图片未 OCR]


### 3.营业收入

[图片占位：1 张，原 DOCX 内嵌图片未 OCR]

[图片占位：1 张，原 DOCX 内嵌图片未 OCR]


#### 3.1指标清单

<!-- table-14 -->
| 指标名称 | 统计频率 | 数据来源方式 | 来源系统 | 系统表名 |
| --- | --- | --- | --- | --- |
| 营业收入 | 日 | 系统计算 |  |  |
| 广告收入 | 日 | 系统计算 |  |  |
| 自营广告收入 | 日 | 系统计算 |  |  |
| 自营品牌收入 | 日 | 系统取数 | 数据中台 | 单用户roi品牌营收数据表 ad_single_user_roi_brand_income |
| 自营电商收入 | 日 | 系统取数 | 数据中台 | 单用户roi品牌营收数据表 ad_single_user_roi_brand_income |
| 自营效果收入 | 日 | 系统取数 | 广告后台 | 效果日报收入数据 ad_contract_daily_income |
| 外包广告收入 | 日 | 系统取数 |  | 效果日报收入数据 ad_contract_daily_income |
| 联盟收入 | 日 | 系统取数 |  | 效果日报收入数据 ad_contract_daily_income |
| DSP收入 | 日 | 系统取数 |  | 效果日报收入数据 ad_contract_daily_income |
| TOB收入 | 日 | 手工填报 | 管驾数仓 | 净利润日报app_fin_pl_detail_i_d |
| 会员收入 | 日 | 系统取数 | 管驾数仓 | 净利润日报app_fin_pl_detail_i_d |
| 国际化收入 | 日 | 系统取数 | 管驾数仓 | 净利润日报-国际化idm_fin_inter_a_d |
| 国际化广告收入 | 日 | 系统取数 |  | 净利润日报-国际化idm_fin_inter_a_d |
| 国际化会员收入 | 日 | 系统取数 |  | 净利润日报-国际化idm_fin_inter_a_d |
| 其他收入 | 日 | 系统取数 |  | 赋0值 |
| 营业收入 | 月 | 系统计算 |  |  |
| 广告收入 | 月 | 系统取数 | 财务tableua | 损益明细凭证数据bidm.viz_dm_hs_pl_voucher_dtl |
| 自营广告收入 | 月 | 系统取数 | 结算中台 | 损益明细凭证数据 |
| 自营品牌收入 | 月 | 系统取数 | 财务tableua | 损益明细凭证数据 |
| 自营电商收入 | 月 | 系统取数 | 财务tableua | 损益明细凭证数据 |
| 自营效果收入 | 月 | 系统取数 | 财务tableua | 损益明细凭证数据 |
| 外包广告收入 | 月 | 系统取数 | 财务tableua | 损益明细凭证数据 |
| 联盟收入 | 月 | 系统取数 |  | 效果广告月数据汇总iscs_hsbm.hsar_settle_orders、iscs_hsbm.hsar_settle_order_lines、hscs_hspm.hspm_party_merchant |
| DSP收入 | 月 | 系统取数 |  | 效果广告月数据汇总iscs_hsbm.hsar_settle_orders、iscs_hsbm.hsar_settle_order_lines、hscs_hspm.hspm_party_merchant |
| 小程序收入 | 月 | 系统取数 |  | 效果广告月数据汇总iscs_hsbm.hsar_settle_orders、iscs_hsbm.hsar_settle_order_lines、hscs_hspm.hspm_party_merchant |
| TOB收入 | 月 | 系统取数 |  | 损益明细凭证数据 |
| SAAS收入 | 月 | 系统取数 | 结算中台 | TOB签单表idm_tob_order_signing_sheet |
| DAAS收入 | 月 | 系统计算 | 财务tableua | 损益明细凭证数据 |
| 会员收入 | 月 | 系统取数 | 财务tableua | 损益明细凭证数据 |
| 国际化收入 | 月 | 系统取数 | 财务tableua | 损益明细凭证数据 |
| 国际化广告收入 | 月 | 系统取数 | 财务tableua | 损益明细凭证数据 |
| 国际化会员收入 | 月 | 系统取数 | 财务tableua | 损益明细凭证数据 |
| 其他收入 | 月 | 系统取数 | 财务tableua | 损益明细凭证数据 |
| 外包广告收入目标值 | 月 | 手工填报 |  |  |
| 自营品牌收入目标值 | 月 | 手工填报 |  |  |
| 自营电商收入目标值 | 月 | 手工填报 |  |  |
| 自营效果收入目标值 | 月 | 手工填报 |  |  |


#### 3.2指标口径/计算规则

1、日维度：营业收入与净利润数据口径一致，两页面项目对应关系见下表。

<!-- table-15 -->
| 序号 | 营业收入页面 | 净利润页面 |
| --- | --- | --- |
| 1 | 自营广告 | 品牌 |
| 2 | 外包广告 | 效果+效果极速版 |
| 3 | 会员 | 会员 |
| 4 | TOB | TOB |
| 5 | 国际化 | 国际化 |

营业收入=广告+TOB+会员+国际化+其他

广告收入=自营广告+外包广告

自营广告=自营品牌+自营电商+自营效果

2、月维度

营业收入=广告+TOB+会员+国际化+其他

DAAS收入= TOB收入-SAAS收入


#### 3.3数据溯源

1、数据源

【广告后台】mysql-ad-mojiro

【数据中台】mysql-bfp_read-iscs_irpt-iscs_hsbm-172.16.23.101


```sql
selectedDB
```
【数据中台】mysql-tblu-motblro1-r-mjtab-s.sql.mojiweather.com

财务tableau损益明细

2、数据源SQL逻辑

<!-- table-16 -->
**表格 16**

字段：序号 / 系统表名 / 溯源SQL

- 记录 1
  - 序号: 1
  - 系统表名: ad_single_user_roi_brand_income
  - 溯源SQL:

```sql
select *
from from ad_single_user_roi_brand_income
```

- 记录 2
  - 序号: 2
  - 系统表名: ad.ad_contract_daily_income
  - 溯源SQL:

```sql
SELECT from
from_unixtime(DATE,'%Y-%m-%d') AS datestr,project_name AS advertiser_name,CASE
WHEN WHEN platform='1' THEN 'ANDROID'
WHEN WHEN platform='2' THEN 'IOS'
WHEN WHEN platform='4' THEN 'IPAD' ELSE '其他' END platform,position,position_id,partner,IF (adverting_type='联盟'
OR OR project_name IN ('华为联盟','oppo联盟','游可赢','vivo联盟'),alliance_ad_show,ad_show) AS ad_show,IF (adverting_type='联盟'
OR OR project_name IN ('华为联盟','oppo联盟','游可赢','vivo联盟'),alliance_ad_click,ad_click) AS ad_click,daily_income,IF (adverting_type='联盟'
OR OR project_name IN ('华为联盟','oppo联盟','游可赢','vivo联盟'),alliance_ad_click,ad_click)/IF (adverting_type='联盟'
OR OR project_name IN ('华为联盟','oppo联盟','游可赢','vivo联盟'),alliance_ad_show,ad_show) AS ctr,round((daily_income)/IF (adverting_type='联盟'
OR OR project_name IN ('华为联盟','oppo联盟','游可赢','vivo联盟'),alliance_ad_show,ad_show)*1000,2) AS ecmp,adverting_type,IF (length(channel)> 0,channel,CASE
WHEN WHEN platform='1' THEN 'ANDROID'
WHEN WHEN platform='2' THEN 'IOS'
WHEN WHEN platform='4' THEN 'IPAD' ELSE '其他' END) AS channel,CASE
WHEN WHEN operator='1' THEN 'Moji'
WHEN WHEN operator='2' THEN 'TopOn' END operator,CAST(daily_income/1.06 AS DECIMAL (10,2)) AS price_after_tax,round(CAST(daily_income/1.06 AS DECIMAL (10,2))/IF (adverting_type='联盟'
OR OR project_name IN ('华为联盟','oppo联盟','游可赢','vivo联盟'),alliance_ad_show,ad_show)*1000,1) AS price_after_ecmp,rebate_ratio
FROM FROM ad.ad_contract_daily_income
WHERE WHERE
from from_unixtime(DATE,'%Y-%m-%d')>='2020-01-01'
ORDER BY ORDER BY datestr
```

- 记录 3
  - 序号: 3
  - 系统表名: iscs_hsbm.hsar_settle_orders iscs_hsbm.hsar_settle_order_lines
  - 溯源SQL:

```sql
SELECT DATE_FORMAT(h.accounting_date,'%Y-%m') AS stats_ym,-- 月份 h.var_value1,-- 类型 h.var_value2 AS var_ym,-- 调整对象月份 h.var_value4,-- 合作方 l.product_name,-- 投放类型 SUM(IF (h.var_value3='N',l.input_amount,0))+SUM(IF (h.var_value3='Y',l.input_amount,0)) amount,-- 本月收入 SUM(IF (h.var_value3='N',l.settle_amount,0)) settle_amount,-- 实结收入含税 SUM(IF (h.var_value3='N',l.input_amount,0)) input_amount,-- 实结收入不含税 SUM(IF (h.var_value3='N',l.tax_amount,0)) tax_amount-- 实结收税额
FROM FROM iscs_hsbm.hsar_settle_orders h
JOIN JOIN iscs_hsbm.hsar_settle_order_lines l ON h.settle_order_id=l.settle_order_id
LEFT JOIN LEFT
JOIN JOIN hscs_hspm.hspm_party_merchant m ON h.merchant_number=m.merchant_number
WHERE WHERE h.tenant_id='10020'-- 租户
AND AND h.business_type_code='BT02-1'
AND AND h.accounting_status !='UN'
AND AND h.document_status='APPROVED'
AND AND h.accounting_date>='2024-11-01'
AND AND l.product_name !='品牌RTB'--
AND AND DATE_FORMAT(h.accounting_date,'%Y-%m') = '2025-09'
GROUP BY GROUP BY DATE_FORMAT(h.accounting_date,'%Y-%m'),h.var_value1,h.var_value2,h.var_value4,l.product_name
```


#### 3.4来源环境对比数据

无内容，省略……


#### 3.5 FineDataLink数仓

1、ODM贴源层

<!-- table-17 -->
| 表名 | 描述 | 备注 |
| --- | --- | --- |
| odm_ad_single_user_roi_brand_income_a_d | 营业收入：【广告后台】mysql-mojicom-mojiro |  |
| odm_ad_advertising_revenue_a_d | 广告收入：【广告后台】- 效果日报收入数据 |  |
| odm_hsar_settle_orders_m | 结算中台-效果广告月数据汇总 |  |

数据同步过程详见FineDataLink的【odm营业&广告收入】任务。

2、IDM明细层/SDM汇总层

<!-- table-18 -->
| 表名 | 描述 | 备注 |
| --- | --- | --- |
| idm_ad_brand_commerce_a_d | 营业收入-自营品牌，自营电商 |  |
| idm_ad_price_after_tax_a_d | 营业收入-外包广告，联盟收入，dsp收入 |  |
| idm_ad_tob_income_a_d | 营业收入-TOB收入 |  |
| idm_ad_dome_member_transaction_a_d | 营业收入-国内会员 |  |
| idm_ad_inter_income_a_d | 营业收入-国际化收入，国际化广告,国际化会员 |  |
| sdm_ad_operating_revenue_a_d | 营业收入日数据 |  |
| sdm_ad_operating_revenue_a_m | 营业收入月数据 |  |

数据同步过程详见FineDataLink的【idm营业收入】、【sdm营业收入】任务。

3、APP应用层

<!-- table-19 -->
| 表名 | 描述 | 备注 |
| --- | --- | --- |
| app_ad_operating_revenue_a_d | 营业收入日维度带同环比 |  |
| app_ad_achievement_status_a_d | 日维度--月度营收达成情况 |  |
| app_ad_operating_revenue_a_m | 营业收入月维度带同环比 |  |
| app_ad_achievement_status_a_m | 月维度--月度营收达成情况 |  |

数据同步过程详见FineDataLink的【app营业收入】任务。

4、填报数据存储库表

<!-- table-20 -->
| 数据名称 | 填报模版名称 | 数仓库表 | 看板页面 | 备注 |
| --- | --- | --- | --- | --- |
| 营业收入目标值 | 财务指标-营业收入-目标值填报 | app_ad_target_revenue_a_m | 营业收入 | 数据始于24年11月 |

5、管驾调度任务配置

<!-- table-21 -->
| 【数据中台】库表 | 【数据中台】更新时间 |
| --- | --- |
| mojicom.ad_single_user_roi_brand_income | 08:00 |
| ad.ad_contract_daily_income | 一般10:00 |
| iscs_hsbm.hsar_settle_orders |  |
| iscs_hsbm.hsar_settle_order_lines |  |
| hscs_hspm.hspm_party_merchant |  |

营业收入日维度依赖于净利润日报填报的数据，月维度数据来源于财务的损益明细表（每日6:30更新）；

数据更新：每天8:30、20:30自动执行任务；


#### 3.6 数据验证结论

营业收入、净利润日维度数据一致

[图片占位：1 张，原 DOCX 内嵌图片未 OCR]

[图片占位：1 张，原 DOCX 内嵌图片未 OCR]

营业收入月维度数据一致

[图片占位：1 张，原 DOCX 内嵌图片未 OCR]

[图片占位：1 张，原 DOCX 内嵌图片未 OCR]


### 4.营业收入-广告

[图片占位：1 张，原 DOCX 内嵌图片未 OCR]


#### 4.1指标清单

<!-- table-22 -->
| 指标名称 | 统计频率 | 数据来源方式 | 来源系统 | 系统表名 |
| --- | --- | --- | --- | --- |
| 广告收入 | 日/月 | 系统取数 | 广告后台 |  |
| 广告DAU | 日/月 | 系统取数 |  |  |
| 广告ARPU | 日/月 | 系统取数 | 广告后台 | iscs_hsbm.hsar_settle_orders ad.ad_contract_daily_income |
| 广告总曝光量 | 日/月 | 系统取数 | 广告后台 | iscs_hsbm.hsar_settle_orders ad.ad_contract_daily_income |
| 总eCPM | 日/月 | 系统取数 | 广告后台 | iscs_hsbm.hsar_settle_orders ad.ad_contract_daily_income |
| 人均打开次数 | 日/月 | 系统取数 | 广告后台 | iscs_hsbm.hsar_settle_orders ad.ad_contract_daily_income |
| 开屏位置_库存总数（总打开次数） | 日/月 | 系统取数 | 广告后台/ SelectedDB | hive.rpt.rpt_splash_stock_data ods.ods_ad_positions mojicom.ad_advertiser_req_fill_data |
| 开屏位置_有效库存 | 日/月 | 系统取数 | 广告后台/ SelectedDB | hive.rpt.rpt_splash_stock_data ods.ods_ad_positions mojicom.ad_advertiser_req_fill_data |
| 开屏位置_填充率 | 日/月 | 系统取数 | 广告后台/ SelectedDB | hive.rpt.rpt_splash_stock_data ods.ods_ad_positions mojicom.ad_advertiser_req_fill_data |
| 开屏位置_曝光量 | 日/月 | 系统取数 | 广告后台/ SelectedDB | hive.rpt.rpt_splash_stock_data ods.ods_ad_positions mojicom.ad_advertiser_req_fill_data |
| 开屏位置_点击量 | 日/月 | 系统取数 | 广告后台/ SelectedDB | hive.rpt.rpt_splash_stock_data ods.ods_ad_positions mojicom.ad_advertiser_req_fill_data |
| 开屏位置_eCPM | 日/月 | 系统取数 | 广告后台/ SelectedDB | hive.rpt.rpt_splash_stock_data ods.ods_ad_positions mojicom.ad_advertiser_req_fill_data |
| 其他位置_库存总数 | 日/月 | 系统取数 | 广告后台/ SelectedDB | hive.rpt.rpt_splash_stock_data ods.ods_ad_positions mojicom.ad_advertiser_req_fill_data |
| 其他位置_有效库存 | 日/月 | 系统取数 | 广告后台/ SelectedDB | hive.rpt.rpt_splash_stock_data ods.ods_ad_positions mojicom.ad_advertiser_req_fill_data |
| 其他位置_填充率 | 日/月 | 系统取数 | 广告后台/ SelectedDB | hive.rpt.rpt_splash_stock_data ods.ods_ad_positions mojicom.ad_advertiser_req_fill_data |
| 其他位置_曝光量 | 日/月 | 系统取数 | 广告后台/ SelectedDB | hive.rpt.rpt_splash_stock_data ods.ods_ad_positions mojicom.ad_advertiser_req_fill_data |
| 其他位置_点击量 | 日/月 | 系统取数 | 广告后台/ SelectedDB | hive.rpt.rpt_splash_stock_data ods.ods_ad_positions mojicom.ad_advertiser_req_fill_data |
| 其他位置eCPM | 日/月 | 系统取数 | 广告后台/ SelectedDB | hive.rpt.rpt_splash_stock_data ods.ods_ad_positions mojicom.ad_advertiser_req_fill_data |


#### 4.2指标口径/计算规则

1、营业收入-广告页面的【广告收入】指标卡与营业收入页面的【广告】指标卡数据一致。

[图片占位：2 张，原 DOCX 内嵌图片未 OCR]

2、计算口径

广告arpu=广告收入÷DAU

总eCPM=广告收入÷曝光×1000


#### 4.3数据溯源

1、数据源

【广告后台】mysql-ad-mojiro

【数据中台】mysql-bfp_read-iscs_irpt-iscs_hsbm-172.16.23.101


```sql
SelectedDB
```
【数据中台】mysql-tblu-motblro1-r-mjtab-s.sql.mojiweather.com

2、数据源SQL逻辑

<!-- table-23 -->
**表格 23**

字段：序号 / 系统表名 / 溯源SQL

- 记录 1
  - 序号: 1
  - 系统表名: rpt.rpt_brand_year_data_day
  - 溯源SQL:

```sql
SELECT *
FROM FROM hive.rpt.rpt_brand_year_data_day
```

- 记录 2
  - 序号: 2
  - 系统表名: mojicom.ad_advertiser_req_fill_data mojicom.ad_feed_inventory_dat mojicom.adclick_adid_data
  - 溯源SQL:

```sql
SELECT a1.stat_date,a1.position_id,CASE
WHEN WHEN a1.platform='1' THEN 'Android'
WHEN WHEN a1.platform='2' THEN 'iPhone' END platform,a2.ad_pv,-- 库存总数 a2.effective_pv,-- 库存可售卖数 a1.pv pv,-- 请求量 a1.fill_pv,-- 广告主填充量 a3.revenue,a3.sw_pv,-- 曝光量 a3.ck_pv-- 点击量
FROM FROM (
SELECT SELECT stat_date,platform,position_id,sum(pv) AS pv,-- 请求量 sum(fill_pv) AS fill_pv-- 广告主填充量
FROM FROM mojicom.ad_advertiser_req_fill_data
WHERE WHERE (stat_type='adv'
OR OR ad_type=2
OR OR ad_type=3)--
and and position_id in ('1','1004','4021', '4022','310','306','4023')
GROUP BY GROUP BY stat_date,platform,position_id) a1
LEFT JOIN LEFT
JOIN JOIN (
SELECT SELECT stat_date,platform,position_id,sum(ad_pv) AS ad_pv,-- 库存总数 sum(effective_pv) AS effective_pv-- 库存可售卖数
FROM FROM mojicom.ad_feed_inventory_data--
where where position_id in ('1','1004','4021', '4022','310','306','4023')
GROUP BY GROUP BY stat_date,platform,position_id) a2 ON a1.stat_date=a2.stat_date
AND AND a1.platform=a2.platform
AND AND a1.position_id=a2.position_id
LEFT JOIN LEFT
JOIN JOIN (
SELECT SELECT stat_date,platform,position_id,sum(revenue) revenue,-- 收入 sum(sw_pv) AS sw_pv,-- 曝光量 sum(ck_pv) AS ck_pv-- 点击量
FROM FROM mojicom.adclick_adid_data--
where where position_id in ('1','1004','4021', '4022','310','306','4023')
GROUP BY GROUP BY stat_date,platform,position_id) a3 ON a1.stat_date=a3.stat_date
AND AND a1.platform=a3.platform
AND AND a1.position_id=a3.position_id
```

- 记录 3
  - 序号: 3
  - 系统表名: ods.ods_ad_positions
  - 溯源SQL:

```sql
SELECT *
FROM FROM hive.ods.ods_ad_positions
where where stat_date = date_sub(current_date(), 1)
AND AND position_id in ('1','1004','4021', '4022','310','306','4023')
```

- 记录 4
  - 序号: 4
  - 系统表名: rpt.rpt_splash_stock_data
  - 溯源SQL:

```sql
select stat_date, sum(ad_stock_pv) as ad_stock_pv
from from hive.rpt.rpt_splash_stock_data
GROUP by GROUP by stat_date
```

- 记录 5
  - 序号: 5
  - 系统表名: odm_umeng_all_threeends
  - 溯源SQL:

```sql
select date,
case case
when when platform = 'AndroidLite' then 'Android' else platform end platform, sum(start_num) as start_num, sum(act_num)as dau
from from umeng_all
where where platform in ('Android','iPhone','AndroidLite')
and and date>='2020-01-01'
group by group by date,case
when when platform = 'AndroidLite' then 'Android' else platform end
```


#### 4.4来源环境对比数据

无内容，省略……


#### 4.5 FineDataLink数仓

1、ODM贴源层

<!-- table-24 -->
| 表名 | 描述 | 备注 |
| --- | --- | --- |
| odm_ad_single_user_roi_brand_income_a_d | 营业收入：【广告后台】mysql-mojicom-mojiro |  |
| odm_ad_advertising_revenue_a_d | 广告收入：【广告后台】- 效果日报收入数据 |  |
| odm_ad_inter_funnel_a_d | 广告链路漏斗 |  |
| odm_ad_inter_a_d | 广告位id表 |  |
| odm_ad_pening_screen_a_d | 开屏位置实际库存 |  |
| odm_contract_high_export_moon_data_a_d | 合同高级列表-月：取电商品牌预预估值 |  |
| odm_umeng_all_threeends | 【友盟】战略三端打开次数和DAU（日报） |  |

数据同步过程详见FineDataLink的【odm营业&广告收入】任务。

2、IDM明细层/SDM汇总层

<!-- table-25 -->
| 表名 | 描述 | 备注 |
| --- | --- | --- |
| idm_ad_revenue_a_d | 广告收入指标卡日维度数据 | 广告收入（品牌、电商、效果、外包）、曝光、DAU、广告arpu、总eCPM、总打开次数、人均打开次数；app_md_dome_dau_a_d |
| idm_ad_lianlu_a_d | 取链路的库存和打开次数-日 |  |
| idm_ad_caiwu_a_d | 财务取曝光，点击，收入-日 |  |
| sdm_ad_revenue_a_d | 广告收入指标卡日维度数据 |  |
| sdm_ad_revenue_a_m | 广告收入指标卡月维度数据 |  |
| sdm_ad_d_revenue_a_d | 广告位指标 日维度数据 |  |
| sdm_ad_d_revenue_a_m | 广告位指标 月维度数据 |  |

数据同步过程详见FineDataLink的【idm广告收入】、【sdm广告收入】任务。

3、APP应用层

<!-- table-26 -->
| 表名 | 描述 | 备注 |
| --- | --- | --- |
| app_ad_revenue_a_d | 广告收入日指标 |  |
| app_ad_revenue_a_m | 广告收入月指标--日均 |  |
| app_ad_d_revenue_a_d | 广告位指标 日维度数据 |  |
| app_ad_d_revenue_a_m | 广告收入月指标--日均 |  |
| app_ad_impressions_a_d | 广告收入曝光量及部门打开arpu | ARPU=收入/总打开次数 |
| app_ad_impressions_a_m | 广告收入曝光量及部门打开arpu-月-日均 |  |
| app_ad_evenue_completion_a_d | 营收完成情况 |  |
| app_ad_achievement_status_a_d | 分团队营收达成情况 | 营业收入页面辅助分析用 |
| app_ad_achievement_status_a_m | 分团队营收达成情况 | 营业收入页面辅助分析用 |

数据同步过程详见FineDataLink的【app广告收入】任务。

4、数据更新：每天8:30、20:30自动执行任务；


#### 4.6 数据验证结论

收入类同营业收入数据验证；


### 5.营业收入-会员

[图片占位：1 张，原 DOCX 内嵌图片未 OCR]


#### 5.1指标清单

<!-- table-27 -->
| 指标名称 | 统计频率 | 数据来源方式 | 来源系统 | 系统表名 |
| --- | --- | --- | --- | --- |
| 会员流水 | 日/月 | 系统取数 | SelectDB | dw.dw_user_member_detail_a_d |
| 老会员流水 | 日/月 | 系统取数 | SelectDB | dw.dw_user_member_detail_a_d |
| 老会员流水_月卡 | 日/月 | 系统取数 | SelectDB | dw.dw_user_member_detail_a_d |
| 老会员流水_季卡 | 日/月 | 系统取数 | SelectDB | dw.dw_user_member_detail_a_d |
| 老会员流水_年卡 | 日/月 | 系统取数 | SelectDB | dw.dw_user_member_detail_a_d |
| 新会员流水 | 日/月 | 系统取数 | SelectDB | dw.dw_user_member_detail_a_d |
| 新会员流水_月卡 | 日/月 | 系统取数 | SelectDB | dw.dw_user_member_detail_a_d |
| 新会员流水_季卡 | 日/月 | 系统取数 | SelectDB | dw.dw_user_member_detail_a_d |
| 新会员流水_年卡 | 日/月 | 系统取数 | SelectDB | dw.dw_user_member_detail_a_d |
| 会员DAU | 日/月 | 系统取数 | SelectDB | da_moji.nyt_vip_entrance_funnel_1d dm.dm_user_member_type_i_d da_moji.nyt_vip_entrance_funnel_1d dw.dw_flow_app_pkg_1d_d ods.ods_hd_member_delivery_channel |
| 渠道入口曝光人数 | 日/月 | 系统取数 | SelectDB | da_moji.nyt_vip_entrance_funnel_1d dm.dm_user_member_type_i_d da_moji.nyt_vip_entrance_funnel_1d dw.dw_flow_app_pkg_1d_d ods.ods_hd_member_delivery_channel |
| 渠道入口转化率 | 日/月 | 系统取数 | SelectDB | da_moji.nyt_vip_entrance_funnel_1d dm.dm_user_member_type_i_d da_moji.nyt_vip_entrance_funnel_1d dw.dw_flow_app_pkg_1d_d ods.ods_hd_member_delivery_channel |
| 购买页面曝光人数 | 日/月 | 系统取数 | SelectDB | da_moji.nyt_vip_entrance_funnel_1d dm.dm_user_member_type_i_d da_moji.nyt_vip_entrance_funnel_1d dw.dw_flow_app_pkg_1d_d ods.ods_hd_member_delivery_channel |
| 购买页面转化率 | 日/月 | 系统取数 | SelectDB | da_moji.nyt_vip_entrance_funnel_1d dm.dm_user_member_type_i_d da_moji.nyt_vip_entrance_funnel_1d dw.dw_flow_app_pkg_1d_d ods.ods_hd_member_delivery_channel |
| 订单数 | 日/月 | 系统取数 | SelectDB | da_moji.nyt_vip_entrance_funnel_1d dm.dm_user_member_type_i_d da_moji.nyt_vip_entrance_funnel_1d dw.dw_flow_app_pkg_1d_d ods.ods_hd_member_delivery_channel |


#### 5.2指标口径/计算规则

在【会员指标明细】数据中以新老会员类型、会员卡种两个维度进行数据展示。新老会员类型包含新会员召回、新会员纯新归到新会员，其他类型都是老会员。


#### 5.3数据溯源

1、数据源


```sql
selectedDB
```
2、数据源SQL逻辑

<!-- table-28 -->
**表格 28**

字段：序号 / 系统表名 / 溯源SQL

- 记录 1
  - 序号: 1
  - 系统表名: 【会员分入口漏斗数据】 da_moji.nyt_vip_entrance_funnel_1d
  - 溯源SQL:

```sql
SELECT t1.*,IF (t1.VALUE='all','全部',t2.NAME) AS NAME,t2.info
FROM FROM (SELECT stat_date,platform,KEY,VALUE,pv_1d,uv_1d
FROM FROM da_moji.nyt_vip_entrance_funnel_1d
WHERE WHERE VALUE IS NOT NULL
AND AND stat_date>='2023-01-01'
AND AND VALUE NOT IN ('52','36','34','20','24','50','7','28')
AND AND KEY NOT IN ('payment_nums','buy_vip')
UNION ALL UNION ALL
SELECT SELECT stat_date,platform,'payment_nums' AS KEY,channel_id AS VALUE,sum(order_sale) AS pv_1d,sum(order_num) AS uv_1d
FROM FROM dm.dm_user_member_type_i_d
WHERE WHERE stat_date>='2023-01-01'
GROUP BY GROUP BY stat_date,platform,channel_id
UNION ALL UNION ALL
SELECT SELECT stat_date,platform,'payment_nums' AS KEY,'all' AS VALUE,sum(order_sale) AS pv_1d,sum(order_num) AS uv_1d
FROM FROM dm.dm_user_member_type_i_d
WHERE WHERE stat_date>='2023-01-01'
GROUP BY GROUP BY stat_date,platform
UNION ALL UNION ALL
SELECT SELECT t1.stat_date,t1.platform,t2.KEY,t1.VALUE,t2.pv_1d,t2.uv_1d
FROM FROM (SELECT stat_date,platform,VALUE
FROM FROM da_moji.nyt_vip_entrance_funnel_1d
WHERE WHERE VALUE NOT IN ('52','36','34','20','24','50','7','28')
AND AND stat_date>='2023-01-01'
AND AND KEY NOT IN ('payment_nums','buy_vip')
GROUP BY GROUP BY stat_date,platform,VALUE) t1
LEFT JOIN LEFT
JOIN JOIN (SELECT stat_date,IF (pkg='com.moji.mjweather','android','iphone') platform,'dau' KEY,app_start_cnt_1d_noback pv_1d,app_aty_user_cnt_1d_noback uv_1d
FROM FROM dw.dw_flow_app_pkg_1d_d
WHERE WHERE pkg IN ('com.moji.mjweather','com.moji.mojiweather')
AND AND stat_date>='2023-01-01') t2 ON t1.stat_date=t2.stat_date
AND AND t1.platform=t2.platform) AS t1
LEFT JOIN LEFT
JOIN JOIN (SELECT channel,NAME,info
FROM FROM ods.ods_hd_member_delivery_channel
WHERE WHERE channel NOT IN ('52','36','34','20','24','50','7','28')
GROUP BY GROUP BY channel,NAME,info) AS t2 ON t1.VALUE=t2.channel LIMIT 99999999
```

- 记录 2
  - 序号: 2
  - 系统表名: 会员指标明细数据 取最新的日期快照 select max(stat_date) from hive.dw.dw_user_member_detail_a_d
  - 溯源SQL:

```sql
SELECT case
case when
when platform = 'iPhone' then 'iPhone' else 'Android' end platform,
case case
when when vip_card_type in ('月卡', '季卡', '年卡') then vip_card_type end as vip_card_type,
case case
when when vip_is_new in ('新会员召回', '新会员纯新') then '新会员' else '老会员' end as vip_is_new, '会员流水' as vip, LEFT (create_time, 10) AS pay_time, -- 创建时间 COUNT(oid) AS oid, -- 订单编码 SUM(pay_amt) AS pay_amt -- 会员流水
FROM FROM hive.dw.dw_user_member_detail_a_d
where where vip_card_type in ('月卡', '季卡', '年卡')
and and order_status in ('有效订单', '退款订单')
and and stat_date = (
select select max(stat_date)
from from hive.dw.dw_user_member_detail_a_d ) -- 取最新的日期快照
GROUP BY GROUP BY platform, LEFT (create_time, 10), vip_card_type, vip_is_new
```


#### 5.4来源环境对比数据

无内容，略……


#### 5.5 FineDataLink数仓

1、ODM贴源层

<!-- table-29 -->
| 表名 | 描述 | 备注 |
| --- | --- | --- |
| odm_mb_detail_a_d | 国内会员指标卡-日维度 |  |
| odm_mb_detail_m_d | 国内会员指标卡-月维度 |  |
| odm_mb_ent_a_d | 会员分入口漏斗数据 |  |

数据同步过程详见FineDataLink的【odm国内会员流水】任务。

2、IDM明细层/SDM汇总层

<!-- table-30 -->
| 表名 | 描述 | 备注 |
| --- | --- | --- |
| idm_mb_detail_a_d | 国内会员指标卡-日维度 |  |
| idm_mb_detail_m_d | 国内会员指标卡-月维度 |  |
| sdm_mb_detail_a_d | 国内会员指标卡-日维度 |  |
| sdm_mb_entrance_a_d | 国内会员漏斗图-日维度 |  |
| sdm_mb_detail_m_d | 国内会员指标卡-月维度 |  |
| sdm_mb_entrance_m_d | 国内会员漏斗图-月维度 |  |

数据同步过程详见FineDataLink的【idm国内会员流水】、【sdm国内会员流水】任务。

3、APP应用层

<!-- table-31 -->
| 表名 | 描述 | 备注 |
| --- | --- | --- |
| app_mb_detail_a_d | 国内会员指标卡-日维度 |  |
| app_mb_entrance_a_d | 国内会员漏斗图-日维度 |  |
| app_mb_detail_m_d | 国内会员指标卡-月维度 |  |
| app_mb_entrance_m_d | 国内会员漏斗图-月维度 |  |

数据同步过程详见FineDataLink的【app国内会员流水】任务。

4、数据源更新时间

<!-- table-32 -->
| 使用底表 | 表用途 | 更新结束时间 |
| --- | --- | --- |
| dw.dw_user_member_detail_a_d | 国内会员明细数据 | 05:00 |
| da_moji.nyt_vip_entrance_funnel_1d | 国内会员漏斗数据 | 07:00 |
| dm.dm_user_member_type_i_d | 国内会员漏斗数据 | 08:00 |
| dw.dw_flow_app_pkg_1d_d | 国内会员漏斗数据 | 04:00 |
| ods.ods_hd_member_delivery_channel | 国内会员漏斗数据 | 03:00 |


#### 5.6 数据验证结论

[图片占位：2 张，原 DOCX 内嵌图片未 OCR]


### 6.营业收入-国际化广告

[图片占位：1 张，原 DOCX 内嵌图片未 OCR]


#### 6.1指标清单

<!-- table-33 -->
| 指标名称 | 统计维度 | 统计频率 | 数据来源方式 | 来源系统 | 系统表名 |
| --- | --- | --- | --- | --- | --- |
| 点击_漏斗 | 国际 | 日/月 | 系统取数 | 大数据中心 | 库存总数：sdm.sdm_ad_stock_1d_d 国际广告dau历史数据（2025-12-20之前）：sdm.sdm_ad_homepage_vst_i_d 国际广告dau数据（2025-12-20之后）：idm.idm_ad_homepage_vst_i_d idm.idm_user_register_a_d 国际化广告收入：odm.odm_ad_mediation_report_i_d |
| 库存总数 | 国际 | 日/月 | 系统取数 | 大数据中心 | 库存总数：sdm.sdm_ad_stock_1d_d 国际广告dau历史数据（2025-12-20之前）：sdm.sdm_ad_homepage_vst_i_d 国际广告dau数据（2025-12-20之后）：idm.idm_ad_homepage_vst_i_d idm.idm_user_register_a_d 国际化广告收入：odm.odm_ad_mediation_report_i_d |
| 填充率 | 国际 | 日/月 | 系统取数 | 大数据中心 | 库存总数：sdm.sdm_ad_stock_1d_d 国际广告dau历史数据（2025-12-20之前）：sdm.sdm_ad_homepage_vst_i_d 国际广告dau数据（2025-12-20之后）：idm.idm_ad_homepage_vst_i_d idm.idm_user_register_a_d 国际化广告收入：odm.odm_ad_mediation_report_i_d |
| 国际化总eCPM | 国际 | 日/月 | 系统取数 | 大数据中心 | 库存总数：sdm.sdm_ad_stock_1d_d 国际广告dau历史数据（2025-12-20之前）：sdm.sdm_ad_homepage_vst_i_d 国际广告dau数据（2025-12-20之后）：idm.idm_ad_homepage_vst_i_d idm.idm_user_register_a_d 国际化广告收入：odm.odm_ad_mediation_report_i_d |
| 国际化广告总曝光量 | 国际 | 日/月 | 系统取数 | 大数据中心 | 库存总数：sdm.sdm_ad_stock_1d_d 国际广告dau历史数据（2025-12-20之前）：sdm.sdm_ad_homepage_vst_i_d 国际广告dau数据（2025-12-20之后）：idm.idm_ad_homepage_vst_i_d idm.idm_user_register_a_d 国际化广告收入：odm.odm_ad_mediation_report_i_d |
| 国际化广告ARPU | 国际 | 日/月 | 系统取数 | 大数据中心 | 库存总数：sdm.sdm_ad_stock_1d_d 国际广告dau历史数据（2025-12-20之前）：sdm.sdm_ad_homepage_vst_i_d 国际广告dau数据（2025-12-20之后）：idm.idm_ad_homepage_vst_i_d idm.idm_user_register_a_d 国际化广告收入：odm.odm_ad_mediation_report_i_d |
| 国际化广告DAU(剔除3天新用户) | 国际 | 日/月 | 系统取数 | 大数据中心 | 库存总数：sdm.sdm_ad_stock_1d_d 国际广告dau历史数据（2025-12-20之前）：sdm.sdm_ad_homepage_vst_i_d 国际广告dau数据（2025-12-20之后）：idm.idm_ad_homepage_vst_i_d idm.idm_user_register_a_d 国际化广告收入：odm.odm_ad_mediation_report_i_d |
| 国际化广告收入美元 | 国际 | 日/月 | 系统取数 | 大数据中心 | 库存总数：sdm.sdm_ad_stock_1d_d 国际广告dau历史数据（2025-12-20之前）：sdm.sdm_ad_homepage_vst_i_d 国际广告dau数据（2025-12-20之后）：idm.idm_ad_homepage_vst_i_d idm.idm_user_register_a_d 国际化广告收入：odm.odm_ad_mediation_report_i_d |


#### 6.2指标口径/计算规则

国际化广告收入：【第三方广告收入】的广告营收数据，日：当日的国际化广告收入汇总，月：当月的每日国际化广告收入汇总。

国际化广告DAU(剔除3天新用户)：国际广告场景中，排除注册时间≤3 天的新用户后，活跃的独立用户数，日：当日的活跃用户数，月：当月的活跃用户数汇总。

国际化广告ARPU：国际广告业务单用户平均收入，日：当日国际化广告收入/当日国际化广告DAU，月：当月的每日国家化广告收入汇总/当月的活跃用户数汇总。

国际化广告总曝光量：国际广告业务广告被展示的总次数，日：当日国际广告业务中所有广告的曝光次数总和，月：当月国际广告业务中所有广告的曝光次数汇总。

国际化总eCPM：千次展示有效收入，日：当日国际化广告收入/当日国际化广告总曝光量/1000，月：当月的每日国际化广告收入汇总/当月国际广告业务中所有广告的曝光次数汇总/1000。

库存总数：日：当日广告投放机会的潜在存量，月：当月广告投放机会的潜在存量。

填充率：通常指除核心 / 主要位置外，剩余辅助性位置的内容（如广告、资讯、推荐信息等）被成功填充的比例，是衡量资源利用效率的重要指标，日：（实际填充内容的位置数量_日÷可用于填充的“其他位置”总数量_日）× 100%，月：（实际填充内容的位置数量_月÷可用于填充的“其他位置”总数量_月）。

点击_漏斗：日：当日点击广告的次数，月：当月点击广告的次数汇总。


#### 6.3数据溯源

数据源

【数据中台】ireland-mrs-hive-172.16.18.253

数据源SQL逻辑

<!-- table-34 -->
| 序号 | 系统表名 | 溯源sql |
| --- | --- | --- |
| 1 | odm.odm_ad_mediation_report_i_d | select dt,-- 时间 platform,-- 平台 advertising_alliance_id,-- 广告联盟ID placement_id,-- 投放ID area,-- 地区 revenue ,-- 广告收入 ad_impressions,--广告展示次数 ad_clicks-- 广告点击次数 from odm.odm_ad_mediation_report_i_d where advertising_alliance_id in('topon','admob') |
| 2 | sdm.sdm_ad_stock_1d_d | select dt stat_date, platform, country, ad_position, uid_tail2, sum(total_pv) total_pv,-- 库存总数 sum(effective_pv) effective_pv-- 有效库存 from sdm.sdm_ad_stock_1d_d group by dt, platform, country, ad_position, uid_tail2 |
| 3 | sdm.sdm_ad_homepage_vst_i_d | select dt stat_date, platform, advertising_alliance, register_country, sum(ad_dau) ad_dau from sdm.sdm_ad_homepage_vst_i_d WHERE dt <= '2025-12-20' GROUP by dt, platform, register_country, advertising_alliance |
| 4 | idm.idm_ad_homepage_vst_i_d idm.idm_user_register_a_d | select a.dt stat_date, a.platform, if(b.country is null,'other',b.country) as country, substr(a.uid,-2) as uid_range, count(distinct a.uid) as uv FROM (select * FROM idm.idm_ad_homepage_vst_i_d where dt>='2025-02-01') a join (select uid,country from idm.idm_user_register_a_d where dt=date_format(date_sub(from_utc_timestamp(current_timestamp(), 'Asia/Shanghai'), 1),'yyyy-MM-dd') group by uid,country) b on a.uid=b.uid group by a.dt, a.platform, if(b.country is null,'other',b.country),substr(a.uid,-2) |


#### 6.4来源环境对比数据

[图片占位：1 张，原 DOCX 内嵌图片未 OCR]


#### 6.5 FineDataLink数仓

1、ODM贴源层

<!-- table-35 -->
| 表名 | 描述 | 备注 |
| --- | --- | --- |
| odm_ad_mediation_report_a_d | 国际化，第三方广告收入 |  |
| odm_ad_stock_a_d | 库存总数 |  |
| odm_ad_his_dau_a_d | 历史Dau数据 | 2025-12-20以前 |
| odm_ad_dau_a_d | Dau数据 | 2025-12-21以后 |

数据同步过程详见FineDataLink的【odm国际广告收入】任务。

2、IDM明细层/SDM汇总层

<!-- table-36 -->
| 表名 | 描述 | 备注 |
| --- | --- | --- |
| idm_ad_inter_ad_a_d | 广告营收 |  |
| idm_inter_ad_revenue_a_d | 广告营收 |  |
| idm_ad_dau_a_d | Dau数据 |  |
| idm_ad_stock_a_d | 库存数据 |  |
| sdm_ad_inter_ad_a_d | 广告营收-日 | 数据清洗 |
| sdm_ad_inter_ad_m_d | 广告营收-月 | 数据清洗 |

数据同步过程详见FineDataLink的【idm国际广告收入】、【sdm国际广告收入】任务。

3、APP应用层

<!-- table-37 -->
| 表名 | 描述 | 备注 |
| --- | --- | --- |
| app_ad_inter_ad_a_d | 广告营收-日 |  |
| app_ad_inter_ad_m_d | 广告营收-月 |  |

数据同步过程详见FineDataLink的【app国际广告收入】任务。

4、数据更新时点及可查看的业务数据日期

数据更新结束时间：T+1上午十点可查看T+2的完整数据，T+1晚上九点可查看T+1的完整数据。


#### 6.6 数据验证结论

[图片占位：1 张，原 DOCX 内嵌图片未 OCR]

[图片占位：1 张，原 DOCX 内嵌图片未 OCR]


### 7.营业收入-国际化会员

[图片占位：1 张，原 DOCX 内嵌图片未 OCR]


#### 7.1指标清单

<!-- table-38 -->
| 指标名称 | 统计维度 | 统计频率 | 数据来源方式 | 来源系统 | 系统表名 |
| --- | --- | --- | --- | --- | --- |
| 国际化会员订单数 | 国际 | 日/月 | 系统取数 | 大数据中心 | 国际化会员订单明细：member_order 卡种：member_price 是否新用户判断：idm_user_register_a_d 谷歌会员订单明细：stg_google_order_s_d 国家对照：dim_country_info 短时会员转化漏斗：odm_bury_i_min、dim_beta_uid_a 会员动态开屏转化：nyt_intapp_vip_funnel_onboarding_1d_d 国家简称对照：odm_inter_country_abbreviation 各国转化美元汇率：exchange_rates 国际dau分国家：sdm_app_act_1d_d |
| 国际化会员流水美元 | 国际 | 日/月 | 系统取数 | 大数据中心 | 国际化会员订单明细：member_order 卡种：member_price 是否新用户判断：idm_user_register_a_d 谷歌会员订单明细：stg_google_order_s_d 国家对照：dim_country_info 短时会员转化漏斗：odm_bury_i_min、dim_beta_uid_a 会员动态开屏转化：nyt_intapp_vip_funnel_onboarding_1d_d 国家简称对照：odm_inter_country_abbreviation 各国转化美元汇率：exchange_rates 国际dau分国家：sdm_app_act_1d_d |
| 国际化老会员流水 | 国际 | 日/月 | 系统取数 | 大数据中心 | 国际化会员订单明细：member_order 卡种：member_price 是否新用户判断：idm_user_register_a_d 谷歌会员订单明细：stg_google_order_s_d 国家对照：dim_country_info 短时会员转化漏斗：odm_bury_i_min、dim_beta_uid_a 会员动态开屏转化：nyt_intapp_vip_funnel_onboarding_1d_d 国家简称对照：odm_inter_country_abbreviation 各国转化美元汇率：exchange_rates 国际dau分国家：sdm_app_act_1d_d |
| 国际化老会员流水_月卡 | 国际 | 日/月 | 系统取数 | 大数据中心 | 国际化会员订单明细：member_order 卡种：member_price 是否新用户判断：idm_user_register_a_d 谷歌会员订单明细：stg_google_order_s_d 国家对照：dim_country_info 短时会员转化漏斗：odm_bury_i_min、dim_beta_uid_a 会员动态开屏转化：nyt_intapp_vip_funnel_onboarding_1d_d 国家简称对照：odm_inter_country_abbreviation 各国转化美元汇率：exchange_rates 国际dau分国家：sdm_app_act_1d_d |
| 国际化老会员流水_年卡 | 国际 | 日/月 | 系统取数 | 大数据中心 | 国际化会员订单明细：member_order 卡种：member_price 是否新用户判断：idm_user_register_a_d 谷歌会员订单明细：stg_google_order_s_d 国家对照：dim_country_info 短时会员转化漏斗：odm_bury_i_min、dim_beta_uid_a 会员动态开屏转化：nyt_intapp_vip_funnel_onboarding_1d_d 国家简称对照：odm_inter_country_abbreviation 各国转化美元汇率：exchange_rates 国际dau分国家：sdm_app_act_1d_d |
| 国际化老会员流水_其他卡(周卡) | 国际 | 日/月 | 系统取数 | 大数据中心 | 国际化会员订单明细：member_order 卡种：member_price 是否新用户判断：idm_user_register_a_d 谷歌会员订单明细：stg_google_order_s_d 国家对照：dim_country_info 短时会员转化漏斗：odm_bury_i_min、dim_beta_uid_a 会员动态开屏转化：nyt_intapp_vip_funnel_onboarding_1d_d 国家简称对照：odm_inter_country_abbreviation 各国转化美元汇率：exchange_rates 国际dau分国家：sdm_app_act_1d_d |
| 国际化新会员流水 | 国际 | 日/月 | 系统取数 | 大数据中心 | 国际化会员订单明细：member_order 卡种：member_price 是否新用户判断：idm_user_register_a_d 谷歌会员订单明细：stg_google_order_s_d 国家对照：dim_country_info 短时会员转化漏斗：odm_bury_i_min、dim_beta_uid_a 会员动态开屏转化：nyt_intapp_vip_funnel_onboarding_1d_d 国家简称对照：odm_inter_country_abbreviation 各国转化美元汇率：exchange_rates 国际dau分国家：sdm_app_act_1d_d |
| 国际化新会员流水_月卡 | 国际 | 日/月 | 系统取数 | 大数据中心 | 国际化会员订单明细：member_order 卡种：member_price 是否新用户判断：idm_user_register_a_d 谷歌会员订单明细：stg_google_order_s_d 国家对照：dim_country_info 短时会员转化漏斗：odm_bury_i_min、dim_beta_uid_a 会员动态开屏转化：nyt_intapp_vip_funnel_onboarding_1d_d 国家简称对照：odm_inter_country_abbreviation 各国转化美元汇率：exchange_rates 国际dau分国家：sdm_app_act_1d_d |
| 国际化新会员流水_年卡 | 国际 | 日/月 | 系统取数 | 大数据中心 | 国际化会员订单明细：member_order 卡种：member_price 是否新用户判断：idm_user_register_a_d 谷歌会员订单明细：stg_google_order_s_d 国家对照：dim_country_info 短时会员转化漏斗：odm_bury_i_min、dim_beta_uid_a 会员动态开屏转化：nyt_intapp_vip_funnel_onboarding_1d_d 国家简称对照：odm_inter_country_abbreviation 各国转化美元汇率：exchange_rates 国际dau分国家：sdm_app_act_1d_d |
| 国际化新会员流水_其他卡(周卡) | 国际 | 日/月 | 系统取数 | 大数据中心 | 国际化会员订单明细：member_order 卡种：member_price 是否新用户判断：idm_user_register_a_d 谷歌会员订单明细：stg_google_order_s_d 国家对照：dim_country_info 短时会员转化漏斗：odm_bury_i_min、dim_beta_uid_a 会员动态开屏转化：nyt_intapp_vip_funnel_onboarding_1d_d 国家简称对照：odm_inter_country_abbreviation 各国转化美元汇率：exchange_rates 国际dau分国家：sdm_app_act_1d_d |
| 国际化会员DAU | 国际 | 日/月 | 系统取数 | 大数据中心 | 国际化会员订单明细：member_order 卡种：member_price 是否新用户判断：idm_user_register_a_d 谷歌会员订单明细：stg_google_order_s_d 国家对照：dim_country_info 短时会员转化漏斗：odm_bury_i_min、dim_beta_uid_a 会员动态开屏转化：nyt_intapp_vip_funnel_onboarding_1d_d 国家简称对照：odm_inter_country_abbreviation 各国转化美元汇率：exchange_rates 国际dau分国家：sdm_app_act_1d_d |
| 国际化短时降雨曝光UV | 国际 | 日/月 | 系统取数 | 大数据中心 | 国际化会员订单明细：member_order 卡种：member_price 是否新用户判断：idm_user_register_a_d 谷歌会员订单明细：stg_google_order_s_d 国家对照：dim_country_info 短时会员转化漏斗：odm_bury_i_min、dim_beta_uid_a 会员动态开屏转化：nyt_intapp_vip_funnel_onboarding_1d_d 国家简称对照：odm_inter_country_abbreviation 各国转化美元汇率：exchange_rates 国际dau分国家：sdm_app_act_1d_d |
| 国际化支付弹窗曝光UV | 国际 | 日/月 | 系统取数 | 大数据中心 | 国际化会员订单明细：member_order 卡种：member_price 是否新用户判断：idm_user_register_a_d 谷歌会员订单明细：stg_google_order_s_d 国家对照：dim_country_info 短时会员转化漏斗：odm_bury_i_min、dim_beta_uid_a 会员动态开屏转化：nyt_intapp_vip_funnel_onboarding_1d_d 国家简称对照：odm_inter_country_abbreviation 各国转化美元汇率：exchange_rates 国际dau分国家：sdm_app_act_1d_d |
| 国际化弹框按钮点击UV | 国际 | 日/月 | 系统取数 | 大数据中心 | 国际化会员订单明细：member_order 卡种：member_price 是否新用户判断：idm_user_register_a_d 谷歌会员订单明细：stg_google_order_s_d 国家对照：dim_country_info 短时会员转化漏斗：odm_bury_i_min、dim_beta_uid_a 会员动态开屏转化：nyt_intapp_vip_funnel_onboarding_1d_d 国家简称对照：odm_inter_country_abbreviation 各国转化美元汇率：exchange_rates 国际dau分国家：sdm_app_act_1d_d |
| 国际化会员购买成功UV | 国际 | 日/月 | 系统取数 | 大数据中心 | 国际化会员订单明细：member_order 卡种：member_price 是否新用户判断：idm_user_register_a_d 谷歌会员订单明细：stg_google_order_s_d 国家对照：dim_country_info 短时会员转化漏斗：odm_bury_i_min、dim_beta_uid_a 会员动态开屏转化：nyt_intapp_vip_funnel_onboarding_1d_d 国家简称对照：odm_inter_country_abbreviation 各国转化美元汇率：exchange_rates 国际dau分国家：sdm_app_act_1d_d |
| 开屏引导功能介绍页1曝光人数-均值 | 国际 | 日/月 | 系统取数 | 大数据中心 | 国际化会员订单明细：member_order 卡种：member_price 是否新用户判断：idm_user_register_a_d 谷歌会员订单明细：stg_google_order_s_d 国家对照：dim_country_info 短时会员转化漏斗：odm_bury_i_min、dim_beta_uid_a 会员动态开屏转化：nyt_intapp_vip_funnel_onboarding_1d_d 国家简称对照：odm_inter_country_abbreviation 各国转化美元汇率：exchange_rates 国际dau分国家：sdm_app_act_1d_d |
| 开屏引导功能介绍页2曝光人数-均值 | 国际 | 日/月 | 系统取数 | 大数据中心 | 国际化会员订单明细：member_order 卡种：member_price 是否新用户判断：idm_user_register_a_d 谷歌会员订单明细：stg_google_order_s_d 国家对照：dim_country_info 短时会员转化漏斗：odm_bury_i_min、dim_beta_uid_a 会员动态开屏转化：nyt_intapp_vip_funnel_onboarding_1d_d 国家简称对照：odm_inter_country_abbreviation 各国转化美元汇率：exchange_rates 国际dau分国家：sdm_app_act_1d_d |
| 开屏引导会员促销页曝光人数-均值 | 国际 | 日/月 | 系统取数 | 大数据中心 | 国际化会员订单明细：member_order 卡种：member_price 是否新用户判断：idm_user_register_a_d 谷歌会员订单明细：stg_google_order_s_d 国家对照：dim_country_info 短时会员转化漏斗：odm_bury_i_min、dim_beta_uid_a 会员动态开屏转化：nyt_intapp_vip_funnel_onboarding_1d_d 国家简称对照：odm_inter_country_abbreviation 各国转化美元汇率：exchange_rates 国际dau分国家：sdm_app_act_1d_d |
| 开屏引导会员购买按钮点击人数-均值 | 国际 | 日/月 | 系统取数 | 大数据中心 | 国际化会员订单明细：member_order 卡种：member_price 是否新用户判断：idm_user_register_a_d 谷歌会员订单明细：stg_google_order_s_d 国家对照：dim_country_info 短时会员转化漏斗：odm_bury_i_min、dim_beta_uid_a 会员动态开屏转化：nyt_intapp_vip_funnel_onboarding_1d_d 国家简称对照：odm_inter_country_abbreviation 各国转化美元汇率：exchange_rates 国际dau分国家：sdm_app_act_1d_d |


#### 7.2指标口径/计算规则

国际化会员流水美元：通过其会员用户产生的所有资金交易总额，核心反映会员用户对业务的整体消费贡献能力，日：当日【国际化成功支付订单明细】的流水数据，月：当月【国际化成功支付订单明细】的流水数据汇总。

国际化会员订单数：当日购买会员的人数去重，日：去重统计当日购买会员的人数，月：去重统计当月购买会员的人数汇总。

国际化老会员流水：历史上有会员订单，且会员过期天数在 180 天及以内（即会员过期时间未超过 180 天）时，再次购买会员的用户所产生的流水（按日统计），日：当日统计老会员续费单流水，月：当月统计老会员续费单流水汇总。

国际化老会员流水_月卡：老会员卡种分类的月卡流水，日：当日统计老会员月卡流水，月：当月统计老会员月卡流水汇总。

国际化老会员流水_年卡：老会员卡种分类的年卡流水，日：当日统计老会员年卡流水，月：当月统计老会员年卡流水汇总。

国际化老会员流水_其他卡(周卡)：老会员卡种分类的其他卡流水，日： 当日老会员卡种分类的其他卡流水，月：当月老会员卡种分类的其他卡流水汇总。

国际化新会员流水：历史上没有订单的用户（首次成为会员），或者历史上有订单，但是在会员过期180之后（不含180）又购买会员的用户（过期180天后再次成为会员），日：当日统计新会员续费单流水，月：当月统计新会员续费单流水汇总。

国际化新会员流水_月卡：新会员卡种分类的月卡流水，日：当日统计新会员月卡流水，月：当月统计新会员月卡流水汇总。

国际化新会员流水_年卡：新会员卡种分类的年卡流水，日：当日统计新会员年卡流水，月：当月统计新会员年卡流水汇总。

国际化新会员流水_其他卡(周卡)：新会员卡种分类的其他卡流水，日： 当日新会员卡种分类的其他卡流水，月：当月新会员卡种分类的其他卡流水汇总。

国际化会员DAU：DAU不含后台刷新，日：当日国际市场内，计算会员的DAU，月：当月国际市场内，计算会员的DAU均值。

国际化短时降雨曝光UV：国际市场中，短时降雨相关内容被曝光的独立用户数（UV）,日：当日国际市场内，短时降雨相关内容的曝光独立用户总数，月：当月国际市场内，短时降雨相关内容的曝光独立用户总数汇总。

国际化支付弹窗曝光UV：国际市场中，支付弹窗被曝光的独立用户数（UV），日：当日国际市场内，支付弹窗的曝光独立用户总数，月：当月国际市场内，支付弹窗的曝光独立用户总数汇总。

国际化弹框按钮点击UV：国际市场中，弹框按钮被点击的独立用户数（UV），日：当日国际市场内，弹框按钮被点击的独立用户总数，月：当月国际市场内，弹框按钮被点击的独立用户总数汇总。

国际化会员购买成功UV：国际市场中，因短时降雨场景触发会员购买成功的独立用户数（UV），日：当日国际市场内，短时降雨场景下会员购买成功的独立用户总数，月：当月国际市场内，短时降雨场景下会员购买成功的独立用户总数汇总。

开屏引导功能介绍页1曝光人数-均值：统计周期内（按日取均值），用户触发开屏后，“功能介绍页 1” 向用户展示时的曝光覆盖人数，日：当日在开屏场景下，“功能介绍页 1” 被用户看到的人数，取统计周期内的日平均值，月：当月在开屏场景下，“功能介绍页 1” 被用户看到的人数，取统计周期内的日平均值。

开屏引导功能介绍页2曝光人数-均值：统计周期内（按日取均值），用户触发开屏后，“功能介绍页 2” 向用户展示时的曝光覆盖人数，日：当日在开屏场景下，“功能介绍页 2” 被用户看到的人数，取统计周期内的日平均值，月：当月在开屏场景下，“功能介绍页 2” 被用户看到的人数，取统计周期内的日平均值。

开屏引导会员促销页曝光人数-均值：统计周期内（按日取均值），用户触发开屏后，“会员促销页” 向用户展示时的曝光覆盖人数，日：当日在开屏场景下，“会员促销页” 被用户看到的人数，取统计周期内的日平均值，月：当月在开屏场景下，“会员促销页” 被用户看到的人数，取统计周期内的日平均值。

开屏引导会员购买按钮点击人数-均值：统计周期内（按日取均值），用户在开屏引导流程中，点击 “会员购买按钮” 的人数，日：当日在开屏场景下，用户点击 “会员购买按钮” 的人数，取统计周期内的日平均值，月：当月在开屏场景下，用户点击 “会员购买按钮” 的人数，取统计周期内的日平均值。


#### 7.3数据溯源

1、数据源

【国际化会员】-mysql-intl-mcs-bdro1-172.16.18.253

【数据中台】ireland-mrs-hive-172.16.18.253

数据源SQL逻辑

<!-- table-39 -->
**表格 39**

字段：序号 / 系统表名 / 溯源SQL

- 记录 1
  - 序号: 1
  - 系统表名: member_order
  - 溯源SQL:

```sql
select *,FROM_UNIXTIME(create_time/1000, '%Y-%m-%d %H:%i:%s') as create_time_new
from from member_order
where where is_sandbox<>'1'
```

- 记录 2
  - 序号: 2
  - 系统表名: member_price
  - 溯源SQL:

```sql
select * ,
case case
when when concat(cycle_type, '_', cycle_value) = '1_1' then '月卡'
when when concat(cycle_type, '_', cycle_value) = '1_3' then '季卡'
when when concat(cycle_type, '_', cycle_value) = '1_6' then '半年卡'
when when concat(cycle_type, '_', cycle_value) in ('1_12', '2_1', '2_2', '2_3') then '年卡' else '终身' end as cycle_type_new
from from member_price
```

- 记录 3
  - 序号: 3
  - 系统表名: idm_user_register_a_d
  - 溯源SQL:

```sql
select uid,country,reg_time
from from idm.idm_user_register_a_d
where where dt = date_format(date_sub(from_utc_timestamp(current_timestamp(), 'Asia/Shanghai'), 1),'yyyy-MM-dd')
```

- 记录 4
  - 序号: 4
  - 系统表名: stg_google_order_s_d
  - 溯源SQL:

```sql
select s1.buyer_address_buyer_country, s1.buyer_address_buyer_postcode, s1.create_time, s1.developer_revenue_in_buyer_currency, s1.last_event_time, s1.line_items, s1.order_details, s1.order_history, s1.order_id, s1.points_details, s1.purchase_token, s1.state, s1.tax_currency_code, s1.tax_nanos, s1.tax_units, s1.total_currency_code, s1.total_nanos, s1.total_units, s1.dt, s2.country_ab,
case case
when when s2.country_name_en = 'Taiwan' then 'TW'
when when s2.country_name_en = 'Hong Kong' then 'HK' else s2.country_name_en end country_name_en, s2.country_name_cn
from from stg.stg_google_order_s_d s1
left join left
join join (
select select country_ab,country_name_en,country_name_cn
from from dim.dim_country_info
group by group by country_ab,country_name_en,country_name_cn ) s2 on s1.buyer_address_buyer_country = s2.country_ab
where where s1.dt = date_sub(CURRENT_DATE, 1)
```

- 记录 5
  - 序号: 5
  - 系统表名: odm_bury_i_min
  - 溯源SQL:

```sql
select dt,if(b.uid is null,"正常订单","内部订单") as moji_tag ,if(lower(platform)='ios','iphone','android') as platform ,lower(os_region) as os_region ,count(distinct (case
when when key ='intapp_main_entry_from' then a.uid end)) as vip_dau ,count(distinct (case
when when key ='intapp_main_shorttime_map_sw' then a.uid end)) as vip_shorter_map_sw_uv ,count(distinct (case
when when key ='intapp_vip_48hr_subscription_page_sw'
and and value = '1'then a.uid end)) as vip_shorter_sub_sw_uv ,count(distinct (case
when when key ='intapp_vip_48hr_subscription_page_ck'
and and value = '1'then a.uid end)) as vip_shorter_sub_ck_uv ,count(distinct (case
when when key ='intapp_vip_subscription_purchase_success'
and and value in ( '98' ,'97' ,'96' ,'95' ,'1020','1022','1021','1023') then a.uid end)) as vip_buy_uv
from from (select *
from from odm.odm_bury_i_min
where where dt >='2025-03-10'
and and dt <=date_format(date_sub(from_utc_timestamp(current_timestamp(), 'Asia/Shanghai'), 1),'yyyy-MM-dd')
and and key in ('intapp_main_entry_from','intapp_main_homepage_sw','intapp_vip_48hr_subscription_page_sw','intapp_vip_48hr_subscription_page_ck' ,'intapp_vip_subscription_purchase_success','intapp_main_shorttime_map_sw')
and and ((pkg ='com.moweather.weather'
and and platform ='ios')
or or (pkg ='com.weather.mjweather'
and and platform ='android'))
and and pkg_status='release'
and and cast(uid as bigint)>0) a
left join left
join join (select DISTINCT uid
from from dim.dim_beta_uid_a) b on a.uid=b.uid
group by group by dt,if(lower(platform)='ios','iphone','android') ,lower(os_region),if(b.uid is null,"正常订单","内部订单")
```

- 记录 6
  - 序号: 6
  - 系统表名: nyt_intapp_vip_funnel_onboarding_1d_d
  - 溯源SQL:

```sql
Select *
from from hive.da_moji.nyt_intapp_vip_funnel_onboarding_1d_d
```

- 记录 7
  - 序号: 7
  - 系统表名: exchange_rates
  - 溯源SQL:

```sql
Select *
from from intl-msc.exchange_rates
```

- 记录 8
  - 序号: 8
  - 系统表名: sdm_app_act_1d_d
  - 溯源SQL:

```sql
select aa.*,t1.new_cnt_uv ,t4.dau,t2.cnt_pv
from from(
SELECT SELECT dt,platform ,if((rpt_name <>''
and and rpt_name is not null ),rpt_name,'other') as rpt_name
FROM FROM sdm.sdm_app_act_1d_d as a
where where rpt_key <>'total'
and and ((pkg ='com.moweather.weather'
and and platform ='iphone')
or or (pkg ='com.weather.mjweather'
and and platform ='android'))
group by group by dt,platform ,if((rpt_name <>''
and and rpt_name is not null ),rpt_name,'other') ) as aa
left join left
join join(
SELECT SELECT dt,platform ,if((rpt_name <>''
and and rpt_name is not null ),rpt_name,'other') as rpt_name ,cnt_uv as new_cnt_uv
FROM FROM sdm.sdm_app_act_1d_d as a
where where rpt_key <>'total'
and and ((pkg ='com.moweather.weather'
and and platform ='iphone')
or or (pkg ='com.weather.mjweather'
and and platform ='android'))
and and rpt_type ='register' ) as t1 on aa.dt = t1.dt
and and aa.platform = t1.platform
and and aa.rpt_name = t1.rpt_name
left join left
join join(
SELECT SELECT dt,platform ,if((rpt_name <>''
and and rpt_name is not null ),rpt_name,'other')as rpt_name ,cnt_uv as dau ,cnt_pv as cnt_pv
FROM FROM sdm.sdm_app_act_1d_d as a
where where rpt_key <>'total'
and and ((pkg ='com.moweather.weather'
and and platform ='iphone')
or or (pkg ='com.weather.mjweather'
and and platform ='android'))
and and rpt_type ='active' ) as t2 on aa.dt = t2.dt
and and aa.platform = t2.platform
and and aa.rpt_name = t2.rpt_name
left join left
join join(
SELECT SELECT dt,platform ,if((rpt_name <>''
and and rpt_name is not null ),rpt_name,'other')as rpt_name ,cnt_uv as dau ,cnt_pv as cnt_pv
FROM FROM sdm.sdm_app_act_1d_d as a
where where rpt_key <>'total'
and and ((pkg ='com.moweather.weather'
and and platform ='iphone')
or or (pkg ='com.weather.mjweather'
and and platform ='android'))
and and rpt_type ='active_homepage' ) as t3 on aa.dt = t3.dt
and and aa.platform = t3.platform
and and aa.rpt_name = t3.rpt_name
left join left
join join(
SELECT SELECT dt,platform ,if((rpt_name <>''
and and rpt_name is not null ),rpt_name,'other')as rpt_name ,cnt_uv as dau ,cnt_pv as cnt_pv
FROM FROM sdm.sdm_app_act_1d_d as a
where where rpt_key <>'total'
and and ((pkg ='com.moweather.weather'
and and platform ='iphone')
or or (pkg ='com.weather.mjweather'
and and platform ='android'))
and and rpt_type ='active_homepage_register_country' ) as t4 on aa.dt = t4.dt
and and aa.platform = t4.platform
and and aa.rpt_name = t4.rpt_name
```


#### 7.4来源环境对比数据

[图片占位：1 张，原 DOCX 内嵌图片未 OCR]


#### 7.5 FineDataLink数仓

1、ODM贴源层

<!-- table-40 -->
| 表名 | 描述 | 备注 |
| --- | --- | --- |
| odm_mb_inter_member_order | 【国际化会员订单明细】-member_order-抽取 |  |
| odm_mb_inter_member_price | 【国际化商品】-member_price-抽取 |  |
| odm_mb_user_register_a_d | 【国际化注册明细】-idm.idm_user_register_a_d-抽取 |  |
| odm_mb_stg_google_order_a_d | 【谷歌会员订单明细】-stg_google_order_s_d |  |
| odm_mb_bury_a_d | 短时会员转化漏斗、【国际化会员漏斗埋点uv-T+1】-odm.odm_bury_i_min |  |
| odm_mb_intapp_vip_funnel_onboarding_a_d | 会员动态开屏转化、【国际化会员开屏漏斗T+1】-da_moji.nyt_intapp_vip_funnel_onboarding_1d_d |  |
| odm_inter_country_abbreviation | 国家简称对应 | 初始化 |
| odm_mb_bury_hour_a_d | 国际化会员漏斗埋点uv-当日小时更新 |  |
| odm_mb_inter_member_exchange_rate | 会员币种汇率 |  |
| odm_mb_dollar_rate_a_d | 美元汇率表 |  |
| odm_mb_inter_dau_country_a_d | 国际dau分国家 |  |

数据同步过程详见FineDataLink的【odm国际会员流水】任务。

2、IDM明细层/SDM汇总层

<!-- table-41 -->
| 表名 | 描述 | 备注 |
| --- | --- | --- |
| idm_mb_inter_member_a_d | 国际会员流水指标块 |  |
| idm_mb_inter_shorter_funnel_a_d | 会员短时降雨转化漏斗 |  |
| idm_mb_inter_splash_funnel_a_d | 会员动态开屏转化漏斗 |  |
| sdm_mb_inter_member_day_a_d | 国际会员流水指标块 |  |
| sdm_mb_inter_shorter_funnel_a_d | 会员短时降雨转化漏斗 |  |
| sdm_mb_inter_splash_funnel_a_d | 会员动态开屏转化漏斗 |  |

数据同步过程详见FineDataLink的【idm国际会员流水】、【sdm国际会员流水】任务。

3、APP应用层

<!-- table-42 -->
| 表名 | 描述 | 备注 |
| --- | --- | --- |
| app_mb_inter_member_day_a_d | 国际化会员流水日 |  |
| app_mb_inter_member_month_a_d | 国际化会员流水月 |  |
| app_mb_inter_shorter_funnel_day_a_d | 国际会员短时降雨日漏斗图 |  |
| app_mb_inter_splash_funnel_day_a_d | 国际会员动态开屏转化日漏斗图 |  |

数据同步过程详见FineDataLink的【app国际会员流水】任务。

4、填报数据存储库表

<!-- table-43 -->
| 数据名称 | 填报模版名称 | 数仓库表 | 备注 | 状态 |
| --- | --- | --- | --- | --- |
| 国家简称对应 |  | odm_mb_inter_country_abbreviation | 初始化数据 | 静态数据 |
| 美元汇率表 |  | odm_mb_dollar_rate_a_d | 每日api获取 | 动态数据 |

5、数据更新时点及可查看的业务数据日期

数据更新结束时间：T+1上午十点可查看T+2的完整数据，T+1晚上九点可查看T+1的完整数据。


#### 7.6 数据验证结论

[图片占位：2 张，原 DOCX 内嵌图片未 OCR]


### 8.净利润

[图片占位：1 张，原 DOCX 内嵌图片未 OCR]


#### 8.1指标清单

<!-- table-44 -->
| 指标名称 | 统计频率 | 数据来源方式 | 来源系统 | 系统表名 |
| --- | --- | --- | --- | --- |
| 净利润 | 日/月 | 手工填报 |  |  |
| 营业收入 | 日/月 | 手工填报 |  |  |
| 品牌收入 | 日/月 | 系统取数 | 广告后台 | 日收入数据详情表/单用户roi品牌营收数据表 |
| 效果收入 | 日/月 | 系统取数 | 广告后台 | 日收入数据详情表 |
| 效果极速版收入 | 日/月 | 系统取数 | 广告后台 | 日收入数据详情表 |
| 会员收入 | 日/月 | 系统取数 | 数据中台 | 会员日分摊汇总报表/会员补录入账数据报表 |
| TOB收入 | 日/月 | 手工填报 |  |  |
| 国际化收入 | 日/月 | 系统取数+手工填报 |  |  |
| 变动费用 | 日/月 | 手工填报 |  |  |
| 推广费 | 日/月 | 系统取数 | 数据中台 | 【日报】日汇总表 |
| 推广费 | 日/月 | 系统取数 | 数据中台hive | 国际留存汇总 |
| 差旅招待 | 日/月 | 手工填报 |  |  |
| 运营费用 | 日/月 | 手工填报 |  |  |
| 其他变动 | 日/月 | 手工填报 |  |  |
| 固定费用 | 日/月 | 手工填报 |  |  |
| 数据源 | 日/月 | 手工填报 |  |  |
| IT服务 | 日/月 | 手工填报 |  |  |
| 工资薪酬福利 | 日/月 | 手工填报 |  |  |
| 摊销类成本 | 日/月 | 手工填报 |  |  |
| 营业外收支 | 日/月 | 手工填报 |  |  |
| 所得税 | 日/月 | 手工填报 |  |  |


#### 8.2指标口径/计算规则

日维度数据步骤：

第一步： FineDataLink任务每日17:31、18:35定时取数到sdm库表，涉及内容项目：品牌收入、效果收入、会员收入、效果极速版收入、推广费、品牌收入明细、效果收入明细、效果广告明细、效果广告汇总、国际化会员流水、国际化广告收入、国内会员日分摊营收、国际会员日分摊营收；任务成功完成后会推送消息到钉钉群通知专人进行净利润日报的填报；

第二步：财务专人在【财务指标-净利润-日报】补充录入其他项目数据后点击“提交”将数据存储到app层的库表，用于看板页面的展示。

[图片占位：1 张，原 DOCX 内嵌图片未 OCR]

第三步：财务日报明细导出数据。

[图片占位：1 张，原 DOCX 内嵌图片未 OCR]

月维度数据：

因净利润日报对应的月度是上月最后一天至本月的倒数第二天，需在结完账后选择本月倒数第二天进行实际数的提交，例如：结账月份是10月，选择10月30号，提交即可。

[图片占位：1 张，原 DOCX 内嵌图片未 OCR]


#### 8.3数据溯源

1、数据源

【数据中台】mysql-bfp_read-iscs_irpt-iscs_hsbm-172.16.23.101

【广告后台】mysql-ad-mojiro


```sql
selectedDB（【数据中台】doris-all-root-all-172.16.19.21）
```
【国际化会员】-mysql-intl-mcs-bdro1-172.16.18.253

【管驾】FineBI

财务tableau损益明细

2、数据源SQL逻辑

<!-- table-45 -->
**表格 45**

字段：序号 / 系统表名 / 溯源SQL

- 记录 1
  - 序号: 1
  - 系统表名: 会员收入：会员日分摊汇总报表+会员补录入账数据报表
  - 溯源SQL:

```sql
/*会员日分摊汇总报表*/
SELECT SELECT h.comments 渠道,h.transaction_date 分摊日期,SUM(IF ((h.accounting_date>='2025-04-01'
OR OR h.accounting_date<='2025-01-31'),h.settle_amount,h.hsettle_amount))*IF (h.comments='IOS'
AND AND h.accounting_date>='2025-05-01',1-0.24,1)/IF ((h.accounting_date>='2025-04-01'
OR OR h.accounting_date<='2025-01-31'),1.06,1) 分摊金额
FROM FROM iscs_hsbm.hsar_settle_orders h
WHERE WHERE 1=1
AND AND h.document_status='APPROVED'
AND AND h.business_type_code='BT01-1'
AND AND h.generation_method='RP'
AND AND h.accounting_status='UN'
AND AND h.accounting_date>='2025-01-31'
AND AND h.tenant_id='10020'
GROUP BY GROUP BY h.comments,h.transaction_date,h.currency_code
ORDER BY ORDER BY h.comments,h.transaction_date
UNION ALL UNION ALL/*会员补录入账数据报表*/
SELECT SELECT h.comments AS 渠道,DATE_ADD(DATE_FORMAT(h.accounting_date,'%Y-%m-01'),INTERVAL t.n DAY) AS 分摊日期,(CASE
WHEN WHEN DATE_ADD(DATE_FORMAT(h.accounting_date,'%Y-%m-01'),INTERVAL t.n DAY)=LAST_DAY(h.accounting_date) THEN h.settle_amount-ROUND(h.settle_amount/DAY (LAST_DAY(h.accounting_date)),2)*(DAY (LAST_DAY(h.accounting_date))-1) ELSE ROUND(h.settle_amount/DAY (LAST_DAY(h.accounting_date)),2) END)/1.06 AS 分摊金额
FROM FROM iscs_hsbm.hsar_settle_orders h
JOIN JOIN (
SELECT SELECT 0 AS n
UNION ALL UNION ALL
SELECT SELECT 1
UNION ALL UNION ALL
SELECT SELECT 2
UNION ALL UNION ALL
SELECT SELECT 3
UNION ALL UNION ALL
SELECT SELECT 4
UNION ALL UNION ALL
SELECT SELECT 5
UNION ALL UNION ALL
SELECT SELECT 6
UNION ALL UNION ALL
SELECT SELECT 7
UNION ALL UNION ALL
SELECT SELECT 8
UNION ALL UNION ALL
SELECT SELECT 9
UNION ALL UNION ALL
SELECT SELECT 10
UNION ALL UNION ALL
SELECT SELECT 11
UNION ALL UNION ALL
SELECT SELECT 12
UNION ALL UNION ALL
SELECT SELECT 13
UNION ALL UNION ALL
SELECT SELECT 14
UNION ALL UNION ALL
SELECT SELECT 15
UNION ALL UNION ALL
SELECT SELECT 16
UNION ALL UNION ALL
SELECT SELECT 17
UNION ALL UNION ALL
SELECT SELECT 18
UNION ALL UNION ALL
SELECT SELECT 19
UNION ALL UNION ALL
SELECT SELECT 20
UNION ALL UNION ALL
SELECT SELECT 21
UNION ALL UNION ALL
SELECT SELECT 22
UNION ALL UNION ALL
SELECT SELECT 23
UNION ALL UNION ALL
SELECT SELECT 24
UNION ALL UNION ALL
SELECT SELECT 25
UNION ALL UNION ALL
SELECT SELECT 26
UNION ALL UNION ALL
SELECT SELECT 27
UNION ALL UNION ALL
SELECT SELECT 28
UNION ALL UNION ALL
SELECT SELECT 29
UNION ALL UNION ALL
SELECT SELECT 30) t ON t.n< DAY (last_day(h.accounting_date))
WHERE WHERE 1=1
AND AND h.document_status='APPROVED'
AND AND h.business_type_code IN ('BT01-1','BT01-3')
AND AND h.generation_method='ITF'
AND AND h.accounting_date>='2025-01-01'
AND AND h.accounting_status !='UN'
AND AND h.tenant_id='10020'
ORDER BY ORDER BY h.accounting_date,h.comments,DATE_ADD(DATE_FORMAT(h.accounting_date,'%Y-%m-01'),INTERVAL t.n DAY)
```

- 记录 2
  - 序号: 2
  - 系统表名: 日收入数据详情表
  - 溯源SQL:

```sql
select from
from_unixtime(date,'%y-%m-%d') as datestr,-- 日期 project_name as advertiser_name,-- 广告主 partner,-- 合作伙伴
case case
when when platform='1' then 'android'
when when platform='2' then 'ios'
when when platform='4' then 'ipad' else '其他' end platform,-- 平台 position,-- 广告位 position_id,-- 广告位id if (adverting_type='联盟'
or or project_name in ('华为联盟','oppo联盟','游可赢','vivo联盟'),alliance_ad_show,ad_show) as ad_show,-- 曝光 if (adverting_type='联盟'
or or project_name in ('华为联盟','oppo联盟','游可赢','vivo联盟'),alliance_ad_click,ad_click) as ad_click,-- 点击 daily_income,-- 消耗 if (adverting_type='联盟'
or or project_name in ('华为联盟','oppo联盟','游可赢','vivo联盟'),alliance_ad_click,ad_click)/if (adverting_type='联盟'
or or project_name in ('华为联盟','oppo联盟','游可赢','vivo联盟'),alliance_ad_show,ad_show) as ctr,-- crt round((daily_income)/if (adverting_type='联盟'
or or project_name in ('华为联盟','oppo联盟','游可赢','vivo联盟'),alliance_ad_show,ad_show)*1000,2) as ecmp,-- ecpm adverting_type,-- 广告主类型 if (length(channel)> 0,channel,case
when when platform='1' then 'android'
when when platform='2' then 'ios'
when when platform='4' then 'ipad' else '其他' end) as channel,-- 渠道
case case
when when operator='1' then 'moji'
when when operator='2' then 'topon' end operator,-- 运营商 cast(daily_income/1.06 as decimal (10,2)) as price_after_tax,-- 税后收入 round(cast(daily_income/1.06 as decimal (10,2))/if (adverting_type='联盟'
or or project_name in ('华为联盟','oppo联盟','游可赢','vivo联盟'),alliance_ad_show,ad_show)*1000,1) as price_after_ecmp,-- 税后单价 rebate_ratio-- 返点比例
from from ad.ad_contract_daily_income
where where
from from_unixtime(date,'%y-%m-%d')>='2020-01-01'
order by order by datestr
```

- 记录 3
  - 序号: 3
  - 系统表名: 效果收入
  - 溯源SQL:

```sql
select datestr as stat_date, '效果' projectclass,-- 项目 advertiser_name,-- 广告主 partner as customer, -- 合作伙伴(最终客户) sum(case
when when advertiser_name = '拼多多-效果' then price_after_tax * 0.7
when when advertiser_name = '旺脉'
and and datestr <= '2024-12-31' then price_after_tax * 0.95
when when advertiser_name = '阿里汇川-效果' then price_after_tax * 0.85 else price_after_tax end ) amout -- 金额
from from 日收入数据详情表
where where channel != 'Android（极速版）'
and and datestr >= '2024-01-01'
and and advertiser_name not in ('京准通', '阿里TanX', '阿里汇川-效果', '阿里启航-正式', '拼多多-效果')
GROUP BY GROUP BY datestr , advertiser_name, partner
```

- 记录 4
  - 序号: 4
  - 系统表名: 效果极速版收入
  - 溯源SQL:

```sql
SELECT STR_TO_DATE( datestr, '%Y-%m-%d' ) AS stat_date, advertiser_name,-- 广告主 partner,-- 合作伙伴 sum( price_after_tax ) amout
FROM FROM 日收入数据详情表
WHERE WHERE datestr >= '2024-11-22'
AND AND channel = 'Android（极速版）'
GROUP BY GROUP BY datestr, advertiser_name, partner
```

- 记录 5
  - 序号: 5
  - 系统表名: 品牌收入：品牌RTB
  - 溯源SQL:

```sql
select datestr as stat_date, -- 日期 '品牌RTB' projectclass,-- 项目 advertiser_name,-- 广告主 partner as customer, -- 最终客户 sum((daily_income - (daily_income * rebate_ratio / 100)) / 1.06 ) amout -- 自营效果收入
from from 日收入数据详情表
where where datestr >= '2020-01-01'
AND AND adverting_type = '品牌RTB'
GROUP BY GROUP BY datestr, advertiser_name, partner
```

- 记录 6
  - 序号: 5
  - 系统表名: 品牌收入：广告后台实际营收(无余量)
  - 溯源SQL:

```sql
select DATE_FORMAT(STR_TO_DATE(date_day, '%Y%m%d'), '%Y-%m-%d') stat_date, -- 年份月份 custom as customer , -- 最终客户 sum(revenue_m) amout -- 后台实际营收(无余量)
from from mojicom.ad_single_user_roi_brand_income -- 【广告后台】mysql-mojicom-mojiro,单用户roi品牌营收数据表
group by group by date_day,custom
```

- 记录 7
  - 序号: 6
  - 系统表名: 推广费-国内 【日报】日汇总表
  - 溯源SQL:

```sql
-- 2024-01-01开始有数据
select select *
from from hive.ods.ods_channel_consumption_summary_report_d
where where stat_date = (
select select max(stat_date) hivedate -- 最新的日期分区
from from hive.ods.ods_channel_consumption_summary_report_d ) -- 2024-01-01开始有数据
select select *
from from hive.ods.ods_channel_consumption_summary_report_d
where where stat_date = (
select select max(stat_date) hivedate -- 最新的日期分区
from from hive.ods.ods_channel_consumption_summary_report_d )
```

- 记录 8
  - 序号: 7
  - 系统表名: 推广费-国际
  - 溯源SQL:

```sql
select install_day as stat_date, -- 日期 sum(cost) cost -- 消耗
from from stg.stg_appflyer_master_agg_retention -- 国际留存汇总数据
where where install_day >= '2025-10-21'
GROUP BY GROUP BY install_day
```

- 记录 9
  - 序号: 8
  - 系统表名: 外包效果分广告位明细 【主板-效果日报-明细】
  - 溯源SQL:

```sql
SELECT datestr,-- 日期
CASE CASE
WHEN WHEN position_id='1' THEN '二级splash'
WHEN WHEN position_id='310' THEN '15日预报上方'
WHEN WHEN position_id='1004' THEN '每日详情中部'
WHEN WHEN position_id='306' THEN '天气首页中部'
WHEN WHEN position_id='307' THEN '天气首页底部' ELSE '其他' END position,-- 广告位 sum(ad_show) ad_show,-- 曝光 sum(ad_click) ad_click,-- 点击 sum(price_after_tax) amout,-- 税后收入
CASE CASE
WHEN WHEN sum(ad_show)=0 THEN 0 ELSE sum(ad_click)/sum(ad_show) END ctr,-- CTR
CASE CASE
WHEN WHEN sum(ad_show)=0 THEN 0 ELSE sum(price_after_tax)/sum(ad_show)*1000 END price_after_ecmp-- 税后单价
FROM FROM 日收入数据详情表
WHERE WHERE adverting_type IN ('联盟','第三方DSP','直投','Android','iPhone','Android(万年历)','ios(万年历)')-- 广告主类型
AND AND position_id IN ('1','310','1004','306','307')-- 广告位id
AND AND datestr>='2024-01-01'
GROUP BY GROUP BY datestr,position_id
```

- 记录 10
  - 序号: 9
  - 系统表名: 主板-效果-打开
  - 溯源SQL:

```sql
select `date`, sum(start_num) start_num,-- 打开频次 sum(act_num) act_num -- dau
from from tblu.umeng_all
where where platform in ('Android','iPhone','AndroidLite') -- 平台
group by group by `date`
```

- 记录 11
  - 序号: 10
  - 系统表名: 外包效果-汇总 【主板-效果收入】
  - 溯源SQL:

```sql
SELECT a.datestr,-- 日期 b.start_num,-- 打开频次 b.act_num,-- dau a.ad_show,-- 曝光 a.ad_click,-- 点击 a.amout,-- 效果收入 a.ctr,-- CTR a.ecmp-- 税后单价(ecpm)
FROM FROM (SELECT datestr,sum(ad_show) ad_show,-- 曝光 sum(ad_click) ad_click,-- 点击 sum(amout) amout,-- 效果收入
CASE CASE
WHEN WHEN sum(ad_show)=0 THEN 0 ELSE sum(ad_click)/sum(ad_show) END ctr,-- CTR
CASE CASE
WHEN WHEN sum(ad_show)=0 THEN 0 ELSE sum(amout)/sum(ad_show)*1000 END ecmp-- 税后单价(ecpm)
FROM FROM (SELECT datestr,-- 日期 advertiser_name,-- 广告主 ad_show,-- 曝光 ad_click,-- 点击 adverting_type,-- 广告主类型 channel,-- 渠道 price_after_tax,-- 税后收入 price_after_ecmp,-- 税后单价 rebate_ratio,-- 返点比例
CASE CASE
WHEN WHEN advertiser_name='拼多多-效果' THEN price_after_tax*0.7
WHEN WHEN advertiser_name='旺脉'
AND AND datestr<='2024-12-31' THEN price_after_tax*0.95
WHEN WHEN advertiser_name='阿里汇川-效果' THEN price_after_tax*0.85 ELSE price_after_tax END amout-- 效果收入 --
case case
when when advertiser_name in ('京准通', '阿里TanX', '阿里汇川-效果', '阿里启航-正式', '拼多多-效果') then '效果自营' -- else '效果外包' end department -- 部门
FROM FROM finebi_dashboard.odm_ad_contract_daily_income-- 日收入数据详情表
WHERE WHERE datestr>='2024-01-01'
AND AND advertiser_name NOT IN ('京准通','阿里TanX','阿里汇川-效果','阿里启航-正式','拼多多-效果')) tt
GROUP BY GROUP BY datestr) a
LEFT JOIN LEFT
JOIN JOIN 主板-效果-打开 b ON a.datestr=b.`date`
```

- 记录 12
  - 序号: 11
  - 系统表名: 会员订单结构表
  - 溯源SQL:

```sql
select `create_time`, -- 创建时间 `currency`, -- 币种 `real_price`, -- 实际支付金额(跟币种) `status` ,-- 订单状态 0-支付失败 1-客户端支付成功状态，-1表示取消支付，-2标识服务端校验失败，2-服务端支付成功状态，3-未支付，9 部分退款 10 退款 `sns_id` , `uid` ,-- 设备id `goods_id`, -- 商品id `is_sandbox` -- 是否是沙盒账号
from from `intl-mcs`.`member_order` -- 会员订单结构表
```

- 记录 13
  - 序号: 12
  - 系统表名: 国际会员币种汇率
  - 溯源SQL:

```sql
select `id`, `currency`, `rate`
from from `intl-mcs`.`exchange_rates`
```

- 记录 14
  - 序号: 13
  - 系统表名: 会员商品信息
  - 溯源SQL:

```sql
select * ,
case case
when when concat(cycle_type, '_', cycle_value) = '1_1' then '月卡'
when when concat(cycle_type, '_', cycle_value) = '1_3' then '季卡'
when when concat(cycle_type, '_', cycle_value) = '1_6' then '半年卡'
when when concat(cycle_type, '_', cycle_value)= '0_7' then '周卡'
when when concat(cycle_type, '_', cycle_value) in ('1_12', '2_1', '2_2', '2_3') then '年卡' else '终身' end as cycle_type_new
from from `intl-mcs`.`member_price`
```

- 记录 15
  - 序号: 14
  - 系统表名: 损益明细凭证数据
  - 溯源SQL:

```sql
select stats_yyyymm,-- 年月 account_type_l1 as projectclass,-- 项目分类 hs_account_type_l2 as project,-- 项目 account_type_l3 as item,-- 明细项 department_segment_name as department,-- 部门 sum(amount) amount ,-- 金额 ebs_account_code, -- 科目编码 ebs_account_name -- 科目名称
from from bidm.viz_dm_hs_pl_voucher_dtl -- 损益明细凭证数据
where where stats_yyyymm>='2023-01'
group by group by stats_yyyymm,account_type_l1,hs_account_type_l2, account_type_l3,department_segment_name,ebs_account_code, ebs_account_name
```

- 记录 16
  - 序号: 15
  - 系统表名: 【会员分维度数据订单数据】
  - 溯源SQL:

```sql
SELECT stat_date,'平台' AS `类别`,platform AS `子类别`,sum(mbr_crt_ord_cnt_1d) `会员订单数`,sum(mbr_crt_ord_amt_1d) `会员订单金额`,sum(mbr_crt_ord_cnt_1d_serv_pay_succ) `会员订单数(支付成功)`
FROM FROM dm.dm_user_mbr_ord_d
WHERE WHERE stat_date>='2021-01-01'
GROUP BY GROUP BY stat_date,platform
UNION ALL UNION ALL
SELECT SELECT stat_date,'会员类型' AS `类别`,mbr_type AS `子类别`,sum(mbr_crt_ord_cnt_1d) `会员订单数`,sum(mbr_crt_ord_amt_1d) `会员订单金额`,sum(mbr_crt_ord_cnt_1d_serv_pay_succ) `会员订单数(支付成功)`
FROM FROM dm.dm_user_mbr_ord_d
WHERE WHERE stat_date>='2021-01-01'
GROUP BY GROUP BY stat_date,mbr_type
UNION ALL UNION ALL
SELECT SELECT stat_date,'来源类型' AS `类别`,src_type AS `子类别`,sum(mbr_crt_ord_cnt_1d) `会员订单数`,sum(mbr_crt_ord_amt_1d) `会员订单金额`,sum(mbr_crt_ord_cnt_1d_serv_pay_succ) `会员订单数(支付成功)`
FROM FROM dm.dm_user_mbr_ord_d
WHERE WHERE stat_date>='2021-01-01'
GROUP BY GROUP BY stat_date,src_type
UNION ALL UNION ALL
SELECT SELECT stat_date,'订单状态' AS `类别`,add_t.type AS `子类别`,sum(add_t.num) `会员订单数`,'null' AS `会员订单金额`,'null' AS `会员订单数(支付成功)`
FROM FROM (SELECT*FROM dm.dm_user_mbr_ord_d
WHERE WHERE stat_date>='2021-01-01') lateral VIEW explode (str_to_map (concat('客户端支付成功会员订单数=',mbr_crt_ord_cnt_1d_cli_pay_succ,'&服务端支付成功会员订单数=',mbr_crt_ord_cnt_1d_serv_pay_succ,'&支付失败会员订单数=',mbr_crt_ord_cnt_1d_serv_pay_fail,'&未支付会员订单数=',mbr_crt_ord_cnt_1d_unpaid,'&取消支付会员订单数=',mbr_crt_ord_cnt_1d_pay_cls),'&','=')) add_t AS type,num
GROUP BY GROUP BY stat_date,add_t.type
UNION ALL UNION ALL
SELECT SELECT stat_date,'支付方式' AS `类别`,add_t.type AS `子类别`,'null' AS `会员订单数`,sum(add_t.num) AS `会员订单金额`,'null' AS `会员订单数(支付成功)`
FROM FROM (SELECT*FROM dm.dm_user_mbr_ord_d
WHERE WHERE stat_date>='2021-01-01') lateral VIEW explode (str_to_map (concat('支付宝支付会员订单金额=',mbr_crt_ord_amt_1d_alipay,'&微信支付会员订单金额=',mbr_crt_ord_amt_1d_wechat,'&苹果支付会员订单金额=',mbr_crt_ord_amt_1d_apple),'&','=')) add_t AS type,num
GROUP BY GROUP BY stat_date,add_t.type
UNION ALL UNION ALL
SELECT SELECT stat_date,'支付方式' AS `类别`,concat(IF (k.pay_type IS NOT NULL,k.pay_type,'all'),'_',IF (k.price_type IS NOT NULL,k.price_type,'all')) AS `子类别`,'null' AS `会员订单数`,k.ord_amt_1d AS `会员订单金额`,'null' AS `会员订单数(支付成功)`
FROM FROM da_moji.nyt_mbr_ord_paypricetype_1d k
WHERE WHERE k.price_type IS NOT NULL
AND AND stat_date>='2021-01-01' LIMIT 10000000
```

- 记录 17
  - 序号: 16
  - 系统表名: 会员分商品订单表（财务）
  - 溯源SQL:

```sql
select date_format(from_unixtime(mo.create_time / 1000), 'yyyy-MM-dd') as dt,mo.pay_value ,mo.goods_id,mp.goods_name,count(1),sum(pay_value/100)
from from hive.ods.ods_hd_member_order mo
left join left
join join hive.ods.ods_hd_member_price mp on mp.id = mo.goods_id
and and mo.stat_date=date_format(date_sub(current_date(), 1), 'yyyy-MM-dd')
and and mp.stat_date=date_format(date_sub(current_date(), 1), 'yyyy-MM-dd')
where where mo.create_time>1754020400000
and and mo.status = 2
group by group by mo.pay_value ,mo.goods_id ,mp.goods_name,date_format(from_unixtime(mo.create_time / 1000), 'yyyy-MM-dd')
```


#### 8.4来源环境对比数据

[图片占位：1 张，原 DOCX 内嵌图片未 OCR]

[图片占位：2 张，原 DOCX 内嵌图片未 OCR]

[图片占位：1 张，原 DOCX 内嵌图片未 OCR]

[图片占位：1 张，原 DOCX 内嵌图片未 OCR]

[图片占位：1 张，原 DOCX 内嵌图片未 OCR]

[图片占位：1 张，原 DOCX 内嵌图片未 OCR]

[图片占位：1 张，原 DOCX 内嵌图片未 OCR]

[图片占位：1 张，原 DOCX 内嵌图片未 OCR]

会员总览

[图片占位：1 张，原 DOCX 内嵌图片未 OCR]

[图片占位：1 张，原 DOCX 内嵌图片未 OCR]

[图片占位：1 张，原 DOCX 内嵌图片未 OCR]

[图片占位：1 张，原 DOCX 内嵌图片未 OCR]


#### 8.5 FineDataLink数仓

1、ODM贴源层

<!-- table-46 -->
| 表名 | 描述 | 备注 |
| --- | --- | --- |
| odm_fin_hsar_settle_orders_a_d | 会员营收 | 净利润日报营收 |
| odm_ad_contract_daily_income | 日收入数据详情表 | 净利润日报营收 |
| odm_fin_single_user_roi_brand_income_a_d | 品牌：广告后台实际营收(无余量) | 净利润日报营收 |
| odm_mk_umeng_pid_a_d | 【分渠道日新增活跃】-tblu.umeng_pid_new_dau | 友盟新增数据 推广费-国内 |
| odm_mk_pid_info_a_d | 【渠道映射维表】dim.dim_app_pid_info | 推广费-国内 |
| odm_mk_umeng_pid_ratio_a_d | UM【安卓分渠道新增留存】-tblu.umeng_pid_ratio_day | 推广费-国内 |
| odm_mk_umeng_ratio_a_d | UM【iPhone新增留存】-tblu.ratio_main1 | 推广费-国内 |
| odm_mk_umeng_all_a_d | UM【iPhone日新增活跃】-tblu.umeng_all | 推广费-国内 |
| odm_channel_consumption_summary_report_d | 【日报】日汇总表，获取最新日期分区数据 | 推广费-国内 |
| odm_fin_domestic_promotion_expenses_a_d | 推广费-国内 | 推广费-国内 |
| odm_stg_appflyer_master_agg_retention_a_d | 国际留存汇总 | 推广费-国际 |
| odm_fin_inter_member_order | 国际化会员订单结构表 | 国际化会员流水 |
| odm_fin_inter_exchange_rates | 国际会员币种汇率 | 国际化会员流水 |
| odm_fin_member_price | 国际化会员商品信息 |  |
| odm_ad_mediation_report_a_d | 国际化_第三方广告收入 | 国际化广告营收 |
| odm_fin_voucher_a_m | 损益明细表 | 营业收入&净利润实际调整数 |
| odm_user_mbr_ord_d | 会员订单数据 | 国内会员 |
| odm_hd_member_order | 会员分商品订单表 | 国内会员 |

数据获取逻辑详见数据溯源，ETL详见FineDataLink的【odm净利润日报营收】、【odm净利润日报推广费】、【odm净利润日报会员】任务。

2、IDM明细层/SDM汇总层

<!-- table-47 -->
| 表名 | 描述 | 备注 |
| --- | --- | --- |
| idm_fin_contract_daily_income_a_d | 品牌RTB&效果&效果极速版 营收 |  |
| idm_fin_promotion_a_d | 推广费-财务净利润日报表 | 国内/国际推广费 |
| idm_fin_inter_member_a_d | 国际化会员流水 |  |
| idm_fin_inter_ad_revenue_a_d | 国际化广告营收 |  |
| idm_fin_effect_summary_a_d | 外包效果-汇总 |  |
| idm_fin_effect_position_detail_a_d | 外包效果分广告位明细 |  |
| idm_fin_member_transaction | 会员-国际化（流水+订单量） |  |
| idm_user_mbr_ord_a_d | 会员分维度数据订单数据 |  |
| sdm_fin_customer_daily_a_d | 净利润日报最终客户收入明细 |  |
| sdm_fin_pl_detail_a_d | 净利润日报收入汇总 |  |
| sdm_fin_pl_actual | 净利润日报月度实际数 | 回溯实际调整数 |

数据加工清洗过程详见FineDataLink的【idm净利润日报】、【sdm净利润日报】任务。

3、APP应用层

<!-- table-48 -->
| 表名 | 描述 | 备注 |
| --- | --- | --- |
| app_fin_pl_detail_i_d | 财务净利润日报表（填报） |  |

4、填报数据存储库表

<!-- table-49 -->
| 数据名称 | 填报模版名称 | 数仓库表 | 看板页面 | 备注 |
| --- | --- | --- | --- | --- |
| 净利润日报-国际化 | 财务指标-净利润-国际化（20251130停用） | idm_fin_inter_a_d | 无 | 数据20250301-20251129 |
| 本月前已有订单本月摊销收入 | 财务指标-会员订单摊销收入 | idm_fin_member_revenue_i_d | 无 | 国内会员/国际会员 |
| 净利润日报表 | 财务指标-净利润-日报 | app_fin_pl_detail_i_d | 净利润 |  |
| 净利润日报表 | 无 | app_fin_pl_detail_his_d | 无 | 日志表 |
| app净利润维表 | 无 | app_fin_day | 无 | 维度表 |
| 损益明细科目映射表 | 财务指标-净利润-科目映射表 | idm_fin_account_mapping | 无 | 月度实际调整数 |
| 会员维度-财务类型映射表 | 财务指标-净利润-会员映射表 | idm_fin_member_mapping | 无 |  |
| 广告ID匹配表 | 财务指标-广告ID匹配表 | idm_ad_basic_info |  | 国际化广告营收 |


```sql
-- finebi_dashboard.idm_fin_inter_a_d definition
CREATE TABLE `idm_fin_inter_a_d` (
```
`stat_date` varchar(100) NOT NULL COMMENT '日期',

`projectclass` varchar(100) DEFAULT NULL COMMENT '项目分类',

`original` double DEFAULT NULL COMMENT '美元金额',

`amout` double DEFAULT '0' COMMENT '人民币金额',

`rate` double DEFAULT NULL COMMENT '汇率',

`create_time` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',

`update_time` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '最后更新时间',

`stat_date2` varchar(100) DEFAULT NULL COMMENT 'stat_date2',

KEY `idx_date_range` (`stat_date`) USING BTREE


```sql
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='财务净利润日报-国际化（系统+填报）';
-- finebi_dashboard.app_fin_pl_detail_i_d definition
CREATE TABLE `app_fin_pl_detail_i_d` (
```
`stat_date` varchar(100) NOT NULL COMMENT '数据日期（格式：YYYY-MM-DD）',

`projectclass_type` varchar(100) NOT NULL COMMENT '项目大类',

`projectclass` varchar(100) NOT NULL COMMENT '项目分类',

`amout` double DEFAULT '0' COMMENT '项目金额',

`amout1` double DEFAULT '0' COMMENT '预估调整金额',

`amout2` double DEFAULT NULL COMMENT '实际调整数',

`amout3` double DEFAULT '0' COMMENT '合计金额',

`chain_ratio` double DEFAULT '0' COMMENT '环比',

`year_ratio` double DEFAULT '0' COMMENT '同比',

`create_time` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',

`update_time` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '最后更新时间',

`stat_date2` varchar(100) DEFAULT NULL COMMENT 'stat_date2',

`stat_month` varchar(100) DEFAULT NULL COMMENT '会计月',

PRIMARY KEY (`stat_date`,`projectclass_type`,`projectclass`),

KEY `idx_date_range` (`stat_date`) USING BTREE


```sql
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='财务净利润日报表（填报）';
-- finebi_dashboard.app_fin_day definition
CREATE TABLE `app_fin_day` (
```
`stat_date` date DEFAULT NULL COMMENT '年月日',

`projectclass` varchar(100) DEFAULT NULL COMMENT '项目分类',

`projectclass_type` varchar(100) DEFAULT NULL COMMENT '项目大类',

KEY `idx_stat_date_composite` (`stat_date`,`projectclass_type`,`projectclass`)


```sql
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 ROW_FORMAT=DYNAMIC COMMENT='日期维度表';
-- finebi_dashboard.idm_fin_member_revenue_i_d definition
CREATE TABLE `idm_fin_member_revenue_i_d` (
```
`stat_month` varchar(255) DEFAULT NULL COMMENT '年月',

`amout` double DEFAULT NULL COMMENT '国内会员金额',

`amout_inter` double DEFAULT NULL COMMENT '国际会员金额(美元)',

`create_time` timestamp NULL DEFAULT NULL COMMENT '创建日期'


```sql
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='本月前已有订单本月摊销收入';
-- finebi_dashboard.idm_fin_account_mapping definition
CREATE TABLE `idm_fin_account_mapping` (
```
`account_code` varchar(100) DEFAULT NULL COMMENT '科目编码',

`account_name` varchar(255) DEFAULT NULL COMMENT '科目名称',

`pro_type` varchar(50) DEFAULT NULL COMMENT '类型',

`pro_class` varchar(50) DEFAULT NULL COMMENT '项目分类',

`project` varchar(50) DEFAULT NULL COMMENT '费用项目'


```sql
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='损益明细科目映射表';
-- finebi_dashboard.idm_fin_member_mapping definition
CREATE TABLE `idm_fin_member_mapping` (
```
`sub_category` varchar(100) DEFAULT NULL COMMENT '子类别',

`fin_type` varchar(100) DEFAULT NULL COMMENT '财务类型',

`create_time` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '记录创建时间'


```sql
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 ROW_FORMAT=DYNAMIC COMMENT='会员维度-财务类型映射表';
```
5、管驾调度任务配置

<!-- table-50 -->
| 【数据中台】库表 | 【数据中台】更新时间 |
| --- | --- |
| ad.ad_contract_daily_income |  |
| hive.ods.ods_channel_consumption_summary_report_d | 18:00 |
| tblu.umeng_pid_new_dau | 9:00 |
| tblu.umeng_all | 9:00 |
| tblu.umeng_pid_ratio_day | 12:00 |
| tblu.ratio_main | 8:00 |
| hive.dim.dim_app_pid_info | 2:00 |

系统数据更新：每天17:31、18:35自动执行任务；

净利润日报当日录入昨日的数据；

6、填报数据集

<!-- table-51 -->
**表格 51**

字段：填报模版名称 / 数据集名称 / 数仓库表 / SQL逻辑

- 记录 1
  - 填报模版名称: 财务指标-净利润-国际化
  - 数据集名称: 会员流水
  - 数仓库表: sdm_mb_inter_member_day_a_d
  - SQL逻辑:

```sql
select stat_date as pay_time, sum(real_price) as pay_amt
from from idm_fin_inter_member_a_d
group by group by stat_date
```

- 记录 2
  - 填报模版名称: 财务指标-净利润-国际化
  - 数据集名称: 广告收入
  - 数仓库表: app_ad_inter_ad_a_d
  - SQL逻辑:

```sql
select stat_date, sum(ad_revenue) ad_revenue
from from idm_fin_inter_ad_revenue_a_d
group by group by stat_date
order by order by stat_date desc
```

- 记录 3
  - 填报模版名称: 财务指标-净利润-国际化
  - 数据集名称: 推广费-国际
  - 数仓库表: idm_fin_promotion_a_d
  - SQL逻辑:

```sql
select stat_date,"费用-推广" as projectclass ,amout ,original
from from idm_fin_promotion_a_d
where where projectclass='推广费-国际'
```

- 记录 4
  - 填报模版名称: 财务指标-净利润-日报
  - 数据集名称:

```sql
SELECT dr.stat_date, dr.projectclass_type, dr.projectclass, ifnull( a.amout, b.amout ) AS amout, a.amout3, a.amout1
FROM FROM (
SELECT SELECT stat_date, projectclass_type, projectclass
FROM FROM app_fin_day
WHERE WHERE stat_date >= date_sub( date_format( '${f_date}', '%y-%m-01' ), INTERVAL 1 DAY )
AND AND stat_date <= '${f_date}' ) dr
LEFT JOIN LEFT
JOIN JOIN (
SELECT SELECT stat_date, projectclass_type, projectclass, amout, amout3, amout1
FROM FROM app_fin_pl_detail_i_d
WHERE WHERE stat_date >= date_sub( date_format( '${f_date}', '%y-%m-01' ), INTERVAL 1 DAY )
AND AND stat_date <= '${f_date}' ) a ON a.stat_date = dr.stat_date
AND AND a.projectclass_type = dr.projectclass_type
AND AND a.projectclass = dr.projectclass
LEFT JOIN LEFT
JOIN JOIN (
SELECT SELECT stat_date, projectclass_type, projectclass, amout
FROM FROM sdm_fin_pl_detail_i_d
WHERE WHERE stat_date >= date_sub( date_format( '${f_date}', '%y-%m-01' ), INTERVAL 1 DAY )
AND AND stat_date <= '${f_date}' ) b ON b.stat_date = dr.stat_date
AND AND b.projectclass_type = dr.projectclass_type
AND AND b.projectclass = dr.projectclass
WHERE WHERE dr.stat_date IS NOT NULL
```
  - 数仓库表:

```sql
SELECT dr.stat_date, dr.projectclass_type, dr.projectclass, ifnull( a.amout, b.amout ) AS amout, a.amout3, a.amout1
FROM FROM (
SELECT SELECT stat_date, projectclass_type, projectclass
FROM FROM app_fin_day
WHERE WHERE stat_date >= date_sub( date_format( '${f_date}', '%y-%m-01' ), INTERVAL 1 DAY )
AND AND stat_date <= '${f_date}' ) dr
LEFT JOIN LEFT
JOIN JOIN (
SELECT SELECT stat_date, projectclass_type, projectclass, amout, amout3, amout1
FROM FROM app_fin_pl_detail_i_d
WHERE WHERE stat_date >= date_sub( date_format( '${f_date}', '%y-%m-01' ), INTERVAL 1 DAY )
AND AND stat_date <= '${f_date}' ) a ON a.stat_date = dr.stat_date
AND AND a.projectclass_type = dr.projectclass_type
AND AND a.projectclass = dr.projectclass
LEFT JOIN LEFT
JOIN JOIN (
SELECT SELECT stat_date, projectclass_type, projectclass, amout
FROM FROM sdm_fin_pl_detail_i_d
WHERE WHERE stat_date >= date_sub( date_format( '${f_date}', '%y-%m-01' ), INTERVAL 1 DAY )
AND AND stat_date <= '${f_date}' ) b ON b.stat_date = dr.stat_date
AND AND b.projectclass_type = dr.projectclass_type
AND AND b.projectclass = dr.projectclass
WHERE WHERE dr.stat_date IS NOT NULL
```
  - SQL逻辑:

```sql
SELECT dr.stat_date, dr.projectclass_type, dr.projectclass, ifnull( a.amout, b.amout ) AS amout, a.amout3, a.amout1
FROM FROM (
SELECT SELECT stat_date, projectclass_type, projectclass
FROM FROM app_fin_day
WHERE WHERE stat_date >= date_sub( date_format( '${f_date}', '%y-%m-01' ), INTERVAL 1 DAY )
AND AND stat_date <= '${f_date}' ) dr
LEFT JOIN LEFT
JOIN JOIN (
SELECT SELECT stat_date, projectclass_type, projectclass, amout, amout3, amout1
FROM FROM app_fin_pl_detail_i_d
WHERE WHERE stat_date >= date_sub( date_format( '${f_date}', '%y-%m-01' ), INTERVAL 1 DAY )
AND AND stat_date <= '${f_date}' ) a ON a.stat_date = dr.stat_date
AND AND a.projectclass_type = dr.projectclass_type
AND AND a.projectclass = dr.projectclass
LEFT JOIN LEFT
JOIN JOIN (
SELECT SELECT stat_date, projectclass_type, projectclass, amout
FROM FROM sdm_fin_pl_detail_i_d
WHERE WHERE stat_date >= date_sub( date_format( '${f_date}', '%y-%m-01' ), INTERVAL 1 DAY )
AND AND stat_date <= '${f_date}' ) b ON b.stat_date = dr.stat_date
AND AND b.projectclass_type = dr.projectclass_type
AND AND b.projectclass = dr.projectclass
WHERE WHERE dr.stat_date IS NOT NULL
```


#### 8.6 数据验证结论

1、品牌收入：广告管理后台+大数据

无页面数据验证

2、效果收入（部门=效果外包）：https://finebi.matrixback.com/decision#/directory?activeTab=9c3ff1e3-e7e5-4a0c-ac26-a08c4313d1f7

[图片占位：1 张，原 DOCX 内嵌图片未 OCR]

3、会员收入（查询需密码）：https://finebi.matrixback.com/decision/link/eg82

数据时间差（T是BI基准）：会员收入T+1； 4、效果极速版收入：https://finebi.matrixback.com/decision#/directory?activeTab=32a1710a-a13d-4eb9-9274-769bf42285cf

5、 国内推广费：https://finebi.matrixback.com/decision#/?activeTab=4bf23440-9d9a-4d37-8248-8668f189e159

历史数据动态变化，无法回溯验证

[图片占位：1 张，原 DOCX 内嵌图片未 OCR]

[图片占位：1 张，原 DOCX 内嵌图片未 OCR]

6、国际推广费：https://finebi.matrixback.com/decision#/directory?activeTab=53e40a8d-33e4-4835-9915-957f29981b73

[图片占位：1 张，原 DOCX 内嵌图片未 OCR]

[图片占位：4 张，原 DOCX 内嵌图片未 OCR]


### 9.M-ROE

[图片占位：1 张，原 DOCX 内嵌图片未 OCR]


#### 9.1指标清单

<!-- table-52 -->
| 指标名称 | 统计频率 | 数据来源方式 | 来源系统 | 系统表名 |
| --- | --- | --- | --- | --- |
| M-ROE | 月 | 系统计算 |  |  |
| 管理会计净利润 | 月 | 系统计算 |  |  |
| 管理会计总资产 | 月 | 系统计算 |  |  |
| 【财务】净利润 | 月 | 系统取数 | 数据中台 | 利润表 |
| 【财务】净资产 | 月 | 系统取数 | 数据中台 | 资产负债表 |
| 净用户资产增值 | 月 | 系统计算 |  |  |
| 净用户资产 | 月 | 系统计算 |  |  |
| 当年期末残余用户资产增值 | 月 | 系统计算 |  |  |
| 当年期末残余用户总资产 | 月 | 系统计算 |  |  |
| 当年期末残余用户资产 | 月 | 系统计算 |  |  |
| 上一年期末残余用户资产 | 月 | 系统计算 |  |  |
| 当年期末残余广告用户资产增值 | 月 | 系统计算 |  |  |
| 当年期末残余会员用户资产增值 | 月 | 系统计算 |  |  |
| 当年期末残余TOB客户资产增值 | 月 | 系统计算 |  |  |
| 当年期末残余广告用户资产 | 月 | 系统计算 |  |  |
| 当年期末残余会员用户资产 | 月 | 系统计算 |  |  |
| 上一年期末残余广告用户资产 | 月 | 系统计算 |  |  |
| 上一年期末残余会员用户资产 | 月 | 系统计算 |  |  |
| 上一年期末残余TOB用户资产 | 月 | 系统计算 |  |  |
| 当年期末残余广告用户总资产 | 月 | 手工填报 |  |  |
| 当年期末残余会员用户总资产 | 月 | 手工填报 |  |  |
| 当年期末残余TOB用户资产 | 月 | 手工填报 |  |  |


#### 9.2指标口径/计算规则

数据流转步骤：

1、广告、会员、TOB的月度残余用户总资产在【财务指标-M-ROE-残余用户总资产】填报录入；数据存储于idm_ar_indicators_i_m M-ROE填报分项指标表；

2、FDL定时读取数据中台的月度资产负债表中资产合计、负债合计数据，月度利润表的净利润本年累计金额；

3、M-ROE页面实时读取视图数据v_app_ar_indicators_m；


#### 9.3数据溯源

1、数据源

【数据中台】oracle-ebs-prod

2、数据源SQL逻辑

<!-- table-53 -->
| 序号 | 系统表名 | 溯源SQL |
| --- | --- | --- |
| 1 | 资产负债表 | SELECT period_name,-- 会计期间 template_id,-- 报表项目id report,-- 报表项目 ytd_amount-- 期末金额 -- bal_amount -- 年初金额 FROM cux.cux_gl_period_debts_iface # -- 资产负债表 WHERE company_name='墨迹全合并公司'-- 组织机构 AND report IN ('资产总计','负债合计') |
| 2 | 利润表 | SELECT PERIOD_NAME,-- 会计期间 TEMPLATE_ID,-- 报表项目ID REPORT,-- 报表项目 YTD_AMOUNT,-- 本年累计金额 PTD_AMOUNT-- 本期金额 FROM CUX.CUX_FIN_TO_BUD_INCOME_ITF-- 利润表 WHERE COMPANY_NAME='墨迹全合并公司'-- 组织机构 AND REPORT IN ('四、净利润（净亏损以“-”号填列）','一、营业收入') |


#### 9.4来源环境对比数据

无内容，省略……


#### 9.5 FineDataLink数仓

1、ODM贴源层

<!-- table-54 -->
| 表名 | 描述 | 备注 |
| --- | --- | --- |
| odm_fin_period_debts_iface | 资产负债表项目 |  |
| odm_fin_to_bud_income_itf | 利润表项目 |  |

数据获取逻辑详见数据溯源，ETL详见FineDataLink的【odm M-ROE】任务。

2、M-ROE逻辑


```sql
select a.yearmonth,-- 年月
```
(c.net_profit+((a.current_adv_asset+a.current_member_asset+a.current_tob_asset)-(b.current_adv_asset+b.current_member_asset+b.current_tob_asset)))/(c.net_asset+(a.current_adv_asset+a.current_member_asset+a.current_tob_asset)) as m_roe,-- m-roe

c.net_profit,-- 净利润(亿)

c.net_asset,-- 净资产(亿)

a.current_adv_asset,-- 当年期末残余广告用户资产(亿)

a.current_member_asset,-- 当年期末残余会员用户资产(亿)

a.current_tob_asset,-- 当年期末残余tob用户资产(亿)

b.current_adv_asset as last_year_adv_asset,-- 上一年期末残余广告用户资产(亿)

b.current_member_asset as last_year_member_asset,-- 上一年期末残余会员用户资产(亿)

b.current_tob_asset as last_year_tob_asset,-- 上一年期末残余tob用户资产(亿)

a.current_adv_asset+a.current_member_asset+a.current_tob_asset as current_total_asset,-- 当年期末残余用户总资产(亿)

a.current_adv_asset-b.current_adv_asset as current_adv_asset_increase,-- 当年期末残余广告用户资产增值(亿)

a.current_member_asset-b.current_member_asset as current_member_asset_increase,-- 当年期末残余会员用户资产增值(亿)

a.current_tob_asset-b.current_tob_asset as current_tob_asset_increase,-- 当年期末残余tob用户资产增值(亿)

a.current_adv_asset+a.current_member_asset+a.current_tob_asset as current_asset,-- 当年期末残余用户资产(亿)

b.current_adv_asset+b.current_member_asset+b.current_tob_asset as last_year_asset,-- 上一年期末残余用户资产(亿)

(a.current_adv_asset+a.current_member_asset+a.current_tob_asset)-(b.current_adv_asset+b.current_member_asset+b.current_tob_asset) as current_asset_increase,-- 当年期末残余用户资产增值(亿)

a.current_adv_asset+a.current_member_asset+a.current_tob_asset as net_user_asset,-- 净用户资产(亿)

(a.current_adv_asset+a.current_member_asset+a.current_tob_asset)-(b.current_adv_asset+b.current_member_asset+b.current_tob_asset) as net_user_asset_increase,-- 净用户资产增值(亿)

c.net_asset+(a.current_adv_asset+a.current_member_asset+a.current_tob_asset) as account_total_asset,-- 管理会计总资产(亿)

c.net_profit+((a.current_adv_asset+a.current_member_asset+a.current_tob_asset)-(b.current_adv_asset+b.current_member_asset+b.current_tob_asset)) as account_net_profit-- 管理会计净利润(亿)


```sql
from (select yearmonth,-- 年月
```
sum(current_adv_asset) current_adv_asset,-- 当年期末残余广告用户资产(亿)

sum(current_member_asset) current_member_asset,-- 当年期末残余会员用户资产(亿)

sum(current_tob_asset) current_tob_asset-- 当年期末残余tob用户资产(亿)


```sql
from (select yearmonth,-- 年月
```
amout as current_adv_asset,-- 当年期末残余广告用户资产(亿)

0 current_member_asset,-- 当年期末残余会员用户资产(亿)

0 current_tob_asset-- 当年期末残余tob用户资产(亿)


```sql
from idm_ar_indicators_i_m where businesstype='广告'-- 业务类型
union select yearmonth,-- 年月
```
0 current_adv_asset,-- 当年期末残余广告用户资产(亿)

amout as current_member_asset,-- 当年期末残余会员用户资产(亿)

0 current_tob_asset-- 当年期末残余tob用户资产(亿)


```sql
from idm_ar_indicators_i_m where businesstype='会员'-- 业务类型
union select yearmonth,-- 年月
```
0 current_adv_asset,-- 当年期末残余广告用户资产(亿)

0 current_member_asset,-- 当年期末残余会员用户资产(亿)

amout as current_tob_asset-- 当年期末残余tob用户资产(亿)


```sql
from idm_ar_indicators_i_m where businesstype='tob'-- 业务类型
) tt group by yearmonth) a left join (select yearmonth,-- 年月
```
sum(current_adv_asset) current_adv_asset,-- 当年期末残余广告用户资产(亿)

sum(current_member_asset) current_member_asset,-- 当年期末残余会员用户资产(亿)

sum(current_tob_asset) current_tob_asset-- 当年期末残余tob用户资产(亿)


```sql
from (select yearmonth,-- 年月
```
amout as current_adv_asset,-- 当年期末残余广告用户资产(亿)

0 current_member_asset,-- 当年期末残余会员用户资产(亿)

0 current_tob_asset-- 当年期末残余tob用户资产(亿)


```sql
from idm_ar_indicators_i_m where businesstype='广告'-- 业务类型
union select yearmonth,-- 年月
```
0 current_adv_asset,-- 当年期末残余广告用户资产(亿)

amout as current_member_asset,-- 当年期末残余会员用户资产(亿)

0 current_tob_asset-- 当年期末残余tob用户资产(亿)


```sql
from idm_ar_indicators_i_m where businesstype='会员'-- 业务类型
union select yearmonth,-- 年月
```
0 current_adv_asset,-- 当年期末残余广告用户资产(亿)

0 current_member_asset,-- 当年期末残余会员用户资产(亿)

amout as current_tob_asset-- 当年期末残余tob用户资产(亿)


```sql
from idm_ar_indicators_i_m where businesstype='tob'-- 业务类型
) tt group by yearmonth) b on concat(cast(substring(a.yearmonth,1,4)-1 as char),'-12')=b.yearmonth left join (select tt.period_name as yearmonth,(coalesce (sum(tt.net_profit),0)/100000000) as net_profit,-- 净利润
```
(coalesce (sum(tt.net_asset),0)/100000000) as net_asset-- 净资产


```sql
from (select t.period_name,0 as net_profit,-- 净利润
```
sum(t.amount) as net_asset-- 净资产


```sql
from (select period_name,ytd_amount as amount from finebi_dashboard.odm_fin_period_debts_iface-- ebs资产负债表
where report='资产总计' union select period_name,-1*ytd_amount as amount from finebi_dashboard.odm_fin_period_debts_iface-- ebs资产负债表
where report='负债合计') t group by t.period_name union select period_name,ytd_amount as net_profit,-- 净利润
```
0 as net_asset-- 净资产


```sql
from finebi_dashboard.odm_fin_to_bud_income_itf-- ebs利润表
where report='四、净利润（净亏损以“-”号填列）') tt group by tt.period_name) c on a.yearmonth=c.yearmonth
```
4、创建视图

<!-- table-55 -->
| 表名 | 描述 | 备注 |
| --- | --- | --- |
| v_app_ar_indicators | M-ROE视图 |  |


```sql
-- finebi_dashboard.v_app_ar_indicators_m source
```
CREATE OR REPLACE algorithm=UNDEFINED VIEW `v_app_ar_indicators_m` AS SELECT `a`.`yearmonth` AS `yearmonth`,((`c`.`net_profit`+(((`a`.`current_adv_asset`+`a`.`current_member_asset`)+`a`.`current_tob_asset`)-((`b`.`current_adv_asset`+`b`.`current_member_asset`)+`b`.`current_tob_asset`)))/(`c`.`net_asset`+((`a`.`current_adv_asset`+`a`.`current_member_asset`)+`a`.`current_tob_asset`))) AS `m_roe`,`c`.`net_profit` AS `net_profit`,`c`.`net_asset` AS `net_asset`,`a`.`current_adv_asset` AS `current_adv_asset`,`a`.`current_member_asset` AS `current_member_asset`,`a`.`current_tob_asset` AS `current_tob_asset`,`b`.`current_adv_asset` AS `last_year_adv_asset`,`b`.`current_member_asset` AS `last_year_member_asset`,`b`.`current_tob_asset` AS `last_year_tob_asset`,((`a`.`current_adv_asset`+`a`.`current_member_asset`)+`a`.`current_tob_asset`) AS `current_total_asset`,(`a`.`current_adv_asset`-`b`.`current_adv_asset`) AS `current_adv_asset_increase`,(`a`.`current_member_asset`-`b`.`current_member_asset`) AS `current_member_asset_increase`,(`a`.`current_tob_asset`-`b`.`current_tob_asset`) AS `current_tob_asset_increase`,((`a`.`current_adv_asset`+`a`.`current_member_asset`)+`a`.`current_tob_asset`) AS `current_asset`,((`b`.`current_adv_asset`+`b`.`current_member_asset`)+`b`.`current_tob_asset`) AS `last_year_asset`,(((`a`.`current_adv_asset`+`a`.`current_member_asset`)+`a`.`current_tob_asset`)-((`b`.`current_adv_asset`+`b`.`current_member_asset`)+`b`.`current_tob_asset`)) AS `current_asset_increase`,((`a`.`current_adv_asset`+`a`.`current_member_asset`)+`a`.`current_tob_asset`) AS `net_user_asset`,(((`a`.`current_adv_asset`+`a`.`current_member_asset`)+`a`.`current_tob_asset`)-((`b`.`current_adv_asset`+`b`.`current_member_asset`)+`b`.`current_tob_asset`)) AS `net_user_asset_increase`,(`c`.`net_asset`+((`a`.`current_adv_asset`+`a`.`current_member_asset`)+`a`.`current_tob_asset`)) AS `account_total_asset`,(`c`.`net_profit`+(((`a`.`current_adv_asset`+`a`.`current_member_asset`)+`a`.`current_tob_asset`)-((`b`.`current_adv_asset`+`b`.`current_member_asset`)+`b`.`current_tob_asset`))) AS `account_net_profit` FROM ((((SELECT `tt`.`yearmonth` AS `yearmonth`,sum(`tt`.`current_adv_asset`) AS `current_adv_asset`,sum(`tt`.`current_member_asset`) AS `current_member_asset`,sum(`tt`.`current_tob_asset`) AS `current_tob_asset` FROM (SELECT `finebi_dashboard`.`idm_ar_indicators_i_m`.`yearmonth` AS `yearmonth`,`finebi_dashboard`.`idm_ar_indicators_i_m`.`amout` AS `current_adv_asset`,0 AS `current_member_asset`,0 AS `current_tob_asset` FROM `finebi_dashboard`.`idm_ar_indicators_i_m` WHERE (`finebi_dashboard`.`idm_ar_indicators_i_m`.`businesstype`='广告') UNION SELECT `finebi_dashboard`.`idm_ar_indicators_i_m`.`yearmonth` AS `yearmonth`,0 AS `current_adv_asset`,`finebi_dashboard`.`idm_ar_indicators_i_m`.`amout` AS `current_member_asset`,0 AS `current_tob_asset` FROM `finebi_dashboard`.`idm_ar_indicators_i_m` WHERE (`finebi_dashboard`.`idm_ar_indicators_i_m`.`businesstype`='会员') UNION SELECT `finebi_dashboard`.`idm_ar_indicators_i_m`.`yearmonth` AS `yearmonth`,0 AS `current_adv_asset`,0 AS `current_member_asset`,`finebi_dashboard`.`idm_ar_indicators_i_m`.`amout` AS `current_tob_asset` FROM `finebi_dashboard`.`idm_ar_indicators_i_m` WHERE (`finebi_dashboard`.`idm_ar_indicators_i_m`.`businesstype`='TOB')) `tt` GROUP BY `tt`.`yearmonth`)) `a` LEFT JOIN (SELECT `tt`.`yearmonth` AS `yearmonth`,sum(`tt`.`current_adv_asset`) AS `current_adv_asset`,sum(`tt`.`current_member_asset`) AS `current_member_asset`,sum(`tt`.`current_tob_asset`) AS `current_tob_asset` FROM (SELECT `finebi_dashboard`.`idm_ar_indicators_i_m`.`yearmonth` AS `yearmonth`,`finebi_dashboard`.`idm_ar_indicators_i_m`.`amout` AS `current_adv_asset`,0 AS `current_member_asset`,0 AS `current_tob_asset` FROM `finebi_dashboard`.`idm_ar_indicators_i_m` WHERE (`finebi_dashboard`.`idm_ar_indicators_i_m`.`businesstype`='广告') UNION SELECT `finebi_dashboard`.`idm_ar_indicators_i_m`.`yearmonth` AS `yearmonth`,0 AS `current_adv_asset`,`finebi_dashboard`.`idm_ar_indicators_i_m`.`amout` AS `current_member_asset`,0 AS `current_tob_asset` FROM `finebi_dashboard`.`idm_ar_indicators_i_m` WHERE (`finebi_dashboard`.`idm_ar_indicators_i_m`.`businesstype`='会员') UNION SELECT `finebi_dashboard`.`idm_ar_indicators_i_m`.`yearmonth` AS `yearmonth`,0 AS `current_adv_asset`,0 AS `current_member_asset`,`finebi_dashboard`.`idm_ar_indicators_i_m`.`amout` AS `current_tob_asset` FROM `finebi_dashboard`.`idm_ar_indicators_i_m` WHERE (`finebi_dashboard`.`idm_ar_indicators_i_m`.`businesstype`='TOB')) `tt` GROUP BY `tt`.`yearmonth`) `b` ON ((concat(cast((substr(`a`.`yearmonth`,1,4)-1) AS CHAR CHARSET utf8mb4),'-12')=`b`.`yearmonth`))) LEFT JOIN (SELECT `tt`.`period_name` AS `yearmonth`,(COALESCE (sum(`tt`.`net_profit`),0)/100000000) AS `net_profit`,(COALESCE (sum(`tt`.`net_asset`),0)/100000000) AS `net_asset` FROM (SELECT `t`.`period_name` AS `period_name`,0 AS `net_profit`,sum(`t`.`amount`) AS `net_asset` FROM (SELECT `finebi_dashboard`.`odm_fin_period_debts_iface`.`period_name` AS `period_name`,`finebi_dashboard`.`odm_fin_period_debts_iface`.`ytd_amount` AS `amount` FROM `finebi_dashboard`.`odm_fin_period_debts_iface` WHERE (`finebi_dashboard`.`odm_fin_period_debts_iface`.`report`='资产总计') UNION SELECT `finebi_dashboard`.`odm_fin_period_debts_iface`.`period_name` AS `period_name`,(-(1)*`finebi_dashboard`.`odm_fin_period_debts_iface`.`ytd_amount`) AS `amount` FROM `finebi_dashboard`.`odm_fin_period_debts_iface` WHERE (`finebi_dashboard`.`odm_fin_period_debts_iface`.`report`='负债合计')) `t` GROUP BY `t`.`period_name` UNION SELECT `finebi_dashboard`.`odm_fin_to_bud_income_itf`.`period_name` AS `period_name`,`finebi_dashboard`.`odm_fin_to_bud_income_itf`.`ytd_amount` AS `net_profit`,0 AS `net_asset` FROM `finebi_dashboard`.`odm_fin_to_bud_income_itf` WHERE (`finebi_dashboard`.`odm_fin_to_bud_income_itf`.`report`='四、净利润（净亏损以“-”号填列）')) `tt` GROUP BY `tt`.`period_name`) `c` ON ((`a`.`yearmonth`=CONVERT (`c`.`yearmonth` USING utf8mb4))));

5、数据更新时点

数据更新：每天6:30自动执行任务；


#### 9.6 数据验证结论

2024-12数据核对一致。

[图片占位：1 张，原 DOCX 内嵌图片未 OCR]

[图片占位：1 张，原 DOCX 内嵌图片未 OCR]


### 10.负反馈率

[图片占位：1 张，原 DOCX 内嵌图片未 OCR]


#### 10.1指标清单

<!-- table-56 -->
| 指标名称 | 统计维度 | 统计频率 | 数据来源方式 | 来源系统 | 系统表名 |
| --- | --- | --- | --- | --- | --- |
| 市场负反馈率 | 国内/国际 | 日/月 | 国内：系统取数 国际：手工上传 | 大数据中心 | 国内： 留存汇总数据：stg_appflyer_master_agg_retention 国际dau：stg_appflyer_master_agg_active 反馈数量表:nyt_feedback_data_monitor_final_1d 友盟日新增活跃：umeng_all 反馈词云图：zyx_feedback_tag_data_monitor 国际： BI获取国际化负反馈明细表，后续可统一切换为填报表 初始化表：odm_mk_inter_three_ends |
| 运营负反馈率 | 国内/国际 | 日/月 | 国内：系统取数 国际：手工上传 | 大数据中心 | 国内： 留存汇总数据：stg_appflyer_master_agg_retention 国际dau：stg_appflyer_master_agg_active 反馈数量表:nyt_feedback_data_monitor_final_1d 友盟日新增活跃：umeng_all 反馈词云图：zyx_feedback_tag_data_monitor 国际： BI获取国际化负反馈明细表，后续可统一切换为填报表 初始化表：odm_mk_inter_three_ends |
| 研发负反馈率 | 国内/国际 | 日/月 | 国内：系统取数 国际：手工上传 | 大数据中心 | 国内： 留存汇总数据：stg_appflyer_master_agg_retention 国际dau：stg_appflyer_master_agg_active 反馈数量表:nyt_feedback_data_monitor_final_1d 友盟日新增活跃：umeng_all 反馈词云图：zyx_feedback_tag_data_monitor 国际： BI获取国际化负反馈明细表，后续可统一切换为填报表 初始化表：odm_mk_inter_three_ends |
| 产品负反馈率 | 国内/国际 | 日/月 | 国内：系统取数 国际：手工上传 | 大数据中心 | 国内： 留存汇总数据：stg_appflyer_master_agg_retention 国际dau：stg_appflyer_master_agg_active 反馈数量表:nyt_feedback_data_monitor_final_1d 友盟日新增活跃：umeng_all 反馈词云图：zyx_feedback_tag_data_monitor 国际： BI获取国际化负反馈明细表，后续可统一切换为填报表 初始化表：odm_mk_inter_three_ends |
| 会员负反馈率 | 国内/国际 | 日/月 | 国内：系统取数 国际：手工上传 | 大数据中心 | 国内： 留存汇总数据：stg_appflyer_master_agg_retention 国际dau：stg_appflyer_master_agg_active 反馈数量表:nyt_feedback_data_monitor_final_1d 友盟日新增活跃：umeng_all 反馈词云图：zyx_feedback_tag_data_monitor 国际： BI获取国际化负反馈明细表，后续可统一切换为填报表 初始化表：odm_mk_inter_three_ends |
| 广告负反馈率 | 国内/国际 | 日/月 | 国内：系统取数 国际：手工上传 | 大数据中心 | 国内： 留存汇总数据：stg_appflyer_master_agg_retention 国际dau：stg_appflyer_master_agg_active 反馈数量表:nyt_feedback_data_monitor_final_1d 友盟日新增活跃：umeng_all 反馈词云图：zyx_feedback_tag_data_monitor 国际： BI获取国际化负反馈明细表，后续可统一切换为填报表 初始化表：odm_mk_inter_three_ends |
| 气象负反馈率 | 国内/国际 | 日/月 | 国内：系统取数 国际：手工上传 | 大数据中心 | 国内： 留存汇总数据：stg_appflyer_master_agg_retention 国际dau：stg_appflyer_master_agg_active 反馈数量表:nyt_feedback_data_monitor_final_1d 友盟日新增活跃：umeng_all 反馈词云图：zyx_feedback_tag_data_monitor 国际： BI获取国际化负反馈明细表，后续可统一切换为填报表 初始化表：odm_mk_inter_three_ends |
| 负反馈率 | 国内/国际 | 日/月 | 国内：系统取数 国际：手工上传 | 大数据中心 | 国内： 留存汇总数据：stg_appflyer_master_agg_retention 国际dau：stg_appflyer_master_agg_active 反馈数量表:nyt_feedback_data_monitor_final_1d 友盟日新增活跃：umeng_all 反馈词云图：zyx_feedback_tag_data_monitor 国际： BI获取国际化负反馈明细表，后续可统一切换为填报表 初始化表：odm_mk_inter_three_ends |


#### 10.2指标口径/计算规则

国内&国际二级/三级标签负反馈率：日：国内&国际当日的反馈数量除以当日的日活跃用户数，月：国内&国际当月的反馈数量除以当月的日活跃用户数（日均）。

国内&国际总负反馈率：日：国内&国际当日的反馈数量除以当日的日活跃用户数（去除双记【同一条反馈记录被分别记录到不同的反馈标签，汇总的时候只保留一条记录】），月：国内&国际当月的反馈数量除以当月的日活跃用户数（日均）（去除双记【同一条反馈记录被分别记录到不同的反馈标签，汇总的时候只保留一条记录】）。

国内气象负反馈和广告负反馈拆分：气象负反馈是填报表，广告负反馈直接从系统获取。


#### 10.3数据溯源

1、数据源


```sql
selectedDB
```
【数据中台】ireland-mrs-hive-172.16.18.253

【数据中台】mysql-tblu-motblro1-r-mjtab-s.sql.mojiweather.com

FineBI远程公共数据集：国际化负反馈明细表xlsx

国际dau历史数据【2025-07-25之前】odm_mk_inter_three_ends

2、数据源SQL逻辑

<!-- table-57 -->
| 序号 | 系统表名 | 溯源SQL |
| --- | --- | --- |
| 1 | 留存汇总数据：stg_appflyer_master_agg_retention | 整表同步 |
| 2 | 国际dau：stg_appflyer_master_agg_active | 整表同步 |
| 3 | 反馈数量表:nyt_feedback_data_monitor_final_1d | select `date`,`all_num`,`ad_num_bf`,`fufankui_num`,`tianqi_num`,`huiyuan_num_bf`,`weather_num`,`product_num`,`it_num`,`market_num`,`op_num`,`positive_num`,`consult_num`,`suggestion_num`,`huiyuan_num_ck`,`ad_num_ck`,`null_uv`,`huiyuan_num`,`ad_num`,`brand_new_num`,`stat_date` from hive.da_moji.nyt_feedback_data_monitor_final_1d |
| 4 | 友盟日新增活跃：umeng_all | 整表同步 |
| 5 | 反馈词云图：zyx_feedback_tag_data_monitor | select date,platform,name,total,primarytag,stat_date from hive.da_moji.zyx_feedback_tag_data_monitor where platform in ('Android主版','iPhone主版') |
| 6 | 广告反馈率拆分： hive.rpt.rpt_feed_ad_word_cloud | select stat_date, type, tag, sum(final_uv) as feed_uv from hive.rpt.rpt_feed_ad_word_cloud where tag <> 'NULL' group by stat_date, type, tag |


#### 10.4来源环境对比数据

国内二级反馈率

[图片占位：1 张，原 DOCX 内嵌图片未 OCR]

国内总负反馈率

[图片占位：1 张，原 DOCX 内嵌图片未 OCR]

国际反馈率

[图片占位：1 张，原 DOCX 内嵌图片未 OCR]


#### 10.5 FineDataLink数仓

1、ODM贴源层

<!-- table-58 -->
| 表名 | 描述 | 备注 |
| --- | --- | --- |
| odm_mk_stg_appflyer_master_agg_active_a_d | 国际dau |  |
| odm_mk_hive_da_moji_feedback_a_d | 反馈数量表 |  |
| odm_mk_tblu_umeng_new_active_a_d | 友盟日新增活跃 |  |
| odm_mk_zyx_feedback_tag_data_monitor_a_d | 反馈词云图 |  |
| odm_mk_inter_three_ends | 三端dau历史数据【2025-07-25之前】 |  |
| odm_mk_fine_bi_inter_three_ends | 国际化负反馈明细表 |  |
| odm_mk_stg_appflyer_master_agg_retention_a_d | 留存汇总数据 |  |
| odm_mk_meteorology_a_d | 气象反馈率填报 |  |
| odm_mk_advertisement_a_d | 广告反馈率 |  |

数据同步过程详见FineDataLink的【odm反馈率】任务。

2、IDM明细层/SDM汇总层

<!-- table-59 -->
| 表名 | 描述 | 备注 |
| --- | --- | --- |
| idm_mk_feedback_a_d | 反馈数量表 |  |
| idm_mk_umeng_new_active_a_d | 友盟日新增活跃 |  |
| idm_mk_zyx_feedback_tag_data_monitor_a_d | 反馈词云图 |  |
| idm_mk_inter_three_ends | 三端数据 dau+stg_appflyer_master_agg_active_a_d |  |
| idm_mk_inter_feedback_details | 国际反馈明细 |  |
| sdm_mk_dome_feedback_day_a_d | 国内日反馈率 |  |
| sdm_mk_dome_feedback_month_a_d | 国内月维度反馈率 |  |
| sdm_mk_inter_feedback_day_a_d | 国际反馈率日 |  |
| sdm_mk_inter_feedback_month_a_d | 国际反馈率月 |  |
| sdm_mk_dome_feadback_wac_day_a_d | 国内日反馈数量词云图 |  |
| sdm_mk_dome_feedback_wac_month_a_d | 国内月反馈数量词云图 |  |
| sdm_mk_inter_feedback_wac_day_a_d | 国际日反馈数量词云图 |  |
| sdm_mk_inter_feedback_wac_month_a_d | 国际月反馈数量词云图 |  |

数据同步过程详见FineDataLink的【idm反馈率】、【sdm反馈率】任务。

3、APP应用层

<!-- table-60 -->
| 表名 | 描述 | 备注 |
| --- | --- | --- |
| app_mk_dome_feedback_day_a_d | 国内日反馈率 |  |
| app_mk_dome_feedback_month_a_d | 国内月维度反馈率 |  |
| app_mk_inter_feedback_day_a_d | 国际反馈率日 |  |
| app_mk_inter_feedback_month_a_d | 国际反馈率月 |  |
| app_mk_dome_feadback_wac_day_a_d | 国内日反馈数量词云图 |  |
| app_mk_dome_feedback_wac_month_a_d | 国内月反馈数量词云图 |  |
| app_mk_inter_feedback_wac_day_a_d | 国际日反馈数量词云图 |  |
| app_mk_inter_feedback_wac_month_a_d | 国际月反馈数量词云图 |  |

数据同步过程详见FineDataLink的【app反馈率】任务。

4、填报数据存储库表

<!-- table-61 -->
| 数据名称 | 填报模版名称 | 数仓库表 | 备注 | 状态 |
| --- | --- | --- | --- | --- |
| 国际三端dau历史数据 |  | odm_mk_inter_three_ends | 2025-07-25之前 | 静态数据 |
| 国际反馈明细填报 |  | odm_mk_inter_feedback_details | 当天上传前一天的数据 | 动态数据 |
| 气象负反馈细分 | 气象负反馈细分 | odm_mk_advertisement_a_d | 每日上传 | 动态数据 |

数据更新时点及可查看的业务数据日期

数据更新结束时间：T+1上午十点可查看T+2的完整数据，T+1晚上九点可查看T+1的完整数据。


#### 10.6 数据验证结论

总负反馈验证

[图片占位：1 张，原 DOCX 内嵌图片未 OCR]

二级负反馈验证

[图片占位：1 张，原 DOCX 内嵌图片未 OCR]

三级标签负反馈验证

[图片占位：1 张，原 DOCX 内嵌图片未 OCR]


### 11.CLV

[图片占位：1 张，原 DOCX 内嵌图片未 OCR]


#### 11.1指标清单

<!-- table-62 -->
| 指标名称 | 统计维度 | 统计频率 | 数据来源方式 | 来源系统 | 系统表名 |
| --- | --- | --- | --- | --- | --- |
| 国际IOS厂商CLV |  | 日/月 | 系统取数 | selectedDB | 国内clv： 渠道id表： dim.dim_app_pid_info 单渠道新增留存： dm_user_register_traffic_scenario_retain_d 每日clv数据明细表： dm.dm_user_ltv_clv_i_d 国际clv： 国际化ROI-v1（天） 留存汇总数据： stg.stg_appflyer_master_agg_retention 国家维度表： dim.dim_country_info |
| 国际Android厂商CLV |  | 日/月 | 系统取数 | selectedDB | 国内clv： 渠道id表： dim.dim_app_pid_info 单渠道新增留存： dm_user_register_traffic_scenario_retain_d 每日clv数据明细表： dm.dm_user_ltv_clv_i_d 国际clv： 国际化ROI-v1（天） 留存汇总数据： stg.stg_appflyer_master_agg_retention 国家维度表： dim.dim_country_info |
| 国际手机厂商CLV |  | 日/月 | 系统取数 | selectedDB | 国内clv： 渠道id表： dim.dim_app_pid_info 单渠道新增留存： dm_user_register_traffic_scenario_retain_d 每日clv数据明细表： dm.dm_user_ltv_clv_i_d 国际clv： 国际化ROI-v1（天） 留存汇总数据： stg.stg_appflyer_master_agg_retention 国家维度表： dim.dim_country_info |
| 国际CLV |  | 日/月 | 系统取数 | selectedDB | 国内clv： 渠道id表： dim.dim_app_pid_info 单渠道新增留存： dm_user_register_traffic_scenario_retain_d 每日clv数据明细表： dm.dm_user_ltv_clv_i_d 国际clv： 国际化ROI-v1（天） 留存汇总数据： stg.stg_appflyer_master_agg_retention 国家维度表： dim.dim_country_info |
| iPhone厂商CLV |  | 日/月 | 系统取数 | selectedDB | 国内clv： 渠道id表： dim.dim_app_pid_info 单渠道新增留存： dm_user_register_traffic_scenario_retain_d 每日clv数据明细表： dm.dm_user_ltv_clv_i_d 国际clv： 国际化ROI-v1（天） 留存汇总数据： stg.stg_appflyer_master_agg_retention 国家维度表： dim.dim_country_info |
| 荣耀厂商CLV |  | 日/月 | 系统取数 | selectedDB | 国内clv： 渠道id表： dim.dim_app_pid_info 单渠道新增留存： dm_user_register_traffic_scenario_retain_d 每日clv数据明细表： dm.dm_user_ltv_clv_i_d 国际clv： 国际化ROI-v1（天） 留存汇总数据： stg.stg_appflyer_master_agg_retention 国家维度表： dim.dim_country_info |
| 其他新媒体CLV |  | 日/月 | 系统取数 | selectedDB | 国内clv： 渠道id表： dim.dim_app_pid_info 单渠道新增留存： dm_user_register_traffic_scenario_retain_d 每日clv数据明细表： dm.dm_user_ltv_clv_i_d 国际clv： 国际化ROI-v1（天） 留存汇总数据： stg.stg_appflyer_master_agg_retention 国家维度表： dim.dim_country_info |
| 网易新媒体CLV |  | 日/月 | 系统取数 | selectedDB | 国内clv： 渠道id表： dim.dim_app_pid_info 单渠道新增留存： dm_user_register_traffic_scenario_retain_d 每日clv数据明细表： dm.dm_user_ltv_clv_i_d 国际clv： 国际化ROI-v1（天） 留存汇总数据： stg.stg_appflyer_master_agg_retention 国家维度表： dim.dim_country_info |
| 百青藤新媒体CLV |  | 日/月 | 系统取数 | selectedDB | 国内clv： 渠道id表： dim.dim_app_pid_info 单渠道新增留存： dm_user_register_traffic_scenario_retain_d 每日clv数据明细表： dm.dm_user_ltv_clv_i_d 国际clv： 国际化ROI-v1（天） 留存汇总数据： stg.stg_appflyer_master_agg_retention 国家维度表： dim.dim_country_info |
| 百度SEM新媒体CLV |  | 日/月 | 系统取数 | selectedDB | 国内clv： 渠道id表： dim.dim_app_pid_info 单渠道新增留存： dm_user_register_traffic_scenario_retain_d 每日clv数据明细表： dm.dm_user_ltv_clv_i_d 国际clv： 国际化ROI-v1（天） 留存汇总数据： stg.stg_appflyer_master_agg_retention 国家维度表： dim.dim_country_info |
| 新媒体CLV |  | 日/月 | 系统取数 | selectedDB | 国内clv： 渠道id表： dim.dim_app_pid_info 单渠道新增留存： dm_user_register_traffic_scenario_retain_d 每日clv数据明细表： dm.dm_user_ltv_clv_i_d 国际clv： 国际化ROI-v1（天） 留存汇总数据： stg.stg_appflyer_master_agg_retention 国家维度表： dim.dim_country_info |
| 其他厂商CLV |  | 日/月 | 系统取数 | selectedDB | 国内clv： 渠道id表： dim.dim_app_pid_info 单渠道新增留存： dm_user_register_traffic_scenario_retain_d 每日clv数据明细表： dm.dm_user_ltv_clv_i_d 国际clv： 国际化ROI-v1（天） 留存汇总数据： stg.stg_appflyer_master_agg_retention 国家维度表： dim.dim_country_info |
| OPPO厂商CLV |  | 日/月 | 系统取数 | selectedDB | 国内clv： 渠道id表： dim.dim_app_pid_info 单渠道新增留存： dm_user_register_traffic_scenario_retain_d 每日clv数据明细表： dm.dm_user_ltv_clv_i_d 国际clv： 国际化ROI-v1（天） 留存汇总数据： stg.stg_appflyer_master_agg_retention 国家维度表： dim.dim_country_info |
| VIVO厂商CLV |  | 日/月 | 系统取数 | selectedDB | 国内clv： 渠道id表： dim.dim_app_pid_info 单渠道新增留存： dm_user_register_traffic_scenario_retain_d 每日clv数据明细表： dm.dm_user_ltv_clv_i_d 国际clv： 国际化ROI-v1（天） 留存汇总数据： stg.stg_appflyer_master_agg_retention 国家维度表： dim.dim_country_info |
| 华为厂商CLV |  | 日/月 | 系统取数 | selectedDB | 国内clv： 渠道id表： dim.dim_app_pid_info 单渠道新增留存： dm_user_register_traffic_scenario_retain_d 每日clv数据明细表： dm.dm_user_ltv_clv_i_d 国际clv： 国际化ROI-v1（天） 留存汇总数据： stg.stg_appflyer_master_agg_retention 国家维度表： dim.dim_country_info |
| 小米厂商CLV |  | 日/月 | 系统取数 | selectedDB | 国内clv： 渠道id表： dim.dim_app_pid_info 单渠道新增留存： dm_user_register_traffic_scenario_retain_d 每日clv数据明细表： dm.dm_user_ltv_clv_i_d 国际clv： 国际化ROI-v1（天） 留存汇总数据： stg.stg_appflyer_master_agg_retention 国家维度表： dim.dim_country_info |
| 手机厂商CLV |  | 日/月 | 系统取数 | selectedDB | 国内clv： 渠道id表： dim.dim_app_pid_info 单渠道新增留存： dm_user_register_traffic_scenario_retain_d 每日clv数据明细表： dm.dm_user_ltv_clv_i_d 国际clv： 国际化ROI-v1（天） 留存汇总数据： stg.stg_appflyer_master_agg_retention 国家维度表： dim.dim_country_info |
| 国内CLV |  | 日/月 | 系统取数 | selectedDB | 国内clv： 渠道id表： dim.dim_app_pid_info 单渠道新增留存： dm_user_register_traffic_scenario_retain_d 每日clv数据明细表： dm.dm_user_ltv_clv_i_d 国际clv： 国际化ROI-v1（天） 留存汇总数据： stg.stg_appflyer_master_agg_retention 国家维度表： dim.dim_country_info |
| 国际新增次日留存率 |  | 日/月 | 系统取数 | selectedDB | 国内clv： 渠道id表： dim.dim_app_pid_info 单渠道新增留存： dm_user_register_traffic_scenario_retain_d 每日clv数据明细表： dm.dm_user_ltv_clv_i_d 国际clv： 国际化ROI-v1（天） 留存汇总数据： stg.stg_appflyer_master_agg_retention 国家维度表： dim.dim_country_info |
| 国际IOS厂商 |  | 日/月 | 系统取数 | selectedDB | 国内clv： 渠道id表： dim.dim_app_pid_info 单渠道新增留存： dm_user_register_traffic_scenario_retain_d 每日clv数据明细表： dm.dm_user_ltv_clv_i_d 国际clv： 国际化ROI-v1（天） 留存汇总数据： stg.stg_appflyer_master_agg_retention 国家维度表： dim.dim_country_info |
| 国际Android厂商 |  | 日/月 | 系统取数 | selectedDB | 国内clv： 渠道id表： dim.dim_app_pid_info 单渠道新增留存： dm_user_register_traffic_scenario_retain_d 每日clv数据明细表： dm.dm_user_ltv_clv_i_d 国际clv： 国际化ROI-v1（天） 留存汇总数据： stg.stg_appflyer_master_agg_retention 国家维度表： dim.dim_country_info |
| 国际手机厂商 |  | 日/月 | 系统取数 | selectedDB | 国内clv： 渠道id表： dim.dim_app_pid_info 单渠道新增留存： dm_user_register_traffic_scenario_retain_d 每日clv数据明细表： dm.dm_user_ltv_clv_i_d 国际clv： 国际化ROI-v1（天） 留存汇总数据： stg.stg_appflyer_master_agg_retention 国家维度表： dim.dim_country_info |
| 国际新增用户 |  | 日/月 | 系统取数 | selectedDB | 国内clv： 渠道id表： dim.dim_app_pid_info 单渠道新增留存： dm_user_register_traffic_scenario_retain_d 每日clv数据明细表： dm.dm_user_ltv_clv_i_d 国际clv： 国际化ROI-v1（天） 留存汇总数据： stg.stg_appflyer_master_agg_retention 国家维度表： dim.dim_country_info |
| 国内新增次日留存率 |  | 日/月 | 系统取数 | selectedDB | 国内clv： 渠道id表： dim.dim_app_pid_info 单渠道新增留存： dm_user_register_traffic_scenario_retain_d 每日clv数据明细表： dm.dm_user_ltv_clv_i_d 国际clv： 国际化ROI-v1（天） 留存汇总数据： stg.stg_appflyer_master_agg_retention 国家维度表： dim.dim_country_info |
| iPhone厂商新增用户 |  | 日/月 | 系统取数 | selectedDB | 国内clv： 渠道id表： dim.dim_app_pid_info 单渠道新增留存： dm_user_register_traffic_scenario_retain_d 每日clv数据明细表： dm.dm_user_ltv_clv_i_d 国际clv： 国际化ROI-v1（天） 留存汇总数据： stg.stg_appflyer_master_agg_retention 国家维度表： dim.dim_country_info |
| 小米厂商新增用户 |  | 日/月 | 系统取数 | selectedDB | 国内clv： 渠道id表： dim.dim_app_pid_info 单渠道新增留存： dm_user_register_traffic_scenario_retain_d 每日clv数据明细表： dm.dm_user_ltv_clv_i_d 国际clv： 国际化ROI-v1（天） 留存汇总数据： stg.stg_appflyer_master_agg_retention 国家维度表： dim.dim_country_info |
| 其他新媒体 |  | 日/月 | 系统取数 | selectedDB | 国内clv： 渠道id表： dim.dim_app_pid_info 单渠道新增留存： dm_user_register_traffic_scenario_retain_d 每日clv数据明细表： dm.dm_user_ltv_clv_i_d 国际clv： 国际化ROI-v1（天） 留存汇总数据： stg.stg_appflyer_master_agg_retention 国家维度表： dim.dim_country_info |
| 网易新媒体 |  | 日/月 | 系统取数 | selectedDB | 国内clv： 渠道id表： dim.dim_app_pid_info 单渠道新增留存： dm_user_register_traffic_scenario_retain_d 每日clv数据明细表： dm.dm_user_ltv_clv_i_d 国际clv： 国际化ROI-v1（天） 留存汇总数据： stg.stg_appflyer_master_agg_retention 国家维度表： dim.dim_country_info |
| 百青藤新媒体 |  | 日/月 | 系统取数 | selectedDB | 国内clv： 渠道id表： dim.dim_app_pid_info 单渠道新增留存： dm_user_register_traffic_scenario_retain_d 每日clv数据明细表： dm.dm_user_ltv_clv_i_d 国际clv： 国际化ROI-v1（天） 留存汇总数据： stg.stg_appflyer_master_agg_retention 国家维度表： dim.dim_country_info |
| 百度SEM新媒体 |  | 日/月 | 系统取数 | selectedDB | 国内clv： 渠道id表： dim.dim_app_pid_info 单渠道新增留存： dm_user_register_traffic_scenario_retain_d 每日clv数据明细表： dm.dm_user_ltv_clv_i_d 国际clv： 国际化ROI-v1（天） 留存汇总数据： stg.stg_appflyer_master_agg_retention 国家维度表： dim.dim_country_info |
| 新媒体 |  | 日/月 | 系统取数 | selectedDB | 国内clv： 渠道id表： dim.dim_app_pid_info 单渠道新增留存： dm_user_register_traffic_scenario_retain_d 每日clv数据明细表： dm.dm_user_ltv_clv_i_d 国际clv： 国际化ROI-v1（天） 留存汇总数据： stg.stg_appflyer_master_agg_retention 国家维度表： dim.dim_country_info |
| 其他厂商新增用户 |  | 日/月 | 系统取数 | selectedDB | 国内clv： 渠道id表： dim.dim_app_pid_info 单渠道新增留存： dm_user_register_traffic_scenario_retain_d 每日clv数据明细表： dm.dm_user_ltv_clv_i_d 国际clv： 国际化ROI-v1（天） 留存汇总数据： stg.stg_appflyer_master_agg_retention 国家维度表： dim.dim_country_info |
| OPPO厂商新增用户 |  | 日/月 | 系统取数 | selectedDB | 国内clv： 渠道id表： dim.dim_app_pid_info 单渠道新增留存： dm_user_register_traffic_scenario_retain_d 每日clv数据明细表： dm.dm_user_ltv_clv_i_d 国际clv： 国际化ROI-v1（天） 留存汇总数据： stg.stg_appflyer_master_agg_retention 国家维度表： dim.dim_country_info |
| VIVO厂商新增用户 |  | 日/月 | 系统取数 | selectedDB | 国内clv： 渠道id表： dim.dim_app_pid_info 单渠道新增留存： dm_user_register_traffic_scenario_retain_d 每日clv数据明细表： dm.dm_user_ltv_clv_i_d 国际clv： 国际化ROI-v1（天） 留存汇总数据： stg.stg_appflyer_master_agg_retention 国家维度表： dim.dim_country_info |
| 华为厂商新增用户 |  | 日/月 | 系统取数 | selectedDB | 国内clv： 渠道id表： dim.dim_app_pid_info 单渠道新增留存： dm_user_register_traffic_scenario_retain_d 每日clv数据明细表： dm.dm_user_ltv_clv_i_d 国际clv： 国际化ROI-v1（天） 留存汇总数据： stg.stg_appflyer_master_agg_retention 国家维度表： dim.dim_country_info |
| 荣耀厂商新增用户 |  | 日/月 | 系统取数 | selectedDB | 国内clv： 渠道id表： dim.dim_app_pid_info 单渠道新增留存： dm_user_register_traffic_scenario_retain_d 每日clv数据明细表： dm.dm_user_ltv_clv_i_d 国际clv： 国际化ROI-v1（天） 留存汇总数据： stg.stg_appflyer_master_agg_retention 国家维度表： dim.dim_country_info |
| 手机厂商新增用户 |  | 日/月 | 系统取数 | selectedDB | 国内clv： 渠道id表： dim.dim_app_pid_info 单渠道新增留存： dm_user_register_traffic_scenario_retain_d 每日clv数据明细表： dm.dm_user_ltv_clv_i_d 国际clv： 国际化ROI-v1（天） 留存汇总数据： stg.stg_appflyer_master_agg_retention 国家维度表： dim.dim_country_info |
| 国内新增用户 |  | 日/月 | 系统取数 | selectedDB | 国内clv： 渠道id表： dim.dim_app_pid_info 单渠道新增留存： dm_user_register_traffic_scenario_retain_d 每日clv数据明细表： dm.dm_user_ltv_clv_i_d 国际clv： 国际化ROI-v1（天） 留存汇总数据： stg.stg_appflyer_master_agg_retention 国家维度表： dim.dim_country_info |
| 新增用户 |  | 日/月 | 系统取数 | selectedDB | 国内clv： 渠道id表： dim.dim_app_pid_info 单渠道新增留存： dm_user_register_traffic_scenario_retain_d 每日clv数据明细表： dm.dm_user_ltv_clv_i_d 国际clv： 国际化ROI-v1（天） 留存汇总数据： stg.stg_appflyer_master_agg_retention 国家维度表： dim.dim_country_info |


#### 11.2指标口径/计算规则

ClV：国内&国际CLV：日：国内&国际各渠道厂商的（LTV-CAC）* 新增用户数，月：国内&国际各渠道厂商的（月均LTV-CAC）* 新增用户数。

新增用户：国内&国际新增用户：日：国内&国际每天新增的用户数，月：国内&国际每月新增的用户数。

留存率：国内&国际留存率：国内&国际的活跃用户在次日仍启动该App的用户数占比。


#### 11.3数据溯源

1、数据源


```sql
selectedDB
```
FineBI远程公共数据集：国际化ROI-v1（天）

【数据中台】ireland-mrs-hive-172.16.18.253

2、数据源SQL逻辑

<!-- table-63 -->
**表格 63**

字段：序号 / 系统表名 / 溯源SQL

- 记录 1
  - 序号: 1
  - 系统表名: dm.dm_user_ltv_clv_i_d 计算每日国内clv
  - 溯源SQL:

```sql
SELECT a.stat_date, a.pkg, a.stat_name, a.channel_name, a.click_pid, a.user_type, a.register_month, a.dau_cnt, a.consumption_d, IF(a.consumption_m = 0, a.consumption_d, a.consumption_m) AS consumption_m, a.consumption_m AS consumption_m_real, a.month_life_time, a.default_arpu, a.final_arpu, IF(a.ltv IS NULL, b.ltv, a.ltv) AS ltv, IF(a.ltv IS NULL, (b.ltv * a.dau_cnt) - a.consumption_m, a.clv) AS clv
FROM FROM (
SELECT SELECT stat_date, pkg, stat_name, channel_name, click_pid, user_type, register_month, avg(cast(dau_cnt as DECIMAL(30,20))) AS dau_cnt, avg(cast(consumption_d as DECIMAL(30,20)) / 1.06) AS consumption_d, avg(cast(consumption_m as DECIMAL(30,20))) AS consumption_m, sum(cast(month_life_time as DECIMAL(30,20))) AS month_life_time, avg(cast(default_arpu as DECIMAL(30,20))) AS default_arpu, avg(cast(final_arpu as DECIMAL(30,20))) AS final_arpu, sum(cast(ltv as DECIMAL(30,20))) AS ltv, (sum(IF(ltv IS NULL, 0, cast(ltv as DECIMAL(30,20)))) * avg(cast(dau_cnt as DECIMAL(30,20)))) - avg(cast(consumption_m as DECIMAL(30,20))) AS clv
FROM FROM hive.dm.dm_user_ltv_clv_i_d
WHERE WHERE stat_date >= '2024-01-01'
AND AND stat_type = 'pid_name'
GROUP BY GROUP BY stat_date, pkg, stat_name, channel_name, click_pid, user_type, register_month ) a
LEFT JOIN LEFT
JOIN JOIN (
SELECT SELECT stat_date, pkg, user_type, register_month, avg(ltv) AS ltv
FROM FROM (
SELECT SELECT stat_date, pkg, stat_name, channel_name, click_pid, user_type, register_month, sum(cast(ltv as DECIMAL(30,20))) AS ltv
FROM FROM hive.dm.dm_user_ltv_clv_i_d
WHERE WHERE stat_date >= '2024-01-01'
AND AND stat_type = 'pid_name'
AND AND ltv IS NOT NULL
GROUP BY GROUP BY stat_date, pkg, stat_name, channel_name, click_pid, user_type, register_month ) t
WHERE WHERE t.ltv < 20
GROUP BY GROUP BY stat_date, pkg, user_type, register_month ) b ON a.pkg = b.pkg
AND AND a.user_type = b.user_type
AND AND a.stat_date = b.stat_date
```

- 记录 2
  - 序号: 2
  - 系统表名: dim.dim_app_pid_info clv渠道id
  - 溯源SQL:

```sql
select platform ,pkg ,pid ,pid_name ,pid_name_v ,pid_classify_1 ,pid_classify_2 ,type ,pid_new_date ,stat_date
from from hive.dim.dim_app_pid_info
where where stat_date = date_sub(current_date(),1)
group by group by platform ,pkg ,pid ,pid_name ,pid_name_v ,pid_classify_1 ,pid_classify_2 ,type ,pid_new_date ,stat_date
```

- 记录 3
  - 序号: 3
  - 系统表名: dm_user_register_traffic_scenario_retain_d 用户资产--单渠道新增留存
  - 溯源SQL:

```sql
SELECT stat_date, user_type, channel_name, sum(cast(IF(days = '0', new_user_cnt, 0) AS DOUBLE)) AS new_retain_0, sum(cast(IF(days = '1', new_user_cnt, 0) AS DOUBLE)) new_retain_1, sum(cast(IF(days = '7', new_user_cnt, 0) AS DOUBLE)) new_retain_7, sum(cast(IF(days = '14', new_user_cnt, 0) AS DOUBLE)) new_retain_14, sum(cast(IF(days = '30', new_user_cnt, 0) AS DOUBLE)) new_retain_30
FROM FROM hive.dm.dm_user_register_traffic_scenario_retain_d
WHERE WHERE cast(days AS BIGINT) IN (0, 1, 7, 14, 30) -- stat_date >= '2025-09-16' --
and and stat_date <= '2025-10-26' --
and and user_type != '自然新增'
GROUP BY GROUP BY stat_date, channel_name, user_type
```

- 记录 4
  - 序号: 4
  - 系统表名: 公共数据集：国际化ROI-v1（天） 计算每日国际clv
  - 溯源SQL: FineBI公共数据集同步

- 记录 5
  - 序号: 5
  - 系统表名: stg.stg_appflyer_master_agg_retention 2025-06-28之后的国际留存率
  - 溯源SQL:

```sql
select *
from from stg.stg_appflyer_master_agg_retention
```

- 记录 6
  - 序号: 6
  - 系统表名: dim.dim_country_info 英文简称国家对应表
  - 溯源SQL:

```sql
select country_ab,country_name_en,country_name_cn
from from dim.dim_country_info
group by group by country_ab,country_name_en,country_name_cn
```


#### 11.4来源环境对比数据

[图片占位：1 张，原 DOCX 内嵌图片未 OCR]


#### 11.5 FineDataLink数仓

1、ODM贴源层

<!-- table-64 -->
| 表名 | 描述 | 备注 |
| --- | --- | --- |
| odm_sm_dome_clv_a_d | 【每日国内clv数据明细表】dm.dm_user_ltv_clv_i_d |  |
| odm_sm_app_pid_info_a_d | 渠道id表 |  |
| odm_user_register_traffic_a_d | 单渠道新增留存 |  |
| odm_sm_inter_user_clv_a_d | 国际CLV | odm国际CLV任务 |
| odm_appflyer_master_a_d | 国际留存汇总数据 | odm国际CLV任务 |
| odm_country_info_a_d | 国家维度表 | odm国际CLV任务 |

数据同步过程详见FineDataLink的【odm国内CLV】、【odm国际CLV】任务。

2、IDM明细层/SDM汇总层

<!-- table-65 -->
| 表名 | 描述 | 备注 |
| --- | --- | --- |
| idm_sm_dome_clv_a_d | 国内clv明细数据表 |  |
| idm_sm_inter_clv_a_d | 国际clv明细数据表-日 |  |
| idm_sm_inter_clv_a_m | 国际clv明细数据表-月 |  |
| idm_sm_inter_clv_rate_a_d | 国际留存率 |  |
| idm_sm_inter_new_con_a_d | 首页国际化新增留存率 |  |
| sdm_sm_dome_clv_a_d | 国内clv-日 |  |
| sdm_sm_dome_clv_a_m | 国内clv-月 |  |
| sdm_sm_clv_a_d | clv-日 |  |
| sdm_sm_clv_a_m | clv-月 |  |
| sdm_sm_inter_clv_a_d | 国际clv相关指标-日 |  |
| sdm_sm_inter_clv_a_m | 国际clv相关指标-月 |  |
| sdm_sm_inter_clv_rate_a_d | 国际留存率-日 |  |
| sdm_sm_inter_clv_rate_a_m | 国际留存率-月 |  |
| sdm_sm_inter_clv_rate_ave_a_m | 国际留存率-月带同环比 |  |
| sdm_sm_inter_new_retention_a_d | 国际总留存-日 |  |
| sdm_sm_inter_new_retention_a_m | 国际总留存-月 |  |
| sdm_sm_inter_new_con_a_d | 各国家留存 |  |

数据同步过程详见FineDataLink的【idm国内CLV】、【sdm国内CLV】任务。

3、APP应用层

<!-- table-66 -->
| 表名 | 描述 | 备注 |
| --- | --- | --- |
| app_sm_dome_clv_a_m | 国内clv-月 |  |
| app_six_channel_arpu_a_m | 用户资产-六大渠道arpu-月 |  |
| app_channel_new_retain_a_d | 用户资产-各渠道留存-日 |  |
| app_sm_dome_clv_a_d | 国内clv-日 |  |
| app_sm_user_assets_clv_a_m | 用户资产-clv，ltv，cac，roi-月 |  |
| app_sm_user_assets_clv_a_d | 用户资产-clv，ltv，cac，roi-日 |  |
| app_dome_platform_daucnt_a_d | 各平台的新增用户走势分析 |  |
| app_sm_clv_a_d | 总clv页面使用-日 |  |
| app_sm_clv_a_m | 总clv页面使用-月 |  |
| app_sm_inter_clv_a_d | 国际clv相关指标-日 |  |
| app_sm_inter_clv_a_m | 国际clv相关指标-月 |  |
| app_sm_clv_user_type_a_d | 区分用户类型-clv-日 |  |
| app_sm_clv_user_type_a_m | 区分用户类型-clv-月 |  |
| app_sm_inter_new_retention_a_d | 国际总次留同环比-日 |  |
| app_sm_inter_new_retention_a_m | 国际总次留同环比-月 |  |

数据同步过程详见FineDataLink的【app国内CLV】任务。

4、填报数据存储库表

<!-- table-67 -->
| 数据名称 | 填报模版名称 | 数仓库表 | 备注 | 状态 |
| --- | --- | --- | --- | --- |
| 国际留存补充数据 |  | odm_sm_abnormal_data_a_d | 2025-01-08,2025-01-09,2025-02-08,2025-02-09,2025-02-10的数据补充 | 静态数据 |
| 国际留存历史数据 |  | odm_sm_three_ends_etention_a_d | 2025-06-28之前的数据 | 静态数据 |
| 国家对应名称关系 |  | odm_af_country | 补充数据，获取国家对应名称关系 | 静态数据 |

5、数据更新时点及可查看的业务数据日期

数据更新结束时间：T+2晚上九点可查看T+2的完整数据。


#### 11.6 数据验证结论

国内clv

[图片占位：1 张，原 DOCX 内嵌图片未 OCR]

国内各手机厂商&新媒体clv

[图片占位：1 张，原 DOCX 内嵌图片未 OCR]

国内新增用户

[图片占位：1 张，原 DOCX 内嵌图片未 OCR]

国内各手机厂商&新媒体新增用户

[图片占位：1 张，原 DOCX 内嵌图片未 OCR]

国内新增次日留存率

[图片占位：1 张，原 DOCX 内嵌图片未 OCR]

国际新增次日留存率

[图片占位：1 张，原 DOCX 内嵌图片未 OCR]

国际clv

[图片占位：1 张，原 DOCX 内嵌图片未 OCR]

安卓&ios端clv

[图片占位：1 张，原 DOCX 内嵌图片未 OCR]


### 12.CLV-国内

[图片占位：1 张，原 DOCX 内嵌图片未 OCR]


#### 12.1指标清单

<!-- table-68 -->
| 指标名称 | 统计维度 | 统计频率 | 数据来源方式 | 来源系统 | 系统表名 |
| --- | --- | --- | --- | --- | --- |
| 新增7日留存率 | 国内 | 日/月 | 系统取数 | 大数据中心 | 渠道id表： dim.dim_app_pid_info 单渠道新增留存： dm_user_register_traffic_scenario_retain_d 每日clv数据明细表： dm.dm_user_ltv_clv_i_d |
| 新增3日留存率 | 国内 | 日/月 | 系统取数 | 大数据中心 | 渠道id表： dim.dim_app_pid_info 单渠道新增留存： dm_user_register_traffic_scenario_retain_d 每日clv数据明细表： dm.dm_user_ltv_clv_i_d |
| 新增次日留存率 | 国内 | 日/月 | 系统取数 | 大数据中心 | 渠道id表： dim.dim_app_pid_info 单渠道新增留存： dm_user_register_traffic_scenario_retain_d 每日clv数据明细表： dm.dm_user_ltv_clv_i_d |
| 单渠道CLV | 国内 | 日/月 | 系统取数 | 大数据中心 | 渠道id表： dim.dim_app_pid_info 单渠道新增留存： dm_user_register_traffic_scenario_retain_d 每日clv数据明细表： dm.dm_user_ltv_clv_i_d |
| 广告ARPU | 国内 | 日/月 | 系统取数 | 大数据中心 | 渠道id表： dim.dim_app_pid_info 单渠道新增留存： dm_user_register_traffic_scenario_retain_d 每日clv数据明细表： dm.dm_user_ltv_clv_i_d |
| 广告LT | 国内 | 日/月 | 系统取数 | 大数据中心 | 渠道id表： dim.dim_app_pid_info 单渠道新增留存： dm_user_register_traffic_scenario_retain_d 每日clv数据明细表： dm.dm_user_ltv_clv_i_d |
| 消耗 | 国内 | 日/月 | 系统取数 | 大数据中心 | 渠道id表： dim.dim_app_pid_info 单渠道新增留存： dm_user_register_traffic_scenario_retain_d 每日clv数据明细表： dm.dm_user_ltv_clv_i_d |
| CAC | 国内 | 日/月 | 系统取数 | 大数据中心 | 渠道id表： dim.dim_app_pid_info 单渠道新增留存： dm_user_register_traffic_scenario_retain_d 每日clv数据明细表： dm.dm_user_ltv_clv_i_d |
| LTV | 国内 | 日/月 | 系统取数 | 大数据中心 | 渠道id表： dim.dim_app_pid_info 单渠道新增留存： dm_user_register_traffic_scenario_retain_d 每日clv数据明细表： dm.dm_user_ltv_clv_i_d |
| 新增用户 | 国内 | 日/月 | 系统取数 | 大数据中心 | 渠道id表： dim.dim_app_pid_info 单渠道新增留存： dm_user_register_traffic_scenario_retain_d 每日clv数据明细表： dm.dm_user_ltv_clv_i_d |
| 总CLV | 国内 | 日/月 | 系统取数 | 大数据中心 | 渠道id表： dim.dim_app_pid_info 单渠道新增留存： dm_user_register_traffic_scenario_retain_d 每日clv数据明细表： dm.dm_user_ltv_clv_i_d |


#### 12.2指标口径/计算规则

总CLV

日：当日所有渠道CLV总和，月：当月所有渠道CLV总和。

新增用户

日：当日该渠道的新增用户人数，月：当月该渠道的新增用户人数。

消耗

日：当日新增用户花费的金额，月：当月新增用户花费的金额。

CAC：用户获取成本，计算公式：日：当日消耗/当日新增用户，月：当月消耗/当月新增用户。

广告ARPU：单用户平均收入，计算公式：日：收入/广告当日新增用户，月：日均广告ARPU，当月广告ARPU汇总/天数，计算日均值。

LTV：单个用户从注册到流失为墨迹天气贡献的总收入，计算公式：日：当日单个用户总收入，月：日均LTV，当月LTV汇总/天数，计算日均值。

广告LT：用户生命周期，计算公式：日：当日LTV /当日广告ARPU，月：日均LTV /日均广告ARPU。

单渠道CLV：单渠道的客户终身价值，日：当日新增用户*（当日LTV -当日CAC），月：当月新增用户*（日均LTV -当月CAC）。


#### 12.3数据溯源

1、数据源


```sql
selectedDB
```
FineBI远程公共数据集：国际化ROI-v1（天）

2、数据源SQL逻辑

<!-- table-69 -->
**表格 69**

字段：序号 / 系统表名 / 溯源SQL

- 记录 1
  - 序号: 1
  - 系统表名: dm.dm_user_ltv_clv_i_d 计算每日国内clv
  - 溯源SQL:

```sql
SELECT a.stat_date,a.pkg,a.stat_name,a.channel_name,a.click_pid,a.user_type,a.register_month,a.dau_cnt,a.consumption_d,IF (a.consumption_m=0,a.consumption_d,a.consumption_m) AS consumption_m,a.consumption_m AS consumption_m_real,a.month_life_time,a.default_arpu,a.final_arpu,IF (a.ltv IS NULL,b.ltv,a.ltv) AS ltv,IF (a.ltv IS NULL,(b.ltv*a.dau_cnt)-a.consumption_m,a.clv) AS clv
FROM FROM (
SELECT SELECT stat_date,pkg,stat_name,channel_name,click_pid,user_type,register_month,avg(cast(dau_cnt AS DECIMAL (30,20))) AS dau_cnt,avg(cast(consumption_d AS DECIMAL (30,20))/1.06) AS consumption_d,avg(cast(consumption_m AS DECIMAL (30,20))) AS consumption_m,sum(cast(month_life_time AS DECIMAL (30,20))) AS month_life_time,avg(cast(default_arpu AS DECIMAL (30,20))) AS default_arpu,avg(cast(final_arpu AS DECIMAL (30,20))) AS final_arpu,sum(cast(ltv AS DECIMAL (30,20))) AS ltv,(sum(IF (ltv IS NULL,0,cast(ltv AS DECIMAL (30,20))))*avg(cast(dau_cnt AS DECIMAL (30,20))))-avg(cast(consumption_m AS DECIMAL (30,20))) AS clv
FROM FROM hive.dm.dm_user_ltv_clv_i_d
WHERE WHERE stat_date>='2024-01-01'
AND AND stat_type='pid_name'
GROUP BY GROUP BY stat_date,pkg,stat_name,channel_name,click_pid,user_type,register_month) a
LEFT JOIN LEFT
JOIN JOIN (
SELECT SELECT stat_date,pkg,user_type,register_month,avg(ltv) AS ltv
FROM FROM (
SELECT SELECT stat_date,pkg,stat_name,channel_name,click_pid,user_type,register_month,sum(cast(ltv AS DECIMAL (30,20))) AS ltv
FROM FROM hive.dm.dm_user_ltv_clv_i_d
WHERE WHERE stat_date>='2024-01-01'
AND AND stat_type='pid_name'
AND AND ltv IS NOT NULL
GROUP BY GROUP BY stat_date,pkg,stat_name,channel_name,click_pid,user_type,register_month) t
WHERE WHERE t.ltv< 20
GROUP BY GROUP BY stat_date,pkg,user_type,register_month) b ON a.pkg=b.pkg
AND AND a.user_type=b.user_type
AND AND a.stat_date=b.stat_date
```

- 记录 2
  - 序号: 2
  - 系统表名: dim.dim_app_pid_info clv渠道id
  - 溯源SQL:

```sql
SELECT platform,pkg,pid,pid_name,pid_name_v,pid_classify_1,pid_classify_2,type,pid_new_date,stat_date
FROM FROM hive.dim.dim_app_pid_info
WHERE WHERE stat_date=date_sub(CURRENT_DATE (),1)
GROUP BY GROUP BY platform,pkg,pid,pid_name,pid_name_v,pid_classify_1,pid_classify_2,type,pid_new_date,stat_date
```

- 记录 3
  - 序号: 3
  - 系统表名: dm_user_register_traffic_scenario_retain_d 用户资产--单渠道新增留存
  - 溯源SQL:

```sql
SELECT stat_date,user_type,channel_name,sum(cast(IF (days='0',new_user_cnt,0) AS DOUBLE)) AS new_retain_0,sum(cast(IF (days='1',new_user_cnt,0) AS DOUBLE)) new_retain_1,sum(cast(IF (days='7',new_user_cnt,0) AS DOUBLE)) new_retain_7,sum(cast(IF (days='14',new_user_cnt,0) AS DOUBLE)) new_retain_14,sum(cast(IF (days='30',new_user_cnt,0) AS DOUBLE)) new_retain_30
FROM FROM hive.dm.dm_user_register_traffic_scenario_retain_d
WHERE WHERE cast(days AS BIGINT) IN (0,1,7,14,30)-- stat_date >= '2025-09-16' --
and and stat_date <= '2025-10-26' --
and and user_type != '自然新增'
GROUP BY GROUP BY stat_date,channel_name,user_type
```


#### 12.4来源环境对比数据

[图片占位：1 张，原 DOCX 内嵌图片未 OCR]


#### 12.5 FineDataLink数仓

1、ODM贴源层

<!-- table-70 -->
| 表名 | 描述 | 备注 |
| --- | --- | --- |
| odm_sm_dome_clv_a_d | 【每日国内clv数据明细表】dm.dm_user_ltv_clv_i_d |  |
| odm_sm_app_pid_info_a_d | 渠道id表 |  |
| odm_user_register_traffic_a_d | 单渠道新增留存 |  |

数据同步过程详见FineDataLink的【odm国内CLV】任务。

2、IDM明细层/SDM汇总层

<!-- table-71 -->
| 表名 | 描述 | 备注 |
| --- | --- | --- |
| idm_sm_dome_clv_a_d | 国内clv明细数据表 |  |
| sdm_sm_dome_clv_a_d | 国内clv-日 |  |
| sdm_sm_dome_clv_a_m | 国内clv-月 |  |
| sdm_sm_clv_a_d | clv-日 | 总clv页面使用 |
| sdm_sm_clv_a_m | clv-月 | 总clv页面使用 |

数据同步过程详见FineDataLink的【idm国内CLV】、【sdm国内CLV】任务。

3、APP应用层

<!-- table-72 -->
| 表名 | 描述 | 备注 |
| --- | --- | --- |
| app_sm_dome_clv_a_m | 国内clv-月 |  |
| app_six_channel_arpu_a_m | 用户资产-六大渠道arpu-月 |  |
| app_channel_new_retain_a_d | 用户资产-各渠道留存-日 |  |
| app_sm_dome_clv_a_d | 国内clv-日 |  |
| app_sm_user_assets_clv_a_m | 用户资产-clv，ltv，cac，roi-月 |  |
| app_sm_user_assets_clv_a_d | 用户资产-clv，ltv，cac，roi-日 |  |
| app_dome_platform_daucnt_a_d | 各平台的新增用户走势分析 |  |
| app_sm_clv_a_d | 总clv页面使用-日 |  |
| app_sm_clv_a_m | 总clv页面使用-月 |  |
| app_sm_clv_user_type_a_d | 区分用户类型-clv-日 |  |
| app_sm_clv_user_type_a_m | 区分用户类型-clv-月 |  |

数据同步过程详见FineDataLink的【app国内CLV】任务。

4、数据更新时点及可查看的业务数据日期

数据更新结束时间：T+2晚上九点可查看T+2的完整数据。


#### 12.6 数据验证结论

国内clv

[图片占位：1 张，原 DOCX 内嵌图片未 OCR]

国内新增留存率

[图片占位：1 张，原 DOCX 内嵌图片未 OCR]


### 13.CLV-国际

[图片占位：1 张，原 DOCX 内嵌图片未 OCR]


#### 13.1指标清单

<!-- table-73 -->
| 指标名称 | 统计维度 | 统计频率 | 数据来源方式 | 来源系统 | 系统表名 |
| --- | --- | --- | --- | --- | --- |
| 国际总CLV | 国际 | 日/月 | 系统取数 | 大数据中心 | 国际化ROI-v1（天） 留存汇总数据： stg.stg_appflyer_master_agg_retention 国家维度表： dim.dim_country_info |
| 新增用户_国际 | 国际 | 日/月 | 系统取数 | 大数据中心 | 国际化ROI-v1（天） 留存汇总数据： stg.stg_appflyer_master_agg_retention 国家维度表： dim.dim_country_info |
| LTV_国际 | 国际 | 日/月 | 系统取数 | 大数据中心 | 国际化ROI-v1（天） 留存汇总数据： stg.stg_appflyer_master_agg_retention 国家维度表： dim.dim_country_info |
| CAC_国际 | 国际 | 日/月 | 系统取数 | 大数据中心 | 国际化ROI-v1（天） 留存汇总数据： stg.stg_appflyer_master_agg_retention 国家维度表： dim.dim_country_info |
| 消耗_国际 | 国际 | 日/月 | 系统取数 | 大数据中心 | 国际化ROI-v1（天） 留存汇总数据： stg.stg_appflyer_master_agg_retention 国家维度表： dim.dim_country_info |
| 会员LTV_国际 | 国际 | 日/月 | 系统取数 | 大数据中心 | 国际化ROI-v1（天） 留存汇总数据： stg.stg_appflyer_master_agg_retention 国家维度表： dim.dim_country_info |
| 会员LT_国际 | 国际 | 日/月 | 系统取数 | 大数据中心 | 国际化ROI-v1（天） 留存汇总数据： stg.stg_appflyer_master_agg_retention 国家维度表： dim.dim_country_info |
| 会员ARPU_国际 | 国际 | 日/月 | 系统取数 | 大数据中心 | 国际化ROI-v1（天） 留存汇总数据： stg.stg_appflyer_master_agg_retention 国家维度表： dim.dim_country_info |
| 新增用户会员流水_国际 | 国际 | 日/月 | 系统取数 | 大数据中心 | 国际化ROI-v1（天） 留存汇总数据： stg.stg_appflyer_master_agg_retention 国家维度表： dim.dim_country_info |
| 新增会员数_国际 | 国际 | 日/月 | 系统取数 | 大数据中心 | 国际化ROI-v1（天） 留存汇总数据： stg.stg_appflyer_master_agg_retention 国家维度表： dim.dim_country_info |
| 广告LTV_国际 | 国际 | 日/月 | 系统取数 | 大数据中心 | 国际化ROI-v1（天） 留存汇总数据： stg.stg_appflyer_master_agg_retention 国家维度表： dim.dim_country_info |
| 广告LT_国际 | 国际 | 日/月 | 系统取数 | 大数据中心 | 国际化ROI-v1（天） 留存汇总数据： stg.stg_appflyer_master_agg_retention 国家维度表： dim.dim_country_info |
| 广告ARPU_国际 | 国际 | 日/月 | 系统取数 | 大数据中心 | 国际化ROI-v1（天） 留存汇总数据： stg.stg_appflyer_master_agg_retention 国家维度表： dim.dim_country_info |
| 新增用户广告收入_国际 | 国际 | 日/月 | 系统取数 | 大数据中心 | 国际化ROI-v1（天） 留存汇总数据： stg.stg_appflyer_master_agg_retention 国家维度表： dim.dim_country_info |
| DAU(剔除3天新用户)_国际 | 国际 | 日/月 | 系统取数 | 大数据中心 | 国际化ROI-v1（天） 留存汇总数据： stg.stg_appflyer_master_agg_retention 国家维度表： dim.dim_country_info |
| 会员ROI | 国际 | 日/月 | 系统取数 | 大数据中心 | 国际化ROI-v1（天） 留存汇总数据： stg.stg_appflyer_master_agg_retention 国家维度表： dim.dim_country_info |
| 广告ROI | 国际 | 日/月 | 系统取数 | 大数据中心 | 国际化ROI-v1（天） 留存汇总数据： stg.stg_appflyer_master_agg_retention 国家维度表： dim.dim_country_info |
| 新增次日留存率_国际 | 国际 | 日/月 | 系统取数 | 大数据中心 | 国际化ROI-v1（天） 留存汇总数据： stg.stg_appflyer_master_agg_retention 国家维度表： dim.dim_country_info |
| 新增7日留存率_国际 | 国际 | 日/月 | 系统取数 | 大数据中心 | 国际化ROI-v1（天） 留存汇总数据： stg.stg_appflyer_master_agg_retention 国家维度表： dim.dim_country_info |
| 新增14日留存率_国际 | 国际 | 日/月 | 系统取数 | 大数据中心 | 国际化ROI-v1（天） 留存汇总数据： stg.stg_appflyer_master_agg_retention 国家维度表： dim.dim_country_info |
| 新增30日留存率_国际 | 国际 | 日/月 | 系统取数 | 大数据中心 | 国际化ROI-v1（天） 留存汇总数据： stg.stg_appflyer_master_agg_retention 国家维度表： dim.dim_country_info |


#### 13.2指标口径/计算规则

国际总CLV=国际手机厂商CLV+国际新媒体CLV，日：当日所有渠道CLV总和，月：当月所有渠道CLV总和。

CLV：国际分端-国家的客户终身价值，日：当日新增用户*（当日LTV-CAC），月：按日汇总。

新增用户：首次使用或注册的国际用户数量，日：当日新增的用户数量，月：按日汇总。

LTV：国际用户生命周期价值，单个用户从注册到流失为墨迹天气贡献的总收入，日：会员LTV+广告LTV，月：月平均会员LTV+月平均广告LTV。

CAC：国际用户获取成本，日：当日消耗/当日新增用户，月：当月消耗/当月新增用户。

消耗：新增国际用户花费的金额，日：当日消耗汇总，月：当月消耗汇总。

会员LTV：国际用户的会员生命周期价值，日：当日会员LT*当日会员ARPU，月：月平均会员LTV。

广告LTV：国际市场中广告业务的用户生命周期价值，日：当日广告LT*广告ARPU，月：月平均广告LTV。

会员LT：统计国际市场中会员用户从首次接触产品到彻底流失的日均时长，日:固定值1.94，月：固定值1.94。

会员ARPU：单用户平均会员收入，日：当日会员流水/当日新增用户数，月：当月会员流水/当月新增用户数。

广告LT：统计国际市场中广告业务用户从首次接触产品到彻底流失的日均时长，日：当日LT汇总，月：月平均广告LTV。

广告ARPU：单用户平均广告收入，日：当日广告收入/当日DAU（剔除三天新用户），月：当月广告收入汇总/当月DAU（剔除三天新用户）汇总。

会员流水：统计国际市场当日新增用户产生的会员收入总和，日：当日会员流水汇总，月：当月会员流水汇总。

广告收入：国际市场当日新增用户产生的广告收入总和，日：当日广告收入汇总，月：当月广告收入汇总。

DAU（踢出三天新增用户）：国际市场当日排除注册时间≤3 天的新用户后，活跃的独立用户数，日：当日DAU汇总，月：当月DAU汇总。

会员ROI：会员业务的投资回报率，日：当日会员LTV/当日CAC，月：当月平均会员LTV/当月CAC。

广告ROI：广告业务的投资回报率，日：当日广告LTV/当日CAC，月：当月平均广告LTV/当月CAC。

新增次日留存率：新增用户在次日仍启动该App的用户数占比。

新增7日留存率：新增用户在第7日仍启动该App的用户数占比。

新增14日留存率：新增用户在第14日仍启动该App的用户数占比。

新增30日留存率：新增用户在第30日仍启动该App的用户数占比。


#### 13.3数据溯源

1、数据源

FineBI远程公共数据集：国际化ROI-v1（天）

2、数据源SQL逻辑

<!-- table-74 -->
| 序号 | 系统表名 | 溯源SQL |
| --- | --- | --- |
| 1 | 国际化ROI-v1（天） | 整表同步 |


#### 13.4来源环境对比数据

[图片占位：1 张，原 DOCX 内嵌图片未 OCR]


#### 13.5 FineDataLink数仓

1、ODM贴源层

<!-- table-75 -->
| 表名 | 描述 | 备注 |
| --- | --- | --- |
| odm_sm_inter_user_clv_a_d | 国际CLV明细数据 |  |
| odm_appflyer_master_a_d | 留存汇总数据 |  |
| odm_country_info_a_d | 国家维度表 |  |

数据同步过程详见FineDataLink的【odm国际CLV】任务。

2、IDM明细层/SDM汇总层

<!-- table-76 -->
| 表名 | 描述 | 备注 |
| --- | --- | --- |
| idm_sm_inter_clv_a_d | 国际clv-日 |  |
| idm_sm_inter_clv_a_m | 国际clv-月 |  |
| idm_sm_inter_clv_rate_a_d | CLV国际留存率 |  |
| idm_sm_inter_new_con_a_d | 业务首页国际化新增留存率 |  |
| sdm_sm_inter_clv_a_d | 国际clv-日 |  |
| sdm_sm_inter_clv_a_m | 国际clv-月 |  |
| sdm_sm_inter_clv_rate_a_d | 国际留存率-日 |  |
| sdm_sm_inter_clv_rate_a_m | 国际留存率-日均 |  |
| sdm_sm_inter_clv_rate_ave_a_m | 国际留存率-月 |  |
| sdm_sm_inter_new_retention_a_d | 总clv页面使用 |  |
| sdm_sm_inter_new_retention_a_m | 总clv页面使用 |  |
| sdm_sm_inter_new_con_a_d | 业务首页国际化新增留存率 |  |

数据同步过程详见FineDataLink的【idm国际CLV】、【sdm国际CLV】任务。

3、APP应用层

<!-- table-77 -->
| 表名 | 描述 | 备注 |
| --- | --- | --- |
| app_sm_inter_clv_a_d | 国际clv相关指标-日 |  |
| app_sm_inter_clv_a_m | 国际clv相关指标-月 |  |
| app_sm_clv_user_type_a_d | 国际clv区分用户类型-日 |  |
| app_sm_clv_user_type_a_m | 国际clv区分用户类型-月 |  |
| app_sm_inter_new_retention_a_d | 国际总次留同环比-日 |  |
| app_sm_inter_new_retention_a_m | 国际总次留同环比-月 |  |

数据同步过程详见FineDataLink的【app国际CLV】任务。

4、数据更新时点及可查看的业务数据日期

数据更新结束时间：T+1上午十点可查看T+2的完整数据，T+1晚上九点可查看T+1的完整数据。


#### 13.6 数据验证结论

[图片占位：1 张，原 DOCX 内嵌图片未 OCR]

[图片占位：1 张，原 DOCX 内嵌图片未 OCR]


### 14.DAU

[图片占位：2 张，原 DOCX 内嵌图片未 OCR]


#### 14.1指标清单

<!-- table-78 -->
| 指标名称 | 统计维度 | 统计频率 | 数据来源方式 | 来源系统 | 系统表名 |
| --- | --- | --- | --- | --- | --- |
| 活跃次日留存率 | 国际/国内 | 日/月 | 系统取数 | 大数据中心 | rpt.rpt_app_aty_basic_1d_d rpt.rpt_app_basic_1d_d sdm.sdm_app_act_1d_d dw.dw_flow_app_pkg_cm_m sdm.sdm_app_act_1m_m rpt.rpt_app_aty_retain_1d_d sdm.sdm_app_aty_retain_1d_d |
| 人均打开次数 | 国际/国内 | 日/月 | 系统取数 | 大数据中心 | rpt.rpt_app_aty_basic_1d_d rpt.rpt_app_basic_1d_d sdm.sdm_app_act_1d_d dw.dw_flow_app_pkg_cm_m sdm.sdm_app_act_1m_m rpt.rpt_app_aty_retain_1d_d sdm.sdm_app_aty_retain_1d_d |
| DAU | 国际/国内 | 日/月 | 系统取数 | 大数据中心 | rpt.rpt_app_aty_basic_1d_d rpt.rpt_app_basic_1d_d sdm.sdm_app_act_1d_d dw.dw_flow_app_pkg_cm_m sdm.sdm_app_act_1m_m rpt.rpt_app_aty_retain_1d_d sdm.sdm_app_aty_retain_1d_d |
| Android端DAU | 国际/国内 | 日/月 | 系统取数 | 大数据中心 | rpt.rpt_app_aty_basic_1d_d rpt.rpt_app_basic_1d_d sdm.sdm_app_act_1d_d dw.dw_flow_app_pkg_cm_m sdm.sdm_app_act_1m_m rpt.rpt_app_aty_retain_1d_d sdm.sdm_app_aty_retain_1d_d |
| IOS端DAU | 国际/国内 | 日/月 | 系统取数 | 大数据中心 | rpt.rpt_app_aty_basic_1d_d rpt.rpt_app_basic_1d_d sdm.sdm_app_act_1d_d dw.dw_flow_app_pkg_cm_m sdm.sdm_app_act_1m_m rpt.rpt_app_aty_retain_1d_d sdm.sdm_app_aty_retain_1d_d |
| HarmonyOS端DAU | 国内 | 日/月 | 系统取数 | 大数据中心 | rpt.rpt_app_aty_basic_1d_d rpt.rpt_app_basic_1d_d sdm.sdm_app_act_1d_d dw.dw_flow_app_pkg_cm_m sdm.sdm_app_act_1m_m rpt.rpt_app_aty_retain_1d_d sdm.sdm_app_aty_retain_1d_d |
| Android端TOP1 | 国际/国内 | 日/月 | 系统取数 | 大数据中心 | rpt.rpt_app_aty_basic_1d_d rpt.rpt_app_basic_1d_d sdm.sdm_app_act_1d_d dw.dw_flow_app_pkg_cm_m sdm.sdm_app_act_1m_m rpt.rpt_app_aty_retain_1d_d sdm.sdm_app_aty_retain_1d_d |
| Android端TOP2 | 国际/国内 | 日/月 | 系统取数 | 大数据中心 | rpt.rpt_app_aty_basic_1d_d rpt.rpt_app_basic_1d_d sdm.sdm_app_act_1d_d dw.dw_flow_app_pkg_cm_m sdm.sdm_app_act_1m_m rpt.rpt_app_aty_retain_1d_d sdm.sdm_app_aty_retain_1d_d |
| Android端TOP3 | 国际/国内 | 日/月 | 系统取数 | 大数据中心 | rpt.rpt_app_aty_basic_1d_d rpt.rpt_app_basic_1d_d sdm.sdm_app_act_1d_d dw.dw_flow_app_pkg_cm_m sdm.sdm_app_act_1m_m rpt.rpt_app_aty_retain_1d_d sdm.sdm_app_aty_retain_1d_d |
| Android端其他 | 国际/国内 | 日/月 | 系统取数 | 大数据中心 | rpt.rpt_app_aty_basic_1d_d rpt.rpt_app_basic_1d_d sdm.sdm_app_act_1d_d dw.dw_flow_app_pkg_cm_m sdm.sdm_app_act_1m_m rpt.rpt_app_aty_retain_1d_d sdm.sdm_app_aty_retain_1d_d |
| MAU | 国际/国内 | 月 | 系统取数 | 大数据中心 | rpt.rpt_app_aty_basic_1d_d rpt.rpt_app_basic_1d_d sdm.sdm_app_act_1d_d dw.dw_flow_app_pkg_cm_m sdm.sdm_app_act_1m_m rpt.rpt_app_aty_retain_1d_d sdm.sdm_app_aty_retain_1d_d |


#### 14.2指标口径/计算规则

DAU（日）：国内（国际）首次注册/激活的用户中，实际启动并活跃过的用户数，按照安卓、鸿蒙、苹果以及明细手机型号划分DAU。日均：国内（国际）DAU（日）按月汇总的平均值。

MAU（月）：国内（国际）过去30天内至少启动一次APP的用户总量。

人均打开次数：墨迹天气APP在国内（国际）平均每人启动应用的次数。

活跃次日留存率：国内（国际）活跃用户在次日仍启动该App的用户数占比。


#### 14.3数据溯源

1、数据源


```sql
selectedDB
```
【数据中台】ireland-mrs-hive-172.16.18.253

2、数据源SQL逻辑

<!-- table-79 -->
**表格 79**

字段：序号 / 系统表名 / 溯源SQL

- 记录 1
  - 序号: 1
  - 系统表名: rpt.rpt_app_aty_basic_1d_d 国内日活跃用户-ios，android
  - 溯源SQL:

```sql
SELECT stat_date-- 日期 ,pkg-- 包名 ,type-- 子维度 ,rpt_key-- 维度类别 ,sum(app_aty_user_cnt_1d) AS app_aty_user_cnt_1d-- 活跃用户（含刷新） ,sum(app_aty_user_cnt_1d_noback) AS app_aty_user_cnt_1d_noback-- 活跃用户 ,sum(app_start_cnt_1d) AS app_start_cnt_1d-- 启动次数（含刷新） ,sum(app_start_cnt_1d_noback) AS app_start_cnt_1d_noback-- 启动次数 ,sum(app_avg_start_cnt_1d) AS app_avg_start_cnt_1d-- 平均启动次数 ,sum(app_du_1d) AS app_du_1d-- 总时长 ,sum(pv_1d_du) AS pv_1d_du-- 总时长pv ,sum(uv_1d_du) AS uv_1d_du-- 总时长uv ,sum(app_avg_uv_du_1d) AS app_avg_uv_du_1d-- 人均使用时长 ,sum(app_avg_pv_du_1d) AS app_avg_pv_du_1d-- 平均单次使用时长 ,CASE
WHEN WHEN type='device_brand' THEN '设备终端'
WHEN WHEN type='start_type' THEN 'APP相关'
WHEN WHEN type='net_type' THEN '网络及运营商'
WHEN WHEN type='os_version' THEN '设备终端'
WHEN WHEN type='country' THEN '地域'
WHEN WHEN type='device_model' THEN '设备终端'
WHEN WHEN type='aty_classify1' THEN '渠道分析'
WHEN WHEN type='ver' THEN 'APP相关'
WHEN WHEN type='large_version' THEN 'APP相关'
WHEN WHEN type='major_version' THEN 'APP相关'
WHEN WHEN type='province' THEN '地域'
WHEN WHEN type='language' THEN 'APP相关'
WHEN WHEN type='mbr_status' THEN 'APP相关'
WHEN WHEN type='resolution' THEN '设备终端'
WHEN WHEN type='carrier' THEN '网络及运营商'
WHEN WHEN type='instl_channel' THEN '渠道分析'
WHEN WHEN type='aty_channel' THEN '渠道分析'
WHEN WHEN type='login_status' THEN 'APP相关'
WHEN WHEN type='aty_commercialize' THEN '渠道分析'
WHEN WHEN type='instl_classify1' THEN '渠道分析'
WHEN WHEN type='instl_commercialize' THEN '渠道分析' END type_classify-- 维度
FROM FROM hive.rpt.rpt_app_aty_basic_1d_d
WHERE WHERE stat_date>='2024-01-01'
AND AND type='device_brand'
AND AND pkg IN ('com.moji.mjweather','com.moji.mjweather.light','com.moji.mojiweather')
GROUP BY GROUP BY stat_date,pkg,type,rpt_key
```

- 记录 2
  - 序号: 2
  - 系统表名: rpt.rpt_app_basic_1d_d 国内日活跃用户-Harmony
  - 溯源SQL:

```sql
select stat_date ,pkg_name as pkg ,app_new_user_cnt_1d ,app_new_user_cnt_td , app_aty_user_cnt_1d ,app_aty_user_cnt_1d_noback ,app_start_cnt_1d , app_start_cnt_1d_noback ,app_avg_start_cnt_1d ,lag(app_new_user_cnt_1d,1,null) over(PARTITION by pkg_name
order by order by stat_date) as lag_app_new_user_cnt_1d, (app_new_user_cnt_1d-lag(app_new_user_cnt_1d,1,null) over(PARTITION by pkg_name
order by order by stat_date))/ lag(app_new_user_cnt_1d,1,null) over(PARTITION by pkg_name
order by order by stat_date)as app_new_user_cnt_1d_qoq ,lag(app_aty_user_cnt_1d,1,null) over(PARTITION by pkg_name
order by order by stat_date) as lag_app_aty_user_cnt_1d, (app_aty_user_cnt_1d-lag(app_aty_user_cnt_1d,1,null) over(PARTITION by pkg_name
order by order by stat_date))/ lag(app_aty_user_cnt_1d,1,null) over(PARTITION by pkg_name
order by order by stat_date)as app_aty_user_cnt_1d_qoq, lag(app_aty_user_cnt_1d_noback,1,null) over(PARTITION by pkg_name
order by order by stat_date) as lag_app_aty_user_cnt_1d_noback, (app_aty_user_cnt_1d_noback-lag(app_aty_user_cnt_1d_noback,1,null) over(PARTITION by pkg_name
order by order by stat_date))/ lag(app_aty_user_cnt_1d_noback,1,null) over(PARTITION by pkg_name
order by order by stat_date)as app_aty_user_cnt_1d_noback_qoq, lag(app_start_cnt_1d,1,null) over(PARTITION by pkg_name
order by order by stat_date) as lag_app_start_cnt_1d, (app_start_cnt_1d-lag(app_start_cnt_1d,1,null) over(PARTITION by pkg_name
order by order by stat_date))/ lag(app_start_cnt_1d,1,null) over(PARTITION by pkg_name
order by order by stat_date)as app_start_cnt_1d_qoq, lag(app_start_cnt_1d_noback,1,null) over(PARTITION by pkg_name
order by order by stat_date) as lag_app_start_cnt_1d_noback, (app_start_cnt_1d_noback-lag(app_start_cnt_1d_noback,1,null) over(PARTITION by pkg_name
order by order by stat_date))/ lag(app_start_cnt_1d_noback,1,null) over(PARTITION by pkg_name
order by order by stat_date)as app_start_cnt_1d_noback_qoq ,app_du_1d ,uv_1d_du ,pv_1d_du ,app_avg_uv_du_1d ,lag(app_avg_uv_du_1d,1,null) over(PARTITION by pkg_name
order by order by stat_date) as lag_app_avg_uv_du_1d, (app_avg_uv_du_1d-lag(app_avg_uv_du_1d,1,null) over(PARTITION by pkg_name
order by order by stat_date))/ lag(app_avg_uv_du_1d,1,null) over(PARTITION by pkg_name
order by order by stat_date)as app_avg_uv_du_1d_qoq ,app_avg_pv_du_1d ,lag(app_du_1d,1,null) over(PARTITION by pkg_name
order by order by stat_date) as lag_app_du_1d ,lag(uv_1d_du,1,null) over(PARTITION by pkg_name
order by order by stat_date) as lag_uv_1d_du ,lag(pv_1d_du,1,null) over(PARTITION by pkg_name
order by order by stat_date) as lag_pv_1d_du
from from (
select select stat_date ,pkg_name ,sum(app_new_user_cnt_1d) as app_new_user_cnt_1d ,sum(app_new_user_cnt_td) as app_new_user_cnt_td ,sum(app_aty_user_cnt_1d) as app_aty_user_cnt_1d ,sum(app_aty_user_cnt_1d_noback) as app_aty_user_cnt_1d_noback ,sum(app_start_cnt_1d) as app_start_cnt_1d ,sum(app_start_cnt_1d_noback) as app_start_cnt_1d_noback ,sum(app_avg_start_cnt_1d) as app_avg_start_cnt_1d ,sum(app_du_1d) as app_du_1d ,sum(uv_1d_du) as uv_1d_du ,sum(pv_1d_du) as pv_1d_du ,sum(app_avg_uv_du_1d) as app_avg_uv_du_1d ,sum(app_avg_pv_du_1d) as app_avg_pv_du_1d
from from hive.rpt.rpt_app_basic_1d_d
where where stat_date >= '2020-01-01'
group by group by stat_date,pkg_name ) t
```

- 记录 3
  - 序号: 3
  - 系统表名: sdm.sdm_app_act_1d_d 国际dau，国际人均打开次数
  - 溯源SQL: 整表同步

- 记录 4
  - 序号: 4
  - 系统表名: dw.dw_flow_app_pkg_cm_m 国内mau
  - 溯源SQL:

```sql
select *
from from hive.dw.dw_flow_app_pkg_cm_m
where where stat_date >= '2021-01'
```

- 记录 5
  - 序号: 5
  - 系统表名: sdm.sdm_app_act_1m_m 国际mau
  - 溯源SQL: 整表同步

- 记录 6
  - 序号: 6
  - 系统表名: rpt.rpt_app_aty_retain_1d_d 计算国内活跃次日留存率
  - 溯源SQL:

```sql
select *
from from (
select select stat_date ,pkg_name pkg ,type ,rpt_key ,concat(days,'天后') days ,app_aty_user_cnt_1d ,aty_retain ,aty_retain_rate ,"日" status_date
from from hive.rpt.rpt_app_aty_retain_1d_d
where where ((type = 'pkg'
AND AND stat_date >= '2021-01-01')
OR OR (type != 'pkg'
AND AND stat_date >= date_sub(CURRENT_DATE(), 365) ) ) ) a1
where where a1.days = '1天后'
and and rpt_key = 'all'
AND AND pkg in ('墨迹天气_Android','墨迹天气_iPhone','墨迹天气_Harmony')
```

- 记录 7
  - 序号: 7
  - 系统表名: sdm.sdm_app_aty_retain_1d_d 计算国际活跃次日留存率
  - 溯源SQL:

```sql
select *
from from sdm.sdm_app_aty_retain_1d_d
where where rpt_key = 'all'
and and days = '1'
```


#### 14.4来源环境对比数据

[图片占位：2 张，原 DOCX 内嵌图片未 OCR]


#### 14.5 FineDataLink数仓

1、ODM贴源层

<!-- table-80 -->
| 表名 | 描述 | 备注 |
| --- | --- | --- |
| odm_md_dome_android_ios_dau_a_d | 国内--ios，android，可以划分到机型 | 国内 |
| odm_md_rpt_app_basic_a_d | 国内--HarmonyOS，不需要划分到机型 | 国内 |
| odm_md_dome_mau_a_d | 国内mau | 国内 |
| odm_md_dome_dau_ratio_a_d | 国内留存 | 国内 |
| odm_md_dome_new_ratio_a_d | 国内留存-用户资产 | 国内 |
| odm_md_inter_dau_a_d | 国际--ios，android，划分到机型 | 国际 |
| odm_md_inter_number_iaunches_a_d | 国际人均打开次数 | 国际 |
| odm_md_inter_mau_a_d | 国际mau | 国际 |
| odm_md_inter_dau_ratio_a_d | 国际活跃次日留存率sdm.sdm_app_aty_retain_1d_d | 国际 |

数据同步过程详见FineDataLink的【odm国内DAU】、【odm国际DAU】任务。

2、IDM明细层/SDM汇总层

<!-- table-81 -->
| 表名 | 描述 | 备注 |
| --- | --- | --- |
| idm_md_dome_dau_a_d | 国内：ios+android，划分到机型国内：Harmony，不需要划分到机型 | 国内 |
| idm_dome_mau_a_d | 国内mau | 国内 |
| sdm_md_dome_dau_a_d | 国内日活跃用户 | 国内 |
| sdm_md_dome_ave_dau_a_d | 国内月活跃用户(日均dau) | 国内 |
| sdm_md_dome_dau_ratio_a_d | 国内次日留存率 | 国内 |
| sdm_md_dome_ave_dau_ratio_a_d | 国内dau相关比率(日均) | 国内 |
| sdm_md_dome_mau_a_d | 国内mau | 国内 |
| idm_md_inter_dau_a_d | 国际dau | 国际 |
| idm_md_inter_mau_a_d | 国际mau | 国际 |
| sdm_md_inter_dau_a_d | 国际日活跃用户 | 国际 |
| sdm_md_inter_ave_dau_a_d | 国际月活跃用户（日均dau） | 国际 |
| sdm_md_inter_dau_ratio_a_d | 国际活跃次日留存率 | 国际 |
| sdm_md_inter_ave_dau_ratio_a_d | 国际活跃次日留存率(日均) | 国际 |
| sdm_md_inter_mau_a_d | 国际mau | 国际 |

数据同步过程详见FineDataLink的【idm国内DAU】、【idm国际DAU】、【sdm国内DAU】、【sdm国际DAU】任务。

3、APP应用层

<!-- table-82 -->
| 表名 | 描述 | 备注 |
| --- | --- | --- |
| app_md_dome_dau_a_d | 国内日活跃用户 | 国内 |
| app_md_dome_ave_dau_a_d | 国内dau月活跃用户(日均) | 国内 |
| app_md_dome_new_ratio_a_d | 用户资产--活跃留存率 | 国内 |
| app_md_dome_dau_ratio_a_d | 国内dau相关比率 | 国内 |
| app_md_dome_ave_dau_ratio_a_d | 国内dau相关比率(日均) | 国内 |
| app_md_dome_mau_a_d | 国内mau | 国内 |
| app_md_all_mau_a_d | 总mau | 国内 |
| app_md_warning_a_d | mau指标预警 | 国内 |
| app_md_inter_dau_ratio_a_d | 国际dau相关比率 | 国际 |
| app_md_inter_ave_dau_ratio_a_d | 国际dau留存率(日均) | 国际 |
| app_md_inter_dau_a_d | 国际dau | 国际 |
| app_md_inter_ave_dau_a_d | 国际dau月活跃用户(日均) | 国际 |
| app_md_inter_mau_a_d | 国际mau | 国际 |

数据同步过程详见FineDataLink的【app国内DAU】、【app国际DAU】任务。

4、数据更新时点及可查看的业务数据日期

数据更新结束时间：T+1上午十点可查看T+2的完整数据，T+1晚上九点可查看T+1的完整数据。


#### 14.6 数据验证结论

DAU

[图片占位：1 张，原 DOCX 内嵌图片未 OCR]

国际DAU

[图片占位：1 张，原 DOCX 内嵌图片未 OCR]

国内人均打开次数

[图片占位：1 张，原 DOCX 内嵌图片未 OCR]


### 15.业务总览-国际化

[图片占位：1 张，原 DOCX 内嵌图片未 OCR]


#### 15.1指标清单

<!-- table-83 -->
| 指标名称 | 统计频率 | 数据来源方式 | 来源系统 |
| --- | --- | --- | --- |
| 国际化-会员流水 | 日/月 | 系统取数 | 管驾数仓 |
| DAU趋势 | 日/月 | 系统取数 | 管驾数仓 |
| 新增构成 | 日/月 | 系统取数 | 管驾数仓 |
| 活跃留存-次日留存 | 日/月 | 系统取数 | 管驾数仓 |
| 活跃留存-7日留存 | 日/月 | 系统取数 | 管驾数仓 |
| 活跃留存-30日留存 | 日/月 | 系统取数 | 管驾数仓 |
| 总CAC_国际 | 日/月 | 系统取数 | 管驾数仓 |
| 国际化会员ROI | 日/月 | 系统取数 | 管驾数仓 |
| 国际化广告ROI | 日/月 | 系统取数 | 管驾数仓 |
| 国际化LTV | 日/月 | 系统取数 | 管驾数仓 |
| 国际化-广告营收 | 日/月 | 系统取数 | 管驾数仓 |


#### 15.2指标口径/计算规则

1、页面组件数据来源

<!-- table-84 -->
| 数仓库表 | 整合数据页面引用 | 页面组件 |
| --- | --- | --- |
| odm_sm_inter_user_clv_a_d、idm_geo_market_info | …… | ROI总览、总CLV-每日趋势、CAC趋势、CLV、LTV、ROI |
| app_sm_inter_clv_a_d odm_mb_inter_dau_country_a_d odm_mtc_country_english_a_d app_mb_inter_member_day_a_d app_ad_inter_ad_a_d app_sm_inter_clv_a_d idm_geo_market_info | 业务首页国际化日维度 app_inter_member_home_a_d | 国际化-广告营收、国际化-会员流水、新增用户的构成趋势、DAU趋势 |
| app_sm_inter_clv_a_m app_mb_inter_member_month_a_d odm_md_inter_mau_a_d odm_mtc_country_english_a_d app_ad_inter_ad_m_d app_sm_inter_clv_a_m idm_geo_market_info | 业务首页国际化月维度 app_inter_member_home_a_m | 国际化-广告营收、国际化-会员流水、新增用户的构成趋势、DAU趋势 |
| sdm_sm_inter_new_con_a_d | …… | 新增留存趋势 |

2、日维度数据规则

广告LTV = LT×(广告收入÷dau加和)

会员LTV = 1.94×(会员流水÷新增人数)

总LTV = 新增人数×(广告LTV+会员LTV)

CAC = 消耗÷新增人数

广告ROI = 广告LTV÷CAC

会员ROI = 会员LTV÷CAC

总ROI = ( 会员ROI+广告ROI) ÷ CAC

广告CLV = 广告LTV - CAC

会员CLV = 会员LTV - CAC

总CLV = 新增人数× ( 广告LTV + 会员LTV - CAC )

3、月维度数据规则

广告LTV_月 = sum(广告LTV_日)÷当月天数

会员LTV_月 = sum(会员LTV_日)÷当月天数

总LTV_月 = sum(总LTV_日)

CAC_月 = sum(消耗_日)÷sum(新增人数_日)

广告ROI_月 = 广告LTV_月÷CAC_月

会员ROI_月 = 会员LTV_月÷CAC_月

总ROI_月 = (会员ROI_月+广告ROI_月 ) ÷ CAC_月

广告CLV_月= sum(广告LTV_日) ÷当月天数 - ( sum(消耗_日) ÷ sum(新增用户_日) )

会员CLV_月= sum(会员LTV_日) ÷当月天数 - ( sum(消耗_日) ÷ sum(新增用户_日) )

总CLV_月= sum(总CLV_日)


#### 15.3 FineDataLink数仓

1、数据同步过程详见FineDataLink的【CLV-国际】、【app首页指标】任务，且数据更新时点一致。

2、填报数据存储库表

<!-- table-85 -->
| 数据名称 | 填报模版名称 | 数仓库表 | 备注 | 状态 |
| --- | --- | --- | --- | --- |
| 国家大洲对应表 |  | idm_geo_market_info |  | 静态数据 |


### 16.业务总览-会员

[图片占位：1 张，原 DOCX 内嵌图片未 OCR]

1、指标清单、指标口径/计算规则、数据溯源、FineDataLink数仓、数据更新时点同【营业收入-会员】一致。

2、填报数据存储库表

<!-- table-86 -->
| 数据名称 | 填报模版名称 | 数仓库表 | 备注 | 状态 |
| --- | --- | --- | --- | --- |
| 墨迹WNI分入口价值对比 | 业务总览-会员-墨迹WNI分入口价值对比 | idm_sa_bubblechart_i_d | 每周上传 | 动态数据 |


### 17.业务总览-TOB

[图片占位：1 张，原 DOCX 内嵌图片未 OCR]


#### 17.1指标清单

<!-- table-87 -->
| 指标名称 | 统计频率 | 数据来源方式 | 来源系统 | 系统表名 |
| --- | --- | --- | --- | --- |
| 客户年累计营收金额 | 日/月 | 手工填报 |  |  |
| 市场需求_销售额(YTD) | 日/月 | 手工填报 |  |  |
| 月度营收金额（服务类型） | 日/月 | 手工填报 |  |  |
| 月度目标金额 | 日/月 | 手工填报 |  |  |
| 月度营收金额（行业分类） | 日/月 | 手工填报 |  |  |


#### 17.2指标口径/计算规则

1、TOB漏斗由市场需求、CRM销售机会、TOB签单表、TOB合同表整合清理后展示。

2、TOB行业映射表

<!-- table-88 -->
| CEO一眼报行业 | 签单表细分行业 | 签单表细分行业 | 签单表细分行业 |
| --- | --- | --- | --- |
| 陆上交通 | 陆上交通 | 陆上交通 | 陆上交通 |
| 陆上交通 | 交通 | 交通 | 交通 |
| 陆上交通 | 轨道交通 | 轨道交通 | 轨道交通 |
| 航空 | 航空 | 航空 | 航空 |
| 能源 | 能源 | 能源 | 能源 |
| 手机厂商 | 手机厂商 | 手机厂商 | 手机厂商 |
| 其他 | 环保 | 车企 | 农业 |
| 其他 | 制造 | 物流 | 个人 |
| 其他 | 院校 | 互联网 | 其他 |
| 其他 | 文旅 | 零售 | 空白 |
| 其他 | 政府 | 金融 |  |

在TOB签单表服务类型的Saas、Dass，行业类型字段内容参考行业映射表归集维度展示。


#### 17.3数据溯源

1、数据源

CRM接口

【数据中台】mysql-bfp_read-iscs_irpt-iscs_hsbm-172.16.23.101

2、数据源SQL逻辑

<!-- table-89 -->
**表格 89**

字段：序号 / 系统表名 / 溯源SQL

- 记录 1
  - 序号: 1
  - 系统表名: tob销售机会
  - 溯源SQL: https://api-p05.xiaoshouyi.com/rest/data/v2/query?q=${sql} limit ${offset},200

- 记录 2
  - 序号: 2
  - 系统表名: Tob合同表
  - 溯源SQL: https://login.xiaoshouyi.com/auc/oauth2/token?grant_type=password&client_id=c2e63e8b5ed7cb24bc8abb0e5c9e242f&client_secret=<REDACTED>&redirect_uri=https://www.mojicb.com/&username=zhihua.tao@moji.com&password=<REDACTED>

- 记录 3
  - 序号: 3
  - 系统表名: TOB签单表
  - 溯源SQL:

```sql
SELECT id,contract_num,start_date,end_date,party_site_number,receipt_dept,industry,sub_industry,salesperson,abbreviation,sources_of_leads,customer_categories,service_type,service_content,sign_date,rec_amount,rec_amount_exc_tax,amortization_month,receivable_ending_balance,invoice_amounted,invoiced_revenue,invoiced_tax_amount,uninvoiced_amount,amount_received_previous,amount_received_last_year,amount_received_ytd,uncollected_amount,total_revenue_difference,total_revenue_amount,revenue_previous_year,this_year_jan_amount,this_year_feb_amount,this_year_mar_amount,this_year_apr_amount,this_year_may_amount,this_year_jun_amount,this_year_jul_amount,this_year_aug_amount,this_year_sep_amount,this_year_oct_amount,this_year_nov_amount,this_year_dec_amount,next_year_jan_amount,next_year_feb_amount,next_year_mar_amount,next_year_apr_amount,next_year_may_amount,next_year_jun_amount,next_year_jul_amount,next_year_aug_amount,next_year_sep_amount,next_year_oct_amount,next_year_nov_amount,next_year_dec_amount,the_year_after_next_jan_amount,the_year_after_next_feb_amount,the_year_after_next_mar_amount,the_year_after_next_apr_amount,the_year_after_next_may_amount,the_year_after_next_jun_amount,the_year_after_next_jul_amount,the_year_after_next_aug_amount,the_year_after_next_sep_amount,the_year_after_next_oct_amount,the_year_after_next_nov_amount,the_year_after_next_dec_amount,tenant_id,created_by,last_updated_by,creation_date,last_update_date,object_version_number,invoice_date,substr(STR_TO_DATE(CONCAT(report_month,'-01'),'%Y-%m-%d'),1,7) report_month,contract_ar_due_date,due_date,payment_date,days_past_due
FROM FROM `iscs_irpt`.`tob_order_signing_sheet`
WHERE WHERE tenant_id='10020'
```


#### 17.4来源环境对比数据

无内容，省略……


#### 17.5 FineDataLink数仓

1、ODM贴源层

<!-- table-90 -->
| 表名 | 描述 | 备注 |
| --- | --- | --- |
| odm_tob_opportunity_a_d | tob销售机会 |  |
| odm_tob_order_signing_sheet | TOB签单表 | 线上营收数据暂不能用 |
| odm_tob_contract_a_d | Tob合同表 |  |

数据同步过程详见FineDataLink的【odm_首页指标】任务。

2、IDM明细层/SDM汇总层

<!-- table-91 -->
| 表名 | 描述 | 备注 |
| --- | --- | --- |
| idm_tob_funnel_a_d | tob漏斗图数据 |  |

数据同步过程详见FineDataLink的【idm_首页指标】任务。

3、APP应用层

<!-- table-92 -->
| 表名 | 描述 | 备注 |
| --- | --- | --- |
| app_tob_funnel_a_d | TOB漏斗 |  |
| app_tob_revenuetop_a_d | 营收词云图 |  |
| app_tob_revenuetype_a_d | 营收达成：服务类型及行业类型 |  |

数据同步过程详见FineDataLink的【app_首页指标】任务。

4、填报数据存储库表

<!-- table-93 -->
| 表名 | 描述 | 备注 |
| --- | --- | --- |
| odm_tob_order_goal_a_d | 业务总览-TOB-市场需求目标填报 |  |
| idm_tob_order_signing_sheet | 业务总览-TOB-签单表 |  |

TOB-签单表在结算中台线上数据未修复的情况下，手工填报持续录入。

5、数据更新时点

TOB仅有月维度数据，页面漏斗数据用的CRM接口数据，每日8:00、20:00更新接口数据；页面词云图、服务类型、行业类型用到的数据来源于每月财务结账后确认的营收。


#### 17.6 数据验证结论

[图片占位：1 张，原 DOCX 内嵌图片未 OCR]

[图片占位：1 张，原 DOCX 内嵌图片未 OCR]

[图片占位：5 张，原 DOCX 内嵌图片未 OCR]


### 18.业务总览-广告

[图片占位：1 张，原 DOCX 内嵌图片未 OCR]

指标清单、指标口径/计算规则、数据溯源、FineDataLink数仓、数据更新时点同【营业收入-广告】一致。
