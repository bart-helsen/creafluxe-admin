"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { money, toDecimal } from "@/lib/money";

// Server actions behind the machine screens. Each re-checks the session (defence
// in depth on top of the middleware) and revalidates the affected pages.

async function requireUserId(): Promise<string> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Not authenticated");
  return session.user.id;
}

function str(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
}
function optStr(formData: FormData, key: string): string | null {
  const v = str(formData, key);
  return v.length ? v : null;
}

// Money fields round to 2 decimals; the "hours"/"kW" fields keep more precision.
function machineData(formData: FormData) {
  return {
    name: str(formData, "name"),
    description: optStr(formData, "description"),
    purchasePrice: money(str(formData, "purchasePrice") || "0"),
    lifetimeHours: toDecimal(str(formData, "lifetimeHours") || "0"),
    powerKw: toDecimal(str(formData, "powerKw") || "0"),
    maintenancePerYear: money(str(formData, "maintenancePerYear") || "0"),
    usageHoursPerYear: toDecimal(str(formData, "usageHoursPerYear") || "0"),
    notes: optStr(formData, "notes"),
  };
}

export async function createMachineAction(formData: FormData): Promise<void> {
  await requireUserId();
  const data = machineData(formData);
  if (!data.name) throw new Error("Naam is verplicht.");

  const machine = await prisma.machine.create({ data });
  revalidatePath("/machines");
  redirect(`/machines/${machine.id}`);
}

export async function updateMachineAction(formData: FormData): Promise<void> {
  await requireUserId();
  const id = str(formData, "id");
  const data = machineData(formData);
  if (!id || !data.name) throw new Error("Naam is verplicht.");

  await prisma.machine.update({
    where: { id },
    data: { ...data, active: formData.get("active") != null },
  });
  revalidatePath("/machines");
  revalidatePath(`/machines/${id}`);
}
