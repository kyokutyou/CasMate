import { useCallback, useContext, useEffect, useId, useState } from 'react';
import type { CommentOverlaySettings } from '../../shared/types';
import { ManagementNavigation, SetupPresentation } from '../management-navigation';
import { OverlayNumber } from './OverlayNumber';
import { ObsDesignButton } from './ObsDesignButton';
import { SettingsCard } from './SettingsCard';
import { SlimSwitch } from './SlimSwitch';
import { CompactFeedback } from './CompactFeedback';
import './comment-overlay-panel.css';

interface Props {
  onEditDesign?(): Promise<unknown> | void;
  settings: CommentOverlaySettings;
  speechEnabled: boolean;
  saveError?: string;
  onChange(settings: CommentOverlaySettings): void;
  onFontSizeChange?(settings: CommentOverlaySettings): void;
  onSave(settings: CommentOverlaySettings): Promise<unknown>;
  onOperationStart(): void;
  loadFonts?: () => Promise<string[]>;
}
const fields = [['showSource', 'サービス名', 'YouTube・Twitch・したらば・jpnkn'], ['showAuthor', '投稿者名', '誰から届いたコメントか'], ['showContent', '本文', 'コメントの文章・公式エモート']] as const;

export function CommentOverlayPanel(props: Props) {
  const navigation = useContext(ManagementNavigation);
  const active = !navigation || navigation.editor === 'commentOverlay';
  const [visited, setVisited] = useState(false);
  useEffect(() => { if (active) setVisited(true); }, [active]);
  // Mount on first use, then retain the editor so navigation never discards input.
  return active || visited ? <CommentOverlayEditor {...props}/> : null;
}

function CommentOverlayEditor({ settings, speechEnabled, saveError, onChange, onFontSizeChange, onSave, onEditDesign }: Props) {
  const setup = useContext(ManagementNavigation)?.initialSetup === true;
  const { obsRegistration } = useContext(SetupPresentation);
  const [setupVisited, setSetupVisited] = useState(setup);
  useEffect(() => { if (setup) setSetupVisited(true); }, [setup]);
  const id = useId();
  const [fieldError, setFieldError] = useState('');
  const [inputErrors, setInputErrors] = useState<Record<string, string>>({});
  const reportInput = useCallback((key: string, error: string) => setInputErrors(current => current[key] === error ? current : { ...current, [key]: error }), []);
  const save = (next: CommentOverlaySettings) => onSave(next).catch(() => undefined);
  const number = (key: 'stackDurationSeconds' | 'singleDurationSeconds' | 'fontSizePx' | 'paddingPx' | 'borderRadiusPx', label: string, unit: string, min: number, max: number) =>
    <OverlayNumber field={key} label={label} unit={unit} min={min} max={max} value={key === 'fontSizePx' ? settings.design?.style.fontSize ?? settings.fontSizePx : settings[key]} onError={reportInput} onChange={value => {
      const next = { ...settings, [key]: value };
      if (key === 'fontSizePx' && settings.design) next.design = { ...settings.design, style: { ...settings.design.style, fontSize: value } };
      if (key === 'fontSizePx' && onFontSizeChange) onFontSizeChange(next);
      else onChange(next);
    }} />;
  const toggle = (key: typeof fields[number][0], checked: boolean) => {
    const next = { ...settings, [key]: checked };
    if (!fields.some(([field]) => next[field])) { setFieldError('少なくとも1項目をオンにしてください。'); return; }
    setFieldError(''); return save(next);
  };

  return <SettingsCard cardId="commentOverlay" title="OBSコメント表示" eyebrow="OBS COMMENT" className="comment-overlay-panel" saveError={saveError}
    navigationWarning={[fieldError, ...Object.values(inputErrors)].filter(Boolean).join(' ')}>
    <section className="overlay-setting-section" aria-labelledby={`${id}-mode`}><h3 id={`${id}-mode`}>{setup ? <><span className="setup-number">2</span>コメント表示をOBSに追加する</> : '表示方法とタイミング'}</h3>
      {setup && <label className="setup-mode-field">コメントの表示方法<select value={settings.mode} onChange={event => void save({ ...settings, mode: event.target.value as CommentOverlaySettings['mode'] })}><option value="stack">積み上げ</option><option value="single">1件ずつ</option></select></label>}
      <div className="overlay-mode-choices" hidden={setup} role="group" aria-label="表示方法">{([['single', '1件ずつ', '一つのコメントに集中'], ['stack', '積み上げ', '複数のコメントを並べる']] as const).map(([mode, label, help]) =>
        <button type="button" className="secondary" aria-label={label} aria-pressed={settings.mode === mode} key={mode} onClick={() => { if (settings.mode !== mode) void save({ ...settings, mode }); }}>
          <span className={`overlay-mode-icon ${mode}`} aria-hidden="true"><i/><i/><i/></span><span><strong>{label}</strong><small>{help}</small></span><span className="overlay-mode-selected" aria-hidden="true">{settings.mode === mode ? '●' : '○'}</span>
        </button>)}</div>
      <p className="overlay-note">切り替えると表示中と表示待ちのコメントをクリアし、次の新着から表示します。</p>
      <div className="overlay-single-timing" hidden={setup || settings.mode !== 'single'} role="group" aria-label="1件ずつの表示時間">
        <div className="overlay-timing-rows">
          <section className="overlay-timing-row" data-active={speechEnabled} aria-labelledby={`${id}-speech-on`}>
            <span className="overlay-timing-mark" aria-hidden="true"/>
            <h4 id={`${id}-speech-on`}>読み上げ ON</h4>
            <p className="overlay-timing-main">読み上げ終了 ＋ 2秒</p>
            <span className="overlay-timing-active">{speechEnabled ? '適用中' : ''}</span>
          </section>
          <section className="overlay-timing-row" data-active={!speechEnabled} aria-labelledby={`${id}-speech-off`}>
            <span className="overlay-timing-mark" aria-hidden="true"/>
            <h4 id={`${id}-speech-off`}>読み上げ OFF</h4>
            {number('singleDurationSeconds', '1件表示時間', '秒', 1, 60)}
            <span className="overlay-timing-active">{!speechEnabled ? '適用中' : ''}</span>
          </section>
        </div>
      </div>
      <div className="overlay-field-grid" hidden={setup || settings.mode !== 'stack'}>{number('stackDurationSeconds', '各コメントを表示する時間', '秒', 1, 60)}<div className="overlay-input"><label htmlFor={`${id}-direction`}>積み上げ方向</label><select id={`${id}-direction`} value={settings.stackDirection} onChange={event => void save({ ...settings, stackDirection: event.target.value as CommentOverlaySettings['stackDirection'] })}><option value="newestBottom">新着を下へ</option><option value="newestTop">新着を上へ</option></select><p className="overlay-input-help">最大10件。古いコメントから消えます。</p></div></div>
    </section>
    {(setup || setupVisited) && <section className="overlay-setting-section" hidden={!setup}>{number('fontSizePx', '文字サイズ', 'px', 8, 200)}</section>}
    {setup && obsRegistration}
    <section className="overlay-setting-section" aria-labelledby={`${id}-fields`}><h3 id={`${id}-fields`}>表示する情報</h3><div role="group" aria-labelledby={`${id}-fields`} aria-describedby={`${id}-fields-help`}>{fields.map(([key, label, help]) => <div className="overlay-switch-row" key={key}><div><strong>{label}</strong><small>{help}</small></div><SlimSwitch label={label} checked={settings[key]} keepFocus onChange={checked => toggle(key, checked)} /></div>)}</div><CompactFeedback id={`${id}-fields-help`} className={`overlay-input-help${fieldError ? ' field-error' : ''}`} role="status" reserve={['少なくとも1つの情報を表示します。', '少なくとも1項目をオンにしてください。']}>{fieldError}</CompactFeedback></section>
    <ObsDesignButton target="comments" onEdit={onEditDesign}/>
  </SettingsCard>;
}
