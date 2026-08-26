import { brandingMarkLetter } from "../lib/useBranding";

type BrandMarkProps = {
  productTitle: string;
  logoUrl: string | null;
  className?: string;
};

/** Shared brand mark for sidebar, login, and branding preview. */
export function BrandMark({ productTitle, logoUrl, className }: BrandMarkProps) {
  if (logoUrl) {
    return (
      <img
        src={logoUrl}
        alt=""
        className={["pl-brand-mark", "pl-brand-mark--image", className].filter(Boolean).join(" ")}
        data-testid="brand-logo"
        draggable={false}
      />
    );
  }
  return (
    <span
      className={["pl-brand-mark", className].filter(Boolean).join(" ")}
      aria-hidden="true"
      data-testid="brand-mark-letter"
    >
      {brandingMarkLetter(productTitle)}
    </span>
  );
}
