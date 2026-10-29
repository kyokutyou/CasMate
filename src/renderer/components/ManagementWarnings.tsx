import { useLayoutEffect, useRef, useState } from 'react';

export interface ManagementWarningItem {
  key: string;
  message: string;
  onSelect?: (entry: HTMLButtonElement) => void;
  onAcknowledge?: () => Promise<void>;
}

export function ManagementWarnings({ items }: { items: ManagementWarningItem[] }) {
  const [opened, setOpened] = useState(false);
  const [acknowledging, setAcknowledging] = useState<string | null>(null);
  const pending = useRef(false);
  const entry = useRef<HTMLButtonElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const close = (restoreFocus = true) => {
    dialog.current?.close(); setOpened(false);
    if (restoreFocus) entry.current?.focus();
  };
  useLayoutEffect(() => {
    if (opened && !dialog.current?.contains(document.activeElement)) closeButton.current?.focus();
  }, [opened, items]);
  return <>
    <button ref={entry} id="management-warning-entry" className="management-warning-count" data-warning={items.length > 0}
      aria-haspopup="dialog" aria-expanded={opened} aria-controls="management-warning-dialog"
      onClick={() => { dialog.current?.showModal(); setOpened(true); }}>
      <span aria-hidden="true">⚠ </span><span aria-live="polite" aria-atomic="true">要確認 {items.length}件</span>
    </button>
    <dialog ref={dialog} id="management-warning-dialog" className="management-warning-dialog" aria-labelledby="management-warning-title"
      onCancel={event => { event.preventDefault(); close(); }} onClose={() => setOpened(false)}
      onKeyDown={event => {
        if (event.key !== 'Tab') return;
        const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), [tabindex="0"]'));
        const first = controls[0]; const last = controls.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }}>
      <div className="management-warning-heading"><h2 id="management-warning-title">要確認事項（{items.length}件）</h2>
        <button ref={closeButton} type="button" autoFocus onClick={() => close()}>閉じる</button></div>
      <div className="management-warning-body" tabIndex={0} aria-label="要確認事項の一覧">
        {items.length === 0 ? <p>現在、要確認事項はありません。</p> : <ul className="management-warnings">
          {items.map(item => <li key={item.key} className={item.onAcknowledge ? 'management-update-notice' : undefined}>{item.onSelect ? <button id={item.key} onClick={() => {
            close(false); if (entry.current) item.onSelect?.(entry.current);
          }}>{item.message} <span aria-hidden="true">›</span></button> : <p>{item.message}</p>}
            {item.onAcknowledge && <button type="button" disabled={acknowledging !== null}
              aria-busy={acknowledging === item.key} onClick={async () => {
                if (pending.current) return;
                pending.current = true; setAcknowledging(item.key);
                try { await item.onAcknowledge?.(); }
                finally { pending.current = false; setAcknowledging(null); }
              }}>案内を確認した</button>}
          </li>)}
        </ul>}
      </div>
    </dialog>
  </>;
}
