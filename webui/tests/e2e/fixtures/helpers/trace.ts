// webui/tests/e2e/fixtures/helpers/trace.ts
// 关联主文档：docs/qa/lucy-webui-e2e-test-suite.md §4
// 截图 / trace 落盘 helper

import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Page } from "@playwright/test";

const ARTIFACTS = process.env.LUCY_E2E_ARTIFACTS ?? "webui/tests/e2e/artifacts";
const RUN_ID = process.env.LUCY_E2E_RUN_ID ?? `local-${Date.now()}`;

export function artifactPath(caseId: string, step: string): string {
  const dir = resolve(ARTIFACTS, RUN_ID, caseId);
  mkdirSync(dir, { recursive: true });
  return resolve(dir, `${step}.png`);
}

export function writeArtifact(caseId: string, name: string, content: string): string {
  const dir = resolve(ARTIFACTS, RUN_ID, caseId);
  mkdirSync(dir, { recursive: true });
  const p = resolve(dir, name);
  writeFileSync(p, content, "utf-8");
  return p;
}

/**
 * 在关键 step 截图。
 */
export async function shot(page: Page, caseId: string, step: string): Promise<string> {
  const p = artifactPath(caseId, step);
  await page.screenshot({ path: p, fullPage: true });
  return p;
}
