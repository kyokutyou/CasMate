import type { IncomingComment } from '../../shared/types';

export function createTestComment(testId: string, index: number): IncomingComment {
  const texts = ['OBS受信テストです', 'コメントが順番に届きます', '長めのテストコメントです。文字の折り返しや背景の広がり、コメント同士の間隔を確認してください。', '改行のあるテストコメントです。\n2行目も確認できます。', '読み上げと表示を確認します', 'www', '積み上げの位置を確認します', '最後のテストコメントです'];
  const sample = index % texts.length;
  return { externalId: `casmate-test-${testId}`, source: (['youtube', 'twitch', 'shitaraba', 'jpnkn'] as const)[sample % 4],
    authorName: `テスト${sample + 1}`, content: [{ type: 'text', text: texts[sample] }], initialHistory: false };
}
