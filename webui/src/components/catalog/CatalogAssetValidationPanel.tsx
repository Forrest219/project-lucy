import type {
  CatalogAssetError,
  CatalogAssetValidateResponse,
  CatalogAssetWarning
} from "../../lib/types";

export type CatalogAssetValidationPanelProps = {
  validation: CatalogAssetValidateResponse | null;
  isValidating: boolean;
  errorMessage?: string | null;
};

function errorToneClass(errors: CatalogAssetError[]): string {
  if (errors.length > 0) return "pl-upload-validation--danger";
  return "";
}

function warningToneClass(warnings: CatalogAssetWarning[]): string {
  if (warnings.length > 0) return "pl-upload-validation--warning";
  return "pl-upload-validation--success";
}

export function CatalogAssetValidationPanel({
  validation,
  isValidating,
  errorMessage
}: CatalogAssetValidationPanelProps) {
  if (isValidating) {
    return (
      <div
        className="pl-upload-validation"
        data-testid="catalog-asset-validation-panel"
        data-state="validating"
        aria-live="polite"
      >
        正在校验 YAML…
      </div>
    );
  }

  if (errorMessage) {
    return (
      <div
        className="pl-upload-validation pl-upload-validation--danger"
        data-testid="catalog-asset-validation-panel"
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
        data-testid="catalog-asset-validation-panel"
        data-state="idle"
        aria-live="polite"
      >
        <p className="text-xs text-fg-muted">
          等待校验。
        </p>
      </div>
    );
  }

  const successTone = validation.errors.length > 0 ? errorToneClass(validation.errors) : warningToneClass(validation.warnings);
  const state = validation.errors.length > 0
    ? "invalid"
    : validation.warnings.length > 0
      ? "warnings"
      : "valid";
  const targetPathInWarning = validation.warnings.some((w) => w.code === "TARGET_EXISTS");

  return (
    <div
      className={`pl-upload-validation ${successTone}`}
      data-testid="catalog-asset-validation-panel"
      data-state={state}
      aria-live="polite"
    >
      {targetPathInWarning ? null : (
        <p className="pl-upload-target-path" data-testid="catalog-asset-target-path">
          <span className="text-xs text-fg-muted">目标路径</span>
          <code>{validation.targetPath}</code>
        </p>
      )}
      <p className="text-sm" data-testid="catalog-asset-validation-summary">
        将写入 <strong>{validation.tables}</strong> 张表（{validation.tableNames.join(", ") || "—"}），
        大小 {validation.sizeBytes} 字节。
      </p>
      {validation.warnings.length > 0 ? (
        <ul className="pl-upload-validation-list" data-testid="catalog-asset-validation-warnings">
          {validation.warnings.map((w) => (
            <li key={w.code} data-code={w.code}>
              <strong>{w.code}</strong>
              <span className="block text-xs">{w.message}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {validation.errors.length > 0 ? (
        <ul className="pl-upload-validation-list" data-testid="catalog-asset-validation-errors" role="alert">
          {validation.errors.map((e) => (
            <li key={e.code} data-code={e.code}>
              <strong>{e.code}</strong>
              <span className="block text-xs">{e.message}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
