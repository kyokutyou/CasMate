import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { app, BrowserWindow } from 'electron';

app.disableHardwareAcceleration();
app.setPath('userData', process.argv[3]);
app.whenReady().then(async () => {
  const window = new BrowserWindow({ show: false, width: 320, height: 700, webPreferences: { spellcheck: false } });
  const settle = () => window.webContents.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
  const metrics = () => window.webContents.executeJavaScript(`(() => {
    const main = document.querySelector('main'), cards = [...main.children];
    const rects = cards.map(card => { const r = card.getBoundingClientRect(); return { top:r.top, bottom:r.bottom, height:r.height }; });
    return { rects, texts:cards.map(card => card.textContent), height:innerHeight,
      overflow:document.documentElement.scrollWidth > innerWidth || document.body.scrollWidth > innerWidth,
      transparent:[document.documentElement,document.body,document.getElementById('root'),main].every(el => getComputedStyle(el).backgroundColor === 'rgba(0, 0, 0, 0)'),
      left:rects.length ? cards[0].getBoundingClientRect().left : 0 };
  })()`);
  try {
    for (const direction of ['newestTop', 'newestBottom']) for (const alignment of ['top', 'bottom']) {
      window.setContentSize(320, 700);
      await window.loadFile(join(process.argv[3], `${direction}-${alignment}-few.html`)); await settle();
      const few = await metrics();
      assert.equal(few.overflow, false); assert.equal(few.transparent, true);
      assert.ok(Math.abs(few.left - 12) < 1);
      assert.match(few.texts[0], direction === 'newestTop' ? /コメント1/ : /コメント0/);
      assert.ok(Math.abs(alignment === 'top' ? few.rects[0].top - 12 : few.rects.at(-1).bottom - (few.height - 12)) < 1, `${direction}/${alignment} sparse alignment`);
      await writeFile(join(process.argv[4], `${direction}-${alignment}.png`), (await window.webContents.capturePage()).toPNG());
      window.setContentSize(320, 260);
      await window.loadFile(join(process.argv[3], `${direction}-${alignment}-many.html`)); await settle();
      const crowded = await metrics();
      assert.equal(crowded.rects.length, 50); assert.equal(crowded.overflow, false);
      const newest = direction === 'newestTop' ? crowded.rects[0] : crowded.rects.at(-1);
      const oldest = direction === 'newestTop' ? crowded.rects.at(-1) : crowded.rects[0];
      assert.ok(newest.height > 60, 'long newest comment wraps');
      assert.ok(direction === 'newestTop' ? Math.abs(newest.top - 12) < 1 : Math.abs(newest.bottom - (crowded.height - 12)) < 1, 'overflow keeps the newest end');
      assert.ok(direction === 'newestTop' ? oldest.top > crowded.height : oldest.bottom < 0, 'oldest is clipped');
      window.setContentSize(600, 6000); await settle();
      const expanded = await metrics();
      assert.equal(expanded.rects.length, 50);
      assert.ok(expanded.rects.every(rect => rect.top >= 11 && rect.bottom <= expanded.height - 11), 'resizing reveals all retained comments');
      await window.webContents.executeJavaScript('document.querySelector("main").replaceChildren()');
      assert.equal((await metrics()).transparent, true);
    }
    console.log('PASS: 4 stack placements, overflow and resize');
  } catch (error) { console.error(error); process.exitCode = 1; }
  finally { window.destroy(); app.quit(); }
});
