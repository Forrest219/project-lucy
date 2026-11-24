// @vitest-environment jsdom
// Spec 192 / Plan M65 — clipboard helper contract.
//
// The Clipboard API is `[SecureContext]`-gated: on the supported intranet-HTTP
// customer mode (`security.access=http`) the browser does not expose
// `navigator.clipboard` at all. These cases pin the degradation contract so a
// non-secure origin can never end up with a silently dead copy button.
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CLIPBOARD_COPY_FAILED_MESSAGE,
  copyTextToClipboard,
  copyTextWithToast
} from "../lib/clipboard";

const toastMock = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn()
}));

vi.mock("sonner", () => ({ toast: toastMock }));

const originalClipboard = Object.getOwnPropertyDescriptor(navigator, "clipboard");
const originalExecCommand = Object.getOwnPropertyDescriptor(document, "execCommand");

function setClipboard(value: unknown): void {
  Object.defineProperty(navigator, "clipboard", { configurable: true, value });
}

/** `undefined` removes the method entirely, mimicking a browser without it. */
function setExecCommand(impl: ((command: string) => boolean) | undefined): void {
  Object.defineProperty(document, "execCommand", { configurable: true, value: impl });
}

/**
 * Capture the state Chromium would copy FROM at the moment `execCommand("copy")`
 * runs. `execCommand` returns `true` even when nothing is selected, so the stub
 * must observe the selection itself instead of trusting its own return value.
 */
function stubExecCommand(returns: boolean) {
  const calls: string[] = [];
  let copiedText: string | null = null;
  let selectedText: string | null = null;
  let textareaFocused = false;
  let hostRole: string | null = null;
  setExecCommand((command: string) => {
    calls.push(command);
    const textarea = document.querySelector("textarea");
    copiedText = textarea ? (textarea as HTMLTextAreaElement).value : null;
    if (textarea) {
      const field = textarea as HTMLTextAreaElement;
      textareaFocused = document.activeElement === field;
      hostRole = field.parentElement?.getAttribute("role") ?? null;
      selectedText = field.value.slice(field.selectionStart, field.selectionEnd);
    }
    return returns;
  });
  return {
    calls,
    getCopiedText: () => copiedText,
    /** What a real browser would put on the clipboard. */
    getSelectedText: () => selectedText,
    wasTextareaFocused: () => textareaFocused,
    getHostRole: () => hostRole
  };
}

afterEach(() => {
  if (originalClipboard) {
    Object.defineProperty(navigator, "clipboard", originalClipboard);
  } else {
    Reflect.deleteProperty(navigator, "clipboard");
  }
  if (originalExecCommand) {
    Object.defineProperty(document, "execCommand", originalExecCommand);
  } else {
    Reflect.deleteProperty(document, "execCommand");
  }
  toastMock.success.mockClear();
  toastMock.error.mockClear();
  toastMock.info.mockClear();
});

describe("copyTextToClipboard", () => {
  it("uses the native Clipboard API when it is available", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    setClipboard({ writeText });
    setExecCommand(() => true);

    const result = await copyTextToClipboard("hello");

    expect(result).toEqual({ ok: true });
    expect(writeText).toHaveBeenCalledWith("hello");
  });

  it("falls back to execCommand when the origin is not a secure context", async () => {
    // This is the production intranet-HTTP case: `navigator.clipboard` does not
    // exist at all, so touching `.writeText` throws before any promise exists.
    setClipboard(undefined);
    const fallback = stubExecCommand(true);

    const result = await copyTextToClipboard("fallback payload");

    expect(result).toEqual({ ok: true });
    expect(fallback.calls).toContain("copy");
    expect(fallback.getCopiedText()).toBe("fallback payload");
    // A real browser copies the *selection*, not the textarea value: an empty
    // selection still makes `execCommand` return true (the 2026-11-17 fake success).
    expect(fallback.wasTextareaFocused()).toBe(true);
    expect(fallback.getSelectedText()).toBe("fallback payload");
  });

  it("selects the full payload for multi-line text", async () => {
    setClipboard(undefined);
    const fallback = stubExecCommand(true);
    const payload = "第一行\n第二行\n" + "x".repeat(3000);

    const result = await copyTextToClipboard(payload);

    expect(result).toEqual({ ok: true });
    expect(fallback.getSelectedText()).toBe(payload);
  });

  it("does not report success when the helper textarea cannot be selected", async () => {
    setClipboard(undefined);
    const fallback = stubExecCommand(true);
    const focus = vi.spyOn(HTMLElement.prototype, "focus").mockImplementation(() => undefined);

    const result = await copyTextToClipboard("cannot focus");

    focus.mockRestore();
    expect(result).toEqual({ ok: false, reason: "exec-command-rejected" });
    expect(fallback.calls).not.toContain("copy");
  });

  it("falls back to execCommand when the native write is rejected", async () => {
    const writeText = vi.fn().mockRejectedValue(new Error("permission denied"));
    setClipboard({ writeText });
    const fallback = stubExecCommand(true);

    const result = await copyTextToClipboard("rejected native");

    expect(result).toEqual({ ok: true });
    expect(writeText).toHaveBeenCalledWith("rejected native");
    expect(fallback.calls).toContain("copy");
    expect(fallback.getCopiedText()).toBe("rejected native");
  });

  it("reports a failure when execCommand rejects the copy", async () => {
    setClipboard(undefined);
    stubExecCommand(false);

    const result = await copyTextToClipboard("nope");

    expect(result).toEqual({ ok: false, reason: "exec-command-rejected" });
  });

  it("reports a failure when execCommand throws", async () => {
    setClipboard(undefined);
    setExecCommand(() => {
      throw new Error("boom");
    });

    const result = await copyTextToClipboard("nope");

    expect(result).toEqual({ ok: false, reason: "exec-command-threw" });
  });

  it("reports a failure when neither mechanism exists", async () => {
    setClipboard(undefined);
    setExecCommand(undefined);

    const result = await copyTextToClipboard("nope");

    expect(result).toEqual({ ok: false, reason: "clipboard-api-unavailable" });
  });

  it("refuses empty text without touching any mechanism", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    setClipboard({ writeText });
    const fallback = stubExecCommand(true);

    const result = await copyTextToClipboard("");

    expect(result).toEqual({ ok: false, reason: "empty" });
    expect(writeText).not.toHaveBeenCalled();
    expect(fallback.calls).toHaveLength(0);
  });

  it("removes the helper textarea and restores the user selection", async () => {
    setClipboard(undefined);
    stubExecCommand(true);

    const anchor = document.createElement("div");
    anchor.textContent = "user selection";
    document.body.appendChild(anchor);
    const range = document.createRange();
    range.selectNodeContents(anchor);
    const selection = document.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);

    await copyTextToClipboard("copied elsewhere");

    expect(document.querySelectorAll("textarea")).toHaveLength(0);
    expect(selection?.rangeCount).toBe(1);
    expect(selection?.getRangeAt(0).startContainer).toBe(anchor);

    anchor.remove();
  });

  it("returns focus to the element that was focused before copying", async () => {
    setClipboard(undefined);
    stubExecCommand(true);
    const button = document.createElement("button");
    document.body.appendChild(button);
    button.focus();

    await copyTextToClipboard("keep focus");

    expect(document.activeElement).toBe(button);
    button.remove();
  });

  it("keeps the helper textarea inside an open dialog so a focus trap does not steal focus", async () => {
    setClipboard(undefined);
    const fallback = stubExecCommand(true);
    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    const button = document.createElement("button");
    dialog.appendChild(button);
    document.body.appendChild(dialog);
    button.focus();

    await copyTextToClipboard("inside dialog");

    expect(fallback.getHostRole()).toBe("dialog");
    expect(fallback.getSelectedText()).toBe("inside dialog");
    expect(dialog.querySelectorAll("textarea")).toHaveLength(0);
    dialog.remove();
  });
});

describe("copyTextWithToast", () => {
  it("reports success through a Toast", async () => {
    setClipboard({ writeText: vi.fn().mockResolvedValue(undefined) });

    const ok = await copyTextWithToast("payload", { successMessage: "已复制" });

    expect(ok).toBe(true);
    expect(toastMock.success).toHaveBeenCalledWith("已复制");
    expect(toastMock.error).not.toHaveBeenCalled();
  });

  it("reports failure through a Toast without leaking the copied text", async () => {
    setClipboard(undefined);
    setExecCommand(undefined);

    const ok = await copyTextWithToast("super-secret-token", {
      failureMessage: "复制失败，请手动选择文本"
    });

    expect(ok).toBe(false);
    expect(toastMock.success).not.toHaveBeenCalled();
    expect(toastMock.error).toHaveBeenCalledWith("复制失败，请手动选择文本");
    expect(toastMock.error.mock.calls[0]?.[0]).not.toContain("super-secret-token");
  });

  it("falls back to the shared failure message", async () => {
    setClipboard(undefined);
    setExecCommand(undefined);

    await copyTextWithToast("payload");

    expect(toastMock.error).toHaveBeenCalledWith(CLIPBOARD_COPY_FAILED_MESSAGE);
  });
});
