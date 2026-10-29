export interface AiVisualSource { uuid: string; name: string; collection: string }
export interface AiVisualSettings { enabled: boolean; source: AiVisualSource | null }
export interface AiImage { data: string; mimeType: 'image/jpeg'; width: number; height: number; bytes: number; capturedAt: string }
export interface AiCapture { image?: AiImage; reason: string; durationMs: number }
export interface AiGenerationEvent {
  id: string; stage: 'capture' | 'api'; status: 'working' | 'succeeded' | 'failed' | 'cancelled';
  capture: AiCapture; apiDurationMs: number; message: string; text?: string;
}
export type AiImageStatus = Omit<AiCapture, 'image'> & { image?: Omit<AiImage, 'data'> };
export function imageStatus(capture: AiCapture): AiImageStatus {
  if (!capture.image) return { reason: capture.reason, durationMs: capture.durationMs };
  const { mimeType, width, height, bytes, capturedAt } = capture.image;
  return { reason: capture.reason, durationMs: capture.durationMs, image: { mimeType, width, height, bytes, capturedAt } };
}
