// THROWAWAY: three fresh home/settings compositions based on original A.
import { useState, type ReactNode } from 'react';
import { categories, features, type Feature, type Values } from './model';
import { DemoSwitch } from './SwitchDesigns';

export type ComposedVariant = 'A5' | 'A6' | 'A7';
type Props = {
  variant: ComposedVariant; page: 'home' | 'settings'; selected?: Feature;
  editor: ReactNode; values: Values; warning: boolean;
  open(id: string, fieldKey?: string): void; update(key: string, value: string | boolean): void; showSettings(): void;
};
function Symbol({ name }: { name: string }) {
  const shapes: Record<string, ReactNode> = {
    sound: <path d="M4 9v6m4-10v14m4-16v18m4-16v14m4-10v6" />,
    ai: <><path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5Z"/><path d="M20 2v4m-2-2h4"/></>,
    mic: <><rect x="9" y="2" width="6" height="13" rx="3"/><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3m-4 0h8"/></>,
    screen: <><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 22h8m-4-5v5"/></>,
    phone: <><rect x="6" y="2" width="12" height="20" rx="3"/><path d="M10 18h4M9 6h6"/></>,
    camera: <><rect x="2" y="5" width="13" height="14" rx="2"/><path d="m15 10 7-4v12l-7-4Z"/></>,
    chat: <path d="M4 3h16v14H9l-6 4V4Z"/>,
    character: <><path d="M4 10 3 3l6 4q3-2 6 0l6-4-1 7q4 10-8 11Q0 20 4 10Z"/><path d="M8 12v2m8-2v2m-6 3h4"/></>,
    settings: <><path d="M3 6h18M3 12h18M3 18h18"/><circle cx="8" cy="6" r="2"/><circle cx="16" cy="12" r="2"/><circle cx="10" cy="18" r="2"/></>,
  };
  return <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{shapes[name] ?? shapes.settings}</svg>;
}

export function ComposedHomes({ variant, page, selected, editor, values, warning, open, update, showSettings }: Props) {
  const [expanded, setExpanded] = useState('');
  const controls = [
    { key: 'speechOn', name: 'コメント読み上げ', icon: 'sound', id: 'speech', summary: values.speechOn ? values.demoSpeechReady === false ? 'VOICEVOXの準備中' : '新着コメントを待機' : '読み上げは停止中' },
    { key: 'aiOn', name: 'AIリスナー', icon: 'ai', id: 'ai', summary: values.aiOn ? values.demoAiHold ? '確認が必要・手動再開待ち' : `${values.persona}が参加中` : '必要なときに参加できます' },
    { key: 'recognitionOn', name: '配信者音声認識', icon: 'mic', id: 'recognition', summary: values.recognitionOn ? '発話を待機' : '音声認識は停止中' },
  ];
  const shortcutItems = [
    { id: 'overlay', name: 'OBSコメント表示', description: '文字サイズ・表示方法', icon: 'screen', tint: 'blue' },
    { id: 'mobile', name: 'スマホで聞く', description: '音声再生・接続の案内', icon: 'phone', tint: 'mint' },
    { id: 'outdoor', name: 'スマホから映像を送る', description: 'Android外配信の準備', icon: 'camera', tint: 'blue' },
    { id: 'ai', name: 'AIリスナーの人格', description: `${values.persona}・性格と話し方`, icon: 'ai', tint: 'violet' },
  ];
  function sectionTitle(title: string, extra?: ReactNode) { return <div className="composed-section-title"><h2>{title}</h2>{extra}</div>; }
  const connectionSummary = variant === 'A5' ? <section className="composed-connection source-controls" aria-label="接続状況">
    <div className="source-panel-heading"><h2>コメントの接続</h2><button className="primary" onClick={() => open('sources')}>{warning ? '接続を確認' : '接続先を変更'}<span aria-hidden="true">›</span></button></div>
    <div className="source-control-grid">{[['YouTube Live', 'demoYoutubeConnected', 'youtube'], ['Twitch', 'demoTwitchConnected', 'twitch'], ['したらば', 'demoShitarabaConnected', 'shitaraba']].map(([name, key, fieldKey]) => {
      const on = values[key] !== false;
      const failed = on && name === 'Twitch' && warning;
      return <article className="source-control-card" aria-label={`${name}の接続`} key={key}><h3><button data-return-key={`source-${fieldKey}`} className="source-settings-link" aria-label={`${name}の接続先を変更`} onClick={() => open('sources', fieldKey)}>{name}<span aria-hidden="true">›</span></button></h3><div className="source-control-state"><span className={`composed-badge ${failed ? 'attention' : on ? 'on' : 'off'}`}><i/>{failed ? '接続エラー' : on ? '接続中' : '停止中'}</span><DemoSwitch appearance="slim" on={on} name={`${name}のコメント取得`} change={() => update(key, !on)}/></div></article>;
    })}</div>
  </section> : <section className="composed-connection" aria-label="接続状況">
    <span className="composed-icon mint"><Symbol name="chat"/></span>
    <div className="connection-copy"><h2>{warning ? '接続先を確認しましょう' : 'コメントを受け取る準備ができています'}</h2><div className="composed-source-pills">{[['YouTube Live', 'demoYoutubeConnected'], ['Twitch', 'demoTwitchConnected'], ['したらば', 'demoShitarabaConnected']].map(([name, key]) => <span key={key} className={`composed-badge ${name === 'Twitch' && warning ? 'attention' : values[key] !== false ? 'on' : 'off'}`}><i/>{name}<span>{name === 'Twitch' && warning ? '要確認' : values[key] !== false ? '接続中' : '停止中'}</span></span>)}</div></div>
    <button className="primary" onClick={() => open('sources')}>{warning ? '接続を確認' : '接続先を変更'}<span aria-hidden="true">›</span></button>
  </section>;
  const controlCards = controls.map(c => <article className="composed-control" key={c.key}>
    <div className="control-heading"><span className={`composed-icon ${c.icon === 'ai' ? 'violet' : 'mint'}`}><Symbol name={c.icon}/></span><button data-return-key={`control-${c.key}`} className="control-settings-link" onClick={() => open(c.id)}>{c.name}<span aria-hidden="true">›</span></button></div>
    <div className="control-bottom"><p>{c.summary}</p><DemoSwitch appearance="slim" on={Boolean(values[c.key])} name={c.name} change={() => update(c.key, !values[c.key])}/></div>
  </article>);
  const supportControls = <div className="composed-controls">{controlCards}</div>;
  const windows = <section className="composed-windows" aria-label="ウィンドウの表示">{sectionTitle('ウィンドウを開く')}<div>{[['listOn', 'コメント一覧', 'chat'], ['characterOn', 'キャラクター', 'character']].map(([key, name, icon]) => <button key={key} className={`window-card ${values[key] ? 'visible-window' : ''}`} aria-pressed={Boolean(values[key])} onClick={() => update(key, !values[key])}><Symbol name={icon}/><span>{name}</span><span className={`composed-badge ${values[key] ? 'on' : 'off'}`}>{values[key] ? '表示中' : '閉じています'}</span></button>)}</div></section>;
  const shortcuts = <section className="composed-shortcuts" aria-label="設定への入口">{sectionTitle('設定を調整', <button className="all-settings" onClick={() => showSettings()}>すべての設定 <span aria-hidden="true">›</span></button>)}<div className="shortcut-grid">{shortcutItems.map(item => <button data-return-key={`shortcut-${item.id}`} className="shortcut-card" key={item.id} onClick={() => open(item.id)}><span className={`composed-icon ${item.tint}`}><Symbol name={item.icon}/></span><span><strong>{item.name}</strong><small>{item.description}</small></span><span className="card-arrow" aria-hidden="true">›</span></button>)}</div></section>;
  if (selected) return editor;
  if (page === 'settings') return <div className="composed-settings">{categories.map(c => <section key={c.id} id={`composed-category-${c.id}`} aria-label={`${c.id === 'app' ? 'OBS連携・アプリ' : c.name}の設定`}><h2><span className={`composed-icon ${c.id === 'ai' ? 'violet' : c.id === 'display' ? 'blue' : 'mint'}`}><Symbol name={c.id === 'comments' ? 'chat' : c.id === 'audio' ? 'sound' : c.id === 'ai' ? 'ai' : c.id === 'display' ? 'screen' : c.id === 'mobile' ? 'phone' : 'settings'}/></span>{c.id === 'app' ? 'OBS連携・アプリ' : c.name}</h2>{features.filter(f => f.category === c.id).map(f => <button data-return-key={`feature-${f.id}`} key={f.id} onClick={() => open(f.id)}><span><strong>{f.name}</strong><small>{f.description}</small></span><span aria-hidden="true">›</span></button>)}</section>)}</div>;
  if (variant === 'A7') {
    const panels = [
      { id: 'audio', name: '音声', description: '読み上げ・配信者音声認識', icon: 'sound', state: Boolean(values.speechOn || values.recognitionOn), content: <><div className="fold-controls">{controlCards.filter((_, i) => i !== 1)}</div><div className="composed-audio-fields"><label>話者・スタイル<select value={String(values.voice)} onChange={e => update('voice', e.target.value)}>{features.find(f => f.id === 'speech')!.fields.find(f => f.key === 'voice')!.options!.map(o => <option key={o}>{o}</option>)}</select></label><label>読み上げ速度<input type="number" min="0.5" max="2" step="0.1" value={String(values.speed)} onChange={e => update('speed', e.target.value)}/></label></div></> },
      { id: 'ai', name: 'AIリスナー', description: `${values.persona} · ${values.aiSource}`, icon: 'ai', state: Boolean(values.aiOn), content: <><div className="fold-controls">{controlCards.filter((_, i) => i === 1)}</div><button className="fold-detail-link" onClick={() => open('ai')}>人格・参加設定を開く <span aria-hidden="true">›</span></button></> },
      { id: 'display', name: '表示・スマホ', description: 'ウィンドウ・OBS表示・スマホ接続', icon: 'screen', content: <>{windows}{shortcuts}</> },
    ];
    return <div className="composed-home composed-A7">{connectionSummary}<div className="composed-folds">{panels.map(panel => <section key={panel.id} className={expanded === panel.id ? 'is-expanded' : ''}><h2><button aria-expanded={expanded === panel.id} aria-controls={`composed-panel-${panel.id}`} onClick={() => setExpanded(expanded === panel.id ? '' : panel.id)}><span className={`composed-icon ${panel.id === 'ai' ? 'violet' : 'mint'}`}><Symbol name={panel.icon}/></span><span className="fold-name">{panel.name}<small>{panel.description}</small></span>{panel.state !== undefined && <span className={`composed-badge ${panel.state ? 'on' : 'off'}`}>{panel.state ? '使用中' : 'オフ'}</span>}<span className="fold-arrow" aria-hidden="true">{expanded === panel.id ? '−' : '＋'}</span></button></h2><div id={`composed-panel-${panel.id}`} hidden={expanded !== panel.id} className="fold-content">{expanded === panel.id && panel.content}</div></section>)}</div><button className="composed-settings-entry" onClick={() => showSettings()}><Symbol name="settings"/><span>すべての設定を開く</span><span aria-hidden="true">›</span></button></div>;
  }
  return <div className={`composed-home composed-${variant}`}>{connectionSummary}<div className="composed-columns"><div className="daily-column"><section aria-label="日常操作">{sectionTitle('よく使う操作')}{supportControls}</section>{variant === 'A6' && windows}</div>{shortcuts}{variant === 'A5' && windows}</div></div>;
}
