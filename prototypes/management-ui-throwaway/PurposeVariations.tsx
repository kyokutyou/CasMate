// THROWAWAY: six alternatives based on the user's preferred purpose tabs.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { features, purposeFeatures, type DerivedVariant, type Feature, type Values } from './model';

type Purpose = keyof typeof purposeFeatures;
type Props = {
  variant: DerivedVariant;
  purpose: Purpose;
  selected?: Feature;
  values: Values;
  warning: boolean;
  editor: ReactNode;
  open(id: string): void;
  close(): void;
};
const stageDefinitions = [
  { title: '接続を整える', short: '接続', icon: '↗', description: 'コメントソースと配信機器', ids: ['sources', 'obs', 'mobile', 'outdoor'] },
  { title: '音声と会話', short: '音声・AI', icon: '≋', description: '聞こえ方と会話の準備', ids: ['speech', 'recognition', 'ai'] },
  { title: '表示と仕上げ', short: '表示・その他', icon: '▦', description: '見た目とコメントの扱い', ids: ['overlay', 'effects', 'character', 'commentList', 'filter', 'nextThread', 'urls'] },
];

function summarize(feature: Feature, values: Values, warning: boolean): string {
  const summary: Record<string, string> = {
    sources: warning ? 'Twitchの接続を確認' : '3ソース接続中',
    speech: `${values.voice} · ${values.speed}倍`, recognition: values.recognitionOn ? '認識中' : 'オフ',
    ai: `${values.persona} · ${values.aiOn ? '稼働中' : '停止中'}`,
    overlay: `${values.overlayMode} · ${values.fontSize}px`, effects: values.effectsOn ? '文字演出オン' : 'オフ',
    character: values.characterOn ? '表示中' : '非表示', commentList: values.listOn ? '表示中' : '非表示',
    filter: 'NGワード・アスキーアート', nextThread: values.nextEnabled ? '自動作成オン' : '手動作成',
    mobile: values.lan ? 'LAN公開オン' : 'LAN公開オフ', outdoor: values.outdoorOn ? '外配信オン' : '登録・接続の準備',
    obs: values.obsOn ? 'OBS連携オン' : 'OBS連携オフ', urls: '表示URL・アプリ設定',
  };
  return summary[feature.id];
}

export function PurposeVariations({ variant, purpose, selected, values, warning, editor, open, close }: Props) {
  const [query, setQuery] = useState('');
  const activePanel = useRef<HTMLDivElement>(null);
  const ids = purposeFeatures[purpose];
  const items = ids.map(id => features.find(f => f.id === id)!);
  const stages = stageDefinitions.map(s => ({ ...s, items: items.filter(f => s.ids.includes(f.id)) })).filter(s => s.items.length);
  const featured = purpose === '外配信' ? ['mobile', 'outdoor', 'obs'] : purpose === '配信中' ? ['speech', 'ai', 'commentList'] : ['sources', 'speech', 'overlay'];
  useEffect(() => {
    if (variant === 'V3' && selected) activePanel.current?.scrollIntoView?.({ block: 'nearest', behavior: 'instant' });
  }, [selected, variant]);
  const itemButton = (f: Feature, compact = false) => <button key={f.id} className={`derived-item ${compact ? 'compact' : ''}`} onClick={() => open(f.id)} aria-label={f.name}>
    <span><strong>{f.name}</strong><small>{summarize(f, values, warning)}</small></span><span className="item-arrow" aria-hidden="true">›</span>
  </button>;

  if (variant === 'C2') return <div className="split-settings">
    <nav className="task-outline" aria-label="この用途の設定">{stages.map(stage => <section key={stage.short}><h2>{stage.short}</h2>{stage.items.map(f => <button key={f.id} aria-current={selected?.id === f.id ? 'page' : undefined} onClick={() => open(f.id)}>{f.name}{selected?.id === f.id && <span aria-hidden="true">›</span>}</button>)}</section>)}</nav>
    <div className="task-detail">{selected ? editor : <section className="detail-empty"><span className="large-symbol" aria-hidden="true">↗</span><h2>設定を選んで、ここで調整。</h2><p>左側に、この用途で使う設定が並びます。編集中も一覧が見える構成です。</p><button className="primary" onClick={() => open(purpose === '外配信' ? 'mobile' : 'sources')}>{purpose === '外配信' ? 'スマホ接続を確認' : '接続先から始める'}</button><div className="detail-status"><span>読み上げ</span><strong>{values.speechOn ? 'オン' : 'オフ'}</strong><span>AIリスナー</span><strong>{values.aiOn ? '稼働中' : '停止中'}</strong></div></section>}</div>
  </div>;

  if (variant === 'V3') return <div className="inline-settings">
    <p className="layout-intro">項目を開いて、その場で調整できます。</p>
    {stages.map((stage, index) => <section key={stage.short} className="inline-stage"><h2><span>0{index + 1}</span>{stage.title}</h2>{stage.items.map(f => <div key={f.id} className={`inline-feature ${selected?.id === f.id ? 'expanded' : ''}`} ref={selected?.id === f.id ? activePanel : undefined}>
      <button className="inline-trigger" aria-expanded={selected?.id === f.id} aria-controls={`inline-${f.id}`} onClick={() => selected?.id === f.id ? close() : open(f.id)}><span><strong>{f.name}</strong><small>{summarize(f, values, warning)}</small></span><span aria-hidden="true">{selected?.id === f.id ? '−' : '＋'}</span></button>
      <div id={`inline-${f.id}`} hidden={selected?.id !== f.id}>{selected?.id === f.id && editor}</div>
    </div>)}</section>)}
  </div>;

  if (selected) return <>{editor}</>;

  if (variant === 'C1') return <div className="lane-grid">{stages.map((stage, index) => <section className="purpose-lane" key={stage.short}>
    <header><span className="lane-number">0{index + 1}</span><div><h2>{stage.short}</h2><p>{stage.description}</p></div><span className="lane-count">{stage.items.length}</span></header>
    <div>{stage.items.map(f => itemButton(f, true))}</div>
  </section>)}</div>;

  if (variant === 'C3') {
    const needle = query.trim().toLocaleLowerCase();
    const matches = items.filter(f => `${f.name} ${f.description} ${f.fields.map(field => field.label).join(' ')}`.toLocaleLowerCase().includes(needle));
    return <div className="search-workspace"><label className="settings-search"><span aria-hidden="true">⌕</span><input aria-label="この用途の設定を検索" value={query} onChange={e => setQuery(e.target.value)} placeholder="設定を検索… 声、人格、文字サイズ" /><span>{matches.length}件</span></label>
      <div className="list-head"><span>設定</span><span>現在の状態</span><span /></div>
      {matches.map(f => <button className="setting-table-row" key={f.id} aria-label={f.name} onClick={() => open(f.id)}><strong>{f.name}</strong><span className={f.id === 'sources' && warning ? 'needs-attention' : ''}>{summarize(f, values, warning)}</span><span aria-hidden="true">↗</span></button>)}
      {!matches.length && <div className="empty-search"><h2>該当する設定がありません</h2><p>別の言葉で検索するか、用途タブを切り替えてください。</p><button onClick={() => setQuery('')}>検索をクリア</button></div>}
    </div>;
  }

  if (variant === 'V1') return <div className="vertical-guide"><div className="guide-intro"><span className="guide-ring" aria-hidden="true">{stages.length}</span><div><strong>{stages.length}つのまとまりで、順に確認。</strong><p>必要なところだけ開いて使えます。</p></div></div>
    {stages.map((stage, index) => <details className="guide-stage" key={`${purpose}-${stage.short}`} open={index === 0}><summary><span className="timeline-dot">{index + 1}</span><span><strong>{stage.title}</strong><small>{stage.description}</small></span><span className="guide-count">{stage.items.length}項目</span></summary><div className="guide-stage-items">{stage.items.map(f => itemButton(f))}</div></details>)}
  </div>;

  return <div className="bottom-tab-home"><section className="pocket-status"><span className="pocket-orb" aria-hidden="true">≋</span><div><strong>{purpose === '外配信' ? 'スマホで、外から。' : purpose === '配信中' ? '配信に集中する時間。' : '配信前の、小さな確認。'}</strong><p>読み上げ {values.speechOn ? 'オン' : 'オフ'} · AIリスナー {values.aiOn ? '稼働中' : '停止中'}</p></div></section>
    <div className="pocket-primary">{featured.map((id, index) => { const f = features.find(f => f.id === id)!; return <button key={id} aria-label={f.name} onClick={() => open(id)}><span className="pocket-index">0{index + 1}</span><span><strong>{f.name}</strong><small>{f.description}</small></span><span aria-hidden="true">↗</span></button>; })}</div>
    <details className="pocket-more"><summary>この用途のすべての設定 <span>{items.length}項目</span></summary>{items.map(f => itemButton(f))}</details>
  </div>;
}
