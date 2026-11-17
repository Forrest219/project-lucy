import { useRef, useState, type AnchorHTMLAttributes, type MouseEvent } from "react";
import { toast } from "sonner";
import { downloadApiFile } from "../lib/downloadApiFile";

type ApiDownloadLinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href" | "download"> & {
  href: string;
  /** Used when the server sends no Content-Disposition filename. */
  fallbackFilename: string;
  /** Prefix of the failure toast, e.g. "导出失败". */
  failurePrefix?: string;
};

/**
 * A download link that reports a failed download.
 *
 * It stays a real `<a href download>` (open-in-new-tab, no-JS, modified clicks
 * all keep the browser's native behaviour); a plain click is intercepted so the
 * HTTP result is read first and a refusal becomes a visible error (P1-42).
 */
export function ApiDownloadLink(props: ApiDownloadLinkProps) {
  const { href, fallbackFilename, failurePrefix = "下载失败", onClick, children, ...rest } = props;
  const [busy, setBusy] = useState(false);
  const runningRef = useRef(false);

  async function handleClick(event: MouseEvent<HTMLAnchorElement>) {
    onClick?.(event);
    const modified = event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0;
    if (event.defaultPrevented || modified) return;
    event.preventDefault();
    if (runningRef.current) return;
    runningRef.current = true;
    setBusy(true);
    try {
      const result = await downloadApiFile(href, fallbackFilename);
      if (!result.ok) toast.error(`${failurePrefix}：${result.message}`);
    } finally {
      runningRef.current = false;
      setBusy(false);
    }
  }

  return (
    <a {...rest} href={href} download onClick={(event) => void handleClick(event)} aria-busy={busy || undefined}>
      {children}
    </a>
  );
}
