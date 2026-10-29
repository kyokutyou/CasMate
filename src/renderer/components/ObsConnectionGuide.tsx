/** Keep the OBS-side preparation steps consistent in setup and normal settings. */
export function ObsConnectionGuide({ initialSetup }: { initialSetup: boolean }) {
  return <>
    <ol>
      <li>このPCでOBSを起動します。未導入なら<a href="https://obsproject.com/" target="_blank" rel="noreferrer">OBS公式サイト</a>から入手できます。</li>
      <li>OBSの<strong>「ツール」→「WebSocketサーバー設定」</strong>を開き、<strong>「WebSocketサーバーを有効にする」</strong>と<strong>「認証を有効にする」</strong>にチェックします。</li>
      <li><strong>「適用」</strong>でOBS側の変更を保存します。</li>
      <li><strong>「接続情報を表示」</strong>でサーバーポートとサーバーパスワードを確認し、元の設定画面の<strong>「OK」</strong>で閉じます。</li>
      <li>この画面に同じポートとパスワードを入力します。{initialSetup ? <ul>
        <li><strong>「OBSに接続する」</strong>があるときは、そのボタンを押します。</li>
        <li><strong>接続中</strong>は待ちます。<strong>接続済み</strong>なら押し直し不要です。</li>
        <li><strong>接続不可</strong>なら接続情報を確認し、<strong>「OBS接続を再試行」</strong>を押します。</li>
      </ul> : <><strong>「OBS連携」</strong>をONにします。</>}</li>
    </ol>
    <p>接続を確認するための配信開始は不要です。認証付きobs-websocket v5を使い、OBSのパスワードをAndroidへ渡しません。</p>
    {initialSetup && <p>表示だけなら、後のOBS表示確認でURLを手動登録することもできます。</p>}
    <p><a href="https://obsproject.com/kb/remote-control-guide" target="_blank" rel="noreferrer">OBS公式の接続案内</a></p>
  </>;
}
