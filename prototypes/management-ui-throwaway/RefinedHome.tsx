// THROWAWAY: refine A's operational home, using fictional in-memory state only.
import { categories, features, type Values } from './model';

type Props = {
  page: 'home' | 'settings'; values: Values; warning: boolean;
  open(id: string): void; update(key: string, value: string | boolean): void;
  reconnect(): void; showSettings(): void;
};

export function RefinedHome({ page, values, warning, open, update, reconnect, showSettings }: Props) {
  if (page === 'settings') return <div className="category-grid refined-categories">{categories.map(c => <section className="category-card" key={c.id}>
    <div className="category-title"><h2>{c.id === 'app' ? 'OBS連携・アプリ' : c.name}</h2></div>
    <div className="feature-rows">{features.filter(f => f.category === c.id).map(f => <button className="feature-row" key={f.id} onClick={() => open(f.id)}><span><strong>{f.name}</strong><small>{f.description}</small></span><span aria-hidden="true">›</span></button>)}</div>
  </section>)}</div>;

  const speechReady = values.demoSpeechReady !== false;
  const aiHeld = Boolean(values.aiOn && values.demoAiHold);
  return <div className="refined-home">
    <section aria-label="コメントの接続状況" className="refined-connections">
      {[
        { id: 'youtube', name: 'YouTube Live', key: 'demoYoutubeConnected' },
        { id: 'twitch', name: 'Twitch', key: 'demoTwitchConnected' },
        { id: 'shitaraba', name: 'したらば', key: 'demoShitarabaConnected' },
      ].map(source => {
        const connected = values[source.key] !== false;
        const failed = source.id === 'twitch' && warning;
        return <article key={source.id} className={failed ? 'needs-attention' : ''}>
          <div className="connection-line"><strong>{source.name}</strong><span className={`pill ${failed ? 'warn' : connected ? 'good' : ''}`}>{failed ? '接続切れ' : connected ? '接続中' : '停止中'}</span></div>
          <button className="connection-destination" aria-label={`${source.name}の接続先を変更`} title={String(values[source.id])} onClick={() => open('sources')}>{String(values[source.id])}<span aria-hidden="true"> ↗</span></button>
          <div className="connection-action"><small>{failed ? 'コメント取得が止まっています' : connected ? '新着コメントを待っています' : 'コメント取得を停止しています'}</small><button aria-label={`${source.name}を${failed ? '再接続' : connected ? '停止' : '接続'}`} onClick={() => { if (failed) { update(source.key, true); reconnect(); } else update(source.key, !connected); }}>{failed ? '再接続' : connected ? '停止' : '接続'}</button></div>
        </article>;
      })}
    </section>
    <section aria-labelledby="support-heading">
      <div className="section-heading"><h2 id="support-heading">配信支援</h2><span>設定と、現在の動作を確認</span></div>
      <div className="refined-support">
        <article>
          <div className="support-heading"><button onClick={() => open('speech')}>コメント読み上げ <span aria-hidden="true">›</span></button><span className="pill">{values.speechOn ? 'オン' : 'オフ'}</span></div>
          <p className={values.speechOn ? 'operating-state' : ''}>{!values.speechOn ? '停止中' : speechReady ? '新着コメント待ち' : 'VOICEVOXの準備中'}</p>
          <small>{values.speechOn && !speechReady ? '準備ができると読み上げます' : `${String(values.voice).split(' / ')[0]} · 速度 ${values.speed} · 待ち 0件`}</small>
          <button aria-label={values.speechOn ? '読み上げをオフにする' : '読み上げをオンにする'} onClick={() => update('speechOn', !values.speechOn)}>{values.speechOn ? 'オフにする' : 'オンにする'}</button>
        </article>
        <article className={aiHeld ? 'needs-attention' : ''}>
          <div className="support-heading"><button onClick={() => open('ai')}>AIリスナー <span aria-hidden="true">›</span></button><span className={`pill ${aiHeld ? 'warn' : ''}`}>{aiHeld ? '確認が必要' : values.aiOn ? '稼働' : '停止'}</span></div>
          <p className={values.aiOn ? 'operating-state' : ''}>{aiHeld ? '手動再開待ち' : values.aiOn ? '発言のタイミングを待機' : '停止中'}</p>
          <small>{aiHeld ? '投稿に失敗しました。確認後に再開' : `${values.persona} · ${values.aiSource}`}</small>
          <div className="support-actions"><button onClick={() => { if (aiHeld) update('demoAiHold', false); else update('aiOn', !values.aiOn); }}>{aiHeld ? '確認して再開' : values.aiOn ? 'AIを停止' : 'AIを開始'}</button>{aiHeld && <button onClick={() => open('ai')}>設定を確認</button>}</div>
        </article>
        <article>
          <div className="support-heading"><button onClick={() => open('recognition')}>配信者音声認識 <span aria-hidden="true">›</span></button><span className="pill">{values.recognitionOn ? 'オン' : 'オフ'}</span></div>
          <p className={values.recognitionOn ? 'operating-state' : ''}>{values.recognitionOn ? '発話を待機' : '停止中'}</p>
          <small>{String(values.mic)}</small>
          <button aria-label={values.recognitionOn ? '音声認識をオフにする' : '音声認識をオンにする'} onClick={() => update('recognitionOn', !values.recognitionOn)}>{values.recognitionOn ? 'オフにする' : 'オンにする'}</button>
        </article>
      </div>
    </section>
    <section className="refined-windows" aria-label="独立ウィンドウ"><h2>ウィンドウ</h2>{[['listOn', 'コメント一覧'], ['characterOn', 'キャラクター']].map(([key, name]) => <button key={key} aria-label={`${name}を${values[key] ? '閉じる' : '開く'}`} onClick={() => update(key, !values[key])}><span>{name}</span><span className={values[key] ? 'window-visible' : ''}>{values[key] ? '表示中 · 閉じる' : '開く'}</span></button>)}</section>
    <section className="refined-shortcuts" aria-label="設定への入口"><button onClick={() => open('overlay')}>OBSの見た目</button><button onClick={() => open('mobile')}>スマホで聞く</button><button onClick={() => open('outdoor')}>スマホから映像を送る</button><button onClick={showSettings}>すべての設定 →</button></section>
  </div>;
}
