import type { ClientRequest, ServerResponse } from "node:http";

export type BudgetSettleFlags = {
  timeoutUnconfirmed?: boolean;
  clientDisconnected?: boolean;
};

type BudgetResponse = Pick<ServerResponse, "once">;

type UpstreamHandle = Pick<ClientRequest, "once" | "destroy"> & {
  destroyed?: boolean;
};

/**
 * Spec 162 §6.2 / SC-13：结算点是上游结束、取消确认，或绝对执行时限。
 * `res.close` 只发起取消，不结算，也不清掉绝对时限的定时器。
 */
export function bindQuestionBudgetSettlement(input: {
  res: BudgetResponse;
  getUpstream: () => UpstreamHandle | null;
  now: () => number;
  startMonoMs: number;
  absMs: number;
  settle: (endMonoMs: number, flags?: BudgetSettleFlags) => void;
  onDisconnected: () => void;
  onDeadline: (upstream: UpstreamHandle | null) => void;
}): void {
  let settled = false;
  let clientGone = false;

  const timer = setTimeout(() => {
    if (settled) return;
    settled = true;
    const upstream = input.getUpstream();
    input.onDeadline(upstream);
    input.settle(input.startMonoMs + input.absMs, { timeoutUnconfirmed: true });
  }, input.absMs);
  if (typeof timer.unref === "function") timer.unref();

  const settleOnce = (endMonoMs: number, flags?: BudgetSettleFlags) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    input.settle(endMonoMs, flags);
  };

  const confirmDisconnect = () => {
    settleOnce(input.now(), { clientDisconnected: true });
  };

  input.res.once("finish", () => {
    if (clientGone) return;
    settleOnce(input.now());
  });

  input.res.once("close", () => {
    if (settled) return;
    clientGone = true;
    input.onDisconnected();
    const upstream = input.getUpstream();
    if (!upstream || upstream.destroyed) {
      confirmDisconnect();
      return;
    }
    upstream.once("close", () => confirmDisconnect());
    try {
      upstream.destroy(new Error("client_disconnected"));
    } catch {
      confirmDisconnect();
    }
  });
}
