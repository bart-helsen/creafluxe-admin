import NextAuth from "next-auth";
import { authConfig } from "@/lib/auth.config";

// Protect the whole app with Auth.js. This uses ONLY the edge-safe config
// (no Prisma / bcrypt), so it can run in the Edge runtime. The route-level
// decision lives in `authConfig.callbacks.authorized`.
export const { auth: middleware } = NextAuth(authConfig);

export const config = {
  // Run on every route except Next.js internals and static assets.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
