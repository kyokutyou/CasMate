import { reactionSticker } from '../../shared/reaction-stickers';
import { useEffect, useRef } from 'react';
import { useTransparentDocument } from '../use-transparent-document';
import { playReactionParticles } from '../reactions/particles';
import { reactionEventAge } from '../reactions/event-age';
import { placeArea } from '../reactions/client/range.mjs';
import { placeArrow } from '../reactions/client/arrow.mjs';
import { placeMarker } from '../reactions/client/pointing.mjs';
import type { ReactionDesktopEvent, ReactionDesktopMarker, ReactionEvent, ReactionSnapshot } from '../../shared/listener-reactions';
import '../reactions/overlay.css';
interface DesktopBridge { reaction(listener: (event: ReactionDesktopEvent) => void): void; marker(listener: (data: ReactionDesktopMarker) => void): void; clear(listener: () => void): void }
export function ReactionOverlayPage() {
  useTransparentDocument(); const layer = useRef<HTMLDivElement>(null), particles = useRef<HTMLDivElement>(null), areas = useRef<HTMLDivElement>(null);
  const bridge = (window as Window & { casmateReactionDesktop?: DesktopBridge }).casmateReactionDesktop;
  useEffect(() => {
    let stopped = false, instance = '', sequence = 0, generation = -1;
    const clear = () => { layer.current?.replaceChildren(); particles.current?.replaceChildren(); areas.current?.replaceChildren(); };
    if (bridge) {
      bridge.reaction(data => {
        if (stopped) return;
        if (data.kind === 'arrow') {
          const age = reactionEventAge(data.at);
          if (areas.current && data.accepting && data.from && data.to && data.frame && age !== null && age < 4000) placeArrow(areas.current,data.from,data.to,{age,clip:data.clip});
        } else if (data.kind === 'area') {
          const age = reactionEventAge(data.at);
          if (areas.current && data.accepting && data.area && data.shape && data.frame && age !== null && age < 4000) placeArea(areas.current,data.area,data.shape,data.frame.canvasWidth,{duration:4000-age,clip:data.clip});
        } else if (particles.current) playReactionParticles(particles.current, data);
      });
      bridge.marker(data => {
        if (stopped || !layer.current) return;
        Object.assign(layer.current.style, { position: 'absolute', inset: 'auto', left: data.region.x * 100 + '%', top: data.region.y * 100 + '%', width: data.region.width * 100 + '%', height: data.region.height * 100 + '%' });
        const age = data.at === undefined ? 0 : reactionEventAge(data.at);
        if (age !== null && age < 4000) placeMarker(layer.current, data.x, data.y, data.canvasWidth, {duration:4000-age,intent:data.intent});
      }); bridge.clear(clear);
      return () => { stopped = true; clear(); };
    }
    const events = new EventSource('/api/overlays/reactions/events');
    events.onerror = clear;
    const update = (data: ReactionSnapshot) => { if (generation !== data.frameGeneration || !data.accepting) clear(); generation = data.frameGeneration; };
    events.addEventListener('snapshot', raw => { try { const data: ReactionSnapshot = JSON.parse(raw.data); instance = data.instance; sequence = data.sequence; update(data); } catch { clear(); } });
    events.addEventListener('reaction', raw => {
      try {
        const data: ReactionEvent = JSON.parse(raw.data);
        if (data.instance === instance && data.sequence <= sequence) return;
        instance = data.instance; sequence = data.sequence; update(data);
        const age = reactionEventAge(data.at);
        if (!data.accepting || age === null || (data.kind === 'area' || data.kind === 'point' || data.kind === 'arrow' ? age >= 4000 : age >= (data.kind === 'sticker' ? reactionSticker(data.sticker)?.duration ?? 0 : 3001))) return;
        if (data.kind === 'arrow' && areas.current && data.from && data.to && data.frame) { placeArrow(areas.current,data.from,data.to,{age}); return; }
        if (data.kind === 'area' && areas.current && data.area && data.shape && data.frame) { placeArea(areas.current,data.area,data.shape,data.frame.canvasWidth,{duration:4000-age}); return; }
        if (data.kind === 'point' && layer.current && data.frame && typeof data.x === 'number' && typeof data.y === 'number') { placeMarker(layer.current, data.x, data.y, data.frame.canvasWidth, {duration:4000-age,intent:data.intent}); return; }
        const container = particles.current; if (!container || !['heart','clap','cheer','sticker'].includes(data.kind)) return;
        playReactionParticles(container, data);
      } catch { clear(); }
    });
    return () => { stopped = true; events.close(); clear(); };
  }, [bridge]);
  return <div className="reaction-overlay"><div ref={particles} className="reaction-particles"/><div ref={layer} className={bridge ? 'reaction-markers desktop-markers' : 'reaction-markers'}/><div ref={areas} className="area-layer"/></div>;
}
