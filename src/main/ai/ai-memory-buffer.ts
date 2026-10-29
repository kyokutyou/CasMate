import type { AiMemory } from '../../shared/ai-listener';
import { graphemes } from '../../shared/unicode';

interface MemoryEntry { record: AiMemory; characters: number }

export class AiMemoryBuffer {
  private entries: MemoryEntry[] = [];
  private snapshot: AiMemory[] = [];
  private total = 0;

  // As with the writer's snapshots, consumers must not mutate records in place.
  get records(): AiMemory[] { return this.snapshot; }
  get characters(): number { return this.total; }

  replace(records: AiMemory[], limit: number): void {
    const entries = records.map(record => ({ record, characters: graphemes(record.text).length }))
      .filter(entry => entry.characters <= limit);
    this.commit(entries, entries.reduce((sum, entry) => sum + entry.characters, 0), limit);
  }

  append(record: AiMemory, limit: number): void {
    const characters = graphemes(record.text).length;
    if (characters > limit) return;
    this.commit([...this.entries, { record, characters }], this.total + characters, limit);
  }

  resize(limit: number): void {
    const entries = this.entries.filter(entry => entry.characters <= limit);
    this.commit(entries, entries.reduce((sum, entry) => sum + entry.characters, 0), limit);
  }

  clear(): void { this.entries = []; this.snapshot = []; this.total = 0; }

  private commit(entries: MemoryEntry[], total: number, limit: number): void {
    let start = 0;
    while (total > limit && start < entries.length) total -= entries[start++]!.characters;
    this.entries = start ? entries.slice(start) : entries;
    this.snapshot = this.entries.map(entry => entry.record);
    this.total = total;
  }
}
