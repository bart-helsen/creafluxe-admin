import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Creafluxe Admin",
    template: "%s · Creafluxe Admin",
  },
  description: "Creafluxe administration software.",
  robots: { index: false, follow: false },
  // Admin-specific tab icon: the Creafluxe "C" with a gear badge, so it is
  // distinguishable from the public website (which uses the plain logo).
  icons: {
    icon: [{ url: "/admin-favicon.ico", sizes: "any" }, { url: "/admin-icon.png", type: "image/png", sizes: "512x512" }],
    apple: "/admin-icon.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="nl">
      <body>{children}</body>
    </html>
  );
}
