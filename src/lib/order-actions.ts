"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { manualOrderSchema } from "@/lib/validation";
import {
  createManualOrder,
  ManualOrderError,
} from "@/server/orders/createManualOrder";

// Server action behind "Nieuwe bestelling" (/orders/new). The client form
// posts its whole state as one JSON field ("payload") because the number of
// lines is dynamic; we validate it with Zod like any other input.

export interface ManualOrderFormState {
  error?: string;
}

export async function createManualOrderAction(
  _prev: ManualOrderFormState | undefined,
  formData: FormData,
): Promise<ManualOrderFormState> {
  const session = await auth();
  if (!session?.user?.id) return { error: "Je bent niet (meer) aangemeld." };

  let raw: unknown;
  try {
    raw = JSON.parse(String(formData.get("payload") ?? ""));
  } catch {
    return { error: "Het formulier kon niet gelezen worden. Probeer opnieuw." };
  }

  const parsed = manualOrderSchema.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return { error: first?.message ?? "Controleer de ingevulde gegevens." };
  }

  let orderId: string;
  try {
    ({ orderId } = await createManualOrder(parsed.data, session.user.id));
  } catch (err) {
    if (err instanceof ManualOrderError) return { error: err.message };
    console.error("[manual-order] failed:", err);
    return { error: "De bestelling kon niet opgeslagen worden." };
  }

  revalidatePath("/orders");
  revalidatePath("/customers");
  revalidatePath("/invoices");
  revalidatePath("/");
  // Outside the try/catch: redirect() works by throwing.
  redirect(`/orders/${orderId}`);
}
