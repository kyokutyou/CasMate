import type { SpeechRecognitionState } from '../../shared/types';
export const runtimeLabels: Record<SpeechRecognitionState['status'], string> = {
  disabled: '停止中', waitingForInput: 'スマホ音声待ち', preparing: '準備中', listening: '発話待ち', speechDetected: '発話検出', recognizing: '認識中', unavailable: '利用不可',
};
export const runtimeHelp: Record<SpeechRecognitionState['status'], string> = {
  disabled: 'プレビューを開始して話してください。',
  waitingForInput: '選択したスマホで映像・マイク送信を開始してください。',
  preparing: '準備が終わるまでお待ちください。',
  listening: '話し終わると結果を表示します。',
  speechDetected: '話し終わると認識します。',
  recognizing: '',
  unavailable: '入力・モデルを確認して再試行してください。',
};
export const modelLabels: Record<SpeechRecognitionState['modelStatus'], string> = {
  missing: '未取得', downloading: '取得中', extracting: '展開中', validating: '検証中', ready: '準備済み', failed: '取得失敗',
};
