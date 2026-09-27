import Link from "next/link";
import { prisma } from "@/lib/db";
import NewRequestForm from "@/components/NewRequestForm";
import type { PickerCustomer } from "@/components/CustomerPicker";

// "Nieuwe aanvraag": enter a custom request by hand for someone who asked you
// directly. It lands in Aanvragen next to the ones from the website's Atelier.

export default async function NewRequestPage({
  searchParams,
}: {
  searchParams: Promise<{ customer?: string }>;
}) {
  const { customer: customerParam } = await searchParams;

  const customers = await prisma.customer.findMany({
    orderBy: { name: "asc" },
    take: 5000,
  });
  const pickerCustomers: PickerCustomer[] = customers.map((c) => ({
    id: c.id,
    name: c.name,
    email: c.email,
    phone: c.phone,
    companyName: c.companyName,
    isBusiness: c.isBusiness,
    vatNumber: c.vatNumber,
    addressStreet: c.addressStreet,
    addressPostal: c.addressPostal,
    addressCity: c.addressCity,
    addressCountry: c.addressCountry,
  }));
  const initialCustomerId = pickerCustomers.some((c) => c.id === customerParam)
    ? customerParam
    : undefined;

  return (
    <div className="page">
      <header className="page-header">
        <Link href="/requests" className="muted small">
          ← Aanvragen
        </Link>
        <h1>Nieuwe aanvraag</h1>
        <p className="muted">
          Voor maatwerk waar iemand je rechtstreeks voor contacteert. Je maakt er daarna een
          offerte van.
        </p>
      </header>

      <NewRequestForm customers={pickerCustomers} initialCustomerId={initialCustomerId} />
    </div>
  );
}
