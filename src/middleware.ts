import NextAuth from "next-auth";
import { authConfig } from "@/lib/auth.config";

// Auth.js's `auth` doubles as the middleware function. Exporting it as the
// DEFAULT export is the form Next.js reliably detects during a production
// build (a destructured named export is not recognised by the build's static
// analysis, even though it works in `next dev`).
//
// This uses ONLY the edge-safe config (no Prisma / bcrypt), so it runs in the
// Edge runtime; the route-level decision lives in
// `authConfig.callbacks.authorized`.
const { auth } = NextAuth(authConfig);

export default auth;

export const config = {
  // Run on every route except Next.js internals and static assets.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
