// Measure in the element's document (including preview iframes). Canvas metrics
// remove font leading without changing the distance between body baselines.
export function updateCommentInkGap(main: HTMLElement) {
  const document = main.ownerDocument;
  const view = document.defaultView;
  if (!view || !('CanvasRenderingContext2D' in view)) return;
  const context = document.createElement('canvas').getContext('2d');
  if (!context) return;
  const scale = main.offsetWidth ? main.getBoundingClientRect().width / main.offsetWidth : 0;
  if (!scale) return;
  const metrics = new Map<string, TextMetrics>();
  const startsWithBlankLine = (element: HTMLElement) => {
    const walker = document.createTreeWalker(element, 5 /* SHOW_ELEMENT | SHOW_TEXT */);
    let node: Node | null;
    while ((node = walker.nextNode())) {
      const parent = node.nodeType === 1 ? node as HTMLElement : node.parentElement;
      if (!parent?.getClientRects().length || view.getComputedStyle(parent).visibility === 'hidden') continue;
      if (node.nodeType === 1) {
        if (parent.tagName === 'IMG') return false;
        if (parent.tagName === 'BR') return true;
      } else for (const character of node.textContent ?? '') {
        if (character === '\n' || character === '\r') return true;
        if (!/\s/u.test(character)) return false;
      }
    }
    return false;
  };
  const ink = (element: HTMLElement, end: boolean): number | undefined => {
    const edges: number[] = [];
    const walker = document.createTreeWalker(element, 4 /* SHOW_TEXT */);
    let node: Node | null;
    while ((node = walker.nextNode())) {
      const parent = node.parentElement;
      if (!parent || view.getComputedStyle(parent).visibility === 'hidden') continue;
      const text = node.textContent ?? '';
      const range = document.createRange();
      range.selectNodeContents(node);
      const rows = [...range.getClientRects()].filter(rect => rect.height > 0);
      const row = end ? rows.at(-1) : rows[0];
      if (!row) continue;
      const style = view.getComputedStyle(parent);
      const font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
      context.font = font;
      // Iterate just the edge line, preserving surrogate pairs and font fallback.
      const characters = Array.from(text);
      let offset = end ? text.length : 0;
      if (end) characters.reverse();
      for (const character of characters) {
        const start = end ? offset - character.length : offset;
        range.setStart(node, start);
        range.setEnd(node, start + character.length);
        offset += (end ? -1 : 1) * character.length;
        const rect = range.getBoundingClientRect();
        if (Math.abs(rect.top - row.top) > scale) break;
        if (/\s/u.test(character)) continue;
        const key = `${font}\n${character}`;
        let metric = metrics.get(key);
        if (!metric) { metric = context.measureText(character); metrics.set(key, metric); }
        if (!metric.actualBoundingBoxAscent && !metric.actualBoundingBoxDescent) continue;
        const baseline = rect.top + metric.fontBoundingBoxAscent * scale;
        edges.push(end ? baseline + metric.actualBoundingBoxDescent * scale : baseline - metric.actualBoundingBoxAscent * scale);
      }
    }
    for (const image of element.querySelectorAll('img')) {
      if (image.getClientRects().length) {
        const rect = image.getBoundingClientRect();
        edges.push(end ? rect.bottom : rect.top);
      }
    }
    // A badge's painted background must not collide with the body text.
    if (end) for (const badge of element.querySelectorAll<HTMLElement>('.source-badge')) {
      const style = view.getComputedStyle(badge);
      if (badge.getClientRects().length && style.backgroundColor !== 'rgba(0, 0, 0, 0)' && style.backgroundColor !== 'transparent') {
        edges.push(badge.getBoundingClientRect().bottom);
      }
    }
    return edges.length ? (end ? Math.max(...edges) : Math.min(...edges)) : undefined;
  };
  for (const card of main.querySelectorAll<HTMLElement>('.overlay-comment')) {
    const meta = card.querySelector<HTMLElement>('.comment-meta');
    const body = card.querySelector<HTMLElement>('.comment-body');
    if (!meta) continue;
    meta.style.removeProperty('--cm-ink-gap-trim');
    const style = view.getComputedStyle(meta);
    if (!body || !(style.getPropertyValue('--cm-meta-gap').trim() || style.getPropertyValue('--cm-design-meta-gap').trim())) continue;
    if (!meta.offsetHeight || !body.offsetHeight) continue;
    // Range rectangles include sticky-note rotation; measure before that transform.
    const transform = card.style.getPropertyValue('transform');
    const priority = card.style.getPropertyPriority('transform');
    card.style.setProperty('transform', 'none', 'important');
    try {
      const bottom = ink(meta, true);
      const top = ink(body, false);
      if (bottom === undefined || top === undefined) continue;
      // Tight line heights can place ink outside the box: signed leading also
      // adds the space needed to keep those glyphs from overlapping.
      const under = meta.getBoundingClientRect().bottom - bottom;
      const over = startsWithBlankLine(body) ? 0 : top - body.getBoundingClientRect().top;
      // Quantize subpixel Range noise so scaled previews and live views agree.
      meta.style.setProperty('--cm-ink-gap-trim', `${Math.round((under + over) / scale * 4) / 4}px`);
    } finally {
      if (transform) card.style.setProperty('transform', transform, priority);
      else card.style.removeProperty('transform');
    }
  }
}
