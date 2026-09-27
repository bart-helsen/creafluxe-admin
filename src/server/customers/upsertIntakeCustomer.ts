import type { Customer } from "@prisma/client";
import { prisma } from "@/lib/db";
import type { IntakeInput } from "@/lib/validation";

/**
 * Website intake: find the customer by e-mail (one customer per address) or
 * create them, refreshing the contact details they just typed. Used for both
 * webshop orders and Atelier requests.
 */
export async function upsertIntakeCustomer(
  input: IntakeInput["customer"],
): Promise<Customer> {
  const email = input.email.toLowerCase();
  const existing = await prisma.customer.findFirst({ where: { email } });
  const data = {
    name: input.name,
    email,
    phone: input.phone ?? undefined,
    isBusiness: input.isBusiness,
    vatNumber: input.vatNumber ?? undefined,
    companyName: input.companyName ?? undefined,
  };
  return existing
    ? prisma.customer.update({ where: { id: existing.id }, data })
    : prisma.customer.create({ data });
}
