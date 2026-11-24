# 发版性能基线夹具分档（REQ-030-034）

| 元数据 | 内容 |
|---|---|
| 文档名称 | 发版性能基线夹具分档 |
| 文档类型 | Checklist |
| 版本 | v1.0 |
| 撰写日期 | 2026-11-13 |
| 撰写人 | Cursor |

对应 Spec：[`docs/specs/lucy-20261113-release-perf-baseline-gate-spec.md`](../specs/lucy-20261113-release-perf-baseline-gate-spec.md) SC-03／D5。

## 分档

| 档 | 命令 | 用途 | 样本默认 | 审计行下限 |
|---|---|---|---|---|
| **ci-small** | `npm --prefix webui run perf:release-baseline -- --tier ci-small --output inbox/perf-baselines/<run>` | PR／日常阻塞子集（**不含**浏览器 Roles 墙钟） | warmup 1 + iterations 5 | 0（可不写审计库） |
| **release-medium** | `npm --prefix webui run perf:release-baseline -- --tier release-medium --output inbox/perf-baselines/<run>` | 发版／夜间（**含** RPB-W2 Roles route-query-cold） | warmup 3 + iterations 15 | ≥2000 |

两档共用 Spec 174 合成生成器（`webui/scripts/entry-performance-fixture.mts`），**不含真实客户秘密**。形状下限（现行）：

| 项 | 下限 |
|---|---|
| Manifest／schema 文件 | ≥ 8 |
| 表 | ≥ 60 |
| Role（YAML） | ≥ 6 |
| Agent | ≥ 13 |

## 相对闸

- 无上一正式基线：报告 `relativeMode=baseline-seed`，**不**把相对闸记成 pass。
- 有上一版：`--previous <path-to-report.json>`，按 Spec D6（>+20% **且** >+50ms）判定。
- 接受回退：`--accepted-regression <metricId,metricId>`。

正式副本目录：`inbox/perf-baselines/formal/<lucyVersion>-<gitShaShort>/report.json`。晋升命令：

```bash
npm run perf:release-baseline:formal-seed -- --from inbox/perf-baselines/<run>
```

`formal/LATEST` 指向当前正式目录；下一候选 `--previous inbox/perf-baselines/formal/LATEST/report.json`。过程产物可删；发版列车 P4-9 引用 formal。

## 与 Spec 174 的关系

- 全量 Spec 174：`npm --prefix webui run perf:entry -- …`
- 本门禁：Roles API／source-map 计数／MCP initialize·tools/list·wiki_search／相对 D6；不替代 PERF-01–10 全表。
