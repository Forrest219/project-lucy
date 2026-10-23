import { unlink } from "node:fs/promises";
import path from "node:path";

/** Spec 175: drop a leftover `.ktx-ui/license.yaml`. No backup, no migration. */
export async function removeLegacyLicenseFile(projectRoot: string): Promise<void> {
  const target = path.join(projectRoot, ".ktx-ui", "license.yaml");
  try {
    await unlink(target);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
}
