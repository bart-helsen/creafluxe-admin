/**
 * Seed a small demo catalogue and a sample order so you can see the whole
 * Phase 1 flow (order → draft invoice → notification) in the dashboard.
 *
 * Usage:  npx tsx scripts/seed-demo.ts
 *
 * Safe to re-run: products are upserted by sku; each run posts one new demo
 * order. Use ONLY against a development database.
 */
import { PrismaClient } from "@prisma/client";
import { createOrder } from "@/server/orders/createOrder";

const prisma = new PrismaClient();

async function main() {
  // --- Demo catalogue --------------------------------------------------------
  await prisma.product.upsert({
    where: { sku: "HEUP-LEER" },
    update: {},
    create: {
      sku: "HEUP-LEER",
      name: "Heup flacon (leer)",
      basePrice: "12.00",
      vatRate: "21.00",
      filter: "Flacons",
      options: {
        create: [
          { type: "DESIGN", value: "Hert", sortOrder: 0 },
          { type: "DESIGN", value: "Leeuw", sortOrder: 1 },
        ],
      },
    },
  });

  await prisma.product.upsert({
    where: { sku: "HEUP-METAAL" },
    update: {},
    create: {
      sku: "HEUP-METAAL",
      name: "Heup flacon (metaal)",
      basePrice: "14.00",
      vatRate: "21.00",
      filter: "Flacons",
      options: {
        create: [
          { type: "DESIGN", value: "Hert", sortOrder: 0 },
          { type: "DESIGN", value: "Leeuw", sortOrder: 1 },
        ],
      },
    },
  });

  // --- Demo order through the real intake path -------------------------------
  const result = await createOrder({
    type: "WEBSHOP",
    clientRef: `demo-${Date.now()}`,
    customer: {
      name: "Jan Peeters",
      email: "jan.peeters@example.be",
      phone: "+32 470 00 00 00",
      isBusiness: false,
      vatNumber: null,
      companyName: null,
    },
    delivery: {
      requested: true,
      street: "Dorpsstraat 1",
      postal: "2000",
      city: "Antwerpen",
      country: "België",
      notes: "Bel bij aankomst",
    },
    customerRemarks: "Graag voor kerst",
    designBrief: null,
    items: [
      {
        sku: "HEUP-LEER",
        name: "Heup flacon (leer)",
        unitPrice: "99.99", // deliberately wrong → gets re-priced to 12.00
        quantity: 2,
        material: null,
        size: null,
        style: null,
        design: "Hert",
        remarks: "Initialen J.P.",
        uploadKeys: [],
      },
      {
        sku: null,
        name: "Custom gravure op maat",
        unitPrice: "35.00",
        quantity: 1,
        material: null,
        size: null,
        style: null,
        design: null,
        remarks: "Eigen logo meegestuurd",
        uploadKeys: [],
      },
    ],
  });

  console.log(
    `\n✅  Demo-bestelling #${result.orderNumber} aangemaakt (id ${result.orderId}).`,
  );
  console.log("    Open het dashboard om de bestelling en concept-factuur te zien.\n");
}

main()
  .catch((err) => {
    console.error("Seed mislukt:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
