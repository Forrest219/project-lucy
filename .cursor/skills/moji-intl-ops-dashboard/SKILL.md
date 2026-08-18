---
name: moji-intl-ops-dashboard
description: >-
  生成墨迹国际化近 7 日经营看板（脚本渲染单文件 HTML 并静态落盘）。在用户提到
  墨迹看板、国际化 dashboard、HTML 经营看板、moji-intl-ops-dashboard 时使用。
---

# 国际化经营近 7 日 HTML 看板

默认：**近 7 业务日**监控看板。用户可见标题为「国际化经营周看板」（禁止 ChatBI 等技术词）。  
流程：取数 → JSON payload → `scripts/render_moji_dashboard.py` → 静态 HTML。

## 必读

1. 口径：[`../moji-intl-weekly-brief/references/metric-contract.md`](../moji-intl-weekly-brief/references/metric-contract.md)  
2. 布局：[dashboard-layout.md](references/dashboard-layout.md)  
3. 品牌：[brand-tokens.md](references/brand-tokens.md)（moji.com logo + `#FF8700`）  
4. Payload 示例：[scripts/week-payload.example.json](scripts/week-payload.example.json)

## 输入（缺省即默认）

| 项 | 默认 |
|---|---|
| connection | `mysql-aliyun` |
| 窗口 | max 业务日起近 **7** 日 |
| JSON | `inbox/<ts>-intl-ops-week-payload.json` |
| HTML | `inbox/<ts>-intl-ops-dashboard.html` |
| 主 KPI | **周均 DAU** |
| 时区 | 北京时间 |

## 执行清单

```text
- [ ] 读 metric-contract + dashboard-layout + brand-tokens
- [ ] lucy_catalog 确认四源
- [ ] 取经营/广告/D1 留存；业务日用 DATE_FORMAT
- [ ] KPI/明细 DAU 写周均；daily 序列写当日 DAU
- [ ] 取上一等长窗口算 kpi_wow（较上周）；无数据写 null
- [ ] generated_at 用北京时间文案；title=国际化经营周看板
- [ ] 业务窗口与主标题同列；KPI 区加小标题「本周总览」+ 较上周箭头比率
- [ ] 组装 week-payload JSON（见 example）并渲染 HTML
- [ ] 页眉不展示连接 ID / ChatBI；打开核对 KPI
- [ ] 回复 HTML 路径 + 窗口
```

## 取数 / 渲染命令

优先 MCP `lucy_query` 组装 JSON；或用 mysql CLI 脚本：

```bash
python3 .cursor/skills/moji-intl-ops-dashboard/scripts/build_moji_week_payload.py \
  --host <mysql-host> \
  --user <ro-user> \
  --password-file .ktx/secrets/mysql-aliyun-password \
  --out inbox/<ts>-intl-ops-week-payload.json

python3 .cursor/skills/moji-intl-ops-dashboard/scripts/render_moji_dashboard.py \
  --data inbox/<ts>-intl-ops-week-payload.json \
  --out inbox/<ts>-intl-ops-dashboard.html
```

## 硬约束

- HTML 为**自包含单文件**（内嵌墨迹 logo + JSON + CDN Chart.js）；打开后不连库。  
- 视觉遵循 [brand-tokens.md](references/brand-tokens.md)：主色 `#FF8700`，页眉嵌入 `assets/moji-logo.png`。  
- 周均 DAU = 窗口内按日 DAU 的算术平均；禁止把 7 日 DAU 加总标成「周 DAU」。  
- 用户可见文案禁止 ChatBI / Lucy / MCP / 连接 ID。  
- 生成时间北京时间；比率 `sum/sum`；无数据不画空图。  
