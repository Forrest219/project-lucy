/**
 * P1-81 — bounded two-priority executor with a guaranteed share for the lower priority.
 *
 * Root cause (f5e4b14d, display-probe.log): metadata passes (high priority) were queued
 * back-to-back for 20 minutes, so the full-digest pass (normal priority) never got a slot.
 * The digest watermark stopped advancing, the 180 s grace expired and every display read
 * became a 503 until the process was restarted.
 *
 * Contract: high priority still goes first, but while normal-priority work is waiting, at
 * most `maxConsecutiveHigh` high-priority jobs run in a row before one normal job is taken.
 * Concurrency stays bounded and the order is deterministic (no clock dependence).
 */
export type SchedulerPriority = "high" | "normal";

type Queued = { run: () => void };

export type PrioritySchedulerStats = { active: number; peak: number; queuedHigh: number; queuedNormal: number; normalShareDispatches: number };

export function createSharedPriorityScheduler(options: { concurrency: number; maxConsecutiveHigh: number }) {
  const high: Queued[] = [];
  const normal: Queued[] = [];
  let active = 0;
  let peak = 0;
  let highStreak = 0;
  let normalShareDispatches = 0;

  function next(): Queued | undefined {
    if (normal.length > 0 && (high.length === 0 || highStreak >= options.maxConsecutiveHigh)) {
      if (high.length > 0) normalShareDispatches += 1;
      highStreak = 0;
      return normal.shift();
    }
    const job = high.shift();
    if (job) highStreak += 1;
    return job;
  }

  function drain(): void {
    while (active < options.concurrency) {
      const job = next();
      if (!job) return;
      active += 1;
      if (active > peak) peak = active;
      job.run();
    }
  }

  function run<T>(fn: () => Promise<T>, priority: SchedulerPriority): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const job: Queued = {
        run: () => {
          let started: Promise<T>;
          try {
            started = fn();
          } catch (error) {
            started = Promise.reject(error);
          }
          const release = () => {
            active -= 1;
            drain();
          };
          started.then(
            (value) => { release(); resolve(value); },
            (error) => { release(); reject(error); }
          );
        }
      };
      (priority === "high" ? high : normal).push(job);
      drain();
    });
  }

  return {
    run,
    stats: (): PrioritySchedulerStats => ({ active, peak, queuedHigh: high.length, queuedNormal: normal.length, normalShareDispatches })
  };
}
