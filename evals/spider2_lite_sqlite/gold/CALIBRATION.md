# Gold calibration — Spider2-lite Pilot

| 元数据 | 内容 |
|---|---|
| 文档名称 | Spider2-lite Pilot Gold Calibration |
| 文档类型 | Checklist |
| 版本 | v0.2 |
| 撰写日期 | 2026-08-08 |

## Policy

- Authoritative gold for Lucy gates: files in this directory (`gold/starrocks_pilot/`).
- Upstream Spider `exec_result/<id>_*.csv` is reference only.
- When SR result drifts: update CSV here, bump suite metadata, record row below.

## Status

| instance_id | status | notes |
|---|---|---|
| local003 | **recalibrated_sr** | 2026-08-08 StarRocks RFM SQL; tolerance 2.0 (NTILE ties) |
| local038 | match (SR SQL / Lucy two-step) | HELEN VOIGHT |
| local002, local054, local056, local081, local193, local198 | provisional | still from Spider `_a`; recalibrate when SR SQL ready |
