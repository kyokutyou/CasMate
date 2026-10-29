import { useEffect, useId, useRef, useState } from 'react';
import { SettingsCard } from './SettingsCard';
import { ObsSourceIcon as SourceIcon } from './ObsSourceIcon';
import type { ObsSourceRegistrationEntry } from './ObsSourceRegistrationDialog';
import './obs-urls-panel.css';

const sources = [
  { id: 'comments', title: 'コメント', description: 'YouTube・Twitch・したらば・jpnknのコメントをまとめて表示。', path: '/overlay/comments' },
  { id: 'speech', title: '音声認識', description: '配信者の発話を認識し、文字で表示。', path: '/overlay/speech-recognition' },
  { id: 'character', title: 'キャラクター', description: 'コメント読み上げに合わせて動くキャラクター。', path: '/overlay/character' },
  { id: 'effects', title: '文字演出', description: '反応ワードに合わせて、文字や絵文字を降らせます。', path: '/overlay/text-effects' },
] as const;
const browserLinks = [{ title: '管理画面', path: '' }, { title: 'コメント一覧', path: '/comments' }];
interface Props {
  baseUrl: string;
  registrationWarning?: string;
  onRegisterSource?(request: ObsSourceRegistrationEntry): void;
  onSuccess(message: string): void;
  onError(message: string): void;
  onOperationStart(): void;
}


export function ObsUrlsPanel({ baseUrl, registrationWarning, onRegisterSource, onSuccess, onError, onOperationStart }: Props) {
  const id = useId();
  const [copyBusy, setCopyBusy] = useState(false);
  const copyPending = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const guide = useRef<HTMLDetailsElement>(null);
  const urlFor = (path: string) => `${baseUrl.replace(/\/$/, '')}${path}`;
  const copy = async (title: string, path: string) => {
    if (copyPending.current) return;
    copyPending.current = true; setCopyBusy(true); onOperationStart();
    try { await navigator.clipboard.writeText(urlFor(path)); onSuccess(`${title}のURLをコピーしました。`); }
    catch { onError('URLをコピーできませんでした。「手動でOBSに追加する」または「ブラウザで使う画面」を開き、URLを選択してコピーしてください。'); }
    finally { copyPending.current = false; if (mounted.current) setCopyBusy(false); }
  };
  const copyButton = (title: string, path: string) => <button type="button" className="secondary obs-urls-copy" disabled={copyBusy} aria-busy={copyBusy} aria-label={`${title}のURLをコピー`} onClick={() => void copy(title, path)}><SourceIcon name="copy"/>URLをコピー</button>;

  return <SettingsCard cardId="urls" title="OBSにソースを追加" eyebrow="OBS SOURCES" className="obs-urls-panel" navigationWarning={registrationWarning}>
    <div className="obs-urls-section-title"><div><h3>OBSに追加する表示</h3><p>表示ごとに、1つのブラウザソースを追加します。</p></div><span className="obs-urls-count">4種類</span></div>
    <section className="obs-urls-list" aria-label="OBSに追加する表示一覧">{sources.map(source => <article className="obs-urls-row" key={source.id} aria-label={source.title}>
      <div className="obs-urls-info"><div className="obs-urls-card-heading"><span className="obs-urls-icon"><SourceIcon name={source.id}/></span><h4>{source.title}</h4></div><p>{source.description}</p></div>
      <div className="obs-urls-actions"><button type="button" id={`obs-registration-entry-${source.id}`} className="secondary obs-urls-add" aria-label={`${source.title}をOBSに追加`} aria-haspopup={onRegisterSource ? 'dialog' : undefined} aria-controls={onRegisterSource ? 'obs-source-registration-dialog' : `${id}-manual-guide`} onClick={event => {
        if (onRegisterSource) onRegisterSource({ target: { kind: 'overlay', overlay: source.id }, title: source.title, entry: event.currentTarget });
        else if (guide.current) { guide.current.open = true; guide.current.querySelector('summary')?.focus({ preventScroll: true }); }
      }}><span aria-hidden="true">＋</span>OBSに追加</button>{copyButton(source.title, source.path)}</div>
    </article>)}</section>
    <div className="obs-urls-extras">
      <details ref={guide} id={`${id}-manual-guide`} className="obs-urls-guide"><summary><span>手動でOBSに追加する<small>URLを貼り付ける手順</small></span><span aria-hidden="true"/></summary><div className="obs-urls-detail-body">{sources.map(source => <div className="obs-urls-browser-row" key={source.id}><div><strong>{source.title}</strong><code>{urlFor(source.path)}</code></div></div>)}<ol><li><b>1</b><span>OBSの「ソース」で <strong>＋ → ブラウザ</strong> を選ぶ</span></li><li><b>2</b><span>名前を付け、<strong>URL欄に貼り付ける</strong></span></li><li><b>3</b><span>幅・高さを表示範囲に合わせ、<strong>OK</strong> を押す</span></li></ol><p>幅・高さは配信レイアウトに合わせて調整してください。</p></div></details>
      <details><summary><span>ブラウザで使う画面<small>管理画面・コメント一覧</small></span><span aria-hidden="true"/></summary><div className="obs-urls-detail-body">{browserLinks.map(link => <div className="obs-urls-browser-row" key={link.title}><div><strong>{link.title}</strong><code>{urlFor(link.path)}</code></div><div className="obs-urls-actions">{copyButton(link.title, link.path)}<button type="button" className="secondary small" aria-label={`${link.title}をブラウザで開く`} onClick={() => window.open(urlFor(link.path), '_blank', 'noopener')}>開く ↗</button></div></div>)}</div></details>
    </div>
  </SettingsCard>;
}
