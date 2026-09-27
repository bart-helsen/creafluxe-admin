"use client";

import { useActionState, useEffect, useRef } from "react";
import { useFormStatus } from "react-dom";

// A small wrapper so plain server-rendered forms (on the request and offer
// pages) can show a friendly error or confirmation from their server action,
// instead of crashing to an error page. The action returns { error?, success? }.

export interface ActionState {
  error?: string;
  success?: string;
}

export type FormAction = (
  prev: ActionState | undefined,
  formData: FormData,
) => Promise<ActionState>;

export default function ActionForm({
  action,
  className,
  children,
  resetOnSuccess = false,
  confirm,
}: {
  action: FormAction;
  className?: string;
  children: React.ReactNode;
  /** Clear the fields after a successful submit (e.g. a timeline note). */
  resetOnSuccess?: boolean;
  /** Ask for confirmation first (for actions that are hard to undo). */
  confirm?: string;
}) {
  const [state, formAction] = useActionState<ActionState | undefined, FormData>(
    action,
    undefined,
  );
  const ref = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (resetOnSuccess && state?.success) ref.current?.reset();
  }, [state, resetOnSuccess]);

  return (
    <form
      ref={ref}
      action={formAction}
      className={className}
      onSubmit={(e) => {
        if (confirm && !window.confirm(confirm)) e.preventDefault();
      }}
    >
      {children}
      {state?.error && (
        <p className="form-error" role="alert">
          {state.error}
        </p>
      )}
      {state?.success && (
        <p className="form-success" role="status">
          {state.success}
        </p>
      )}
    </form>
  );
}

/** Submit button that shows it's busy while the action runs. */
export function SubmitButton({
  children,
  pendingLabel,
  className = "btn-primary",
  name,
  value,
}: {
  children: React.ReactNode;
  pendingLabel?: string;
  className?: string;
  name?: string;
  value?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={className} disabled={pending} name={name} value={value}>
      {pending ? (pendingLabel ?? "Bezig…") : children}
    </button>
  );
}
