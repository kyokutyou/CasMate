// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { InitialSetupReview } from '../src/renderer/components/InitialSetup';
import { SetupPresentation } from '../src/renderer/management-navigation';
import { InitialSetupStore } from '../src/main/core/initial-setup-store';
import { setupFeatures, type SetupStep } from '../src/shared/initial-setup';
import { obsRegistrationSnapshot } from './fixtures/obs-registration-state';

afterEach(cleanup);
function fixture(step: SetupStep) {
  const snapshot = obsRegistrationSnapshot();
  snapshot.sourceStatuses.youtube.state = 'connected';
  snapshot.commentSpeech.engineStatus = 'ready';
  snapshot.settings.commentSpeech.voice = { speakerUuid: 'one', styleId: 1 };
  snapshot.smartphone!.settings.activeNetwork = 'lan';
  snapshot.smartphone!.devices[0].profiles.lan.receiver = { state: 'receiving', receivedBytes: 1024 };
  snapshot.speechRecognition.modelStatus = 'ready';
  snapshot.speechRecognition.microphones = [{ id: 'default', name: '既定のマイク', isDefault: true }];
  snapshot.settings.character.simple.closedAsset = '/closed.png';
  snapshot.settings.aiListener.personas = [{ id: 'persona', name: '配信AI', personality: '', tone: '', firstPerson: '', topics: '', notes: '' }];
  snapshot.settings.aiListener.participants.shitaraba = { enabled: true, personaId: 'persona' };
  const service = { ready: true, message: '', account: null, latest: null };
  snapshot.aiListener = { postingBudget: { used: 0, limit: 60, nextAllowedAt: null }, requested: false, status: 'stopped', message: '', nextAt: null, memoryCharacters: 0, hasKey: true,
    services: { youtube: { ...service }, twitch: { ...service }, shitaraba: { ...service }, jpnkn: { ...service } }, authorization: null };
  const view = { ...new InitialSetupStore('unused', false).view(snapshot), position: step, selected: setupFeatures.map(([id]) => id), smartphoneUses: ['video' as const] };
  if (step === 'obsDisplay') view.confirmations.obsDisplay = view.fingerprints.obsDisplay;
  const props = { view, snapshot, pending: false, blocked: false, settingsPending: () => false, command: vi.fn(), perform: vi.fn(async () => true), leave: vi.fn(), open: vi.fn(), onObsSource: vi.fn(),
    disclosures: { open: {}, change: vi.fn() }, speechVoices: [{ speakerUuid: 'one', name: '話者', styles: [{ id: 1, name: '通常' }] }] };
  return props;
}
function panel(props: ReturnType<typeof fixture>) {
  return <SetupPresentation.Provider value={{ source: 'youtube', selectSource: vi.fn(), smartphoneNetwork: 'lan' }}><InitialSetupReview {...props}/></SetupPresentation.Provider>;
}
it.each(['sources', 'commentSpeech', 'smartphone', 'speechRecognition', 'obsControl', 'aiListener', 'textEffects', 'character', 'obsDisplay'] as const)('%sの準備完了を色判定し、保存エラー中は欄全体を完了色にしない', step => {
  const props = fixture(step); const result = render(panel(props));
  expect(result.container.querySelector('.setup-review')).toHaveAttribute('data-ready', 'true');
  result.rerender(panel({ ...props, blocked: true }));
  expect(result.container.querySelector('.setup-review')).toHaveAttribute('data-ready', 'false');
});
it('過去のコメント確認があっても未接続なら通常色に戻り、配信開始待ちは準備完了色にする', () => {
  const props = fixture('sources'); props.view.confirmations.sources = props.view.fingerprints.sources;
  const result = render(panel(props));
  props.snapshot.sourceStatuses.youtube.state = 'stopped'; result.rerender(panel(props));
  expect(result.container.querySelector('.setup-review')).toHaveAttribute('data-ready', 'false');
  props.snapshot.sourceStatuses.youtube.state = 'waiting'; result.rerender(panel(props));
  expect(result.container.querySelector('.setup-review')).toHaveAttribute('data-ready', 'true');
});
it('スマホは登録だけで受信完了色にせず、登録準備と受信を分ける', () => {
  const props = fixture('smartphone'); props.snapshot.smartphone!.devices[0].profiles.lan.receiver = { state: 'listening', receivedBytes: 1024 };
  const result = render(panel(props));
  expect(result.container.querySelector('.setup-review')).toHaveAttribute('data-ready', 'false');
  expect(result.getByText('スマホの登録').parentElement?.querySelector('dd')).toHaveAttribute('data-ready', 'true');
  expect(result.getByText('現在の接続').parentElement?.querySelector('dd')).toHaveAttribute('data-ready', 'false');
});
it('モデル準備済みでも選択スマホ入力が未接続なら入力と欄全体は完了色にしない', () => {
  const props = fixture('speechRecognition'); props.snapshot.settings.speechRecognition.inputSource = 'smartphone'; props.snapshot.settings.speechRecognition.smartphoneDeviceId = 'missing';
  const result = render(panel(props));
  expect(result.getByText('モデル').parentElement?.querySelector('dd')).toHaveAttribute('data-ready', 'true');
  expect(result.container.querySelector('.setup-review')).toHaveAttribute('data-ready', 'false');
});
it('OBS表示確認は過去の確認と現在の接続を区別する', () => {
  const props = fixture('obsDisplay'); const result = render(panel(props));
  props.snapshot.obsControl!.connection = 'disabled'; result.rerender(panel(props));
  expect(result.container.querySelector('.setup-review')).toHaveAttribute('data-ready', 'false');
  props.snapshot.obsControl!.connection = 'connected'; delete props.view.confirmations.obsDisplay; result.rerender(panel(props));
  expect(result.container.querySelector('.setup-review')).toHaveAttribute('data-ready', 'false');
});
it('声が未選択、AI認証不足、画像警告では準備済みに見せない', () => {
  for (const step of ['commentSpeech', 'aiListener', 'character'] as const) {
    const props = fixture(step);
    if (step === 'commentSpeech') props.snapshot.settings.commentSpeech.voice = null;
    if (step === 'aiListener') props.snapshot.settings.aiListener.participants.youtube = { enabled: true, personaId: 'persona' };
    if (step === 'character') props.snapshot.character.assetWarning = '画像を読み込めません';
    const result = render(panel(props)); expect(result.container.querySelector('.setup-review')).toHaveAttribute('data-ready', 'false'); result.unmount();
  }
});

it('声が保存済みでも読み上げ実行エラーは欄全体を成功色にしない', () => {
  const props = fixture('commentSpeech'); props.snapshot.commentSpeech.warning = 'コメントを読み上げられませんでした';
  const result = render(panel(props));
  expect(result.container.querySelector('.setup-review')).toHaveAttribute('data-ready', 'false');
  expect(result.container.querySelector('.setup-review-state strong')).toHaveAttribute('data-ready', 'false');
  expect(result.container.querySelector('.setup-voice-sample strong')).toHaveAttribute('data-ready', 'true');
});
it('Windows既定マイクが未検出なら準備済み色にせず、既定入力を検出後に色を変える', () => {
  const props = fixture('speechRecognition'); props.snapshot.speechRecognition.microphones = [];
  const result = render(panel(props));
  expect(result.container.querySelector('.setup-review')).toHaveAttribute('data-ready', 'false');
  props.snapshot.speechRecognition.microphones = [{ id: 'default', name: '既定のマイク', isDefault: true }]; result.rerender(panel(props));
  expect(result.container.querySelector('.setup-review')).toHaveAttribute('data-ready', 'true');
});
