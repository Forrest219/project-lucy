/** Leave response serialization/transport headroom below the API's 20s limit. */
export const SCHEMA_REQUEST_TIMEOUT_MS = 19_000;

export class SchemaReadTimeout extends Error {
  constructor() {
    super("Catalog query timed out: schema request deadline exceeded");
  }
}

/** One monotonic deadline shared by connection setup and every metadata probe. */
export class SchemaReadDeadline {
  private readonly end: number;
  constructor(
    timeoutMs: number,
    private readonly now: () => number = performance.now.bind(performance)
  ) {
    this.end = now() + timeoutMs;
  }
  remaining(): number {
    return Math.max(0, this.end - this.now());
  }
  timeout(requested: number): number {
    const left = this.remaining();
    if (left <= 0) throw new SchemaReadTimeout();
    return Math.max(1, Math.min(requested, Math.floor(left)));
  }
  async run<T>(operation: () => Promise<T>, cancel?: () => void): Promise<T> {
    const left = this.remaining();
    if (left <= 0) throw new SchemaReadTimeout();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const expiry = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          try {
            cancel?.();
          } catch {
            /* best-effort cleanup */
          }
          reject(new SchemaReadTimeout());
        }, left);
      });
      const result = await Promise.race([operation(), expiry]);
      if (this.remaining() <= 0) {
        try {
          cancel?.();
        } catch {
          /* best-effort cleanup */
        }
        throw new SchemaReadTimeout();
      }
      return result;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}
