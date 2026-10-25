"use client";

import { useActionState, useRef, useState } from "react";
import { SubmitButton, type ActionState } from "@/components/ActionForm";
import { uploadPurchaseInvoicesAction } from "@/lib/purchase-actions";

// Capture a purchase invoice the moment it arrives: drop PDFs on the page,
// pick files, or take a photo of a paper invoice with the phone camera. Each
// file becomes its own invoice in "Te controleren". Dropped files are moved
// into the real <input> (via DataTransfer) so the form submits them normally.

const ACCEPT = "application/pdf,image/jpeg,image/png,image/webp";

export default function PurchaseUpload({ storageReady }: { storageReady: boolean }) {
  const [state, formAction] = useActionState<ActionState | undefined, FormData>(
    uploadPurchaseInvoicesAction,
    undefined,
  );
  const filesRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const [names, setNames] = useState<string[]>([]);
  const [dragging, setDragging] = useState(false);

  const sync = () => {
    const all = [...(filesRef.current?.files ?? []), ...(cameraRef.current?.files ?? [])];
    setNames(all.map((f) => f.name));
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    if (!filesRef.current || e.dataTransfer.files.length === 0) return;
    const dt = new DataTransfer();
    for (const f of filesRef.current.files ?? []) dt.items.add(f);
    for (const f of e.dataTransfer.files) dt.items.add(f);
    filesRef.current.files = dt.files;
    sync();
  };

  return (
    <div className="stack-form">
      <form action={formAction} className="stack-form">
        <div
          className={`dropzone${dragging ? " dropzone--active" : ""}`}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
        >
          <p className="dropzone-title">Sleep facturen hierheen</p>
          <p className="muted small">PDF of foto (JPG, PNG, WebP) · max. 10 MB per bestand</p>
          <div className="dropzone-buttons">
            <button
              type="button"
              className="btn-primary"
              onClick={() => cameraRef.current?.click()}
              disabled={!storageReady}
            >
              Foto maken
            </button>
            <button
              type="button"
              className="btn-ghost btn-ghost--dark"
              onClick={() => filesRef.current?.click()}
              disabled={!storageReady}
            >
              Bestand kiezen
            </button>
          </div>
          <input
            ref={filesRef}
            type="file"
            name="files"
            accept={ACCEPT}
            multiple
            hidden
            onChange={sync}
          />
          <input
            ref={cameraRef}
            type="file"
            name="files"
            accept="image/*"
            capture="environment"
            hidden
            onChange={sync}
          />
          {names.length > 0 && (
            <ul className="plain-list small dropzone-files">
              {names.map((n, i) => (
                <li key={`${n}-${i}`}>📄 {n}</li>
              ))}
            </ul>
          )}
        </div>

        {names.length > 0 && (
          <SubmitButton pendingLabel="Uploaden en lezen…">
            {names.length === 1 ? "Uploaden" : `${names.length} facturen uploaden`}
          </SubmitButton>
        )}
        {state?.error && (
          <p className="form-error" role="alert">
            {state.error}
          </p>
        )}
      </form>

      <form action={formAction}>
        <input type="hidden" name="mode" value="manual" />
        <SubmitButton className="btn-link" pendingLabel="Aanmaken…">
          Zonder bestand invoeren
        </SubmitButton>
      </form>
    </div>
  );
}
