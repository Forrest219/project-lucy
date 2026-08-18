#!/usr/bin/env python3
"""Fetch Moji intl near-7-day aggregates via mysql CLI and write week-payload JSON.

Usage:
  python3 build_moji_week_payload.py \
    --host rm-...mysql.rds.aliyuncs.com \
    --user bi_zy \
    --password-file .ktx/secrets/mysql-aliyun-password \
    --out inbox/week-payload.json
"""

from __future__ import annotations

import argparse
import json
import subprocess
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

BJ = ZoneInfo("Asia/Shanghai")


def beijing_now_str() -> str:
    return datetime.now(BJ).strftime("%Y-%m-%d %H:%M:%S（北京时间）")


def fnum(x: str) -> float:
    return float(x) if x not in (None, "NULL", "") else 0.0


def wow_rate(cur, prev) -> float | None:
    if cur is None or prev is None:
        return None
    try:
        p = float(prev)
        c = float(cur)
    except (TypeError, ValueError):
        return None
    if p == 0:
        return None
    return (c - p) / p


def mysql_query(host: str, user: str, password: str, sql: str) -> list[list[str]]:
    cmd = [
        "mysql",
        "-h",
        host,
        "-P",
        "3306",
        "-u",
        user,
        f"-p{password}",
        "--batch",
        "--raw",
        "-N",
        "-e",
        sql,
    ]
    out = subprocess.check_output(cmd, stderr=subprocess.DEVNULL).decode()
    return [line.split("\t") for line in out.splitlines() if line.strip()]


def window_kpis(
    country_rows: list[dict],
    ad_idx: dict,
    ret_idx: dict,
    dates: list[str],
) -> dict:
    if not dates:
        return {
            "dau": None,
            "new_moji": None,
            "new_af": None,
            "spend": None,
            "cac": None,
            "d1_rate": None,
        }
    n_days = len(dates)
    daily_dau = []
    for d in dates:
        rows = [r for r in country_rows if r["biz"] == d]
        daily_dau.append(sum(r["dau"] for r in rows))
    rows = [r for r in country_rows if r["biz"] in dates]
    tot_moji = sum(r["new_moji"] for r in rows)
    tot_af = sum(r["new_af"] for r in rows)
    tot_spend = 0.0
    tot_ad_af = 0.0
    for r in rows:
        sp, af = ad_idx.get((r["biz"], r["platform"], r["abbr"]), (0.0, 0.0))
        tot_spend += sp
        tot_ad_af += af
    tot_ret = 0.0
    tot_base = 0.0
    for r in rows:
        ret, base = ret_idx.get((r["biz"], r["platform"], r["abbr"]), (0.0, 0.0))
        tot_ret += ret
        tot_base += base
    return {
        "dau": (sum(daily_dau) / n_days) if n_days else None,
        "new_moji": tot_moji,
        "new_af": tot_af,
        "spend": tot_spend,
        "cac": (tot_spend / tot_ad_af) if tot_ad_af else None,
        "d1_rate": (tot_ret / tot_base) if tot_base else None,
    }


def build_payload(host: str, user: str, password: str) -> dict:
    # Pull 14 business days so we can compute 较上周 (prior equal-length window).
    country = mysql_query(
        host,
        user,
        password,
        """
SELECT DATE_FORMAT(date,'%Y-%m-%d') biz, platform, country_abbr, MAX(country_region_cn),
       SUM(dau), SUM(new_users_moji), SUM(new_users_af), SUM(launches)
FROM chatbi.ai_intl_country_daily
WHERE date >= DATE_SUB((SELECT MAX(date) FROM chatbi.ai_intl_country_daily), INTERVAL 13 DAY)
GROUP BY 1,2,3
ORDER BY 1,3,2
""",
    )
    ad = mysql_query(
        host,
        user,
        password,
        """
SELECT DATE_FORMAT(date,'%Y-%m-%d') biz, platform, country_abbr,
       SUM(spend), SUM(new_users_af)
FROM chatbi.ai_intl_ad_daily
WHERE date >= DATE_SUB((SELECT MAX(date) FROM chatbi.ai_intl_ad_daily), INTERVAL 13 DAY)
GROUP BY 1,2,3
""",
    )
    ret = mysql_query(
        host,
        user,
        password,
        """
SELECT DATE_FORMAT(date,'%Y-%m-%d') biz, platform, country_abbr,
       SUM(retained_users), SUM(new_users_base_moji)
FROM chatbi.ai_intl_retention_daily
WHERE retention_days=1
  AND date >= DATE_SUB((SELECT MAX(date) FROM chatbi.ai_intl_country_daily), INTERVAL 13 DAY)
GROUP BY 1,2,3
""",
    )

    country_rows = [
        {
            "biz": r[0],
            "platform": r[1],
            "abbr": r[2],
            "cn": r[3],
            "dau": fnum(r[4]),
            "new_moji": fnum(r[5]),
            "new_af": fnum(r[6]),
            "launches": fnum(r[7]),
        }
        for r in country
    ]
    cn_map = {r["abbr"]: r["cn"] for r in country_rows}
    ad_idx = {(r[0], r[1], r[2]): (fnum(r[3]), fnum(r[4])) for r in ad}
    ret_idx = {(r[0], r[1], r[2]): (fnum(r[3]), fnum(r[4])) for r in ret}

    all_dates = sorted({r["biz"] for r in country_rows})
    if not all_dates:
        raise SystemExit("no country daily rows in lookback window")

    # Current week = last 7 business days present; prior = the 7 before that.
    cur_dates = all_dates[-7:]
    prev_dates = all_dates[-14:-7] if len(all_dates) >= 14 else all_dates[:-7]
    biz_start, biz_end = cur_dates[0], cur_dates[-1]
    n_days = len(cur_dates)

    cur_kpis = window_kpis(country_rows, ad_idx, ret_idx, cur_dates)
    prev_kpis = window_kpis(country_rows, ad_idx, ret_idx, prev_dates) if prev_dates else {
        k: None for k in cur_kpis
    }
    kpi_wow = {k: wow_rate(cur_kpis[k], prev_kpis.get(k)) for k in cur_kpis}

    daily = []
    for d in cur_dates:
        rows = [r for r in country_rows if r["biz"] == d]
        spend = sum(ad_idx.get((d, r["platform"], r["abbr"]), (0, 0))[0] for r in rows)
        daily.append(
            {
                "biz_date": d,
                "dau": sum(r["dau"] for r in rows),
                "new_moji": sum(r["new_moji"] for r in rows),
                "spend": spend,
            }
        )

    country_rows_cur = [r for r in country_rows if r["biz"] in cur_dates]
    by_country = []
    detail = []
    for abbr in sorted(
        {r["abbr"] for r in country_rows_cur},
        key=lambda a: -sum(x["dau"] for x in country_rows_cur if x["abbr"] == a),
    ):
        rows = [r for r in country_rows_cur if r["abbr"] == abbr]
        daily_by_day = []
        for d in cur_dates:
            day_rows = [r for r in rows if r["biz"] == d]
            daily_by_day.append(sum(r["dau"] for r in day_rows))
        country_avg_dau = sum(daily_by_day) / n_days
        spend = sum(ad_idx.get((r["biz"], r["platform"], r["abbr"]), (0, 0))[0] for r in rows)
        new_af = sum(ad_idx.get((r["biz"], r["platform"], r["abbr"]), (0, 0))[1] for r in rows)
        by_country.append(
            {
                "country_abbr": abbr,
                "country_cn": cn_map.get(abbr, abbr),
                "dau": country_avg_dau,
                "spend": spend,
                "cac": (spend / new_af) if new_af else None,
            }
        )
        for plat in ("android", "iphone"):
            pr = [r for r in rows if r["platform"] == plat]
            if not pr:
                continue
            plat_daily = []
            for d in cur_dates:
                plat_daily.append(sum(r["dau"] for r in pr if r["biz"] == d))
            p_spend = sum(ad_idx.get((r["biz"], plat, abbr), (0, 0))[0] for r in pr)
            p_af = sum(ad_idx.get((r["biz"], plat, abbr), (0, 0))[1] for r in pr)
            p_ret = sum(ret_idx.get((r["biz"], plat, abbr), (0, 0))[0] for r in pr)
            p_base = sum(ret_idx.get((r["biz"], plat, abbr), (0, 0))[1] for r in pr)
            detail.append(
                {
                    "country_abbr": abbr,
                    "platform": plat,
                    "dau": sum(plat_daily) / n_days,
                    "new_moji": sum(r["new_moji"] for r in pr),
                    "spend": p_spend,
                    "cac": (p_spend / p_af) if p_af else None,
                    "d1_rate": (p_ret / p_base) if p_base else None,
                }
            )

    prev_note = (
        f"较上周对比窗 {prev_dates[0]} ~ {prev_dates[-1]}。"
        if prev_dates
        else "较上周：上一等长窗口无足够数据，KPI 变化显示为 —。"
    )

    return {
        "title": "国际化经营周看板",
        "biz_start": biz_start,
        "biz_end": biz_end,
        "generated_at": beijing_now_str(),
        "connection_id": "mysql-aliyun",
        "kpi_section_title": "本周总览",
        "kpi_delta_label": "较上周",
        "kpis": cur_kpis,
        "kpi_wow": kpi_wow,
        "daily": daily,
        "by_country": by_country,
        "detail": detail,
        "notes": [
            "周均 DAU = 窗口内按日 DAU 的算术平均；跨 android/iphone 相加为端侧加总，非全球去重。",
            "周新增 / 周 Spend 为窗口合计；CAC = 周Spend/周新增AF；D1 留存率 = sum(retained)/sum(new_users_base_moji)。",
            "KPI「较上周」= 相对上一等长 7 日窗口的变化率；CAC 上升视为负面着色。",
            "业务日与生成时间均为北京时间。",
            f"窗口 {biz_start} ~ {biz_end}；覆盖市场：中国香港、韩国、德国、美国、泰国。{prev_note}",
        ],
    }


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--host", required=True)
    ap.add_argument("--user", required=True)
    ap.add_argument("--password-file", required=True)
    ap.add_argument("--out", required=True)
    args = ap.parse_args()
    password = Path(args.password_file).read_text(encoding="utf-8").strip()
    payload = build_payload(args.host, args.user, password)
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"wrote {out} window={payload['biz_start']}..{payload['biz_end']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
