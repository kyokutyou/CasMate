import { describe, expect, it } from 'vitest';
import { createDefaultDocument, createPreset, parseDocument } from '../src/renderer/obs-style-editor/model';
import { generateCss } from '../src/renderer/obs-style-editor/css';
import commentsTemplate from '../docs/templates/obs/comments.css?raw';
import speechTemplate from '../docs/templates/obs/speech-recognition.css?raw';

describe('OBS着せ替え用の再編集設定', () => {
  it('両方のデザインと見本をまとめて保存・再編集でき、アプリ版は案内情報として扱う', () => {
    const document = createDefaultDocument();
    document.appVersion = '99.0.0';
    document.designs.comments.fontSize = 63;
    document.designs.speech.maxWidth = 900;
    document.previews.comments.author = '架空の投稿者';
    document.previews.speech.text = '複数行の\n字幕';
    expect(parseDocument(JSON.stringify(document))).toEqual(document);
    expect(createDefaultDocument().designs.comments.fontSize).toBe(32);
    expect(createDefaultDocument().designs.speech.fontSize).toBe(40);
  });

  it('不正JSON・未対応形式・未知のCSS/HTML/URLを拒否する', () => {
    const document = createDefaultDocument();
    expect(() => parseDocument('{')).toThrow('JSON');
    expect(() => parseDocument(JSON.stringify({ ...document, formatVersion: 2 }))).toThrow('保存形式');
    expect(() => parseDocument(JSON.stringify({ ...document, css: 'body {}' }))).toThrow('未対応');
    expect(() => parseDocument(JSON.stringify({ ...document, previews: {
      ...document.previews, comments: { ...document.previews.comments, html: '<img>' },
    } }))).toThrow('未対応');
    expect(() => parseDocument(JSON.stringify({ ...document, designs: {
      ...document.designs, comments: { ...document.designs.comments, imageUrl: 'https://example.invalid' },
    } }))).toThrow('未対応');
    expect(document).toEqual(createDefaultDocument());
  });

  it.each([0, 201, '32', null])('文字サイズの不正値 %s を拒否する', (fontSize) => {
    const document = createDefaultDocument();
    expect(() => parseDocument(JSON.stringify({ ...document, designs: {
      ...document.designs, comments: { ...document.designs.comments, fontSize },
    } }))).toThrow('fontSize');
  });

  it('色・列挙値・必須キー・有限数・ファイル容量を検証する', () => {
    const document = createDefaultDocument();
    const invalid = (changes: Record<string, unknown>) => JSON.stringify({ ...document, designs: {
      ...document.designs, comments: { ...document.designs.comments, ...changes },
    } });
    expect(() => parseDocument(invalid({ textColor: '#fff' }))).toThrow('textColor');
    expect(() => parseDocument(invalid({ fontWeight: 500 }))).toThrow('fontWeight');
    expect(() => parseDocument(invalid({ showSource: 'false' }))).toThrow('showSource');
    expect(() => parseDocument(invalid({ fontFamily: undefined }))).toThrow('不足');
    expect(() => parseDocument(invalid({ fontSize: Infinity }))).toThrow('fontSize');
    expect(() => parseDocument(JSON.stringify(document).replace('"fontSize":32', '"fontSize":1e999'))).toThrow('fontSize');
    expect(() => parseDocument(' '.repeat(1024 * 1024 + 1))).toThrow('1MiB');
    expect(() => parseDocument('あ'.repeat(350_000))).toThrow('1MiB');
  });

  it.each([
    ['designs.comments.fontFamily', ' '], ['designs.comments.fontFamily', '字'.repeat(201)],
    ['designs.comments.backgroundOpacity', -1], ['designs.comments.paddingX', 65],
    ['designs.comments.paddingY', -1], ['designs.comments.radius', 65],
    ['designs.comments.lineHeight', 0.99], ['designs.comments.edge', 65],
    ['designs.comments.border.width', 13], ['designs.comments.border.opacity', 101],
    ['designs.comments.textShadow.x', -65], ['designs.comments.textShadow.y', 65],
    ['designs.comments.textShadow.blur', 65], ['designs.comments.textShadow.opacity', -1],
    ['designs.comments.cardShadow.enabled', 1], ['designs.comments.cardShadow.color', 'red'],
    ['designs.comments.outline.width', 9], ['designs.comments.outline.color', '#00000000'],
    ['designs.comments.metaScale', 0.4], ['designs.comments.gap', 65],
    ['designs.comments.emoteScale', 3.1], ['designs.comments.sourceBackgroundOpacity', 101],
    ['designs.comments.badgeColors.youtube', 'url(https://example.invalid)'],
    ['designs.speech.horizontal', 'diagonal'], ['designs.speech.vertical', 'middle'],
    ['designs.speech.textAlign', 'justify'], ['designs.speech.maxWidth', 0], ['designs.speech.maxWidth', 3841],
    ['previews.comments.width', 0], ['previews.comments.height', 7681],
    ['previews.comments.background', 'blue'], ['previews.comments.mode', 'live'],
    ['previews.comments.stackDirection', 'up'], ['previews.comments.source', 'external'],
    ['previews.comments.emotes', 'true'], ['previews.comments.author', '名'.repeat(201)],
    ['previews.comments.text', '文'.repeat(20001)], ['previews.speech.text', '文'.repeat(20001)],
  ])('%s の不正な保存値を拒否する', (path, value) => {
    const document: Record<string, unknown> = { ...createDefaultDocument() };
    const keys = path.split('.');
    let current = document;
    for (const key of keys.slice(0, -1)) {
      const next = current[key];
      if (typeof next !== 'object' || next === null || Array.isArray(next)) throw new Error('テスト対象の項目がありません。');
      current = next as Record<string, unknown>;
    }
    current[keys.at(-1)!] = value;
    expect(() => parseDocument(JSON.stringify(document))).toThrow(path);
  });

  it('上限・下限の有効な値と大文字の16進色を受理する', () => {
    const document = createDefaultDocument();
    Object.assign(document.designs.comments, {
      fontSize: 8, fontWeight: 400, textColor: '#ABCDEF', backgroundOpacity: 0,
      paddingX: 64, paddingY: 0, radius: 64, lineHeight: 3, edge: 64,
      metaScale: 0.5, emoteScale: 3, gap: 64,
    });
    document.designs.comments.textShadow = { enabled: true, color: '#000000', opacity: 100, x: -64, y: 64, blur: 64 };
    document.designs.comments.border.width = 12;
    document.designs.comments.outline.width = 8;
    document.designs.speech.maxWidth = 3840;
    document.previews.comments.width = 1;
    document.previews.comments.height = 7680;
    document.previews.comments.author = '';
    expect(parseDocument(JSON.stringify(document))).toEqual(document);
  });

  it('プリセットは新しいデザインを返し、両対象に縁取りを提供する', () => {
    const standard = createPreset('comments', 'standard');
    const light = createPreset('comments', 'light');
    const transparent = createPreset('comments', 'transparent');
    const outlined = createPreset('speech', 'outlined');
    expect(standard).toEqual(createDefaultDocument().designs.comments);
    expect(light.backgroundColor).toBe('#ffffff');
    expect(transparent.backgroundOpacity).toBe(0);
    expect(outlined.backgroundOpacity).toBe(0);
    expect(outlined.outline.enabled).toBe(true);
    expect(createPreset('comments', 'outlined').outline.enabled).toBe(true);
    light.border.width = 12;
    expect(createPreset('comments', 'light').border.width).toBe(1);
  });
});

describe('見本とOBS出力で共有するCSS生成', () => {
  it('初期デザインは既存テンプレートの値と本文を使い、見本設定を含めない', () => {
    const document = createDefaultDocument();
    const comments = generateCss('comments', document.designs.comments);
    const speech = generateCss('speech', document.designs.speech);
    expect(comments).toContain('--cm-font: "Yu Gothic UI", "Meiryo", sans-serif;');
    expect(comments).toContain('--cm-size: 32px;');
    expect(comments).toContain('--cm-background: rgba(16, 20, 32, 0.78);');
    expect(comments).toContain('--cm-border: 1px solid rgba(255, 255, 255, 0.25);');
    expect(comments).toContain('--cm-text-shadow: 0px 2px 3px rgba(0, 0, 0, 0.8);');
    expect(comments).toContain('--cm-card-shadow: none;');
    expect(comments).toContain('--cm-meta-size: 0.75em;');
    expect(comments).toContain('--cm-emote-height: 1.45em;');
    expect(comments).toContain('font-family: var(--cm-font) !important;');
    expect(speech).toContain('--cm-size: 40px;');
    expect(speech).toContain('--cm-weight: 700;');
    expect(speech).toContain('--cm-padding: 12px 20px;');
    expect(speech).toContain('--cm-max-width: 100%;');
    document.previews.comments.width = 7680;
    document.previews.comments.text = '出力に含まない文章';
    expect(generateCss('comments', document.designs.comments)).toBe(comments);
    expect(comments).not.toContain('出力に含まない文章');
  });

  it.each(['comments', 'speech'] as const)('%s の初期変数と表示ルールを元テンプレートから引き継ぐ', (target) => {
    const document = createDefaultDocument();
    const template = target === 'comments' ? commentsTemplate : speechTemplate;
    const generated = generateCss(target, document.designs[target]);
    const variables = (css: string) => Object.fromEntries(
      [...(css.match(/:root\s*\{([^}]*)\}/)?.[1] ?? '').replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/(--cm-[\w-]+):\s*([^;]+);/g)]
        .map((match) => [match[1], match[2].trim().replace(/(^|\s)0px(?=\s)/g, '$10')]),
    );
    expect(variables(generated)).toMatchObject(variables(template));
    const displayRules = template.slice(template.indexOf('/* ===== 以下は表示に値を適用する部分 ===== */'));
    expect(generated).toContain(displayRules);
  });

  it('見出し非表示・サービス配色・縁取り・位置を生成する', () => {
    const document = createDefaultDocument();
    const comments = document.designs.comments;
    Object.assign(comments, { showSource: false, showAuthor: false, serviceColorsEnabled: true });
    comments.outline.enabled = true;
    const css = generateCss('comments', comments);
    expect(css).toContain('--cm-source-display: none;');
    expect(css).toContain('--cm-author-display: none;');
    expect(css).toContain('.overlay-comments .comment-meta { display: none; margin: 0; }');
    expect(css).toContain('.comment-youtube .source-badge');
    expect(css).toContain('--cm-outline: 2px #000000;');
    const speech = document.designs.speech;
    Object.assign(speech, { horizontal: 'right', vertical: 'center', textAlign: 'right', maxWidth: 1234 });
    const speechCss = generateCss('speech', speech);
    expect(speechCss).toContain('--cm-horizontal: flex-end;');
    expect(speechCss).toContain('--cm-vertical: center;');
    expect(speechCss).toContain('--cm-text-align: right;');
    expect(speechCss).toContain('--cm-max-width: 1234px;');
  });

  it('任意フォント名を単一のCSS文字列へ閉じ込め、HTML終了タグも安全にエスケープする', () => {
    const document = createDefaultDocument();
    document.designs.comments.fontFamily = 'font"; } body { background: url(https://example.invalid) } /*\\\n</style></script>';
    document.previews.comments.author = '</strong><script>悪意</script>';
    document.previews.comments.text = '</style><img src="https://example.invalid">\n本文';
    expect(parseDocument(JSON.stringify(document))).toEqual(document);
    const css = generateCss('comments', document.designs.comments);
    expect(css).toContain('font\\"; } body { background: url(https://example.invalid) } /*\\\\\\a \\3c /style\\3e \\3c /script\\3e ');
    expect(css).not.toContain('</style>');
    expect(css).not.toContain('</script>');
    expect(css).not.toContain('<img');
    expect(css).toContain('sans-serif;');
  });

  it('置換文字列として解釈される記号も任意フォント名の文字として保持する', () => {
    const document = createDefaultDocument();
    document.designs.comments.fontFamily = '見本 $& $` $\' $$';
    const css = generateCss('comments', document.designs.comments);
    expect(css).toContain('--cm-font: "見本 $& $` $\' $$", sans-serif;');
    expect(css.match(/:root\s*\{/g)).toHaveLength(1);
  });
});
