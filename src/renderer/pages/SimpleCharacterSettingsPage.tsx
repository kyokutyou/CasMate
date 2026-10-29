import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ChangeEvent, type DragEvent } from 'react';
import type { CharacterAssetSlot, CharacterState, SimpleCharacterMotionSettings } from '../../shared/types';
import { defaultSimpleCharacterMotionSettings } from '../../shared/simple-character';
import { useApplicationState } from '../api';
import { CharacterImage } from '../components/CharacterImage';
import './simple-character-settings.css';

export function SimpleCharacterSettingsPage() {
  const api = useApplicationState(true);
  const [draft, setDraft] = useState<SimpleCharacterMotionSettings | null>(null);
  const [motionSaveState, setMotionSaveState] = useState<'saved' | 'pending' | 'saving' | 'error'>('saved');
  const editVersion = useRef(0);
  const saveAttempt = useRef(0);
  const hasPendingEdit = useRef(false);
  const latestSavedMotion = useRef<SimpleCharacterMotionSettings | null>(null);
  useLayoutEffect(() => { latestSavedMotion.current = api.snapshot?.settings.character.simple.motion ?? null; }, [api.snapshot]);
  const [errorNotice, setErrorNotice] = useState<string | null>(null);
  const pendingPreview = useRef<SimpleCharacterMotionSettings | null>(null);
  const previewTimer = useRef<number | null>(null);
  const saveTimer = useRef<number | null>(null);
  const previewQueue = useRef(Promise.resolve());
  const mouthTestTimer = useRef<number | null>(null);
  const [mouthTestShape, setMouthTestShape] = useState<CharacterState['mouthShape'] | null>(null);
  const loadedRevision = useRef<number | null>(null);
  const savedRevision = api.snapshot?.settingsRevision;

  useEffect(() => {
    if (!api.snapshot || hasPendingEdit.current || loadedRevision.current === api.snapshot.settingsRevision) return;
    loadedRevision.current = api.snapshot.settingsRevision;
    setDraft({ ...api.snapshot.settings.character.simple.motion });
  }, [api.snapshot, savedRevision, motionSaveState]);

  const report = useCallback((error: unknown) => {
    setErrorNotice(error instanceof Error ? error.message : '操作に失敗しました。');
  }, []);

  const flushPreview = useCallback(() => {
    if (previewTimer.current !== null) window.clearTimeout(previewTimer.current);
    previewTimer.current = null;
    const value = pendingPreview.current;
    pendingPreview.current = null;
    if (!value) return previewQueue.current;
    const operation = previewQueue.current
      .catch(() => undefined)
      .then(() => api.previewCharacterMotion(value).then(() => undefined));
    previewQueue.current = operation.catch(() => undefined);
    return operation;
  }, [api]);

  const save = useCallback(async (value: SimpleCharacterMotionSettings) => {
    if (!api.snapshot) return;
    if (saveTimer.current !== null) window.clearTimeout(saveTimer.current);
    saveTimer.current = null;
    const version = editVersion.current;
    const attempt = ++saveAttempt.current;
    setMotionSaveState('saving');
    try {
      await flushPreview();
      await api.saveCharacterMotion(value);
      if (version === editVersion.current && attempt === saveAttempt.current) {
        hasPendingEdit.current = false;
        setMotionSaveState('saved');
      }
    } catch (error) {
      if (version !== editVersion.current || attempt !== saveAttempt.current) return;
      const saved = latestSavedMotion.current ?? api.snapshot.settings.character.simple.motion;
      hasPendingEdit.current = false;
      setDraft({ ...saved });
      await api.previewCharacterMotion(saved).catch(() => undefined);
      if (version === editVersion.current && attempt === saveAttempt.current) {
        setMotionSaveState('error');
        report(error);
      }
    }
  }, [api, flushPreview, report]);

  const preview = useCallback((value: SimpleCharacterMotionSettings, saveAfterIdle = true) => {
    editVersion.current++;
    hasPendingEdit.current = true;
    setMotionSaveState('pending');
    setDraft(value);
    setErrorNotice(null);
    pendingPreview.current = value;
    if (previewTimer.current === null) {
      previewTimer.current = window.setTimeout(() => {
        const version = editVersion.current;
        void flushPreview().catch(error => {
          if (version === editVersion.current) { setMotionSaveState('error'); report(error); }
        });
      }, 50);
    }
    if (saveTimer.current !== null) window.clearTimeout(saveTimer.current);
    if (saveAfterIdle) saveTimer.current = window.setTimeout(() => { void save(value); }, 500);
  }, [flushPreview, report, save]);

  useEffect(() => () => {
    if (previewTimer.current !== null) window.clearTimeout(previewTimer.current);
    if (saveTimer.current !== null) window.clearTimeout(saveTimer.current);
    if (mouthTestTimer.current !== null) window.clearInterval(mouthTestTimer.current);
  }, []);

  if (!api.snapshot || !draft) return <main className="center-message">読み込み中...</main>;
  const snapshot = api.snapshot;
  const simple = snapshot.settings.character.simple;

  const run = async (operation: () => Promise<unknown>) => {
    try {
      setErrorNotice(null);
      await operation();
    } catch (error) {
      report(error);
    }
  };
  const selectAsset = (slot: CharacterAssetSlot) => (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) void run(() => api.uploadAsset(slot, file));
    event.target.value = '';
  };
  const dropAsset = (slot: CharacterAssetSlot, file: File) => {
    void run(() => api.uploadAsset(slot, file));
  };
  const change = <K extends keyof SimpleCharacterMotionSettings>(key: K, value: SimpleCharacterMotionSettings[K]) => {
    const next = { ...draft, [key]: value };
    preview(next);
  };
  const startMouthTest = () => {
    if (!simple.closedAsset || !simple.openAsset || mouthTestTimer.current !== null) return;
    let elapsedMs = 0;
    setMouthTestShape('open');
    mouthTestTimer.current = window.setInterval(() => {
      elapsedMs += 200;
      if (elapsedMs >= 2_000) {
        window.clearInterval(mouthTestTimer.current!);
        mouthTestTimer.current = null;
        setMouthTestShape(null);
        return;
      }
      setMouthTestShape(elapsedMs % 400 === 0 ? 'open' : 'closed');
    }, 200);
  };

  return <main className="character-settings-page">
    <header className="topbar"><div><h1>簡易キャラクター設定</h1></div><span aria-label="接続状態">{api.connected ? '接続済み' : '再接続中'}</span></header>
    <div className="character-settings-notice" role="status" aria-label="操作の問題">{errorNotice ?? api.error ?? snapshot.warning ?? ''}</div>
    <div className="character-settings-workspace">
    <section className="panel character-settings-preview" aria-label="キャラクタープレビュー">
      <h2>プレビュー</h2>
      <div className="character-preview large"><CharacterImage mouthShape={mouthTestShape ?? snapshot.character.mouthShape} settings={snapshot.settings.character} motion={snapshot.character.motion} motionStartedAtMs={snapshot.character.motionStartedAtMs} alt="簡易キャラクターのプレビュー" onOpenAssetError={api.reportCharacterAssetError} /></div>
      <button className="secondary" disabled={!simple.closedAsset || !simple.openAsset || mouthTestShape !== null} onClick={startMouthTest}>{mouthTestShape === null ? '口パクをテスト' : '口パクテスト中...'}</button>
      <p className="muted character-mouth-test-help">このプレビューのみ・2秒</p>
    </section>
    <div className="character-settings-controls">
    <section className="panel">
      <h2>PNG素材</h2>
      <p className="muted">静止PNG（20 MiB以下、各辺8,192px以下）を使用します。</p>
      <p className="muted character-asset-order-help">{simple.closedAsset ? '口を開けた画像（PNG）は口を閉じた画像（PNG）と同じ大きさにしてください。' : 'まず口を閉じた画像（PNG）を登録してください。'}</p>
      <div className="asset-controls">
        <AssetUploadControl slot="closed" label="口を閉じた画像（PNG）" onSelect={selectAsset('closed')} onDropFile={(file) => dropAsset('closed', file)} />
        <AssetUploadControl slot="open" label="口を開けた画像（PNG）" disabled={!simple.closedAsset} onSelect={selectAsset('open')} onDropFile={(file) => dropAsset('open', file)} />
      </div>
      <div className="character-asset-removals" role="group" aria-label="登録素材の解除">
        <h3>登録素材の解除</h3>
        <button className="secondary" disabled={!simple.closedAsset} onClick={() => void run(() => api.clearAsset('closed'))}>画像をすべて解除</button>
        <button className="secondary" disabled={!simple.openAsset} onClick={() => void run(() => api.clearAsset('open'))}>口を開けた画像だけ解除</button>
      </div>
      <p className="field-error character-asset-warning" role="status">{snapshot.character.assetWarning ?? ' '}</p>
    </section>
    <section className="panel">
      <div className="panel-heading"><h2>ゆっくり動かす（常時微動）</h2><label className="check"><input type="checkbox" checked={draft.enabled} onChange={(event) => { const next = { ...draft, enabled: event.target.checked }; preview(next, false); void save(next); }} />オン</label></div>
      <p className="muted character-motion-help">変更はOBS・独立ウィンドウにも即時反映され、自動保存されます。</p>
      <p className="character-motion-save" role="status" aria-label="微動の保存状態" data-state={motionSaveState}>{({ saved: '保存済み', pending: '保存待ち', saving: '保存中', error: '保存失敗' })[motionSaveState]}</p>
      <fieldset className="character-motion-group"><legend>上下</legend>
        <MotionSlider label="動きの大きさ" name="上下移動" value={draft.verticalAmplitudePercent} unit="%" min={0} max={5} onChange={(value) => change('verticalAmplitudePercent', value)} onCommit={() => void save(draft)} />
        <MotionSlider label="1往復の時間" name="上下一往復" value={draft.verticalPeriodSeconds} unit="秒" min={1} max={20} onChange={(value) => change('verticalPeriodSeconds', value)} onCommit={() => void save(draft)} />
      </fieldset>
      <fieldset className="character-motion-group"><legend>傾き</legend>
        <MotionSlider label="動きの大きさ" name="左右の傾き" value={draft.tiltAmplitudeDegrees} unit="度" min={0} max={5} onChange={(value) => change('tiltAmplitudeDegrees', value)} onCommit={() => void save(draft)} />
        <MotionSlider label="1往復の時間" name="傾き一往復" value={draft.tiltPeriodSeconds} unit="秒" min={1} max={20} onChange={(value) => change('tiltPeriodSeconds', value)} onCommit={() => void save(draft)} />
      </fieldset>
      <fieldset className="character-motion-group"><legend>呼吸</legend>
        <MotionSlider label="動きの大きさ" name="呼吸の縦伸縮" value={draft.breathingAmplitudePercent} unit="%" min={0} max={5} onChange={(value) => change('breathingAmplitudePercent', value)} onCommit={() => void save(draft)} />
        <MotionSlider label="1往復の時間" name="呼吸一往復" value={draft.breathingPeriodSeconds} unit="秒" min={1} max={20} onChange={(value) => change('breathingPeriodSeconds', value)} onCommit={() => void save(draft)} />
      </fieldset>
      <button className="secondary" onClick={() => { const next = { ...defaultSimpleCharacterMotionSettings, enabled: draft.enabled }; preview(next, false); void save(next); }}>標準に戻す</button>
    </section>
    </div>
    </div>
  </main>;
}

export function AssetUploadControl({ slot, label, disabled = false, onSelect, onDropFile }: {
  slot: CharacterAssetSlot;
  label: string;
  disabled?: boolean;
  onSelect(event: ChangeEvent<HTMLInputElement>): void;
  onDropFile(file: File): void;
}) {
  const [dragging, setDragging] = useState(false);
  const acceptDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    if (disabled) return;
    event.dataTransfer.dropEffect = 'copy';
    setDragging(true);
  };
  const drop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    if (disabled) return;
    const file = event.dataTransfer.files[0];
    if (file) onDropFile(file);
  };

  return <div
    role="group"
    aria-label={`${label}登録`}
    aria-disabled={disabled}
    className={`asset-drop-zone ${dragging ? 'dragging' : ''} ${disabled ? 'disabled' : ''}`}
    data-slot={slot}
    onDragEnter={acceptDrop}
    onDragOver={acceptDrop}
    onDragLeave={() => setDragging(false)}
    onDrop={drop}
  >
    <label className={`upload-button ${disabled ? 'disabled' : ''}`}>{label}を選択<input hidden disabled={disabled} type="file" accept="image/png" onChange={onSelect} /></label>
    <span>またはここへドラッグ＆ドロップ</span>
  </div>;
}

function MotionSlider({ label, name, value, unit, min, max, onChange, onCommit }: {
  label: string; name: string; value: number; unit: string; min: number; max: number;
  onChange(value: number): void; onCommit(): void;
}) {
  return <div className="motion-slider"><span>{label}<output>{value.toFixed(1)} {unit}</output></span><input aria-label={name} aria-valuetext={`${value.toFixed(1)} ${unit}`} type="range" min={min} max={max} step={0.1} value={value} onChange={(event) => onChange(Number(event.target.value))} onPointerUp={onCommit} onKeyUp={onCommit} /></div>;
}
