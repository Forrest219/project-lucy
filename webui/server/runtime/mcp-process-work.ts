import { AsyncLocalStorage } from "node:async_hooks";
import type { ClientRequest, ServerResponse } from "node:http";
import { tryAdmitBusinessWork } from "./process-drain.js";

/** Real upstream handles belong to the accepted RPC, not the client socket. */
const activeWork = new AsyncLocalStorage<Set<Promise<void>>>();

export function trackMcpUpstreamWork(request: ClientRequest): void {
  const work = activeWork.getStore();
  if (!work) return; // An idle GET/SSE is not a business RPC.
  const closed = new Promise<void>((resolve) => request.once("close", resolve));
  work.add(closed);
  void closed.then(() => work.delete(closed));
}

/** Call synchronously before admission's first await. */
export function admitMcpProcessWork(res: ServerResponse) {
  const admitted = tryAdmitBusinessWork();
  if (!admitted.ok) return admitted;
  const work = new Set<Promise<void>>();
  let finish!: () => void;
  const settled = new Promise<void>((resolve) => { finish = resolve; });
  admitted.ticket.registerSettle(() => settled);
  const responseSettled = new Promise<void>((resolve) => {
    const done = () => {
      res.off("finish", done);
      res.off("close", done);
      resolve();
    };
    res.once("finish", done);
    res.once("close", done);
  });
  return {
    ok: true as const,
    run: async (handler: () => Promise<void>) => {
      try {
        await activeWork.run(work, handler);
      } finally {
        // A post-start exception / client close cannot retire accepted upstream work.
        while (work.size > 0) await Promise.all([...work]);
        await responseSettled; // Includes the asynchronous durable response gate.
        finish();
        await admitted.ticket.retireWhenSettled();
      }
    }
  };
}
