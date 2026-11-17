/**
 * P1-39: 补算分页的时间预算。重建页查询是宽列非覆盖读取，慢盘冷缓存下每行一次随机读，
 * 固定 400 行一页会同步占住事件循环数秒。页大小按上一页实测耗时收敛到目标耗时。
 */
export const REBUILD_PAGE_MIN = 25;
export const REBUILD_PAGE_MAX = 400;
export const REBUILD_PAGE_INITIAL = 50;
export const REBUILD_PAGE_TARGET_MS = 100;
/** 单步最多放大 1.5 倍：翻倍在随机读抖动时会让下一段直接冲过目标。 */
const GROWTH_PER_STEP = 1.5;

/** 通用：按上一段实测耗时把批大小收敛到目标耗时，单步最多放大 1.5 倍，限制在 [min, max]。 */
export function nextSliceSize(size: number, lastMs: number, min: number, max: number): number {
  const budgeted = Math.floor((size * REBUILD_PAGE_TARGET_MS) / Math.max(lastMs, 1));
  return Math.max(min, Math.min(max, Math.min(budgeted, Math.floor(size * GROWTH_PER_STEP))));
}

export function nextRebuildPageSize(size: number, lastMs: number): number {
  return nextSliceSize(size, lastMs, REBUILD_PAGE_MIN, REBUILD_PAGE_MAX);
}

/** 补算写入分片（每片一个事务，含 fsync）同样按时间预算收敛。 */
export const REBUILD_WRITE_SLICE_MIN = 2;
export const REBUILD_WRITE_SLICE_MAX = 25;
export const REBUILD_WRITE_SLICE_INITIAL = 8;
