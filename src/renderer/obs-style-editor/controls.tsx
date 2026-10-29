import { useEffect, useId, useState } from 'react';
import type { ReactNode } from 'react';

const adjustmentKeys = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown']);
const numericDraft = (value: number, compact: boolean) => String(compact ? Number(value.toFixed(2)) : value);

interface NumericControlProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  revision?: number;
  onChange: (value: number) => void;
  onBegin?: () => void;
  onEnd?: () => void;
  compact?: boolean;
}

export function NumericControl({ label, value, min, max, step = 1, unit = '', revision = 0, onChange, onBegin, onEnd, compact = false }: NumericControlProps) {
  const id = useId();
  const [draft, setDraft] = useState(() => numericDraft(value, compact));
  const [lastRevision, setLastRevision] = useState(revision);
  useEffect(() => {
    if (lastRevision !== revision || Number(draft) !== value) setDraft(numericDraft(value, compact));
    setLastRevision(revision);
    // Drafts are deliberately retained until the effective value or reset revision changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, revision]);
  const parsed = Number(draft);
  const valid = draft.trim() !== '' && Number.isFinite(parsed) && parsed >= min && parsed <= max;
  return (
    <div className="numeric-control">
      <div className="control-heading"><label htmlFor={id}>{label}</label><span className="control-unit">{unit}</span></div>
      <div className="numeric-inputs">
        <input type="range" min={min} max={max} step={step} value={value} aria-label={`${label} スライダー`}
          onPointerDown={(event) => { onBegin?.(); event.currentTarget.setPointerCapture?.(event.pointerId); }}
          onPointerUp={() => onEnd?.()} onPointerCancel={() => onEnd?.()} onLostPointerCapture={() => onEnd?.()}
          onKeyDown={(event) => { if (adjustmentKeys.has(event.key)) onBegin?.(); }}
          onKeyUp={(event) => { if (adjustmentKeys.has(event.key)) onEnd?.(); }} onBlur={() => onEnd?.()}
          onChange={(event) => { const next = Number(event.currentTarget.value); setDraft(String(next)); onChange(next); }} />
        <input id={id} type={compact ? 'number' : 'text'} min={compact ? min : undefined} max={compact ? max : undefined} step={compact ? step : undefined} inputMode={step < 1 ? 'decimal' : 'numeric'} value={draft}
          aria-invalid={!valid} aria-describedby={`${id}-hint`}
          onChange={(event) => {
            const next = event.currentTarget.value;
            setDraft(next);
            const number = Number(next);
            if (next.trim() !== '' && Number.isFinite(number) && number >= min && number <= max) onChange(number);
          }} />
      </div>
      <small id={`${id}-hint`} className="field-hint field-error">{valid ? '\u00a0' : compact ? `${min}〜${max}${unit}` : `${min}〜${max}${unit}の数値を入力してください。`}</small>
    </div>
  );
}

export function ColorControl({ label, value, onChange, editableHex = false, revision = 0 }: { label: string; value: string; onChange: (value: string) => void; editableHex?: boolean; revision?: number }) {
  const id = useId();
  const [draft, setDraft] = useState(value);
  useEffect(() => { setDraft(value); }, [value, revision]);
  const valid = /^#[0-9a-f]{6}$/i.test(draft);
  return <div className="color-control"><label htmlFor={id}>{label}</label><div className="color-input"><input id={id} type="color" value={value} onChange={(event) => { setDraft(event.currentTarget.value); onChange(event.currentTarget.value); }} />{editableHex ? <input type="text" aria-label={`${label} カラーコード`} value={draft} maxLength={7} spellCheck={false} aria-invalid={!valid} aria-describedby={`${id}-hint`} onChange={event => { const next = event.currentTarget.value; setDraft(next); if (/^#[0-9a-f]{6}$/i.test(next)) onChange(next); }}/> : <span aria-hidden="true">{value.toUpperCase()}</span>}</div>{editableHex && <small id={`${id}-hint`} className="field-hint field-error">{valid ? '\u00a0' : '#RRGGBB（六桁）'}</small>}</div>;
}

export function ToggleControl({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return <label className="toggle-control"><span>{label}</span><span className="toggle-value"><input type="checkbox" role="switch" checked={checked} onChange={(event) => onChange(event.currentTarget.checked)} /><span className="toggle-track" aria-hidden="true" /><span className="toggle-word" aria-hidden="true">{checked ? 'ON' : 'OFF'}</span></span></label>;
}

export function SelectControl({ label, value, children, onChange }: { label: string; value: string; children: ReactNode; onChange: (value: string) => void }) {
  const id = useId();
  return <div className="select-control"><label htmlFor={id}>{label}</label><select id={id} value={value} onChange={(event) => onChange(event.currentTarget.value)}>{children}</select></div>;
}
