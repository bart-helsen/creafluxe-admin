import { logout } from "@/lib/actions";

export default function SignOutButton() {
  return (
    <form action={logout}>
      <button type="submit" className="btn-ghost">
        Sign out
      </button>
    </form>
  );
}
