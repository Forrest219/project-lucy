import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PageHeader } from "../../components/PageHeader";
import { MarkdownPreview } from "../../components/MarkdownPreview";
import { queryKeys } from "../../lib/queryKeys";
import { apiGet } from "../../lib/apiClient";
import type { Role } from "../../lib/types";
import {
  createSkill,
  deleteSkill,
  fetchSkills,
  rolesAllowedSummary,
  skillStatusBadgeClass,
  SKILL_STATUS_LABELS,
  updateSkill,
  type SkillAsset,
  type SkillStatus,
  type SkillWritePayload
} from "../../lib/skills";

/**
 * Spec 144 / 147：业务 Skill 列表与文件管理。
 * 资产写入项目 `skills/`；「已发布」是 frontmatter status，不经过发布工作台。
 */

type EditorMode = "view" | "edit" | "create";
type RolesResponse = { roles: Role[] };

type DraftForm = {
  name: string;
  domain: string;
  title: string;
  version: string;
  status: SkillStatus;
  rolesAllowed: string[];
  allowAllRoles: boolean;
  triggersText: string;
  description: string;
  content: string;
};

function emptyDraft(): DraftForm {
  return {
    name: "",
    domain: "custom",
    title: "",
    version: "1.0.0",
    status: "draft",
    rolesAllowed: [],
    allowAllRoles: false,
    triggersText: "",
    description: "",
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
    rolesAllowed: skill.roles_allowed.filter((role) => role !== "*"),
    allowAllRoles: skill.roles_allowed.includes("*"),
    triggersText: skill.triggers.join(", "),
    description: skill.description,
    content: skill.content
  };
}

function payloadFromDraft(draft: DraftForm): SkillWritePayload {
  const triggers = draft.triggersText
    .split(/[,，]/)
    .map((s) => s.trim())
    .filter(Boolean);
  return {
    name: draft.name.trim(),
    domain: draft.domain.trim(),
    title: draft.title.trim() || draft.name.trim(),
    version: draft.version.trim() || "1.0.0",
    status: draft.status,
    roles_allowed: draft.allowAllRoles ? ["*"] : draft.rolesAllowed,
    triggers,
    description: draft.description.trim(),
    content: draft.content
  };
}

function findSelectedSkill(skills: SkillAsset[], selector: string | null): SkillAsset | null {
  if (!selector) return null;
  return (
    skills.find((skill) => `${skill.domain}/${skill.name}` === selector) ??
    skills.find((skill) => skill.uri === selector) ??
    null
  );
}

function RolesAllowedCell({ skill }: { skill: SkillAsset }) {
  const summary = rolesAllowedSummary(skill.roles_allowed);
  if (summary.label) {
    return <span data-testid="skill-roles-summary">{summary.label}</span>;
  }
  if (summary.roles.length === 0) {
    return (
      <span className="text-fg-muted" data-testid="skill-roles-summary">
        —
      </span>
    );
  }
  return (
    <span className="notranslate" translate="no" data-testid="skill-roles-summary">
      {summary.roles.join("、")}
    </span>
  );
}

function ValidationCell({ skill }: { skill: SkillAsset }) {
  const issues = skill.validation.issues;
  const errorCount = issues.filter((issue) => issue.type === "error").length;
  const warningCount = issues.length - errorCount;
  if (skill.validation.valid) {
    return (
      <span data-testid="skill-validation">
        <span className="pl-status-badge pl-status-done">校验通过</span>
        {warningCount > 0 ? (
          <span className="ml-1 text-fg-muted text-xs">{warningCount} 条警告</span>
        ) : null}
      </span>
    );
  }
  return (
    <span data-testid="skill-validation">
      <span className="pl-status-badge pl-status-validation_failed">校验未通过</span>
      <span className="ml-1 text-fg-muted text-xs">{issues.length} 个问题</span>
    </span>
  );
}

function DetailRow({
  label,
  children,
  testId
}: {
  label: string;
  children: ReactNode;
  testId?: string;
}) {
  return (
    <div className="grid gap-1" data-testid={testId}>
      <span className="pl-eyebrow">{label}</span>
      <div className="text-sm text-fg-default">{children}</div>
    </div>
  );
}

function SkillViewBody({ skill }: { skill: SkillAsset }) {
  const prerequisiteGroups: Array<{ label: string; values: string[] }> = [
    { label: "语义源", values: skill.prerequisites.sources ?? [] },
    { label: "指标", values: skill.prerequisites.measures ?? [] },
    { label: "Wiki 文档", values: skill.prerequisites.wiki_docs ?? [] }
  ].filter((group) => group.values.length > 0);

  return (
    <div className="grid gap-4">
      <DetailRow label="Skill URI" testId="skill-detail-uri">
        <code className="notranslate" translate="no">
          {skill.uri}
        </code>
      </DetailRow>
      <div className="flex flex-wrap gap-4">
        <DetailRow label="状态" testId="skill-detail-status">
          <span className={skillStatusBadgeClass(skill.status)} data-status={skill.status}>
            {SKILL_STATUS_LABELS[skill.status]}
          </span>
        </DetailRow>
        <DetailRow label="版本" testId="skill-detail-version">
          <span className="notranslate" translate="no">
            {skill.version}
          </span>
        </DetailRow>
        <DetailRow label="文件路径">
          <code className="notranslate" data-testid="skill-detail-path" translate="no">
            {skill.relativePath}
          </code>
        </DetailRow>
      </div>
      <DetailRow label="角色授权" testId="skill-detail-roles">
        <RolesAllowedCell skill={skill} />
      </DetailRow>
      <DetailRow label="触发词" testId="skill-detail-triggers">
        {skill.triggers.length === 0 ? (
          <span className="text-fg-muted">—</span>
        ) : (
          <span className="notranslate" translate="no">
            {skill.triggers.join("、")}
          </span>
        )}
      </DetailRow>
      <DetailRow label="前置依赖" testId="skill-detail-prerequisites">
        {prerequisiteGroups.length === 0 ? (
          <span className="text-fg-muted">—</span>
        ) : (
          <ul className="m-0 grid list-none gap-1 p-0">
            {prerequisiteGroups.map((group) => (
              <li key={group.label}>
                {group.label}：
                <span className="notranslate" translate="no">
                  {group.values.join("、")}
                </span>
              </li>
            ))}
          </ul>
        )}
      </DetailRow>
      {skill.validation.issues.length > 0 ? (
        <DetailRow label="校验问题" testId="skill-detail-validation-issues">
          <ul className="m-0 grid list-none gap-1 p-0">
            {skill.validation.issues.map((issue, index) => (
              <li key={`${issue.field}-${index}`}>
                <span
                  className={
                    issue.type === "error"
                      ? "pl-status-badge pl-status-validation_failed"
                      : "pl-status-badge pl-status-partial"
                  }
                >
                  {issue.type === "error" ? "错误" : "警告"}
                </span>{" "}
                <code className="notranslate" translate="no">
                  {issue.field}
                </code>{" "}
                {issue.message}
              </li>
            ))}
          </ul>
        </DetailRow>
      ) : null}
      <div className="grid gap-1" data-testid="skill-detail-content">
        <span className="pl-eyebrow">正文</span>
        <MarkdownPreview markdown={skill.content} hideLeadingHeading={skill.title} />
      </div>
    </div>
  );
}

function Field({
  label,
  children
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <label className="grid gap-1 text-sm">
      <span className="pl-eyebrow">{label}</span>
      {children}
    </label>
  );
}

function SkillEditorForm({
  draft,
  onChange,
  identityLocked,
  availableRoles
}: {
  draft: DraftForm;
  onChange: (next: DraftForm) => void;
  identityLocked: boolean;
  availableRoles: Role[];
}) {
  const knownRoleIds = new Set(availableRoles.map((role) => role.id));
  const unknownRoles = draft.rolesAllowed.filter((role) => !knownRoleIds.has(role));
  const toggleRole = (roleId: string, checked: boolean) => {
    const nextRoles = checked
      ? [...new Set([...draft.rolesAllowed, roleId])]
      : draft.rolesAllowed.filter((role) => role !== roleId);
    onChange({ ...draft, rolesAllowed: nextRoles });
  };
  return (
    <div className="grid gap-3" data-testid="skill-editor-form">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="名称">
          <input
            className="pl-input notranslate"
            translate="no"
            value={draft.name}
            disabled={identityLocked}
            onChange={(e) => onChange({ ...draft, name: e.target.value })}
            data-testid="skill-field-name"
          />
        </Field>
        <Field label="域">
          <input
            className="pl-input notranslate"
            translate="no"
            value={draft.domain}
            disabled={identityLocked}
            onChange={(e) => onChange({ ...draft, domain: e.target.value })}
            data-testid="skill-field-domain"
          />
        </Field>
        <Field label="标题">
          <input
            className="pl-input"
            value={draft.title}
            onChange={(e) => onChange({ ...draft, title: e.target.value })}
            data-testid="skill-field-title"
          />
        </Field>
        <Field label="版本">
          <input
            className="pl-input notranslate"
            translate="no"
            value={draft.version}
            onChange={(e) => onChange({ ...draft, version: e.target.value })}
            data-testid="skill-field-version"
          />
        </Field>
        <Field label="状态">
          <select
            className="pl-input"
            value={draft.status}
            onChange={(e) => onChange({ ...draft, status: e.target.value as SkillStatus })}
            data-testid="skill-field-status"
          >
            <option value="draft">草稿</option>
            <option value="published">已发布</option>
            <option value="deprecated">已停用</option>
          </select>
        </Field>
        <fieldset className="grid gap-2 text-sm" data-testid="skill-field-roles">
          <legend className="pl-eyebrow">可访问角色</legend>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={draft.allowAllRoles}
              onChange={(event) => {
                if (
                  event.target.checked
                  && !window.confirm("确认将此 Skill 设置为所有角色可见？")
                ) return;
                onChange({
                  ...draft,
                  allowAllRoles: event.target.checked,
                  rolesAllowed: event.target.checked ? [] : draft.rolesAllowed
                });
              }}
              data-testid="skill-role-all"
            />
            所有角色可见
          </label>
          <div className="grid max-h-36 gap-1 overflow-y-auto rounded-md border border-border-default p-2">
            {availableRoles.map((role) => (
              <label key={role.id} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={draft.rolesAllowed.includes(role.id)}
                  disabled={draft.allowAllRoles}
                  onChange={(event) => toggleRole(role.id, event.target.checked)}
                  data-testid="skill-role-option"
                />
                <span className="notranslate" translate="no">{role.id}</span>
              </label>
            ))}
            {availableRoles.length === 0 ? <span className="text-fg-muted">暂无可选角色</span> : null}
          </div>
          {!draft.allowAllRoles && draft.rolesAllowed.length === 0 ? (
            <span className="text-xs text-fg-muted" data-testid="skill-role-none">无人可见</span>
          ) : null}
          {unknownRoles.length > 0 ? (
            <span className="text-xs text-warning-strong" data-testid="skill-role-unknown">
              未配置角色：<span className="notranslate" translate="no">{unknownRoles.join("、")}</span>
            </span>
          ) : null}
        </fieldset>
      </div>
      <Field label="触发词">
        <input
          className="pl-input"
          value={draft.triggersText}
          onChange={(e) => onChange({ ...draft, triggersText: e.target.value })}
          data-testid="skill-field-triggers"
        />
      </Field>
      <Field label="说明">
        <textarea
          className="pl-input min-h-[4rem]"
          value={draft.description}
          onChange={(e) => onChange({ ...draft, description: e.target.value })}
          data-testid="skill-field-description"
        />
      </Field>
      <Field label="正文">
        <textarea
          className="pl-input min-h-[16rem] font-mono text-sm"
          value={draft.content}
          onChange={(e) => onChange({ ...draft, content: e.target.value })}
          data-testid="skill-field-content"
        />
      </Field>
    </div>
  );
}

export function SkillList() {
  const [searchParams, setSearchParams] = useSearchParams();
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<EditorMode>("view");
  const [draft, setDraft] = useState<DraftForm>(emptyDraft());
  const [formError, setFormError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const skillsQuery = useQuery({
    queryKey: queryKeys.skills,
    queryFn: fetchSkills
  });
  const rolesQuery = useQuery({
    queryKey: ["admin", "roles", "skill-options"],
    queryFn: () => apiGet<RolesResponse>("/api/admin/roles?includeTemplates=false")
  });
  const availableRoles = rolesQuery.data?.roles ?? [];

  const skills = useMemo(() => skillsQuery.data?.skills ?? [], [skillsQuery.data]);
  const selectedSkill = useMemo(
    () => findSelectedSkill(skills, searchParams.get("skill")),
    [skills, searchParams]
  );
  const creating = searchParams.get("new") === "1";

  useEffect(() => {
    if (creating) {
      setMode("create");
      setDraft(emptyDraft());
      setFormError(null);
      setConfirmDelete(false);
      return;
    }
    if (selectedSkill) {
      setMode("view");
      setDraft(draftFromSkill(selectedSkill));
      setFormError(null);
      setConfirmDelete(false);
    }
  }, [creating, selectedSkill]);

  function openSkill(skill: SkillAsset) {
    const next = new URLSearchParams(searchParams);
    next.delete("new");
    next.set("skill", `${skill.domain}/${skill.name}`);
    setSearchParams(next);
  }

  function openCreate() {
    const next = new URLSearchParams(searchParams);
    next.delete("skill");
    next.set("new", "1");
    setSearchParams(next);
  }

  function closeDrawer() {
    const next = new URLSearchParams(searchParams);
    next.delete("skill");
    next.delete("new");
    setSearchParams(next, { replace: true });
    setMode("view");
    setConfirmDelete(false);
    setFormError(null);
  }

  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload = payloadFromDraft(draft);
      if (mode === "create") {
        return createSkill(payload);
      }
      if (!selectedSkill) throw new Error("未选择 Skill");
      return updateSkill(selectedSkill.domain, selectedSkill.name, {
        ...payload,
        expected_version: selectedSkill.file_version
      });
    },
    onSuccess: async (result) => {
      setFormError(null);
      await queryClient.invalidateQueries({ queryKey: queryKeys.skills });
      const next = new URLSearchParams();
      next.set("skill", `${result.skill.domain}/${result.skill.name}`);
      setSearchParams(next, { replace: true });
      setMode("view");
    },
    onError: (err) => {
      setFormError(err instanceof Error ? err.message : String(err));
    }
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      if (!selectedSkill) throw new Error("未选择 Skill");
      return deleteSkill(selectedSkill.domain, selectedSkill.name, selectedSkill.file_version);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.skills });
      closeDrawer();
    },
    onError: (err) => {
      setFormError(err instanceof Error ? err.message : String(err));
    }
  });

  const drawerOpen = creating || selectedSkill !== null;

  return (
    <div className="pl-page-stack" data-testid="skills-page">
      <PageHeader
        title="业务 Skill"
        breadcrumbs={["业务上下文", "业务 Skill"]}
        description="查看并管理受治理的业务 Skill 资产及其发布状态与角色授权。"
        actions={
          <button type="button" className="pl-btn pl-btn--primary text-sm" onClick={openCreate} data-testid="skills-create">
            新建 Skill
          </button>
        }
      />

      <section className="rounded-md border border-border-default bg-bg-surface p-4" data-testid="skills-section">
        {skillsQuery.isLoading ? <p className="pl-notice">正在加载业务 Skill…</p> : null}
        {skillsQuery.error ? (
          <p className="pl-error" data-testid="skills-error">
            业务 Skill 加载失败：
            {skillsQuery.error instanceof Error ? skillsQuery.error.message : "未知错误"}
          </p>
        ) : null}

        {!skillsQuery.isLoading && !skillsQuery.error ? (
          skills.length === 0 ? (
            <p className="pl-notice" data-testid="skills-empty">
              尚无 Skill 文件；资产放在
              <code className="notranslate ml-1" translate="no">
                skills/
              </code>
              ，或点击「新建 Skill」。
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="pl-data-grid pl-data-table" data-testid="skills-table">
                <thead>
                  <tr>
                    <th scope="col">名称</th>
                    <th scope="col">域</th>
                    <th scope="col">状态</th>
                    <th scope="col">角色授权</th>
                    <th scope="col">校验结果</th>
                  </tr>
                </thead>
                <tbody>
                  {skills.map((skill) => (
                    <tr
                      key={skill.uri}
                      data-testid="skills-row"
                      data-status={skill.status}
                      className="cursor-pointer"
                      onClick={() => openSkill(skill)}
                    >
                      <td>
                        <button
                          type="button"
                          className="pl-row-action-link"
                          onClick={() => openSkill(skill)}
                          data-testid="skills-open-detail"
                        >
                          <span className="notranslate" translate="no">
                            {skill.name}
                          </span>
                        </button>
                        {skill.title && skill.title !== skill.name ? (
                          <div className="text-xs text-fg-muted">{skill.title}</div>
                        ) : null}
                      </td>
                      <td>
                        <span className="notranslate" translate="no">
                          {skill.domain}
                        </span>
                      </td>
                      <td>
                        <span
                          className={skillStatusBadgeClass(skill.status)}
                          data-testid="skill-status"
                          data-status={skill.status}
                        >
                          {SKILL_STATUS_LABELS[skill.status]}
                        </span>
                      </td>
                      <td>
                        <RolesAllowedCell skill={skill} />
                      </td>
                      <td>
                        <ValidationCell skill={skill} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        ) : null}
      </section>

      <Dialog.Root
        open={drawerOpen}
        onOpenChange={(open) => {
          if (!open) closeDrawer();
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="pl-drawer-overlay" />
          <Dialog.Content
            className="pl-drawer-panel"
            data-testid="skill-detail-drawer"
            aria-describedby="skill-detail-description"
            onOpenAutoFocus={(event) => {
              event.preventDefault();
              closeButtonRef.current?.focus();
            }}
          >
            <header className="pl-drawer-header">
              <div className="grid min-w-0 gap-1">
                <span className="pl-eyebrow">业务 Skill</span>
                <Dialog.Title asChild>
                  <h2 className="pl-panel-title mb-0" data-testid="skill-detail-title">
                    {mode === "create"
                      ? "新建 Skill"
                      : selectedSkill?.title || selectedSkill?.name || "业务 Skill"}
                  </h2>
                </Dialog.Title>
                <Dialog.Description id="skill-detail-description" className="sr-only">
                  业务 Skill 详情
                </Dialog.Description>
              </div>
              <button
                ref={closeButtonRef}
                type="button"
                className="pl-drawer-close"
                onClick={closeDrawer}
                aria-label="关闭 Skill 详情"
                data-testid="skill-detail-close"
              >
                关闭
              </button>
            </header>
            <div className="pl-drawer-body">
              {formError ? (
                <p className="pl-error mb-3" data-testid="skill-form-error">
                  {formError}
                </p>
              ) : null}
              {mode === "view" && selectedSkill ? <SkillViewBody skill={selectedSkill} /> : null}
              {(mode === "edit" || mode === "create") && (
                <SkillEditorForm
                  draft={draft}
                  onChange={setDraft}
                  identityLocked={mode === "edit"}
                  availableRoles={availableRoles}
                />
              )}
              {mode === "view" && selectedSkill && !selectedSkill.validation.valid ? (
                <p className="pl-notice mt-3" data-testid="skill-validation-banner">
                  当前校验未通过；仍可编辑并保存 Skill。
                </p>
              ) : null}
            </div>
            <footer className="pl-drawer-footer pl-drawer-footer-border-t flex flex-wrap gap-2">
              {mode === "view" && selectedSkill ? (
                <>
                  <button
                    type="button"
                    className="pl-btn pl-btn--primary text-sm"
                    onClick={() => {
                      setDraft(draftFromSkill(selectedSkill));
                      setMode("edit");
                    }}
                    data-testid="skill-edit"
                  >
                    编辑
                  </button>
                  {!confirmDelete ? (
                    <button
                      type="button"
                      className="pl-btn pl-btn--ghost text-sm"
                      onClick={() => setConfirmDelete(true)}
                      data-testid="skill-delete"
                    >
                      删除 Skill
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="pl-btn pl-btn--danger text-sm"
                      onClick={() => deleteMutation.mutate()}
                      disabled={deleteMutation.isPending}
                      data-testid="skill-delete-confirm"
                    >
                      确认删除
                    </button>
                  )}
                  <button
                    type="button"
                    className="pl-btn pl-btn--ghost text-sm"
                    onClick={closeDrawer}
                    data-testid="skill-detail-footer-close"
                  >
                    关闭
                  </button>
                </>
              ) : null}
              {(mode === "edit" || mode === "create") && (
                <>
                  <button
                    type="button"
                    className="pl-btn pl-btn--primary text-sm"
                    onClick={() => saveMutation.mutate()}
                    disabled={saveMutation.isPending}
                    data-testid="skill-save"
                  >
                    保存 Skill
                  </button>
                  <button
                    type="button"
                    className="pl-btn pl-btn--ghost text-sm"
                    onClick={() => {
                      if (mode === "create") closeDrawer();
                      else if (selectedSkill) {
                        setDraft(draftFromSkill(selectedSkill));
                        setMode("view");
                        setFormError(null);
                      }
                    }}
                    data-testid="skill-cancel-edit"
                  >
                    取消
                  </button>
                </>
              )}
            </footer>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}
