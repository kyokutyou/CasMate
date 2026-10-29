import { createRoot } from 'react-dom/client';
import { MobileCommentsPage } from '../../src/renderer/pages/MobileCommentsPage';
import { MOBILE_PROTOCOL_VERSION, type CommentListSettings, type CommonComment } from '../../src/shared/types';
import '../../src/renderer/styles.css';

const fontScale = Number(new URLSearchParams(location.search).get('fontScale')) || 1;
// Exercise font enlargement without changing the available CSS viewport width.
document.documentElement.style.fontSize = `${16 * fontScale}px`;
const settings: CommentListSettings = {
  showSource: true,
  showAuthor: true,
  showContent: true,
  stackDirection: 'newestBottom',
  fontFamily: 'Yu Gothic UI',
  fontSizePx: 18 * fontScale,
  textColor: '#113322',
  backgroundColor: '#e0ede6',
};
const comment = (sequence: number): CommonComment => ({
  id: `youtube:layout-${sequence}`,
  externalId: `layout-${sequence}`,
  sequence,
  source: sequence % 3 === 0 ? 'shitaraba' : sequence % 3 === 1 ? 'youtube' : 'twitch',
  authorName: `視聴者${sequence}`,
  content: [{ type: 'text', text: sequence === 10
    ? `長い文章とリンクも画面内で折り返す https://example.invalid/${'long-url-'.repeat(18)}`
    : `コメント${sequence}。映像と音声、どちらも届いています。` }],
  receivedAt: '2026-10-06T18:00:00.000Z',
  initialHistory: true,
});
let revision = 1;
let sequence = 40;
const messages: string[] = [];
const wire = (type: string, payload: object) => ({ type, payload, revision, generation: 1, connectionId: 'layout-connection' });
const bridge = {
  onmessage: null as ((event: { data: string }) => void) | null,
  postMessage(message: string) {
    messages.push(message);
    if (message !== 'ready') return;
    queueMicrotask(() => {
      emit(wire('mobile.snapshotBegin', {
        protocolVersion: MOBILE_PROTOCOL_VERSION,
        sourcesRunning: true,
        mobilePublished: true,
        audioAvailable: true,
        commentList: settings,
      }));
      emit(wire('mobile.snapshotChunk', { comments: Array.from({ length: sequence }, (_, index) => comment(index + 1)) }));
      emit(wire('mobile.snapshotEnd', {}));
    });
  },
};
function emit(event: object) { bridge.onmessage?.({ data: JSON.stringify(event) }); }
declare global {
  interface Window {
    CasMateComments: typeof bridge;
    androidCommentsHarness: {
      connected(value: boolean): void;
      sourcesRunning(value: boolean): void;
      theme(value: 'light' | 'dark'): void;
      add(): void;
      clear(): void;
      messages(): string[];
      fontSize: number;
    };
  }
}
window.CasMateComments = bridge;
window.androidCommentsHarness = {
  connected: value => emit(wire('mobile.connection', { connected: value })),
  sourcesRunning: value => emit(wire('source.activityChanged', { sourcesRunning: value })),
  theme: value => emit({ type: 'android.presentation', payload: { theme: value } }),
  add() { revision += 1; sequence += 1; emit(wire('comment.received', comment(sequence))); },
  clear() {
    revision += 1;
    emit(wire('mobile.snapshotBegin', { protocolVersion:MOBILE_PROTOCOL_VERSION, sourcesRunning:true,
      mobilePublished:true, audioAvailable:true, commentList:settings }));
    emit(wire('mobile.snapshotEnd', {}));
  },
  messages: () => [...messages],
  fontSize: settings.fontSizePx,
};
createRoot(document.getElementById('root')!).render(<MobileCommentsPage nativeOnly />);
