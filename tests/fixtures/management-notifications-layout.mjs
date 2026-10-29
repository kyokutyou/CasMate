import { app, BrowserWindow } from 'electron';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { writeFile } from 'node:fs/promises';

app.disableHardwareAcceleration();
app.setPath('userData', join(process.argv[3], 'profile'));
app.whenReady().then(async () => {
  const window = new BrowserWindow({ show: false, width: 760, height: 760,
    minWidth: 320, minHeight: 360,
    webPreferences: { contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
  window.setMenuBarVisibility(false);
  window.webContents.on('console-message', details => {
    if (details.level === 'error') console.error(`Renderer: ${details.message}`);
  });
  try {
    const evaluate = code => window.webContents.executeJavaScript(code);
    const update = values => evaluate(`window.notificationHarness.update(${JSON.stringify(values)})`);
    const capture = async name => {
      // Geometry is measured synchronously; allow the compositor to present that frame for screenshots.
      await new Promise(resolve => setTimeout(resolve, 50));
      await writeFile(join(process.argv[4], name), (await window.webContents.capturePage()).toPNG());
    };
    const activate = selector => evaluate(`(() => { const element = document.querySelector(${JSON.stringify(selector)});
      element.focus({preventScroll:true}); element.click(); })()`);
    const ready = async () => {
      const deadline = Date.now() + 3000;
      while (!await evaluate('window.notificationHarness?.ready()')) {
        if (Date.now() >= deadline) throw new Error(`Actual PC values were not rendered: ${await evaluate("JSON.stringify({ready: Boolean(window.notificationHarness), pc: document.querySelector('.pc-status-button')?.textContent, content: document.body.textContent.slice(0, 250)})")}`);
        await new Promise(resolve => setTimeout(resolve, 10));
      }
    };
    const measure = prefix => evaluate(`(() => {
      const box = element => { const { x, y, width, height } = element.getBoundingClientRect(); return { x, y, width, height }; };
      const body = document.querySelector('.management-body');
      return { input: box(document.getElementById('${prefix}-input')), action: box(document.getElementById('${prefix}-action')),
        body: box(body), height: body.scrollHeight, scroll: body.scrollTop, header: box(document.querySelector('.management-header')),
        nav: box(document.querySelector('.management-nav')), focus: document.activeElement.id,
        overflow: body.scrollWidth > body.clientWidth || document.documentElement.scrollWidth > innerWidth };
    })()`);
    const overlap = () => evaluate(`(() => {
      const toast = document.querySelector('.toast-region .banner'); if (!toast) return [];
      const a = toast.getBoundingClientRect();
      const protectedElements = document.querySelectorAll('.management-brand, .pc-status-button, .pc-reading > span, .management-connection, .management-header button, .management-nav, .management-body');
      return [...protectedElements].filter(element => {
        if (!element.checkVisibility()) return false;
        const b = element.getBoundingClientRect();
        return Math.min(a.right, b.right) - Math.max(a.left, b.left) > .5 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > .5;
      }).map(element => ({ element: element.className, toast: { top: a.top, bottom: a.bottom },
        bounds: { top: element.getBoundingClientRect().top, bottom: element.getBoundingClientRect().bottom } }));
    })()`);
    const headerBounds = () => evaluate(`(() => {
      const header = document.querySelector('.management-header').getBoundingClientRect();
      const nav = document.querySelector('.management-nav').getBoundingClientRect();
      const issues = [];
      const headerNode=document.querySelector('.management-header');
      const baseHeight=parseFloat(getComputedStyle(headerNode).getPropertyValue('--management-header-height'));
      const compact=innerWidth <= 300 && innerHeight <= 360;
      const extra=headerNode.dataset.home === 'true' && innerWidth <= 620 ? (compact ? 51 : innerWidth <= 300 ? 53 : 47) : 0;
      if (Math.abs(header.height - baseHeight - extra) > .6 || header.bottom > nav.top + .5) issues.push('header height or navigation overlap');
      if(headerNode.dataset.home === 'true' && innerWidth>620) {
        const brand=document.querySelector('.management-brand').getBoundingClientRect(),pc=document.querySelector('.pc-status-button').getBoundingClientRect();
        if(Math.abs((brand.top+brand.bottom)/2-(pc.top+pc.bottom)/2)>.6||pc.left<brand.right)issues.push('brand and PC status must share one row');
      }
      for (const element of document.querySelectorAll('.management-brand, .pc-status-button, .management-connection, .toast-region .banner')) {
        if (!element.checkVisibility()) continue;
        const box = element.getBoundingClientRect();
        if (box.left < -.5 || box.right > innerWidth + .5 || box.top < header.top - .5 || box.bottom > header.bottom + .5) issues.push(element.className);
      }
      const readings = [...document.querySelectorAll('.pc-reading > span')].filter(element => element.checkVisibility()).map(element => element.getBoundingClientRect());
      if (readings.some((box, i) => i > 0 && box.left < readings[i - 1].right - .5)) issues.push('PC values overlap');
      return issues;
    })()`);
    const assertToast = async message => {
      const rendered = await evaluate(`(() => {
        const banner = document.querySelector('.toast-region .banner');
        const text = document.querySelector('.toast-message');
        const box = banner?.getBoundingClientRect();
        return { exists: Boolean(banner), visible: banner?.checkVisibility({opacityProperty:true, visibilityProperty:true}) ?? false,
          width: box?.width ?? 0, height: box?.height ?? 0, text: text?.textContent ?? '', title: text?.getAttribute('title') ?? '' };
      })()`);
      assert.equal(rendered.exists, message !== null, 'actual toast presence');
      if (message !== null) {
        assert.ok(rendered.visible && rendered.width > 0 && rendered.height > 0, 'success toast must be visible with positive dimensions');
        assert.equal(rendered.text, message, 'actual toast text');
        assert.equal(rendered.title, message, 'full toast explanation');
      }
    };
    let count = 0;
    for (const width of [320, 420, 480, 560, 620, 621, 640, 641, 760, 900, 901, 1200]) {
      window.setContentSize(width, width <= 560 ? 760 : 560);
      await window.loadFile(process.argv[2]); await ready();
      for(const textSize of ['small','medium','large']) for (const expanded of [false, true]) for (const page of ['home', 'settings']) for (const connected of [true, false]) {
        const label = `${textSize}/${width}px/${page}/${connected ? 'connected' : 'reconnecting'}/${expanded ? 'expanded' : 'regular'}`;
        await update({ stage: 'idle', message: '', expanded, connected, textSize }); await ready();
        await evaluate(`document.querySelector('.management-nav > button[data-page="${page}"]').click()`);
        if (page === 'settings') await evaluate(`document.getElementById('settings-commentSpeech').click()`);
        const prefix = page === 'home' ? 'home' : 'editor';
        await evaluate(`(() => { const input = document.getElementById('${prefix}-input'); const body = document.querySelector('.management-body');
          body.scrollTop += input.getBoundingClientRect().top - 240; input.focus({preventScroll:true}); })()`);
        const before = await measure(prefix);
        assert.equal(before.overflow, false, `${label}: initial overflow`);
        assert.ok(before.scroll > 0, `${label}: must exercise scrolled content`);
        const states = [{ stage: 'processing' }, { stage: 'success', message: '設定を保存しました。' },
          { stage: 'success', message: '長い設定値を保存しました。'.repeat(30) }, { stage: 'error', message: '接続に失敗しました。'.repeat(30) },
          { stage: 'processing' }, { stage: 'success', message: '連続した操作の通知です。' }, { stage: 'idle', message: '' }];
        for (const next of states) {
          await update(next);
          assert.deepEqual(await measure(prefix), before, `${label}/${next.stage}: notification shifted controls`);
          const failures = await overlap();
          if (failures.length) await capture('overlap.png');
          assert.deepEqual(failures, [], `${label}/${next.stage}: toast overlaps visible elements`);
          assert.deepEqual(await headerBounds(), [], `${label}/${next.stage}: header bounds`);
          await assertToast(next.stage === 'success' ? next.message : null);
          if (width === 320 && page === 'home' && connected && !expanded && next.stage === 'success') {
            // Prove that invisible DOM text cannot satisfy the drawing check.
            for (const hiding of ['display:none', 'visibility:hidden', 'opacity:0']) {
              await evaluate(`document.querySelector('.toast-region').style.cssText = ${JSON.stringify(hiding)}`);
              await assert.rejects(assertToast(next.message), /must be visible/, `must reject ${hiding}`);
              await evaluate("document.querySelector('.toast-region').removeAttribute('style')");
            }
          }
          const actual = await evaluate(`({ banner: document.querySelector('.toast-message')?.textContent ?? '',
            warning: document.querySelector('.management-warning-count').textContent,
            disabled: document.getElementById('${prefix}-action').disabled })`);
          assert.equal(actual.banner, next.stage === 'success' ? next.message : '', `${label}: actual toast state`);
          assert.match(actual.warning, next.stage === 'error' ? /1件/ : /0件/, `${label}: persistent error destination`);
          assert.equal(actual.disabled, next.stage === 'processing', `${label}: actual processing state`);
        }
        if (textSize==='medium' && !expanded && connected && [320, 560, 760, 1200].includes(width)) {
          await update({ stage: 'success', message: '設定を保存しました。' });
          await assertToast('設定を保存しました。');
          await capture(`${page}-${width}.png`);
          if (width === 320 && page === 'home') await writeFile(join(process.argv[4], 'header-320.png'),
            (await window.webContents.capturePage({ x: 0, y: 0, width: 320, height: 100 })).toPNG());
        }
        count++;
      }
      // Use the current product's entries, never a historical fixed editor count.
      await update({ stage: 'idle', message: '' });
      await evaluate("document.querySelector('.management-nav > button[data-page=\"settings\"]').click()");
      const entries = await evaluate("[...document.querySelectorAll('.management-categories .management-entry')].map(element => element.id)");
      for (const entry of entries) {
        await evaluate(`document.getElementById(${JSON.stringify(entry)}).scrollIntoView({block:'center'})`);
        const originScroll = await evaluate("document.querySelector('.management-body').scrollTop");
        await activate(`#${entry}`);
        assert.equal(await evaluate('document.activeElement.id'), 'editor-heading', `${width}px/${entry}: entry focus`);
        await evaluate("document.getElementById('editor-input').focus({preventScroll:true})");
        const before = await measure('editor');
        const message = '長い共通通知を表示しています。'.repeat(30);
        await update({ stage: 'success', message });
        await assertToast(message);
        assert.deepEqual(await measure('editor'), before, `${width}px/${entry}: editor notification shift`);
        assert.deepEqual(await overlap(), [], `${width}px/${entry}: editor notification overlap`);
        await activate('.back-button');
        assert.equal(await evaluate('document.activeElement.id'), entry, `${width}px/${entry}: return focus`);
        const restored = await evaluate("({top: document.querySelector('.management-body').scrollTop, pixel: 1 / devicePixelRatio})");
        // Native fractional scaling rounds scroll restoration to a physical pixel at the end of the page.
        assert.ok(Math.abs(restored.top - originScroll) <= restored.pixel + .01, `${width}px/${entry}: return scroll (${restored.top} vs ${originScroll})`);
        await update({ stage: 'idle', message: '' });
      }
    }
    console.log(`PASS: ${count} notification scenarios`);
    console.log('PASS: all current editor entries');
    // The native frame reduces client size; Windows display scaling also affects pixel rounding.
    window.setSize(320, 360);
    for(const textSize of ['small','medium','large']) for (const zoom of [1, 1.25,1.5]) {
      window.webContents.setZoomFactor(zoom);
      await update({ expanded: true, stage: 'idle', textSize }); await ready();
      for (const page of ['home', 'settings']) {
        await evaluate(`document.querySelector('.management-nav > button[data-page="${page}"]').click()`);
        if (page === 'settings') await evaluate("document.getElementById('settings-commentSpeech').click()");
        const prefix = page === 'home' ? 'home' : 'editor';
        await evaluate(`document.getElementById('${prefix}-input').focus({preventScroll:true})`);
        const before = await measure(prefix);
        if (before.overflow) await capture('minimum-overflow.png');
        assert.equal(before.overflow, false, `native minimum/${zoom}/${page}: overflow ${await evaluate("JSON.stringify({inner:innerWidth, document:document.documentElement.scrollWidth, body:document.querySelector('.management-body').clientWidth, bodyScroll:document.querySelector('.management-body').scrollWidth})")}`);
        const message = '最小外寸・表示倍率の確認です。'.repeat(30);
        await update({ stage: 'success', message });
        await assertToast(message);
        assert.deepEqual(await measure(prefix), before, `native minimum/${zoom}/${page}: notification shift`);
        assert.deepEqual(await overlap(), [], `native minimum/${zoom}/${page}: overlap`);
        assert.deepEqual(await headerBounds(), [], `native minimum/${zoom}/${page}: header bounds`);
        await capture(`minimum-${page}-${zoom}.png`);
      }
    }
    window.webContents.setZoomFactor(1);
    for (const width of [320, 560, 760, 1200]) {
      window.setContentSize(width, width <= 560 ? 760 : 560);
      await window.loadFile(process.argv[2]); await ready();
      await update({ updateNotice: true, stage: 'idle', message: '' });
      await activate('#management-warning-entry');
      const dialogBounds = await evaluate(`(() => { const dialog = document.querySelector('#management-warning-dialog'); const box = dialog.getBoundingClientRect();
        return { visible: dialog.open, fits: box.left >= 0 && box.right <= innerWidth && box.top >= 0 && box.bottom <= innerHeight,
          overflow: dialog.scrollWidth > dialog.clientWidth }; })()`);
      assert.deepEqual(dialogBounds, { visible: true, fits: true, overflow: false }, `${width}px: long update notice fits`);
      await activate('.management-update-notice button:last-child');
      const before = await evaluate(`(() => { const b = document.querySelector('.management-update-notice button:last-child').getBoundingClientRect(); return {x:b.x,y:b.y,width:b.width,height:b.height}; })()`);
      assert.ok(await evaluate("document.querySelector('.management-update-notice button:last-child').disabled"), 'confirm is disabled while saving');
      const processing = await evaluate(`(() => { const b = document.querySelector('.management-update-notice button:last-child').getBoundingClientRect(); return {x:b.x,y:b.y,width:b.width,height:b.height}; })()`);
      assert.deepEqual(processing, before, 'processing keeps confirmation button dimensions');
      const bodyBefore = await measure('home'); delete bodyBefore.focus;
      await capture(`update-notice-${width}.png`);
      await evaluate('window.notificationHarness.finishAcknowledgement()');
      const bodyAfter = await measure('home'); delete bodyAfter.focus;
      assert.deepEqual(bodyAfter, bodyBefore, 'acknowledging does not shift underlying controls or scroll');
      assert.ok(await evaluate("document.querySelector('#management-warning-dialog').open && document.activeElement.textContent === '閉じる'"), 'dialog stays open and restores focus');
      assert.match(await evaluate("document.querySelector('#management-warning-entry').textContent"), /0件/);
    }
    console.log('PASS: update notice acknowledgement layouts');
    console.log('PASS: native minimum and zoom'); app.exit(0);
  } catch (error) { console.error(error); app.exit(1); }
});
