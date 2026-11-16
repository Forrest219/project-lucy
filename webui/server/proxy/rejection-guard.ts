/**
 * P1-37 U2 — 被拒请求的指纹与「请勿原样重试」状态。
 *
 * - `rejection_fingerprint`：`rf1:<HMAC-SHA256(服务端密钥, canonical 入参) 前 16 位十六进制>`。
 *   必须带密钥：过滤值、实体名等低熵数据可被离线字典反推，而审计里的 `args_summary`
 *   刻意去值，新列不得重新提供等价探针。密钥存于服务端密钥文件，不入审计库与导出；
 *   轮换时版本前缀递增（`rf2:`…），M3 只在同一版本前缀内比较。
 * - `RepeatRejectionTracker`：键＝（身份，下游会话作用域，工具，指纹，理由，policy_version）；
 *   只存摘要；TTL 60 s；单身份 ≤ 64、全局 ≤ 1024 的 LRU；policy_version 变化即不再命中。
 */
import { createHmac, randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { resolveProjectRoot } from "../project.js";

export const FINGERPRINT_VERSION_PREFIX = "rf1:";
const KEY_REL = ".ktx-ui/rejection-fingerprint.key";
const MIN_KEY_BYTES = 32;

/** 对象键排序、数组保持语义顺序的确定性 JSON。 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).filter((key) => record[key] !== undefined).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
}

let keyCache: string | null = null;

/** 测试辅助：清空进程内密钥缓存。 */
export function resetRejectionFingerprintKeyCache(): void {
  keyCache = null;
}

async function loadOrCreateKey(): Promise<string> {
  const fromEnv = process.env.LUCY_REJECTION_FINGERPRINT_KEY?.trim();
  if (fromEnv && Buffer.byteLength(fromEnv, "utf8") >= MIN_KEY_BYTES) return fromEnv;
  if (keyCache) return keyCache;
  const abs = path.join(await resolveProjectRoot(), KEY_REL);
  try {
    const existing = (await readFile(abs, "utf8")).trim();
    if (Buffer.byteLength(existing, "utf8") >= MIN_KEY_BYTES) {
      keyCache = existing;
      return existing;
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const created = randomBytes(32).toString("hex");
  await mkdir(path.dirname(abs), { recursive: true });
  try {
    await writeFile(abs, `${created}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    const existing = (await readFile(abs, "utf8")).trim();
    if (Buffer.byteLength(existing, "utf8") < MIN_KEY_BYTES) throw error;
    keyCache = existing;
    return existing;
  }
  keyCache = created;
  return created;
}

/** 失败返回 undefined（密钥不可用时不得影响拒绝响应本身，只是该行没有指纹）。 */
export async function computeRejectionFingerprint(canonicalArgs: unknown): Promise<string | undefined> {
  try {
    const key = await loadOrCreateKey();
    const digest = createHmac("sha256", key).update(canonicalJson(canonicalArgs)).digest("hex");
    return `${FINGERPRINT_VERSION_PREFIX}${digest.slice(0, 16)}`;
  } catch {
    return undefined;
  }
}

export type RejectionKeyParts = {
  identityId: string;
  sessionScope: string;
  tool: string;
  fingerprint: string;
  reason: string;
  policyVersion: string;
};

export const REPEAT_REJECTION_TTL_MS = 60_000;
export const REPEAT_REJECTION_PER_IDENTITY_MAX = 64;
export const REPEAT_REJECTION_GLOBAL_MAX = 1024;

type Entry = { identityId: string; at: number };

export class RepeatRejectionTracker {
  /** Map 的插入序即 LRU 序（命中／写入时先删后插）。 */
  private readonly entries = new Map<string, Entry>();

  constructor(
    private readonly options: {
      ttlMs?: number;
      perIdentityMax?: number;
      globalMax?: number;
      now?: () => number;
    } = {}
  ) {}

  private get ttl(): number { return this.options.ttlMs ?? REPEAT_REJECTION_TTL_MS; }
  private get perIdentityMax(): number { return this.options.perIdentityMax ?? REPEAT_REJECTION_PER_IDENTITY_MAX; }
  private get globalMax(): number { return this.options.globalMax ?? REPEAT_REJECTION_GLOBAL_MAX; }
  private now(): number { return this.options.now?.() ?? Date.now(); }

  static key(parts: RejectionKeyParts): string {
    return JSON.stringify([
      parts.identityId, parts.sessionScope, parts.tool, parts.fingerprint, parts.reason, parts.policyVersion
    ]);
  }

  /** 60 s 内同键已有一次被拒记录。只读，不刷新 LRU 位置与 TTL。 */
  isRepeated(parts: RejectionKeyParts): boolean {
    const entry = this.entries.get(RepeatRejectionTracker.key(parts));
    return entry !== undefined && this.now() - entry.at <= this.ttl;
  }

  remember(parts: RejectionKeyParts): void {
    const now = this.now();
    const key = RepeatRejectionTracker.key(parts);
    this.entries.delete(key);
    this.entries.set(key, { identityId: parts.identityId, at: now });
    this.evict(parts.identityId, now);
  }

  get size(): number { return this.entries.size; }

  private evict(identityId: string, now: number): void {
    for (const [key, entry] of this.entries) {
      if (now - entry.at > this.ttl) this.entries.delete(key);
      else break; // 插入序即时间序：越靠后越新，遇到未过期即可停止
    }
    let own = 0;
    for (const entry of this.entries.values()) if (entry.identityId === identityId) own += 1;
    for (const [key, entry] of this.entries) {
      if (own <= this.perIdentityMax) break;
      if (entry.identityId !== identityId) continue;
      this.entries.delete(key);
      own -= 1;
    }
    for (const key of this.entries.keys()) {
      if (this.entries.size <= this.globalMax) break;
      this.entries.delete(key);
    }
  }
}

/** 重复被拒时追加的提示：只说「相同请求刚被拒绝」，不透露他人细节。 */
export const REPEAT_REJECTION_HINT =
  "The same request was just rejected. Do not retry it unchanged; change the arguments as described above or use a different tool.";

/** 进程内共享实例。 */
export const repeatRejections = new RepeatRejectionTracker();
