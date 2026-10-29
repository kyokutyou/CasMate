import { describe, expect, it } from 'vitest';
import { aiGuideTone, aiRuntimeGuide, aiRuntimeWaiting, aiServiceGuide } from '../src/renderer/ai-listener-guidance';
import { defaultAiSettings, type AiView } from '../src/shared/ai-listener';
const service = { ready: false, message: '', account: null, latest: null };
const initial: AiView = { requested: false, status: 'stopped', message: '停止中', nextAt: null, memoryCharacters: 0, hasKey: true, authorization: null,
  postingBudget: { used: 0, limit: 60, nextAllowedAt: null }, services: { youtube: service, twitch: service, shitaraba: service, jpnkn: service } };
function prepared() {
  const settings = defaultAiSettings();settings.personas = [{ id: 'p', name: '相棒', personality: '', tone: '', firstPerson: '', topics: '', notes: '' }];
  settings.participants.jpnkn = { enabled: true, personaId: 'p' };
  return settings;
}
describe('AIの次の操作の案内', () => {
  it('待機理由と注意色を準備・復旧・上限・停止で区別する', () => {
    for (const [label, current, next, tone] of [
      ['準備が必要', '設定を待っています', '準備完了後', 'warning'],
      ['停止中', '開始を待っています', '開始後', 'neutral'],
      ['確認が必要', '確認後の再開待ち', '再開後', 'warning'],
      ['OBS接続待ち', '接続の復旧を待っています', '接続復旧後', 'warning'],
      ['上限による待機', '会話は記憶しています', '上限解除後', 'warning'],
    ]) {
      expect(aiRuntimeWaiting({ label, reason: '', primary: { kind: 'start', label: '開始' } })).toEqual({ current, next });
      expect(aiGuideTone(label)).toBe(tone);
    }
    expect(aiGuideTone('準備完了')).toBe('success');expect(aiGuideTone('人格を選んでください')).toBe('warning');
  });
  it('キー・参加先・人格・コメント接続を具体的に案内する', () => {
    const settings = defaultAiSettings();
    expect(aiRuntimeGuide(settings, { ...initial, hasKey: false }).primary).toMatchObject({ kind: 'tab', tab: 'connections' });
    expect(aiRuntimeGuide(settings, initial).primary).toMatchObject({ tab: 'participants', label: '参加先を選ぶ' });
    settings.participants.jpnkn.enabled = true;
    expect(aiRuntimeGuide(settings, initial).primary).toMatchObject({ tab: 'personas', label: '人格を追加' });
    const filled = prepared();filled.participants.jpnkn.personaId = '';
    expect(aiRuntimeGuide(filled, initial).primary).toMatchObject({ tab: 'participants', source: 'jpnkn', label: '人格を選ぶ' });
    const disconnected = { ...initial, services: { ...initial.services, jpnkn: { ...service, message: 'コメント取得を待っています。' } } };
    expect(aiRuntimeGuide(prepared(), disconnected)).toMatchObject({ primary: { kind: 'start' }, secondary: { kind: 'editor', editor: 'sources' } });
    expect(aiRuntimeGuide(prepared(), { ...disconnected, requested: true })).toMatchObject({ primary: { kind: 'editor', editor: 'sources' }, secondary: { kind: 'stop' } });
  });
  it('1サービスが準備完了なら、未連携の別サービスを開始の妨げにしない', () => {
    const settings = prepared();settings.participants.youtube.enabled = true;
    const view = { ...initial, services: { ...initial.services, jpnkn: { ...service, ready: true } } };
    expect(aiRuntimeGuide(settings, view)).toMatchObject({ label: '停止中', reason: 'jpnknで開始できます。', primary: { kind: 'start' } });
    expect(aiServiceGuide(settings, view, 'youtube')).toMatchObject({ label: 'アカウント未連携', action: { tab: 'connections', source: 'youtube' } });
  });
  it('稼働・OBS待ち・音声認識待ち・上限待機を区別し、要求取消を残す', () => {
    const settings = prepared();
    expect(aiRuntimeGuide(settings, { ...initial, requested: true, status: 'running' }).primary.kind).toBe('stop');
    expect(aiRuntimeGuide(settings, { ...initial, requested: true, message: 'OBS接続・配信状態の確認待ちです。' })).toMatchObject({ primary: { editor: 'obsControl' }, secondary: { kind: 'stop' } });
    expect(aiRuntimeGuide(settings, { ...initial, requested: true, message: '音声認識を待っています。' })).toMatchObject({ primary: { editor: 'speechRecognition' }, secondary: { kind: 'stop' } });
    expect(aiRuntimeGuide(settings, { ...initial, requested: true, status: 'running', postingBudget: { used: 60, limit: 60, nextAllowedAt: 123 } })).toMatchObject({ label: '上限による待機', primary: { kind: 'stop' } });
    settings.mode = 'obs';expect(aiRuntimeGuide(settings, initial).secondary).toEqual({ kind: 'stop', label: '自動開始を止める' });
  });
  it('結果不明は確認へ案内し、通常の接続待ちや復旧済みでは再開を要求しない', () => {
    const settings = prepared(), failed = { ...initial, services: { ...initial.services, jpnkn: { ...service, message: '投稿結果が不明です。' } } };
    expect(aiRuntimeGuide(settings, failed)).toMatchObject({ primary: { kind: 'latest', source: 'jpnkn' }, secondary: { kind: 'resume', source: 'jpnkn' } });
    expect(aiServiceGuide(settings, { ...initial, services: { ...initial.services, jpnkn: { ...service, message: 'コメント取得を待っています。' } } }, 'jpnkn').recover).toBe(false);
    expect(aiServiceGuide(settings, { ...failed, services: { ...failed.services, jpnkn: { ...failed.services.jpnkn, ready: true } } }, 'jpnkn').recover).toBe(false);
    settings.participants.jpnkn.enabled = false;expect(aiServiceGuide(settings, failed, 'jpnkn')).toMatchObject({ label: '未参加', recover: false });
  });
  it('全体の確認待ちは設定不足より実際のエラーを優先する', () => {
    expect(aiRuntimeGuide(defaultAiSettings(), { ...initial, hasKey: false, status: 'attention', message: '記憶を読めません。' })).toMatchObject({ label: '確認が必要', reason: '記憶を読めません。', primary: { tab: 'memory' }, secondary: { kind: 'resume' } });
    expect(aiRuntimeGuide(defaultAiSettings(), { ...initial, status: 'attention', message: '共有記憶・発言ログ・投稿枠を保存できません。復旧後に再開してください。' }).primary).toMatchObject({ tab: 'memory' });
  });
});
