import type {
  SpeechRecognitionOverlayState,
  SpeechRecognitionResult,
} from '../../shared/types';


export class SpeechRecognitionOverlayController {
  private active: SpeechRecognitionOverlayState['active'] = null;
  private timer?: NodeJS.Timeout;

  constructor(
    private enabled: boolean,
    private readonly onChange: (state: SpeechRecognitionOverlayState) => void = () => undefined,
    private displayDurationSeconds = 10,
  ) {}

  accept(result: SpeechRecognitionResult): void {
    if (!this.enabled) return;
    if (!result.text.trim()) {
      this.clear();
      return;
    }
    const duration = this.displayDurationSeconds * 1_000;
    this.active = {
      id: result.id,
      text: result.text,
      expiresAt: new Date(Date.now() + duration).toISOString(),
    };
    this.changed();
  }

  updateEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) this.clear();
  }

  updateDuration(seconds: number): void {
    this.displayDurationSeconds = seconds;
  }

  snapshot(): SpeechRecognitionOverlayState {
    if (this.active && new Date(this.active.expiresAt).getTime() <= Date.now()) {
      this.cancelTimer();
      this.active = null;
    }
    return { active: this.active ? { ...this.active } : null };
  }

  clear(): void {
    this.cancelTimer();
    if (!this.active) return;
    this.active = null;
    this.onChange(this.snapshot());
  }

  dispose(): void {
    this.cancelTimer();
    this.active = null;
  }

  private changed(): void {
    this.cancelTimer();
    this.scheduleExpiry();
    this.onChange(this.snapshot());
  }

  private scheduleExpiry(): void {
    if (!this.active) return;
    const expiresAt = new Date(this.active.expiresAt).getTime();
    this.timer = setTimeout(() => {
      this.timer = undefined;
      if (!this.active) return;
      if (new Date(this.active.expiresAt).getTime() > Date.now()) {
        this.scheduleExpiry();
        return;
      }
      this.active = null;
      this.onChange(this.snapshot());
    }, Math.max(0, expiresAt - Date.now()));
    this.timer.unref?.();
  }

  private cancelTimer(): void {
    if (!this.timer) return;
    clearTimeout(this.timer);
    this.timer = undefined;
  }
}
