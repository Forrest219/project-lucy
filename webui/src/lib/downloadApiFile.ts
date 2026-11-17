/**
 * Download a file from an authenticated API endpoint and tell the caller what
 * really happened.
 *
 * Why: a plain `<a href="/api/…" download>` leaves every HTTP failure to the
 * browser's own download bar — the page says nothing (P1-42). This helper fetches
 * once, reads the status, and only then hands the bytes to the browser.
 *
 * Main-path escape: a file larger than LARGE_DOWNLOAD_BYTES is not buffered in
 * memory; the response is cancelled and the browser's native download takes over
 * (no failure feedback for that rare case, same as before).
 */

export const LARGE_DOWNLOAD_BYTES = 100 * 1024 * 1024;

export type DownloadApiFileResult =
  | { ok: true; filename: string; size: number; native?: undefined }
  | { ok: true; native: true; filename: string; size?: undefined }
  | { ok: false; message: string; status?: number };

function filenameFromContentDisposition(header: string | null): string | null {
  if (!header) return null;
  const utf8 = header.match(/filename\*\s*=\s*(?:UTF-8|utf-8)''([^;]+)/);
  if (utf8?.[1]) {
    try {
      return decodeURIComponent(utf8[1].trim().replace(/^"|"$/g, ""));
    } catch {
      /* fall through to the plain filename */
    }
  }
  return header.match(/filename\s*=\s*"?([^";]+)"?/)?.[1]?.trim() ?? null;
}

async function failureMessage(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: { message?: unknown } | string };
    const message = typeof body.error === "string" ? body.error : body.error?.message;
    if (typeof message === "string" && message.trim()) return message;
  } catch {
    /* not an error envelope */
  }
  return `请求失败（HTTP ${response.status}）`;
}

function clickAnchor(href: string, filename: string): void {
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.download = filename;
  anchor.rel = "noopener";
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}

export async function downloadApiFile(href: string, fallbackFilename: string): Promise<DownloadApiFileResult> {
  let response: Response;
  try {
    response = await fetch(href, { credentials: "same-origin" });
  } catch {
    return { ok: false, message: "网络请求未完成" };
  }
  if (!response.ok) {
    return { ok: false, message: await failureMessage(response), status: response.status };
  }

  const filename = filenameFromContentDisposition(response.headers.get("content-disposition")) ?? fallbackFilename;
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > LARGE_DOWNLOAD_BYTES) {
    void response.body?.cancel();
    clickAnchor(href, filename);
    return { ok: true, native: true, filename };
  }

  const blob = await response.blob();
  if (blob.size === 0) return { ok: false, message: "服务端返回了空文件" };
  const url = URL.createObjectURL(blob);
  try {
    clickAnchor(url, filename);
  } finally {
    URL.revokeObjectURL(url);
  }
  return { ok: true, filename, size: blob.size };
}
