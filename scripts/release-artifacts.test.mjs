import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  A3_NPM_SCRIPTS,
  createSourceBundle,
  SOURCE_BUNDLE_NAME,
  SOURCE_BUNDLE_STRIPPED_NPM_SCRIPTS,
  stripSourceBundleScriptsFromPackageJson
} from "./release-artifacts.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("release-artifacts A3 customer-bundle hygiene", () => {
  it("strips commands whose implementation is absent from the source bundle", () => {
    const input = {
      name: "x",
      scripts: {
        "smoke:p0": "node a",
        "smoke:p0:delivery-isolation": "node scripts/lucy-delivery-isolation-smoke.mjs",
        "smoke:p0:delivery-isolation:test": "node --test scripts/lucy-delivery-isolation-smoke.test.mjs",
        "smoke:agent-chat:a3": "node b",
        "smoke:agent-chat:a3:test": "node c"
      }
    };
    const out = stripSourceBundleScriptsFromPackageJson(input);
    assert.equal(out.scripts["smoke:p0"], "node a");
    assert.equal(out.scripts["smoke:p0:delivery-isolation"], "node scripts/lucy-delivery-isolation-smoke.mjs");
    for (const key of SOURCE_BUNDLE_STRIPPED_NPM_SCRIPTS) {
      assert.equal(out.scripts[key], undefined);
    }
    assert.equal(input.scripts["smoke:agent-chat:a3"], "node b");
  });

  it("createSourceBundle strips A3 scripts in tar only; repo root package.json unchanged", async () => {
    const rootPkgPath = path.join(ROOT, "package.json");
    const before = await readFile(rootPkgPath, "utf8");
    const beforeHash = createHash("sha256").update(before).digest("hex");
    assert.match(before, /smoke:agent-chat:a3/);

    const outDir = await mkdtemp(path.join(tmpdir(), "lucy-release-a3-"));
    try {
      await createSourceBundle(outDir);
      const after = await readFile(rootPkgPath, "utf8");
      assert.equal(createHash("sha256").update(after).digest("hex"), beforeHash, "repo root package.json must not be rewritten");

      const extractDir = path.join(outDir, "extract");
      await mkdir(extractDir, { recursive: true });
      const tarPath = path.join(outDir, SOURCE_BUNDLE_NAME);
      const tar = spawnSync("tar", ["-xzf", tarPath, "-C", extractDir], { encoding: "utf8" });
      assert.equal(tar.status, 0, tar.stderr);

      const listing = spawnSync("tar", ["-tzf", tarPath], { encoding: "utf8" });
      assert.equal(listing.status, 0);
      assert.doesNotMatch(listing.stdout, /agent-chat\//);
      assert.doesNotMatch(listing.stdout, /agent-chat-a3/);
      assert.doesNotMatch(listing.stdout, /docker-compose\.agent-chat\.yml/);
      assert.doesNotMatch(listing.stdout, /docker-compose\.demo\.yml/);
      assert.doesNotMatch(listing.stdout, /docker-compose\.postgres-demo\.yml/);
      assert.doesNotMatch(listing.stdout, /ktx\.yaml\.example/);
      assert.doesNotMatch(listing.stdout, /lucy-docker-source-bundle\/examples\//);
      assert.doesNotMatch(listing.stdout, /lucy-docker-source-bundle\/evals\//);
      assert.doesNotMatch(listing.stdout, /lucy-docker-source-bundle\/webui\/config\/access\.yaml(?:\n|$)/);
      assert.match(listing.stdout, /customer-config\.example\/webui\/config\/access\.yaml/);
      assert.match(listing.stdout, /customer-config\.example\//);
      assert.match(listing.stdout, /webui\/config\/data-qa-instructions\.md/);
      assert.match(listing.stdout, /scripts\/lucy-delivery-isolation-smoke\.mjs/);

      const stagedPkg = JSON.parse(
        await readFile(path.join(extractDir, "lucy-docker-source-bundle", "package.json"), "utf8")
      );
      for (const key of A3_NPM_SCRIPTS) {
        assert.equal(stagedPkg.scripts?.[key], undefined, `staged package.json must not include ${key}`);
      }
      assert.equal(
        stagedPkg.scripts?.["smoke:p0:delivery-isolation"],
        "node scripts/lucy-delivery-isolation-smoke.mjs"
      );
      assert.equal(stagedPkg.scripts?.["smoke:p0:delivery-isolation:test"], undefined);
      const stagedRoot = path.join(extractDir, "lucy-docker-source-bundle");
      const isolation = spawnSync("npm", ["run", "smoke:p0:delivery-isolation"], {
        cwd: stagedRoot,
        encoding: "utf8"
      });
      assert.equal(isolation.status, 0, isolation.stderr || isolation.stdout);
      assert.match(isolation.stdout, /"status": "pass"/);

      const layers = await readFile(path.join(ROOT, "docs/test-layers-and-release-gates.md"), "utf8");
      const deploy = await readFile(path.join(ROOT, "docs/deployment-docker.md"), "utf8");
      assert.doesNotMatch(layers, /npm run smoke:agent-chat:a3/);
      assert.doesNotMatch(deploy, /docs\/runbook-lucy-agent-chat-a3\.md/);
      assert.doesNotMatch(deploy, /docker-compose\.agent-chat\.yml/);
    } finally {
      await rm(outDir, { recursive: true, force: true });
    }
  });
});
