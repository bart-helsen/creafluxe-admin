import { describe, it, expect, vi, beforeEach } from "vitest";

const findFirst = vi.fn();
vi.mock("@/lib/db", () => ({
  prisma: { purchaseInvoice: { findFirst: (...a: unknown[]) => findFirst(...a) } },
}));
const receivePurchaseInvoice = vi.fn();
vi.mock("@/server/purchases/purchaseInvoices", () => ({
  receivePurchaseInvoice: (...a: unknown[]) => receivePurchaseInvoice(...a),
}));

import {
  collectAttachments,
  mailOutcome,
  parseMail,
  receiveInboundFiles,
  senderAllowed,
  parseAddressList,
} from "./inbound";
import { describeRun, mailboxConfig, pollPurchaseMailbox, type MailClient } from "./mailbox";

// --- test mails -------------------------------------------------------------

const PDF = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n");
const BIG_PNG = Buffer.alloc(30 * 1024, 7);
const SMALL_PNG = Buffer.alloc(2 * 1024, 7);

function part(filename: string, type: string, buf: Buffer) {
  return [
    `Content-Type: ${type}; name="${filename}"`,
    `Content-Disposition: attachment; filename="${filename}"`,
    "Content-Transfer-Encoding: base64",
    "",
    buf.toString("base64").replace(/.{76}/g, "$&\r\n"),
  ].join("\r\n");
}

function mail({
  from = "Bart <bart.helsen@creafluxe.be>",
  subject = "Fwd: Rechnung RE-42",
  id = "<m1@test>" as string | null,
  parts = [] as string[],
}) {
  const b = "B" + Math.random().toString(36).slice(2);
  return Buffer.from(
    [
      `From: ${from}`,
      "To: facturen@creafluxe.be",
      `Subject: ${subject}`,
      ...(id ? [`Message-ID: ${id}`] : []),
      "MIME-Version: 1.0",
      `Content-Type: multipart/mixed; boundary="${b}"`,
      "",
      `--${b}`,
      "Content-Type: text/plain; charset=utf-8",
      "",
      "Zie bijlage.",
      ...parts.flatMap((p) => [`--${b}`, p]),
      `--${b}--`,
      "",
    ].join("\r\n"),
  );
}

function forwardedAsAttachment(inner: Buffer) {
  return [
    'Content-Type: message/rfc822; name="Rechnung.eml"',
    'Content-Disposition: attachment; filename="Rechnung.eml"',
    "",
    inner.toString("utf8"),
  ].join("\r\n");
}

// --- inbound ----------------------------------------------------------------

describe("collectAttachments", () => {
  it("finds files in the mail and inside a mail forwarded as attachment", async () => {
    const inner = mail({
      from: "billing@supplier.de",
      parts: [part("Rechnung.pdf", "application/pdf", PDF)],
    });
    const email = await parseMail(
      mail({ parts: [part("bon.png", "image/png", BIG_PNG), forwardedAsAttachment(inner)] }),
    );
    const files = await collectAttachments(email);
    expect(files.map((f) => f.filename)).toEqual(["bon.png", "Rechnung.pdf"]);
    expect(files[1].bytes.equals(PDF)).toBe(true);
  });
});

describe("senderAllowed", () => {
  it("matches full addresses and @domain, any of the given addresses", () => {
    const list = parseAddressList(" Bart.Helsen@creafluxe.be , @kbc.be ");
    expect(senderAllowed(list, ["x@supplier.de", "bart.helsen@creafluxe.be"])).toBe(true);
    expect(senderAllowed(list, ["noreply@kbc.be"])).toBe(true);
    expect(senderAllowed(list, ["spam@evil.com", null])).toBe(false);
    expect(senderAllowed([], ["anyone@x.y"])).toBe(true);
  });
});

describe("receiveInboundFiles", () => {
  beforeEach(() => {
    findFirst.mockReset().mockResolvedValue(null);
    receivePurchaseInvoice
      .mockReset()
      .mockImplementation(async ({ file }) => ({ id: `id-${file.fileName}` }));
  });

  it("stores PDFs and photos, skips logos and other files", async () => {
    const r = await receiveInboundFiles({
      messageRef: "<m1@test>",
      from: "a@b.c",
      subject: "Rechnung",
      files: [
        { filename: "RE-42.pdf", contentType: "application/octet-stream", bytes: PDF },
        { filename: "bon.jpg", contentType: "image/jpeg", bytes: BIG_PNG },
        { filename: "logo.png", contentType: "image/png", bytes: SMALL_PNG },
        { filename: "invite.ics", contentType: "text/calendar", bytes: Buffer.from("x") },
      ],
    });
    expect(r.created).toEqual(["id-RE-42.pdf", "id-bon.jpg"]);
    expect(r.skipped.map((s) => s.reason)).toEqual(["small inline image", "unsupported type"]);
    const call = receivePurchaseInvoice.mock.calls[0][0];
    expect(call).toMatchObject({
      source: "EMAIL",
      sourceRef: "<m1@test>#RE-42.pdf",
      notes: "Van: a@b.c\nOnderwerp: Rechnung",
    });
    expect(call.file.mimeType).toBe("application/pdf");
  });

  it("does not store the same file of the same mail twice", async () => {
    findFirst.mockResolvedValue({ id: "old" });
    const r = await receiveInboundFiles({
      messageRef: "<m1@test>",
      files: [{ filename: "a.pdf", contentType: "application/pdf", bytes: PDF }],
    });
    expect(r.created).toEqual([]);
    expect(r.skipped).toEqual([{ filename: "a.pdf", reason: "already received" }]);
    expect(receivePurchaseInvoice).not.toHaveBeenCalled();
  });
});

describe("mailOutcome", () => {
  it("moves stored and already-stored mails, retries storage errors, flags the rest", () => {
    expect(
      mailOutcome({
        created: ["x"],
        skipped: [{ filename: "l.png", reason: "small inline image" }],
      }),
    ).toEqual({ action: "done" });
    expect(
      mailOutcome({ created: [], skipped: [{ filename: "a.pdf", reason: "already received" }] }),
    ).toEqual({ action: "done" });
    expect(
      mailOutcome({
        created: ["x"],
        skipped: [{ filename: "b.pdf", reason: "could not be stored" }],
      }).action,
    ).toBe("retry");
    expect(mailOutcome({ created: [], skipped: [] })).toEqual({
      action: "flag",
      reason: "geen bijlagen",
    });
    expect(
      mailOutcome({ created: [], skipped: [{ filename: "x.ics", reason: "unsupported type" }] }),
    ).toEqual({
      action: "flag",
      reason: "geen PDF of foto",
    });
  });
});

// --- mailbox ----------------------------------------------------------------

/** An in-memory IMAP mailbox with the calls the reader uses. */
function fakeMailbox(messages: Record<number, Buffer>, folders = ["INBOX"]) {
  const flagged = new Set<number>();
  const moved: Record<number, string> = {};
  const created: string[] = [];
  let loggedOut = false;
  const client: MailClient = {
    connect: async () => {},
    logout: async () => {
      loggedOut = true;
    },
    getMailboxLock: async () => ({ release: () => {} }),
    mailbox: { uidValidity: BigInt(77) },
    search: async () =>
      Object.keys(messages)
        .map(Number)
        .filter((u) => !flagged.has(u) && !(u in moved)),
    fetchOne: async (uid) => ({ source: messages[Number(uid)] }),
    messageMove: async (uid, to) => {
      moved[Number(uid)] = to;
      return true;
    },
    messageFlagsAdd: async (uid) => {
      flagged.add(Number(uid));
      return true;
    },
    mailboxCreate: async (path) => {
      created.push(path);
      folders.push(path);
      return { path };
    },
    list: async () => folders.map((path) => ({ path })),
  };
  return { client, flagged, moved, created, isLoggedOut: () => loggedOut };
}

const cfg = mailboxConfig({
  PURCHASE_IMAP_HOST: "imap.example.be",
  PURCHASE_IMAP_USER: "facturen@creafluxe.be",
  PURCHASE_IMAP_PASSWORD: "pw",
  PURCHASE_IMAP_ALLOWED_FROM: "@creafluxe.be",
} as unknown as NodeJS.ProcessEnv)!;

describe("mailboxConfig", () => {
  it("is off until host, user and password are set, with sensible defaults", () => {
    expect(mailboxConfig({} as unknown as NodeJS.ProcessEnv)).toBeNull();
    expect(cfg).toMatchObject({
      port: 993,
      folder: "INBOX",
      doneFolder: "Verwerkt",
      allowedFrom: ["@creafluxe.be"],
    });
  });
});

describe("pollPurchaseMailbox", () => {
  beforeEach(() => {
    findFirst.mockReset().mockResolvedValue(null);
    receivePurchaseInvoice
      .mockReset()
      .mockImplementation(async ({ file }) => ({ id: `id-${file.fileName}` }));
  });

  it("stores invoices, moves those mails, flags the unusable ones", async () => {
    const box = fakeMailbox({
      1: mail({ parts: [part("RE-42.pdf", "application/pdf", PDF)] }),
      2: mail({ id: "<m2@test>", subject: "Nieuwsbrief", parts: [] }),
      3: mail({
        id: "<m3@test>",
        from: "spam@evil.com",
        parts: [part("x.pdf", "application/pdf", PDF)],
      }),
      4: mail({
        id: null,
        from: "billing@supplier.de",
        subject: "Auto-forward",
        parts: [part("inv.pdf", "application/pdf", PDF)],
      }),
    });
    // Mail 4: automatic forward — From is the supplier, Return-Path is Bart's mailbox.
    box.client.fetchOne = ((orig) => async (uid: string, q: { source: true }, o: { uid: true }) => {
      const m = await orig(uid, q, o);
      if (uid === "4" && m)
        return {
          source: Buffer.concat([
            Buffer.from("Return-Path: <contact@creafluxe.be>\r\n"),
            m.source!,
          ]),
        };
      return m;
    })(box.client.fetchOne);

    const run = await pollPurchaseMailbox(cfg, { client: box.client });

    expect(run.checked).toBe(4);
    expect(run.created).toBe(2);
    expect(box.moved).toEqual({ 1: "Verwerkt", 4: "Verwerkt" });
    expect([...box.flagged].sort()).toEqual([2, 3]);
    expect(box.created).toEqual(["Verwerkt"]);
    expect(box.isLoggedOut()).toBe(true);
    // No Message-ID: identified by its place in the mailbox, so a re-read is still deduplicated.
    expect(receivePurchaseInvoice.mock.calls[1][0].sourceRef).toBe(
      "imap:facturen@creafluxe.be:77:4#inv.pdf",
    );
    expect(describeRun(run)).toBe(
      "2 facturen toegevoegd; 2 mails gemarkeerd in de mailbox (“Nieuwsbrief”: geen bijlagen; “Fwd: Rechnung RE-42”: afzender niet toegestaan).",
    );
  });

  it("leaves a mail in place when storing fails, and keeps going", async () => {
    receivePurchaseInvoice.mockImplementationOnce(async () => {
      throw new Error("R2 down");
    });
    const box = fakeMailbox(
      {
        1: mail({ parts: [part("a.pdf", "application/pdf", PDF)] }),
        2: mail({ id: "<m2@test>", parts: [part("b.pdf", "application/pdf", PDF)] }),
      },
      ["INBOX", "INBOX.Verwerkt"],
    );
    const run = await pollPurchaseMailbox(cfg, { client: box.client });
    expect(run.mails.map((m) => m.outcome)).toEqual(["retry", "done"]);
    expect(box.moved).toEqual({ 2: "Verwerkt" });
    expect(box.flagged.size).toBe(0);
    expect(box.created).toEqual([]); // "INBOX.Verwerkt" already exists
  });

  it("says so when there is nothing new", async () => {
    const run = await pollPurchaseMailbox(cfg, { client: fakeMailbox({}).client });
    expect(describeRun(run)).toBe("Geen nieuwe mails in de factuurmailbox.");
  });
});
