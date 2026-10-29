import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigationType, useSearchParams } from "react-router-dom";

/**
 * 局部状态镜像 (local-state mirror)
 *
 * Spec: docs/specs/lucy-20261029-url-driven-input-ime-composition-spec.md
 *   §5.2 局部状态镜像模式 / §5.3 URL 反向同步的时序（回声协议）
 *
 * ── 为什么不能把 value 直接绑到 URL ──────────────────────────────────────────
 *
 * React Router 的导航是异步的，React 会**先用旧 URL 值渲染一帧**。那一帧里
 * `value` prop ≠ DOM 当前值，React 于是写 `node.value`，而 Chrome 在 IME 组合
 * 进行中收到 `node.value` 写入即**取消当前组合**（Spec §1.3）。
 *
 * ── 本 hook 的形状 ───────────────────────────────────────────────────────────
 *
 *   value    ← 组件本地 state（受控源）。用户输入先写这里。
 *   onChange ← 写本地 state，再把**原文**写进 URL（函数式 setSearchParams）。
 *   reset    ← 「清除筛选」这类「URL 可能不变、但草稿必须归零」的动作专用。
 *
 * 反向同步走 §5.3 回声协议：只有 POP 与真正的外部 PUSH／REPLACE 才把草稿拉回
 * URL；自身提交的回声、更早一次提交晚到的旧值、已被更新提交盖过的旧值都**不**
 * 写草稿。**禁止** `useEffect(() => setDraft(urlValue), [urlValue])` 那种无条件
 * 覆盖——它会在连续按键时把草稿打回较早的 URL 值，组合再次被打断。
 *
 * ── 三条不变量 ───────────────────────────────────────────────────────────────
 *
 *   INV-1 组合存活：组合进行中 draft 与 DOM 值恒等 ⇒ React 永不写 node.value。
 *   INV-2 禁止变换写回：onChange 不得 trim / 大小写 / 拆分 / 过滤后再写 state，
 *         也不得把变换后的字符串写进 URL。规范化只发生在下游消费点。
 *   INV-3 不得脱节：后退、深链、hydration、清除筛选最终都要把 draft 拉回 URL
 *         所表达的文本——所以清除类动作必须调用 `reset`。
 */

/** 被更新的提交盖过的原文，最多保留 8 条（Spec §5.2）。 */
const MAX_SUPERSEDED = 8;

export interface UrlMirroredFieldOptions {
  /**
   * 读出当前 URL 里该字段应当显示的文本。
   * 多个 URL 参数聚合成一个输入框时（统一搜索），在这里做聚合。
   */
  read: (searchParams: URLSearchParams) => string;
  /**
   * 由 `prev` 与**原文**产出下一份 URLSearchParams。
   * 不得改写 `raw`：末尾空格等原文必须原样落进 URL（Spec §5.2 写入契约）。
   */
  write: (prev: URLSearchParams, raw: string) => URLSearchParams;
  /**
   * 历史模式。保持调用点现状：Audit／配置审计／Token／发布历史是 "push"，
   * 目录是 "replace"。
   */
  history: "push" | "replace";
}

export interface UrlMirroredField {
  /** 受控值。来源是本地 state，不是路由状态。 */
  value: string;
  /** 喂入用户原文。不做任何 trim / 大小写 / 拆分 / 过滤。 */
  onChange: (raw: string) => void;
  /** 强制草稿归位，并清掉 pending / superseded。 */
  reset: (nextValue: string) => void;
}

export function useUrlMirroredField({
  read,
  write,
  history
}: UrlMirroredFieldOptions): UrlMirroredField {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigationType = useNavigationType();
  const urlValue = read(searchParams);

  const [draft, setDraft] = useState(urlValue);
  /** 本字段已提交、尚未被位置变化分类的原文，旧→新。 */
  const latestSubmittedRef = useRef(urlValue);
  /** 已提交、尚未被位置变化确认的原文，旧→新。 */
  const pendingRef = useRef<string[]>([]);
  /** 已被更新的提交盖过的原文，最多 8 条。 */
  const supersededRef = useRef<string[]>([]);

  // write 由调用点内联定义，每次渲染都是新函数；用 ref 持有最新的一份，
  // 免得 onChange 的 useCallback 依赖它而每次渲染都重建。
  const writeRef = useRef(write);
  writeRef.current = write;

  // ── Spec §5.3 回声协议 ─────────────────────────────────────────────────────
  useEffect(() => {
    if (navigationType === "POP") {
      // 浏览器后退／前进：即使用户正在组合，也采用 URL。
      pendingRef.current = [];
      supersededRef.current = [];
      latestSubmittedRef.current = urlValue;
      setDraft(urlValue);
      return;
    }

    if (urlValue === latestSubmittedRef.current) {
      // 最新一次本地提交的回声：确认它，把还没确认的旧值盖进 superseded。
      supersededRef.current = [...supersededRef.current, ...pendingRef.current].slice(
        -MAX_SUPERSEDED
      );
      pendingRef.current = [];
      return; // 不 setDraft
    }

    const pendingIndex = pendingRef.current.indexOf(urlValue);
    if (pendingIndex !== -1) {
      // 更早一次本地提交晚到：吃掉该前缀，保留更快的草稿。
      pendingRef.current = pendingRef.current.slice(pendingIndex + 1);
      return; // 不 setDraft
    }

    if (supersededRef.current.includes(urlValue)) {
      // 更新的提交已经确认后，旧值又晚到：忽略。
      return; // 不 setDraft
    }

    // 其余 PUSH／REPLACE：深链、hydration、清除、抽屉回填、其它入口。
    pendingRef.current = [];
    supersededRef.current = [];
    latestSubmittedRef.current = urlValue;
    setDraft(urlValue);
  }, [urlValue, navigationType]);

  const onChange = useCallback(
    (raw: string) => {
      // 原文进草稿，再原文进 URL。禁止变换写回（INV-2）。
      setDraft(raw);
      latestSubmittedRef.current = raw;
      pendingRef.current = [...pendingRef.current, raw];
      // 函数式更新：从 prev 拷贝后再改本字段，禁止闭包快照。
      setSearchParams(
        (prev) => writeRef.current(prev, raw),
        history === "replace" ? { replace: true } : undefined
      );
    },
    [history, setSearchParams]
  );

  const reset = useCallback((nextValue: string) => {
    // 「清除筛选」等动作：URL 可能不变（参数本来就空），只改 URL 的话草稿会留下
    // 旧文本。必须显式归零，并清掉 pending / superseded。
    pendingRef.current = [];
    supersededRef.current = [];
    latestSubmittedRef.current = nextValue;
    setDraft(nextValue);
  }, []);

  return { value: draft, onChange, reset };
}

export default useUrlMirroredField;
