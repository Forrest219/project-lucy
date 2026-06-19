import clsx from "clsx";

export function DiffViewer({ diff }: { diff: string }) {
  if (!diff.trim()) {
    return <p className="pl-notice">暂无可预览的变更。</p>;
  }

  return (
    <pre className="pl-diff-viewer">
      {diff.split("\n").map((line, index) => {
        const variant =
          line.startsWith("+") && !line.startsWith("+++")
            ? "pl-diff-added"
            : line.startsWith("-") && !line.startsWith("---")
              ? "pl-diff-removed"
              : line.startsWith("@@")
                ? "pl-diff-hunk"
                : undefined;
        return (
          <span className={clsx(variant)} key={`${index}-${line}`}>
            {line || " "}
            {"\n"}
          </span>
        );
      })}
    </pre>
  );
}
