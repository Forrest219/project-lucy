/**
 * In-process, single-use OIDC login transactions (L25-06 Spec §4.3 / §6.1).
 *
 * A transaction holds the PKCE verifier, the nonce, the sanitized `returnTo` and
 * the configuration digest for one authorization attempt. It is consumed before it
 * is validated, so a replay can never reach the token exchange twice. Nothing is
 * written to disk: a restart drops every pending login and the user simply starts
 * again.
 */

export type OidcLoginTransaction = {
  nonce: string;
  verifier: string;
  returnTo: string;
  /** Digest of the profile the login started with; a changed profile fails closed. */
  profileDigest: string;
  expiresAt: number;
};

export type OidcTransactionStoreOptions = {
  ttlMs: number;
  maxEntries: number;
};

export class OidcTransactionStore {
  private readonly entries = new Map<string, OidcLoginTransaction>();
  private readonly ttlMs: number;
  private readonly maxEntries: number;

  constructor(options: OidcTransactionStoreOptions) {
    this.ttlMs = options.ttlMs;
    this.maxEntries = options.maxEntries;
  }

  private prune(now: number): void {
    for (const [key, value] of this.entries) {
      if (value.expiresAt <= now) this.entries.delete(key);
    }
  }

  /** Store one transaction. The oldest entry is dropped when the store is full. */
  putSingleUse(key: string, value: OidcLoginTransaction): void {
    const now = Date.now();
    this.prune(now);
    if (this.entries.size >= this.maxEntries) {
      const oldest = this.entries.keys().next();
      if (!oldest.done) this.entries.delete(oldest.value);
    }
    this.entries.set(key, { ...value, expiresAt: now + this.ttlMs });
  }

  /** Read without consuming. Used to decide whether a transaction-scoped rate bucket applies. */
  peek(key: string): OidcLoginTransaction | undefined {
    const value = this.entries.get(key);
    if (!value) return undefined;
    if (value.expiresAt <= Date.now()) {
      this.entries.delete(key);
      return undefined;
    }
    return value;
  }

  /**
   * Consume once. The entry is removed whether or not the caller goes on to
   * validate it, so a failed attempt cannot be replayed.
   */
  consumeOnce(key: string): OidcLoginTransaction | undefined {
    const value = this.entries.get(key);
    this.entries.delete(key);
    if (!value) return undefined;
    if (value.expiresAt <= Date.now()) return undefined;
    return value;
  }

  get size(): number {
    return this.entries.size;
  }
}
