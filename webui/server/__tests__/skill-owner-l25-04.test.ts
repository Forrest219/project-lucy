import Fastify, { type FastifyRequest } from "fastify";
import { describe, it, expect, beforeAll, beforeEach, afterAll, afterEach, vi } from "vitest";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { invalidateSkillsCache, parseSkillMarkdown } from "../skills/loader.js";
import { validateSkill } from "../skills/validator.js";
import { registerSkillsRoutes } from "../admin/skills.js";

/**
 * Lucy v0.25 — L25-04 业务 Skill 负责人: the `owner` frontmatter contract.
 *
 * The owner is a free-text governance label. It is never an account, a role, an
 * authorization source, or a notification target — so these tests assert both
 * halves of that promise: the label works, and it changes nothing else.
 *
 * Covered here (server side): SKO-01..SKO-13. The workbench half (SKO-02..05/09/15)
 * lives in `webui/src/__tests__/skill-list.test.tsx`.
 */

const hooks = vi.hoisted(() => ({
  /** Make the Nth terminal-record write fail. 0 = never fail. */
  failTerminalAt: 0,
  terminalCalls: 0,
  /** Make the intent record unavailable (no id returned). */
  intentUnavailable: false,
  /** Make the Nth atomic file write fail. 0 = never fail. */
  failWriteAt: 0,
  writeCalls: 0
}));

vi.mock("../admin/audit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../admin/audit")>();
  return {
    ...actual,
    recordConfigChange: vi.fn(async (...args: Parameters<typeof actual.recordConfigChange>) => {
      if (hooks.intentUnavailable) return undefined;
      return actual.recordConfigChange(...args);
    }),
    updateConfigChangeStatus: vi.fn(async (...args: Parameters<typeof actual.updateConfigChangeStatus>) => {
      hooks.terminalCalls += 1;
      if (hooks.failTerminalAt > 0 && hooks.terminalCalls === hooks.failTerminalAt) {
        throw new Error("injected: terminal audit write failed");
      }
      return actual.updateConfigChangeStatus(...args);
    })
  };
});

vi.mock("../fs-safe", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../fs-safe")>();
  return {
    ...actual,
    safeWriteAtomic: vi.fn(async (...args: Parameters<typeof actual.safeWriteAtomic>) => {
      hooks.writeCalls += 1;
      if (hooks.failWriteAt > 0 && hooks.writeCalls === hooks.failWriteAt) {
        throw new Error("injected: atomic write failed");
      }
      return actual.safeWriteAtomic(...args);
    })
  };
});

const BASE_SKILL = `---
name: superstore-profit
title: Superstore Profit SOP
version: 1.0.0
domain: superstore
status: published
roles_allowed: ["*"]
triggers: ["profit"]
eval_cases: ["evals/superstore/test.yaml"]
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

/**
 * `getAuditDb()` keeps ONE module-level handle per process, so the audit store
 * cannot be re-pointed at a new file per test. The file is therefore stable for
 * the whole run and its rows are cleared between tests — otherwise a test would
 * read another test's ledger.
 */
let auditDir: string;
let auditDbPath: string;

async function writeSkillFile(name: string, content: string): Promise<string> {
  const target = path.join(projectRoot, "skills", "superstore", `${name}.md`);
  await writeFile(target, content, "utf8");
  return target;
}

async function readSkillFile(name: string): Promise<string> {
  return readFile(path.join(projectRoot, "skills", "superstore", `${name}.md`), "utf8");
}

type AuditRow = {
  id: number;
  change_type: string;
  write_status: string;
  old_summary: string | null;
  new_summary: string | null;
};

async function auditRows(): Promise<AuditRow[]> {
  const { getAuditDb } = await import("../admin/audit");
  const db = await getAuditDb();
  return db
    .prepare(
      `SELECT id, change_type, write_status, old_summary, new_summary
         FROM config_change_log ORDER BY id`
    )
    .all() as AuditRow[];
}

function summaryOf(row: AuditRow, side: "old" | "new"): Record<string, unknown> {
  const raw = side === "old" ? row.old_summary : row.new_summary;
  return raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
}

beforeAll(async () => {
  auditDir = await mkdtemp(path.join(os.tmpdir(), "skill-owner-l25-04-audit-"));
  auditDbPath = path.join(auditDir, "audit.sqlite");
});

afterAll(async () => {
  await rm(auditDir, { recursive: true, force: true });
});

beforeEach(async () => {
  hooks.failTerminalAt = 0;
  hooks.terminalCalls = 0;
  hooks.intentUnavailable = false;
  hooks.failWriteAt = 0;
  hooks.writeCalls = 0;

  previousRoot = process.env.KTX_PROJECT_ROOT;
  previousContentRoot = process.env.LUCY_CONTENT_ROOT;
  previousAuditDb = process.env.LUCY_AUDIT_DB;

  projectRoot = await mkdtemp(path.join(os.tmpdir(), "skill-owner-l25-04-"));
  process.env.KTX_PROJECT_ROOT = projectRoot;
  process.env.LUCY_CONTENT_ROOT = ".";
  process.env.LUCY_AUDIT_DB = auditDbPath;

  await mkdir(path.join(projectRoot, "skills", "superstore"), { recursive: true });
  await mkdir(path.join(projectRoot, "wiki", "global"), { recursive: true });
  await mkdir(path.join(projectRoot, "evals", "superstore"), { recursive: true });
  await writeFile(path.join(projectRoot, "ktx.yaml"), "connections:\n  mysql-aliyun:\n    type: mysql\n");
  await writeFile(path.join(projectRoot, "wiki", "global", "test-playbook.md"), "# Playbook\n");
  await writeFile(path.join(projectRoot, "evals", "superstore", "test.yaml"), "cases: []\n");

  await writeSkillFile("superstore-profit", BASE_SKILL);
  await writeSkillFile("corrupt-owner", CORRUPT_OWNER_SKILL);

  const { getAuditDb } = await import("../admin/audit");
  const db = await getAuditDb();
  db.prepare("DELETE FROM config_change_log").run();

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
  invalidateSkillsCache();
  await app.close();
  await rm(projectRoot, { recursive: true, force: true });
});

describe("L25-04 owner contract — parse and validate", () => {
  it("SKO-01 既有文件没有 owner 时读为未指定，且不产生损坏声明", () => {
    const skill = parseSkillMarkdown(BASE_SKILL, "/w/skills/superstore/superstore-profit.md", "/w");
    expect(skill?.owner).toBe("");
    expect(skill?.owner_invalid).toBeUndefined();
  });

  it("SKO-05 首尾空白被 trim，内部空白原样保留", () => {
    const withPadding = BASE_SKILL.replace("description: Profit analysis", "owner: \"  数据治理组  \"");
    const skill = parseSkillMarkdown(withPadding, "/w/skills/superstore/s.md", "/w");
    expect(skill?.owner).toBe("数据治理组");

    const withInnerSpace = BASE_SKILL.replace("description: Profit analysis", "owner: A 团队 B");
    const inner = parseSkillMarkdown(withInnerSpace, "/w/skills/superstore/s.md", "/w");
    expect(inner?.owner).toBe("A 团队 B");
  });

  it("SKO-06 非字符串 owner 是损坏声明：不被字符串化，且校验为 warning 而非 error", () => {
    const skill = parseSkillMarkdown(CORRUPT_OWNER_SKILL, "/w/skills/superstore/corrupt-owner.md", "/w");
    expect(skill?.owner).toBe("");
    expect(skill?.owner_invalid).toBe(true);

    const validation = validateSkill(skill!);
    const issue = validation.issues.find((entry) => entry.code === "skill_owner_invalid");
    expect(issue).toBeDefined();
    expect(issue?.type).toBe("warning");
    expect(issue?.field).toBe("owner");
    // F-10: a corrupt owner must not flip an existing Skill to "invalid".
    expect(validation.valid).toBe(true);
  });

  it("SKO-06 显式 null 与超长 owner 都判非法，80 个 code point 仍合法", () => {
    const withNull = BASE_SKILL.replace("description: Profit analysis", "owner: null");
    expect(parseSkillMarkdown(withNull, "/w/skills/superstore/s.md", "/w")?.owner_invalid).toBe(true);

    const tooLong = BASE_SKILL.replace("description: Profit analysis", `owner: "${"数".repeat(81)}"`);
    expect(parseSkillMarkdown(tooLong, "/w/skills/superstore/s.md", "/w")?.owner_invalid).toBe(true);

    const atLimit = BASE_SKILL.replace("description: Profit analysis", `owner: "${"数".repeat(80)}"`);
    const parsed = parseSkillMarkdown(atLimit, "/w/skills/superstore/s.md", "/w");
    expect(parsed?.owner_invalid).toBeUndefined();
    expect(parsed?.owner).toHaveLength(80);
  });

  it("F-09 控制字符检查作用于 trim 前的原始值：首尾换行判非法", () => {
    const withTrailingNewline = BASE_SKILL.replace("description: Profit analysis", 'owner: "数据治理组\\n"');
    expect(parseSkillMarkdown(withTrailingNewline, "/w/skills/superstore/s.md", "/w")?.owner_invalid).toBe(true);

    const withInnerNewline = BASE_SKILL.replace("description: Profit analysis", 'owner: "数据\\n治理组"');
    expect(parseSkillMarkdown(withInnerNewline, "/w/skills/superstore/s.md", "/w")?.owner_invalid).toBe(true);
  });
});

describe("L25-04 owner contract — read API", () => {
  it("SKO-01/SKO-14 列表与详情返回同一个 owner，缺省为空且不返回正文", async () => {
    const list = await app.inject({ method: "GET", url: "/api/skills" });
    expect(list.statusCode).toBe(200);
    const listed = list.json().skills.find((entry: { name: string }) => entry.name === "superstore-profit");
    expect(listed.owner).toBe("");

    const summary = await app.inject({ method: "GET", url: "/api/skills?includeContent=false" });
    const summarized = summary.json().skills.find((entry: { name: string }) => entry.name === "superstore-profit");
    expect(summarized.owner).toBe("");
    expect(summarized).not.toHaveProperty("content");
    expect(summarized).not.toHaveProperty("raw");

    const detail = await app.inject({ method: "GET", url: "/api/skills/superstore/superstore-profit" });
    expect(detail.json().skill.owner).toBe("");
  });

  it("SKO-06 损坏声明在读取时披露，Agent 的授权与读取不受影响", async () => {
    const detail = await app.inject({ method: "GET", url: "/api/skills/superstore/corrupt-owner" });
    expect(detail.statusCode).toBe(200);
    const skill = detail.json().skill;
    expect(skill.owner).toBe("");
    expect(skill.owner_invalid).toBe(true);
    // The corrupt label does not touch the authorization surface.
    expect(skill.roles_allowed).toEqual(["*"]);
    expect(skill.validation.valid).toBe(true);
  });
});

describe("L25-04 owner contract — writes", () => {
  it("SKO-02 新建并指定负责人：文件、响应与审计摘要一致", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/skills",
      payload: {
        name: "owned-skill",
        domain: "superstore",
        title: "Owned Skill",
        version: "1.0.0",
        status: "draft",
        roles_allowed: ["analyst"],
        owner: "数据治理组",
        content: "# Owned\n"
      }
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().skill.owner).toBe("数据治理组");

    const text = await readSkillFile("owned-skill");
    expect(text).toContain("owner: 数据治理组");
    expect(text).toContain("roles_allowed:");

    const rows = await auditRows();
    const created = rows.find((row) => row.change_type === "skill_create");
    expect(created).toBeDefined();
    expect(summaryOf(created!, "new").owner).toBe("数据治理组");
  });

  it("SKO-03 修改已发布 Skill 的负责人只改负责人，不动状态、版本与授权", async () => {
    const before = await app.inject({ method: "GET", url: "/api/skills/superstore/superstore-profit" });
    const version = before.json().skill.file_version;

    const res = await app.inject({
      method: "PUT",
      url: "/api/skills/superstore/superstore-profit",
      payload: { expected_version: version, owner: "财务 BP 团队" }
    });
    expect(res.statusCode).toBe(200);
    const updated = res.json().skill;
    expect(updated.owner).toBe("财务 BP 团队");
    expect(updated.status).toBe("published");
    expect(updated.version).toBe("1.0.0");
    expect(updated.roles_allowed).toEqual(["*"]);
    expect(updated.uri).toBe("lucy-skill://superstore/superstore-profit");
  });

  it("SKO-04 清除负责人后读回未指定，文件里不再有该键", async () => {
    const before = await app.inject({ method: "GET", url: "/api/skills/superstore/superstore-profit" });
    const version = before.json().skill.file_version;

    const res = await app.inject({
      method: "PUT",
      url: "/api/skills/superstore/superstore-profit",
      payload: { expected_version: version, owner: "" }
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().skill.owner).toBe("");

    const text = await readSkillFile("superstore-profit");
    expect(text).not.toContain("owner:");
  });

  it("SKO-05 写入时首尾空白被 trim，内部空白保留", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/skills",
      payload: {
        name: "padded-owner",
        domain: "superstore",
        title: "Padded",
        owner: "  A 团队 B  ",
        content: "# Padded\n"
      }
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().skill.owner).toBe("A 团队 B");
  });

  it("SKO-06 超长负责人写入被拒，且不落盘", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/skills",
      payload: {
        name: "too-long-owner",
        domain: "superstore",
        title: "Too Long",
        owner: "数".repeat(81),
        content: "# Too Long\n"
      }
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("skill_owner_invalid");
    await expect(readSkillFile("too-long-owner")).rejects.toThrow();
  });

  it("SKO-07 损坏声明必须显式修复：未提供负责人时保存被拒", async () => {
    const before = await app.inject({ method: "GET", url: "/api/skills/superstore/corrupt-owner" });
    const version = before.json().skill.file_version;

    const rejected = await app.inject({
      method: "PUT",
      url: "/api/skills/superstore/corrupt-owner",
      payload: { expected_version: version, title: "Renamed" }
    });
    expect(rejected.statusCode).toBe(400);
    expect(rejected.json().error).toBe("skill_owner_invalid");

    const repaired = await app.inject({
      method: "PUT",
      url: "/api/skills/superstore/corrupt-owner",
      payload: { expected_version: version, owner: "数据治理组" }
    });
    expect(repaired.statusCode).toBe(200);
    expect(repaired.json().skill.owner).toBe("数据治理组");
    expect(repaired.json().skill.owner_invalid).toBeUndefined();

    const rows = await auditRows();
    const edited = rows.find((row) => row.change_type === "skill_edit_save");
    expect(summaryOf(edited!, "old").owner).toBe("");
    expect(summaryOf(edited!, "old").owner_invalid).toBe(true);
    expect(summaryOf(edited!, "new").owner).toBe("数据治理组");
  });

  it("SKO-08 rawContent 路径使用同一合同：对象不会被字符串化", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/skills",
      payload: {
        name: "raw-owner",
        domain: "superstore",
        rawContent:
          "---\nname: raw-owner\ntitle: Raw Owner\ndomain: superstore\nstatus: draft\nowner:\n  team: data\n---\nBody\n"
      }
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("skill_owner_invalid");
  });

  it("SKO-09 预检显示负责人前后值与真实 frontmatter diff，且不写文件", async () => {
    const before = await app.inject({ method: "GET", url: "/api/skills/superstore/superstore-profit" });
    const version = before.json().skill.file_version;
    const fileBefore = await readSkillFile("superstore-profit");

    const res = await app.inject({
      method: "POST",
      url: "/api/skills/superstore/superstore-profit/preview",
      payload: { expected_version: version, owner: "数据治理组" }
    });
    expect(res.statusCode).toBe(200);
    const preview = res.json().preview;
    expect(preview.impact.owner).toEqual({ from: "", to: "数据治理组" });
    expect(preview.proposedMarkdown).toContain("owner: 数据治理组");
    expect(preview.diff).toContain("owner");

    expect(await readSkillFile("superstore-profit")).toBe(fileBefore);
  });

  it("SKO-10 过期 expected_version 被拒，负责人修改不改变身份", async () => {
    const rejected = await app.inject({
      method: "PUT",
      url: "/api/skills/superstore/superstore-profit",
      payload: { expected_version: "stale-version", owner: "数据治理组" }
    });
    expect(rejected.statusCode).toBe(409);
    expect(rejected.json().error).toBe("skill_write_conflict");

    const before = await app.inject({ method: "GET", url: "/api/skills/superstore/superstore-profit" });
    const version = before.json().skill.file_version;
    const renamed = await app.inject({
      method: "PUT",
      url: "/api/skills/superstore/superstore-profit",
      payload: { expected_version: version, name: "other-name" }
    });
    expect(renamed.statusCode).toBe(409);
    expect(renamed.json().error).toBe("skill_identity_immutable");
  });

  it("SKO-11 删除审计摘要保留删除前的负责人", async () => {
    const before = await app.inject({ method: "GET", url: "/api/skills/superstore/superstore-profit" });
    const version = before.json().skill.file_version;

    const res = await app.inject({
      method: "DELETE",
      url: "/api/skills/superstore/superstore-profit",
      payload: { expected_version: version }
    });
    expect(res.statusCode).toBe(200);

    const rows = await auditRows();
    const deleted = rows.find((row) => row.change_type === "skill_delete");
    expect(deleted).toBeDefined();
    expect(summaryOf(deleted!, "old").owner).toBe("");
  });

  it("SKO-13 负责人不是账户或角色：改动它不动 roles_allowed", async () => {
    const before = await app.inject({ method: "GET", url: "/api/skills/superstore/superstore-profit" });
    const version = before.json().skill.file_version;
    const res = await app.inject({
      method: "PUT",
      url: "/api/skills/superstore/superstore-profit",
      payload: { expected_version: version, owner: "local-admin" }
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().skill.roles_allowed).toEqual(["*"]);
    expect(res.json().skill.owner).toBe("local-admin");
  });
});

describe("L25-04 / F-03 — the audit closure", () => {
  it("SKO-12 意图记录缺失时不写文件", async () => {
    hooks.intentUnavailable = true;
    const res = await app.inject({
      method: "POST",
      url: "/api/skills",
      payload: { name: "no-intent", domain: "superstore", title: "No Intent", content: "# X\n" }
    });
    expect(res.statusCode).toBe(503);
    expect(res.json().error).toBe("skill_audit_unavailable");
    await expect(readSkillFile("no-intent")).rejects.toThrow();
  });

  it("SKO-12 committed terminal 失败时恢复原文件，审计记 rolled_back，且不返回成功", async () => {
    const fileBefore = await readSkillFile("superstore-profit");
    const before = await app.inject({ method: "GET", url: "/api/skills/superstore/superstore-profit" });
    const version = before.json().skill.file_version;

    hooks.failTerminalAt = 1;
    const res = await app.inject({
      method: "PUT",
      url: "/api/skills/superstore/superstore-profit",
      payload: { expected_version: version, owner: "数据治理组" }
    });

    expect(res.statusCode).toBe(500);
    expect(res.json().ok).toBe(false);
    // The file is back to its previous bytes — a failed save never lands.
    expect(await readSkillFile("superstore-profit")).toBe(fileBefore);

    const rows = await auditRows();
    const edited = rows.find((row) => row.change_type === "skill_edit_save");
    expect(edited?.write_status).toBe("rolled_back");
  });

  it("SKO-12 恢复也失败时显式要求修复，不谎称已回滚", async () => {
    const before = await app.inject({ method: "GET", url: "/api/skills/superstore/superstore-profit" });
    const version = before.json().skill.file_version;

    hooks.failTerminalAt = 1;
    // The second atomic write is the rollback attempt; make it fail.
    hooks.failWriteAt = 2;
    const res = await app.inject({
      method: "PUT",
      url: "/api/skills/superstore/superstore-profit",
      payload: { expected_version: version, owner: "数据治理组" }
    });

    expect(res.statusCode).toBe(500);
    expect(res.json().error).toBe("skill_write_rollback_failed");
    // The pending evidence stays in the ledger: no `rolled_back` claim.
    const rows = await auditRows();
    const edited = rows.find((row) => row.change_type === "skill_edit_save");
    expect(edited?.write_status).toBe("pending");
  });
});
