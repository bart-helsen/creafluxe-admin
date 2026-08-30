import type { DefaultSession } from "next-auth";

// Module augmentation so TypeScript knows about the extra fields (`id`, `role`)
// we put on the session user and the JWT in `auth.ts`.
declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      role: string;
    } & DefaultSession["user"];
  }

  interface User {
    role?: string;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id?: string;
    role?: string;
  }
}
