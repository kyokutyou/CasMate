import assert from 'node:assert/strict';
import { join } from 'node:path';
import { app, BrowserWindow } from 'electron';

app.disableHardwareAcceleration();
app.setPath('userData', process.argv[3]);
app.whenReady().then(async () => {
  const window = new BrowserWindow({ show: false, width: 600, height: 1800, webPreferences: { spellcheck: false } });
  try {
    for (const width of [240, 600, 1920]) {
      window.setContentSize(width, 1800);
      await window.loadFile(process.argv[2]);
      const defaults = await window.webContents.executeJavaScript(`(() => {
        const main = document.querySelector('main');
        const cards = [...main.children];
        const boxes = cards.map(card => card.getBoundingClientRect());
        const cardStyle = getComputedStyle(cards[0]);
        const body = cards[0].querySelector('.comment-body');
        const padding = cardStyle.padding;
        const color = getComputedStyle(body).color;
        const metaSize = getComputedStyle(cards[0].querySelector('.comment-meta')).fontSize;
        const colors = cards.map(card => getComputedStyle(card).backgroundColor);
        cards[0].remove();
        return { font: getComputedStyle(main).fontSize, gap: getComputedStyle(main).gap,
          padding, color, metaSize,
          grows: boxes[1].width > boxes[0].width, wraps: cards[2].offsetHeight > cards[1].offsetHeight,
          fits: boxes.every(box => box.left >= 0 && box.right <= innerWidth),
          overflow: document.body.scrollWidth > innerWidth || cards.some(card => card.scrollWidth > card.clientWidth),
          colors, stableColor: getComputedStyle(cards[1]).backgroundColor === colors[1],
          noTime: !document.querySelector('time'), noSource: !document.querySelector('.source-badge'),
          transparent: [document.documentElement, document.body, document.getElementById('root')].every(el => getComputedStyle(el).backgroundColor === 'rgba(0, 0, 0, 0)') };
      })()`);
      assert.equal(defaults.font, '36px', 'full-canvas browser sources need a readable native font size');
      assert.ok(parseFloat(defaults.metaSize) >= 20, 'author text scales with the body rather than staying at 11px');
      assert.equal(defaults.gap, '8px');
      assert.equal(defaults.padding, '4px 6px');
      assert.equal(defaults.color, 'rgb(24, 59, 59)');
      assert.equal(defaults.grows, true);
      assert.equal(defaults.wraps, true);
      assert.equal(defaults.fits, true);
      assert.equal(defaults.overflow, false);
      assert.equal(defaults.transparent, true);
      assert.equal(defaults.stableColor, true);
      assert.equal(defaults.noTime, true);
      assert.equal(defaults.noSource, true);
      assert.equal(new Set(defaults.colors).size, 3);

      // These are the only rules a user pastes into OBS: no !important.
      const overridden = await window.webContents.executeJavaScript(`(() => {
        const sheet = document.createElement('style');
        sheet.textContent = ':root { --cm-size: 24px; --cm-text: #fff; --cm-background: #123456; --cm-padding: 2px 3px; --cm-gap: 5px; --cm-max-width: 180px; --cm-tilt: 0deg; --cm-tape-display: none; --cm-fold-display: none; }';
        document.head.append(sheet);
        const main = document.querySelector('main'), card = main.firstElementChild;
        const style = getComputedStyle(card);
        return { font: getComputedStyle(main).fontSize, color: getComputedStyle(card.querySelector('.comment-body')).color,
          background: style.backgroundColor, padding: style.padding, gap: getComputedStyle(main).gap,
          width: card.getBoundingClientRect().width,
          tape: getComputedStyle(card, '::before').display, fold: getComputedStyle(card, '::after').display };
      })()`);
      assert.equal(overridden.font, '24px');
      assert.equal(overridden.color, 'rgb(255, 255, 255)');
      assert.equal(overridden.background, 'rgb(18, 52, 86)');
      assert.equal(overridden.padding, '2px 3px');
      assert.equal(overridden.gap, '5px');
      assert.ok(overridden.width <= 180);
      assert.equal(overridden.tape, 'none');
      assert.equal(overridden.fold, 'none');
    }
    await window.loadFile(join(process.argv[3], 'legacy.html'));
    assert.deepEqual(await window.webContents.executeJavaScript(`(() => {
      const main = document.querySelector('main');
      return { font: getComputedStyle(main).fontSize, color: getComputedStyle(main).color,
        backgrounds: [...main.children].map(el => getComputedStyle(el).backgroundColor) };
    })()`), { font: '32px', color: 'rgb(255, 255, 255)', backgrounds: Array(3).fill('rgba(0, 0, 0, 0.6)') });
    await window.loadFile(join(process.argv[3], 'hidden.html'));
    assert.equal(await window.webContents.executeJavaScript(`getComputedStyle(document.querySelector('.comment-meta')).display`), 'none');
    await window.loadFile(join(process.argv[3], 'empty.html'));
    assert.equal(await window.webContents.executeJavaScript(`document.querySelectorAll('.overlay-comment').length`), 0);
    const metrics = `(() => [...document.querySelectorAll('main,.overlay-comment,.comment-meta,.source-badge,strong,.comment-body,.speech-recognition-overlay-text')].map(e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return {class:e.className,x:r.x,y:r.y,w:r.width,h:r.height,padding:s.padding,fontSize:s.fontSize,fontWeight:s.fontWeight,color:s.color,lineHeight:s.lineHeight,transform:s.transform}}))()`;
    for (const name of ['comment', 'speech']) {
      await window.loadFile(join(process.argv[3], name + '-before.html'));
      const before = await window.webContents.executeJavaScript(metrics);
      await window.loadFile(join(process.argv[3], name + '-after.html'));
      assert.deepEqual(await window.webContents.executeJavaScript(metrics), before, name + ' inherited appearance');
    }
    console.log('PASS: sticky defaults, saved appearance and CSS overrides');
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    window.destroy();
    app.quit();
  }
});
