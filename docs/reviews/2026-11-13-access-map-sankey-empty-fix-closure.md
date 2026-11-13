# 访问关系图空桑基修复 — 功能合同收口

| 元数据 | 内容 |
|---|---|
| 日期 | 2026-11-13 |
| Spec | [`lucy-20261113-access-map-sankey-empty-fix-spec.md`](../specs/lucy-20261113-access-map-sankey-empty-fix-spec.md) |
| Plan | [`lucy-20261113-access-map-sankey-empty-fix-plan.md`](../plans/lucy-20261113-access-map-sankey-empty-fix-plan.md) |
| 实现提交 | `f3f88837` |
| 性质 | **功能合同收口**。**≠ 可上线** |

## 结论

SC-01–SC-12 **关闭**。本条收口不表示可上线；客户／云端部署另走发布取证。

## SC 逐条

| ID | 结果 | 证据 |
|---|---|---|
| SC-01 | 通过 | `webui/server/__tests__/turn-correlation.test.ts`（begin 后同 session 延续 → confirmed／explicit） |
| SC-02 | 通过 | 同文件：无 active turn 时 session 候选不升 confirmed |
| SC-03 | 通过 | 同文件：非法 header → conflict |
| SC-04 | 通过 | 既有 confirmed-only 回归仍在分支；本条未放开 `include_candidate` |
| SC-05 | 通过 | `webui/src/__tests__/access-map-usage-first.test.tsx` 闲置骨干 layout |
| SC-06 | 通过 | 同文件：有 usage 时厚度跟 accessPaths |
| SC-07 | 通过 | 同文件：闲置表不进列 |
| SC-08 | 通过 | `AccessMapLegend` 闲置骨干披露（实现提交同捆） |
| SC-09 | 通过 | usage-first 测：0 confirmed → accessPaths=0 时骨干路径 |
| SC-10 | 通过 | usage-first 测：confirmed 触表 → usage 流带 |
| SC-11 | 通过（笔记） | 错题本记录本机 API／容器上下文；demo 重建曾因代理未冒烟——合同层以 vitest 为准 |
| SC-12 | 通过 | 错题本状态 `mitigated` → 本收口升 `closed` |

## 门禁（本机 2026-11-13 复跑）

```text
npx vitest run server/__tests__/turn-correlation.test.ts \
  src/__tests__/access-map-usage-first.test.tsx --maxWorkers=1
→ 2 files / 24 tests passed
```
