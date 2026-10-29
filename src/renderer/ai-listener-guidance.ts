import { aiSources, type AiSettings, type AiView } from '../shared/ai-listener';
import { sourceLabels } from './messages';

export type AiSource = typeof aiSources[number];
export type AiGuideAction =
  | { kind: 'tab'; label: string; tab: 'connections' | 'participants' | 'personas' | 'memory'; source?: AiSource }
  | { kind: 'editor'; label: string; editor: 'obsControl' | 'sources' | 'speechRecognition' }
  | { kind: 'latest'; label: string; source?: AiSource }
  | { kind: 'start'; label: string; source?: AiSource }
  | { kind: 'stop'; label: string; source?: AiSource }
  | { kind: 'resume'; label: string; source?: AiSource };
export interface AiServiceGuide { label: string; detail: string; action?: AiGuideAction; recover: boolean }
export interface AiRuntimeGuide { label: string; reason: string; primary: AiGuideAction; secondary?: AiGuideAction }

export function aiGuideTone(label: string): 'neutral' | 'success' | 'warning' {
  return ['停止中', '未参加'].includes(label) ? 'neutral' : ['稼働中', '準備完了'].includes(label) ? 'success' : 'warning';
}

/** Explain idle phases without inventing a scheduled posting time. */
export function aiRuntimeWaiting(guide: AiRuntimeGuide): { current: string; next: string } {
  switch (guide.label) {
    case '準備が必要': return { current: '設定を待っています', next: '準備完了後' };
    case '停止中': return { current: '開始を待っています', next: '開始後' };
    case '確認が必要': return { current: '確認後の再開待ち', next: '再開後' };
    case 'OBS接続待ち': return { current: '接続の復旧を待っています', next: '接続復旧後' };
    case '認識の準備待ち': return { current: '音声認識の準備待ち', next: '認識準備後' };
    case '配信開始待ち': return { current: 'OBS配信開始待ち', next: '配信開始後' };
    case '上限による待機': return { current: '会話は記憶しています', next: '上限解除後' };
    case '稼働中': return { current: '会話を聞いています', next: '条件が整ってから' };
    default: return { current: '設定と接続を確認しています', next: '条件が整ってから' };
  }
}

export function aiServiceGuide(settings: AiSettings, view: AiView, source: AiSource): AiServiceGuide {
  const participant = settings.participants[source], service = view.services[source];
  const board = source === 'shitaraba' || source === 'jpnkn';
  if (!participant.enabled) return { label: '未参加', detail: board ? '参加をオンにすると、接続中の掲示板を使います。' : '参加するには投稿アカウントの連携が必要です。', recover: false };
  if (!board && !service.account) return { label: 'アカウント未連携', detail: '「連携」タブで投稿用アカウントを登録してください。', action: { kind: 'tab', label: '投稿アカウントを連携', tab: 'connections', source }, recover: false };
  if (!settings.personas.some(p => p.id === participant.personaId)) return { label: '人格を選んでください', detail: settings.personas.length ? '参加する人格を選んでください。' : '先に人格を1人追加してください。', action: { kind: 'tab', label: settings.personas.length ? '人格を選ぶ' : '人格を追加', tab: settings.personas.length ? 'participants' : 'personas', source }, recover: false };
  if (service.ready) return { label: '準備完了', detail: board ? '接続済み・アカウント連携不要' : service.account ?? '', recover: false };
  if (service.message === 'コメント取得を待っています。') return { label: '接続待ち', detail: service.message, action: { kind: 'editor', label: 'コメントの接続先を確認', editor: 'sources' }, recover: false };
  if (service.message) return { label: '確認が必要', detail: service.message, action: { kind: 'latest', label: '投稿結果を確認', source }, recover: true };
  return { label: '準備を確認中', detail: '設定の反映と接続状態を待っています。', recover: false };
}

export function aiRuntimeGuide(settings: AiSettings, view: AiView): AiRuntimeGuide {
  const enabled = aiSources.filter(s => settings.participants[s].enabled);
  const stop: AiGuideAction = { kind: 'stop', label: view.status === 'running' ? '停止' : '開始要求を取り消す' };
  const resume: AiGuideAction = { kind: 'resume', label: '確認後に再開' };
  if (view.status === 'attention') {
    if (/記憶|ログ|保存|投稿枠|時計/.test(view.message)) return { label: '確認が必要', reason: view.message, primary: { kind: 'tab', label: '記憶・ログを確認', tab: 'memory' }, secondary: resume };
    if (/投稿|送信結果|照合/.test(view.message)) return { label: '確認が必要', reason: view.message, primary: { kind: 'latest', label: '投稿結果を確認' }, secondary: resume };
    const tab = /Gemini|API|モデル|認証|資格|生成|利用枠|HTTP/.test(view.message) ? 'connections' : 'memory';
    return { label: '確認が必要', reason: view.message, primary: { kind: 'tab', label: tab === 'connections' ? '連携設定を確認' : '記憶・ログを確認', tab }, secondary: resume };
  }
  if (view.requested && ['OBS接続・配信状態の確認待ちです。', 'OBS配信先への再接続待ちです。'].includes(view.message)) return { label: 'OBS接続待ち', reason: view.message, primary: { kind: 'editor', label: 'OBS設定を開く', editor: 'obsControl' }, secondary: stop };
  if (view.requested && view.status === 'running') return { label: view.postingBudget.used >= view.postingBudget.limit ? '上限による待機' : '稼働中', reason: view.message, primary: stop };
  if (view.requested && /音声認識/.test(view.message)) return { label: '認識の準備待ち', reason: view.message, primary: { kind: 'editor', label: '音声認識の設定を確認', editor: 'speechRecognition' }, secondary: stop };
  if (view.requested && view.message === 'OBS配信開始待ちです。') return { label: '配信開始待ち', reason: view.message, primary: stop };
  const secondary: AiGuideAction | undefined = view.requested ? stop : settings.mode === 'obs' ? { kind: 'stop', label: '自動開始を止める' } : undefined;
  const missing = (reason: string, primary: AiGuideAction): AiRuntimeGuide => ({ label: '準備が必要', reason, primary, secondary });
  if (!view.hasKey) return missing('Gemini APIキーが登録されていません。', { kind: 'tab', label: 'APIキーを登録', tab: 'connections' });
  if (!enabled.length) return missing('参加するサービスをオンにしてください。', { kind: 'tab', label: '参加先を選ぶ', tab: 'participants' });
  const guides = enabled.map(source => ({ source, guide: aiServiceGuide(settings, view, source) }));
  const ready = guides.filter(item => item.guide.label === '準備完了');
  if (ready.length) return view.requested ? { label: '準備中', reason: view.message, primary: stop }
    : { label: '停止中', reason: `${ready.map(item => sourceLabels[item.source]).join('・')}で開始できます。`, primary: { kind: 'start', label: '開始' }, secondary };
  const connectionWait = guides.filter(item => item.guide.label === '接続待ち');
  if (!view.requested && connectionWait.length) return { label: '停止中', reason: `${connectionWait.map(item => sourceLabels[item.source]).join('・')}：開始するとコメント取得を開始します。`, primary: { kind: 'start', label: '開始' }, secondary: { kind: 'editor', label: 'コメントの接続先を確認', editor: 'sources' } };
  const failed = guides.find(item => item.guide.recover);
  if (failed) return { label: '確認が必要', reason: `${sourceLabels[failed.source]}：${failed.guide.detail}`, primary: { kind: 'latest', label: '投稿結果を確認', source: failed.source }, secondary: { ...resume, source: failed.source } };
  const missingGuide = guides.find(item => item.guide.label === 'アカウント未連携') ?? guides.find(item => item.guide.label === '人格を選んでください') ?? guides.find(item => item.guide.action);
  if (missingGuide?.guide.action) return missing(`${sourceLabels[missingGuide.source]}：${missingGuide.guide.detail}`, missingGuide.guide.action);
  return { label: '準備を確認中', reason: view.requested ? view.message : '保存済みの設定と接続状態を確認しています。', primary: view.requested ? stop : { kind: 'tab', label: '参加先を確認', tab: 'participants' }, secondary: view.requested ? undefined : secondary };
}
