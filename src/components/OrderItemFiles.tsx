import FileInput from "@/components/FileInput";
import ActionForm, { SubmitButton } from "@/components/ActionForm";
import {
  deleteOrderItemFileAction,
  setFileMasterAction,
  uploadOrderItemFileAction,
} from "@/lib/design-file-actions";
import type { OrderDesignFile } from "@/server/designs/gatherOrderDesigns";

// The design files of one order item: what you open to make it, plus the
// controls to add a file, keep one as a master (so it shows up in the file
// library) or remove a one-off file.

export default function OrderItemFiles({
  orderItemId,
  files,
  uploadEnabled,
}: {
  orderItemId: string;
  files: OrderDesignFile[];
  uploadEnabled: boolean;
}) {
  return (
    <div className="item-files">
      <div className="files files--stacked">
        {files.length === 0 && (
          <span className="muted small">Geen ontwerpbestanden gekoppeld.</span>
        )}
        {files.map((f) => (
          <div key={`${f.source}-${f.id}`} className="file-row">
            <span className="file-chip">
              <span className="file-kind">{f.kind === "MASTER" ? "MASTER" : "UPLOAD"}</span>
              {f.downloadUrl ? (
                <a href={f.downloadUrl} target="_blank" rel="noreferrer">
                  {f.label}
                </a>
              ) : (
                <span title={f.storageKey}>{f.label}</span>
              )}
            </span>

            {f.source === "product" ? (
              <span className="muted small">uit de catalogus</span>
            ) : (
              <span className="inline-actions">
                <ActionForm action={setFileMasterAction} className="inline-actions">
                  <input type="hidden" name="id" value={f.id} />
                  <input type="hidden" name="master" value={f.kind === "MASTER" ? "0" : "1"} />
                  <SubmitButton className="btn-link" pendingLabel="…">
                    {f.kind === "MASTER" ? "Geen master meer" : "Bewaar als master"}
                  </SubmitButton>
                </ActionForm>
                {f.kind !== "MASTER" && (
                  <ActionForm
                    action={deleteOrderItemFileAction}
                    className="inline-actions"
                    confirm="Dit bestand van de bestelling verwijderen?"
                  >
                    <input type="hidden" name="id" value={f.id} />
                    <SubmitButton className="btn-link-danger" pendingLabel="…">
                      Verwijderen
                    </SubmitButton>
                  </ActionForm>
                )}
              </span>
            )}
          </div>
        ))}
      </div>

      {uploadEnabled ? (
        <ActionForm action={uploadOrderItemFileAction} className="inline-form" resetOnSuccess>
          <input type="hidden" name="orderItemId" value={orderItemId} />
          <FileInput name="file" required />
          <input name="label" placeholder="Omschrijving (optioneel)" />
          <label className="check-field">
            <input type="checkbox" name="asMaster" />
            <span>
              Bewaar als masterbestand
              <span className="muted small"> — zodat je het later terugvindt onder Bestanden</span>
            </span>
          </label>
          <SubmitButton className="btn-ghost btn-ghost--dark" pendingLabel="Uploaden…">
            Bestand toevoegen
          </SubmitButton>
        </ActionForm>
      ) : (
        <p className="muted small">
          Bestandsopslag (R2) is niet ingesteld, dus uploaden kan hier nog niet.
        </p>
      )}
    </div>
  );
}
