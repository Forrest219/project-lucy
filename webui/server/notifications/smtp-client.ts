/**
 * Lucy v0.25 — L25-05 可选 SMTP 通知: the SMTP transport.
 *
 * This is the ONLY module that talks to an SMTP server. It wraps nodemailer so
 * that the rest of the notifier never sees a protocol error, a server response,
 * a credential, or a socket.
 *
 * Hard rules (Spec §8 / §5.2):
 *
 * - **TLS is never optional.** `tls` means direct TLS; `starttls` means the
 *   upgrade is *required* — nodemailer's `requireTLS` fails the connection when
 *   the server does not offer STARTTLS and never falls back to plaintext.
 *   `ignoreTLS` and `opportunisticTLS` are never set: the library itself
 *   rejects a contradictory configuration rather than quietly downgrading.
 * - **Certificate and hostname verification stay on.** There is no switch to
 *   turn them off; `rejectUnauthorized` is never set. A private CA only
 *   *appends* trust through `tls.ca`.
 * - **Every phase is bounded.** Connect, greeting and socket each have their
 *   own timeout, and the whole send is bounded as well.
 * - **The server's raw response never escapes.** Failures are mapped to a
 *   closed error code; `err.message` carries the server's response text and is
 *   therefore never logged, never stored, and never returned.
 */

import nodemailer, { type Transporter } from "nodemailer";
import type { SmtpRuntimeView } from "./runtime.js";

/** Closed transport failure codes. Nothing else may reach the API or the logs. */
export const SMTP_TRANSPORT_ERROR_CODES = [
  "smtp_unreachable",
  "smtp_timeout",
  "smtp_tls_failed",
  "smtp_auth_failed",
  "smtp_rejected",
  "smtp_failed"
] as const;

export type SmtpTransportErrorCode = (typeof SMTP_TRANSPORT_ERROR_CODES)[number];

/** Per-phase bounds (Spec §5.2): connect 10s, total send 20s. */
export const SMTP_CONNECT_TIMEOUT_MS = 10_000;
export const SMTP_GREETING_TIMEOUT_MS = 10_000;
export const SMTP_SOCKET_TIMEOUT_MS = 20_000;
export const SMTP_SEND_TIMEOUT_MS = 20_000;

export type SmtpMessage = {
  /** The envelope sender; also the visible `To` (Spec §4.3). */
  from: string;
  /** The visible `To` header — the from address, so recipients stay hidden. */
  to: string;
  /** The real recipients; they only ever appear in Bcc. */
  bcc: string[];
  subject: string;
  /** Plain text only. There is no HTML body, no attachment, no remote content. */
  text: string;
};

export type SmtpSendOutcome =
  | { ok: true; accepted: number }
  | { ok: false; reason: SmtpTransportErrorCode; permanent: boolean };

/**
 * The send seam. Production always uses `sendSmtpMessage`; the worker takes
 * one as an explicit parameter so a test can drive the queue state machine
 * without a network, without a module-level switch, and without leaking state
 * between tests.
 */
export type SmtpSender = (
  view: SmtpRuntimeView,
  message: SmtpMessage
) => Promise<SmtpSendOutcome>;

type SmtpErrorShape = {
  code?: unknown;
  originalCode?: unknown;
  command?: unknown;
  responseCode?: unknown;
  permanent?: unknown;
  timeoutType?: unknown;
};

/**
 * nodemailer wraps a system error and keeps the original under `originalCode`
 * (`ECONNREFUSED` becomes `ECONNECTION`, a TLS failure becomes `ESOCKET`). The
 * classifier therefore has to look at BOTH codes — looking at `err.code` alone
 * would report every certificate failure as a generic socket error.
 */
function errorCodes(error: SmtpErrorShape): string[] {
  const codes: string[] = [];
  for (const value of [error.code, error.originalCode]) {
    if (typeof value === "string" && value) codes.push(value);
  }
  return codes;
}

function isTlsFailure(codes: string[]): boolean {
  return codes.some((code) => {
    if (code === "ETLS") return true;
    if (code.startsWith("CERT_")) return true;
    if (code.startsWith("ERR_TLS")) return true;
    if (code.startsWith("ERR_SSL")) return true;
    if (code.startsWith("DEPTH_")) return true;
    if (code.startsWith("UNABLE_")) return true;
    if (code === "SELF_SIGNED_CERT_IN_CHAIN") return true;
    return false;
  });
}

function isTimeout(codes: string[]): boolean {
  return codes.some((code) => code === "ETIMEDOUT" || code === "ETIME");
}

function isAuthFailure(codes: string[]): boolean {
  return codes.some((code) => code === "EAUTH");
}

function isNetworkFailure(codes: string[]): boolean {
  return codes.some((code) =>
    ["ECONNECTION", "EDNS", "ESOCKET", "EPROTOCOL", "ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN"].includes(code)
  );
}

/**
 * Map a transport failure to a closed code.
 *
 * `permanent` drives the worker's retry decision: a permanent failure goes
 * straight to `dead`, a transient one is retried with the bounded backoff.
 *
 * The permanent rule follows the library's own judgement for SMTP responses —
 * 5xx is permanent, **except 503**, which is a transient busy signal. Failures
 * without an SMTP response (network, TLS, timeout, auth) are transient: the
 * bounded attempt count and the row expiry still cap them.
 */
export function classifySmtpFailure(error: unknown): {
  reason: SmtpTransportErrorCode;
  permanent: boolean;
} {
  const err = (error ?? {}) as SmtpErrorShape;
  const codes = errorCodes(err);

  if (isAuthFailure(codes)) return { reason: "smtp_auth_failed", permanent: false };
  if (isTlsFailure(codes)) return { reason: "smtp_tls_failed", permanent: false };
  if (isTimeout(codes)) return { reason: "smtp_timeout", permanent: false };

  const responseCode = typeof err.responseCode === "number" ? err.responseCode : undefined;
  if (responseCode !== undefined) {
    const permanent =
      typeof err.permanent === "boolean"
        ? err.permanent
        : responseCode >= 500 && responseCode < 600 && responseCode !== 503;
    return { reason: "smtp_rejected", permanent };
  }

  if (isNetworkFailure(codes)) return { reason: "smtp_unreachable", permanent: false };
  return { reason: "smtp_failed", permanent: false };
}

/**
 * Build the transport options for the cached configuration.
 *
 * `requireTLS` is what makes STARTTLS non-negotiable; `secure` is what makes
 * direct TLS non-negotiable. Neither branch can send a credential in the
 * clear: in STARTTLS mode nodemailer refuses to send AUTH before the upgrade.
 */
export function buildTransportOptions(view: SmtpRuntimeView): Record<string, unknown> {
  const profile = view.profile;
  if (!profile) throw new Error("the SMTP profile is required to build a transport");

  const options: Record<string, unknown> = {
    host: profile.host,
    port: profile.port,
    secure: profile.security === "tls",
    requireTLS: profile.security === "starttls",
    connectionTimeout: SMTP_CONNECT_TIMEOUT_MS,
    greetingTimeout: SMTP_GREETING_TIMEOUT_MS,
    socketTimeout: SMTP_SOCKET_TIMEOUT_MS,
    // The library's default logger is already silent; say so explicitly so the
    // SMTP dialogue can never reach the application log (Spec §8.4).
    logger: false
  };

  if (profile.username) {
    options.auth = { user: profile.username, pass: view.password ?? "" };
  }
  if (view.caPem) {
    // A private CA only appends trust. `rejectUnauthorized` stays at its
    // secure default — there is no switch to disable verification.
    options.tls = { ca: [view.caPem] };
  }
  return options;
}

/**
 * Send one message. Never throws: every failure comes back as a closed code.
 *
 * The SMTP server accepting the message is NOT a delivery guarantee — it only
 * means the message left Lucy (Spec §1.2).
 */
export async function sendSmtpMessage(
  view: SmtpRuntimeView,
  message: SmtpMessage
): Promise<SmtpSendOutcome> {
  if (!view.enabled || view.state !== "ok" || !view.profile) {
    // The caller is expected to check the runtime view first; if it does not,
    // the send must still fail closed instead of reaching the network.
    return { ok: false, reason: "smtp_failed", permanent: true };
  }
  if (message.bcc.length === 0) {
    return { ok: false, reason: "smtp_failed", permanent: true };
  }

  let transporter: Transporter | null = null;
  let timer: NodeJS.Timeout | null = null;
  try {
    transporter = nodemailer.createTransport(buildTransportOptions(view) as never);

    const sendPromise = transporter.sendMail({
      from: message.from,
      to: message.to,
      bcc: message.bcc,
      // The **envelope** carries only the real recipients. Without it, nodemailer
      // would derive the envelope from `to` + `bcc`, and the visible `To` (the
      // from address) would become an envelope recipient — Lucy would mail
      // itself on every notification. The visible `To` header is what keeps the
      // recipients from seeing each other (Spec §4.3).
      envelope: { from: message.from, to: message.bcc },
      subject: message.subject,
      text: message.text
    });

    // The total send is bounded as well, so a server that accepts the
    // connection and then stalls cannot hold the worker forever.
    const bounded = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        // Close the connection so the stalled send does not linger.
        void transporter?.close();
        reject(new Error("the SMTP send exceeded its total time budget"));
      }, SMTP_SEND_TIMEOUT_MS);
      timer.unref();
    });

    const info = await Promise.race([sendPromise, bounded]);
    const accepted = Array.isArray(info?.accepted) ? info.accepted.length : 0;
    if (accepted === 0) {
      // The server took the connection but accepted nobody: treat it as a
      // rejection rather than as a success.
      return { ok: false, reason: "smtp_rejected", permanent: false };
    }
    return { ok: true, accepted };
  } catch (error) {
    return { ok: false, ...classifySmtpFailure(error) };
  } finally {
    if (timer) clearTimeout(timer);
    // `pool` is off, so the transport opened its own connection: close it.
    void transporter?.close();
  }
}
