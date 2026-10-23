import { roleDeleteReferenceNames } from "../lib/roleDeleteBlock";
import type { RoleUserReference } from "../lib/types";

type Props = {
  users?: Array<Pick<RoleUserReference, "id" | "name">>;
  id?: string;
  className?: string;
  testId?: string;
};

export function RoleDeleteBlockedNotice({
  users,
  id,
  className = "text-xs leading-4 text-fg-muted",
  testId
}: Props) {
  const { names, truncated } = roleDeleteReferenceNames(users);
  return (
    <p id={id} className={className} data-testid={testId}>
      {"无法删除：仍被 "}
      <span className="notranslate" translate="no">Agent</span>
      {names.length === 0 ? " 引用" : null}
      {names.map((name, index) => (
        <span key={`${name}-${index}`}>
          {index > 0 ? "、" : null}
          {`「`}
          <span className="notranslate" translate="no">{name}</span>
          {`」`}
        </span>
      ))}
      {truncated ? "等" : null}
      {names.length === 0 ? null : "引用"}
      {"。请先解除该 "}
      <span className="notranslate" translate="no">Agent</span>
      {" 的引用后再删除。"}
    </p>
  );
}
