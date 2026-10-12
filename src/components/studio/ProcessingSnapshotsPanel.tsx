import { useEffect, useRef, useState } from "react";
import { useSession } from "@/store/session";
import { nativeControlProps } from "./native-control";
import { MAX_PROCESSING_SNAPSHOTS } from "@/store/processing-snapshots";

export function ProcessingSnapshotsPanel() {
  const session = useSession();
  const bank = session.processingBank;
  const [name, setName] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { setName(""); setEditing(null); }, [session.program]);
  const current = JSON.stringify(session.params);
  const disabled = !session.program || session.storageBusy;
  const button = "h-11 rounded-md bg-bg px-3 text-sm disabled:opacity-40";
  return <section aria-label="Processing snapshots" className="rounded-lg border border-line bg-surface p-4">
    <h2 className="text-sm font-medium">Named snapshots &amp; A/B</h2>
    <p className="mt-1 text-sm text-muted">Capture settings, not audio. Recall selects Processed and keeps your monitor and loudness-match choice. Switching uses the normal renderer or live engine—not instant, blind or sample-aligned A/B.</p>
    <p className="mt-1 text-xs text-muted">Snapshots belong to this program. Save session to keep them after refresh. Loading a new program clears them.</p>
    <form className="mt-3 flex flex-wrap items-end gap-2" onSubmit={event => {
      event.preventDefault();
      const ok = editing ? session.renameProcessing(editing, name) : session.captureProcessing(name);
      if (ok) { setName(""); setEditing(null); }
    }}>
      <label className="flex min-w-0 flex-1 flex-col gap-1 text-xs text-muted">Snapshot name
        <input {...nativeControlProps} ref={input} type="text" value={name} required maxLength={80} disabled={disabled}
          placeholder="e.g. Clean baseline" onChange={event => setName(event.target.value)}
          className="h-11 rounded-md border border-line bg-bg px-3 text-sm text-fg" />
      </label>
      <button {...nativeControlProps} type="submit" className={button} disabled={disabled || (!editing && bank.entries.length >= MAX_PROCESSING_SNAPSHOTS)}>
        {editing ? "Save snapshot name" : "Capture snapshot"}
      </button>
      {editing && <button type="button" className={button} onClick={() => { setEditing(null); setName(""); }}>Cancel rename</button>}
    </form>
    {session.snapshotError && <p role="alert" className="mt-2 text-sm text-amber">{session.snapshotError}</p>}
    <div className="mt-3 flex flex-wrap items-end gap-3">
      {(["a", "b"] as const).map(slot => {
        const id = slot === "a" ? bank.aId : bank.bId;
        return <div key={slot} className="flex min-w-0 max-w-full flex-wrap items-end gap-2">
          <label className="flex min-w-0 max-w-full flex-col gap-1 text-xs text-muted">Snapshot {slot.toUpperCase()}
            <select {...nativeControlProps} value={id ?? ""} disabled={disabled} className="h-11 max-w-full rounded-md bg-bg px-2 text-sm text-fg"
              onChange={event => session.assignProcessing(slot, event.target.value || null)}>
              <option value="">Not assigned</option>
              {bank.entries.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </label>
          <button {...nativeControlProps} type="button" className={button} disabled={disabled || !id} onClick={() => id && session.recallProcessing(id)}>Recall {slot.toUpperCase()}</button>
        </div>;
      })}
    </div>
    <ul className="mt-3 space-y-2">
      {bank.entries.map(s => <li key={s.id} className="flex flex-wrap items-center gap-2 rounded-md border border-line p-2">
        <span className="min-w-0 flex-1 break-words text-sm">{s.name}
          {JSON.stringify(s.params) === current && <span className="ml-2 text-xs text-amber">Matches controls</span>}
        </span>
        <button type="button" className={button} disabled={disabled} aria-label={`Recall snapshot ${s.name}`} onClick={() => session.recallProcessing(s.id)}>Recall</button>
        <button type="button" className={button} disabled={disabled} aria-label={`Rename snapshot ${s.name}`} onClick={() => {
          setName(s.name); setEditing(s.id); input.current?.focus();
        }}>Rename</button>
        <button type="button" className={button} disabled={disabled} aria-label={`Delete snapshot ${s.name}`} onClick={() => {
          if (window.confirm(`Delete processing snapshot "${s.name}"? Current settings and original audio stay unchanged.`)) {
            session.deleteProcessing(s.id);
            if (editing === s.id) { setEditing(null); setName(""); }
          }
        }}>Delete</button>
      </li>)}
    </ul>
    <p className="mt-2 text-xs text-muted">{bank.entries.length}/{MAX_PROCESSING_SNAPSHOTS} snapshots. Captures, names and slot assignments do not change sound; recalls are undoable.</p>
  </section>;
}
