#!/usr/bin/env node
/**
 * seed-scale-wiki-skills.mjs — UAT 规模基线造数 ②：Wiki 300 页＋Skill 100 个。
 *
 * SOT：docs/qa/uat/scale-baseline.md。幂等：重跑先删既有 uat-wiki-*.md／
 * skills/uat_skills/ 再重写。Wiki 页带 allowed_roles（轮换 200 个正式角色，构 ACL 矩阵）；
 * Skill 按 webui/server/skills/loader.ts 口径（frontmatter 含 name 即有效）。
 *
 * 机制：Wiki 索引由 KTX 在启动时构建 → 写完需重启容器；Skill 有 2s 缓存，重启后必生效。
 *
 * 用法：node scripts/uat/seed-scale-wiki-skills.mjs
 * 覆盖：UAT_LUCY_CONTAINER（默认 compose-lucy-1）、UAT_TARGET_WIKI（300）、
 *       UAT_TARGET_SKILLS（100）、LUCY_DEMO_WEBUI_HOST_PORT（55176）
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const LUCY = process.env.UAT_LUCY_CONTAINER || "compose-lucy-1";
const WIKI_DIR = "/data/lucy/wiki";
const SKILLS_DIR = "/data/lucy/config/skills";
const TARGET_WIKI = Number(process.env.UAT_TARGET_WIKI || 300);
const TARGET_SKILLS = Number(process.env.UAT_TARGET_SKILLS || 100);
const HEALTH_URL = `http://127.0.0.1:${process.env.LUCY_DEMO_WEBUI_HOST_PORT || 55176}/api/health`;
const SEED = 20261123;

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(SEED);
const int = (lo, hi) => lo + Math.floor(rand() * (hi - lo + 1));

function docker(...args) {
  return execFileSync("docker", args, { stdio: ["pipe", "pipe", "pipe"] });
}

// ---- 生成内容 --------------------------------------------------------------

const WIKI_TERMS = [
  "销售额", "利润", "订单", "退货", "客户分层", "区域", "折扣", "毛利",
  "库存周转", "复购", "客单价", "渠道", "履约", "发票", "回款",
];
const SKILL_DOMAINS = ["superstore", "warehouse", "finance", "ops", "generic"];

function wikiPage(n) {
  const id = String(n).padStart(3, "0");
  // 标记页（001）是 MCP-PERF profile 的实读锚点，`["*"]` 全角色可检索；
  // 其余页保持随机 uat_role ACL（页 ACL 矩阵语义不变）。
  const isMarker = id === "001";
  const roleCount = int(1, 3);
  const roles = [];
  for (let k = 0; k < roleCount; k++) {
    const r = `uat_role_${String(int(1, 200)).padStart(3, "0")}`;
    if (!roles.includes(r)) roles.push(r);
  }
  const allowedRoles = isMarker ? ["*"] : roles;
  const termA = WIKI_TERMS[int(0, WIKI_TERMS.length - 1)];
  const termB = WIKI_TERMS[int(0, WIKI_TERMS.length - 1)];
  const body = [
    `---`,
    `summary: UAT 规模基线 Wiki 页 ${id}：${termA}与${termB}口径说明（夹具，勿用于生产）`,
    `allowed_roles: [${allowedRoles.map((r) => JSON.stringify(r)).join(", ")}]`,
    `---`,
    ``,
    `# UAT Wiki ${id}：${termA} × ${termB}`,
    ``,
    `本页是 UAT 规模基线夹具（seed-scale-wiki-skills.mjs，seed=${SEED}），`,
    `用于验证 Wiki 在 ${TARGET_WIKI} 页规模下的检索、ACL 与索引行为。`,
    ``,
    `## 口径`,
    ``,
    `- ${termA}：按订单行汇总，含边界调整；与 demo-superstore 页口径一致。`,
    `- ${termB}：按自然月聚合，缺失日补零；适用于近 30 天窗口。`,
    `- 两口径交叉时以 ${termA} 为准，${termB} 仅作对照。`,
    ``,
    `## 校验锚点`,
    ``,
    `页锚 uat-wiki-${id}：${termA} ${termB} ${int(1000, 999999)}。`,
    ``,
    ...(isMarker ? [`Marker terms: uat wiki marker page one scale baseline anchor.`, ``] : []),
  ].join("\n");
  return { name: `uat-wiki-${id}.md`, body };
}

function skillFile(n) {
  const id = String(n).padStart(3, "0");
  const domain = SKILL_DOMAINS[n % SKILL_DOMAINS.length];
  const termA = WIKI_TERMS[int(0, WIKI_TERMS.length - 1)];
  return {
    name: `uat_skill_${id}.md`,
    body: [
      `---`,
      `name: uat-skill-${id}`,
      `domain: ${domain}`,
      `title: UAT Skill ${id}（${termA}分析）`,
      `description: UAT 规模基线 Skill ${id}，${domain} 域 ${termA} 分析夹具，勿用于生产。`,
      `roles_allowed: ["*"]`,
      `version: 1.0.0`,
      `status: published`,
      `---`,
      ``,
      `# UAT Skill ${id}`,
      ``,
      `规模基线夹具（seed-scale-wiki-skills.mjs，seed=${SEED}）。`,
      `当用户询问 ${termA} 相关问题时，引用 demo-superstore 口径作答。`,
      ``,
    ].join("\n"),
  };
}

// ---- 主流程 ----------------------------------------------------------------

function startLucyAndWaitHealth() {
  docker("start", LUCY);
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    try {
      const out = execFileSync("curl", ["-sf", HEALTH_URL], { stdio: ["pipe", "pipe", "pipe"] }).toString();
      if (out.includes("gitSha")) return;
    } catch {
      // retry
    }
    execFileSync("sleep", ["3"]);
  }
  throw new Error("健康检查超时：" + HEALTH_URL);
}

function main() {
  console.log(`[seed-wiki-skills] 目标：Wiki ${TARGET_WIKI} 页／Skill ${TARGET_SKILLS} 个`);
  const tmp = mkdtempSync(path.join(tmpdir(), "uat-seed-ws-"));

  // 0) 清理旧夹具并预建目录（容器须在运行态才能 exec）。
  // Lucy 内容根由 LUCY_CONTENT_ROOT 决定（demo 为 /data/lucy/config），与 KTX
  // 检索目录（/data/lucy/wiki）是两个视图：ACL／回退读前者，索引读后者，
  // 两处必须同写，否则页可被 KTX 命中却被 Lucy 判 wiki_not_found。
  const LUCY_WIKI_DIR = process.env.LUCY_CONTENT_WIKI_DIR || "/data/lucy/config/wiki";
  docker("exec", LUCY, "sh", "-c",
    `rm -f ${WIKI_DIR}/global/uat-wiki-*.md ${LUCY_WIKI_DIR}/global/uat-wiki-*.md; rm -rf ${SKILLS_DIR}/uat_skills; mkdir -p ${SKILLS_DIR}/uat_skills ${LUCY_WIKI_DIR}/global; echo cleaned`);
  console.log("[seed-wiki-skills] 已清理旧 uat-wiki-*.md／uat_skills，并预建 uat_skills 目录");

  try {
    docker("stop", LUCY);
    console.log("[seed-wiki-skills] 已停止 " + LUCY);
  } catch {
    console.log("[seed-wiki-skills] " + LUCY + " 未在运行，继续");
  }

  // 1) Wiki 页
  const wikiPages = Array.from({ length: TARGET_WIKI }, (_, i) => wikiPage(i + 1));
  for (const p of wikiPages) {
    writeFileSync(path.join(tmp, p.name), p.body);
  }
  for (const p of wikiPages) {
    docker("cp", path.join(tmp, p.name), `${LUCY}:${WIKI_DIR}/global/${p.name}`);
    docker("cp", path.join(tmp, p.name), `${LUCY}:${LUCY_WIKI_DIR}/global/${p.name}`);
  }
  console.log(`[seed-wiki-skills] 已写入 ${wikiPages.length} 页至 ${WIKI_DIR} 与 ${LUCY_WIKI_DIR} 的 global/uat-wiki-*.md`);

  // 2) Skill 文件（目录已预建，停止态 docker cp 到文件路径即可）
  const skillFiles = Array.from({ length: TARGET_SKILLS }, (_, i) => skillFile(i + 1));
  for (const s of skillFiles) {
    writeFileSync(path.join(tmp, s.name), s.body);
    docker("cp", path.join(tmp, s.name), `${LUCY}:${SKILLS_DIR}/uat_skills/${s.name}`);
  }
  console.log(`[seed-wiki-skills] 已写入 ${skillFiles.length} 个 Skill 至 ${SKILLS_DIR}/uat_skills/`);

  startLucyAndWaitHealth();

  // 3) 复核：KTX 知识库索引行数 + loader 口径 Skill 计数
  const idxJs = [
    'const D=require("/app/node_modules/better-sqlite3");',
    "let wiki=0;",
    'try{const db=new D("/data/lucy/.ktx/db.sqlite",{readonly:true,fileMustExist:true});',
    "wiki=db.prepare(\"SELECT COUNT(*) c FROM knowledge_pages\").get().c;db.close();}catch(e){}",
    "console.log(wiki);",
  ].join("");
  const wikiIndexed = Number(
    execFileSync("docker", ["exec", LUCY, "node", "-e", idxJs], { stdio: ["pipe", "pipe", "pipe"] }).toString(),
  );
  const fsCount = Number(docker("exec", LUCY, "sh", "-c",
    `ls ${WIKI_DIR}/global/uat-wiki-*.md 2>/dev/null | wc -l`).toString());
  console.log(`[seed-wiki-skills] 复核：Wiki 文件 ${fsCount} 页／KTX 索引 ${wikiIndexed} 页`);
  if (wikiIndexed < fsCount) {
    console.log("[seed-wiki-skills] 注意：KTX 索引未覆盖全部新页（启动索引可能不含新文件），Wiki 维度以文件数为准并需在跑次观察索引行为");
  }
  const ok = fsCount >= TARGET_WIKI;
  console.log(ok ? "[seed-wiki-skills] 完成" : "[seed-wiki-skills] 复核未达标");
  process.exit(ok ? 0 : 1);
}

main();
