import Link from "next/link";
import { prisma } from "@/lib/db";
import ManualOrderForm, {
  type PickerCustomer,
  type PickerProduct,
} from "@/components/ManualOrderForm";

// "Nieuwe bestelling": create an order by hand for a customer who asked you
// directly (phone, e-mail, in person, social media). Pick or create the
// customer, add catalogue products or free lines, and save — it lands in the
// same order list, with a draft invoice, just like a webshop order.

export default async function NewOrderPage({
  searchParams,
}: {
  searchParams: Promise<{ customer?: string }>;
}) {
  const { customer: customerParam } = await searchParams;

  const [products, customers] = await Promise.all([
    prisma.product.findMany({
      where: { active: true },
      include: {
        options: {
          where: { active: true },
          orderBy: [{ sortOrder: "asc" }, { value: "asc" }],
        },
      },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    }),
    prisma.customer.findMany({
      orderBy: { name: "asc" },
      take: 5000,
    }),
  ]);

  // Plain, serialisable props for the client component (no Decimal objects).
  const pickerProducts: PickerProduct[] = products.map((p) => ({
    id: p.id,
    sku: p.sku,
    name: p.name,
    basePrice: p.basePrice.toFixed(2),
    vatRate: p.vatRate.toFixed(0),
    active: p.active,
    options: p.options.map((o) => ({
      type: o.type,
      value: o.value,
      priceDelta: o.priceDelta.toFixed(2),
    })),
  }));

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
        <Link href="/orders" className="muted small">
          ← Bestellingen
        </Link>
        <h1>Nieuwe bestelling</h1>
        <p className="muted">
          Voor klanten die je rechtstreeks contacteren. De bestelling komt in
          dezelfde lijst terecht en krijgt meteen een conceptfactuur.
        </p>
      </header>

      <ManualOrderForm
        products={pickerProducts}
        customers={pickerCustomers}
        initialCustomerId={initialCustomerId}
      />
    </div>
  );
}
