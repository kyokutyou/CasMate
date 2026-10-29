import { useRef, useState } from 'react';

export function SlimSwitch({ label, checked, disabled, reason, onChange, keepFocus = false }: {
  label: string; checked: boolean; disabled?: boolean; reason?: string;
  onChange(checked: boolean): void | Promise<unknown>;
  keepFocus?: boolean;
}) {
  const pending = useRef(false);
  const [busy, setBusy] = useState(false);
  return <span className="slim-switch-wrap">
    <button type="button" role="switch" aria-label={label} aria-checked={checked}
      className="slim-switch" disabled={!keepFocus && (disabled || busy)} aria-disabled={keepFocus ? Boolean(disabled || busy) : undefined} title={reason}
      onClick={async () => {
        if (pending.current || disabled) return;
        pending.current = true; setBusy(true);
        try { await onChange(!checked); }
        finally { pending.current = false; setBusy(false); }
      }}>
      <span className="switch-rail" aria-hidden="true"><span /></span><span>{checked ? 'オン' : 'オフ'}</span>
    </button>
    {reason && <small className="muted">{reason}</small>}
  </span>;
}
