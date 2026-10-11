"use client";

import { useEffect, useRef, useState } from "react";

// A styled replacement for the browser's grey "Choose File" control. The real
// <input type="file"> stays in place (invisible, covering the whole picker) so
// form submission, `required` validation and form resets keep working, but the
// text is ours and therefore in Dutch.

export default function FileInput({
  name,
  accept,
  required,
  multiple,
  buttonLabel = "Kies bestand",
  emptyLabel = "Nog geen bestand gekozen",
}: {
  name: string;
  accept?: string;
  required?: boolean;
  multiple?: boolean;
  buttonLabel?: string;
  emptyLabel?: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [label, setLabel] = useState<string | null>(null);

  const sync = () => {
    const files = ref.current?.files;
    if (!files || files.length === 0) setLabel(null);
    else if (files.length === 1) setLabel(files[0].name);
    else setLabel(`${files.length} bestanden gekozen`);
  };

  // Forms are reset after a successful upload; clear the shown name with them.
  useEffect(() => {
    const form = ref.current?.form;
    if (!form) return;
    const onReset = () => setTimeout(sync, 0);
    form.addEventListener("reset", onReset);
    return () => form.removeEventListener("reset", onReset);
  }, []);

  return (
    <span
      className={`file-picker${label ? " has-file" : ""}`}
      onClick={() => ref.current?.click()}
    >
      <input
        ref={ref}
        type="file"
        name={name}
        accept={accept}
        required={required}
        multiple={multiple}
        tabIndex={0}
        onChange={sync}
      />
      <span className="file-picker-button">{buttonLabel}</span>
      <span className="file-picker-name">{label ?? emptyLabel}</span>
    </span>
  );
}
