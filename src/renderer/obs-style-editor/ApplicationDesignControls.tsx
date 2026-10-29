import type { ObsCommentDesign, ObsSpeechDesign } from '../../shared/obs-design';
import type { CommentDesign, SpeechDesign } from './model';
import { FontControls } from './EditorControls';
import { ColorControl, NumericControl, SelectControl, ToggleControl } from './controls';

type StylePatch = Partial<CommentDesign & SpeechDesign>;
type OuterPatch = Partial<ObsCommentDesign & ObsSpeechDesign>;

export function ApplicationDesignControls({ design, fonts, fontBusy, fontStatus, onRefreshFonts, onPatchStyle, onPatchOuter, revision, onBegin, onEnd }: {
  design: ObsCommentDesign | ObsSpeechDesign; fonts: string[]; fontBusy: boolean; fontStatus: string;
  onRefreshFonts(): void; onPatchStyle(patch: StylePatch): void; onPatchOuter(patch: OuterPatch): void;
  revision: number; onBegin(): void; onEnd(): void;
}) {
  const style = design.style;
  const gesture = { revision, onBegin, onEnd, compact: true };
  const numeric = (label: string, key: 'fontSize' | 'backgroundOpacity' | 'paddingY' | 'paddingX' | 'radius' | 'lineHeight', min: number, max: number, unit = 'px', step = 1) =>
    <NumericControl label={label} value={style[key]} min={min} max={max} unit={unit} step={step} {...gesture} onChange={value => onPatchStyle({ [key]: value })}/>;
  const color = (label: string, key: 'textColor' | 'backgroundColor') => <ColorControl label={label} value={style[key]} editableHex revision={revision} onChange={value => onPatchStyle({ [key]: value })}/>;
  return <>
    <section className="design-adjust-group" aria-label="文字">
      <h3>文字</h3>
      <div className="design-font-status">
        <FontControls key={revision} fontFamily={style.fontFamily} installedFonts={fonts} onChange={fontFamily => onPatchStyle({ fontFamily })} action={<button type="button" aria-disabled={fontBusy} onClick={onRefreshFonts}>一覧を再取得</button>}/>
        <span role="status">{fontBusy ? 'フォント一覧を取得中…' : fontStatus}</span>
      </div>
      <details className="design-font-help"><summary>フォントについて</summary><p>フォントはこのPCとOBSのPCに必要です。未インストールの場合は代替フォントになります。</p></details>
      <div className="control-pair">
        {numeric('文字サイズ', 'fontSize', 8, 200)}
        <SelectControl label="文字の太さ" value={String(style.fontWeight)} onChange={value => onPatchStyle({ fontWeight: Number(value) as CommentDesign['fontWeight'] })}>
          <option value="400">標準（400）</option><option value="500">中間（500）</option><option value="600">やや太い（600）</option><option value="700">太い（700）</option>
        </SelectControl>
      </div>
      <div className="control-pair">
        {color('文字色', 'textColor')}
        <NumericControl label="文字の不透明度" value={design.textOpacity} min={0} max={100} unit="%" {...gesture} onChange={textOpacity => onPatchOuter({ textOpacity })}/>
      </div>
    </section>
    <section className="design-adjust-group" aria-label="背景">
      <h3>背景</h3>
      {'variant' in design && <>
        <SelectControl label="デザインの種類" value={design.variant} onChange={variant => onPatchOuter({ variant: variant as ObsCommentDesign['variant'] })}><option value="paper">付箋</option><option value="card">カード</option></SelectControl>
        {design.variant === 'paper' && <ToggleControl label="付箋の背景を四色で循環" checked={design.paperColors} onChange={paperColors => onPatchOuter({ paperColors })}/>}
      </>}
      <div className="control-pair">{color('背景色', 'backgroundColor')}{numeric('背景の不透明度', 'backgroundOpacity', 0, 100, '%')}</div>
    </section>
    <section className="design-adjust-group" aria-label="余白・形">
      <h3>余白・形</h3>
      <div className="control-pair">{numeric('内側余白・上下', 'paddingY', 0, 64)}{numeric('内側余白・左右', 'paddingX', 0, 96)}</div>
      <div className="control-pair">{numeric('角丸', 'radius', 0, 64)}{numeric('行間', 'lineHeight', 1, 3, '倍', 0.05)}</div>
    </section>
  </>;
}
