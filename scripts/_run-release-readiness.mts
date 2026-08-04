/**
 * 202608-GOV-06 P2-B — Runner invoked by generate-202608-release-readiness.mjs
 *
 * Reads current project facts and writes the bounded Markdown package to
 * the caller-provided outputPath.
 */
import { buildReleaseReadinessPackage, writeReleaseReadinessMarkdown } from "../webui/server/admin/release-readiness-package.ts";

const projectRoot = process.env._LRR_PROJECT_ROOT ?? process.cwd();
const outputPath = process.env._LRR_OUTPUT_PATH ?? "";

process.env.KTX_PROJECT_ROOT = projectRoot;

async function main(): Promise<void> {
  const pkg = await buildReleaseReadinessPackage();
  const result = await writeReleaseReadinessMarkdown(pkg, { outputPath });
  process.stdout.write(`${JSON.stringify({ path: result.path, bytes: result.bytes, sha256: result.sha256 })}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exit(1);
});
