import { useState } from 'react';
import type { ReactNode } from 'react';
import { ColorControl, NumericControl, SelectControl, ToggleControl } from './controls';
import type { CommentDesign, CommentPreview, CommonDesign, EditorDocument, SpeechDesign, SpeechPreview, Target } from './model';
const fonts = [
  ['system-ui', 'システム標準'], ['Yu Gothic UI', '游ゴシック UI'], ['Yu Gothic', '游ゴシック'],
  ['Meiryo', 'メイリオ'], ['Noto Sans JP', 'Noto Sans JP'],
] as const;
const sources = [['youtube', 'YouTube Live'], ['twitch', 'Twitch'], ['shitaraba', 'したらば']] as const;
type NumericCommonKey = 'fontSize' | 'backgroundOpacity' | 'paddingX' | 'paddingY' | 'radius' | 'lineHeight' | 'edge';
type DesignPatch = Partial<CommentDesign & SpeechDesign>;
type PreviewPatch = Partial<CommentPreview & SpeechPreview>;
type GestureProps = { onBegin: () => void; onEnd: () => void; revision: number; compact?: boolean };

export function FontControls({ fontFamily, onChange, installedFonts, action }: { fontFamily: string; onChange: (font: string) => void; installedFonts?: string[]; action?: ReactNode }) {
  const choices = installedFonts ? [['system-ui', 'システム標準'], ...installedFonts.filter(name => name !== 'system-ui').map(name => [name, name])] : fonts;
  const [customFont, setCustomFont] = useState(!choices.some(([name]) => name === fontFamily));
  const [fontDraft, setFontDraft] = useState(fontFamily);
  const validFont = fontDraft.trim().length > 0 && fontDraft.length <= 200;
  return <>
    <div className={action ? 'font-choice-row' : undefined}><SelectControl label="フォント" value={customFont || !choices.some(([name]) => name === fontFamily) ? 'custom' : fontFamily}
      onChange={(font) => { setCustomFont(font === 'custom'); if (font !== 'custom') { setFontDraft(font); onChange(font); } }}>
      {choices.map(([name, label]) => <option key={name} value={name}>{label}</option>)}<option value="custom">任意のフォント名</option>
    </SelectControl>{action}</div>
    {(customFont || !choices.some(([name]) => name === fontFamily)) && <label className="text-control">フォント名<input type="text" aria-label="フォント名" maxLength={200} value={fontDraft} aria-invalid={!validFont} onChange={(event) => { const next = event.currentTarget.value; setFontDraft(next); if (next.trim() && next.length <= 200) onChange(next); }} /><small className="field-hint field-error">{validFont ? 'PCにインストールされている名前を入力します。' : '1〜200文字のフォント名を入力してください。'}</small></label>}
  </>;
}

export function CommonControls({ design, onPatch, installedFonts, ...gesture }: { design: CommonDesign; installedFonts?: string[]; onPatch: (patch: Partial<CommonDesign>) => void } & GestureProps) {
  const numeric = (label: string, key: NumericCommonKey, min: number, max: number, unit = 'px', step = 1) =>
    <NumericControl label={label} value={design[key]} min={min} max={max} unit={unit} step={step} {...gesture} onChange={(value) => onPatch({ [key]: value })} />;
  return <>
    <FontControls fontFamily={design.fontFamily} installedFonts={installedFonts} onChange={fontFamily => onPatch({ fontFamily })}/>
    <p className="panel-note">フォントはこのPCとOBSのPCに必要です。未インストールの場合は代替フォントになります。</p>
    {numeric('文字サイズ', 'fontSize', 8, 200)}
    <SelectControl label="文字の太さ" value={String(design.fontWeight)} onChange={(value) => onPatch({ fontWeight: Number(value) as CommonDesign['fontWeight'] })}>
      {installedFonts && <option value="500">中間（500）</option>}<option value="400">標準（400）</option><option value="600">やや太い（600）</option><option value="700">太い（700）</option>
    </SelectControl>
    <div className="control-pair"><ColorControl label="文字色" value={design.textColor} onChange={(textColor) => onPatch({ textColor })} /><ColorControl label="背景色" value={design.backgroundColor} onChange={(backgroundColor) => onPatch({ backgroundColor })} /></div>
    {numeric('背景の不透明度', 'backgroundOpacity', 0, 100, '%')}
    <div className="control-pair">{numeric('内側余白・上下', 'paddingY', 0, 64)}{numeric('内側余白・左右', 'paddingX', 0, installedFonts ? 96 : 64)}</div>
    {numeric('角丸', 'radius', 0, 64)}
  </>;
}

function ShadowControls({ label, shadow, onChange, ...gesture }: { label: string; shadow: CommonDesign['textShadow']; onChange: (shadow: CommonDesign['textShadow']) => void } & GestureProps) {
  const numeric = (suffix: string, key: 'opacity' | 'blur' | 'x' | 'y', min: number, max: number, unit = 'px') =>
    <NumericControl label={`${label}・${suffix}`} value={shadow[key]} min={min} max={max} unit={unit} {...gesture} onChange={(value) => onChange({ ...shadow, [key]: value })} />;
  return <section className="effect-section">
    <ToggleControl label={label} checked={shadow.enabled} onChange={(enabled) => onChange({ ...shadow, enabled })} />
    <fieldset disabled={!shadow.enabled} className="effect-fields">
      <ColorControl editableHex={gesture.compact} revision={gesture.revision} label={`${label}の色`} value={shadow.color} onChange={(color) => onChange({ ...shadow, color })} />
      {numeric('不透明度', 'opacity', 0, 100, '%')}<div className="effect-wide">{numeric('ぼかし', 'blur', 0, 64)}</div>
      <div className="control-pair">{numeric('左右のずれ', 'x', -64, 64)}{numeric('上下のずれ', 'y', -64, 64)}</div>
    </fieldset>
  </section>;
}

export function AdvancedControls({ target, document: state, onPatch, hideLineHeight = false, ...gesture }: { target: Target; document: EditorDocument; onPatch: (patch: DesignPatch) => void; hideLineHeight?: boolean } & GestureProps) {
  const design = state.designs[target];
  return <details className="advanced-controls"><summary><span>詳細なデザイン</span><span className="summary-hint">枠線・影・縁取り</span></summary>
    <div className="details-body">
      {!hideLineHeight && <NumericControl label="行間" value={design.lineHeight} min={1} max={3} step={0.05} unit="倍" {...gesture} onChange={(lineHeight) => onPatch({ lineHeight })} />}
      <NumericControl label="外周の余白" value={design.edge} min={0} max={64} unit="px" {...gesture} onChange={(edge) => onPatch({ edge })} />
      <section className="effect-section"><ToggleControl label="枠線" checked={design.border.enabled} onChange={(enabled) => onPatch({ border: { ...design.border, enabled } })} />
        <fieldset disabled={!design.border.enabled} className="effect-fields">
          <ColorControl editableHex={gesture.compact} revision={gesture.revision} label="枠線の色" value={design.border.color} onChange={(color) => onPatch({ border: { ...design.border, color } })} />
          <NumericControl label="枠線の太さ" value={design.border.width} min={0} max={12} unit="px" {...gesture} onChange={(width) => onPatch({ border: { ...design.border, width } })} />
          <div className="effect-wide"><NumericControl label="枠線の不透明度" value={design.border.opacity} min={0} max={100} unit="%" {...gesture} onChange={(opacity) => onPatch({ border: { ...design.border, opacity } })} /></div>
        </fieldset>
      </section>
      <ShadowControls label="文字の影" shadow={design.textShadow} {...gesture} onChange={(textShadow) => onPatch({ textShadow })} />
      <section className="effect-section"><ToggleControl label="文字の縁取り" checked={design.outline.enabled} onChange={(enabled) => onPatch({ outline: { ...design.outline, enabled } })} />
        <fieldset disabled={!design.outline.enabled} className="effect-fields">
          <ColorControl editableHex={gesture.compact} revision={gesture.revision} label="縁取りの色" value={design.outline.color} onChange={(color) => onPatch({ outline: { ...design.outline, color } })} />
          <NumericControl label="縁取りの太さ" value={design.outline.width} min={0} max={8} unit="px" step={0.5} {...gesture} onChange={(width) => onPatch({ outline: { ...design.outline, width } })} />
        </fieldset>
      </section>
      <ShadowControls label="ボックスの影" shadow={design.cardShadow} {...gesture} onChange={(cardShadow) => onPatch({ cardShadow })} />
      {target === 'comments' && <section className="effect-section">
        <ToggleControl label="サービス別のバッジ背景色" checked={state.designs.comments.serviceColorsEnabled} onChange={(serviceColorsEnabled) => onPatch({ serviceColorsEnabled })} />
        <fieldset disabled={!state.designs.comments.serviceColorsEnabled} className="effect-fields">
          {sources.map(([source, label]) => <ColorControl editableHex={gesture.compact} revision={gesture.revision} key={source} label={`${label}の背景色`} value={state.designs.comments.badgeColors[source]} onChange={(color) => onPatch({ badgeColors: { ...state.designs.comments.badgeColors, [source]: color } })} />)}
        </fieldset>
      </section>}
    </div>
  </details>;
}

export function CommentControls({ design, onPatch, application = false, ...gesture }: { application?: boolean; design: CommentDesign; onPatch: (patch: DesignPatch) => void } & GestureProps) {
  return <section className="target-controls"><h3>コメントの見出し</h3>
    {!application && <ToggleControl label="サービス名を表示" checked={design.showSource} onChange={(showSource) => onPatch({ showSource })} />}
    {!application && <ToggleControl label="投稿者名を表示" checked={design.showAuthor} onChange={(showAuthor) => onPatch({ showAuthor })} />}
    <div className="control-pair"><ColorControl editableHex={gesture.compact} revision={gesture.revision} label="投稿者名の色" value={design.authorColor} onChange={(authorColor) => onPatch({ authorColor })} /><ColorControl editableHex={gesture.compact} revision={gesture.revision} label="サービス名の色" value={design.sourceColor} onChange={(sourceColor) => onPatch({ sourceColor })} /></div>
    <ColorControl editableHex={gesture.compact} revision={gesture.revision} label="サービス名の背景色" value={design.sourceBackgroundColor} onChange={(sourceBackgroundColor) => onPatch({ sourceBackgroundColor })} />
    <NumericControl label="サービス名背景の不透明度" value={design.sourceBackgroundOpacity} min={0} max={100} unit="%" {...gesture} onChange={(sourceBackgroundOpacity) => onPatch({ sourceBackgroundOpacity })} />
    <NumericControl label="見出しの文字サイズ" value={design.metaScale} min={0.5} max={1.5} step={0.05} unit="倍" {...gesture} onChange={(metaScale) => onPatch({ metaScale })} />
    <NumericControl label="積み上げの間隔" value={design.gap} min={0} max={64} unit="px" {...gesture} onChange={(gap) => onPatch({ gap })} />
    <NumericControl label="エモートのサイズ" value={design.emoteScale} min={0.5} max={3} step={0.05} unit="倍" {...gesture} onChange={(emoteScale) => onPatch({ emoteScale })} />
    {!application && <p className="panel-note">きゃすメイト側で非表示にした項目は、このCSSでも表示できません。</p>}
  </section>;
}

export function SpeechControls({ design, onPatch, ...gesture }: { design: SpeechDesign; onPatch: (patch: DesignPatch) => void } & GestureProps) {
  return <section className="target-controls"><h3>字幕の配置</h3><p className="panel-note">位置はOBSのブラウザソース内での位置です。</p>
    <div className="control-pair">
      <SelectControl label="左右の位置" value={design.horizontal} onChange={(horizontal) => onPatch({ horizontal: horizontal as SpeechDesign['horizontal'] })}><option value="left">左</option><option value="center">中央</option><option value="right">右</option></SelectControl>
      <SelectControl label="上下の位置" value={design.vertical} onChange={(vertical) => onPatch({ vertical: vertical as SpeechDesign['vertical'] })}><option value="top">上</option><option value="center">中央</option><option value="bottom">下</option></SelectControl>
    </div>
    <SelectControl label="文字揃え" value={design.textAlign} onChange={(textAlign) => onPatch({ textAlign: textAlign as SpeechDesign['textAlign'] })}><option value="left">左揃え</option><option value="center">中央揃え</option><option value="right">右揃え</option></SelectControl>
    <ToggleControl label="最大幅をpxで指定" checked={design.maxWidth !== null} onChange={(enabled) => onPatch({ maxWidth: enabled ? 1200 : null })} />
    <fieldset disabled={design.maxWidth === null} className="effect-fields"><NumericControl label="字幕ボックスの最大幅" value={design.maxWidth ?? 1200} min={1} max={3840} unit="px" {...gesture} onChange={(maxWidth) => onPatch({ maxWidth })} /></fieldset>
    <p className="panel-note">指定しない場合はソースの全幅を使えます。実際の幅は文章の長さでも変わります。</p>
  </section>;
}

export function SampleControls({ target, document: state, onPatch, ...gesture }: { target: Target; document: EditorDocument; onPatch: (patch: PreviewPatch) => void } & GestureProps) {
  const preview = state.previews[target];
  return <details className="sample-controls"><summary><span>見本を調整</span><span className="summary-hint">寸法・背景・文章</span></summary><div className="details-body">
    <p className="panel-note">ここで変える内容は見本だけに使い、OBS用CSSには含めません。</p>
    <div className="control-pair">
      <NumericControl label="見本の幅" value={preview.width} min={1} max={7680} unit="px" {...gesture} onChange={(width) => onPatch({ width })} />
      <NumericControl label="見本の高さ" value={preview.height} min={1} max={7680} unit="px" {...gesture} onChange={(height) => onPatch({ height })} />
    </div>
    <SelectControl label="プレビューの背景" value={preview.background} onChange={(background) => onPatch({ background: background as CommentPreview['background'] })}><option value="checker">市松模様（透明を確認）</option><option value="white">白</option><option value="black">黒</option></SelectControl>
    {target === 'comments' && <>
      <div className="control-pair">
        <SelectControl label="表示方式（見本だけ）" value={state.previews.comments.mode} onChange={(mode) => onPatch({ mode: mode as CommentPreview['mode'] })}><option value="stack">積み上げ</option><option value="single">1件だけ</option></SelectControl>
        <SelectControl label="表示方向（見本だけ）" value={state.previews.comments.stackDirection} onChange={(stackDirection) => onPatch({ stackDirection: stackDirection as CommentPreview['stackDirection'] })}><option value="newestBottom">新しいコメントが下</option><option value="newestTop">新しいコメントが上</option></SelectControl>
      </div>
      <SelectControl label="サービス（見本だけ）" value={state.previews.comments.source} onChange={(source) => onPatch({ source: source as CommentPreview['source'] })}><option value="all">全サービス</option>{sources.map(([source, label]) => <option key={source} value={source}>{label}</option>)}</SelectControl>
      <label className="text-control">見本の投稿者名<input type="text" maxLength={200} value={state.previews.comments.author} onChange={(event) => onPatch({ author: event.currentTarget.value })} /></label>
      <ToggleControl label="内蔵エモートを表示" checked={state.previews.comments.emotes} onChange={(emotes) => onPatch({ emotes })} />
    </>}
    <label className="text-control">見本の文章<textarea rows={5} maxLength={20000} value={preview.text} onChange={(event) => onPatch({ text: event.currentTarget.value })} /></label>
    <div className="sample-actions"><button type="button" onClick={() => onPatch({ text: '長い文章の折り返しを確認します。見本の幅に合わせて、文字の大きさや内側余白を調整してみてください。'.repeat(4) })}>長文の見本</button><button type="button" onClick={() => onPatch({ text: 'こんにちは、配信を楽しんでいます！\n2行目も読みやすく表示できます。\n改行や行間を見ながら調整してください。' })}>改行の見本</button></div>
  </div></details>;
}
