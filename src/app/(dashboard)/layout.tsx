import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import SignOutButton from "@/components/SignOutButton";

// Navigation. Phases 0–2b are live; later screens keep their "coming" badge
// (see the blueprint roadmap, doc 07).
const NAV = [
  { href: "/", label: "Dashboard", phase: null },
  { href: "/orders", label: "Bestellingen", phase: null },
  { href: "/invoices", label: "Facturen", phase: null },
  { href: "/customers", label: "Klanten", phase: null },
  { href: "/products", label: "Catalogus", phase: null },
  { href: "/product-cost", label: "Kostprijs", phase: null },
  { href: "/materials", label: "Materialen", phase: null },
  { href: "/machines", label: "Machines", phase: null },
  { href: "/suppliers", label: "Leveranciers", phase: null },
];

export default async function DashboardLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  // Middleware already guards these routes; this is a second, server-side
  // check so a page can never render without a session.
  const session = await auth();
  if (!session?.user) {
    redirect("/login");
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <span className="login-logo">CF</span>
          <div>
            <strong>Creafluxe</strong>
            <span>Administration</span>
          </div>
        </div>

        <nav className="sidebar-nav">
          {NAV.map((item) => (
            <div key={item.href} className="nav-item">
              {item.phase ? (
                <span className="nav-link nav-link--disabled" aria-disabled="true">
                  {item.label}
                  <span className="nav-badge">{item.phase}</span>
                </span>
              ) : (
                <Link href={item.href} className="nav-link">
                  {item.label}
                </Link>
              )}
            </div>
          ))}
        </nav>

        <div className="sidebar-footer">
          <div className="user-chip">
            <span className="user-name">{session.user.name ?? "Admin"}</span>
            <span className="user-email">{session.user.email}</span>
          </div>
          <SignOutButton />
        </div>
      </aside>

      <main className="content">{children}</main>
    </div>
  );
}
