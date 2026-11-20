# runs

跑次命名：`YYYY-MM-DD-<agent>-<short>.md`。

- 改前基线：[2026-11-20-cursor-docker-baseline.md](2026-11-20-cursor-docker-baseline.md)＝FAIL，原始记录不改写。对应 v0.1：01 为默认保留路径缺陷；02–05 API PASS；06–07 NOT RUN。
- v0.2 用例（已定稿／终稿确权）：R0／01–12 及全部子例；01 为 API 显式保留结果，默认 UI 门禁由 07 证明；08–12 为新增用例。不得把旧跑次套入新定义后声称通过。
- 改后 verify：[2026-11-20-cursor-docker-verify.md](2026-11-20-cursor-docker-verify.md)＝PASS WITH GAP（子例未穷尽）。
- GAP 补跑：[2026-11-20-cursor-docker-gap-fill.md](2026-11-20-cursor-docker-gap-fill.md)＝**PASS**（INDEX 现值）。
