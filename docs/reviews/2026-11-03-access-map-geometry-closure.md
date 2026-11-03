# 访问关系图几何语言修订 — 功能合同收口

| 元数据 | 内容 |
|---|---|
| 日期 | 2026-11-03（Asia/Shanghai） |
| 授权 | 同会话用户批准 C 类功能闭口 |
| 对象 | [Spec v0.2](../specs/lucy-20261101-access-map-geometry-spec.md)；[Plan v0.2](../plans/lucy-20261101-access-map-geometry-plan.md) |
| 结论 | **功能合同收口。** SC-01–SC-14 与 SC-16 关闭；SC-15 已拆出。**本条收口不表示可上线。** 功能编号无 |

## 这次跑过的测试

同会话 Batch1：

```bash
cd webui && npx vitest run --maxWorkers=1 \
  src/__tests__/access-map.test.tsx \
  src/__tests__/access-map-layout.test.tsx
```

实施细节与 SC 映射见 [2026-11-01 实施笔记](2026-11-01-access-map-geometry-implementation-notes.md)。SC-16 桌面截图：`docs/reviews/assets/2026-11-01-access-map-geometry/*.png`（夹具页 + 真实 Canvas/CSS，见实施笔记 §六说明）。

不在本条出口：SC-15 术语 lint（[拆出记录](2026-11-02-functional-contract-exit-split.md)）、完整 Playwright 套件、Docker、窄屏、客户环境。

## 逐条结论

| 编号 | 结论 | 证据落点 |
|---|---|---|
| SC-01 | 通过 | `access-map-layout.test.tsx` / 实施笔记 §四 |
| SC-02 | 通过 | 同上（`labelBlock` 方位） |
| SC-03 | 通过 | 同上（`MAX_PX_PER_PATH === 24`） |
| SC-04 | 通过 | 同上（稀疏高度带） |
| SC-05 | 通过 | layout + `access-map.test.tsx` |
| SC-06 | 通过 | layout 测试（厚度可比） |
| SC-07 | 通过 | layout + 组件（四态几何） |
| SC-08 | 通过 | layout（槽位排序） |
| SC-09 | 通过 | layout（label 避碰） |
| SC-10 | 通过 | layout + 组件（列距／稀疏居中） |
| SC-11 | 通过 | `access-map.test.tsx`（class 语义） |
| SC-12 | 通过 | 同上（悬停浮层） |
| SC-13 | 通过 | 同上（点击抽屉） |
| SC-14 | 通过 | 组件／静态（无裸 hex、无新依赖） |
| SC-15 | 拆出 | [2026-11-02 出口拆分](2026-11-02-functional-contract-exit-split.md) |
| SC-16 | 通过 | 实施笔记 §六 + `docs/reviews/assets/2026-11-01-access-map-geometry/` |
