import { useMemo, useRef, type ReactNode } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "../../components/PageHeader";
import { MarkdownPreview } from "../../components/MarkdownPreview";
import { queryKeys } from "../../lib/queryKeys";
import {
  fetchSkills,
  rolesAllowedSummary,
  skillStatusBadgeClass,
  SKILL_STATUS_LABELS,
  type SkillAsset
} from "../../lib/skills";

/**
 * Spec 144（业务 Skill MVP）只读列表页。
 * 页面不提供新建 / 保存 / 删除 / 导出入口；Skill 资产由 `skills/` 目录文件入库，
 * 发布状态直接来自 frontmatter 的 `status` 字段，不经过发布工作台。
 */

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

type DetailRowProps = {
  label: string;
  children: ReactNode;
  testId?: string;
};

function DetailRow({ label, children, testId }: DetailRowProps) {
  return (
    <div className="grid gap-1" data-testid={testId}>
      <span className="pl-eyebrow">{label}</span>
      <div className="text-sm text-fg-default">{children}</div>
    </div>
  );
}

function SkillDetailBody({ skill }: { skill: SkillAsset }) {
  const prerequisites = skill.prerequisites;
  const prerequisiteGroups: Array<{ label: string; values: string[] }> = [
    { label: "语义源", values: prerequisites.sources ?? [] },
    { label: "指标", values: prerequisites.measures ?? [] },
    { label: "Wiki 文档", values: prerequisites.wiki_docs ?? [] }
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
        <DetailRow label="文件路径" testId="skill-detail-path">
          <code className="notranslate" translate="no">
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

export function SkillList() {
  const [searchParams, setSearchParams] = useSearchParams();
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  const skillsQuery = useQuery({
    queryKey: queryKeys.skills,
    queryFn: fetchSkills
  });

  const skills = useMemo(() => skillsQuery.data?.skills ?? [], [skillsQuery.data]);
  const selectedSkill = useMemo(
    () => findSelectedSkill(skills, searchParams.get("skill")),
    [skills, searchParams]
  );

  function openSkill(skill: SkillAsset) {
    const next = new URLSearchParams(searchParams);
    next.set("skill", `${skill.domain}/${skill.name}`);
    setSearchParams(next);
  }

  function closeSkill() {
    const next = new URLSearchParams(searchParams);
    next.delete("skill");
    setSearchParams(next, { replace: true });
  }

  return (
    <div className="pl-page-stack" data-testid="skills-page">
      <PageHeader
        title="业务 Skill"
        breadcrumbs={["业务上下文", "业务 Skill"]}
        description="查看受治理的业务 Skill 资产及其发布状态与角色授权。"
      />

      <section
        className="rounded-md border border-border-default bg-bg-surface p-4"
        data-testid="skills-section"
      >
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
              。
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
        open={selectedSkill !== null}
        onOpenChange={(open) => {
          if (!open) closeSkill();
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
            {selectedSkill ? (
              <>
                <header className="pl-drawer-header">
                  <div className="grid min-w-0 gap-1">
                    <span className="pl-eyebrow">业务 Skill</span>
                    <Dialog.Title asChild>
                      <h2 className="pl-panel-title mb-0" data-testid="skill-detail-title">
                        {selectedSkill.title || selectedSkill.name}
                      </h2>
                    </Dialog.Title>
                    <Dialog.Description id="skill-detail-description" className="sr-only">
                      业务 Skill 只读详情
                    </Dialog.Description>
                  </div>
                  <button
                    ref={closeButtonRef}
                    type="button"
                    className="pl-drawer-close"
                    onClick={closeSkill}
                    aria-label="关闭 Skill 详情"
                    data-testid="skill-detail-close"
                  >
                    关闭
                  </button>
                </header>
                <div className="pl-drawer-body">
                  <SkillDetailBody skill={selectedSkill} />
                </div>
                <footer className="pl-drawer-footer pl-drawer-footer-border-t">
                  <button
                    type="button"
                    className="pl-btn pl-btn--ghost text-sm"
                    onClick={closeSkill}
                    data-testid="skill-detail-footer-close"
                  >
                    关闭
                  </button>
                </footer>
              </>
            ) : null}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}
