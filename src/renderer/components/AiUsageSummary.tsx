import { emptyAiApiUsage, emptyAiOutcomes, type AiTokenTotal, type AiUsage } from '../../shared/ai-usage';

const number = (value: number) => value.toLocaleString('ja-JP');
const tokens = (value: AiTokenTotal) => value.responses === 0 ? '未取得' : `${number(value.tokens)}トークン（取得${number(value.responses)}件）`;

export function AiUsageSummary({ usage }: { usage?: AiUsage }) {
  const { api, outcomes } = usage ?? { api: emptyAiApiUsage(), outcomes: emptyAiOutcomes() };
  return <div className="ai-usage" aria-label="今回の起動中のAPI使用量" tabIndex={0}>
    <table><caption>API送信とトークン</caption><tbody>
      <tr><th scope="row">API送信試行</th><td>{number(api.requests)}回</td></tr><tr><th scope="row">処理中</th><td>{number(api.pending)}件</td></tr>
      <tr><th scope="row">入力</th><td>{tokens(api.input)}</td></tr><tr><th scope="row">出力</th><td>{tokens(api.output)}</td></tr><tr><th scope="row">全体</th><td>{tokens(api.total)}</td></tr>
    </tbody></table>
    <table><caption>通常生成の結果</caption><tbody>{([['投稿成功', outcomes.succeeded], ['見送り', outcomes.skipped], ['取消', outcomes.cancelled], ['失敗', outcomes.failed], ['結果不明', outcomes.unknown]] as const).map(([label, count]) => <tr key={label}><th scope="row">{label}</th><td>{number(count)}件</td></tr>)}</tbody></table>
    <p>送信回数はAPIテスト・テスト生成も含みます。トークンは取得できた応答だけの合計で、未取得分や取消した要求にも費用が生じる場合があります。全体には思考などのトークンが含まれ、入力＋出力とは一致しない場合があります。</p>
    <p>今回の起動中だけの集計です。停止・再開では保持し、アプリの再起動で0に戻ります。モデルを変更した場合も合計し、実請求額を示すものではありません。</p>
  </div>;
}
