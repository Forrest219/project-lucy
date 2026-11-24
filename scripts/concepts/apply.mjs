import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { safeConceptPath, resolveFencedConceptsDir } from "./store.mjs";

export function fingerprintBytes(buf) {
  if (buf == null) return "ABSENT";
  return createHash("sha256").update(buf).digest("hex");
}

/**
 * Apply a multi-target concept write plan atomically (D14).
 * Each target: { conceptId, beforeBytes: Buffer|null, afterBytes: Buffer }
 * On any failure after partial rename: restore before images (or unlink if ABSENT).
 */
export function applyConceptPlan(conceptsDir, targets) {
  const dir = resolveFencedConceptsDir(conceptsDir);
  if (!Array.isArray(targets) || targets.length === 0) {
    return { applied: 0 };
  }

  const staged = [];
  const renamed = [];
  try {
    for (const t of targets) {
      const target = safeConceptPath(dir, t.conceptId);
      const tmp = path.join(dir, `.${t.conceptId}.${process.pid}.${Date.now()}.${staged.length}.tmp`);
      const fd = fs.openSync(tmp, "w");
      try {
        fs.writeSync(fd, t.afterBytes);
        fs.fsyncSync(fd);
      } finally {
        fs.closeSync(fd);
      }
      staged.push({ target, tmp, conceptId: t.conceptId, beforeBytes: t.beforeBytes ?? null });
    }

    for (const s of staged) {
      fs.renameSync(s.tmp, s.target);
      renamed.push(s);
      try {
        const dfd = fs.openSync(dir, "r");
        try {
          fs.fsyncSync(dfd);
        } finally {
          fs.closeSync(dfd);
        }
      } catch {
        // best-effort dir fsync
      }
    }

    return { applied: renamed.length };
  } catch (err) {
    for (const s of staged) {
      try {
        if (fs.existsSync(s.tmp)) fs.unlinkSync(s.tmp);
      } catch {
        // ignore
      }
    }
    for (const s of renamed) {
      try {
        if (s.beforeBytes == null) {
          if (fs.existsSync(s.target)) fs.unlinkSync(s.target);
        } else {
          const fd = fs.openSync(s.target, "w");
          try {
            fs.writeSync(fd, s.beforeBytes);
            fs.fsyncSync(fd);
          } finally {
            fs.closeSync(fd);
          }
        }
      } catch {
        // best-effort restore; surface original error
      }
    }
    throw err;
  }
}

/** Verify on-disk bytes match planned after images (D23). */
export function verifyConceptPlanAfterImages(conceptsDir, targets) {
  const dir = resolveFencedConceptsDir(conceptsDir);
  const members = [];
  for (const t of targets) {
    const file = safeConceptPath(dir, t.conceptId);
    let state = "succeeded";
    if (!fs.existsSync(file)) {
      state = "failed";
    } else {
      const got = fs.readFileSync(file);
      if (fingerprintBytes(got) !== fingerprintBytes(t.afterBytes)) state = "failed";
    }
    members.push({ id: `concept:${t.conceptId}`, state });
  }
  return { members };
}
