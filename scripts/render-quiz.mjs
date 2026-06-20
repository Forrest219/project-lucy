#!/usr/bin/env node
// render-quiz.mjs — generate quiz HTML from YAML quiz_cases section
// Usage: node scripts/render-quiz.mjs [--cases <path>] [--output <path>]

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname, basename, join } from 'node:path';
import { parseArgs } from 'node:util';
import YAML from 'yaml';

const { values: args } = parseArgs({
  options: {
    cases: { type: 'string' },
    output: { type: 'string' },
  },
  strict: false,
});

const casesPath = resolve(args.cases ?? 'evals/superstore/eval/superstore-eval-cases.yaml');

// Derive default output path: parent of cases dir + {domain}-quiz-cases.html
function deriveOutputPath(casesFilePath) {
  const evalDir = dirname(casesFilePath);          // .../evals/superstore/eval
  const domainDir = dirname(evalDir);              // .../evals/superstore
  const domainName = basename(domainDir);          // superstore
  return join(domainDir, `${domainName}-quiz-cases.html`);
}

const outputPath = resolve(args.output ?? deriveOutputPath(casesPath));

// Parse YAML
const raw = readFileSync(casesPath, 'utf8');
const doc = YAML.parse(raw);

const meta = doc.metadata ?? {};
const quizCases = doc.quiz_cases ?? [];
const domainName = basename(dirname(dirname(casesPath)));

// Sort by numeric part of id (Q1, Q2, ...)
quizCases.sort((a, b) => {
  const na = parseInt(a.id.replace(/\D/g, ''), 10);
  const nb = parseInt(b.id.replace(/\D/g, ''), 10);
  return na - nb;
});

// Helpers
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function difficultyStars(d) {
  return `${d}★`;
}

function qtypeBadge(q) {
  if (q.question_type === 'multi') {
    return `<span class="qtype multi">多选</span>`;
  }
  if (q.question_type === 'boolean') {
    return `<span class="qtype tf">对错</span>`;
  }
  return `<span class="qtype">单选</span>`;
}

function renderOptions(q) {
  const inputType = q.question_type === 'multi' ? 'checkbox' : 'radio';
  const qid = q.id.toLowerCase();
  return q.options.map(opt =>
    `    <label><input type="${inputType}" name="${qid}" value="${escapeHtml(opt.key)}"> ${escapeHtml(opt.key)}. ${escapeHtml(opt.text)}</label>`
  ).join('\n');
}

function renderQuestion(q) {
  const evalRefsAttr = (q.eval_refs && q.eval_refs.length > 0)
    ? q.eval_refs.join(' ')
    : 'unmapped';
  const provenanceAttr = q.provenance === 'raw_sql_fallback'
    ? ` data-provenance="raw_sql_fallback"`
    : '';

  // display_type maps to answer-binding attribute
  const answerBinding = q.display_type;

  return `<div class="q" data-question-id="${escapeHtml(q.id)}" data-answer="${escapeHtml(q.answer)}" data-answer-binding="${escapeHtml(answerBinding)}" data-stale-status="fresh" data-eval-refs="${escapeHtml(evalRefsAttr)}"${provenanceAttr}>
  <div class="qhead"><span class="qnum">${escapeHtml(q.id)}</span><span class="stars">${difficultyStars(q.difficulty)}</span>${qtypeBadge(q)}</div>
  <div>${escapeHtml(q.stem)}</div>
  <div class="opts">
${renderOptions(q)}
  </div>
</div>`;
}

function renderAnswerItem(q) {
  const fallbackNote = q.provenance === 'raw_sql_fallback' ? ' <em>(SL fallback)</em>' : '';
  const correctText = q.answer.split(',').map(k => `<span class="correct">${escapeHtml(k.trim())}</span>`).join(', ');
  return `<li>${correctText}${fallbackNote} — ${escapeHtml(q.explanation)}</li>`;
}

// Build HTML
const documentName = meta.document_name ?? `${domainName} Eval Cases`;
const snapshotDate = meta.snapshot_date ?? '';
const snapshotRows = meta.snapshot_rows ?? '';
const datasetName = String(documentName)
  .replace(/\s*Eval Cases\s*$/i, '')
  .replace(/\s*Eval\s*$/i, '')
  .trim() || domainName;
const title = `${datasetName} Quiz · ${quizCases.length} 题`;

const questionsHtml = quizCases.map(renderQuestion).join('\n\n');
const answersHtml = quizCases.map(renderAnswerItem).join('\n');

// Provenance footer note
const hasFallback = quizCases.some(q => q.provenance === 'raw_sql_fallback');
const provenanceLabels = Array.from(new Set(quizCases.map(q => q.provenance || meta.data_source || 'semantic_layer')));
const fallbackNote = hasFallback
  ? `题目数据来源包含 ${provenanceLabels.map(p => `<code>${escapeHtml(p)}</code>`).join('、')}；raw SQL fallback 题必须走 KTX read-only 入口。`
  : `题目数据来源：${provenanceLabels.map(p => `<code>${escapeHtml(p)}</code>`).join('、')}。`;

const html = `<!--
meta:
  文档名称: ${title}
  文档类型: Quiz
  文档说明: HTML quiz, 人类测试用（由 scripts/render-quiz.mjs 从 ${basename(casesPath)} 渲染生成）
  版本: v1.1
  撰写日期: ${snapshotDate}
  撰写人: render-quiz.mjs
  委托人: project-lucy 团队
  基于材料: ${casesPath}
  适用范围: ${datasetName} 数据问答能力的人工测验 / 培训；${quizCases.length} 题覆盖基础、反模式、边界、降级、路径选择与多轮一致性
  输出位置: ${outputPath}
  命名约定: {domain}-{purpose}-{variant}.{ext}，与 superstore-eval-cases.yaml 保持并行
  关联 eval: ${casesPath}
  题目类型: 单选 / 对错 / 多选
  难度系数: 0.5–5★
  数据来源: semantic_layer / raw_sql_fallback
  answer_binding: 每题通过 data-answer-binding 声明 exact_value / ranking / boolean / range_bucket / conceptual
  stale_status: fresh
  snapshot_rows: ${snapshotRows}
-->
<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<title>${title}</title>
<style>
  body { font-family: -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif; max-width: 760px; margin: 32px auto; padding: 0 16px; color: #222; line-height: 1.6; }
  h1 { border-bottom: 2px solid #333; padding-bottom: 8px; }
  .meta { color: #666; font-size: 14px; margin-bottom: 24px; }
  .q { border: 1px solid #ddd; border-radius: 8px; padding: 16px; margin: 16px 0; background: #fafafa; }
  .qhead { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 8px; }
  .qnum { font-weight: bold; color: #555; }
  .stars { color: #f5a623; font-size: 14px; }
  .qtype { background: #eef; color: #335; padding: 2px 8px; border-radius: 4px; font-size: 12px; margin-left: 8px; }
  .qtype.multi { background: #fef3e0; color: #864; }
  .qtype.tf { background: #e8f5e9; color: #274; }
  .opts label { display: block; margin: 4px 0; cursor: pointer; }
  .submit { background: #1976d2; color: white; border: none; padding: 10px 24px; border-radius: 6px; cursor: pointer; font-size: 15px; margin-top: 16px; }
  .submit:hover { background: #1565c0; }
  .result { margin-top: 16px; font-size: 16px; font-weight: bold; }
  .answers { margin-top: 32px; padding: 16px; background: #fffde7; border-radius: 8px; }
  .answers h2 { margin-top: 0; }
  .answers li { margin: 4px 0; }
  .correct { color: #2e7d32; font-weight: bold; }
  details { margin-top: 24px; }
  summary { cursor: pointer; font-weight: bold; padding: 8px; background: #eee; border-radius: 4px; }
</style>
</head>
<body>

<h1>${title}</h1>
<p class="meta">基于 ${escapeHtml(documentName)}；快照日期 ${escapeHtml(snapshotDate || '未声明')}。难度系数用 ★ 表示（0.5–5★）。题目覆盖基础、反模式、边界、降级、路径选择与多轮一致性。</p>

<form id="quiz">

${questionsHtml}

<button type="button" class="submit" onclick="grade()">提交并查看得分</button>
<div class="result" id="result"></div>

</form>

<details>
<summary>查看答案与解析</summary>
<div class="answers">
<ol>
${answersHtml}
</ol>
<p style="color:#666;font-size:13px;margin-top:16px;">${fallbackNote}</p>
</div>
</details>

<script>
function grade() {
  const qs = document.querySelectorAll('.q');
  let correct = 0, total = qs.length;
  qs.forEach(q => {
    const ans = q.dataset.answer.split(',');
    let picked = [];
    q.querySelectorAll('input:checked').forEach(i => picked.push(i.value));
    picked.sort(); ans.sort();
    if (JSON.stringify(picked) === JSON.stringify(ans)) correct++;
  });
  document.getElementById('result').innerHTML =
    \`得分：<span class="correct">\${correct} / \${total}</span>（\${Math.round(correct/total*100)}%）\`;
}
</script>

</body>
</html>
`;

writeFileSync(outputPath, html, 'utf8');
process.stderr.write(`# wrote ${outputPath}\n`);
