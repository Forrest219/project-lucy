# HTML 看板布局

单页，管理简报风（密、可扫）。

## 区块

1. **Header（标题区强绑定业务窗口）**  
   - 左：墨迹 logo +  
     - eyebrow：`墨迹天气 · 国际化`  
     - **主标题**：`国际化经营周看板`  
     - **业务窗口行（紧挨标题，同属标题块）**：`业务窗口：YYYY-MM-DD ~ YYYY-MM-DD`  
   - 右：仅「生成 {generated_at}」  
   - 主色 `#FF8700`；见 [brand-tokens.md](brand-tokens.md)  
   - **禁止**出现 ChatBI / chatbi / Lucy / MCP / 连接 ID  
   - **禁止**把业务窗口只放在右上角 meta；它是强业务属性，必须与主标题同列展示  
2. **KPI 区**  
   - **小标题**：`本周总览`（其下可附一行淡色说明「较上周」）  
   - **KPI 条（6）**：周均 DAU、周新增墨迹、周新增 AF、周 Spend、CAC、D1 留存率  
   - 每张 KPI 卡：指标名 + 主数值 + **较上周箭头与比率**（↑/↓/→ + %）  
3. **图 1**：近 7 日全市场**当日 DAU** 折线  
4. **图 2**：国家周 Spend 水平条 + CAC 标注  
5. **表**：国家 × 平台（**周均 DAU**、周新增墨迹、周 Spend、CAC、D1 率）  
6. **Footer**：口径脚注（周均定义、跨端非去重、双口径、较上周窗口）

## Payload 字段（顶层）

```json
{
  "title": "国际化经营周看板",
  "biz_start": "YYYY-MM-DD",
  "biz_end": "YYYY-MM-DD",
  "generated_at": "YYYY-MM-DD HH:MM:SS（北京时间）",
  "connection_id": "mysql-aliyun",
  "kpi_section_title": "本周总览",
  "kpi_delta_label": "较上周",
  "kpis": {
    "dau": 0,
    "new_moji": 0,
    "new_af": 0,
    "spend": 0,
    "cac": 0,
    "d1_rate": 0
  },
  "kpi_wow": {
    "dau": 0.032,
    "new_moji": -0.011,
    "new_af": null,
    "spend": 0.05,
    "cac": -0.02,
    "d1_rate": 0.001
  },
  "daily": [{"biz_date":"…","dau":0,"new_moji":0,"spend":0}],
  "by_country": [{"country_abbr":"KR","country_cn":"韩国","dau":0,"spend":0,"cac":0}],
  "detail": [{"country_abbr":"KR","platform":"android","dau":0,"new_moji":0,"spend":0,"cac":0,"d1_rate":0}],
  "notes": ["…"]
}
```

约定：

- `kpis.dau` / `by_country.dau` / `detail.dau` 均为**周均 DAU**；`daily[].dau` 为**当日 DAU**。  
- `kpi_wow.*` 为相对上一等长窗口的变化率（小数，如 `0.032` = +3.2%）；`null` / 缺省 → 渲染 `—`。  
- `connection_id` 仅供内部/调试，**不要渲染到页眉**。  
