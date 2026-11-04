/**
 * Spec 149 §5.4 / §5.5 / WO T3 / T6 — 内容根资产复制、Skill 与 Wiki。
 * Spec 20261104 §4.1 — 官方历史版本自愈升级（stock digest 白名单）。
 *
 * 覆盖：SC-09、SC-14、SC-16、SC-18；H1／H4／H5。
 */

import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parse } from "yaml";
import type { Identity } from "../proxy/identity";

/** 历史官方模板夹具（W0 Manifest / 旧 Skill / 旧 Wiki），字节与 stock digest 一致。 */
const FIXTURE_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "ops-evidence");
const W0_SCHEMA_FIXTURE = path.join(FIXTURE_DIR, "w0-schema-main.yaml");
const OLD_SKILL_FIXTURE = path.join(FIXTURE_DIR, "old-ops-questioning.skill.md");
const OLD_WIKI_FIXTURE = path.join(FIXTURE_DIR, "old-ops-questioning.wiki.md");

let projectRoot: string | undefined;
let contentRoot: string | undefined;
let previousRoot: string | undefined;
let previousContentRoot: string | undefined;

const ACCESS_YAML = `roles:
  demo_readonly:
    description: demo readonly
    allow:
      connections:
        - demo-mysql
      tools:
        - lucy_query
        - lucy_skill_read
        - lucy_skill_search
  lucy_ops_reader:
    description: ops evidence reader
    allow:
      connections:
        - lucy-ops
      tools:
        - lucy_query
        - lucy_skill_read
        - lucy_skill_search
users:
  - id: demo_agent
    name: Demo Agent
    enabled: true
    role: demo_readonly
    tokens: []
  - id: demo_ops
    name: Demo Ops
    enabled: true
    role: lucy_ops_reader
    tokens: []
defaults:
  deny_tools: []
`;

function identity(userId: string): Identity {
  return { userId, tokenLabel: "unit-test", tokenHashPrefix: "unit-test" };
}

async function loadModule<T>(specifier: string): Promise<T> {
  vi.resetModules();
  return (await import(specifier)) as T;
}

async function makeProject(): Promise<{ root: string; content: string }> {
  const root = await mkdtemp(path.join(os.tmpdir(), "lucy-ops-evidence-assets-"));
  const content = path.join(root, "content-root");
  await mkdir(path.join(root, "webui", "config"), { recursive: true });
  await mkdir(content, { recursive: true });
  await writeFile(
    path.join(root, "ktx.yaml"),
    "connections:\n  demo-mysql:\n    driver: mysql\n    enabled_tables: []\n",
    "utf8"
  );
  await writeFile(path.join(root, "webui", "config", "access.yaml"), ACCESS_YAML, "utf8");
  return { root, content };
}

beforeEach(async () => {
  previousRoot = process.env.KTX_PROJECT_ROOT;
  previousContentRoot = process.env.LUCY_CONTENT_ROOT;
});

afterEach(async () => {
  if (previousRoot === undefined) delete process.env.KTX_PROJECT_ROOT;
  else process.env.KTX_PROJECT_ROOT = previousRoot;
  if (previousContentRoot === undefined) delete process.env.LUCY_CONTENT_ROOT;
  else process.env.LUCY_CONTENT_ROOT = previousContentRoot;
  if (projectRoot) {
    await rm(projectRoot, { recursive: true, force: true });
    projectRoot = undefined;
  }
  contentRoot = undefined;
});

describe("Spec 149 §5.5 — 复制规则", () => {
  it("SC-09: 目标缺失则复制；字节相同则跳过；字节不同则保留并记冲突", async () => {
    const { root, content } = await makeProject();
    projectRoot = root;
    contentRoot = content;
    process.env.KTX_PROJECT_ROOT = root;
    process.env.LUCY_CONTENT_ROOT = content;

    const assets = await loadModule<typeof import("../ops-evidence/assets")>(
      "../ops-evidence/assets"
    );
    const paths = await loadModule<typeof import("../paths")>("../paths");
    const contentPaths = await paths.resolveContentPaths(root);

    const skillSpec = assets
      .opsEvidenceAssetSpecs()
      .find((spec) => spec.id === "skills/ops-questioning");
    expect(skillSpec).toBeDefined();

    // 缺失 → copied。
    const first = await assets.placeOpsEvidenceAsset(skillSpec!, contentPaths);
    expect(first.outcome).toBe("copied");
    const destPath = path.join(contentPaths.skills, skillSpec!.contentRelPath);
    expect((await readFile(destPath)).equals(await readFile(first.templatePath))).toBe(true);

    // 字节相同 → unchanged，且文件不被改写。
    const second = await assets.placeOpsEvidenceAsset(skillSpec!, contentPaths);
    expect(second.outcome).toBe("unchanged");

    // 三类「字节不同」：草稿 / roles_allowed: ["*"] / 损坏的 frontmatter。
    const variants: Array<{ label: string; content: string }> = [
      { label: "草稿", content: "---\nname: ops-questioning\nstatus: draft\n---\n\n草稿。\n" },
      {
        label: "roles_allowed 通配",
        content:
          "---\nname: ops-questioning\ntitle: 运维问数\ndomain: lucy-ops\nstatus: published\nroles_allowed: [\"*\"]\n---\n\n通配。\n"
      },
      { label: "损坏的 frontmatter", content: "---\nname: ops-questioning\n  bad: [\n---\n\n损坏。\n" }
    ];
    for (const variant of variants) {
      await writeFile(destPath, variant.content, "utf8");
      const before = await readFile(destPath);
      const result = await assets.placeOpsEvidenceAsset(skillSpec!, contentPaths);
      expect(result.outcome, variant.label).toBe("conflict");
      expect(await readFile(destPath), variant.label).toEqual(before);
    }
  });
});

describe("Spec 20261104 §4.1 — 官方历史 stock digest 与自愈升级", () => {
  it("H5: 识别登记的历史 digest；当前模板 digest ∉ stock（遍历全部资产）", async () => {
    const stock = await loadModule<typeof import("../ops-evidence/stock-digests")>(
      "../ops-evidence/stock-digests"
    );
    const assets = await loadModule<typeof import("../ops-evidence/assets")>(
      "../ops-evidence/assets"
    );

    // 登记在册的历史官方版本。
    expect(
      stock.isOpsEvidenceStockDigest(
        "semantic-layer/_schema",
        "ed5f9f8b952950366fe563982e5c1ef98b127992195483a82552880cbac43ec4"
      )
    ).toBe(true);
    expect(
      stock.isOpsEvidenceStockDigest(
        "skills/ops-questioning",
        "03c43e7b258a9116cc48e73a60fa3d37d0bf41bff998fd9f5a9c4317d5fbd4a4"
      )
    ).toBe(true);
    expect(
      stock.isOpsEvidenceStockDigest(
        "wiki/ops-questioning",
        "a286bcda4a18f0f4af28691b7e4d75f4d9973d7bb22a86d9001235ecc3fff2fe"
      )
    ).toBe(true);

    // 未登记的资产即使摘要相同也不认。
    expect(
      stock.isOpsEvidenceStockDigest(
        "semantic-layer/ops_calls",
        "ed5f9f8b952950366fe563982e5c1ef98b127992195483a82552880cbac43ec4"
      )
    ).toBe(false);
    expect(stock.isOpsEvidenceStockDigest("semantic-layer/_schema", "not-a-digest")).toBe(false);

    // H5：当前模板 digest 不得落在 stock 里（否则旧模板会被当成「当前版本」）。
    for (const spec of assets.opsEvidenceAssetSpecs()) {
      const bytes = await readFile(
        path.join(assets.OPS_EVIDENCE_TEMPLATE_ROOT, spec.templateRelPath)
      );
      const digest = stock.sha256Hex(bytes);
      expect(stock.isOpsEvidenceStockDigest(spec.id, digest), spec.id).toBe(false);
    }
  });

  it("官方历史版本 → upgraded 并覆盖为当前模板；定制版本 → conflict 且不改文件", async () => {
    const { root, content } = await makeProject();
    projectRoot = root;
    contentRoot = content;
    process.env.KTX_PROJECT_ROOT = root;
    process.env.LUCY_CONTENT_ROOT = content;

    const assets = await loadModule<typeof import("../ops-evidence/assets")>(
      "../ops-evidence/assets"
    );
    const paths = await loadModule<typeof import("../paths")>("../paths");
    const contentPaths = await paths.resolveContentPaths(root);

    const cases: Array<{ id: string; fixture: string; contentDir: "semanticLayer" | "skills" | "wiki" }> = [
      { id: "semantic-layer/_schema", fixture: W0_SCHEMA_FIXTURE, contentDir: "semanticLayer" },
      { id: "skills/ops-questioning", fixture: OLD_SKILL_FIXTURE, contentDir: "skills" },
      { id: "wiki/ops-questioning", fixture: OLD_WIKI_FIXTURE, contentDir: "wiki" }
    ];

    for (const testCase of cases) {
      const spec = assets.opsEvidenceAssetSpecs().find((item) => item.id === testCase.id);
      expect(spec, testCase.id).toBeDefined();
      const destPath = path.join(contentPaths[testCase.contentDir], spec!.contentRelPath);
      await mkdir(path.dirname(destPath), { recursive: true });
      await copyFile(testCase.fixture, destPath);

      // 历史官方版本 → upgraded：文件被当前模板覆盖。
      const upgraded = await assets.placeOpsEvidenceAsset(spec!, contentPaths);
      expect(upgraded.outcome, testCase.id).toBe("upgraded");
      expect(
        (await readFile(destPath)).equals(await readFile(upgraded.templatePath)),
        testCase.id
      ).toBe(true);

      // 再放一次 → unchanged（已是当前模板）。
      const again = await assets.placeOpsEvidenceAsset(spec!, contentPaths);
      expect(again.outcome, testCase.id).toBe("unchanged");

      // 定制内容 → conflict：文件保持原样。
      const custom = "---\nname: ops-questioning\nstatus: draft\n---\n\n定制。\n";
      await writeFile(destPath, custom, "utf8");
      const before = await readFile(destPath);
      const conflicted = await assets.placeOpsEvidenceAsset(spec!, contentPaths);
      expect(conflicted.outcome, testCase.id).toBe("conflict");
      expect(await readFile(destPath), testCase.id).toEqual(before);
    }
  });
});

describe("Spec 149 §5.4 / §5.5 — 模板内容", () => {
  it("SC-14: Skill 与 Wiki 的 ACL 只有 lucy_ops_reader，正文含五条规定", async () => {
    const assets = await loadModule<typeof import("../ops-evidence/assets")>(
      "../ops-evidence/assets"
    );
    const specs = assets.opsEvidenceAssetSpecs();
    const skill = specs.find((spec) => spec.id === "skills/ops-questioning");
    const wiki = specs.find((spec) => spec.id === "wiki/ops-questioning");
    expect(skill).toBeDefined();
    expect(wiki).toBeDefined();

    const skillText = await readFile(path.join(assets.OPS_EVIDENCE_TEMPLATE_ROOT, skill!.templateRelPath), "utf8");
    const wikiText = await readFile(path.join(assets.OPS_EVIDENCE_TEMPLATE_ROOT, wiki!.templateRelPath), "utf8");

    for (const [label, text] of [["Skill", skillText], ["Wiki", wikiText]] as const) {
      expect(text, label).toContain("只回答活跃 Agent");
      expect(text, label).toContain("不把 `token_label`");
      expect(text, label).toContain("业务活跃 Token");
      expect(text, label).toContain("访问账户不在本连接");
      expect(text, label).toContain("`call_day` 是 UTC 日历日");
      expect(text, label).toContain("生成 SQL 不作为默认分组");
      // 可问治理面：MECE／D23／日历窗／旧 Role。
      expect(text, label).toContain("窗口无记录");
      expect(text, label).toContain("D23");
      expect(text, label).toMatch(/日历|calendar_days/);
      // 禁止 `*` / demo_readonly / lucy_admin。
      expect(text, label).not.toContain('roles_allowed: ["*"]');
      expect(text, label).not.toContain("allowed_roles: [\"*\"]");
      expect(text, label).not.toContain("demo_readonly");
      expect(text, label).not.toContain("lucy_admin");
    }
    // 对象 ACL：Skill 用 roles_allowed，Wiki 用 allowed_roles，都只有运维问数角色。
    expect(skillText).toContain("roles_allowed: [lucy_ops_reader]");
    expect(skillText).not.toContain("allowed_roles:");
    expect(wikiText).toContain("allowed_roles: [lucy_ops_reader]");
    expect(wikiText).not.toContain("roles_allowed:");

    // Skill 的发布状态与前置条件（含 W1 源）。
    expect(skillText).toContain("status: published");
    expect(skillText).toContain("domain: lucy-ops");
    expect(skillText).toContain("- \"lucy-ops.ops_calls\"");
    expect(skillText).toContain("- \"lucy-ops.ops_call_tables\"");
    expect(skillText).toContain("- \"lucy-ops.ops_agents\"");
    expect(skillText).toContain("- \"lucy-ops.ops_tokens\"");
    expect(skillText).toContain("- \"lucy-ops/ops-questioning.md\"");
  });

  it("SC-14: 语义模板的 Manifest 没有 call_day，overlay 用 SQLite 的 date(ts)", async () => {
    const assets = await loadModule<typeof import("../ops-evidence/assets")>(
      "../ops-evidence/assets"
    );
    const manifestText = await readFile(
      path.join(
        assets.OPS_EVIDENCE_TEMPLATE_ROOT,
        "semantic-layer/lucy-ops/_schema/main.yaml"
      ),
      "utf8"
    );
    // Manifest 只写物理列：解析后不得出现 call_day 派生列。
    const manifest = parse(manifestText) as {
      tables: Record<string, { table: string; columns: Array<{ name: string }> }>;
    };
    expect(Object.keys(manifest.tables).sort()).toEqual(
      [
        "ops_calls",
        "ops_call_tables",
        "ops_agents",
        "ops_tokens",
        "ops_agent_activity",
        "ops_question_kpi_agents",
        "ops_grant_paths",
        "ops_access_paths",
        "ops_edge_signals",
        "ops_map_nodes",
        "ops_map_meta",
        "ops_table_adoption"
      ].sort()
    );
    for (const [sourceName, table] of Object.entries(manifest.tables)) {
      const columnNames = table.columns.map((column) => column.name);
      // W0 视图：call_day 只能写在 overlay 派生列；W1 ops_agent_activity 的 call_day 是物化物理列。
      if (sourceName === "ops_calls" || sourceName === "ops_call_tables") {
        expect(columnNames, sourceName).not.toContain("call_day");
      }
      // Manifest 的 table: 用 T0 冻结的 physicalTable（裸名）。
      expect(table.table, sourceName).toBe(sourceName);
    }

    for (const overlay of ["ops_calls.yaml", "ops_call_tables.yaml"]) {
      const text = await readFile(
        path.join(assets.OPS_EVIDENCE_TEMPLATE_ROOT, `semantic-layer/lucy-ops/${overlay}`),
        "utf8"
      );
      expect(text).toContain("expr: date(ts)");
      expect(text).toContain("count(*)");
      expect(text).toContain("denied");
      expect(text).toContain("error");
      expect(text).toContain("sum(duration_ms)");
    }
    for (const overlay of [
      "ops_agents.yaml",
      "ops_tokens.yaml",
      "ops_agent_activity.yaml",
      "ops_question_kpi_agents.yaml",
      "ops_grant_paths.yaml",
      "ops_access_paths.yaml",
      "ops_edge_signals.yaml",
      "ops_map_nodes.yaml",
      "ops_map_meta.yaml",
      "ops_table_adoption.yaml"
    ]) {
      const text = await readFile(
        path.join(assets.OPS_EVIDENCE_TEMPLATE_ROOT, `semantic-layer/lucy-ops/${overlay}`),
        "utf8"
      );
      expect(text.length).toBeGreaterThan(0);
      expect(text).toContain("measures:");
    }
  });
});

describe("Spec 149 §5.5 / §6 — Skill 通道的对象 ACL", () => {
  it("SC-16: demo_readonly 不可发现、不可读取模板 Skill；运维问数角色可以", async () => {
    const { root, content } = await makeProject();
    projectRoot = root;
    contentRoot = content;
    process.env.KTX_PROJECT_ROOT = root;
    process.env.LUCY_CONTENT_ROOT = content;

    const assets = await loadModule<typeof import("../ops-evidence/assets")>(
      "../ops-evidence/assets"
    );
    const paths = await loadModule<typeof import("../paths")>("../paths");
    const contentPaths = await paths.resolveContentPaths(root);
    const skillSpec = assets
      .opsEvidenceAssetSpecs()
      .find((spec) => spec.id === "skills/ops-questioning")!;
    await assets.placeOpsEvidenceAsset(skillSpec, contentPaths);

    const loader = await loadModule<typeof import("../skills/loader")>("../skills/loader");
    const skillAcl = await loadModule<typeof import("../proxy/skill-acl")>(
      "../proxy/skill-acl"
    );
    const skills = await loader.loadAllSkills();
    const opsSkill = skills.find((skill) => skill.name === "ops-questioning");
    expect(opsSkill).toBeDefined();
    expect(opsSkill?.status).toBe("published");
    expect(opsSkill?.roles_allowed).toEqual(["lucy_ops_reader"]);

    const demoDecision = await skillAcl.canAccessSkill(identity("demo_agent"), opsSkill!, "read");
    expect(demoDecision.allowed).toBe(false);
    expect(demoDecision.reason).toBe("role_not_granted");

    const discoverable = await skillAcl.filterAccessibleSkills(
      identity("demo_agent"),
      skills,
      "discover"
    );
    expect(discoverable.map((skill) => skill.name)).not.toContain("ops-questioning");

    const opsDecision = await skillAcl.canAccessSkill(identity("demo_ops"), opsSkill!, "read");
    expect(opsDecision.allowed).toBe(true);
  });
});

describe("Spec 149 §5.5 — 三种内容根与项目根镜像（SC-18）", () => {
  it("默认内容根、自定义绝对路径与 LUCY_CONTENT_ROOT=. 的落位", async () => {
    const { root } = await makeProject();
    projectRoot = root;

    const assets = await loadModule<typeof import("../ops-evidence/assets")>(
      "../ops-evidence/assets"
    );
    const paths = await loadModule<typeof import("../paths")>("../paths");
    const mirror = await loadModule<typeof import("../content-mirror")>(
      "../content-mirror"
    );

    // 1) 默认内容根 = <projectRoot>/config。
    process.env.LUCY_CONTENT_ROOT = "";
    delete process.env.LUCY_CONTENT_ROOT;
    let contentPaths = await paths.resolveContentPaths(root);
    expect(contentPaths.configDir).toBe(path.join(root, "config"));

    const skillSpec = assets
      .opsEvidenceAssetSpecs()
      .find((spec) => spec.id === "skills/ops-questioning")!;
    await assets.placeOpsEvidenceAsset(skillSpec, contentPaths);
    await mirror.syncContentToProjectRoot(root, contentPaths);
    const defaultDest = path.join(root, "skills", "lucy-ops", "ops-questioning.md");
    expect((await readFile(defaultDest)).toString()).toContain("name: ops-questioning");

    // 2) 自定义绝对路径。
    const custom = path.join(root, "elsewhere");
    await mkdir(custom, { recursive: true });
    process.env.LUCY_CONTENT_ROOT = custom;
    contentPaths = await paths.resolveContentPaths(root);
    expect(contentPaths.configDir).toBe(custom);
    await assets.placeOpsEvidenceAsset(skillSpec, contentPaths);
    await mirror.syncContentToProjectRoot(root, contentPaths);
    expect((await readFile(path.join(custom, "skills", "lucy-ops", "ops-questioning.md"))).toString())
      .toContain("name: ops-questioning");
    expect((await readFile(defaultDest)).toString()).toContain("name: ops-questioning");

    // 3) LUCY_CONTENT_ROOT=. → 内容根就是项目根，镜像是空操作。
    process.env.LUCY_CONTENT_ROOT = ".";
    contentPaths = await paths.resolveContentPaths(root);
    expect(contentPaths.configDir).toBe(root);
    const result = await assets.placeOpsEvidenceAsset(skillSpec, contentPaths);
    // 该文件可能已由前面的镜像落在项目根 → 字节相同即跳过，不重复写。
    expect(["copied", "unchanged"]).toContain(result.outcome);
    expect((await readFile(path.join(root, "skills", "lucy-ops", "ops-questioning.md"))).toString())
      .toContain("name: ops-questioning");
  });
});
