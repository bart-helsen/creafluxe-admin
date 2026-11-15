import { ImapFlow } from "imapflow";
import {
  collectAttachments,
  mailOutcome,
  parseAddressList,
  parseMail,
  receiveInboundFiles,
  senderAllowed,
  type InboundResult,
} from "@/server/purchases/inbound";

// Reads the purchase-invoice mailbox (e.g. facturen@creafluxe.be) over IMAP.
// Every mail in the folder that isn't flagged is read; its PDFs/photos become
// "Te controleren" invoices and the mail moves to the done folder. A mail
// with nothing usable gets a flag (a star in webmail) and stays put, so you
// see it and the next run skips it. Remove the flag to have it read again.
//
// Runs from the scheduler (/api/cron/purchase-mailbox) and from the
// "Mailbox nu ophalen" button. Works with any IMAP mailbox: easyhost now,
// Gmail later (with an app password) — only the PURCHASE_IMAP_* values change.

export interface MailboxConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  folder: string;
  doneFolder: string;
  allowedFrom: string[];
}

export function mailboxConfig(env: NodeJS.ProcessEnv = process.env): MailboxConfig | null {
  const host = env.PURCHASE_IMAP_HOST?.trim();
  const user = env.PURCHASE_IMAP_USER?.trim();
  const password = env.PURCHASE_IMAP_PASSWORD;
  if (!host || !user || !password) return null;
  return {
    host,
    port: Number(env.PURCHASE_IMAP_PORT) || 993,
    user,
    password,
    folder: env.PURCHASE_IMAP_FOLDER?.trim() || "INBOX",
    doneFolder: env.PURCHASE_IMAP_DONE_FOLDER?.trim() || "Verwerkt",
    allowedFrom: parseAddressList(env.PURCHASE_IMAP_ALLOWED_FROM),
  };
}

export function isMailboxConfigured(): boolean {
  return mailboxConfig() !== null;
}

/** Mails handled per run; the rest wait for the next run. */
const MAX_PER_RUN = 25;

export interface MailboxMail {
  subject: string | null;
  from: string | null;
  outcome: "done" | "retry" | "flag";
  reason?: string;
  created: number;
}

export interface MailboxRun {
  checked: number;
  created: number;
  mails: MailboxMail[];
  /** More unread work than MAX_PER_RUN: the next run continues. */
  more: boolean;
}

/** The parts of an IMAP client this module uses — real ImapFlow, or a fake in tests. */
export interface MailClient {
  connect(): Promise<void>;
  logout(): Promise<void>;
  getMailboxLock(path: string): Promise<{ release(): void }>;
  mailbox: false | { uidValidity?: bigint | number };
  search(
    query: { flagged: boolean },
    options: { uid: true },
  ): Promise<number[] | false | undefined>;
  fetchOne(
    uid: string,
    query: { source: true },
    options: { uid: true },
  ): Promise<false | { source?: Buffer }>;
  messageMove(uid: string, to: string, options: { uid: true }): Promise<unknown>;
  messageFlagsAdd(uid: string, flags: string[], options: { uid: true }): Promise<boolean>;
  mailboxCreate(path: string): Promise<unknown>;
  list(): Promise<{ path: string }[]>;
}

export interface MailboxDeps {
  client?: MailClient;
  receive?: typeof receiveInboundFiles;
}

function realClient(cfg: MailboxConfig): MailClient {
  return new ImapFlow({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.port === 993,
    auth: { user: cfg.user, pass: cfg.password },
    logger: false,
    connectionTimeout: 20_000,
    socketTimeout: 60_000,
  }) as unknown as MailClient;
}

async function ensureFolder(client: MailClient, path: string): Promise<void> {
  const folders = await client.list();
  const wanted = path.toLowerCase();
  // Some servers keep folders under "INBOX." — ImapFlow adds that prefix itself.
  if (
    folders.some(
      (f) =>
        f.path.toLowerCase() === wanted ||
        f.path.toLowerCase().endsWith(`.${wanted}`) ||
        f.path.toLowerCase().endsWith(`/${wanted}`),
    )
  ) {
    return;
  }
  await client.mailboxCreate(path);
}

/** Read the mailbox once. Throws when the mailbox can't be reached or logged in to. */
export async function pollPurchaseMailbox(
  cfg: MailboxConfig | null = mailboxConfig(),
  deps: MailboxDeps = {},
): Promise<MailboxRun> {
  if (!cfg)
    throw new Error("De factuurmailbox is niet ingesteld (PURCHASE_IMAP_HOST/USER/PASSWORD).");
  const client = deps.client ?? realClient(cfg);
  const receive = deps.receive ?? receiveInboundFiles;
  const run: MailboxRun = { checked: 0, created: 0, mails: [], more: false };

  await client.connect();
  try {
    const lock = await client.getMailboxLock(cfg.folder);
    try {
      const uidValidity = client.mailbox ? String(client.mailbox.uidValidity ?? "") : "";
      const uids = (await client.search({ flagged: false }, { uid: true })) || [];
      run.more = uids.length > MAX_PER_RUN;
      let folderReady = false;

      for (const uid of uids.slice(0, MAX_PER_RUN)) {
        try {
          const msg = await client.fetchOne(String(uid), { source: true }, { uid: true });
          if (!msg || !msg.source) continue;
          run.checked++;

          const email = await parseMail(msg.source);
          const from = email.from?.address ?? null;
          const returnPath =
            email.headers?.find((h) => h.key === "return-path")?.value.replace(/[<>\s]/g, "") ??
            null;
          const subject = email.subject ?? null;
          // Without a Message-ID, the mail's place in this mailbox identifies it.
          const messageRef = email.messageId || `imap:${cfg.user}:${uidValidity}:${uid}`;

          let result: InboundResult | null = null;
          let outcome: ReturnType<typeof mailOutcome>;
          if (!senderAllowed(cfg.allowedFrom, [from, returnPath, email.sender?.address])) {
            outcome = { action: "flag", reason: "afzender niet toegestaan" };
          } else {
            result = await receive({
              messageRef,
              from,
              subject,
              files: await collectAttachments(email),
            });
            outcome = mailOutcome(result);
          }

          if (outcome.action === "done") {
            if (!folderReady) {
              await ensureFolder(client, cfg.doneFolder);
              folderReady = true;
            }
            await client.messageMove(String(uid), cfg.doneFolder, { uid: true });
          } else if (outcome.action === "flag") {
            await client.messageFlagsAdd(String(uid), ["\\Flagged"], { uid: true });
          }

          const created = result?.created.length ?? 0;
          run.created += created;
          run.mails.push({
            subject,
            from,
            outcome: outcome.action,
            ...(outcome.action !== "done" ? { reason: outcome.reason } : {}),
            created,
          });
        } catch (err) {
          // One bad mail must not stop the others; it is tried again next run.
          console.error("[purchases:mailbox] mail failed:", uid, err);
          run.mails.push({
            subject: null,
            from: null,
            outcome: "retry",
            reason: "fout bij het lezen",
            created: 0,
          });
        }
      }
    } finally {
      lock.release();
    }
  } finally {
    await client.logout().catch(() => undefined);
  }
  return run;
}

/** One line for the button and the logs: "2 facturen toegevoegd; 1 mail gemarkeerd (geen PDF of foto)." */
export function describeRun(run: MailboxRun): string {
  if (!run.checked) return "Geen nieuwe mails in de factuurmailbox.";
  const parts: string[] = [];
  parts.push(run.created === 1 ? "1 factuur toegevoegd" : `${run.created} facturen toegevoegd`);
  const flagged = run.mails.filter((m) => m.outcome === "flag");
  const retry = run.mails.filter((m) => m.outcome === "retry");
  const detail = (ms: MailboxMail[]) =>
    ms.map((m) => `“${m.subject ?? "zonder onderwerp"}”: ${m.reason}`).join("; ");
  if (flagged.length) {
    parts.push(
      `${flagged.length} ${flagged.length === 1 ? "mail" : "mails"} gemarkeerd in de mailbox (${detail(flagged)})`,
    );
  }
  if (retry.length) {
    parts.push(
      `${retry.length} ${retry.length === 1 ? "mail wordt" : "mails worden"} later opnieuw geprobeerd (${detail(retry)})`,
    );
  }
  if (run.more) parts.push("er staan nog mails klaar voor de volgende ronde");
  return `${parts.join("; ")}.`;
}
