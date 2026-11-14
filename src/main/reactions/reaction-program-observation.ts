export type ReactionProgram = { context: string; scene: string };

/** Orders confirmations from independent OBS reads and image capture. */
export class ReactionProgramObservation {
  private current?: ReactionProgram;
  private confirmation = 0;

  get latest(): ReactionProgram | undefined { return this.current; }

  begin(): number { return this.confirmation; }

  isUncontested(start: number): boolean { return start === this.confirmation; }

  accept(start: number, next: ReactionProgram): 'changed' | 'unchanged' | 'overlap' {
    const changed = this.current && (this.current.context !== next.context || this.current.scene !== next.scene);
    // A different result overlapping another accepted observation cannot prove
    // which scene is newer. Keep the current one until a fresh read or capture.
    if (changed && !this.isUncontested(start)) return 'overlap';
    this.current = { context: next.context, scene: next.scene };
    this.confirmation++;
    return changed ? 'changed' : 'unchanged';
  }
}
