import { app, BrowserWindow } from 'electron';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

app.disableHardwareAcceleration();
app.setPath('userData', join(process.argv[3], 'profile'));
app.whenReady().then(async () => {
  let window = new BrowserWindow({ show: false, width: 400, height: 760,
    webPreferences: { contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
  const evaluate = source => window.webContents.executeJavaScript(source);
  const settle = () => new Promise(resolve => setTimeout(resolve, 60));
  const ready = async condition => {
    for (let attempt = 0; attempt < 50; attempt++) {
      if (await evaluate(condition)) return;
      await settle();
    }
    throw new Error('Renderer did not reach ' + condition);
  };
  const measure = `(() => {
    const page = document.querySelector('.mobile-comments-page');
    const list = page.querySelector('.comment-stream');
    const button = page.querySelector('button');
    const rect = node => { const value = node.getBoundingClientRect(); return [value.x,value.y,value.width,value.height]; };
    return { page:rect(page), header:rect(page.querySelector('header')), status:rect(page.querySelector('.comment-list-notices')),
      button:rect(button), list:rect(list), scroll:list.scrollTop, documentScroll:document.scrollingElement.scrollTop,
      focused:document.activeElement === button };
  })()`;
  const colors = `(() => {
    const page = document.querySelector('.mobile-comments-page');
    const style = node => getComputedStyle(node);
    const card = page.querySelector('.comment');
    return { background:style(page).backgroundColor, bodyBackground:style(document.body).backgroundColor,
      text:style(page).color, status:style(page.querySelector('[role=status]')).color,
      button:style(page.querySelector('button')).color, cardText:style(card).color,
      cardBackground:style(card).backgroundColor, cardFont:Number.parseFloat(style(card).fontSize),
      meta:style(card.querySelector('.comment-meta')).color, author:style(card.querySelector('strong')).color,
      source:style(card.querySelector('.source-badge')).color, border:style(card).borderBottomColor };
  })()`;
  const geometry = `(() => {
    const page = document.querySelector('.mobile-comments-page');
    const button = page.querySelector('button');
    const status = page.querySelector('.comment-list-notices');
    const list = page.querySelector('.comment-stream');
    const b = button.getBoundingClientRect(); const s = status.getBoundingClientRect();
    return { viewport:innerWidth, pageWidth:page.getBoundingClientRect().width,
      pageOverflow:page.scrollWidth > page.clientWidth, listOverflow:list.scrollWidth > list.clientWidth,
      documentOverflow:document.scrollingElement.scrollWidth > innerWidth,
      buttonFits:b.left >= 0 && b.right <= innerWidth && b.bottom <= innerHeight,
      statusFits:s.left >= 0 && s.right <= innerWidth && s.right <= b.left,
      statusTextFits:page.querySelector('.comment-list-status-content').scrollHeight <= page.querySelector('.comment-list-status-content').clientHeight + 1,
      duplicateHeading:page.querySelector('h1') !== null,
      target:b.width >= 48 && b.height >= 48, listVisible:list.clientHeight > 100,
      scrollable:list.scrollHeight > list.clientHeight };
  })()`;
  const capture = async label => {
    await window.webContents.capturePage(); window.webContents.invalidate();
    await evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
    await writeFile(join(process.argv[4], label + '.png'), (await window.webContents.capturePage()).toPNG());
  };
  const drag = async (x, y, dx, dy) => {
    window.webContents.sendInputEvent({ type:'mouseMove', x, y });
    window.webContents.sendInputEvent({ type:'mouseDown', x, y, button:'left', clickCount:1 });
    for (let index = 1; index <= 4; index++) {
      window.webContents.sendInputEvent({ type:'mouseMove', x:Math.round(x + dx * index / 4), y:Math.round(y + dy * index / 4), button:'left' });
    }
    window.webContents.sendInputEvent({ type:'mouseUp', x:x + dx, y:y + dy, button:'left', clickCount:1 });
    await settle();
  };
  // Mouse events do not exercise Chromium's touch-action arbitration or its
  // pointercancel when an overflowing ancestor owns a horizontal pan.
  const touchscreenDrag = async (x, y, dx, dy) => {
    const point = (step) => [{ x:x + dx * step / 5, y:y + dy * step / 5, id:1 }];
    await window.webContents.debugger.sendCommand('Input.dispatchTouchEvent', { type:'touchStart', touchPoints:point(0) });
    for (let step = 1; step <= 5; step++) {
      await new Promise(resolve => setTimeout(resolve, 24));
      await window.webContents.debugger.sendCommand('Input.dispatchTouchEvent', { type:'touchMove', touchPoints:point(step) });
    }
    await window.webContents.debugger.sendCommand('Input.dispatchTouchEvent', { type:'touchEnd', touchPoints:[] });
    await settle();
  };
  try {
    let scenarios = 0;
    for (const width of [320,400,736]) {
      for (const fontScale of [1,2]) {
        window.setContentSize(width, 760);
        await window.loadFile(process.argv[2], { query: { fontScale:String(fontScale) } });
        await ready("document.querySelectorAll('.comment').length === 40");
        await settle();
        window.webContents.focus();
        await evaluate(`(() => {
          const list = document.querySelector('.comment-stream'); const button = document.querySelector('.comment-list-controls button');
          if (button.getAttribute('aria-pressed') === 'true') button.click();
          list.scrollTop = 120; button.focus({preventScroll:true});
          window.retainedComment = list.querySelector('.comment'); window.retainedList = list;
        })()`);
        await settle();
        const initial = await evaluate(measure);
        assert.ok(initial.scroll > 0, 'fixture is scrolled away from the newest comments');
        assert.equal(initial.focused, true, 'auto-scroll button has native focus');
        const readyCount = await evaluate("window.androidCommentsHarness.messages().filter(value => value === 'ready').length");
        for (const theme of ['light','dark']) {
          const label = `${width}px ${fontScale}x ${theme}`;
          await evaluate(`window.androidCommentsHarness.theme('${theme}')`);
          await ready(`document.querySelector('.native-comment-theme-${theme}') !== null`);
          await settle();
          assert.deepEqual(await evaluate(measure), initial, label + ' theme keeps geometry, scroll and focus');
          const measuredColors = await evaluate(colors);
          assert.deepEqual(measuredColors, {
            background:theme === 'light' ? 'rgb(245, 247, 244)' : 'rgb(21, 27, 25)',
            bodyBackground:theme === 'light' ? 'rgb(245, 247, 244)' : 'rgb(21, 27, 25)',
            text:theme === 'light' ? 'rgb(29, 48, 41)' : 'rgb(233, 242, 236)',
            status:theme === 'light' ? 'rgb(82, 104, 92)' : 'rgb(181, 198, 187)',
            button:theme === 'light' ? 'rgb(82, 104, 92)' : 'rgb(181, 198, 187)',
            cardText:theme === 'light' ? 'rgb(29, 48, 41)' : 'rgb(233, 242, 236)',
            cardBackground:theme === 'light' ? 'rgb(245, 247, 244)' : 'rgb(21, 27, 25)', cardFont:18 * fontScale,
            meta:theme === 'light' ? 'rgb(82, 104, 92)' : 'rgb(181, 198, 187)',
            author:theme === 'light' ? 'rgb(29, 48, 41)' : 'rgb(233, 242, 236)',
            source:theme === 'light' ? 'rgb(82, 104, 92)' : 'rgb(181, 198, 187)',
            border:theme === 'light' ? 'rgb(217, 227, 219)' : 'rgb(58, 75, 64)',
          }, label + ' real native palette on comments and preserved PC font settings');
          assert.deepEqual(await evaluate(geometry), {
            viewport:width, pageWidth:width, pageOverflow:false, listOverflow:false, documentOverflow:false,
            buttonFits:true, statusFits:true, statusTextFits:true, duplicateHeading:false, target:true, listVisible:true, scrollable:true,
          }, label + ' accessible layout fits viewport');
          await evaluate('window.androidCommentsHarness.connected(false); window.androidCommentsHarness.sourcesRunning(false)');
          await ready("document.querySelector('[role=status]').textContent.includes('コメント接続待ち・取得停止')");
          assert.equal(await evaluate("(() => {const s=document.querySelector('.comment-list-status-content');return s.scrollHeight<=s.clientHeight+1;})()"),true,label + ' longest status fully visible');
          assert.deepEqual(await evaluate(measure), initial, label + ' disconnect keeps geometry, scroll and focus');
          await evaluate('window.androidCommentsHarness.connected(true); window.androidCommentsHarness.sourcesRunning(true)');
          await ready("document.querySelector('[role=status]').textContent === 'コメント接続済み'");
          assert.deepEqual(await evaluate(measure), initial, label + ' restored connection keeps geometry, scroll and focus');
          assert.equal(await evaluate("document.querySelector('.comment-stream') === window.retainedList && document.querySelector('.comment') === window.retainedComment"), true,
            label + ' reuses the existing list and comments');
          assert.equal(await evaluate("window.androidCommentsHarness.messages().filter(value => value === 'ready').length"), readyCount,
            label + ' theme/status do not request a new snapshot');
          if (width === 320) await capture(`comments-${width}-${fontScale}x-${theme}`);
          scenarios++;
        }
        await evaluate('window.androidCommentsHarness.add()');
        await ready("document.querySelectorAll('.comment').length === 41");
        assert.deepEqual(await evaluate(measure), initial, 'new comment does not move a reader with auto-scroll off');
      }
    }
    console.log(`PASS: ${scenarios} Android comments color/layout/text scenarios`);
    window.setContentSize(400,760);
    await window.loadFile(process.argv[2]);
    await ready("document.querySelectorAll('.comment').length === 40");
    await settle(); window.webContents.focus();
    const listRect = await evaluate("document.querySelector('.comment-stream').getBoundingClientRect().toJSON()");
    const contentY = Math.round(listRect.top + 80);
    const requests = () => evaluate("window.androidCommentsHarness.messages().filter(value => value.startsWith('flick:'))");
    await drag(140,contentY,100,0);
    // The real host leaves this WebView after the first request. This fixture
    // stays on the same page; clear mouse text selection before an independent
    // second gesture so Chromium does not start a native selection drag.
    await evaluate('window.getSelection()?.removeAllRanges()');
    await drag(250,contentY,-100,0);
    assert.deepEqual(await requests(), ['flick:right','flick:left'], 'native mouse drag on comment content requests both directions');
    const buttonRect = await evaluate("document.querySelector('.comment-list-controls button').getBoundingClientRect().toJSON()");
    await drag(Math.round(buttonRect.left + 10),Math.round(buttonRect.top + buttonRect.height / 2),-80,0);
    await drag(140,contentY,5,100);
    await drag(140,contentY,20,0);
    assert.deepEqual(await requests(), ['flick:right','flick:left'], 'button, vertical and short drags do not request page changes');
    console.log('PASS: native mouse flicks exclude controls, vertical drags and short movements');
    // A hidden native window acknowledges CDP touch moves at roughly 1 Hz.
    // Offscreen painting supplies actual 60 Hz compositor frames without
    // showing a test window or overriding the product's 700 ms gesture limit.
    const layoutWindow = window;
    window = new BrowserWindow({ show:false, width:400, height:760,
      webPreferences:{ contextIsolation:true, nodeIntegration:false, backgroundThrottling:false, offscreen:true } });
    layoutWindow.destroy();
    window.webContents.setFrameRate(60);
    await window.loadFile(process.argv[2]);
    await ready("document.querySelectorAll('.comment').length === 40");
    await settle(); window.webContents.focus();
    window.webContents.debugger.attach('1.3');
    await window.webContents.debugger.sendCommand('Emulation.setTouchEmulationEnabled', { enabled:true, maxTouchPoints:2 });
    await evaluate(`(() => {
      document.querySelector('.comment-list-controls button').click();
      document.querySelector('.comment-stream').scrollTop = 0;
      window.touchTrace = [];
      for (const type of ['pointerdown','pointermove','pointerup','pointercancel']) {
        document.addEventListener(type, event => window.touchTrace.push({ type, x:event.clientX, y:event.clientY,
          id:event.pointerId, primary:event.isPrimary, button:event.button, at:performance.now(),
          control:!!event.target.closest('button,input,select,textarea,a,[role="button"]') }), true);
      }
    })()`);
    await settle();
    const touchButtonRect = await evaluate("document.querySelector('.comment-list-controls button').getBoundingClientRect().toJSON()");
    const inertAreas = [
      ['body', '.comment-body span'],
      ['author', '.comment-meta strong'],
      ['source', '.source-badge'],
      ['row padding', '.comment'],
      ['connection status', '.comment-list-status-content'],
      ['list gutter', '.comment-stream'],
    ];
    const touchCoverage = [];
    for (const [label, selector] of inertAreas) {
      const rect = await evaluate(`document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect().toJSON()`);
      const x = Math.round(label === 'list gutter' ? rect.left + 4 : label === 'row padding' ? rect.left + 8 : rect.left + Math.min(rect.width / 2, 40));
      const y = Math.round(label === 'row padding' ? rect.top + 4 : label === 'list gutter' ? rect.top + 200 : rect.top + rect.height / 2);
      const before = (await requests()).length;
      await evaluate('window.touchTrace.length = 0');
      await touchscreenDrag(x,y,100,0);
      const trace = await evaluate('window.touchTrace');
      assert.equal((await requests()).length, before + 1,
        label + ' horizontal touchscreen gesture requests a page change; pointer events: ' + JSON.stringify(trace));
      assert.equal(trace.some(event => event.type === 'pointercancel'),false,label + ' horizontal touchscreen is not canceled by scroll arbitration');
      assert.equal((await requests()).at(-1),'flick:right',label + ' preserves gesture direction');
      const duration = trace.at(-1).at - trace[0].at;
      assert.ok(duration <= 700,label + ' exercises the real gesture deadline');
      touchCoverage.push({ area:label, completed:true, pointerCanceled:false, durationMs:Math.round(duration) });
    }
    const touchRequests = (await requests()).length;
    const firstBody = await evaluate("document.querySelector('.comment-body').getBoundingClientRect().toJSON()");
    const touchPoint = { x:140, y:Math.round(firstBody.top + 10), id:1 };
    await window.webContents.debugger.sendCommand('Input.dispatchTouchEvent', { type:'touchStart', touchPoints:[touchPoint] });
    await window.webContents.debugger.sendCommand('Input.dispatchTouchEvent', { type:'touchCancel', touchPoints:[] });
    await settle();
    assert.equal((await requests()).length,touchRequests,'canceled touchscreen gesture does not change pages');
    await window.webContents.debugger.sendCommand('Input.dispatchTouchEvent', { type:'touchStart', touchPoints:[touchPoint] });
    await window.webContents.debugger.sendCommand('Input.dispatchTouchEvent', { type:'touchStart', touchPoints:[touchPoint,{ ...touchPoint,x:180,id:2 }] });
    await window.webContents.debugger.sendCommand('Input.dispatchTouchEvent', { type:'touchMove', touchPoints:[{ ...touchPoint,x:240 },{ ...touchPoint,x:280,id:2 }] });
    await window.webContents.debugger.sendCommand('Input.dispatchTouchEvent', { type:'touchEnd', touchPoints:[] });
    await settle();
    assert.equal((await requests()).length,touchRequests,'multiple fingers do not change pages');
    await touchscreenDrag(140,Math.round(firstBody.top + 10),20,0);
    const verticalBefore = await evaluate("document.querySelector('.comment-stream').scrollTop");
    await touchscreenDrag(140,Math.round(firstBody.top + 10),0,-120);
    assert.ok(await evaluate("document.querySelector('.comment-stream').scrollTop") > verticalBefore,
      'touchscreen vertical scrolling remains native');
    await touchscreenDrag(Math.round(touchButtonRect.left + 10),Math.round(touchButtonRect.top + touchButtonRect.height / 2),-80,0);
    assert.equal((await requests()).length,touchRequests,'touchscreen short/vertical/button gestures do not change pages');
    // The URL starts inside a genuine link; no popup/navigation is triggered by
    // a drag, and the host must not change its native page.
    await evaluate("document.querySelector('.comment-stream').scrollTop = document.querySelector('.comment-body a').offsetTop - 120");
    await settle();
    const linkRect = await evaluate("document.querySelector('.comment-body a').getClientRects()[0].toJSON()");
    await touchscreenDrag(Math.round(linkRect.left + 10),Math.round(linkRect.top + linkRect.height / 2),100,0);
    assert.equal((await requests()).length,touchRequests,'touchscreen link drag does not change pages');
    await evaluate('window.androidCommentsHarness.clear()');
    await ready("document.querySelectorAll('.comment').length === 0");
    const emptyRect = await evaluate("document.querySelector('.comment-stream').getBoundingClientRect().toJSON()");
    await touchscreenDrag(140,Math.round(emptyRect.top + 200),100,0);
    assert.equal((await requests()).length,touchRequests + 1,'empty comment area also accepts touchscreen flicks');
    // Scope verification uses a separate inert ordinary-browser layout. It does
    // not add a native bridge or change the page's mounted React state.
    const ordinaryTouchAction = await evaluate(`(() => {
      const page = document.createElement('main'); page.className = 'mobile-comments-page';
      page.hidden = true;
      for (const className of ['comment-stream','comment-list-status-content']) {
        const node = document.createElement('div'); node.className = className; page.append(node);
      }
      document.body.append(page);
      const result = Array.from(page.children, node => getComputedStyle(node).touchAction);
      page.remove(); return result;
    })()`);
    assert.deepEqual(ordinaryTouchAction,['auto','auto'],'ordinary-browser scroll containers keep their default touch behavior');
    window.setContentSize(320,760);
    await window.loadFile(process.argv[2], { query:{ fontScale:'2' } });
    await ready("document.querySelectorAll('.comment').length === 40");
    await evaluate(`(() => { document.querySelector('.comment-list-controls button').click();
      document.querySelector('.comment-stream').scrollTop = 0; window.androidCommentsHarness.theme('dark'); })()`);
    await settle();
    for (const selector of ['.comment-body span','.comment-list-status-content']) {
      const rect = await evaluate(`document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect().toJSON()`);
      const before = (await requests()).length;
      await touchscreenDrag(Math.round(rect.left + 20),Math.round(rect.top + rect.height / 2),100,0);
      assert.equal((await requests()).length,before + 1,selector + ' also accepts real touchscreen flicks at narrow width, doubled text and dark theme');
    }
    await writeFile(join(process.argv[4],'touch-coverage.json'), JSON.stringify({ areas:touchCoverage,
      emptyArea:true, verticalScroll:true, controlsExcluded:true, linksExcluded:true,
      shortGestureExcluded:true, canceledGestureExcluded:true, multiTouchExcluded:true,
      narrowDoubledTextDark:true, ordinaryTouchAction },null,2));
    console.log('PASS: real touchscreen flicks cover comments, metadata, status, gutter and empty area while preserving scroll and controls');
  } catch (error) {
    console.error(error);
    console.error('Measured layout:', await evaluate(measure).catch(() => null));
    console.error('Measured bounds:', await evaluate(geometry).catch(() => null));
    await capture('failure').catch(() => undefined);
    process.exitCode = 1;
  } finally {
    window.destroy(); app.quit();
  }
});
