/**
 * P0-1 问题类型口径绑定 —— 临界区锁。
 *
 * 两把锁，**作用域不同**（O1 §4.1⑤：「在 `registryActivationCommitExclusion`
 * （与注册表激活提交互斥；**不仅** `identityKey`＋`sessionId` 锁）内」）：
 *
 * - `withCaliberBindingScopeLock(scopeKey, fn)` —— D11 的 `identityKey`＋`sessionId`
 *   锁，串行化同一问询旅程内的 begin 提交。
 * - `withCaliberBindingRegistryExclusion(fn)` —— 与**注册表激活提交**互斥的区间。
 *   注册表提交（`commitCaliberBindingRegistry`）与新 begin 的临界区必须互斥：
 *   否则 begin 可能在一个即将被替换的注册表代次上提交选择。
 *
 * 部署边界：单实例／单副本（与 `publish-coordinator.ts` 同一约束）。进程内互斥
 * 足以覆盖「同一进程内两个并发请求」的竞态；跨进程由发布窗口的文件锁兜底。
 */

const scopeChains = new Map<string, Promise<unknown>>();
let registryChain: Promise<unknown> = Promise.resolve();

/** 串行化同一 scopeKey 的临界区。 */
export async function withCaliberBindingScopeLock<T>(scopeKey: string, fn: () => Promise<T>): Promise<T> {
  const previous = scopeChains.get(scopeKey) ?? Promise.resolve();
  // 失败也要让出链，否则一次异常会把该 scope 永久堵死。
  const result = previous.then(fn, fn);
  const chained = result.then(
    () => undefined,
    () => undefined
  );
  scopeChains.set(scopeKey, chained);
  try {
    return await result;
  } finally {
    if (scopeChains.get(scopeKey) === chained) scopeChains.delete(scopeKey);
  }
}

/**
 * 注册表激活互斥区间。与注册表提交互斥 —— 提交方（发布路径）也必须走这把锁。
 */
export async function withCaliberBindingRegistryExclusion<T>(fn: () => Promise<T>): Promise<T> {
  const previous = registryChain;
  let release: () => void = () => {};
  registryChain = new Promise<void>((resolve) => {
    release = resolve;
  });
  await previous.catch(() => undefined);
  try {
    return await fn();
  } finally {
    release();
  }
}
