export function DiffViewer({ diff }: { diff: string }) {
  if (!diff.trim()) {
    return <p className="notice">暂无可预览的变更。</p>;
  }

  return (
    <pre className="diff-viewer">
      {diff.split("\n").map((line, index) => {
        const className = line.startsWith("+") && !line.startsWith("+++")
          ? "diff-added"
          : line.startsWith("-") && !line.startsWith("---")
            ? "diff-removed"
            : line.startsWith("@@")
              ? "diff-hunk"
              : undefined;
        return (
          <span className={className} key={`${index}-${line}`}>
            {line || " "}
            {"\n"}
          </span>
        );
      })}
    </pre>
  );
}
