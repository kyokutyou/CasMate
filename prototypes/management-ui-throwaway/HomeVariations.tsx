// THROWAWAY: three portrait alternatives based on the original home/settings split.
import { useState, type ReactNode } from 'react';
import { categories, features, type Category, type Feature, type HomeVariant, type Values } from './model';

type Props = {
  variant: HomeVariant;
  page: 'home' | 'settings';
  selected?: Feature;
  values: Values;
  warning: boolean;
  editor: ReactNode;
  open(id: string): void;
  showSettings(): void;
  navigate(action: () => void): void;
  update(key: string, value: boolean): void;
};
const categorySymbols: Record<Category, string> = { comments: '▤', audio: '≋', ai: '✧', display: '▦', mobile: '▯', app: '⌘' };
const controlItems = [
  { key: 'speechOn', label: '読み上げ', symbol: '≋', hint: 'コメントの音声' },
  { key: 'aiOn', label: 'AIリスナー', symbol: '✧', hint: '会話への参加' },
  { key: 'listOn', label: 'コメント一覧', symbol: '▤', hint: '独立ウィンドウ' },
] as const;

export function HomeControlDock({ values, update }: Pick<Props, 'values' | 'update'>) {
  return <div className="home-control-dock" aria-label="いつもの操作">{controlItems.map(item => <button key={item.key} aria-label={`${item.label}を切り替え`} aria-pressed={Boolean(values[item.key])} onClick={() => update(item.key, !values[item.key])}><span aria-hidden="true">{item.symbol}</span><span>{item.label}</span><small>{values[item.key] ? 'オン' : 'オフ'}</small></button>)}</div>;
}

export function HomeVariations({ variant, page, selected, values, warning, editor, open, showSettings, navigate, update }: Props) {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<Category | null>(null);
  const group = categories.find(c => c.id === category);
  const rows = (items: Feature[]) => <div className="home-setting-rows">{items.map(f => <button key={f.id} aria-label={f.name} onClick={() => open(f.id)}><span><strong>{f.name}</strong><small>{f.description}</small></span><span aria-hidden="true">›</span></button>)}</div>;
  const categoryTiles = <div className="home-category-tiles">{categories.map(c => <button key={c.id} onClick={() => { setCategory(c.id); showSettings(); }}><span className="home-category-symbol" aria-hidden="true">{categorySymbols[c.id]}</span><strong>{c.name}</strong><small>{features.filter(f => f.category === c.id).length}項目</small></button>)}</div>;
  const sourceStatus = <div className="home-source-status"><span><i />YouTube Live</span><span className={warning ? 'attention' : ''}><i />Twitch</span><span><i />したらば</span></div>;

  if (selected) return <>{editor}</>;
  if (page === 'settings') {
    if (variant === 'A1') return <div className="home-accordion-settings">{categories.map((c, index) => <details key={c.id} open={index === 0}><summary><span className="home-category-symbol" aria-hidden="true">{categorySymbols[c.id]}</span><span>{c.name}<small>{c.description}</small></span><span className="home-category-count">{features.filter(f => f.category === c.id).length}</span></summary>{rows(features.filter(f => f.category === c.id))}</details>)}</div>;
    if (variant === 'A2') {
      const needle = query.trim().toLocaleLowerCase();
      const matching = features.filter(f => `${f.name} ${f.description} ${f.fields.map(field => field.label).join(' ')}`.toLocaleLowerCase().includes(needle));
      return <div className="home-search-settings"><label className="settings-search"><span aria-hidden="true">⌕</span><input aria-label="すべての設定を検索" placeholder="声、人格、文字サイズから探す" value={query} onChange={e => setQuery(e.target.value)} /><span>{matching.length}件</span></label>{rows(matching)}{!matching.length && <div className="empty-search"><p>該当する設定がありません。</p><button onClick={() => setQuery('')}>検索をクリア</button></div>}</div>;
    }
    return <div className="home-category-settings">{group ? <><button className="back-link" onClick={() => navigate(() => setCategory(null))}>← 分類を選び直す</button><div className="home-group-heading"><span className="home-category-symbol" aria-hidden="true">{categorySymbols[group.id]}</span><div><h2>{group.name}</h2><p>{group.description}</p></div></div>{rows(features.filter(f => f.category === category))}</> : categoryTiles}</div>;
  }

  if (variant === 'A1') return <div className="home-basic">
    <section className="home-portrait-hero"><span className={`pill ${warning ? 'warn' : 'good'}`}>{warning ? '接続を1件確認' : '接続は良好です'}</span><h2>今日も、いつもの配信を。</h2>{sourceStatus}<button className="primary" onClick={() => open('sources')}>接続先を確認 <span aria-hidden="true">↗</span></button></section>
    <div className="section-heading"><h2>よく使う操作</h2><span>ここから切り替え</span></div>
    <div className="home-action-list">{controlItems.map(item => <button key={item.key} aria-label={`${item.label}を切り替え`} aria-pressed={Boolean(values[item.key])} onClick={() => update(item.key, !values[item.key])}><span className="action-symbol" aria-hidden="true">{item.symbol}</span><span><strong>{item.label}</strong><small>{item.hint}</small></span><span className={`pill ${values[item.key] ? 'good' : ''}`}>{values[item.key] ? 'オン' : 'オフ'}</span></button>)}</div>
    <div className="section-heading"><h2>設定を調整</h2><button className="text-button" onClick={showSettings}>すべての設定 →</button></div>
    <div className="home-favorite-links">{['speech', 'ai', 'overlay', 'mobile'].map(id => { const f = features.find(f => f.id === id)!; return <button key={id} onClick={() => open(id)}>{f.name}<span aria-hidden="true">›</span></button>; })}</div>
  </div>;

  if (variant === 'A2') return <div className="home-pocket">
    <section className="home-pocket-summary"><div><span className="home-live-mark" /><strong>配信のコントロール</strong><button onClick={() => open('sources')}>接続先 ↗</button></div>{sourceStatus}</section>
    <div className="home-control-grid">{[...controlItems, { key: 'characterOn', label: 'キャラクター', symbol: '◇', hint: '独立ウィンドウ' }].map(item => <button key={item.key} aria-label={`${item.label}を切り替え`} aria-pressed={Boolean(values[item.key])} onClick={() => update(item.key, !values[item.key])}><span className="control-grid-top"><span aria-hidden="true">{item.symbol}</span><span className={`pill ${values[item.key] ? 'good' : ''}`}>{values[item.key] ? 'オン' : 'オフ'}</span></span><strong>{item.label}</strong><small>{item.hint}</small></button>)}</div>
    <section className="home-comment-sample"><div className="section-heading"><h2>コメントの様子</h2><span>サンプル</span></div><p><span>はるか</span>こんばんは！ 今日も楽しみです。</p><p><span>そら</span>声、きれいに聞こえています。</p><button className="text-button" onClick={() => open('commentList')}>コメント一覧の設定 →</button></section>
    <div className="home-setting-callout"><div><strong>声や見た目を変えたいときは</strong><p>「設定」からまとめて探せます。</p></div><button onClick={showSettings}>設定へ →</button></div>
  </div>;

  return <div className="home-directory"><section className="home-status-ledger"><div><strong>接続状況</strong><button className="text-button" onClick={() => open('sources')}>接続先を確認 ↗</button></div>{sourceStatus}<p>いつもの操作は画面下部から切り替えられます。</p></section>
    <div className="section-heading"><h2>設定へのショートカット</h2><span>分類から選ぶ</span></div>{categoryTiles}
    <section className="home-listener-note"><span aria-hidden="true">✧</span><div><strong>{String(values.persona)}</strong><p>AIリスナー · {values.aiOn ? '稼働中' : '停止中'}</p></div><button onClick={() => open('ai')}>人格を編集</button></section>
  </div>;
}
