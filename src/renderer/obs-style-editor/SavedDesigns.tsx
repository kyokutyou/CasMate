import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { ObsCommentDesign, ObsSpeechDesign } from '../../shared/obs-design';
import type { SavedObsDesignCollection } from '../../shared/saved-obs-designs';
import { savedObsDesignLimit } from '../../shared/saved-obs-designs';
import type { Target } from './model';
import { DesignThumbnail } from './PresetCards';

export type SavedDesignOperation = { kind: 'add'; body: { id: string; design: ObsCommentDesign | ObsSpeechDesign } } | { kind: 'remove'; id: string };
export function SavedDesigns({ target, design, collection, invalid, operate, onApply, onPending, onNotice, navigation, showSaved }: {
  navigation: ReactNode; showSaved: boolean;
  target: Target; design: ObsCommentDesign | ObsSpeechDesign; collection: SavedObsDesignCollection;
  invalid(): boolean; operate(operation: SavedDesignOperation): Promise<unknown>;
  onApply(design: ObsCommentDesign | ObsSpeechDesign): void; onPending(pending: boolean): void; onNotice(message: string): void;
}) {
  const [task, setTask] = useState<SavedDesignOperation | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const working = useRef(false), focusAfterOperation = useRef(false);
  const saveButton = useRef<HTMLButtonElement>(null);
  const retryButton = useRef<HTMLButtonElement>(null);
  useEffect(() => { onPending(task !== null); }, [task, onPending]);
  useEffect(() => {
    if (!busy && !task && focusAfterOperation.current) { focusAfterOperation.current = false; saveButton.current?.focus(); }
  }, [busy, task]);
  async function run(operation: SavedDesignOperation) {
    if (working.current) return;
    const focusAtStart = document.activeElement;
    const deletingFocusedRow = operation.kind === 'remove' && !!focusAtStart?.closest(`[data-saved-design="${operation.id}"]`);
    working.current = true; setTask(operation); setBusy(true); setError('');
    try {
      await operate(operation);
      setTask(null);
      const stayedOnDeletedRow = deletingFocusedRow && (document.activeElement === focusAtStart || (!focusAtStart?.isConnected && document.activeElement === document.body));
      focusAfterOperation.current = stayedOnDeletedRow || document.activeElement === retryButton.current;
      onNotice(operation.kind === 'add' ? '現在のデザインを残しました。' : '保存したデザインを削除しました。');
    } catch (failure) { setError(failure instanceof Error ? failure.message : '保存したデザインを更新できませんでした。'); }
    finally { working.current = false; setBusy(false); }
  }
  const blocked = task !== null;
  return <section className="saved-design-section" aria-label="保存したデザイン">
    <button ref={saveButton} type="button" className="save-current-design" aria-disabled={blocked || collection.items.length >= savedObsDesignLimit} onClick={() => {
      if (working.current || blocked || collection.items.length >= savedObsDesignLimit) return;
      if (invalid()) { setError('入力エラーを修正してからデザインを残してください。'); return; }
      void run({ kind: 'add', body: { id: crypto.randomUUID(), design: structuredClone(design) } });
    }}>今のデザインを控えとして保存</button>
    <div className="saved-design-status" aria-live="polite">
      <span role="status">{error || (busy ? '更新中…' : collection.items.length >= savedObsDesignLimit ? '100件保存済みです。不要な保存を削除すると追加できます。' : '')}</span>
      <button ref={retryButton} type="button" data-visible={task !== null} aria-disabled={busy || !task || !error} onClick={() => { if (!working.current && task && error) void run(task); }}>再試行</button>
      <button type="button" data-visible={task !== null} aria-disabled={busy || !task || !error} onClick={() => { if (working.current || !task || !error) return; focusAfterOperation.current = true; setTask(null); setError(''); }}>取消</button>
    </div>
    {navigation}
    <div role="tabpanel" id={`design-editor-panel-${target}-saved`} aria-labelledby={`design-editor-tab-${target}-saved`} hidden={!showSaved}>
    <div className="saved-design-list" role="group" aria-label="保存した見本">
      {collection.items.length === 0 && <p className="saved-design-empty">まだ保存したデザインはありません。</p>}
      {collection.items.map(item => <div className="saved-design-item" key={item.id} data-saved-design={item.id}>
        <div className="preset-card"><button type="button" className="saved-design-choice" aria-label={`保存${item.number}に戻す`} aria-disabled={blocked} onClick={() => { if (working.current || blocked) return; setError(''); onApply(structuredClone(item.design)); }}><span>保存{item.number}<small>{item.design.style.fontSize}px · {item.design.style.fontFamily || '標準フォント'}</small></span></button><DesignThumbnail target={target} application design={item.design}/></div>
        <button type="button" className="saved-design-delete" aria-label={`保存${item.number}を削除`} aria-disabled={blocked} onClick={() => { if (!working.current && !blocked) void run({ kind: 'remove', id: item.id }); }}>削除</button>
      </div>)}
    </div>
    </div>
  </section>;
}
