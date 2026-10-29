import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { CommentListSettings, CommonComment } from '../../shared/types';
import { messages } from '../messages';
import { CommentItem } from './CommentItem';
import { SettingsCard } from './SettingsCard';
import { SlimSwitch } from './SlimSwitch';
import { CompactFeedback } from './CompactFeedback';
import './comment-list-panel.css';

interface Props {
  settings: CommentListSettings;
  windowVisible: boolean;
  commentsUrl: string;
  saveError?: string;
  windowOperationBusy?: boolean;
  onChange(value: CommentListSettings): void;
  onSave(value: CommentListSettings): Promise<unknown>;
  onToggleWindow(): Promise<unknown>;
  onSuccess(message: string): void;
  onError(message: string): void;
}

const displayFields = [['showSource', 'サービス名'], ['showAuthor', '投稿者名'], ['showContent', '本文']] as const;
const validColor = (value: string) => /^#[\da-f]{8}$/i.test(value);
const validSize = (value: string) => value.trim() !== '' && Number.isFinite(Number(value)) && Number(value) >= 8 && Number(value) <= 200;
const validFont = (value: string) => value.length <= 200;

const previewComments: CommonComment[] = [
  { id: 'preview-1', externalId: 'preview-1', source: 'youtube', authorName: 'サンプル太郎',
    content: [{ type: 'text', text: 'これはコメント一覧の表示サンプルです。' }],
    sequence: 1, receivedAt: '2026-10-18T00:00:00Z', initialHistory: false },
  { id: 'preview-2', externalId: 'preview-2', source: 'twitch', authorName: 'テスト花子',
    content: [{ type: 'text', text: '文字サイズ・フォント・色の変更を確認できます。' }],
    sequence: 2, receivedAt: '2026-10-18T00:00:00Z', initialHistory: false },
  { id: 'preview-3', externalId: 'preview-3', source: 'shitaraba', authorName: 'サンプル次郎',
    content: [{ type: 'text', text: '長いコメントは、このように表示幅に合わせて折り返されます。文字を大きくしたときの読みやすさも確認してみてください。' }],
    sequence: 3, receivedAt: '2026-10-18T00:00:00Z', initialHistory: false },
];

export function CommentListPanel({ settings, windowVisible, commentsUrl, saveError, windowOperationBusy = false, onChange, onSave, onToggleWindow, onSuccess, onError }: Props) {
  const id = useId();
  const [fieldError, setFieldError] = useState('');
  const [inputErrors, setInputErrors] = useState<Record<string, string>>({});
  const [localWindowBusy, setWindowBusy] = useState(false);
  const windowBusy = localWindowBusy || windowOperationBusy;
  const windowPending = useRef(false);
  const reportInput = useCallback((field: string, message: string) => {
    setInputErrors(current => current[field] === message ? current : { ...current, [field]: message });
  }, []);
  const save = (next: CommentListSettings) => onSave(next).catch(() => undefined);
  const toggleField = (key: typeof displayFields[number][0], checked: boolean) => {
    const next = { ...settings, [key]: checked };
    if (!displayFields.some(([field]) => next[field])) {
      setFieldError('少なくとも1項目をオンにしてください。'); return;
    }
    setFieldError(''); return save(next);
  };
  const toggleWindow = async () => {
    if (windowPending.current || windowOperationBusy) return;
    windowPending.current = true; setWindowBusy(true);
    const wasVisible = windowVisible;
    try {
      await onToggleWindow();
      onSuccess(wasVisible ? messages.commentListWindowHidden : messages.commentListWindowShown);
    } catch (error) {
      onError(error instanceof Error ? error.message : 'コメント一覧ウィンドウを操作できませんでした。');
    } finally {
      windowPending.current = false; setWindowBusy(false);
    }
  };
  const samples = settings.stackDirection === 'newestTop' ? [...previewComments].reverse() : previewComments;

  return <SettingsCard cardId="commentList" title="コメント一覧" eyebrow="COMMENT LIST" className="comment-list-panel"
    saveError={saveError} navigationWarning={[fieldError, ...Object.values(inputErrors)].filter(Boolean).join(' ')}>
    <section className="list-window-actions" aria-label="コメント一覧ウィンドウの操作">
      <div><h3>独立ウィンドウ</h3><p className="list-window-state" role="status">{windowVisible ? '表示中' : '非表示'}</p></div>
      <div className="list-window-buttons">
        <button type="button" className="list-window-toggle" aria-pressed={windowVisible} aria-busy={windowBusy} aria-disabled={windowBusy}
          aria-label={windowVisible ? '非表示にする' : 'ウィンドウを開く'} onClick={() => void toggleWindow()}>
          {windowBusy ? '処理中…' : windowVisible ? '非表示にする' : 'ウィンドウを開く'}
        </button>
        <a className="list-browser-link" href={commentsUrl} target="_blank" rel="noopener noreferrer">ブラウザで開く <span aria-hidden="true">↗</span></a>
      </div>
    </section>
    <div className="list-setting-grid">
      <section className="list-setting-section" aria-labelledby={`${id}-fields`}>
        <h3 id={`${id}-fields`}>表示する項目</h3>
        <div className="list-display-fields" role="group" aria-labelledby={`${id}-fields`} aria-describedby={`${id}-fields-help`}>
          {displayFields.map(([key, label]) => <div className="list-switch-row" key={key}><span>{label}</span>
            <SlimSwitch label={label} checked={settings[key]} keepFocus onChange={checked => toggleField(key, checked)} />
          </div>)}
        </div>
        <CompactFeedback id={`${id}-fields-help`} className={`list-input-help${fieldError ? ' field-error' : ''}`} role="status" reserve={['少なくとも1項目を表示します。', '少なくとも1項目をオンにしてください。']}>{fieldError || '少なくとも1項目を表示します。'}</CompactFeedback>
      </section>
      <section className="list-setting-section" aria-labelledby={`${id}-direction`}>
        <h3 id={`${id}-direction`}>積み上げ方向</h3>
        <div className="list-directions" role="group" aria-labelledby={`${id}-direction`}>
          {([['newestBottom', '新着を下', '☰ ↓'], ['newestTop', '新着を上', '↑ ☰']] as const).map(([value, label, icon]) =>
            <button type="button" className="secondary" key={value} aria-pressed={settings.stackDirection === value} onClick={() => void save({ ...settings, stackDirection: value })}>
              <span className="list-direction-icon" aria-hidden="true">{icon}</span>{label}
            </button>)}
        </div>
        <p className="list-input-help">新しいコメントが追加される側を選びます。</p>
      </section>
    </div>
    <section className="list-setting-section" aria-labelledby={`${id}-appearance`}>
      <h3 id={`${id}-appearance`}>文字と色</h3>
      <div className="list-setting-grid">
        <AppearanceField field="fontSizePx" label="文字サイズ（px）" value={String(settings.fontSizePx)} kind="size" valid={validSize}
          help="8〜200pxで設定できます。" error="8〜200の範囲で入力してください。" onError={reportInput}
          onChange={text => onChange({ ...settings, fontSizePx: Number(text) })} />
        <AppearanceField field="fontFamily" label="フォント" value={settings.fontFamily} kind="font" valid={validFont}
          help="表示する端末にあるフォント名を入力します。" error="フォント名は200文字以内で入力してください。" onError={reportInput}
          onChange={fontFamily => onChange({ ...settings, fontFamily })} />
        {([['textColor', '文字色'], ['backgroundColor', '背景色']] as const).map(([key, label]) =>
          <AppearanceField key={key} field={key} label={label} value={settings[key]} kind="color" valid={validColor}
            help="#RRGGBBAA形式。末尾2桁は不透明度です。" error="#と8桁の16進数で入力してください。" onError={reportInput}
            onChange={value => onChange({ ...settings, [key]: value })} />)}
      </div>
    </section>
    <section className="list-preview-frame" aria-label="コメント一覧のプレビュー">
        <div className="list-preview-heading"><span>プレビュー</span><span>テスト文章</span></div>
        <div className="list-comment-preview" tabIndex={0} aria-label="コメントの表示見本">
          {samples.map(comment => <CommentItem key={comment.id} comment={comment} fields={settings} appearance={settings} />)}
        </div>
    </section>
  </SettingsCard>;
}

function AppearanceField({ field, label, value, kind, valid, help, error, onError, onChange }: {
  field: string; label: string; value: string; kind: 'size' | 'font' | 'color';
  valid(value: string): boolean; help: string; error: string;
  onError(field: string, message: string): void; onChange(value: string): void;
}) {
  const id = useId();
  const [edit, setEdit] = useState<{ base: string; text: string } | null>(null);
  // Incoming settings refresh valid fields, but never erase an unfinished invalid input.
  const text = edit && (edit.base === value || !valid(edit.text)) ? edit.text : value;
  const invalid = !valid(text);
  useEffect(() => { onError(field, invalid ? `${label}：${error}` : ''); }, [field, invalid, label, error, onError]);
  const change = (next: string) => {
    setEdit({ base: value, text: next });
    if (valid(next)) onChange(next);
  };
  return <div className="list-appearance-field">
    <label htmlFor={id}>{label}</label>
    <div className={kind === 'size' ? 'list-size-inputs' : kind === 'color' ? 'list-color-inputs' : undefined}>
      {kind === 'size' && <input type="range" aria-label="文字サイズのスライダー" min={8} max={200} step={1} value={Number(value)} onChange={event => change(event.target.value)} />}
      {kind === 'color' && <input type="color" aria-label={`${label}を選択`} value={value.slice(0, 7)} disabled={invalid} onChange={event => change(event.target.value + value.slice(7))} />}
      <input id={id} aria-label={kind === 'color' ? `${label}（#RRGGBBAA）` : label} type={kind === 'size' ? 'number' : 'text'}
        min={kind === 'size' ? 8 : undefined} max={kind === 'size' ? 200 : undefined} step={kind === 'size' ? 'any' : undefined}
        list={kind === 'font' ? `${id}-fonts` : undefined} value={text} aria-invalid={invalid} aria-describedby={`${id}-help`}
        spellCheck={false} onChange={event => change(event.target.value)} />
    </div>
    {kind === 'color' && <label className="list-opacity-control">不透明度 <output>{Math.round(parseInt(value.slice(7), 16) / 255 * 100)}%</output><input type="range" aria-label={`${label}の不透明度`} min={0} max={100} step={1} value={Math.round(parseInt(value.slice(7), 16) / 255 * 100)} disabled={invalid} onChange={event => change(value.slice(0, 7) + Math.round(Number(event.target.value) / 100 * 255).toString(16).padStart(2, '0'))} /></label>}
    {kind === 'font' && <datalist id={`${id}-fonts`}><option value="Yu Gothic UI" /><option value="Meiryo" /><option value="Segoe UI" /></datalist>}
    <CompactFeedback id={`${id}-help`} className={`list-input-help${invalid ? ' field-error' : ''}`} role="status" reserve={[help, error]}>{invalid ? error : help}</CompactFeedback>
  </div>;
}
