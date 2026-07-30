import type {
  SemanticAssetError,
  SemanticAssetFilePreview,
  SemanticAssetValidateResponse,
  SemanticAssetWarning
} from "../../lib/types";

export type SemanticAssetValidationPanelProps = {
  validation: SemanticAssetValidateResponse | null;
  isValidating: boolean;
  errorMessage?: string | null;
};

function toneFor(errors: SemanticAssetError[], warnings: SemanticAssetWarning[]) {
  if (errors.length > 0) return "danger" as const;
  if (warnings.length > 0) return "warning" as const;
  return "success" as const;
}

function stateName(
  errors: SemanticAssetError[],
  warnings: SemanticAssetWarning[]
): "validating" | "error" | "invalid" | "warnings" | "valid" | "idle" {
  if (errors.length > 0) return "invalid";
  if (warnings.length > 0) return "warnings";
  return "valid";
}

function FileRow({ file }: { file: SemanticAssetFilePreview }) {
  return (
    <li
      className="grid gap-1 rounded-md border border-border-default bg-bg-subtle p-2 text-xs"
      data-testid="semantic-asset-validation-file"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <code className="font-mono text-fg-default">{file.targetPath}</code>
        <span className="text-fg-muted">
          {file.sizeBytes} B · sha256 <code className="font-mono">{file.sha256.slice(0, 12)}…</code>
        </span>
      </div>
      <div className="text-fg-muted">
        kind: <strong>{file.kind}</strong>
        {file.connectionId ? ` · connection ${file.connectionId}` : ""}
        {file.schema ? ` · schema ${file.schema}` : ""}
        {file.sourceName ? ` · source ${file.sourceName}` : ""}
        {file.physicalTable ? ` · table ${file.physicalTable}` : ""}
      </div>
      {file.warnings.length > 0 ? (
        <ul
          className="list-none p-0"
          data-testid="semantic-asset-validation-file-warnings"
        >
          {file.warnings.map((w) => (
            <li key={w.code} className="text-warning-strong">
              <strong>{w.code}</strong> · {w.message}
            </li>
          ))}
        </ul>
      ) : null}
    </li>
  );
}

export function SemanticAssetValidationPanel({
  validation,
  isValidating,
  errorMessage
}: SemanticAssetValidationPanelProps) {
  if (isValidating) {
    return (
      <div
        className="pl-upload-validation"
        data-testid="semantic-asset-validation-panel"
        data-state="validating"
        aria-live="polite"
      >
        正在解析并校验语义资产…
      </div>
    );
  }
  if (errorMessage) {
    return (
      <div
        className="pl-upload-validation pl-upload-validation--danger"
        data-testid="semantic-asset-validation-panel"
        data-state="error"
        role="alert"
      >
        <strong>校验失败</strong>
        <p className="text-xs">{errorMessage}</p>
      </div>
    );
  }
  if (!validation) {
    return (
      <div
        className="pl-upload-validation"
        data-testid="semantic-asset-validation-panel"
        data-state="idle"
        aria-live="polite"
      >
        <p className="text-xs text-fg-muted">
          请拖入 schema manifest 和/或 semantic overlay YAML（最多 50 个，单文件 ≤ 512 KB）。
          目标路径由后端计算，前端不会写入。
        </p>
      </div>
    );
  }
  const tone = toneFor(validation.errors, validation.warnings);
  const state = stateName(validation.errors, validation.warnings);
  const toneClass =
    tone === "danger"
      ? "pl-upload-validation--danger"
      : tone === "warning"
        ? "pl-upload-validation--warning"
        : "pl-upload-validation--success";
  return (
    <div
      className={`pl-upload-validation ${toneClass}`}
      data-testid="semantic-asset-validation-panel"
      data-state={state}
      aria-live="polite"
    >
      <p className="pl-upload-target-path" data-testid="semantic-asset-target-paths">
        <span className="text-xs text-fg-muted">Dry-Run 目标路径</span>
        <ul className="list-none p-0">
          {validation.files.map((f) => (
            <li key={f.targetPath} className="font-mono text-fg-default">
              {f.targetPath}
            </li>
          ))}
        </ul>
      </p>
      {validation.warnings.length > 0 ? (
        <ul
          className="pl-upload-validation-list"
          data-testid="semantic-asset-validation-warnings"
        >
          {validation.warnings.map((w) => (
            <li key={w.code} data-code={w.code}>
              <strong>{w.code}</strong>
              <span className="block text-xs">{w.message}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {validation.errors.length > 0 ? (
        <ul
          className="pl-upload-validation-list"
          data-testid="semantic-asset-validation-errors"
          role="alert"
        >
          {validation.errors.map((e) => (
            <li key={e.code} data-code={e.code}>
              <strong>{e.code}</strong>
              <span className="block text-xs">
                {e.message}
                {e.line ? ` (line ${e.line}${e.column ? `, col ${e.column}` : ""})` : ""}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      <ul
        className="list-none p-0"
        data-testid="semantic-asset-validation-file-list"
      >
        {validation.files.map((f) => (
          <FileRow key={f.targetPath} file={f} />
        ))}
      </ul>
    </div>
  );
}
