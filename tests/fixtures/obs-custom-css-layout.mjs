import assert from 'node:assert/strict';
import { app, BrowserWindow } from 'electron';

app.disableHardwareAcceleration();
app.setPath('userData', process.argv[3]);
app.whenReady().then(async () => {
const window = new BrowserWindow({ show: false, width: 600, height: 800, webPreferences: { backgroundThrottling: false, spellcheck: false } });
try {
  const mode = process.argv[4];
  const speech = mode === 'speech';
  for (const width of [240, 600, 1600]) {
    window.setContentSize(width, 800);
    await window.loadFile(process.argv[2]);
    const result = await window.webContents.executeJavaScript(`(() => {
      const main = document.querySelector('main');
      const card = main.firstElementChild;
      const style = getComputedStyle(main), box = getComputedStyle(card);
      const body = document.querySelector('.comment-body') || card;
      const rect = body.getBoundingClientRect();
      return { font: style.fontSize, color: style.color, padding: box.paddingTop,
        background: box.backgroundColor, radius: box.borderTopLeftRadius,
        wraps: rect.height > parseFloat(getComputedStyle(body).lineHeight) * 2,
        horizontalOverflow: document.body.scrollWidth > innerWidth || card.scrollWidth > card.clientWidth,
        transparent: [document.documentElement, document.body, document.getElementById('root')].every(element => getComputedStyle(element).backgroundColor === 'rgba(0, 0, 0, 0)'),
        order: [...main.querySelectorAll('.source-badge')].map(element => element.textContent),
        gap: style.gap, emoteHeight: document.querySelector('.emote') && getComputedStyle(document.querySelector('.emote')).height,
        transforms: [...main.children].map(element => getComputedStyle(element).transform),
        decorations: [...main.children].map(element => [getComputedStyle(element, '::before').display, getComputedStyle(element, '::after').display]) };
    })()`);
    assert.equal(result.font, speech ? '40px' : '32px');
    assert.equal(result.color, 'rgb(255, 255, 255)');
    assert.equal(result.padding, '12px');
    assert.equal(result.background, 'rgba(16, 20, 32, 0.78)');
    assert.equal(result.radius, '14px');
    assert.equal(result.wraps, true);
    assert.equal(result.horizontalOverflow, false);
    assert.equal(result.transparent, true);
    if (!speech) {
      assert.ok(result.transforms.every(transform => transform === 'matrix(1, 0, 0, 1, 0, 0)'), 'plain template has no tilt on any card');
      assert.ok(result.decorations.every(([tape, fold]) => tape === 'none' && fold === 'none'), 'plain template has no sticky decorations');
      assert.equal(result.gap, '8px');
      assert.equal(result.emoteHeight, '46.4px');
      assert.deepEqual(result.order, mode === 'comments-top' ? ['したらば', 'Twitch', 'YouTube Live'] : mode === 'comments-single' ? ['YouTube Live'] : ['YouTube Live', 'Twitch', 'したらば']);
      // A user edit must reach the rendered text, including an OBS-only field toggle.
      assert.deepEqual(await window.webContents.executeJavaScript(`(() => {
        document.documentElement.style.setProperty('--cm-size', '36px');
        document.documentElement.style.setProperty('--cm-source-display', 'none');
        document.documentElement.style.setProperty('--cm-author-color', '#ffd1dc');
        return { size: getComputedStyle(document.querySelector('main')).fontSize,
          badge: getComputedStyle(document.querySelector('.source-badge')).display,
          author: getComputedStyle(document.querySelector('.comment-meta strong')).color };
      })()`), { size: '36px', badge: 'none', author: 'rgb(255, 209, 220)' });
    } else {
      assert.equal(await window.webContents.executeJavaScript(`(() => {
        const card = document.querySelector('.speech-recognition-overlay-text'); card.textContent = '短い字幕';
        const rect = card.getBoundingClientRect();
        return Math.abs(rect.left - 12) < 1 && Math.abs(rect.bottom - (innerHeight - 12)) < 1;
      })()`), true, 'default left-bottom subtitle');
      assert.equal(await window.webContents.executeJavaScript(`(() => {
        document.documentElement.style.setProperty('--cm-horizontal', 'center');
        document.documentElement.style.setProperty('--cm-vertical', 'flex-start');
        document.documentElement.style.setProperty('--cm-text-align', 'center');
        document.documentElement.style.setProperty('--cm-max-width', '120px');
        const card = document.querySelector('.speech-recognition-overlay-text');
        const rect = card.getBoundingClientRect();
        return Math.abs(rect.left + rect.width / 2 - innerWidth / 2) < 1 && Math.abs(rect.top - 12) < 1
          && rect.width <= 120 && getComputedStyle(card).textAlign === 'center';
      })()`), true, 'custom position, alignment and maximum width');
    }
    assert.equal(await window.webContents.executeJavaScript(`(() => {
      document.getElementById('root').replaceChildren();
      return [document.documentElement, document.body, document.getElementById('root')].every(element => getComputedStyle(element).backgroundColor === 'rgba(0, 0, 0, 0)');
    })()`), true, 'transparent after content disappears');
  }
  console.log(`PASS: ${mode}`);
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  window.destroy();
  app.quit();
}
});
