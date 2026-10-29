import { describe, expect, it, vi } from 'vitest';
import { buildAiPrompt, selectAiContext } from '../src/main/ai/ai-context';
import { defaultAiSettings, validateAiSettings, type AiMemory } from '../src/shared/ai-listener';
import { graphemes } from '../src/shared/unicode';

const at = (day: number, minute = 0) => new Date(2026, 8, day, 12, minute).toISOString();
const entry = (id: string, text: string, role: AiMemory['role'] = 'viewer', date = at(13)): AiMemory => ({ id, text, role, at: date, source: role === 'streamer' ? null : 'shitaraba' });
const ids = (records: AiMemory[]) => records.map(r => r.id);

describe('AI送信会話の選別', () => {
  const persona = { id: 'p', name: '管理名', personality: '', tone: '', firstPerson: '', topics: '', notes: '' };
  it('要求内の発言番号で最近の人間だけを対象にし、最新の配信者発話を優先する', () => {
    const memory = [entry('private-old', '前の発話', 'streamer'), entry('private-ai', 'AIの返答', 'ai'), entry('private-viewer', 'コメント'), entry('private-new', '今の発話', 'streamer')];
    const built = buildAiPrompt(defaultAiSettings(), persona, memory, false, new Date());
    const data = JSON.parse(JSON.parse(built.body).contents[0].parts[0].text);
    expect(data['最近の会話'][0].entries.map((e: unknown[]) => e[4])).toEqual([1, 2, 3, 4]);
    expect(data.replyTargets).toEqual({ preferred: 4, allowed: [1, 3, 4] });
    for (const r of memory) expect(built.body).not.toContain(r.id);
    const next = JSON.parse(JSON.parse(buildAiPrompt(defaultAiSettings(), persona, [memory[3]], false, new Date()).body).contents[0].parts[0].text);
    expect(next.replyTargets).toEqual({ preferred: 1, allowed: [1] });
    expect(memory.map(r => r.id)).toEqual(['private-old', 'private-ai', 'private-viewer', 'private-new']);
  });
  it('関連する過去の人間発言は参照だけにし、最近枠の人間と区別する', () => {
    const memory = [entry('past', 'ドラゴン 攻略', 'viewer', at(12)), entry('new', 'ドラゴン 攻略 ' + '長'.repeat(700), 'streamer', at(14))];
    const data = JSON.parse(JSON.parse(buildAiPrompt({ ...defaultAiSettings(), contextCharacters: 1000 }, persona, memory, false, new Date()).body).contents[0].parts[0].text);
    expect(data['関連する過去の会話'][0].entries[0][4]).toBe(1);
    expect(data['最近の会話'][0].entries[0][4]).toBe(2);
    expect(data.replyTargets).toEqual({ preferred: 2, allowed: [2] });
  });
  it('jpnknとしたらばの会話元を区別し、接続先情報を追加しない', () => {
    const { body } = buildAiPrompt(defaultAiSettings(), persona, [{ ...entry('j', 'jpnknの会話'), source: 'jpnkn' }, entry('s', 'したらばの会話')], false, new Date());
    const entries = JSON.parse(JSON.parse(body).contents[0].parts[0].text)['最近の会話'][0].entries;
    expect(entries.map((e: string[]) => e[2])).toEqual(['jpnkn', 'したらば']);
    expect(body).not.toContain('https://');
  });
  it.each([10, 20, 200])('目標%i文字を渡し、乱数や下限で返答を水増ししない', goal => {
    const random = vi.spyOn(Math, 'random');
    try {
      const { body } = buildAiPrompt({ ...defaultAiSettings(), maxCharacters: goal }, persona, [], false, new Date());
      const instruction = JSON.parse(body).systemInstruction.parts[0].text;
      expect(random).not.toHaveBeenCalled();
      expect(instruction).toContain(`目標${goal}文字`);
      expect(instruction).toContain('文字数の下限はない');
      expect(instruction).toContain('質問には必要な情報だけ');
      expect(instruction).not.toMatch(/\d+〜\d+文字/);
    } finally { random.mockRestore(); }
  });
  it('初回も同じ長さの指示を使い、重複と文体を抑制する指示を人格より優先する', () => {
    const configured = { ...persona, tone: '草とｗを使う', notes: '毎回頑張っていこうぜと締める' };
    const memory = [entry('a', '頑張っていこうぜｗ', 'ai'), entry('v', '頑張っていこうぜｗ'), entry('s', '馬車が動いた', 'streamer')];
    const { body } = buildAiPrompt({ ...defaultAiSettings(), maxCharacters: 20 }, configured, memory, true, new Date());
    const instruction = JSON.parse(body).systemInstruction.parts[0].text;
    expect(instruction).toContain('目標20文字');
    expect(instruction).toContain('会話例');
    for (const rule of ['挨拶', '一つの反応', '人格より優先', '句読点', '草・w/W/ｗ/Ｗ', '同意要求・励まし・勧誘', '文体の見本ではない', '趣旨・書き出し・語尾', '引用・コピー', '最新の一言', '相づち・言いかけ']) expect(instruction).toContain(rule);
    const data = JSON.parse(JSON.parse(body).contents[0].parts[0].text);
    expect(data['最近の会話'][0].entries.map((e: string[]) => e[3])).toEqual(memory.map(r => r.text));
    expect(configured.tone).toBe('草とｗを使う');
  });
  it.each([
    { label: '訂正後の質問に感想でなく事実を答える', memory: [entry('old', '昨日始めた', 'streamer'), entry('new', 'いや今日の朝だった いつ始めたっけ', 'streamer')], rules: ['訂正を反映した事実を先に短く答える', '心理や熱中度の感想へ置き換えない', '人間「昨日始めた」「いや今日の朝だった いつ始めたっけ」→reply「今日の朝からだよ」'] },
    { label: '待つ発話だけなら質問を重ねず見送る', memory: [entry('wait', 'あ ちょっと待って', 'streamer')], rules: ['続きや作業を待つ発話だけなら', '質問・助言を重ねずskip reason="unclear"', '新しい具体的な質問がある場合はその質問に答える', '人間「ちょっと待って」→skip reason="unclear"'] },
    { label: '既出内容への同意に助言を追加しない', memory: [entry('door', 'この扉は鍵が必要', 'streamer'), entry('ai', 'まず鍵を探す必要がありそう', 'ai'), entry('agree', 'うん この扉は鍵が必要だね', 'streamer')], rules: ['新情報も未回答の質問もない同意・繰り返し', '助言を足さずskip reason="redundant"', '会話にない場所・物・状況', 'AI「鍵を探そう」人間「うん 鍵が必要だね」→skip reason="redundant"'] },
  ])('$label の指示と例を送り、対象と元の会話を維持する', ({ memory, rules }) => {
    const before = structuredClone(memory);
    const { body, replyTargets } = buildAiPrompt(defaultAiSettings(), persona, memory, false, new Date(2026, 8, 13, 12, 1));
    const request = JSON.parse(body);
    const instruction = request.systemInstruction.parts[0].text;
    for (const rule of rules) expect(instruction).toContain(rule);
    expect(instruction).toContain('例の話題や表現を実際の返答へコピーしない');
    expect(replyTargets.preferred).toBe(memory.length);
    expect(replyTargets.allowed).toEqual(memory.flatMap((record, i) => record.role === 'ai' ? [] : [i + 1]));
    const data = JSON.parse(request.contents[0].parts[0].text);
    expect(data['最近の会話'][0].entries.map((record: unknown[]) => record[3])).toEqual(memory.map(record => record.text));
    expect(request.generationConfig.responseMimeType).toBe('application/json');
    expect(request.generationConfig.maxOutputTokens).toBe(1024);
    expect(request).not.toHaveProperty('tools');
    expect(memory).toEqual(before);
  });
  it('同日のオフセットを一度だけ送り、空の会話区分と人格を省く', () => {
    const { body } = buildAiPrompt(defaultAiSettings(), persona, [entry('a', '昨日', 'viewer', at(13)), entry('b', '今日', 'streamer', at(14))], false, new Date());
    const request = JSON.parse(body); const data = JSON.parse(request.contents[0].parts[0].text);
    expect(data).not.toHaveProperty('関連する過去の会話');
    expect(request.systemInstruction.parts[0].text).not.toContain('人格設定: {}');
    for (const group of data['最近の会話']) {
      expect(group.utcOffset).toMatch(/^[+-]\d{2}:\d{2}$/);
      expect(group.entries[0][0]).toMatch(/^\d{2}:\d{2}:\d{2}$/);
      expect(new Date(`${group.date}T${group.entries[0][0]}${group.utcOffset}`).toISOString()).toBe(at(group.date.endsWith('13') ? 13 : 14));
    }
    const empty = JSON.parse(JSON.parse(buildAiPrompt(defaultAiSettings(), persona, [], false, new Date()).body).contents[0].parts[0].text);
    expect(Object.keys(empty).sort()).toEqual(['now', 'replyTargets', 'timeZone']);
    expect(empty.replyTargets).toEqual({ preferred: 0, allowed: [] });
  });
  it('会話上限の欠落を拒否し、設定範囲と整数を検証する', () => {
    expect(() => validateAiSettings({ ...defaultAiSettings(), contextCharacters: undefined })).toThrow();
    for (const contextCharacters of [null, '3000', 999, 10001, 1500.5]) expect(() => validateAiSettings({ ...defaultAiSettings(), contextCharacters })).toThrow();
    for (const contextCharacters of [1000, 10000]) expect(validateAiSettings({ ...defaultAiSettings(), contextCharacters }).contextCharacters).toBe(contextCharacters);
  });
  it('最新の配信者と直近2件のAIを優先し、保存順に並べる', () => {
    const memory = [entry('s', '配信者', 'streamer'), entry('a1', 'AI一', 'ai'), entry('a2', 'AI二', 'ai'), entry('v', '長'.repeat(2000))];
    expect(ids(selectAiContext(memory, 1000).recent)).toEqual(['s', 'a1', 'a2']);
  });
  it('長い最新発話を絵文字の境界で抜粋し、元の記憶を変更しない', () => {
    const text = '👨‍👩‍👧‍👦'.repeat(1000) + '末尾';
    const memory = [entry('old', '以前'), entry('s', text, 'streamer')];
    const result = selectAiContext(memory, 1000);
    expect(result.recent).toHaveLength(1);
    expect(result.recent[0].text).toContain('［途中省略］');
    expect(result.recent[0].text.endsWith('末尾')).toBe(true);
    expect(graphemes(result.recent[0].text)).toHaveLength(666);
    expect(memory[1].text).toBe(text);
    expect(result.stats.afterCharacters).toBeLessThanOrEqual(1000);
  });
  it('表記揺れを吸収して過去を抽出し、近い前後だけを添える', () => {
    const memory = [entry('unrelated', 'カレーを食べた', 'viewer', at(12)), entry('before', '攻略を考えよう', 'viewer', at(13, 0)), entry('hit', 'ＤＲＡＧＯＮ 攻略', 'viewer', at(13, 1)), entry('after', '次も試そう', 'viewer', at(13, 2)), entry('gap', '遠い会話', 'viewer', at(13, 10)), entry('s', 'dragon 攻略 ' + '長'.repeat(700), 'streamer', at(14))];
    const result = selectAiContext(memory, 1000);
    expect(ids(result.past)).toEqual(['before', 'hit', 'after']);
    expect(result.stats.beforeCount).toBe(6);
    expect(result.stats.pastCount).toBe(3);
  });
  it('頻出する1語だけの一致と除外語・数字では過去を選ばない', () => {
    const memory = Array.from({ length: 12 }, (_, i) => entry(String(i), 'ドラゴン'));
    memory.push(entry('s', 'ドラゴン それ です 1234 ' + '長'.repeat(700), 'streamer', at(14)));
    expect(selectAiContext(memory, 1000).past).toEqual([]);
  });
  it('同日の5分を超える発言や別日の発言を前後として追加しない', () => {
    const memory = [entry('before', '前日', 'viewer', new Date(2026, 8, 12, 23, 59).toISOString()), entry('hit', 'ドラゴン 攻略', 'viewer', new Date(2026, 8, 13, 0, 1).toISOString()), entry('after', '遅い', 'viewer', at(13)), entry('s', 'ドラゴン 攻略 ' + '長'.repeat(700), 'streamer', at(14))];
    expect(ids(selectAiContext(memory, 1000).past)).toEqual(['hit']);
  });
  it('重複を除き、過去の全文が収まらなければ送らず、空き枠も埋めない', () => {
    const old = entry('old', 'ドラゴン 攻略 ' + '長'.repeat(400));
    const memory = [old, old, entry('s', 'ドラゴン 攻略 ' + '長'.repeat(700), 'streamer', at(14))];
    const result = selectAiContext(memory, 1000);
    expect(result.past).toEqual([]);
    expect(result.stats.afterCharacters).toBe(666);
    expect(new Set(ids([...result.past, ...result.recent])).size).toBe(result.stats.selectedCount);
  });
  it('最大3か所を選び、同点なら新しい一致を優先する', () => {
    const memory = Array.from({ length: 6 }, (_, i) => entry(String(i), 'ドラゴン 攻略', 'viewer', at(i + 1)));
    memory.push(entry('s', 'ドラゴン 攻略 ' + '長'.repeat(700), 'streamer', at(14)));
    expect(ids(selectAiContext(memory, 1000).past)).toEqual(['3', '4', '5']);
  });
  it('人間の検索語がない場合と空の記憶を処理する', () => {
    expect(selectAiContext([], 1000).stats.afterCharacters).toBe(0);
    expect(selectAiContext([entry('old', 'ドラゴン 攻略'), entry('a', 'ドラゴン 攻略', 'ai')], 1000).past).toEqual([]);
  });
  it('日付・オフセットと発言元を残し、人格の管理項目と空項目を除く', () => {
    const memory = [entry('private-id', '昨日の話', 'streamer', at(13)), entry('second', '今日の話', 'viewer', at(14))];
    const persona = { id: 'private-persona', name: '管理名', personality: '明るい', tone: '', firstPerson: '', topics: '  ', notes: '' };
    const { body } = buildAiPrompt(defaultAiSettings(), persona, memory, false, new Date(2026, 8, 14, 13));
    const request = JSON.parse(body); const data = JSON.parse(request.contents[0].parts[0].text);
    expect(data.now).toMatch(/^2026-09-14T13:00:00[+-]\d{2}:\d{2}$/);
    expect(data.timeZone).toBeTruthy();
    expect(data['最近の会話'].map((g: { date: string }) => g.date)).toEqual(['2026-09-13', '2026-09-14']);
    expect(body).not.toContain('private-id'); expect(body).not.toContain('管理名'); expect(body).not.toContain('private-persona');
    expect(request.systemInstruction.parts[0].text).toContain('"personality":"明るい"');
    expect(request.systemInstruction.parts[0].text).not.toContain('"topics"');
    expect(request.systemInstruction.parts[0].text).toContain('現在の配信とは限らない');
  });
});
