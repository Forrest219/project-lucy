import { timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";

export type BootstrapTokenCheck = "ok" | "not_provisioned" | "invalid";

/** Returns the provisioned bootstrap secret, or null when missing/unreadable/blank. */
async function readProvisionedToken(): Promise<string | null> {
  const file = process.env.LUCY_WEBUI_BOOTSTRAP_TOKEN_FILE?.trim();
  if (!file) return null;
  try {
    const value = (await readFile(file, "utf8")).trim();
    return value === "" ? null : value;
  } catch {
    return null;
  }
}

function constantTimeEquals(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  // timingSafeEqual requires equal lengths; compare against self on mismatch so the work is constant.
  if (left.length !== right.length) {
    timingSafeEqual(left, left);
    return false;
  }
  return timingSafeEqual(left, right);
}

/** Spec §3.1 items 3–4 (A0 scope): file-provisioned secret submitted via X-Lucy-Bootstrap-Token. */
export async function checkBootstrapToken(presented: string | string[] | undefined): Promise<BootstrapTokenCheck> {
  const expected = await readProvisionedToken();
  if (expected === null) return "not_provisioned";
  const value = Array.isArray(presented) ? presented[0] : presented;
  if (typeof value !== "string" || value === "") return "invalid";
  return constantTimeEquals(value.trim(), expected) ? "ok" : "invalid";
}
