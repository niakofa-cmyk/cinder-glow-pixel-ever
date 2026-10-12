import { useSession } from "@/store/session";
import { nativeControlProps } from "./native-control";

export function SessionPanel({ onRestore }: { onRestore: () => void }) {
  const s = useSession();
  const buttonClass = "h-11 rounded-md border border-line bg-surface px-3 text-sm disabled:opacity-40";
  return (
    <section aria-label="Local session" className="rounded-md border border-line bg-surface/50 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <button {...nativeControlProps} type="button" className={buttonClass} disabled={!s.program || !!s.busy || s.storageBusy}
          onClick={() => {
            if (s.savedAt && !window.confirm("Replace the saved session in this browser with your current audio and settings?")) return;
            void s.saveLocal();
          }}>Save session</button>
        <button {...nativeControlProps} type="button" className={buttonClass} disabled={!s.savedAt || !!s.busy || s.storageBusy}
          onClick={() => {
            if (!window.confirm("Restore the saved session? Unsaved audio and settings will be replaced.")) return;
            onRestore();
            void s.restoreLocal();
          }}>Restore session</button>
        <button {...nativeControlProps} type="button" className={buttonClass} disabled={s.storageBusy || (!s.savedAt && !s.storageError)}
          onClick={() => {
            if (!window.confirm("Delete the saved session from this browser? Your current audio and settings will remain open.")) return;
            void s.deleteLocal();
          }}>Delete saved session</button>
        <span className="text-xs text-muted">
          {s.savedAt ? `Saved ${new Date(s.savedAt).toLocaleString()}` : "No saved session"}
        </span>
      </div>
      <p className="mt-2 text-xs text-muted">One local save, restored after refresh. Audio stays on this browser and device. Save changes before leaving; browser storage can be cleared or evicted.</p>
      <p role="status" className="mt-1 text-xs text-muted">
        {s.storageBusy ? "Working with local session storage…" : s.storageNotice}
      </p>
      {s.storageError && <p role="alert" className="mt-2 text-sm text-amber">{s.storageError}</p>}
    </section>
  );
}
