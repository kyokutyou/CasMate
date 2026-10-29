// Fictional UI only. Load a built prototype from an isolated Electron directory.
import { app, BrowserWindow } from 'electron';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

app.disableHardwareAcceleration();
app.setPath('userData', join(process.argv[3], 'profile'));
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 736, height: 1100,
    webPreferences: { offscreen: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
  const errors = [];
  win.webContents.on('console-message', detail => { if (detail.level === 'error') errors.push(detail.message); });
  const run = code => win.webContents.executeJavaScript(code);
  const pause = () => new Promise(resolve => setTimeout(resolve, 60));
  const reports = [];
  const measure = id => `(() => {const phone=document.querySelector('[data-phone="${id}"]'),main=phone.querySelector('.nf-main');
    const rect=e=>{const r=e.getBoundingClientRect();return [r.x,r.y,r.width,r.height];};
    return {outerOverflow:document.documentElement.scrollWidth>innerWidth+1,phoneOverflow:phone.scrollWidth>phone.clientWidth+1,
      headerOverflow:phone.querySelector('header').scrollWidth>phone.querySelector('header').clientWidth+1,
      footer:!!phone.querySelector('footer,.nf-footer'),main:rect(main),content:rect(main.querySelector('.nf-preview,.nf-stream')),
      statusFits:!phone.querySelector('.nf-comment-state-content')||phone.querySelector('.nf-comment-state-content').scrollHeight<=phone.querySelector('.nf-comment-state-content').clientHeight+1,
      smallTargets:[...phone.querySelectorAll('button')].filter(e=>e.checkVisibility()).filter(e=>e.getBoundingClientRect().width<47||e.getBoundingClientRect().height<47).map(e=>e.getAttribute('aria-label')||e.textContent)};})()`;
  const click = (id, action) => run(`document.querySelector('[data-phone="${id}"] [data-action="${action}"]').click()`);
  const controls = async id => { if (id !== 'B') await click(id, 'controls'); };
  try {
    await mkdir(process.argv[3], { recursive: true });
    await win.loadFile(process.argv[2]);
    for (const width of [320, 400, 736]) {
      win.setContentSize(width, 1100);
      await pause();
      for (const id of ['A', 'B', 'C']) {
        await run(`for(const e of document.querySelectorAll('[data-design]'))e.hidden=e.dataset.design!=='${id}'`);
        for (const scale of [1, 2]) for (const appearance of ['light', 'dark']) for (const page of ['camera', 'comments']) {
          await run(`window.casmateNoFooterMock.setState({page:'${page}',scale:${scale},appearance:'${appearance}',connected:true,sending:true,broadcast:true,listening:true,mute:false,video:true})`);
          await pause();
          const label = `${id}/${width}/${scale}/${appearance}/${page}`;
          const before = await run(measure(id));
          assert.equal(before.outerOverflow, false, label + ' document width');
          assert.equal(before.phoneOverflow, false, label + ' phone width');
          assert.equal(before.headerOverflow, false, label + ' header width');
          assert.equal(before.footer, false, label + ' no footer');
          assert.equal(before.statusFits, true, label + ' readable status');
          assert.equal(await run(`getComputedStyle(document.querySelector('[data-phone="${id}"]')).backgroundColor`), appearance === 'light' ? 'rgb(245, 247, 244)' : 'rgb(21, 27, 25)', label + ' correct phone palette');
          assert.deepEqual(before.smallTargets, [], label + ' touch targets');
          assert.ok(before.main[3] >= 630 && before.content[3] >= 460, label + ' large main content');
          await run('window.casmateNoFooterMock.setState({connected:false})');
          const offline = await run(measure(id));
          assert.deepEqual(offline.main, before.main, label + ' stable main on disconnect');
          assert.deepEqual(offline.content, before.content, label + ' stable preview/list on disconnect');
          assert.equal(offline.statusFits, true, label + ' longest connection status fits');
          await run('window.casmateNoFooterMock.setState({connected:true})');
          if (page === 'comments') {
            assert.equal(await run(`document.querySelector('[data-phone="${id}"] [data-action=send],[data-phone="${id}"] [data-action=obs]')!==null`), false, label + ' no camera controls');
            await controls(id); await click(id, 'read');
            assert.equal(await run('window.casmateNoFooterMock.getState().listening'), false, label + ' reading toggle');
            assert.deepEqual((await run(measure(id))).content, before.content, label + ' reading keeps list bounds');
            if (id !== 'B') await click(id, 'close');
          } else {
            assert.equal(await run(`document.querySelector('[data-phone="${id}"] [data-action=read]')!==null`), false, label + ' no reading on camera');
          }
          if (id === 'A') { await click(id, 'controls'); await click(id, 'settings'); } else await click(id, 'settings');
          assert.equal(await run(`(()=>{const s=document.querySelector('[data-phone="${id}"] .nf-sheet');return s.scrollWidth<=s.clientWidth+1})()`), true, label + ' settings fit');
          assert.equal(await run('document.activeElement.closest(".nf-sheet")!==null'), true, label + ' dialog focus');
          await click(id, 'close');
          await click(id, 'connection'); await click(id, 'qr');
          assert.equal(await run('window.casmateNoFooterMock.getState().dialog'), 'qr', label + ' QR entrance');
          await click(id, 'close');
          assert.equal(await run(`document.activeElement.closest('[data-phone="${id}"]')!==null`), true, label + ' focus restored');
          if (width === 736 && scale === 1 || width === 320 && scale === 2 && appearance === 'light') {
            await writeFile(join(process.argv[3], `${id}-${page}-${width}-${scale}-${appearance}.png`), (await win.webContents.capturePage()).toPNG());
          }
          reports.push({ id, width, scale, appearance, page, ...before });
        }
      }
    }
    for (const id of ['A', 'B', 'C']) {
      await run(`for(const e of document.querySelectorAll('[data-design]'))e.hidden=e.dataset.design!=='${id}';window.casmateNoFooterMock.setState({page:'camera',scale:1,appearance:'light',connected:true,sending:true,broadcast:true,listening:true})`);
      await controls(id); await click(id, 'send');
      assert.equal(await run('window.casmateNoFooterMock.getState().sending'), true, id + ' stop needs confirmation');
      await click(id, 'confirm');
      assert.deepEqual(await run('(({sending,broadcast,listening})=>({sending,broadcast,listening}))(window.casmateNoFooterMock.getState())'), { sending: false, broadcast: true, listening: true });
      await run('window.casmateNoFooterMock.setState({sending:true})');
      await controls(id); await click(id, 'obs'); await click(id, 'confirm');
      assert.deepEqual(await run('(({sending,broadcast,listening})=>({sending,broadcast,listening}))(window.casmateNoFooterMock.getState())'), { sending: true, broadcast: false, listening: true });
      await run(`(()=>{const e=document.querySelector('[data-phone="${id}"] .nf-main');e.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,isPrimary:true,pointerId:1,clientX:240,clientY:300}));e.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,isPrimary:true,pointerId:1,clientX:120,clientY:300}));})()`);
      assert.equal(await run('window.casmateNoFooterMock.getState().page'), 'comments', id + ' left flick');
      await run(`(()=>{const e=document.querySelector('[data-phone="${id}"] .nf-main');e.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,isPrimary:true,pointerId:2,clientX:120,clientY:300}));e.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,isPrimary:true,pointerId:2,clientX:122,clientY:370}));e.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,isPrimary:true,pointerId:2,clientX:240,clientY:370}));})()`);
      assert.equal(await run('window.casmateNoFooterMock.getState().page'), 'comments', id + ' vertical gesture does not navigate');
    }
    assert.deepEqual(errors, [], 'console errors');
    await writeFile(join(process.argv[3], 'geometry.json'), JSON.stringify(reports, null, 2));
    console.log(`PASS: ${reports.length} layouts, footer removal, large content, stable disconnect/reading state, dialogs, confirmations and flicks.`);
    win.close(); app.exit(0);
  } catch (error) { console.error(error); win.close(); app.exit(1); }
});
