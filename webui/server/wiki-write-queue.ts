/**
 * Spec 193 §8.1 / Plan M66 Task 2 — the one in-process Wiki write queue.
 *
 * Every Wiki write that can touch a document, the shared version index, the
 * directory metadata or an authorization fact runs inside this queue:
 *
 * - document create / save (including a combined body + ACL save),
 * - upload create / replace,
 * - single-document authorization save,
 * - bulk authorization save,
 * - version restore,
 * - document move / delete,
 * - directory rename (and the empty-directory delete).
 *
 * The queue is process-local by design. It is NOT a distributed lock and it
 * does NOT provide cross-process compare-and-swap: direct filesystem edits and
 * multiple WebUI processes writing the same content directory remain
 * unsupported multi-writer topologies (Spec 193 §8.1).
 *
 * Contract for callers:
 *
 * - Public entry points only obtain the queue.
 * - Composite operations call explicitly named `...Unlocked` helpers; a helper
 *   documents that the caller already holds the queue and MUST NOT re-enter it.
 * - The candidate content and the version check are always derived from the
 *   SAME read that happens inside the queue callback. A preview performed
 *   before the queue was entered is never used as the write source.
 */

let wikiWriteTail: Promise<unknown> = Promise.resolve();

/** Nesting depth of the currently running queue callback. */
let wikiWriteDepth = 0;

/**
 * Run `fn` with exclusive access to the Wiki write queue.
 *
 * A rejected writer never poisons the queue: the tail always settles.
 */
export function withWikiWriteQueue<T>(fn: () => Promise<T>): Promise<T> {
  const run = wikiWriteTail.then(
    async () => {
      wikiWriteDepth += 1;
      try {
        return await fn();
      } finally {
        wikiWriteDepth -= 1;
      }
    },
    async () => {
      wikiWriteDepth += 1;
      try {
        return await fn();
      } finally {
        wikiWriteDepth -= 1;
      }
    }
  );
  wikiWriteTail = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

/** Test seam: true while a queue callback is running. */
export function isWikiWriteQueueHeld(): boolean {
  return wikiWriteDepth > 0;
}
