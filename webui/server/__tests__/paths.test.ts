import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ensureContentDirs,
  invalidateContentPathsCache,
  resolveContentPaths
} from "../paths";

let tempRoot: string | undefined;

async function makeTempProject(ktxYaml: string | null): Promise<string> {
  tempRoot = await mkdtemp(path.join(os.tmpdir(), "lucy-paths-"));
  if (ktxYaml !== null) {
    await writeFile(path.join(tempRoot, "ktx.yaml"), ktxYaml, "utf8");
  }
  return tempRoot;
}

beforeEach(() => {
  delete process.env.LUCY_CONTENT_ROOT;
  invalidateContentPathsCache();
});

afterEach(async () => {
  if (tempRoot) {
    await rm(tempRoot, { recursive: true, force: true });
    tempRoot = undefined;
  }
});

describe("resolveContentPaths — default", () => {
  it("falls back to <projectRoot>/config/ when neither env nor ktx.yaml set it", async () => {
    const root = await makeTempProject("connections: {}\n");
    const paths = await resolveContentPaths(root);
    expect(paths.configDir).toBe(path.join(root, "config"));
    expect(paths.semanticLayer).toBe(path.join(root, "config", "semantic-layer"));
    expect(paths.wiki).toBe(path.join(root, "config", "wiki"));
    expect(paths.evals).toBe(path.join(root, "config", "evals"));
    expect(paths.skills).toBe(path.join(root, "config", "skills"));
    expect(paths.source).toBe("default");
  });

  it("works when ktx.yaml is missing (defaults still apply)", async () => {
    const root = await makeTempProject(null);
    const paths = await resolveContentPaths(root);
    expect(paths.configDir).toBe(path.join(root, "config"));
    expect(paths.source).toBe("default");
  });
});

describe("resolveContentPaths — LUCY_CONTENT_ROOT env var", () => {
  it("honours an absolute path verbatim", async () => {
    const root = await makeTempProject("connections: {}\n");
    process.env.LUCY_CONTENT_ROOT = "/opt/lucy-content";
    const paths = await resolveContentPaths(root);
    expect(paths.configDir).toBe("/opt/lucy-content");
    expect(paths.source).toBe("env");
  });

  it("resolves a relative path against projectRoot", async () => {
    const root = await makeTempProject("connections: {}\n");
    process.env.LUCY_CONTENT_ROOT = "./content";
    const paths = await resolveContentPaths(root);
    expect(paths.configDir).toBe(path.join(root, "content"));
    expect(paths.source).toBe("env");
  });

  it("wins over ktx.yaml paths.content_root", async () => {
    const root = await makeTempProject(
      ["connections: {}", "paths:", "  content_root: ./from-yaml"].join("\n")
    );
    process.env.LUCY_CONTENT_ROOT = "./from-env";
    const paths = await resolveContentPaths(root);
    expect(paths.configDir).toBe(path.join(root, "from-env"));
    expect(paths.source).toBe("env");
  });

  it("ignores an empty string (treats as unset)", async () => {
    const root = await makeTempProject("connections: {}\n");
    process.env.LUCY_CONTENT_ROOT = "   ";
    const paths = await resolveContentPaths(root);
    expect(paths.source).toBe("default");
  });
});

describe("resolveContentPaths — ktx.yaml paths.content_root", () => {
  it("honours a relative paths.content_root", async () => {
    const root = await makeTempProject(
      ["connections: {}", "paths:", "  content_root: ./shared-config"].join("\n")
    );
    const paths = await resolveContentPaths(root);
    expect(paths.configDir).toBe(path.join(root, "shared-config"));
    expect(paths.source).toBe("yaml");
  });

  it("honours an absolute paths.content_root", async () => {
    const root = await makeTempProject(
      ["paths:", "  content_root: /var/lucy"].join("\n")
    );
    const paths = await resolveContentPaths(root);
    expect(paths.configDir).toBe("/var/lucy");
    expect(paths.source).toBe("yaml");
  });

  it("ignores paths block with no content_root key", async () => {
    const root = await makeTempProject(
      ["connections: {}", "paths:", "  other_key: foo"].join("\n")
    );
    const paths = await resolveContentPaths(root);
    expect(paths.source).toBe("default");
  });

  it("survives a malformed ktx.yaml (falls back to default)", async () => {
    const root = await makeTempProject("connections: { malformed: [");
    const paths = await resolveContentPaths(root);
    expect(paths.source).toBe("default");
  });
});

describe("ensureContentDirs", () => {
  it("mkdir -p the four content subdirs", async () => {
    const root = await makeTempProject(null);
    const configDir = path.join(root, "fresh-config");
    const paths = {
      configDir,
      semanticLayer: path.join(configDir, "semantic-layer"),
      wiki: path.join(configDir, "wiki"),
      evals: path.join(configDir, "evals"),
      skills: path.join(configDir, "skills"),
      source: "default" as const
    };
    await ensureContentDirs(paths);
    for (const name of ["semantic-layer", "wiki", "evals", "skills"]) {
      expect(existsSync(path.join(configDir, name))).toBe(true);
    }
  });

  it("is idempotent on existing dirs", async () => {
    const root = await makeTempProject(null);
    const configDir = path.join(root, "already-here");
    await mkdir(configDir, { recursive: true });
    await mkdir(path.join(configDir, "skills"), { recursive: true });
    const paths = {
      configDir,
      semanticLayer: path.join(configDir, "semantic-layer"),
      wiki: path.join(configDir, "wiki"),
      evals: path.join(configDir, "evals"),
      skills: path.join(configDir, "skills"),
      source: "default" as const
    };
    await expect(ensureContentDirs(paths)).resolves.toBeUndefined();
    expect(existsSync(path.join(configDir, "skills"))).toBe(true);
  });
});