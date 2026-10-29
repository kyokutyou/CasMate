import { join } from 'node:path';

export const APP_DISPLAY_NAME = 'CasMate';

export function withAppWindowTitle<T extends object>(options: T): T & { title: string } {
  return { ...options, title: APP_DISPLAY_NAME };
}

export function legacyUserDataDirectory(appDataDirectory: string): string {
  // Keep the native speech-recognition worker's paths ASCII-only. The worker
  // passes model paths to native libraries that may not handle Unicode paths
  // consistently in the packaged application.
  return join(appDataDirectory, 'CasMate');
}
