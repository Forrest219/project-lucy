import { readdir, lstat } from "node:fs/promises";
import path from "node:path";
import { assertReadable, safeRemove } from "./fs-safe";

/** AppleDouble / Finder junk that ktx sl validate incorrectly parses as YAML. */
export function isSemanticLayerJunkName(name: string): boolean {
  return name === ".DS_Store" || name.startsWith("._");
}

/**
 * Best-effort removal of Finder/AppleDouble junk under `semantic-layer/`.
 * Spec 115: call before `ktx sl validate` so `._*.yaml` cannot fail the gate.
 */
export async function scrubSemanticLayerJunk(projectRoot: string): Promise<string[]> {
  const removed: string[] = [];

  async function walk(relDir: string): Promise<void> {
    let absDir: string;
    try {
      absDir = await assertReadable(projectRoot, relDir);
    } catch {
      return;
    }

    let entries: string[];
    try {
      entries = await readdir(absDir);
    } catch {
      return;
    }

    for (const name of entries) {
      const childRel = path.posix.join(relDir.replaceAll(path.sep, "/"), name);
      let childAbs: string;
      try {
        childAbs = path.join(absDir, name);
        const st = await lstat(childAbs);
        if (st.isSymbolicLink()) {
          continue;
        }
        if (st.isDirectory()) {
          await walk(childRel);
          continue;
        }
        if (st.isFile() && isSemanticLayerJunkName(name)) {
          try {
            await safeRemove(projectRoot, childRel);
            removed.push(childRel);
          } catch {
            // best-effort: continue scrubbing other junk
          }
        }
      } catch {
        // skip unreadable entries
      }
    }
  }

  await walk("semantic-layer");
  return removed;
}
