import { useEffect, useState } from 'react';

/** The game's own confirmation dialog, in place of the browser's confirm(). */
interface Ask {
  title: string;
  text: string;
  ok: string;
  cancel: string;
  danger: boolean;
  done: (yes: boolean) => void;
}

let current: Ask | null = null;
const listeners = new Set<(a: Ask | null) => void>();

function show(a: Ask | null): void {
  current = a;
  for (const l of listeners) l(a);
}

export function askConfirm(opts: { title: string; text: string; ok?: string; cancel?: string; danger?: boolean }): Promise<boolean> {
  current?.done(false);
  return new Promise((resolve) => {
    show({
      title: opts.title,
      text: opts.text,
      ok: opts.ok ?? 'Yes',
      cancel: opts.cancel ?? 'Cancel',
      danger: opts.danger ?? false,
      done: (yes) => {
        show(null);
        resolve(yes);
      },
    });
  });
}

export function Dialog() {
  const [ask, setAsk] = useState<Ask | null>(current);
  useEffect(() => {
    listeners.add(setAsk);
    return () => void listeners.delete(setAsk);
  }, []);
  useEffect(() => {
    if (!ask) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') ask.done(false);
      else if (e.key === 'Enter') ask.done(true);
      else return;
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [ask]);
  if (!ask) return null;
  return (
    <div className="modal-back dialog-back" onClick={() => ask.done(false)}>
      <div className="modal dialog" role="alertdialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <div className="modal-kicker">{ask.title}</div>
        <p className="event-text">{ask.text}</p>
        <div className="dialog-actions">
          <button onClick={() => ask.done(false)}>{ask.cancel}</button>
          <button className={ask.danger ? 'danger' : 'primary'} autoFocus onClick={() => ask.done(true)}>
            {ask.ok}
          </button>
        </div>
      </div>
    </div>
  );
}
