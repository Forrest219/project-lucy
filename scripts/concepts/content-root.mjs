import fs from "node:fs";
import path from "node:path";
import { parse as parseYaml } from "yaml";

/**
 * Resolve project root: --project > KTX_PROJECT_ROOT|LUCY_PROJECT_ROOT > walkUp(cwd) for ktx.yaml
 */
export function resolveProjectRoot({ projectFlag, cwd = process.cwd(), env = process.env } = {}) {
  if (projectFlag) {
    const abs = path.resolve(cwd, projectFlag);
    if (!fs.existsSync(path.join(abs, "ktx.yaml"))) {
      throw new Error(`project root missing ktx.yaml: ${abs}`);
    }
    return abs;
  }
  const envRoot = (env.KTX_PROJECT_ROOT || env.LUCY_PROJECT_ROOT || "").trim();
  if (envRoot) {
    const abs = path.resolve(envRoot);
    if (!fs.existsSync(path.join(abs, "ktx.yaml"))) {
      throw new Error(`project root missing ktx.yaml: ${abs}`);
    }
    return abs;
  }
  let dir = path.resolve(cwd);
  for (;;) {
    if (fs.existsSync(path.join(dir, "ktx.yaml"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error("cannot resolve project root (no ktx.yaml found)");
}

function readKtxContentRoot(projectRoot) {
  const ktxPath = path.join(projectRoot, "ktx.yaml");
  if (!fs.existsSync(ktxPath)) return null;
  const doc = parseYaml(fs.readFileSync(ktxPath, "utf8"));
  const value = doc?.paths?.content_root;
  if (typeof value !== "string" || !value.trim()) return null;
  return value.trim();
}

/**
 * Content root: --content-root > LUCY_CONTENT_ROOT > ktx paths.content_root > <projectRoot>/config
 */
export function resolveContentRoot({
  contentRootFlag,
  projectFlag,
  cwd = process.cwd(),
  env = process.env,
  requireReadable = true,
} = {}) {
  const projectRoot = resolveProjectRoot({ projectFlag, cwd, env });
  let contentRoot;
  if (contentRootFlag) {
    contentRoot = path.resolve(cwd, contentRootFlag);
  } else if ((env.LUCY_CONTENT_ROOT || "").trim()) {
    contentRoot = path.resolve(projectRoot, env.LUCY_CONTENT_ROOT.trim());
  } else {
    const yamlValue = readKtxContentRoot(projectRoot);
    if (yamlValue) {
      contentRoot = path.isAbsolute(yamlValue)
        ? yamlValue
        : path.resolve(projectRoot, yamlValue);
    } else {
      contentRoot = path.join(projectRoot, "config");
    }
  }
  if (requireReadable) {
    if (!fs.existsSync(contentRoot) || !fs.statSync(contentRoot).isDirectory()) {
      throw new Error(`content root missing or not a directory: ${contentRoot}`);
    }
    try {
      fs.accessSync(contentRoot, fs.constants.R_OK);
    } catch {
      throw new Error(`content root not readable: ${contentRoot}`);
    }
  }
  return { projectRoot, contentRoot };
}

export function conceptsDir(contentRoot) {
  return path.join(contentRoot, "concepts");
}
