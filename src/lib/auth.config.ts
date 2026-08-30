import type { NextAuthConfig } from "next-auth";

// Edge-safe Auth.js configuration.
//
// This file is imported by BOTH the middleware (which runs in the Edge runtime)
// and the full auth setup in `auth.ts`. It therefore must NOT import anything
// that only works in Node.js — no Prisma, no bcryptjs. The provider list here
// is intentionally empty; the real Credentials provider (which needs Prisma +
// bcrypt) is added in `auth.ts`, which only runs in the Node runtime.
//
// The `authorized` callback is where route protection lives: the middleware
// calls it for every matched request to decide whether to allow it.
export const authConfig = {
  pages: {
    signIn: "/login",
  },
  session: {
    strategy: "jwt",
  },
  providers: [],
  callbacks: {
    authorized({ auth, request: { nextUrl } }) {
      const isLoggedIn = !!auth?.user;
      const { pathname } = nextUrl;

      // Auth.js internal routes must always be reachable.
      if (pathname.startsWith("/api/auth")) return true;

      // The login page is public. If already logged in, bounce to the dashboard.
      if (pathname === "/login") {
        if (isLoggedIn) return Response.redirect(new URL("/", nextUrl));
        return true;
      }

      // Everything else requires a session. Returning false makes Auth.js
      // redirect to the configured signIn page (/login).
      return isLoggedIn;
    },
  },
} satisfies NextAuthConfig;

export default authConfig;
