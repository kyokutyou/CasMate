let gate: Promise<void> | undefined;
let release: (() => void) | undefined;
let failure = false;
Object.assign(window, { fontHarness: {
  hold() { gate = new Promise(resolve => { release = resolve; }); },
  release() { release?.(); release = undefined; },
  fail() { failure = true; },
} });
export async function loadWindowsFonts() {
  const waiting = gate; gate = undefined;
  if (waiting) await waiting;
  if (failure) { failure = false; throw new Error('フォント一覧を取得できませんでした。'); }
  return ['Yu Gothic UI', 'Meiryo'];
}
