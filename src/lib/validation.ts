import { z } from "zod";

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
