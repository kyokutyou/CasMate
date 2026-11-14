import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { ReactionOverlayPage } from '../../src/renderer/pages/ReactionOverlayPage';
import type { ReactionEvent, ReactionSnapshot } from '../../src/shared/listener-reactions';

declare global { interface Window { pushReaction(data: ReactionEvent | ReactionSnapshot, type?: string): void } }
class FixtureEvents extends EventTarget {
  constructor() { super(); window.pushReaction = (data, type = 'reaction') => this.dispatchEvent(new MessageEvent(type, { data: JSON.stringify(data) })); }
  close() {}
}
Object.defineProperty(window, 'EventSource', { value: FixtureEvents });
flushSync(() => createRoot(document.getElementById('root')!).render(<ReactionOverlayPage/>));
