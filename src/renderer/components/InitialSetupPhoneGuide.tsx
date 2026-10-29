import type { SmartphoneUse } from '../../shared/initial-setup';
import type { ReactNode } from 'react';
import './initial-setup-phone-guide.css';

/** Operation diagrams follow Android CasMateTabs; they never represent live state. */
export function InitialSetupPhoneGuide({ uses, speechControls, helpOpen, onHelpToggle }: { uses: SmartphoneUse[]; speechControls?: ReactNode; helpOpen: Partial<Record<SmartphoneUse, boolean>>; onHelpToggle(use: SmartphoneUse, open: boolean): void }) {
  return <div className="setup-phone-guides">
    <p className="muted">図解はAndroidの操作位置です。実際の接続状態を示すものではありません。</p>
    {uses.includes('comments') && <section className="setup-phone-guide" aria-labelledby="setup-phone-comments-title">
      <h4 id="setup-phone-comments-title">コメントを見る</h4>
      <PhoneControls kind="comments" />
      <ol><li>Android上部の<strong>「コメント」タブ</strong>を開く。</li><li>PCで<strong>コメントサービスに接続</strong>し、新しいコメントを待つ。</li></ol>
      <p className="setup-phone-check"><strong>確認</strong>PCとスマホに、同じ新しいコメントが表示される。</p>
      <details id="setup-phone-comments-help" className="setup-phone-troubleshooting" open={helpOpen.comments ?? false} onToggle={event => onHelpToggle('comments', event.currentTarget.open)}><summary>コメントが表示されないとき</summary><ul>
        <li>スマホの<strong>連携先・接続方法</strong>を確認。</li>
        <li>PCの<strong>コメント接続</strong>を確認。</li>
        <li>新しいコメントが届くのを待つ。届くまでは表示確認できません。</li>
      </ul></details>
    </section>}
    {uses.includes('speech') && <section className="setup-phone-guide" aria-labelledby="setup-phone-audio-title">
      <h4 id="setup-phone-audio-title">読み上げを聞く</h4>
      <PhoneControls kind="speech" />
      <ol><li>Android上部の<strong>「コメント」タブ</strong>を開く。</li><li>右上の<strong>ヘッドホンをON</strong>にする。<span className="setup-phone-step-note">すでにONなら、そのままで大丈夫です。</span></li><li>このPC画面の<strong>「この声を試聴」</strong>を押す。</li></ol>
      {speechControls}
      <p className="setup-phone-check"><strong>確認</strong>スマホでテスト音声が聞こえる。</p>
      <details id="setup-phone-audio-help" className="setup-phone-troubleshooting" open={helpOpen.speech ?? false} onToggle={event => onHelpToggle('speech', event.currentTarget.open)}><summary>読み上げが聞こえないとき</summary><ul>
        <li>スマホの<strong>メディア音量・Bluetoothの出力先</strong>を確認。</li>
        <li>ヘッドホン左隣の<strong>歯車 →「コメント設定と状態」</strong>で、接続状態・失敗理由を確認。</li>
      </ul></details>
    </section>}
    {uses.includes('video') && <section className="setup-phone-guide" aria-labelledby="setup-phone-video-title">
      <h4 id="setup-phone-video-title">映像・配信マイクを送る</h4>
      <PhoneControls kind="video" />
      <ol>
        <li>Android上部の<strong>「カメラ」タブ</strong>を開く。</li>
        <li>タブ右隣の<strong>電波のアイコン（送信・配信）</strong>を押す。</li>
        <li>「スマホの送信」の<strong>「送信を開始」</strong>を押す。
          <span className="setup-phone-step-note">すでに送信中なら、押し直す必要はありません。</span>
          <div className="setup-phone-permission-note"><strong>初回などに権限確認が出たら</strong><p>カメラ・マイク・通知・LANの権限を許可。</p><p>権限を許可した後、「送信・配信」で<strong>「送信を開始」をもう一度</strong>押します。</p></div>
        </li>
        <li>このPCの端末欄で<strong>「受信中」</strong>と受信データ量を確認する。</li>
      </ol>
      <div className="setup-phone-check"><strong>このPCで受信を確認</strong><p>端末欄が「受信中」で、受信データ量が0より大きいことを確かめてから、下の確認欄にチェックします。</p></div>
      <p className="setup-phone-step-note"><strong>送信を止める：</strong>Androidの「スマホの送信」→「送信を停止」。</p>
      <details id="setup-phone-video-help" className="setup-phone-troubleshooting" open={helpOpen.video ?? false} onToggle={event => onHelpToggle('video', event.currentTarget.open)}><summary>映像・マイクが届かないとき</summary><dl>
        <div><dt>受信待ちのまま</dt><dd>PCとスマホの接続方法・連携先を確認し、Androidで「送信を開始」を押してください。</dd></div>
        <div><dt>映像だけ届く</dt><dd>Androidの「カメラ」右端のスライダー（映像・マイク）→「マイク」で、入力マイク・ミュート・音量を確認。</dd></div>
      </dl></details>
    </section>}
  </div>;
}

function PhoneControls({ kind }: { kind: 'comments' | 'speech' | 'video' }) {
  const camera = kind === 'video';
  return <figure className="setup-phone-controls"><svg viewBox={camera ? '0 0 320 284' : '0 0 320 122'} role="img" aria-label={camera ? 'Androidで1番のカメラ、2番の電波アイコン、スマホの送信にある3番の送信を開始を順に押す' : kind === 'speech' ? 'Androidの上部で1番のコメント、2番の右端のヘッドホンを順に押す' : 'Androidの上部で1番のコメントタブを押す'}>
    <rect x="1" y="1" width="318" height={camera ? 282 : 120} rx="14" fill="#f5f7f3" stroke="#b8c8bf" />
    <rect x={camera ? 5 : 87} y="8" width="78" height="45" rx="12" fill="#dcebe1" />
    <g fill="#236245" fontFamily="sans-serif" fontSize="14" textAnchor="middle"><text x="44" y="36">カメラ</text><text x="126" y="36">コメント</text></g>
    {camera && <g transform="translate(180 18)" fill="none" stroke="#236245" strokeWidth="1.8" strokeLinecap="round"><path d="M8.5 8.5C6.5 10.5 6.5 13.5 8.5 15.5M15.5 8.5C17.5 10.5 17.5 13.5 15.5 15.5M5 5C1 9 1 15 5 19M19 5C23 9 23 15 19 19" /><circle cx="12" cy="12" r="2" fill="#236245" stroke="none" /></g>}
    <g transform={`translate(${camera ? 228 : 180} 18)`} fill="none" stroke="#236245" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M8 2.5H16Q18 2.5 18 4.5V19.5Q18 21.5 16 21.5H8Q6 21.5 6 19.5V4.5Q6 2.5 8 2.5ZM12 17.5V17.6" /></g>
    <g transform={`translate(${camera ? 276 : 228} 18)`} fill="none" stroke="#236245" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d={camera ? 'M4 6H9M13 6H20M11 3V9M4 12H15M19 12H20M17 9V15M4 18H5M9 18H20M7 15V21' : 'M10 3H14L14.6 5.4L16.7 6.6L19.1 5.9L21.1 9.3L19.3 11V13L21.1 14.7L19.1 18.1L16.7 17.4L14.6 18.6L14 21H10L9.4 18.6L7.3 17.4L4.9 18.1L2.9 14.7L4.7 13V11L2.9 9.3L4.9 5.9L7.3 6.6L9.4 5.4ZM15.5 12A3.5 3.5 0 1 1 8.5 12A3.5 3.5 0 1 1 15.5 12'} /></g>
    {!camera && <g transform="translate(276 18)" fill="none" stroke="#236245" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M3 14V12A9 9 0 0 1 21 12V14M3 13H6V21H3ZM18 13H21V21H18Z" /></g>}
    <GuideMark x={camera ? 44 : 126} number="1" label={camera ? 'カメラ' : 'コメント'} />
    {kind !== 'comments' && <GuideMark x={camera ? 192 : 288} number="2" label={camera ? '送信・配信' : 'ヘッドホン'} />}
    {camera && <g fontFamily="sans-serif"><rect x="17" y="129" width="286" height="138" rx="14" fill="white" stroke="#b8c8bf" /><text x="32" y="152" fill="#294f3d" fontSize="13">送信・配信</text><text x="32" y="178" fill="#294f3d" fontSize="14">スマホの送信</text><rect x="32" y="191" width="211" height="39" rx="19" fill="#236245" stroke="#ae4c17" strokeWidth="2.5" /><text x="138" y="216" textAnchor="middle" fill="white" fontSize="15">送信を開始</text><circle cx="269" cy="211" r="12" fill="#ae4c17" /><text x="269" y="216" textAnchor="middle" fill="white" fontSize="14">3</text><text x="32" y="251" fill="#294f3d" fontSize="12">PCの端末欄で受信を確認します</text></g>}
  </svg><figcaption>Android上部の操作位置。配色や表示サイズは端末の設定で変わります。</figcaption></figure>;
}
function GuideMark({ x, number, label }: { x: number; number: string; label: string }) {
  return <g><rect x={x - (number === '1' ? 39 : 19)} y="8" width={number === '1' ? 78 : 38} height="45" rx="10" fill="none" stroke="#ae4c17" strokeWidth="2.5" /><path d={`M${x} 54V65`} stroke="#ae4c17" strokeWidth="2" /><circle cx={x} cy="77" r="11" fill="#ae4c17" /><text x={x} y="82" textAnchor="middle" fill="white" fontSize="14" fontFamily="sans-serif">{number}</text><text x={x > 260 ? x - 8 : x} y="109" textAnchor="middle" fill="#294f3d" fontSize="12" fontFamily="sans-serif">{label}</text></g>;
}
