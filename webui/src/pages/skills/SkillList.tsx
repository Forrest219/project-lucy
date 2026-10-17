import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { MarkdownPreview } from "../../components/MarkdownPreview";
import { ObjectAclField } from "../../components/ObjectAclField";
import { PageHeader } from "../../components/PageHeader";
import { queryKeys } from "../../lib/queryKeys";
import { ensureUniqueHeadingId, slugifyHeading } from "../../lib/wiki";
import {
  createSkill,
  deleteSkill,
  fetchSkillDetail,
  fetchSkillSummaries,
  previewCreateSkill,
  previewUpdateSkill,
  rolesAllowedSummary,
  skillStatusBadgeClass,
  SKILL_STATUS_LABELS,
  updateSkill,
  type SkillAsset,
  type SkillStatus,
  type SkillSummary,
  type SkillWritePayload,
  type SkillWritePreview
} from "../../lib/skills";

type EditorMode = "view" | "edit" | "create";
type StatusFilter = "all" | SkillStatus;
type ValidationFilter = "all" | "valid" | "invalid";

type DraftForm = {
  name: string;
  domain: string;
  title: string;
  version: string;
  status: SkillStatus;
  /** `roles_allowed`: [] = no one (default), ["*"] = all roles, otherwise explicit Role ids. */
  rolesAllowed: string[];
  rolesAllowedInvalid: boolean;
  triggers: string[];
  description: string;
  prerequisiteSources: string[];
  prerequisiteMeasures: string[];
  prerequisiteWikiDocs: string[];
  evalCases: string[];
  content: string;
};

function emptyDraft(domain = "custom"): DraftForm {
  return {
    name: "",
    domain,
    title: "",
    version: "1.0.0",
    status: "draft",
    rolesAllowed: [],
    rolesAllowedInvalid: false,
    triggers: [],
    description: "",
    prerequisiteSources: [],
    prerequisiteMeasures: [],
    prerequisiteWikiDocs: [],
    evalCases: [],
    content: ""
  };
}

function draftFromSkill(skill: SkillAsset): DraftForm {
  return {
    name: skill.name,
    domain: skill.domain,
    title: skill.title,
    version: skill.version,
    status: skill.status,
    rolesAllowed: skill.roles_allowed,
    rolesAllowedInvalid: skill.roles_allowed_invalid === true,
    triggers: skill.triggers,
    description: skill.description,
    prerequisiteSources: skill.prerequisites.sources ?? [],
    prerequisiteMeasures: skill.prerequisites.measures ?? [],
    prerequisiteWikiDocs: skill.prerequisites.wiki_docs ?? [],
    evalCases: skill.eval_cases,
    content: skill.content
  };
}

function cleanList(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function payloadFromDraft(draft: DraftForm): SkillWritePayload {
  return {
    name: draft.name.trim(),
    domain: draft.domain.trim(),
    title: draft.title.trim() || draft.name.trim(),
    version: draft.version.trim() || "1.0.0",
    status: draft.status,
    // A corrupt stored declaration is only rewritten after the owner chooses a value explicitly.
    ...(draft.rolesAllowedInvalid ? {} : { roles_allowed: cleanList(draft.rolesAllowed) }),
    triggers: cleanList(draft.triggers),
    description: draft.description.trim(),
    prerequisites: {
      sources: cleanList(draft.prerequisiteSources),
      measures: cleanList(draft.prerequisiteMeasures),
      wiki_docs: cleanList(draft.prerequisiteWikiDocs)
    },
    eval_cases: cleanList(draft.evalCases),
    content: draft.content
  };
}

function draftVersion(draft: DraftForm): string {
  return JSON.stringify(payloadFromDraft(draft));
}

function parseSkillSelector(selector: string | null): { domain: string; name: string } | null {
  if (!selector) return null;
  const slash = selector.indexOf("/");
  if (slash <= 0 || slash === selector.length - 1) return null;
  return { domain: selector.slice(0, slash), name: selector.slice(slash + 1) };
}

function formatRoles(roles: string[]): string {
  if (roles.includes("*")) return "所有角色";
  return roles.length === 0 ? "无人可见" : roles.join("、");
}

function validationLabel(skill: Pick<SkillSummary, "validation">): string {
  return skill.validation.valid ? "校验通过" : `${skill.validation.issues.length} 个问题`;
}

function extractSkillToc(content: string, title: string) {
  const headings = content.split("\n").flatMap((line) => {
    const match = /^(#{1,3})\s+(.+)$/.exec(line.trim());
    if (!match) return [];
    return [{ level: match[1].length, text: match[2].trim() }];
  });
  if (headings[0]?.level === 1 && headings[0].text === title.trim()) headings.shift();
  const usedIds = new Set<string>();
  return headings.map((heading) => ({
    ...heading,
    id: ensureUniqueHeadingId(slugifyHeading(heading.text), usedIds)
  }));
}

function ValidationCell({ skill }: { skill: Pick<SkillSummary, "validation"> }) {
  const warningCount = skill.validation.issues.filter((issue) => issue.type === "warning").length;
  if (skill.validation.valid) {
    return <span data-testid="skill-validation"><span className="pl-status-badge pl-status-done">校验通过</span>{warningCount > 0 ? <span className="ml-1 text-xs text-fg-muted">{warningCount} 条警告</span> : null}</span>;
  }
  return <span data-testid="skill-validation"><span className="pl-status-badge pl-status-validation_failed">校验未通过</span><span className="ml-1 text-xs text-fg-muted">{skill.validation.issues.length} 个问题</span></span>;
}

function DetailRow({ label, children, testId }: { label: string; children: ReactNode; testId?: string }) {
  return <div className="grid gap-1" data-testid={testId}><span className="pl-eyebrow">{label}</span><div className="text-sm text-fg-default">{children}</div></div>;
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="grid gap-1 text-sm"><span className="pl-eyebrow">{label}</span>{children}</label>;
}

function ListField({ label, values, onChange, addLabel, testId }: {
  label: string;
  values: string[];
  onChange: (values: string[]) => void;
  addLabel: string;
  testId?: string;
}) {
  return (
    <fieldset className="pl-skill-list-field" data-testid={testId}>
      <legend className="pl-eyebrow">{label}</legend>
      {values.map((value, index) => (
        <div className="pl-skill-list-field-row" key={`${label}-${index}`}>
          <input aria-label={`${label} ${index + 1}`} className="pl-input notranslate" translate="no" value={value} onChange={(event) => onChange(values.map((item, itemIndex) => itemIndex === index ? event.target.value : item))} />
          <button aria-label={`删除${label} ${index + 1}`} className="pl-btn pl-btn--ghost text-xs" type="button" onClick={() => onChange(values.filter((_, itemIndex) => itemIndex !== index))}>删除</button>
        </div>
      ))}
      <button className="pl-btn pl-btn--ghost justify-self-start text-xs" type="button" onClick={() => onChange([...values, ""])}>{addLabel}</button>
    </fieldset>
  );
}

function SkillExplorer({ skills, selectedDomain, selectedSelector, search, onSearch, onSelectAll, onSelectDomain, onSelectSkill }: {
  skills: SkillSummary[];
  selectedDomain: string;
  selectedSelector: string | null;
  search: string;
  onSearch: (value: string) => void;
  onSelectAll: () => void;
  onSelectDomain: (domain: string) => void;
  onSelectSkill: (skill: SkillSummary) => void;
}) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const normalizedSearch = search.trim().toLowerCase();
  const groups = useMemo(() => {
    const byDomain = new Map<string, SkillSummary[]>();
    for (const skill of skills) {
      const haystack = `${skill.name} ${skill.title} ${skill.domain} ${skill.triggers.join(" ")}`.toLowerCase();
      if (normalizedSearch && !haystack.includes(normalizedSearch)) continue;
      const entries = byDomain.get(skill.domain) ?? [];
      entries.push(skill);
      byDomain.set(skill.domain, entries);
    }
    return [...byDomain.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([domain, entries]) => ({ domain, entries: entries.sort((a, b) => a.name.localeCompare(b.name)) }));
  }, [normalizedSearch, skills]);

  return (
    <aside className="pl-skill-explorer" data-testid="skills-explorer" aria-label="领域与 Skill 浏览器">
      <div className="pl-skill-explorer-header"><strong>领域与 Skill</strong><span>{skills.length}</span></div>
      <input aria-label="搜索领域或 Skill" className="pl-input pl-skill-explorer-search" data-testid="skills-search" placeholder="搜索领域或 Skill" value={search} onChange={(event) => onSearch(event.target.value)} />
      <nav aria-label="Skill 范围">
        <button aria-current={!selectedDomain && !selectedSelector ? "page" : undefined} className={`pl-skill-tree-all${!selectedDomain && !selectedSelector ? " pl-skill-tree-active" : ""}`} data-testid="skills-all" type="button" onClick={onSelectAll}><span>全部 Skill</span><span>{skills.length}</span></button>
        <ul className="pl-skill-tree" role="list">
          {groups.map(({ domain, entries }) => {
            const expanded = normalizedSearch.length > 0 || !collapsed.has(domain);
            return (
              <li key={domain}>
                <div className="pl-skill-tree-domain-row">
                  <button aria-expanded={expanded} aria-label={`${expanded ? "折叠" : "展开"} ${domain}`} className="pl-skill-tree-caret" type="button" onClick={() => setCollapsed((current) => { const next = new Set(current); if (next.has(domain)) next.delete(domain); else next.add(domain); return next; })}>{expanded ? "▾" : "▸"}</button>
                  <button aria-current={selectedDomain === domain && !selectedSelector ? "page" : undefined} className={`pl-skill-tree-domain${selectedDomain === domain && !selectedSelector ? " pl-skill-tree-active" : ""}`} data-testid="skills-domain" type="button" onClick={() => onSelectDomain(domain)}><span className="notranslate" translate="no">{domain}</span><span>{entries.length}</span></button>
                </div>
                {expanded ? <ul className="pl-skill-tree-items" role="list">{entries.map((skill) => { const selector = `${skill.domain}/${skill.name}`; return <li key={skill.uri}><button aria-current={selectedSelector === selector ? "page" : undefined} className={`pl-skill-tree-skill${selectedSelector === selector ? " pl-skill-tree-active" : ""}`} type="button" onClick={() => onSelectSkill(skill)}><span className="notranslate" translate="no">{skill.name}</span>{!skill.validation.valid ? <span aria-label={validationLabel(skill)}>!</span> : null}</button></li>; })}</ul> : null}
              </li>
            );
          })}
        </ul>
      </nav>
    </aside>
  );
}

function SkillOverview({ skills, domain, statusFilter, onStatusFilter, validationFilter, onValidationFilter, onOpenSkill }: {
  skills: SkillSummary[];
  domain: string;
  statusFilter: StatusFilter;
  onStatusFilter: (value: StatusFilter) => void;
  validationFilter: ValidationFilter;
  onValidationFilter: (value: ValidationFilter) => void;
  onOpenSkill: (skill: SkillSummary) => void;
}) {
  const [page, setPage] = useState(1);
  const filtered = useMemo(() => skills.filter((skill) => {
    if (domain && skill.domain !== domain) return false;
    if (statusFilter !== "all" && skill.status !== statusFilter) return false;
    if (validationFilter === "valid" && !skill.validation.valid) return false;
    if (validationFilter === "invalid" && skill.validation.valid) return false;
    return true;
  }), [domain, skills, statusFilter, validationFilter]);
  const pageSize = 20;
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, pageCount);
  const visible = filtered.slice((safePage - 1) * pageSize, safePage * pageSize);
  useEffect(() => setPage(1), [domain, statusFilter, validationFilter]);

  return (
    <section className="pl-skill-main-card" data-testid="skills-section">
      <header className="pl-skill-overview-header">
        <div><span className="pl-eyebrow">治理范围</span><h2>Skill 治理总览</h2><p>{domain ? <><span className="notranslate" translate="no">{domain}</span> · </> : "全部领域 · "}{filtered.length} 个 Skill</p></div>
        <div className="pl-skill-filters" aria-label="Skill 治理筛选">
          <label>状态<select className="pl-input" value={statusFilter} onChange={(event) => onStatusFilter(event.target.value as StatusFilter)}><option value="all">全部</option><option value="draft">草稿</option><option value="published">已发布</option><option value="deprecated">已停用</option></select></label>
          <label>校验状态<select className="pl-input" value={validationFilter} onChange={(event) => onValidationFilter(event.target.value as ValidationFilter)}><option value="all">全部</option><option value="valid">校验通过</option><option value="invalid">校验未通过</option></select></label>
        </div>
      </header>
      {visible.length === 0 ? <p className="pl-notice" data-testid="skills-empty">当前范围没有匹配的 Skill。</p> : <div className="overflow-x-auto"><table className="pl-data-grid pl-data-table" data-testid="skills-table"><thead><tr><th scope="col">名称</th><th scope="col">域</th><th scope="col">状态</th><th scope="col">版本</th><th scope="col">校验结果</th></tr></thead><tbody>{visible.map((skill) => <tr data-testid="skills-row" data-status={skill.status} key={skill.uri}><td><button className="pl-row-action-link" data-testid="skills-open-detail" type="button" onClick={() => onOpenSkill(skill)}><span className="notranslate" translate="no">{skill.name}</span></button>{skill.title !== skill.name ? <div className="text-xs text-fg-muted">{skill.title}</div> : null}</td><td><span className="notranslate" translate="no">{skill.domain}</span></td><td><span className={skillStatusBadgeClass(skill.status)} data-status={skill.status} data-testid="skill-status">{SKILL_STATUS_LABELS[skill.status]}</span></td><td><span className="notranslate" translate="no">{skill.version}</span></td><td><ValidationCell skill={skill} /></td></tr>)}</tbody></table></div>}
      <footer className="pl-skill-pagination"><span>显示 {filtered.length === 0 ? 0 : (safePage - 1) * pageSize + 1}–{Math.min(safePage * pageSize, filtered.length)} / {filtered.length}</span><div><button className="pl-btn pl-btn--ghost text-xs" disabled={safePage <= 1} type="button" onClick={() => setPage((value) => value - 1)}>上一页</button><button className="pl-btn pl-btn--ghost text-xs" disabled={safePage >= pageCount} type="button" onClick={() => setPage((value) => value + 1)}>下一页</button></div></footer>
    </section>
  );
}

function SkillReadView({ skill, onBack, onEdit, onDelete, deleting, confirmDelete, onArmDelete }: {
  skill: SkillAsset;
  onBack: () => void;
  onEdit: () => void;
  onDelete: () => void;
  deleting: boolean;
  confirmDelete: boolean;
  onArmDelete: () => void;
}) {
  const toc = extractSkillToc(skill.content, skill.title);
  const prerequisiteGroups = [{ label: "语义源", values: skill.prerequisites.sources ?? [] }, { label: "指标", values: skill.prerequisites.measures ?? [] }, { label: "Wiki 文档", values: skill.prerequisites.wiki_docs ?? [] }].filter((group) => group.values.length > 0);
  return (
    <article className="pl-skill-main-card pl-skill-read" data-testid="skill-detail">
      <header className="pl-skill-detail-header"><div><button className="pl-inline-link" data-testid="skill-detail-back" type="button" onClick={onBack}>返回治理总览</button><span className="pl-eyebrow">业务 Skill</span><h2 data-testid="skill-detail-title">{skill.title || skill.name}</h2><code className="notranslate" translate="no">{skill.domain}/{skill.name}</code></div><div className="pl-skill-detail-actions"><button className="pl-btn pl-btn--primary text-sm" data-testid="skill-edit" type="button" onClick={onEdit}>编辑</button>{confirmDelete ? <button className="pl-btn pl-btn--danger text-sm" data-testid="skill-delete-confirm" disabled={deleting} type="button" onClick={onDelete}>确认删除</button> : <button className="pl-btn pl-btn--ghost text-sm" data-testid="skill-delete" type="button" onClick={onArmDelete}>删除 Skill</button>}</div></header>
      <div className="pl-skill-meta-strip"><span className={skillStatusBadgeClass(skill.status)}>{SKILL_STATUS_LABELS[skill.status]}</span><span>版本 <span className="notranslate" translate="no">{skill.version}</span></span><ValidationCell skill={skill} /></div>
      <div className="pl-skill-detail-grid"><DetailRow label="Skill URI" testId="skill-detail-uri"><code className="notranslate" translate="no">{skill.uri}</code></DetailRow><DetailRow label="文件路径"><code className="notranslate" data-testid="skill-detail-path" translate="no">{skill.relativePath}</code></DetailRow><DetailRow label="可访问角色" testId="skill-detail-roles">{skill.roles_allowed_invalid ? "授权声明已损坏（无人可见，请编辑修复）" : rolesAllowedSummary(skill.roles_allowed).label || <span className="notranslate" translate="no">{skill.roles_allowed.join("、")}</span>}</DetailRow><DetailRow label="触发词" testId="skill-detail-triggers">{skill.triggers.length ? <span className="notranslate" translate="no">{skill.triggers.join("、")}</span> : "—"}</DetailRow><DetailRow label="前置依赖" testId="skill-detail-prerequisites">{prerequisiteGroups.length ? prerequisiteGroups.map((group) => <div key={group.label}>{group.label}：<span className="notranslate" translate="no">{group.values.join("、")}</span></div>) : "—"}</DetailRow></div>
      {skill.validation.issues.length > 0 ? <section className="pl-skill-validation-panel" data-testid="skill-detail-validation-issues"><strong>校验问题</strong><ul>{skill.validation.issues.map((issue, index) => <li key={`${issue.code}-${index}`}><span className={issue.type === "error" ? "pl-status-badge pl-status-validation_failed" : "pl-status-badge pl-status-partial"}>{issue.type === "error" ? "错误" : "警告"}</span> <code className="notranslate" translate="no">{issue.field}</code> {issue.message}</li>)}</ul></section> : null}
      <div className={`pl-skill-read-layout${toc.length < 2 ? " pl-skill-read-layout--no-toc" : ""}`} data-testid="skill-detail-content"><div className="pl-skill-markdown"><MarkdownPreview markdown={skill.content} hideLeadingHeading={skill.title} /></div>{toc.length >= 2 ? <nav className="pl-skill-toc" aria-label="Skill 页内目录"><strong>页内目录</strong><ul>{toc.map((item) => <li className={item.level > 1 ? "pl-skill-toc-sub" : ""} key={item.id}><a href={`#${item.id}`}>{item.text}</a></li>)}</ul></nav> : null}</div>
    </article>
  );
}

function SkillEditor({ draft, onChange, identityLocked, metadataOpen, onMetadataOpen }: {
  draft: DraftForm;
  onChange: (next: DraftForm) => void;
  identityLocked: boolean;
  metadataOpen: boolean;
  onMetadataOpen: (open: boolean) => void;
}) {
  return (
    <div className="pl-skill-editor" data-testid="skill-editor-form">
      <section className={`pl-workbench-disclosure${metadataOpen ? " pl-workbench-disclosure--open" : ""}`}>
        <button aria-expanded={metadataOpen} className="pl-workbench-disclosure-summary" data-testid="skill-metadata-toggle" type="button" onClick={() => onMetadataOpen(!metadataOpen)}><span className="pl-disclosure-title"><span aria-hidden="true">{metadataOpen ? "▾" : "▸"}</span>元数据</span><small>{SKILL_STATUS_LABELS[draft.status]} · <span className="notranslate" translate="no">v{draft.version}</span></small></button>
        {metadataOpen ? <div className="pl-skill-metadata-form"><div className="pl-skill-field-grid"><Field label="名称"><input className="pl-input notranslate" data-testid="skill-field-name" disabled={identityLocked} translate="no" value={draft.name} onChange={(event) => onChange({ ...draft, name: event.target.value })} /></Field><Field label="域"><input className="pl-input notranslate" data-testid="skill-field-domain" disabled={identityLocked} translate="no" value={draft.domain} onChange={(event) => onChange({ ...draft, domain: event.target.value })} /></Field><Field label="标题"><input className="pl-input" data-testid="skill-field-title" value={draft.title} onChange={(event) => onChange({ ...draft, title: event.target.value })} /></Field><Field label="版本"><input className="pl-input notranslate" data-testid="skill-field-version" translate="no" value={draft.version} onChange={(event) => onChange({ ...draft, version: event.target.value })} /></Field><Field label="状态"><select className="pl-input" data-testid="skill-field-status" value={draft.status} onChange={(event) => onChange({ ...draft, status: event.target.value as SkillStatus })}><option value="draft">草稿</option><option value="published">已发布</option><option value="deprecated">已停用</option></select></Field><ObjectAclField corrupt={draft.rolesAllowedInvalid} onChange={(next) => onChange({ ...draft, rolesAllowed: next, rolesAllowedInvalid: false })} testId="skill-field-roles" value={draft.rolesAllowed} /><Field label="说明"><textarea className="pl-input min-h-20" data-testid="skill-field-description" value={draft.description} onChange={(event) => onChange({ ...draft, description: event.target.value })} /></Field></div>
          <div className="pl-skill-structured-grid"><ListField addLabel="添加触发词" label="触发词" onChange={(values) => onChange({ ...draft, triggers: values })} testId="skill-field-triggers" values={draft.triggers} /><ListField addLabel="添加语义源" label="前置语义源" onChange={(values) => onChange({ ...draft, prerequisiteSources: values })} testId="skill-field-prereq-sources" values={draft.prerequisiteSources} /><ListField addLabel="添加指标" label="前置指标" onChange={(values) => onChange({ ...draft, prerequisiteMeasures: values })} testId="skill-field-prereq-measures" values={draft.prerequisiteMeasures} /><ListField addLabel="添加 Wiki 文档" label="前置 Wiki 文档" onChange={(values) => onChange({ ...draft, prerequisiteWikiDocs: values })} testId="skill-field-prereq-wiki" values={draft.prerequisiteWikiDocs} /><ListField addLabel="添加评测用例" label="评测用例" onChange={(values) => onChange({ ...draft, evalCases: values })} testId="skill-field-eval-cases" values={draft.evalCases} /></div></div> : null}
      </section>
      <div className="pl-skill-markdown-editor"><section><header><strong>Markdown 源码</strong></header><textarea aria-label="Markdown 源码" className="pl-input notranslate" data-testid="skill-field-content" translate="no" value={draft.content} onChange={(event) => onChange({ ...draft, content: event.target.value })} /></section><section data-testid="skill-markdown-preview"><header><strong>渲染预览</strong></header><div className="pl-skill-markdown-preview"><MarkdownPreview markdown={draft.content} hideLeadingHeading={draft.title} /></div></section></div>
    </div>
  );
}

function PreflightDialog({ open, onOpenChange, preview, canConfirm, confirming, onConfirm }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  preview: SkillWritePreview | null;
  canConfirm: boolean;
  confirming: boolean;
  onConfirm: () => void;
}) {
  return <Dialog.Root open={open} onOpenChange={onOpenChange}><Dialog.Portal><Dialog.Overlay className="pl-dialog-overlay" /><Dialog.Content className="pl-dialog-content pl-skill-preflight" data-testid="skill-preflight" aria-describedby="skill-preflight-description"><Dialog.Title className="pl-panel-title">保存 Skill 前预检</Dialog.Title><Dialog.Description className="text-sm text-fg-muted" id="skill-preflight-description">确认本次写入的校验、状态和 Diff。</Dialog.Description>{preview ? <><section className={preview.validation.valid ? "pl-notice" : "pl-skill-preflight-warning"}><strong>校验结果：{preview.validation.valid ? "通过" : `${preview.validation.issues.length} 个内容问题（允许保存）`}</strong>{preview.validation.issues.length ? <ul>{preview.validation.issues.map((issue, index) => <li key={`${issue.code}-${index}`}><code className="notranslate" translate="no">{issue.field}</code>：{issue.message}</li>)}</ul> : null}</section><dl className="pl-skill-preflight-impact"><div><dt>状态变化</dt><dd>{preview.impact.status.from ? SKILL_STATUS_LABELS[preview.impact.status.from] : "新建"} → {SKILL_STATUS_LABELS[preview.impact.status.to]}</dd></div><div data-testid="skill-preflight-roles"><dt>可访问角色</dt><dd><span className="notranslate" translate="no">{formatRoles(preview.impact.rolesAllowed.from)} → {formatRoles(preview.impact.rolesAllowed.to)}</span>{preview.impact.enteredWildcard ? "（扩权：所有角色可见）" : ""}{preview.impact.affectedAgentCount > 0 ? `；影响 ${preview.impact.affectedAgentCount} 个 Agent` : ""}</dd></div></dl><section><strong>变更 Diff</strong><pre className="pl-skill-preflight-diff notranslate" data-testid="skill-preflight-diff" translate="no">{preview.diff || "没有文本差异。"}</pre></section></> : null}<footer className="pl-dialog-actions"><Dialog.Close asChild><button className="pl-btn pl-btn--ghost" type="button">返回编辑</button></Dialog.Close><button className="pl-btn pl-btn--primary" data-testid="skill-preflight-confirm" disabled={!canConfirm || confirming} type="button" onClick={onConfirm}>确认保存</button></footer></Dialog.Content></Dialog.Portal></Dialog.Root>;
}

export function SkillList() {
  const [searchParams, setSearchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const selectorText = searchParams.get("skill");
  const selector = parseSkillSelector(selectorText);
  const creating = searchParams.get("new") === "1";
  const domainParam = searchParams.get("domain") ?? "";
  const [mode, setMode] = useState<EditorMode>(creating ? "create" : "view");
  const [draft, setDraft] = useState<DraftForm>(() => emptyDraft(domainParam || "custom"));
  const [baselineVersion, setBaselineVersion] = useState(() => draftVersion(emptyDraft(domainParam || "custom")));
  const [metadataOpen, setMetadataOpen] = useState(creating);
  const [formError, setFormError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [validationFilter, setValidationFilter] = useState<ValidationFilter>("all");
  const [preflightOpen, setPreflightOpen] = useState(false);
  const [preview, setPreview] = useState<SkillWritePreview | null>(null);
  const [previewDraftVersion, setPreviewDraftVersion] = useState<string | null>(null);
  const sourceRef = useRef("");
  const saveButtonRef = useRef<HTMLButtonElement>(null);

  const summariesQuery = useQuery({ queryKey: queryKeys.skills, queryFn: fetchSkillSummaries });
  const detailQuery = useQuery({ queryKey: selector ? queryKeys.skill(selector.domain, selector.name) : ["skills", "none"], queryFn: () => fetchSkillDetail(selector!.domain, selector!.name), enabled: Boolean(selector) });
  const skills = summariesQuery.data?.skills ?? [];
  const selectedSkill = detailQuery.data?.skill ?? null;
  const currentDraftVersion = draftVersion(draft);
  const dirty = (mode === "edit" || mode === "create") && currentDraftVersion !== baselineVersion;

  useEffect(() => {
    if (!creating) return;
    const source = `create:${domainParam}`;
    if (sourceRef.current === source) return;
    const next = emptyDraft(domainParam || "custom");
    sourceRef.current = source;
    setDraft(next);
    setBaselineVersion(draftVersion(next));
    setMode("create");
    setMetadataOpen(true);
    setFormError(null);
    setConfirmDelete(false);
  }, [creating, domainParam]);

  useEffect(() => {
    if (!selectedSkill || creating) return;
    const source = `skill:${selectedSkill.uri}:${selectedSkill.file_version}`;
    if (sourceRef.current === source) return;
    const next = draftFromSkill(selectedSkill);
    sourceRef.current = source;
    setDraft(next);
    setBaselineVersion(draftVersion(next));
    setMode("view");
    setMetadataOpen(false);
    setFormError(null);
    setConfirmDelete(false);
  }, [creating, selectedSkill]);

  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    const onClick = (event: MouseEvent) => {
      const anchor = (event.target as Element).closest("a[href]") as HTMLAnchorElement | null;
      if (!anchor) return;
      const url = new URL(anchor.href, window.location.href);
      if (url.pathname === window.location.pathname && url.search === window.location.search) return;
      if (!window.confirm("当前编辑未保存。离开会放弃未保存内容，是否继续？")) { event.preventDefault(); event.stopPropagation(); }
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    document.addEventListener("click", onClick, true);
    return () => { window.removeEventListener("beforeunload", onBeforeUnload); document.removeEventListener("click", onClick, true); };
  }, [dirty]);

  useEffect(() => {
    if (previewDraftVersion && previewDraftVersion !== currentDraftVersion) {
      setPreflightOpen(false);
      setPreview(null);
      setPreviewDraftVersion(null);
    }
  }, [currentDraftVersion, previewDraftVersion]);

  const confirmDiscard = (message: string) => !dirty || window.confirm(message);
  const navigate = (next: URLSearchParams, message: string) => { if (!confirmDiscard(message)) return; sourceRef.current = ""; setPreflightOpen(false); setMode(next.get("new") === "1" ? "create" : "view"); setSearchParams(next); };
  const openAll = () => navigate(new URLSearchParams(), "当前编辑未保存。返回全部 Skill 会放弃未保存内容，是否继续？");
  const openDomain = (domain: string) => { const next = new URLSearchParams(); next.set("domain", domain); navigate(next, "当前编辑未保存。切换领域会放弃未保存内容，是否继续？"); };
  const openSkill = (skill: SkillSummary) => { const next = new URLSearchParams(); next.set("skill", `${skill.domain}/${skill.name}`); navigate(next, "当前编辑未保存。切换 Skill 会放弃未保存内容，是否继续？"); };
  const openCreate = () => { const next = new URLSearchParams(); next.set("new", "1"); if (domainParam) next.set("domain", domainParam); navigate(next, "当前编辑未保存。新建 Skill 会放弃未保存内容，是否继续？"); };
  const backToDomain = () => { const next = new URLSearchParams(); if (selectedSkill?.domain) next.set("domain", selectedSkill.domain); navigate(next, "当前编辑未保存。返回治理总览会放弃未保存内容，是否继续？"); };

  const previewMutation = useMutation({ mutationFn: async () => { const payload = payloadFromDraft(draft); if (mode === "create") return previewCreateSkill(payload); if (!selectedSkill) throw new Error("未选择 Skill。"); return previewUpdateSkill(selectedSkill.domain, selectedSkill.name, { ...payload, expected_version: selectedSkill.file_version }); }, onSuccess: (result) => { setPreview(result.preview); setPreviewDraftVersion(currentDraftVersion); setFormError(null); setPreflightOpen(true); }, onError: (error) => setFormError(error instanceof Error ? error.message : String(error)) });
  const saveMutation = useMutation({ mutationFn: async () => { const payload = payloadFromDraft(draft); if (mode === "create") return createSkill(payload); if (!selectedSkill) throw new Error("未选择 Skill。"); return updateSkill(selectedSkill.domain, selectedSkill.name, { ...payload, expected_version: selectedSkill.file_version }); }, onSuccess: async (result) => { const nextDraft = draftFromSkill(result.skill); sourceRef.current = `skill:${result.skill.uri}:${result.skill.file_version}`; setDraft(nextDraft); setBaselineVersion(draftVersion(nextDraft)); setMode("view"); setPreflightOpen(false); setPreview(null); setFormError(null); queryClient.setQueryData(queryKeys.skill(result.skill.domain, result.skill.name), { ok: true, skill: result.skill }); await queryClient.invalidateQueries({ queryKey: queryKeys.skills }); const next = new URLSearchParams(); next.set("skill", `${result.skill.domain}/${result.skill.name}`); setSearchParams(next, { replace: true }); }, onError: (error) => { setPreflightOpen(false); setFormError(error instanceof Error ? error.message : String(error)); } });
  const deleteMutation = useMutation({ mutationFn: async () => { if (!selectedSkill) throw new Error("未选择 Skill。"); return deleteSkill(selectedSkill.domain, selectedSkill.name, selectedSkill.file_version); }, onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: queryKeys.skills }); backToDomain(); }, onError: (error) => setFormError(error instanceof Error ? error.message : String(error)) });
  const startPreflight = () => { if (!previewMutation.isPending && !saveMutation.isPending) previewMutation.mutate(); };

  useEffect(() => {
    if (mode !== "edit" && mode !== "create") return;
    const onKeyDown = (event: KeyboardEvent) => { if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") { event.preventDefault(); startPreflight(); } };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  const searchedSkills = useMemo(() => { const query = search.trim().toLowerCase(); if (!query) return skills; return skills.filter((skill) => `${skill.name} ${skill.title} ${skill.domain} ${skill.triggers.join(" ")}`.toLowerCase().includes(query)); }, [search, skills]);
  const activeDomain = selector?.domain ?? domainParam;
  const editorActive = mode === "edit" || mode === "create";

  return (
    <div className="pl-page-stack" data-testid="skills-page">
      <PageHeader title="业务 Skill" breadcrumbs={["业务上下文", "业务 Skill"]} description="统一查看、编辑和预检受治理的业务 Skill 资产。" actions={<button className="pl-btn pl-btn--primary text-sm" data-testid="skills-create" type="button" onClick={openCreate}>新建 Skill</button>} />
      {summariesQuery.isLoading ? <p className="pl-notice">正在加载业务 Skill…</p> : null}
      {summariesQuery.error ? <p className="pl-error" data-testid="skills-error">业务 Skill 加载失败：{summariesQuery.error instanceof Error ? summariesQuery.error.message : "未知错误"}</p> : null}
      {!summariesQuery.isLoading && !summariesQuery.error ? <div className="pl-editor-layout pl-skill-workbench" data-testid="skills-workbench"><SkillExplorer skills={skills} onSearch={setSearch} onSelectAll={openAll} onSelectDomain={openDomain} onSelectSkill={openSkill} search={search} selectedDomain={activeDomain} selectedSelector={selectorText} /><main className="pl-skill-main">{formError ? <p className="pl-error" data-testid="skill-form-error">{formError}</p> : null}{!creating && !selector ? <SkillOverview domain={domainParam} onOpenSkill={openSkill} onStatusFilter={setStatusFilter} onValidationFilter={setValidationFilter} skills={searchedSkills} statusFilter={statusFilter} validationFilter={validationFilter} /> : null}{selector && detailQuery.isLoading ? <p className="pl-notice">正在加载 Skill 详情…</p> : null}{selector && detailQuery.error ? <p className="pl-error">Skill 详情加载失败：{detailQuery.error instanceof Error ? detailQuery.error.message : "未知错误"}</p> : null}{selector && selectedSkill && mode === "view" ? <SkillReadView confirmDelete={confirmDelete} deleting={deleteMutation.isPending} onArmDelete={() => setConfirmDelete(true)} onBack={backToDomain} onDelete={() => deleteMutation.mutate()} onEdit={() => { const next = draftFromSkill(selectedSkill); setDraft(next); setBaselineVersion(draftVersion(next)); setMetadataOpen(false); setMode("edit"); setFormError(null); }} skill={selectedSkill} /> : null}{editorActive ? <section className="pl-skill-main-card pl-skill-edit-shell"><header className="pl-skill-edit-header"><div><span className="pl-eyebrow">{mode === "create" ? "新建业务 Skill" : "编辑业务 Skill"}</span><h2>{mode === "create" ? "新建 Skill" : selectedSkill?.title || selectedSkill?.name}</h2>{dirty ? <span className="pl-status-badge pl-status-partial" data-testid="skill-dirty">有未保存修改</span> : null}</div><div><button className="pl-btn pl-btn--ghost text-sm" data-testid="skill-cancel-edit" type="button" onClick={() => { if (!confirmDiscard("当前编辑未保存。取消编辑会放弃未保存内容，是否继续？")) return; if (mode === "create") { const next = new URLSearchParams(); if (domainParam) next.set("domain", domainParam); sourceRef.current = ""; setMode("view"); setSearchParams(next); } else if (selectedSkill) { const nextDraft = draftFromSkill(selectedSkill); setDraft(nextDraft); setBaselineVersion(draftVersion(nextDraft)); setMode("view"); } }}>取消</button><button ref={saveButtonRef} className="pl-btn pl-btn--primary text-sm" data-testid="skill-save" disabled={previewMutation.isPending} type="button" onClick={startPreflight}>{previewMutation.isPending ? "正在预检…" : "保存并预检"}</button></div></header><SkillEditor draft={draft} identityLocked={mode === "edit"} metadataOpen={metadataOpen} onChange={setDraft} onMetadataOpen={setMetadataOpen} /></section> : null}</main></div> : null}
      <PreflightDialog canConfirm={Boolean(preview) && previewDraftVersion === currentDraftVersion} confirming={saveMutation.isPending} onConfirm={() => saveMutation.mutate()} onOpenChange={(open) => { setPreflightOpen(open); if (!open) window.setTimeout(() => saveButtonRef.current?.focus(), 0); }} open={preflightOpen} preview={preview} />
    </div>
  );
}
