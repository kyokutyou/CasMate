import commentsTemplate from '../../../docs/templates/obs/comments.css?raw';
import speechTemplate from '../../../docs/templates/obs/speech-recognition.css?raw';
import type { CommentDesign, CommonDesign, Shadow, SpeechDesign, Target } from './model';

function rgba(color: string, opacity: number): string {
  const channels = [1, 3, 5].map((offset) => Number.parseInt(color.slice(offset, offset + 2), 16));
  return `rgba(${channels.join(', ')}, ${opacity / 100})`;
}

function fontFamily(name: string): string {
  if (name === 'system-ui') return 'system-ui, sans-serif';
  if (name === 'Yu Gothic UI') return '"Yu Gothic UI", "Meiryo", sans-serif';
  if (name === 'Consolas') return '"Consolas", "Courier New", monospace';
  if (name === 'Yu Mincho') return '"Yu Mincho", "MS PMincho", serif';
  // Font names are a single CSS string, including punctuation, controls and HTML closing tags.
  const escaped = [...name].map((character) => {
    if (character === '\\' || character === '"') return `\\${character}`;
    const code = character.charCodeAt(0);
    if (code <= 31 || code === 127 || character === '<' || character === '>') return `\\${code === 0 ? 'fffd' : code.toString(16)} `;
    return character;
  }).join('');
  return `"${escaped}", sans-serif`;
}

function shadow(shadow: Shadow): string {
  return shadow.enabled ? `${shadow.x}px ${shadow.y}px ${shadow.blur}px ${rgba(shadow.color, shadow.opacity)}` : 'none';
}

function commonVariables(design: CommonDesign): Record<string, string> {
  return {
    font: fontFamily(design.fontFamily), size: `${design.fontSize}px`, text: design.textColor,
    background: rgba(design.backgroundColor, design.backgroundOpacity),
    border: design.border.enabled ? `${design.border.width}px solid ${rgba(design.border.color, design.border.opacity)}` : 'none',
    radius: `${design.radius}px`, padding: `${design.paddingY}px ${design.paddingX}px`, edge: `${design.edge}px`,
    'line-height': `${design.lineHeight}`, weight: `${design.fontWeight}`,
    'text-shadow': shadow(design.textShadow), 'card-shadow': shadow(design.cardShadow),
    outline: design.outline.enabled ? `${design.outline.width}px ${design.outline.color}` : '0px transparent',
  };
}

const horizontal = { left: 'flex-start', center: 'center', right: 'flex-end' };
const vertical = { top: 'flex-start', center: 'center', bottom: 'flex-end' };

export function generateCss(target: 'comments', design: CommentDesign): string;
export function generateCss(target: 'speech', design: SpeechDesign): string;
export function generateCss(target: Target, design: CommentDesign | SpeechDesign): string;
export function generateCss(target: Target, design: CommentDesign | SpeechDesign): string {
  const variables = commonVariables(design);
  let additions: string;
  if (target === 'comments' && 'showSource' in design) {
    Object.assign(variables, {
      gap: `${design.gap}px`, 'meta-size': `${design.metaScale}em`, 'author-color': design.authorColor,
      'source-color': design.sourceColor, 'source-background': rgba(design.sourceBackgroundColor, design.sourceBackgroundOpacity),
      'source-display': design.showSource ? 'inline-flex' : 'none', 'author-display': design.showAuthor ? 'inline' : 'none',
      'emote-height': `${design.emoteScale}em`,
    });
    additions = '\n.overlay-comments .comment-body, .overlay-comments .comment-meta {\n  -webkit-text-stroke: var(--cm-outline);\n  paint-order: stroke fill;\n}\n';
    if (!design.showSource && !design.showAuthor) additions += '\n.overlay-comments .comment-meta { display: none; margin: 0; }\n';
    if (design.serviceColorsEnabled) {
      for (const [source, color] of Object.entries(design.badgeColors)) {
        additions += `\n.overlay-comments .comment-${source} .source-badge { background: ${rgba(color, design.sourceBackgroundOpacity)}; }\n`;
      }
    }
  } else if (target === 'speech' && 'horizontal' in design) {
    Object.assign(variables, {
      'max-width': design.maxWidth === null ? '100%' : `${design.maxWidth}px`,
      horizontal: horizontal[design.horizontal], vertical: vertical[design.vertical], 'text-align': design.textAlign,
    });
    additions = '\n.speech-recognition-overlay .speech-recognition-overlay-text {\n  -webkit-text-stroke: var(--cm-outline);\n  paint-order: stroke fill;\n}\n';
  } else {
    throw new Error('表示対象とデザインが一致していません。');
  }
  const template = target === 'comments' ? commentsTemplate : speechTemplate;
  const declarations = Object.entries(variables).map(([key, value]) => `  --cm-${key}: ${value};`).join('\n');
  const css = template.replace(/:root\s*\{[^}]*\}/, () => `:root {\n${declarations}\n}`);
  if (css === template) throw new Error('OBS用CSSテンプレートの設定部分が見つかりません。');
  return css + additions;
}
