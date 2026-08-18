#!/usr/bin/env python3
"""Render intl ops weekly dashboard HTML from a week-payload JSON (Moji brand)."""

from __future__ import annotations

import argparse
import base64
import html
import json
from pathlib import Path

ASSETS = Path(__file__).resolve().parent.parent / "assets"
LOGO_PATH = ASSETS / "moji-logo.png"

# From https://www.moji.com/zh-CN — see references/brand-tokens.md
BRAND = "#FF8700"
BRAND_SOFT = "rgba(255, 135, 0, 0.14)"
INK = "#182134"
INK_SOFT = "#0D131A"
MUTED = "#595959"
BG = "#F7F3EC"
CARD = "#FFFDF8"
LINE = "#E7E0D5"
UP = "#1B7F4A"
DOWN = "#C0392B"
FLAT = "#595959"

# Keys where an increase is favorable (True) or unfavorable (False, e.g. CAC)
KPI_SPECS = [
    ("dau", "周均 DAU", "int", True),
    ("new_moji", "周新增-墨迹", "int", True),
    ("new_af", "周新增-AF", "int", True),
    ("spend", "周 Spend (USD)", "float", True),
    ("cac", "CAC (USD/人)", "float", False),
    ("d1_rate", "D1 留存率", "pct", True),
]


def fmt_int(n) -> str:
    if n is None:
        return "—"
    try:
        return f"{int(round(float(n))):,}"
    except (TypeError, ValueError):
        return "—"


def fmt_float(n, digits=2) -> str:
    if n is None:
        return "—"
    try:
        return f"{float(n):,.{digits}f}"
    except (TypeError, ValueError):
        return "—"


def fmt_pct(n, digits=1) -> str:
    if n is None:
        return "—"
    try:
        return f"{float(n) * 100:.{digits}f}%"
    except (TypeError, ValueError):
        return "—"


def fmt_value(n, kind: str) -> str:
    if kind == "int":
        return fmt_int(n)
    if kind == "pct":
        return fmt_pct(n)
    return fmt_float(n)


def fmt_wow(rate, higher_is_better: bool) -> str:
    """Return HTML for wow arrow + percent with polarity class."""
    if rate is None:
        return '<div class="delta flat">较上周 —</div>'
    try:
        r = float(rate)
    except (TypeError, ValueError):
        return '<div class="delta flat">较上周 —</div>'

    pct = abs(r) * 100
    if abs(r) < 5e-5:
        arrow, cls = "→", "flat"
    elif r > 0:
        arrow = "↑"
        cls = "up" if higher_is_better else "down"
    else:
        arrow = "↓"
        cls = "down" if higher_is_better else "up"

    return (
        f'<div class="delta {cls}">较上周 {arrow} {pct:.1f}%</div>'
    )


def logo_data_uri(path: Path = LOGO_PATH) -> str:
    raw = path.read_bytes()
    b64 = base64.b64encode(raw).decode("ascii")
    return f"data:image/png;base64,{b64}"


def render(data: dict, logo_uri: str | None = None) -> str:
    title = html.escape(str(data.get("title") or "国际化经营周看板"))
    biz_start = html.escape(str(data.get("biz_start") or ""))
    biz_end = html.escape(str(data.get("biz_end") or ""))
    generated = html.escape(str(data.get("generated_at") or ""))
    section_title = html.escape(str(data.get("kpi_section_title") or "本周总览"))
    kpis = data.get("kpis") or {}
    kpi_wow = data.get("kpi_wow") or {}
    daily = data.get("daily") or []
    by_country = data.get("by_country") or []
    detail = data.get("detail") or []
    notes = data.get("notes") or []
    if logo_uri is None:
        logo_uri = logo_data_uri()

    daily_labels = [str(r.get("biz_date") or "") for r in daily]
    daily_dau = [float(r.get("dau") or 0) for r in daily]
    country_labels = [str(r.get("country_cn") or r.get("country_abbr") or "") for r in by_country]
    country_spend = [float(r.get("spend") or 0) for r in by_country]
    country_cac = [float(r.get("cac") or 0) for r in by_country]

    kpi_cards = []
    for key, label, kind, higher_is_better in KPI_SPECS:
        kpi_cards.append(
            "<div class=\"kpi\">"
            f"<div class=\"label\">{html.escape(label)}</div>"
            f"<div class=\"value\">{fmt_value(kpis.get(key), kind)}</div>"
            f"{fmt_wow(kpi_wow.get(key), higher_is_better)}"
            "</div>"
        )

    detail_rows = []
    for r in detail:
        detail_rows.append(
            "<tr>"
            f"<td translate=\"no\">{html.escape(str(r.get('country_abbr') or ''))}</td>"
            f"<td translate=\"no\">{html.escape(str(r.get('platform') or ''))}</td>"
            f"<td class=\"num\">{fmt_int(r.get('dau'))}</td>"
            f"<td class=\"num\">{fmt_int(r.get('new_moji'))}</td>"
            f"<td class=\"num\">{fmt_float(r.get('spend'))}</td>"
            f"<td class=\"num\">{fmt_float(r.get('cac'))}</td>"
            f"<td class=\"num\">{fmt_pct(r.get('d1_rate'))}</td>"
            "</tr>"
        )
    notes_html = "".join(f"<li>{html.escape(str(n))}</li>" for n in notes)
    chart_daily = "true" if daily else "false"
    chart_country = "true" if by_country else "false"

    payload_json = json.dumps(
        {
            "dailyLabels": daily_labels,
            "dailyDau": daily_dau,
            "countryLabels": country_labels,
            "countrySpend": country_spend,
            "countryCac": country_cac,
            "showDaily": bool(daily),
            "showCountry": bool(by_country),
            "brand": BRAND,
            "brandSoft": BRAND_SOFT,
        },
        ensure_ascii=False,
    )

    return f"""<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>{title}</title>
  <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js"></script>
  <style>
    :root {{
      --bg: {BG};
      --card: {CARD};
      --ink: {INK};
      --ink-soft: {INK_SOFT};
      --muted: {MUTED};
      --line: {LINE};
      --brand: {BRAND};
      --up: {UP};
      --down: {DOWN};
      --flat: {FLAT};
    }}
    * {{ box-sizing: border-box; }}
    body {{
      margin: 0;
      font-family: "Avenir Next", "PingFang SC", "Noto Sans SC", sans-serif;
      background:
        radial-gradient(1000px 520px at 8% -12%, rgba(255,135,0,0.18) 0%, transparent 55%),
        radial-gradient(800px 420px at 100% 0%, rgba(24,33,52,0.08) 0%, transparent 50%),
        var(--bg);
      color: var(--ink);
      padding: 28px 24px 48px;
    }}
    .wrap {{ max-width: 1100px; margin: 0 auto; }}
    header {{
      display: flex; align-items: flex-start; justify-content: space-between; gap: 16px;
      margin-bottom: 18px; padding-bottom: 14px; border-bottom: 2px solid var(--brand);
    }}
    .brand-block {{ display: flex; align-items: flex-start; gap: 14px; min-width: 0; }}
    .brand-block img {{
      height: 36px; width: auto; display: block; flex: 0 0 auto; margin-top: 4px;
    }}
    .titles {{ min-width: 0; }}
    .eyebrow {{
      font-size: 12px; letter-spacing: 0.04em; color: var(--brand); font-weight: 650;
      margin-bottom: 4px;
    }}
    h1 {{ margin: 0; font-size: 26px; letter-spacing: -0.02em; color: var(--ink-soft); }}
    .biz-window {{
      margin-top: 6px; font-size: 14px; font-weight: 600; color: var(--ink);
      letter-spacing: 0.01em;
    }}
    .meta {{ color: var(--muted); font-size: 13px; line-height: 1.5; text-align: right; }}
    .notranslate {{ font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }}
    .kpi-block {{ margin: 16px 0 8px; }}
    .kpi-block .section-head {{
      display: flex; align-items: baseline; justify-content: space-between; gap: 12px;
      margin-bottom: 10px;
    }}
    .kpi-block h2 {{
      margin: 0; font-size: 16px; font-weight: 700; color: var(--ink-soft);
    }}
    .kpi-block .section-hint {{ font-size: 12px; color: var(--muted); }}
    .kpis {{
      display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: 10px;
    }}
    @media (max-width: 960px) {{
      header {{ flex-direction: column; }}
      .meta {{ text-align: left; }}
      .kpis {{ grid-template-columns: repeat(3, 1fr); }}
    }}
    @media (max-width: 640px) {{ .kpis {{ grid-template-columns: repeat(2, 1fr); }} }}
    .kpi {{
      background: var(--card); border: 1px solid var(--line); border-radius: 10px;
      padding: 12px 12px 10px; border-top: 3px solid var(--brand);
    }}
    .kpi .label {{ font-size: 12px; color: var(--muted); }}
    .kpi .value {{ font-size: 22px; font-weight: 700; margin-top: 4px; color: var(--brand); }}
    .kpi .delta {{
      margin-top: 6px; font-size: 12px; font-weight: 650;
      font-variant-numeric: tabular-nums;
    }}
    .kpi .delta.up {{ color: var(--up); }}
    .kpi .delta.down {{ color: var(--down); }}
    .kpi .delta.flat {{ color: var(--flat); }}
    .grid {{ display: grid; grid-template-columns: 1.2fr 1fr; gap: 12px; }}
    @media (max-width: 860px) {{ .grid {{ grid-template-columns: 1fr; }} }}
    .panel {{
      background: var(--card); border: 1px solid var(--line); border-radius: 12px;
      padding: 14px 14px 8px; min-height: 280px;
    }}
    .panel h2 {{ margin: 0 0 8px; font-size: 15px; font-weight: 700; color: var(--ink); }}
    .chart-box {{ position: relative; height: 240px; }}
    table {{
      width: 100%; border-collapse: collapse; font-size: 13px; margin-top: 8px;
      background: var(--card); border: 1px solid var(--line); border-radius: 12px; overflow: hidden;
    }}
    th, td {{ padding: 8px 10px; border-bottom: 1px solid var(--line); text-align: left; }}
    th {{ font-size: 12px; color: var(--muted); font-weight: 650; background: #fff7ef; }}
    td.num, th.num {{ text-align: right; font-variant-numeric: tabular-nums; }}
    footer {{ margin-top: 18px; color: var(--muted); font-size: 12px; line-height: 1.55; }}
    footer ul {{ margin: 6px 0 0; padding-left: 18px; }}
    .hidden {{ display: none; }}
  </style>
</head>
<body>
  <div class="wrap">
    <header>
      <div class="brand-block">
        <img src="{logo_uri}" alt="墨迹天气" />
        <div class="titles">
          <div class="eyebrow">墨迹天气 · 国际化</div>
          <h1>{title}</h1>
          <div class="biz-window">
            业务窗口：<span class="notranslate" translate="no">{biz_start}</span>
            ~ <span class="notranslate" translate="no">{biz_end}</span>
          </div>
        </div>
      </div>
      <div class="meta">
        生成 {generated}
      </div>
    </header>

    <section class="kpi-block" aria-label="本周总览 KPI">
      <div class="section-head">
        <h2>{section_title}</h2>
        <div class="section-hint">变化相对上一等长窗口（较上周）</div>
      </div>
      <div class="kpis">
        {''.join(kpi_cards)}
      </div>
    </section>

    <section class="grid">
      <div class="panel {'hidden' if not daily else ''}" id="panel-daily">
        <h2>近 7 日当日 DAU</h2>
        <div class="chart-box"><canvas id="chartDaily"></canvas></div>
      </div>
      <div class="panel {'hidden' if not by_country else ''}" id="panel-country">
        <h2>分国家周 Spend / CAC</h2>
        <div class="chart-box"><canvas id="chartCountry"></canvas></div>
      </div>
    </section>

    <section style="margin-top:14px">
      <table>
        <thead>
          <tr>
            <th>国家</th><th>平台</th>
            <th class="num">周均 DAU</th><th class="num">周新增墨迹</th>
            <th class="num">Spend</th><th class="num">CAC</th><th class="num">D1 率</th>
          </tr>
        </thead>
        <tbody>
          {''.join(detail_rows) if detail_rows else '<tr><td colspan="7">无明细</td></tr>'}
        </tbody>
      </table>
    </section>

    <footer>
      <div>口径脚注</div>
      <ul>
        {notes_html or '<li>周均 DAU = 窗口内按日 DAU 的算术平均；跨端相加为端侧加总、非全球去重。</li>'}
      </ul>
    </footer>
  </div>

  <script>
    const DATA = {payload_json};
    if (DATA.showDaily && window.Chart) {{
      new Chart(document.getElementById('chartDaily'), {{
        type: 'line',
        data: {{
          labels: DATA.dailyLabels,
          datasets: [{{
            label: '当日 DAU',
            data: DATA.dailyDau,
            borderColor: DATA.brand,
            backgroundColor: DATA.brandSoft,
            tension: 0.25,
            fill: true,
            pointRadius: 3,
            pointBackgroundColor: DATA.brand
          }}]
        }},
        options: {{
          responsive: true,
          maintainAspectRatio: false,
          plugins: {{ legend: {{ display: true }} }},
          scales: {{
            x: {{ title: {{ display: true, text: '业务日' }} }},
            y: {{ title: {{ display: true, text: '当日 DAU（人）' }}, beginAtZero: false }}
          }}
        }}
      }});
    }}
    if (DATA.showCountry && window.Chart) {{
      new Chart(document.getElementById('chartCountry'), {{
        type: 'bar',
        data: {{
          labels: DATA.countryLabels,
          datasets: [{{
            label: 'Spend (USD)',
            data: DATA.countrySpend,
            backgroundColor: DATA.brand
          }}]
        }},
        options: {{
          indexAxis: 'y',
          responsive: true,
          maintainAspectRatio: false,
          plugins: {{
            legend: {{ display: true }},
            tooltip: {{
              callbacks: {{
                afterBody: (items) => {{
                  const i = items[0]?.dataIndex ?? 0;
                  const cac = DATA.countryCac[i];
                  return 'CAC: ' + (cac == null ? '—' : Number(cac).toFixed(2) + ' USD/人');
                }}
              }}
            }}
          }},
          scales: {{
            x: {{ title: {{ display: true, text: 'Spend (USD)' }} }},
            y: {{ title: {{ display: true, text: '国家' }} }}
          }}
        }}
      }});
    }}
  </script>
  <!-- chart flags: daily={chart_daily} country={chart_country} -->
</body>
</html>
"""


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--data", required=True, help="week-payload JSON path")
    ap.add_argument("--out", required=True, help="output HTML path")
    ap.add_argument("--logo", default=str(LOGO_PATH), help="Moji logo PNG path")
    args = ap.parse_args()
    data = json.loads(Path(args.data).read_text(encoding="utf-8"))
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    uri = logo_data_uri(Path(args.logo))
    out.write_text(render(data, logo_uri=uri), encoding="utf-8")
    print(f"wrote {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
