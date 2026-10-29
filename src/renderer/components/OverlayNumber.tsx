import { useEffect, useId, useState } from 'react';
import { CompactFeedback } from './CompactFeedback';

export function OverlayNumber({ field, label, unit, min, max, value, onChange, onError }: {
  field: string; label: string; unit: string; min: number; max: number; value: number;
  onChange(value: number): void; onError(field: string, error: string): void;
}) {
  const id = useId(); const [edit, setEdit] = useState<{ base: number; text: string }>();
  const valid = (text: string) => text.trim() !== '' && Number.isFinite(Number(text)) && Number(text) >= min && Number(text) <= max;
  const text = edit && (edit.base === value || !valid(edit.text)) ? edit.text : String(value);
  const invalid = !valid(text); const error = `${min}〜${max}の範囲で入力してください。`;
  useEffect(() => { onError(field, invalid ? `${label}：${error}` : ''); }, [field, label, invalid, error, onError]);
  const range = `${min}〜${max} ${unit}`;
  const inline = field === 'singleDurationSeconds' || field === 'displayDurationSeconds';
  const hint = inline ? `(${range})` : range;
  return <div className="overlay-input"><label htmlFor={id}>{label}（{unit}）</label><div className={inline ? 'overlay-single-number-line' : undefined}><div className="overlay-number-unit"><input id={id} type="number" min={min} max={max} step="any" value={text} aria-invalid={invalid} aria-describedby={`${id}-help`} onChange={event => { const next = event.target.value; setEdit({ base: value, text: next }); if (valid(next)) onChange(Number(next)); }}/><span>{unit}</span></div><CompactFeedback id={`${id}-help`} className={`overlay-input-help${invalid ? ' field-error' : ''}`} role="status" reserve={[hint, error]}>{invalid ? error : hint}</CompactFeedback></div></div>;
}
