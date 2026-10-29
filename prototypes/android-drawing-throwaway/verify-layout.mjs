// Run the fictional prototype in an isolated, hidden Electron browser.
import { app, BrowserWindow } from 'electron';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

app.disableHardwareAcceleration();
app.setPath('userData', join(process.argv[3], 'profile'));
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 1220, height: 940,
    webPreferences: { offscreen: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
  const errors = [], reports = [];
  win.webContents.on('console-message', detail => { if (detail.level === 'error') errors.push(detail.message); });
  const run = code => win.webContents.executeJavaScript(code);
  const pause = () => new Promise(resolve => setTimeout(resolve, 100));
  const state = () => run('window.casmateDrawingPrototype.getState()');
  const set = options => run(`window.casmateDrawingPrototype.setState(${JSON.stringify(options)})`);
  const click = selector => run(`document.querySelector(${JSON.stringify(selector)}).click()`);
  const action = name => click(`[data-action=${name}]`);
  const measure = () => run(`(() => {
    const rect = e => { const r=e.getBoundingClientRect(); return [r.x,r.y,r.width,r.height]; };
    const area=document.querySelector('#viewport'), tools=document.querySelector('#tools');
    return { preview:rect(area), canvas:rect(document.querySelector('#preview')), tools:rect(tools),
      top:[...document.querySelectorAll('.top-button')].map(rect),
      targets:[...tools.querySelectorAll('button')].map(rect),
      overflow:area.scrollWidth>area.clientWidth+1,
      sheetOverflow:document.querySelector('#sheet').scrollWidth>document.querySelector('#sheet').clientWidth+1,
      title:!!area.querySelector('header'),
      palette:getComputedStyle(document.querySelector('#phone')).backgroundColor };
  })()`);
  const pointEvent = (type, id, x, y, target = '#preview', pointerType = 'touch') => run(`(() => {
    const e=document.querySelector(${JSON.stringify(target)}),r=document.querySelector('#viewport').getBoundingClientRect();
    e.dispatchEvent(new PointerEvent(${JSON.stringify(type)}, {bubbles:true,cancelable:true,pointerId:${id},pointerType:${JSON.stringify(pointerType)},clientX:r.x+${x},clientY:r.y+${y}}));
  })()`);
  const pixel = () => run(`(() => {const c=document.querySelector('#preview');return [...c.getContext('2d').getImageData(Math.floor(c.width/2),Math.floor(c.height/2),1,1).data]})()`);
  try {
    await mkdir(process.argv[3], { recursive: true });
    if (process.argv.includes('--live')) await win.loadURL('http://127.0.0.1:5212/');
    else await win.loadFile(process.argv[2]);
    await pause();
    for (const size of [320, 400, 760]) for (const font of [1, 2]) for (const theme of ['light', 'dark']) {
      await set({ size, font, theme, status: 'normal', reset: true }); await pause();
      const label = `${size}/${font}/${theme}`, before = await measure();
      assert.equal(before.title, false, label + ' no application header');
      assert.deepEqual(before.canvas, before.preview, label + ' full app-area preview');
      assert.equal(before.tools[3], 56, label + ' toolbar height');
      assert.ok(before.tools[0] - before.preview[0] >= 7.9, label + ' left margin');
      assert.ok(before.preview[0] + before.preview[2] - before.tools[0] - before.tools[2] >= 7.9, label + ' right margin');
      assert.ok(Math.abs(before.preview[1] + before.preview[3] - before.tools[1] - 56 - 12) < .1, label + ' bottom safe margin');
      for (const target of [...before.targets, ...before.top]) assert.ok(target[2] >= 48 && target[3] >= 48, label + ' minimum targets');
      assert.equal(before.overflow, false, label + ' no horizontal overflow');
      const openingView = (await state()).viewport;
      const openingRevision = (await state()).document.revision;
      await action('whole'); await pause();
      assert.deepEqual((await state()).viewport, { zoom: 1, panX: 0, panY: 0 }, label + ' first press shows whole');
      assert.equal((await state()).nextView, 'fill');
      assert.equal(await run('document.querySelector("[data-action=whole]").getAttribute("aria-label")'), '映像中央を表示領域いっぱいに拡大');
      await action('whole'); await pause();
      assert.deepEqual((await state()).viewport, openingView, label + ' second press fills center');
      assert.equal((await state()).nextView, 'whole');
      assert.equal((await state()).document.revision, openingRevision, label + ' switching does not modify ink');
      for (const status of ['pending', 'error', 'hidden', 'normal']) {
        await set({ status }); const after = await measure();
        assert.deepEqual(after.preview, before.preview, label + ' stable preview on ' + status);
        assert.deepEqual(after.tools, before.tools, label + ' stable tools on ' + status);
      }
      await action('palette'); await pause();
      assert.equal((await measure()).sheetOverflow, false, label + ' panel width');
      assert.equal(await run('document.querySelectorAll("[data-color]").length'), 6);
      assert.equal(await run('document.querySelectorAll("[data-width]").length'), 3);
      assert.equal(await run('document.activeElement.id'), 'sheet', label + ' dialog focus');
      if (size === 320 && font === 2) await writeFile(join(process.argv[3], `panel-${theme}.png`), (await win.webContents.capturePage()).toPNG());
      await click('[data-color="#ff454b"]');
      assert.equal((await state()).modal, null); assert.equal((await state()).tool, 'pen');
      assert.equal(await run('document.activeElement.dataset.action'), 'palette', label + ' restore focus');
      if (font === 1) await writeFile(join(process.argv[3], `${size}-${theme}.png`), (await win.webContents.capturePage()).toPNG());
      reports.push({ size, font, theme, ...before });
    }
    // The device-only view has no outside review controls, so it needs its own resume entrance.
    await run('document.body.classList.add("device")'); win.setContentSize(320, 740); await pause();
    await action('close');
    assert.equal(await run('document.querySelector("#inline-reopen").checkVisibility()'), true, 'device view can resume');
    await click('#inline-reopen'); assert.equal((await state()).mode, true);
    const deviceLayout = await measure();
    assert.deepEqual(deviceLayout.preview, await run('[0,0,innerWidth,innerHeight]'), 'device browser area completely used');
    for (const target of deviceLayout.targets) assert.ok(target[2] >= 48 && target[3] >= 48, 'device view minimum targets');
    await run('document.body.classList.remove("device")'); win.setContentSize(1220, 940);
    await set({ size: 400, font: 1, theme: 'light', reset: true }); await pause();
    const initial = await state(); assert.ok(initial.viewport.zoom > 3, 'initial cover view');
    const area = initial.box;
    const x = area.width / 2, y = area.height / 2;
    // Two fingers during the delay, then a remaining finger: no accidental mark.
    await pointEvent('pointerdown', 1, x - 60, y); await pointEvent('pointerdown', 2, x + 60, y);
    await pointEvent('pointermove', 2, x + 90, y + 20); await pointEvent('pointerup', 2, x + 90, y + 20);
    await pointEvent('pointermove', 1, x - 20, y + 40); await pointEvent('pointerup', 1, x - 20, y + 40); await pause();
    assert.equal((await state()).document.revision, initial.document.revision, 'pinch has no ink or tail');
    assert.ok((await state()).viewport.zoom > initial.viewport.zoom, 'continuous pinch zoom');
    const view = (await state()).viewport;
    await action('close'); await click('#inline-reopen'); await pause();
    assert.deepEqual((await state()).viewport, view, 'same session resume retains view');
    await action('whole'); await pause(); assert.deepEqual((await state()).viewport, { zoom: 1, panX: 0, panY: 0 });
    await action('close'); await click('#inline-reopen');
    assert.equal((await state()).nextView, 'fill', 'resume retains next button action');
    await action('whole'); await pause(); assert.deepEqual((await state()).viewport, initial.viewport, 'center fill returns to centered cover after pan');
    await action('whole'); await pause(); assert.deepEqual((await state()).viewport, { zoom: 1, panX: 0, panY: 0 }, 'third press shows whole again');
    const blankPixel = await pixel();
    await action('palette'); await click('[data-color="#ff454b"]');
    await pointEvent('pointerdown', 3, x - 25, y); await pointEvent('pointermove', 3, x + 25, y); await pointEvent('pointerup', 3, x + 25, y); await pause();
    const redPixel = await pixel(); assert.notDeepEqual(redPixel, blankPixel, 'visible pen ink');
    await action('eraser'); await action('palette'); await click('[data-width="0.016"]');
    assert.equal((await state()).tool, 'eraser', 'width keeps current tool');
    await pointEvent('pointerdown', 4, x, y - 15); await pointEvent('pointermove', 4, x, y + 15); await pointEvent('pointerup', 4, x, y + 15); await pause();
    assert.deepEqual(await pixel(), blankPixel, 'partial eraser restores camera at touched point');
    await action('undo'); await pause(); assert.deepEqual(await pixel(), redPixel, 'undo eraser restores mark');
    await action('clear'); await pause(); assert.deepEqual(await pixel(), blankPixel, 'one-tap toolbar clear removes ink');
    assert.equal((await state()).modal, null, 'clear needs no menu');
    await action('undo'); await pause(); assert.deepEqual(await pixel(), redPixel, 'clear is undoable');
    // Input beginning on tools never becomes background ink or navigation.
    const revision = (await state()).document.revision;
    await pointEvent('pointerdown', 5, x, y, '[data-action=palette]');
    await pointEvent('pointermove', 5, x + 30, y); await pointEvent('pointerup', 5, x + 30, y);
    assert.equal((await state()).document.revision, revision);
    await pointEvent('pointerdown', 6, x, y); await action('palette'); await pause();
    await pointEvent('pointerup', 6, x, y); await action('dismiss');
    assert.equal((await state()).document.revision, revision, 'menu cancels delayed ink');
    // Desktop pan must also stop when a sheet or the closed mode blocks input.
    await run('document.body.dispatchEvent(new KeyboardEvent("keydown", {bubbles:true,code:"Space"}))');
    await pointEvent('pointerdown', 11, x, y, '#preview', 'mouse');
    const blockedView = (await state()).viewport;
    await action('sending'); await pointEvent('pointermove', 11, x + 50, y, '#preview', 'mouse');
    assert.deepEqual((await state()).viewport, blockedView, 'menu cancels desktop pan');
    await pointEvent('pointerup', 11, x + 50, y, '#preview', 'mouse'); await action('dismiss');
    await pointEvent('pointerdown', 12, x, y, '#preview', 'mouse'); await action('close');
    await pointEvent('pointermove', 12, x + 60, y, '#preview', 'mouse');
    assert.deepEqual((await state()).viewport, blockedView, 'closed mode cancels desktop pan');
    await pointEvent('pointerup', 12, x + 60, y, '#preview', 'mouse'); await click('#inline-reopen');
    await run('document.body.dispatchEvent(new KeyboardEvent("keyup", {bubbles:true,code:"Space"}))');
    // Draft stays private until recovery success (represented by explicitly selecting normal).
    await set({ status: 'pending' }); const pinned = (await state()).outputRevision;
    await action('clear'); assert.equal((await state()).outputRevision, pinned, 'clear while pending keeps published ink');
    await action('undo'); assert.equal((await state()).outputRevision, pinned, 'undo clear while pending keeps published ink');
    await action('pen'); await pointEvent('pointerdown', 7, x, y + 25, '#preview', 'pen');
    await pointEvent('pointermove', 7, x + 30, y + 25, '#preview', 'pen'); await pointEvent('pointerup', 7, x + 30, y + 25, '#preview', 'pen');
    assert.equal((await state()).outputRevision, pinned); assert.ok((await state()).document.revision > pinned);
    await action('close'); assert.equal((await state()).previewRevision, pinned);
    await click('#reopen'); assert.ok((await state()).previewRevision > pinned);
    await set({ status: 'error' }); await action('retry');
    assert.equal((await state()).status, 'pending'); assert.equal((await state()).outputRevision, pinned, 'retry does not publish pending draft');
    await set({ status: 'normal' }); assert.equal((await state()).outputRevision, (await state()).document.revision);
    await set({ status: 'hidden' }); const hiddenRevision = (await state()).document.revision;
    assert.equal(await run('document.querySelector("[data-action=clear]").disabled'), true, 'hidden video disables clear');
    await pointEvent('pointerdown', 8, x, y, '#preview', 'pen'); await pointEvent('pointerup', 8, x, y, '#preview', 'pen');
    assert.equal((await state()).document.revision, hiddenRevision, 'hidden video disables edits');
    await set({ status: 'normal' }); await action('sending'); await action('stop');
    assert.equal((await state()).mode, false); assert.equal((await state()).document.operations.length, 0, 'stop clears session');
    assert.deepEqual((await state()).output, { width: 1280, height: 720 }, 'output size preserved');
    assert.deepEqual(errors, [], 'no browser errors');
    await writeFile(join(process.argv[3], 'geometry.json'), JSON.stringify(reports, null, 2));
    console.log(`PASS: ${reports.length} layouts; safe-area preview, fixed controls, panels, gestures, ink/eraser/undo, draft pinning and session end.`);
    win.close(); app.exit(0);
  } catch (error) { console.error(error); win.close(); app.exit(1); }
});
