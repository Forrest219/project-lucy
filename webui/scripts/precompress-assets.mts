/**
 * Spec 174 §6 — precompress built JS/CSS so the Lucy static server can serve
 * `.br` / `.gz` variants. Runs after `vite build`; only touches `dist/assets`
 * JS/CSS, never API payloads or uploaded branding files, and never
 * recompresses existing `.gz` / `.br` outputs.
 */
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { brotliCompressSync, constants, gzipSync } from "node:zlib";

export type PrecompressResult = { file: string; bytes: number; gzipBytes: number; brBytes: number };

export async function precompressAssets(assetsDir: string): Promise<PrecompressResult[]> {
  const results: PrecompressResult[] = [];
  const names = await readdir(assetsDir).catch(() => [] as string[]);
  for (const name of names.sort()) {
    if (!/\.(js|css)$/.test(name)) continue;
    const file = path.join(assetsDir, name);
    const raw = await readFile(file);
    const gzip = gzipSync(raw, { level: 9 });
    const br = brotliCompressSync(raw, {
      params: { [constants.BROTLI_PARAM_QUALITY]: 11, [constants.BROTLI_PARAM_SIZE_HINT]: raw.byteLength }
    });
    if (gzip.byteLength < raw.byteLength) await writeFile(`${file}.gz`, gzip);
    if (br.byteLength < raw.byteLength) await writeFile(`${file}.br`, br);
    results.push({ file: name, bytes: raw.byteLength, gzipBytes: gzip.byteLength, brBytes: br.byteLength });
  }
  return results;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const distDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "dist", "assets");
  precompressAssets(distDir)
    .then((results) => {
      const total = results.reduce((sum, item) => ({ raw: sum.raw + item.bytes, gz: sum.gz + item.gzipBytes }), { raw: 0, gz: 0 });
      console.log(`[precompress] ${results.length} JS/CSS assets, ${total.raw} B raw → ${total.gz} B gzip`);
    })
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}
