// In-memory secret handling for real-user E2E (Spec §6.5 step 4, SEC-06).
// Secrets live only in this process. They are never written to a trace, screenshot, annotation, console line
// or file. The vault can redact text and scan retained artifacts for any registered value.

import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

export class SecretVault {
  private readonly secrets = new Set<string>();

  register<T extends string>(value: T): T {
    if (value && value.length >= 8) this.secrets.add(value);
    return value;
  }

  /** Replaces every registered secret in `text`; use before putting any text in an assertion message. */
  redact(text: string): string {
    let out = text;
    for (const secret of this.secrets) out = out.split(secret).join("[REDACTED]");
    return out;
  }

  contains(text: string): boolean {
    for (const secret of this.secrets) if (text.includes(secret)) return true;
    return false;
  }

  /** Short digest for correlation with server-side Token fingerprints; never reveals the value. */
  fingerprint(value: string): string {
    return createHash("sha256").update(value).digest("hex").slice(0, 12);
  }

  get size(): number {
    return this.secrets.size;
  }
}

export const vault = new SecretVault();

/** Scans every retained artifact file under `dir` for a registered secret; returns relative paths with a hit. */
export function scanArtifacts(dir: string, secretValues: Iterable<string>): { scanned: number; hits: string[] } {
  const secrets = [...secretValues].filter(Boolean);
  const hits: string[] = [];
  let scanned = 0;
  if (!existsSync(dir)) return { scanned, hits };
  const walk = (current: string) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (statSync(full).size < 64 * 1024 * 1024) {
        scanned += 1;
        const content = readFileSync(full);
        if (secrets.some((secret) => content.includes(secret))) hits.push(path.relative(dir, full));
      }
    }
  };
  walk(dir);
  return { scanned, hits };
}
