/**
 * Lucy v0.25 P1-2 — 授权资源卡片（连接 → Schema → 表）。
 *
 * Authority:
 *   - docs/specs/lucy-20261025-v0p25-access-authorization-summary-spec.md §3（资源卡片）、
 *     §4.1（资源卡片行提供 MCP 调试台深链）、§8（ASV-02／ASV-03／ASV-10）
 *   - docs/plans/2026-10-25-lucy-v0.25-p1-implementation-plan.md §5（B3、B6）
 *
 * 一条硬规则：**不把工具并集与表并集拼成权限笛卡尔积。** 每个工具只出现在它真正
 * 被授予的那张表下；行边界由服务端按表给出，浏览器不重算。
 *
 * 角色来源来自服务端的 per-role 编译结果（`roleIds`），不从合并后的表集合反推。
 */
import type {
  AuthorizationResourceTable,
  AuthorizationRowGrantPreview,
  AuthorizationSummary
} from "./AuthorizationTypes";

/** 行授予的「形态」标签。完整表达式由服务端的 rowSummary 给出，这里只标形态。 */
function rowGrantKindLabel(grant: AuthorizationRowGrantPreview | undefined): string {
  if (!grant) return "未提供";
  if (grant.kind === "all") return "全部行";
  return "受限行";
}

function toolCells(table: AuthorizationResourceTable) {
  return table.capabilities.map((capability) => (
    <li key={capability.tool} className="flex flex-wrap gap-2 text-[13px]">
      <span className="notranslate font-mono" translate="no">
        {capability.tool}
      </span>
      <span className="text-fg-muted">
        {`行边界：${rowGrantKindLabel(capability.rowGrant)}`}
      </span>
      {capability.finalRows ? (
        <span className="text-fg-muted">
          {`最终行约束：${rowGrantKindLabel(capability.finalRows)}`}
        </span>
      ) : null}
    </li>
  ));
}

export function AuthorizationResourceCard({ summary }: { summary: AuthorizationSummary }) {
  if (summary.resources.length === 0) {
    return (
      <p className="text-[13px] text-fg-muted" data-testid="authorization-resource-empty">
        没有可证明的表授权。
      </p>
    );
  }

  return (
    <section className="grid gap-3" data-testid="authorization-resource-card">
      <h3 className="text-sm font-medium">资源卡片</h3>
      {summary.resources.map((connection) => (
        <div key={connection.connectionId} className="grid gap-2">
          <h4 className="text-[13px] font-medium">
            {"连接："}
            <span className="notranslate font-mono" translate="no">
              {connection.connectionId}
            </span>
          </h4>
          {connection.schemas.map((schema) => (
            <div key={`${connection.connectionId}:${schema.schema}`} className="grid gap-1">
              <h5 className="text-[13px] font-medium text-fg-muted">
                <span className="notranslate" translate="no">
                  Schema
                </span>
                {"："}
                {/* Schema 名是数据库对象标识：术语标准 §2.6 要求与「Schema」一词同样受翻译防御。 */}
                <span className="notranslate" translate="no">
                  {schema.schema}
                </span>
              </h5>
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-[13px]">
                  <caption className="sr-only notranslate" translate="no">
                    该连接与 Schema 下的表授权
                  </caption>
                  <thead>
                    <tr className="border-b text-left">
                      <th scope="col" className="py-1 pr-3">
                        表
                      </th>
                      <th scope="col" className="py-1 pr-3">
                        角色来源
                      </th>
                      <th scope="col" className="py-1 pr-3">
                        数据能力
                      </th>
                      <th scope="col" className="py-1">
                        操作
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {schema.tables.map((table) => (
                      <tr
                        key={table.sourceKey}
                        className="border-b align-top"
                        data-testid="authorization-resource-row"
                        data-source-key={table.sourceKey}
                      >
                        <td className="py-1 pr-3">
                          <div className="notranslate font-mono" translate="no">
                            {table.sourceName}
                          </div>
                          <div className="notranslate text-[12px] text-fg-muted" translate="no">
                            {table.physicalTable}
                          </div>
                        </td>
                        <td className="py-1 pr-3">
                          {table.roleIds.length > 0 ? (
                            <ul className="grid gap-0.5">
                              {table.roleIds.map((roleId) => (
                                <li key={roleId}>
                                  <span className="notranslate font-mono" translate="no">
                                    {roleId}
                                  </span>
                                </li>
                              ))}
                            </ul>
                          ) : (
                            <span className="text-fg-muted">旧 ACL（无角色来源）</span>
                          )}
                        </td>
                        <td className="py-1 pr-3">
                          <ul className="grid gap-0.5">{toolCells(table)}</ul>
                          <p
                            className="text-[12px] text-fg-muted"
                            data-testid="authorization-row-summary"
                          >
                            {table.rowSummary.constraintSummary}
                          </p>
                        </td>
                        <td className="py-1">
                          {table.playgroundUrl ? (
                            <a
                              className="underline"
                              href={table.playgroundUrl}
                              data-testid="authorization-playground-link"
                            >
                              {"在 "}
                              <span className="notranslate" translate="no">
                                MCP
                              </span>
                              {" 调试台预览"}
                            </a>
                          ) : (
                            <span className="text-fg-muted">—</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      ))}
    </section>
  );
}
