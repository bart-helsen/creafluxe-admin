import { Resend } from "resend";

// Transactional email via Resend (docs/02). Used for the new-order notification
// to you (Flow 3) and, in later phases, customer-facing mail.
//
// Email is optional in local development: if RESEND_API_KEY is not set,
// `sendEmail` logs the message and reports `configured: false` instead of
// throwing, so intake still succeeds and the attempt is recorded in
// NotificationLog. Nothing is silently lost.

const RESEND_API_KEY = process.env.RESEND_API_KEY;

/** The inbox that receives operational alerts (new order, low stock, ...). */
export const NOTIFY_EMAIL = process.env.NOTIFY_EMAIL ?? "orders@creafluxe.be";

/** The verified "from" address. Falls back to Resend's onboarding sender. */
export const FROM_EMAIL =
  process.env.EMAIL_FROM ?? "Creafluxe Admin <onboarding@resend.dev>";

export function isEmailConfigured(): boolean {
  return Boolean(RESEND_API_KEY);
}

let cachedClient: Resend | null = null;

function client(): Resend {
  if (!cachedClient) cachedClient = new Resend(RESEND_API_KEY);
  return cachedClient;
}

export type SendEmailResult =
  | { ok: true; configured: true; id: string | null }
  | { ok: true; configured: false; id: null }
  | { ok: false; configured: true; id: null; error: string };

export async function sendEmail(params: {
  to: string | string[];
  subject: string;
  html: string;
  replyTo?: string;
}): Promise<SendEmailResult> {
  if (!isEmailConfigured()) {
    console.info(
      `[email] RESEND_API_KEY not set — would send "${params.subject}" to ${String(
        params.to,
      )}`,
    );
    return { ok: true, configured: false, id: null };
  }

  try {
    const { data, error } = await client().emails.send({
      from: FROM_EMAIL,
      to: params.to,
      subject: params.subject,
      html: params.html,
      replyTo: params.replyTo,
    });
    if (error) {
      return { ok: false, configured: true, id: null, error: error.message };
    }
    return { ok: true, configured: true, id: data?.id ?? null };
  } catch (err) {
    return {
      ok: false,
      configured: true,
      id: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
