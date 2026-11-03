// Shared clipboard helper.
//
// Why this exists:
// the Clipboard API (`navigator.clipboard`) is `[SecureContext]`-gated — the
// browser only exposes it on HTTPS origins and on loopback hosts
// (`localhost` / `127.0.0.1`). Lucy WebUI is also shipped in the supported
// intranet-HTTP customer mode (`security.access=http`, see
// `deploy/k8s/K8S_CONTRACT.md`), where the origin is NOT a secure context and
// `navigator.clipboard` is simply `undefined`.
//
// Any copy entry point that touches `navigator.clipboard.writeText` directly
// therefore throws `TypeError: Cannot read properties of undefined` on those
// deployments — silently, because the property access fails before any
// promise exists to catch.
//
// Rules for every copy surface in this codebase:
//   1. Detect the native API by capability (`writeText` is a function), not by
//      truthiness of `navigator.clipboard`.
//   2. A rejected native write is NOT a copy failure — fall back.
//   3. Never report success unless the text actually reached the clipboard.
//   4. Never fail silently — the caller surfaces a failure message.

import { toast } from "sonner";

export type ClipboardCopyFailureReason =
  | "empty"
  | "exec-command-rejected"
  | "exec-command-threw"
  | "clipboard-api-unavailable";

export type ClipboardCopyResult =
  | { ok: true }
  | { ok: false; reason: ClipboardCopyFailureReason };

export const CLIPBOARD_COPY_FAILED_MESSAGE = "复制失败，请手动选择文本";

function execCommandFallback(text: string): ClipboardCopyResult {
  if (typeof document === "undefined" || typeof document.execCommand !== "function") {
    return { ok: false, reason: "clipboard-api-unavailable" };
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.top = "0";
  textarea.style.left = "0";
  textarea.style.opacity = "0";
  textarea.style.pointerEvents = "none";
  textarea.style.width = "1px";
  textarea.style.height = "1px";

  const selection = document.getSelection();
  const savedRanges: Range[] = [];
  if (selection) {
    for (let i = 0; i < selection.rangeCount; i += 1) {
      savedRanges.push(selection.getRangeAt(i));
    }
  }

  document.body.appendChild(textarea);
  try {
    // Move the selection onto the textarea instead of focusing it, so the
    // user's caret and focus stay exactly where they were.
    if (selection) {
      selection.removeAllRanges();
      const range = document.createRange();
      range.selectNodeContents(textarea);
      selection.addRange(range);
    } else {
      textarea.select();
    }

    const copied = document.execCommand("copy");
    return copied ? { ok: true } : { ok: false, reason: "exec-command-rejected" };
  } catch {
    return { ok: false, reason: "exec-command-threw" };
  } finally {
    document.body.removeChild(textarea);
    if (selection) {
      selection.removeAllRanges();
      for (const range of savedRanges) {
        selection.addRange(range);
      }
    }
  }
}

/**
 * Copy plain text to the system clipboard.
 *
 * Tries the native Clipboard API first, then falls back to `execCommand`,
 * which keeps working in non-secure contexts. Returns a result instead of
 * throwing so callers can decide how to report failure.
 */
export async function copyTextToClipboard(text: string): Promise<ClipboardCopyResult> {
  if (!text) {
    return { ok: false, reason: "empty" };
  }

  if (typeof navigator !== "undefined" && typeof navigator.clipboard?.writeText === "function") {
    try {
      await navigator.clipboard.writeText(text);
      return { ok: true };
    } catch {
      // Permission denied or document not focused — fall back instead of failing.
    }
  }

  return execCommandFallback(text);
}

/**
 * Copy text and report the outcome through a Toast.
 *
 * Success-state UI (button label, inline status) stays with the caller: only
 * call sites that actually reached the clipboard may set it.
 */
export async function copyTextWithToast(
  text: string,
  options: { successMessage?: string; failureMessage?: string } = {}
): Promise<boolean> {
  const result = await copyTextToClipboard(text);
  if (result.ok) {
    if (options.successMessage) {
      toast.success(options.successMessage);
    }
    return true;
  }
  toast.error(options.failureMessage ?? CLIPBOARD_COPY_FAILED_MESSAGE);
  return false;
}
