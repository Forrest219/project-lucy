/**
 * Lucy v0.25 P1-2 — 授权工具分组展示。
 *
 * Authority:
 *   - docs/specs/lucy-20261025-v0p25-access-authorization-summary-spec.md §3（工具分组）、
 *     §8（ASV-12）
 *   - docs/plans/2026-10-25-lucy-v0.25-p1-implementation-plan.md §5（B4）
 *
 * 分组只是**展示分类**：它不改变工具分级，也不改变授权。未分类的工具不会因为被
 * 分到某一组就变成「已授予」——本页只展示服务端已经授予的工具。
 *
 * 「写入」组在现行权限模型里是空的：没有可授予的写入工具。空组必须显式说明，
 * 且不得暗示数据库 DML／DDL 已开放。
 */
import type { AuthorizationSummary, AuthorizationToolGroups } from "./AuthorizationTypes";

type ToolGroupKey = keyof AuthorizationToolGroups;

const GROUP_LABELS: Array<{ key: ToolGroupKey; label: string; hint?: string }> = [
  { key: "query", label: "查询" },
  { key: "semanticRead", label: "读取语义" },
  { key: "wikiRead", label: "读取 Wiki" },
  {
    key: "write",
    label: "写入",
    hint: "现行权限模型没有可授予的写入工具；这不代表数据库 DML／DDL 已开放。"
  },
  { key: "meta", label: "Meta" }
];

export function AuthorizationToolGroupsView({ summary }: { summary: AuthorizationSummary }) {
  const groups = summary.tools;
  const total =
    groups.query.length +
    groups.semanticRead.length +
    groups.wikiRead.length +
    groups.write.length +
    groups.meta.length +
    summary.unclassifiedTools.length;

  return (
    <section className="grid gap-2" data-testid="authorization-tool-groups">
      <h3 className="text-sm font-medium">
        {"工具分组"}
        <span className="ml-2 text-[12px] text-fg-muted">
          {`共 ${total} 个已授予工具（分组只是展示分类，不改变授权）`}
        </span>
      </h3>
      <dl className="grid gap-2">
        {GROUP_LABELS.map(({ key, label, hint }) => (
          <div key={key} className="grid gap-1" data-testid={`authorization-tool-group-${key}`}>
            <dt className="text-[13px] font-medium">
              {label}
              <span className="ml-2 text-[12px] font-normal text-fg-muted">{`（${groups[key].length}）`}</span>
            </dt>
            <dd className="grid gap-0.5">
              {groups[key].length > 0 ? (
                <ul className="flex flex-wrap gap-2">
                  {groups[key].map((tool) => (
                    <li key={tool}>
                      <span className="notranslate rounded border px-1 py-0.5 font-mono text-[12px]" translate="no">
                        {tool}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <span className="text-[12px] text-fg-muted">
                  {hint ?? "本组没有已授予的工具。"}
                </span>
              )}
            </dd>
          </div>
        ))}
      </dl>
      {summary.unclassifiedTools.length > 0 ? (
        <p className="text-[12px] text-fg-muted" data-testid="authorization-unclassified-tools">
          {"另有未分组工具（未分类工具不会因此变为已授予）："}
          <span className="notranslate font-mono" translate="no">
            {summary.unclassifiedTools.join(", ")}
          </span>
        </p>
      ) : null}
    </section>
  );
}
