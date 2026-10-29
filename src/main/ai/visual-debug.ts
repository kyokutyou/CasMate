import type { AiGenerationEvent } from '../../shared/ai-visual';
import type { AiController } from './ai-controller';
import type { AiConnections } from './ai-connections';

/** Temporary observer. No persistence, posting or scheduling dependency. */
export class VisualDebug {
  private latest: AiGenerationEvent | null = null;
  private clearedId?: string;
  private unsubscribe?: () => void;
  private expiry?: ReturnType<typeof setTimeout>;
  private cancel?: AbortController;
  constructor(private readonly controller: AiController, private readonly connections: AiConnections) {}
  touch() {
    if (!this.unsubscribe) this.unsubscribe = this.connections.observeGeneration(event => {
      if (event.id && event.id === this.clearedId) return;
      this.latest = structuredClone(event.status === 'cancelled' ? { ...event, capture: { reason: '処理を取り消しました。', durationMs: 0 }, text: undefined } : event);
    });
    clearTimeout(this.expiry); this.expiry = setTimeout(() => this.close(), 20000); this.expiry.unref?.();
    return this.latest;
  }
  clear() { this.clearedId = this.latest?.id || this.clearedId; this.cancel?.abort(); this.latest = null; }
  close() { this.clear(); this.unsubscribe?.(); this.unsubscribe = undefined; clearTimeout(this.expiry); }
  async generate(personaId: string) {
    if (this.cancel) throw new Error('テスト生成の終了を待ってください。');
    this.touch(); this.latest = null; const cancel = new AbortController(); this.cancel = cancel;
    try {
      await this.controller.withIdleContext(async (settings, memory, signal) => {
        const persona = settings.personas.find(p => p.id === personaId);
        if (!persona || !this.connections.hasKey()) throw new Error('保存済み人格とGemini APIキーを確認してください。');
        await this.connections.generate(settings, persona, memory, false, AbortSignal.any([signal, cancel.signal, AbortSignal.timeout(35000)]), undefined, true);
      });
    } finally { this.cancel = undefined; }
  }
}
