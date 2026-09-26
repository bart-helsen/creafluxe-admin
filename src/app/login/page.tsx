import type { Metadata } from "next";
import LoginForm from "@/components/LoginForm";

export const metadata: Metadata = {
  title: "Sign in · Creafluxe Admin",
};

export default function LoginPage() {
  return (
    <main className="login-shell">
      <div className="login-card">
        <div className="login-brand">
          <img src="/logo-mark.png" alt="Creafluxe" className="login-logo" />
          <div>
            <h1>Creafluxe</h1>
            <p>Administration</p>
          </div>
        </div>
        <LoginForm />
      </div>
      <p className="login-footnote">Internal back office — authorised users only.</p>
    </main>
  );
}
