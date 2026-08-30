/**
 * Create (or update) an admin user.
 *
 * Usage:
 *   npx tsx scripts/create-admin.ts <email> <password> [name]
 *
 * Example:
 *   npx tsx scripts/create-admin.ts bart@creafluxe.be "a-strong-password" "Bart Helsen"
 *
 * The password is hashed with bcrypt before it is stored — the plaintext is
 * never written to the database. Running it again for the same email updates
 * that user's password (an easy way to reset it).
 */
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  const [, , emailArg, passwordArg, ...nameParts] = process.argv;

  if (!emailArg || !passwordArg) {
    console.error(
      "Usage: npx tsx scripts/create-admin.ts <email> <password> [name]",
    );
    process.exit(1);
  }

  const email = emailArg.toLowerCase().trim();
  const name = nameParts.join(" ").trim() || null;

  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    console.error(`"${email}" does not look like a valid email address.`);
    process.exit(1);
  }
  if (passwordArg.length < 8) {
    console.error("Please choose a password of at least 8 characters.");
    process.exit(1);
  }

  const passwordHash = await bcrypt.hash(passwordArg, 12);

  const user = await prisma.user.upsert({
    where: { email },
    update: { passwordHash, ...(name ? { name } : {}) },
    create: { email, name, passwordHash, role: "ADMIN" },
  });

  console.log(`\n✅  Admin user ready:`);
  console.log(`    id:    ${user.id}`);
  console.log(`    email: ${user.email}`);
  console.log(`    name:  ${user.name ?? "(none)"}`);
  console.log(`    role:  ${user.role}\n`);
  console.log("You can now sign in at /login.\n");
}

main()
  .catch((error) => {
    console.error("Failed to create admin user:", error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
