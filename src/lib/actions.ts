"use server";

import { AuthError } from "next-auth";
import { signIn, signOut } from "@/lib/auth";

// Server action used by the login form. Returns an error string to display,
// or redirects to the dashboard on success (the redirect is thrown internally
// by Auth.js and must be allowed to propagate).
export async function authenticate(
  _prevState: string | undefined,
  formData: FormData,
): Promise<string | undefined> {
  try {
    await signIn("credentials", {
      email: formData.get("email"),
      password: formData.get("password"),
      redirectTo: "/",
    });
  } catch (error) {
    if (error instanceof AuthError) {
      switch (error.type) {
        case "CredentialsSignin":
          return "Invalid email or password.";
        default:
          return "Something went wrong. Please try again.";
      }
    }
    // Re-throw the Next.js redirect (and anything else) so navigation works.
    throw error;
  }
}

export async function logout() {
  await signOut({ redirectTo: "/login" });
}
