import { z } from "zod";
import { LOGGABLE_EVENT_KINDS, MANUAL_REQUEST_STATUSES } from "@/lib/requests";
import {
  MANUAL_ORDER_CHANNELS,
  MANUAL_ORDER_START_STATUSES,
  type ManualOrderChannel,
} from "@/lib/manual-order";

// Zod schemas for validating input. As the app grows (Phase 1: the order
// intake body, presign requests, etc.) their schemas live here too, so every
// request body is validated in one predictable place.

export const loginSchema = z.object({
  email: z.string().email("Enter a valid email address."),
  password: z.string().min(1, "Enter your password."),
});

export type LoginInput = z.infer<typeof loginSchema>;

// ---------------------------------------------------------------------------
// Order intake (POST /api/orders/intake) — the payload the website posts.
// Mirrors docs/04. Money arrives as a 2-decimal string ("12.00"); we validate
// the shape here and re-price catalogue lines server-side in createOrder.
// ---------------------------------------------------------------------------

const moneyString = z
  .string()
  .regex(/^\d+(\.\d{1,2})?$/, "Amount must be a decimal string like \"12.00\".");

export const intakeItemSchema = z.object({
  sku: z.string().trim().min(1).nullish(),
  name: z.string().trim().min(1, "Item name is required."),
  unitPrice: moneyString,
  quantity: z.number().int().positive(),
  material: z.string().trim().min(1).nullish(),
  size: z.string().trim().min(1).nullish(),
  style: z.string().trim().min(1).nullish(),
  design: z.string().trim().min(1).nullish(),
  remarks: z.string().trim().min(1).nullish(),
  uploadKeys: z.array(z.string().trim().min(1)).default([]),
});

export const intakeSchema = z
  .object({
    type: z.enum(["WEBSHOP", "CUSTOM"]).default("WEBSHOP"),
    clientRef: z.string().trim().min(1).max(200).nullish(),
    customer: z.object({
      name: z.string().trim().min(1, "Customer name is required."),
      email: z.string().trim().email("A valid customer email is required."),
      phone: z.string().trim().min(1).nullish(),
      isBusiness: z.boolean().default(false),
      vatNumber: z.string().trim().min(1).nullish(),
      companyName: z.string().trim().min(1).nullish(),
    }),
    delivery: z
      .object({
        requested: z.boolean().default(false),
        street: z.string().trim().min(1).nullish(),
        postal: z.string().trim().min(1).nullish(),
        city: z.string().trim().min(1).nullish(),
        country: z.string().trim().min(1).nullish(),
        notes: z.string().trim().min(1).nullish(),
      })
      .nullish(),
    customerRemarks: z.string().trim().min(1).nullish(),
    designBrief: z.string().trim().min(1).nullish(),
    items: z.array(intakeItemSchema).default([]),
  })
  .refine((v) => v.items.length > 0 || (v.type === "CUSTOM" && !!v.designBrief), {
    message:
      "Provide at least one item, or a designBrief for a CUSTOM request.",
    path: ["items"],
  });

export type IntakeInput = z.infer<typeof intakeSchema>;
export type IntakeItemInput = z.infer<typeof intakeItemSchema>;

// ---------------------------------------------------------------------------
// Presigned upload request (POST /api/uploads/presign).
// ---------------------------------------------------------------------------

export const presignSchema = z.object({
  fileName: z.string().trim().min(1).max(255),
  mimeType: z.string().trim().min(1),
  sizeBytes: z.number().int().positive(),
});

export type PresignInput = z.infer<typeof presignSchema>;

// ---------------------------------------------------------------------------
// Manual order (admin → "Nieuwe bestelling"). For orders that reach you by
// phone, e-mail, in person or via social media instead of through the webshop.
// Unlike the intake, the admin is trusted: the unit price entered on each line
// is kept as-is (so you can give a discount or quote a custom job), and a line
// may be negative (e.g. "Korting").
// ---------------------------------------------------------------------------

const signedMoneyString = z
  .string()
  .trim()
  .transform((s) => s.replace(",", "."))
  .pipe(
    z
      .string()
      .regex(/^-?\d+(\.\d{1,2})?$/, "Prijs moet een bedrag zijn, bv. 12,50."),
  );

const optionalText = z
  .string()
  .trim()
  .nullish()
  .transform((v) => (v ? v : null));

export const manualOrderItemSchema = z.object({
  productId: optionalText,
  name: z.string().trim().min(1, "Elke lijn heeft een omschrijving nodig."),
  unitPrice: signedMoneyString,
  quantity: z.coerce.number().int().positive("Aantal moet minstens 1 zijn."),
  // Used for free lines; catalogue lines always take the product's own rate.
  vatRate: z
    .string()
    .regex(/^\d{1,2}(\.\d{1,2})?$/, "Ongeldig btw-tarief.")
    .default("21"),
  material: optionalText,
  size: optionalText,
  style: optionalText,
  design: optionalText,
  remarks: optionalText,
});

const newCustomerSchema = z.object({
  mode: z.literal("new"),
  name: z.string().trim().min(1, "Naam van de klant is verplicht."),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .email("Ongeldig e-mailadres.")
    .or(z.literal(""))
    .nullish()
    .transform((v) => (v ? v : null)),
  phone: optionalText,
  isBusiness: z.boolean().default(false),
  companyName: optionalText,
  vatNumber: optionalText,
  addressStreet: optionalText,
  addressPostal: optionalText,
  addressCity: optionalText,
  addressCountry: optionalText,
});

/** Pick an existing customer or create a new one (manual orders & requests). */
export const customerChoiceSchema = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("existing"),
    id: z.string().min(1, "Kies een klant."),
  }),
  newCustomerSchema,
]);

export type CustomerChoiceInput = z.infer<typeof customerChoiceSchema>;

export const manualOrderSchema = z
  .object({
    customer: customerChoiceSchema,
    type: z.enum(["WEBSHOP", "CUSTOM"]).default("WEBSHOP"),
    channel: z.enum(
      Object.keys(MANUAL_ORDER_CHANNELS) as [ManualOrderChannel, ...ManualOrderChannel[]],
    ),
    initialStatus: z.enum(MANUAL_ORDER_START_STATUSES).default("NEW"),
    items: z.array(manualOrderItemSchema).default([]),
    delivery: z.object({
      requested: z.boolean().default(false),
      street: optionalText,
      postal: optionalText,
      city: optionalText,
      country: optionalText,
      notes: optionalText,
    }),
    customerRemarks: optionalText,
    designBrief: optionalText,
    internalNote: optionalText,
  })
  .superRefine((v, ctx) => {
    // A new customer needs at least one way to reach them.
    if (v.customer.mode === "new" && !v.customer.email && !v.customer.phone) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Geef minstens een e-mailadres of telefoonnummer op.",
        path: ["customer", "email"],
      });
    }
    if (v.items.length === 0 && !(v.type === "CUSTOM" && v.designBrief)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "Voeg minstens één artikel toe, of kies 'Maatwerk' met een ontwerpbriefing.",
        path: ["items"],
      });
    }
    if (v.delivery.requested && (!v.delivery.street || !v.delivery.city)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Vul straat en gemeente in voor levering (of kies afhaling).",
        path: ["delivery"],
      });
    }
  });

export type ManualOrderInput = z.infer<typeof manualOrderSchema>;
export type ManualOrderItemInput = z.infer<typeof manualOrderItemSchema>;

// ---------------------------------------------------------------------------
// Edit an existing order's lines ("Bestelling bewerken" on the order page).
// Lines with an id update that OrderItem; lines without one are added; items
// missing from the list are removed.
// ---------------------------------------------------------------------------

export const orderItemsUpdateSchema = z.object({
  items: z.array(manualOrderItemSchema.extend({ id: optionalText })),
  note: optionalText,
});

export type OrderItemsUpdateInput = z.infer<typeof orderItemsUpdateSchema>;

// ---------------------------------------------------------------------------
// Custom requests (Aanvragen) entered by hand ("Nieuwe aanvraag").
// ---------------------------------------------------------------------------

const deliverySchema = z.object({
  requested: z.boolean().default(false),
  street: optionalText,
  postal: optionalText,
  city: optionalText,
  country: optionalText,
  notes: optionalText,
});

export const manualRequestSchema = z
  .object({
    customer: customerChoiceSchema,
    channel: z.enum(
      Object.keys(MANUAL_ORDER_CHANNELS) as [ManualOrderChannel, ...ManualOrderChannel[]],
    ),
    title: optionalText,
    description: z.string().trim().min(1, "Beschrijf wat de klant vraagt."),
    customerRemarks: optionalText,
    delivery: deliverySchema,
    internalNote: optionalText,
  })
  .superRefine((v, ctx) => {
    if (v.customer.mode === "new" && !v.customer.email && !v.customer.phone) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Geef minstens een e-mailadres of telefoonnummer op.",
        path: ["customer", "email"],
      });
    }
    if (v.delivery.requested && (!v.delivery.street || !v.delivery.city)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Vul straat en gemeente in voor levering (of kies afhaling).",
        path: ["delivery"],
      });
    }
  });

export type ManualRequestInput = z.infer<typeof manualRequestSchema>;

/** Edit the brief of an existing request (after clarifications). */
export const requestDetailsSchema = z.object({
  title: optionalText,
  description: z.string().trim().min(1, "De omschrijving mag niet leeg zijn."),
  customerRemarks: optionalText,
});

/** Log a note / question / answer in the request timeline. */
export const requestEventSchema = z.object({
  kind: z.enum(LOGGABLE_EVENT_KINDS),
  note: z.string().trim().min(1, "Schrijf iets in het tekstvak.").max(8000),
});

export const requestStatusSchema = z.object({
  status: z.enum(MANUAL_REQUEST_STATUSES as [string, ...string[]]),
  note: optionalText,
});

// ---------------------------------------------------------------------------
// Offer editor. Lines are sent as JSON (dynamic rows). Prices arrive in the
// mode you typed them (incl. or excl. VAT) and are stored incl. VAT, the same
// convention as orders and invoices. Costing inputs are per piece, except
// setupHours which is once for the whole line.
// ---------------------------------------------------------------------------

/** A non-negative decimal typed with a comma or a dot; empty → 0. */
const decimalInput = z
  .union([z.string(), z.number()])
  .nullish()
  .transform((v) => (v == null ? "" : String(v).trim().replace(",", ".")))
  .pipe(
    z
      .string()
      .regex(/^(\d+(\.\d+)?)?$/, "Ongeldig getal (gebruik bv. 1,5).")
      .transform((v) => (v === "" ? 0 : Number(v))),
  );

export const offerLineSchema = z.object({
  description: z.string().trim().min(1, "Elke lijn heeft een omschrijving nodig."),
  quantity: z.coerce.number().int().positive("Aantal moet minstens 1 zijn."),
  price: signedMoneyString,
  vatRate: z
    .string()
    .regex(/^\d{1,2}(\.\d{1,2})?$/, "Ongeldig btw-tarief.")
    .default("21"),
  costing: z
    .object({
      machineId: optionalText,
      machineMinutes: decimalInput,
      labourHours: decimalInput,
      setupHours: decimalInput,
      materials: z
        .array(z.object({ materialId: z.string().min(1), quantity: decimalInput }))
        .default([]),
    })
    .nullish(),
});

export const offerSaveSchema = z.object({
  pricesIncludeVat: z.boolean(),
  validUntil: z
    .string()
    .trim()
    .regex(/^(\d{4}-\d{2}-\d{2})?$/, "Ongeldige datum.")
    .nullish()
    .transform((v) => (v ? v : null)),
  intro: optionalText,
  terms: optionalText,
  lines: z.array(offerLineSchema).min(1, "Een offerte heeft minstens één lijn."),
});

export type OfferSaveInput = z.infer<typeof offerSaveSchema>;
export type OfferLineInput = z.infer<typeof offerLineSchema>;
