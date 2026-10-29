export type LoadTone = 'normal' | 'raised' | 'high';
export interface LoadHistory { tone: LoadTone; at: number; up: number; down: number; green: number }
const initialTone = (value: number): LoadTone => value >= 95 ? 'high' : value >= 80 ? 'raised' : 'normal';
export function nextLoad(previous: LoadHistory | null, value: number | null, at: number | null): LoadHistory | null {
  if (value === null || at === null) return null;
  if (!previous) return { tone: initialTone(value), at, up: 0, down: 0, green: 0 };
  if (previous.at === at) return previous;
  let { tone } = previous;
  const up = value >= 95 ? previous.up + 1 : 0;
  const raised = value >= 80 ? previous.green + 1 : 0;
  const down = value < (tone === 'high' ? 90 : 75) ? previous.down + 1 : 0;
  const green = value < 75 ? previous.green + 1 : 0;
  if (up >= 2) tone = 'high';
  else if (tone === 'normal' && raised >= 2) tone = 'raised';
  else if (tone === 'high' && down >= 2) tone = green >= 2 ? 'normal' : 'raised';
  else if (tone === 'raised' && down >= 2) tone = 'normal';
  if (tone !== previous.tone) return { tone, at, up: 0, down: 0, green: 0 };
  return { tone, at, up, down, green: tone === 'normal' ? raised : green };
}
