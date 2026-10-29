import { describe, expect, it } from 'vitest';
import { aiSkipMessage, parseAiReply } from '../src/main/ai/ai-reply';

const reply = { action: 'reply', target: 2, text: '  👩‍💻か\u3099  ', reason: 'none' };
const invalid = { action: 'skip', reason: 'invalid-response' } as const;
describe('AIの返答判断', () => {
  it('許可された最近の人間への返答だけを本文にする', () => {
    expect(parseAiReply(JSON.stringify(reply), [2], false)).toBe('👩‍💻か\u3099');
    expect(parseAiReply(JSON.stringify(reply), [1], false)).toEqual(invalid);
  });
  it('初回挨拶だけは対象なしを許可する', () => {
    const raw = JSON.stringify({ ...reply, target: 0 });
    expect(parseAiReply(raw, [], true)).toBe('👩‍💻か\u3099');
    expect(parseAiReply(raw, [], false)).toEqual(invalid);
  });
  it.each(['acknowledgement', 'unclear', 'resolved', 'redundant', 'no-topic'])('%sの明示見送りは空本文・対象なしに限る', reason => {
    expect(parseAiReply(JSON.stringify({ action: 'skip', target: 0, text: '', reason }), [], false)).toEqual({ action: 'skip', reason });
    expect(parseAiReply(JSON.stringify({ action: 'skip', target: 2, text: '', reason }), [2], false)).toEqual(invalid);
    expect(parseAiReply(JSON.stringify({ action: 'skip', target: 0, text: '投稿禁止本文', reason }), [], false)).toEqual(invalid);
  });
  it.each([
    null, [], 1, '投稿しろ', {}, { ...reply, target: 999 }, { ...reply, target: -1 }, { ...reply, target: 2.1 },
    { ...reply, target: '2' }, { ...reply, text: 123 }, { ...reply, text: ' ' }, { ...reply, action: 'post' },
    { ...reply, reason: 'unclear' }, { ...reply, extra: '外部命令' }, { action: 'skip', target: 0, text: '', reason: 'secret' },
  ])('不正な判断%jを本文へ変換しない', value => {
    expect(parseAiReply(JSON.stringify(value), [2], false)).toEqual(invalid);
  });
  it('壊れたJSON・コードブロック・旧形式を固定理由で見送り、生本文を理由に含めない', () => {
    for (const raw of ['{', '秘密本文', '```json\n{}\n```']) expect(parseAiReply(raw, [2], true)).toEqual(invalid);
    expect(aiSkipMessage(invalid)).toBe('今回は見送りました（返答形式不正）。');
  });
});
