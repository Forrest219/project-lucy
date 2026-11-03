import Fastify, { type FastifyRequest } from "fastify";
import { describe, it, expect, beforeAll, beforeEach, afterAll, afterEach } from "vitest";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { readdirSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { invalidateSkillsCache } from "../skills/loader.js";
import { registerSkillsRoutes } from "../admin/skills.js";
import { canAccessSkill, filterAccessibleSkills } from "../proxy/skill-acl.js";
import { invalidateAccessConfigCache } from "../proxy/identity.js";
import { resetEffectivePolicyForTests } from "../proxy/acl.js";
import type { Identity } from "../proxy/identity.js";

/**
 * Lucy v0.25 — L25-04 / SKO-01–16 验收执行（服务端侧）。
 *
 * 本文件不是实现级单元测试的复述。`skill-owner-l25-04.test.ts` 断言的是「机制是否
 * 按合同工作」；本文件断言的是 **Spec §8 验收矩阵每条通过标准的可观测结果**：
 * 文件、摘要、详情、响应、审计账本、MCP 授权判定这六个面必须同时说同一件事。
 *
 * 覆盖：SKO-01/02/03/04/05/07/08/09/10/11/13/14/15。
 * SKO-12 的三个故障分支由 `skill-owner-l25-04.test.ts` 逐条断言（intent 缺失不写文件 /
 * terminal 失败恢复原文件且不返回成功 / 恢复失败保留 pending 证据并显式要求修复），
 * 与通过标准逐句对应，本文件不重复注入故障。
 * SKO-16 是工程门禁，证据在验收记录文档，不在本文件。
 */

const TOKEN = "sko-acceptance-token";
function tokenHash(token: string): string {
  return "sha256:" + createHash("sha256").update(token).digest("hex");
}

const identity: Identity = {
  userId: "analyst_user",
  tokenLabel: "sko-acceptance",
  tokenHashPrefix: tokenHash(TOKEN).slice(0, 16)
};

const ACCESS_YAML = `users:
  - id: analyst_user
    name: Analyst User
    enabled: true
    roles:
      - analyst_role
    tokens:
      - hash: "${tokenHash(TOKEN)}"
        label: sko-acceptance
        created: 2026-08-29

roles:
  analyst_role:
    description: Data Analyst
    allow:
      connections:
        - mysql-aliyun
      tables:
        - dataforai.superstore_orders
      tools:
        - lucy_skill_search
        - lucy_skill_read
`;

const BASE_SKILL = `---
name: superstore-profit
title: Superstore Profit SOP
version: 1.0.0
domain: superstore
status: published
roles_allowed: ["*"]
triggers: ["profit"]
description: Profit analysis
---
# Profit SOP
Body content
`;

const CORRUPT_OWNER_SKILL = `---
name: corrupt-owner
title: Corrupt Owner SOP
version: 1.0.0
domain: superstore
status: published
roles_allowed: ["*"]
owner:
  team: data governance
triggers: ["profit"]
description: Owner is a mapping, not a label
---
# Corrupt Owner SOP
Body content
`;

let app: ReturnType<typeof Fastify>;
let projectRoot: string;
let previousRoot: string | undefined;
let previousContentRoot: string | undefined;
let previousAuditDb: string | undefined;
let previousPublicMcpUrl: string | undefined;

/**
 * `getAuditDb()` keeps ONE module-level handle per process, so the audit store cannot be
 * re-pointed at a new file per test. The file is stable for the whole run and its rows are
 * cleared between tests — otherwise a test would read another test's ledger.
 */
let auditDir: string;
let auditDbPath: string;

async function writeSkillFile(name: string, content: string): Promise<void> {
  await writeFile(path.join(projectRoot, "skills", "superstore", `${name}.md`), content, "utf8");
}

async function readSkillFile(name: string): Promise<string> {
  return readFile(path.join(projectRoot, "skills", "superstore", `${name}.md`), "utf8");
}

type AuditRow = {
  id: number;
  change_type: string;
  write_status: string;
  actor: string | null;
  old_summary: string | null;
  new_summary: string | null;
};

async function auditRows(): Promise<AuditRow[]> {
  const { getAuditDb } = await import("../admin/audit");
  const db = await getAuditDb();
  return db
    .prepare(
      `SELECT id, change_type, write_status, actor, old_summary, new_summary
         FROM config_change_log ORDER BY id`
    )
    .all() as AuditRow[];
}

function summaryOf(row: AuditRow | undefined, side: "old" | "new"): Record<string, unknown> {
  if (!row) return {};
  const raw = side === "old" ? row.old_summary : row.new_summary;
  return raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
}

type SkillJson = Record<string, unknown>;

async function listSkills(): Promise<SkillJson[]> {
  const res = await app.inject({ method: "GET", url: "/api/skills?includeContent=false" });
  expect(res.statusCode).toBe(200);
  return res.json().skills as SkillJson[];
}

async function getSkill(domain: string, name: string): Promise<SkillJson> {
  const res = await app.inject({ method: "GET", url: `/api/skills/${domain}/${name}` });
  expect(res.statusCode).toBe(200);
  return res.json().skill as SkillJson;
}

async function putSkill(
  domain: string,
  name: string,
  payload: Record<string, unknown>
): Promise<{ statusCode: number; body: Record<string, unknown> }> {
  const res = await app.inject({ method: "PUT", url: `/api/skills/${domain}/${name}`, payload });
  return { statusCode: res.statusCode, body: res.json() as Record<string, unknown> };
}

/** Recursively collect every source file under a directory (for the "no skill market" scan). */
function collectSourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = path.join(dir, entry);
    if (statSync(p).isDirectory()) collectSourceFiles(p, out);
    else if (/\.(tsx?|jsx?)$/.test(entry)) out.push(p);
  }
  return out;
}

beforeAll(async () => {
  auditDir = await mkdtemp(path.join(os.tmpdir(), "sko-acceptance-audit-"));
  auditDbPath = path.join(auditDir, "audit.sqlite");
});

afterAll(async () => {
  await rm(auditDir, { recursive: true, force: true });
});

beforeEach(async () => {
  previousRoot = process.env.KTX_PROJECT_ROOT;
  previousContentRoot = process.env.LUCY_CONTENT_ROOT;
  previousAuditDb = process.env.LUCY_AUDIT_DB;
  previousPublicMcpUrl = process.env.LUCY_PUBLIC_MCP_URL;

  projectRoot = await mkdtemp(path.join(os.tmpdir(), "sko-acceptance-"));
  process.env.KTX_PROJECT_ROOT = projectRoot;
  process.env.LUCY_CONTENT_ROOT = ".";
  process.env.LUCY_AUDIT_DB = auditDbPath;
  process.env.LUCY_PUBLIC_MCP_URL = "http://127.0.0.1:7879/mcp";

  await mkdir(path.join(projectRoot, "skills", "superstore"), { recursive: true });
  await mkdir(path.join(projectRoot, "webui", "config"), { recursive: true });
  await writeFile(path.join(projectRoot, "webui", "config", "access.yaml"), ACCESS_YAML);
  await writeFile(path.join(projectRoot, "ktx.yaml"), "connections:\n  mysql-aliyun:\n    type: mysql\n");

  await writeSkillFile("superstore-profit", BASE_SKILL);
  await writeSkillFile("corrupt-owner", CORRUPT_OWNER_SKILL);

  const { getAuditDb } = await import("../admin/audit");
  const db = await getAuditDb();
  db.prepare("DELETE FROM config_change_log").run();

  invalidateAccessConfigCache();
  resetEffectivePolicyForTests();
  invalidateSkillsCache();

  app = Fastify();
  app.addHook("onRequest", async (request: FastifyRequest) => {
    request.lucyAdmin = { session: null, admin: null, stateUnavailable: false, authMode: "open" };
  });
  registerSkillsRoutes(app);
  await app.ready();
});

afterEach(async () => {
  if (previousRoot === undefined) delete process.env.KTX_PROJECT_ROOT;
  else process.env.KTX_PROJECT_ROOT = previousRoot;
  if (previousContentRoot === undefined) delete process.env.LUCY_CONTENT_ROOT;
  else process.env.LUCY_CONTENT_ROOT = previousContentRoot;
  if (previousAuditDb === undefined) delete process.env.LUCY_AUDIT_DB;
  else process.env.LUCY_AUDIT_DB = previousAuditDb;
  if (previousPublicMcpUrl === undefined) delete process.env.LUCY_PUBLIC_MCP_URL;
  else process.env.LUCY_PUBLIC_MCP_URL = previousPublicMcpUrl;
  invalidateAccessConfigCache();
  resetEffectivePolicyForTests();
  invalidateSkillsCache();
  await app.close();
  await rm(projectRoot, { recursive: true, force: true });
});

describe("SKO-01–05 既有资产、指定、修改、清除与文本合同", () => {
  it("SKO-01 既有文件无 owner：读为未指定，读取不回写磁盘（无迁移、无批量回填）", async () => {
    const fileBefore = await readSkillFile("superstore-profit");

    const summary = (await listSkills()).find((s) => s.name === "superstore-profit");
    const detail = await getSkill("superstore", "superstore-profit");

    expect(summary?.owner).toBe("");
    expect(detail.owner).toBe("");
    expect(detail.owner_invalid).toBeUndefined();
    // 无迁移、无批量回填：读一次之后磁盘字节必须一模一样（没有补写 owner 键）。
    expect(await readSkillFile("superstore-profit")).toBe(fileBefore);
    // 摘要仍不带正文。
    expect(summary?.content).toBeUndefined();
  });

  it("SKO-02 新建草稿并指定负责人：文件、摘要、详情、响应四处一致，其余默认合同不变", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/skills",
      payload: {
        name: "new-owner",
        domain: "superstore",
        title: "New Owner",
        content: "# Body\n",
        owner: "数据治理组"
      }
    });
    expect(res.statusCode).toBe(201);
    const created = res.json().skill as SkillJson;

    // 其余默认合同不变
    expect(created.status).toBe("draft");
    expect(created.roles_allowed).toEqual([]);
    expect(created.version).toBe("1.0.0");
    expect(created.owner).toBe("数据治理组");

    // 文件
    expect(await readSkillFile("new-owner")).toContain("owner: 数据治理组");
    // 摘要
    const summary = (await listSkills()).find((s) => s.name === "new-owner");
    expect(summary?.owner).toBe("数据治理组");
    // 详情
    expect((await getSkill("superstore", "new-owner")).owner).toBe("数据治理组");
  });

  it("SKO-03 修改已发布 Skill 的负责人：只改变显式编辑的字段", async () => {
    const before = await getSkill("superstore", "superstore-profit");
    const res = await putSkill("superstore", "superstore-profit", {
      expected_version: before.file_version,
      owner: "数据治理组"
    });
    expect(res.statusCode).toBe(200);
    const after = res.body.skill as SkillJson;

    expect(after.owner).toBe("数据治理组");
    expect(after.status).toBe(before.status);
    expect(after.version).toBe(before.version);
    expect(after.roles_allowed).toEqual(before.roles_allowed);
    expect(after.triggers).toEqual(before.triggers);
  });

  it("SKO-04 清除负责人：保存后读回未指定，磁盘与后续读取都无旧值残留", async () => {
    const initial = await getSkill("superstore", "superstore-profit");
    const set = await putSkill("superstore", "superstore-profit", {
      expected_version: initial.file_version,
      owner: "临时负责人"
    });
    expect(set.statusCode).toBe(200);

    const current = await getSkill("superstore", "superstore-profit");
    const cleared = await putSkill("superstore", "superstore-profit", {
      expected_version: current.file_version,
      owner: ""
    });
    expect(cleared.statusCode).toBe(200);
    expect((cleared.body.skill as SkillJson).owner).toBe("");

    // 磁盘上不再有旧值，也不再有 owner 键
    const raw = await readSkillFile("superstore-profit");
    expect(raw).not.toContain("临时负责人");
    expect(raw).not.toMatch(/^owner:/m);

    // 摘要与详情都读回未指定
    const summary = (await listSkills()).find((s) => s.name === "superstore-profit");
    expect(summary?.owner).toBe("");
    expect((await getSkill("superstore", "superstore-profit")).owner).toBe("");
  });

  it("SKO-05 首尾空白被 trim、内部空白原样保留；注入型文本按纯文本存取，不被解释", async () => {
    const before = await getSkill("superstore", "superstore-profit");
    const padded = await putSkill("superstore", "superstore-profit", {
      expected_version: before.file_version,
      owner: "  财务 BP 团队  "
    });
    expect(padded.statusCode).toBe(200);
    expect((padded.body.skill as SkillJson).owner).toBe("财务 BP 团队");

    const injection = "<img src=x onerror=alert(1)> **粗体** [链接](javascript:alert(1))";
    const current = await getSkill("superstore", "superstore-profit");
    const injected = await putSkill("superstore", "superstore-profit", {
      expected_version: current.file_version,
      owner: injection
    });
    expect(injected.statusCode).toBe(200);
    // 服务端按纯文本存取：既不拒绝，也不把它解释成 HTML/Markdown。
    expect((injected.body.skill as SkillJson).owner).toBe(injection);
    // 重新从磁盘加载后仍是同一个字符串（YAML 转义不改变语义）。
    expect((await getSkill("superstore", "superstore-profit")).owner).toBe(injection);
  });
});

describe("SKO-07–11 损坏声明、rawContent、预检、并发与配置审计", () => {
  it("SKO-07 损坏声明：未修复被拒且磁盘不变；显式清空或 rawContent 修复后可保存", async () => {
    const fileBefore = await readSkillFile("corrupt-owner");
    const version = (await getSkill("superstore", "corrupt-owner")).file_version as string;

    // 未显式提供 owner 的保存被拒
    const rejected = await putSkill("superstore", "corrupt-owner", {
      expected_version: version,
      title: "改个标题"
    });
    expect(rejected.statusCode).toBe(400);
    expect(rejected.body.error).toBe("skill_owner_invalid");
    // 被拒的保存没有落盘
    expect(await readSkillFile("corrupt-owner")).toBe(fileBefore);

    // 显式清空即可修复
    const cleared = await putSkill("superstore", "corrupt-owner", {
      expected_version: version,
      owner: ""
    });
    expect(cleared.statusCode).toBe(200);
    expect((cleared.body.skill as SkillJson).owner).toBe("");
    expect((cleared.body.skill as SkillJson).owner_invalid).toBeUndefined();

    // rawContent 修复也可保存
    await writeSkillFile("corrupt-owner", CORRUPT_OWNER_SKILL);
    invalidateSkillsCache();
    const version2 = (await getSkill("superstore", "corrupt-owner")).file_version as string;
    const repaired = await putSkill("superstore", "corrupt-owner", {
      expected_version: version2,
      rawContent:
        "---\nname: corrupt-owner\ntitle: Repaired\ndomain: superstore\nstatus: published\nroles_allowed: [\"*\"]\nowner: 数据治理组\n---\n# Body\n"
    });
    expect(repaired.statusCode).toBe(200);
    expect((repaired.body.skill as SkillJson).owner).toBe("数据治理组");
  });

  it("SKO-08 rawContent 更新路径与创建路径同一合同：对象不被字符串化", async () => {
    const version = (await getSkill("superstore", "superstore-profit")).file_version as string;
    const res = await putSkill("superstore", "superstore-profit", {
      expected_version: version,
      rawContent:
        "---\nname: superstore-profit\ntitle: T\nversion: 1.0.0\ndomain: superstore\nstatus: published\nroles_allowed: [\"*\"]\nowner:\n  team: data\n---\n# Body\n"
    });
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toBe("skill_owner_invalid");
  });

  it("SKO-09 预检显示负责人前后值与真实 diff，且无文件、审计与缓存副作用", async () => {
    const before = await getSkill("superstore", "superstore-profit");
    const fileBefore = await readSkillFile("superstore-profit");
    const rowsBefore = (await auditRows()).length;

    const res = await app.inject({
      method: "POST",
      url: "/api/skills/superstore/superstore-profit/preview",
      payload: { expected_version: before.file_version, owner: "数据治理组" }
    });
    expect(res.statusCode).toBe(200);
    const preview = res.json().preview as Record<string, unknown>;
    expect((preview.impact as Record<string, unknown>).owner).toEqual({ from: "", to: "数据治理组" });
    expect(preview.proposedMarkdown).toContain("owner: 数据治理组");
    expect(preview.diff).toContain("owner");

    // 无文件副作用
    expect(await readSkillFile("superstore-profit")).toBe(fileBefore);
    // 无审计副作用
    expect((await auditRows()).length).toBe(rowsBefore);
    // 无缓存副作用：版本与负责人仍是旧值
    const after = await getSkill("superstore", "superstore-profit");
    expect(after.file_version).toBe(before.file_version);
    expect(after.owner).toBe("");
  });

  it("SKO-10 改负责人不改变 URI 与原路径，过期 expected_version 仍被拒", async () => {
    const before = await getSkill("superstore", "superstore-profit");

    const stale = await putSkill("superstore", "superstore-profit", {
      expected_version: "stale-version",
      owner: "数据治理组"
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.body.error).toBe("skill_write_conflict");

    const res = await putSkill("superstore", "superstore-profit", {
      expected_version: before.file_version,
      owner: "数据治理组"
    });
    expect(res.statusCode).toBe(200);
    const after = res.body.skill as SkillJson;
    expect(after.uri).toBe(before.uri);
    expect(after.relativePath).toBe(before.relativePath);
  });

  it("SKO-11 配置审计：create／edit／delete 摘要含 owner；edit 同时能看到 actor 与 owner 前后值", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/api/skills",
      payload: { name: "audited", domain: "superstore", title: "Audited", content: "# B\n", owner: "数据治理组" }
    });
    expect(created.statusCode).toBe(201);

    const version = (await getSkill("superstore", "audited")).file_version as string;
    const edited = await putSkill("superstore", "audited", {
      expected_version: version,
      owner: "财务 BP 团队"
    });
    expect(edited.statusCode).toBe(200);

    const current = (await getSkill("superstore", "audited")).file_version as string;
    const deleted = await app.inject({
      method: "DELETE",
      url: "/api/skills/superstore/audited",
      payload: { expected_version: current }
    });
    expect(deleted.statusCode).toBe(200);

    const rows = await auditRows();
    const createRow = rows.find((row) => row.change_type === "skill_create");
    const editRow = rows.find((row) => row.change_type === "skill_edit_save");
    const deleteRow = rows.find((row) => row.change_type === "skill_delete");

    // create 摘要含 owner
    expect(summaryOf(createRow, "new").owner).toBe("数据治理组");
    // delete 摘要保留删除前的 owner
    expect(summaryOf(deleteRow, "old").owner).toBe("财务 BP 团队");
    // edit 同时能看到「谁改的」与「负责人从什么改成什么」
    expect(editRow?.actor).toBeTruthy();
    expect(summaryOf(editRow, "old").owner).toBe("数据治理组");
    expect(summaryOf(editRow, "new").owner).toBe("财务 BP 团队");
  });
});

describe("SKO-13–15 权限隔离、摘要导出与工作台边界", () => {
  it("SKO-13 负责人不是账户或角色：改它不改变授权判定与 MCP 拒绝原因", async () => {
    const before = await getSkill("superstore", "superstore-profit");
    const res = await putSkill("superstore", "superstore-profit", {
      expected_version: before.file_version,
      owner: "analyst_user"
    });
    expect(res.statusCode).toBe(200);
    const after = res.body.skill as SkillJson;

    // 授权事实源没有被负责人字段带动
    expect(after.roles_allowed).toEqual(before.roles_allowed);

    // MCP 侧的裁决与拒绝原因不因负责人改变
    const decisionBefore = await canAccessSkill(identity, before as never, "read");
    const decisionAfter = await canAccessSkill(identity, after as never, "read");
    expect(decisionAfter).toEqual(decisionBefore);

    // 负责人与账户同名也不会获得任何可见性
    const hidden = { ...after, roles_allowed: [] };
    expect(await canAccessSkill(identity, hidden as never, "read")).toMatchObject({
      allowed: false,
      reason: "acl_empty"
    });
  });

  it("SKO-14 摘要无正文；既有导出保留 owner；MCP 授权集合未新增负责人语义", async () => {
    const before = await getSkill("superstore", "superstore-profit");
    const res = await putSkill("superstore", "superstore-profit", {
      expected_version: before.file_version,
      owner: "数据治理组"
    });
    expect(res.statusCode).toBe(200);
    const after = res.body.skill as SkillJson;

    // 摘要仍无正文
    for (const summary of await listSkills()) {
      expect(summary.content).toBeUndefined();
    }

    // 既有导出保留 owner（导出的是原始 SKILL.md，frontmatter 里的负责人不能被剥掉）
    const exported = await app.inject({
      method: "GET",
      url: "/api/skills/export?target=claude-code&proxyUrl=http://127.0.0.1:7879/mcp"
    });
    expect(exported.statusCode).toBe(200);
    const bundle = exported.json().bundle as { files: Record<string, string> };
    const exportedFiles = Object.entries(bundle.files).filter(([name]) => name.endsWith("SKILL.md"));
    expect(exportedFiles.length).toBeGreaterThan(0);
    const profit = exportedFiles.find(([name]) => name.includes("superstore-profit"));
    expect(profit?.[1]).toContain("owner: 数据治理组");

    // MCP 授权集合前后一致：负责人没有变成新的授权维度
    const accessibleBefore = await filterAccessibleSkills(identity, [before as never], "discover");
    const accessibleAfter = await filterAccessibleSkills(identity, [after as never], "discover");
    expect(accessibleAfter.map((s) => s.uri)).toEqual(accessibleBefore.map((s) => s.uri));
  });

  it("SKO-15 工作台没有技能市场入口", async () => {
    const srcDir = path.resolve(import.meta.dirname, "../../src");
    const offenders: string[] = [];
    for (const file of collectSourceFiles(srcDir)) {
      const text = await readFile(file, "utf8");
      if (/技能市场|skill\s*market|marketplace/i.test(text)) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });
});
