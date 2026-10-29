import { app, BrowserWindow } from 'electron';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';

app.disableHardwareAcceleration();
app.setPath('userData', join(process.argv[3], 'profile'));
app.whenReady().then(async () => {
  const window = new BrowserWindow({ show: false, width: 760, height: 560, minWidth: 320, minHeight: 360,
    webPreferences: { contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
  window.setMenuBarVisibility(false);
  try {
    const evaluate = code => window.webContents.executeJavaScript(code);
    const update = (state, message = '') => evaluate(`window.boardNextThreadHarness.update(${JSON.stringify(state)}, ${JSON.stringify(message)})`);
    const resize = async (width, height) => {
      window.setContentSize(width, height);
      const deadline = Date.now() + 3000;
      let dimensions;
      // Windows rounds DIP bounds at fractional display scales. Compare the
      // renderer with its captured physical surface; CDP checks exact breakpoints.
      do {
        const physical = (await window.webContents.capturePage(undefined, { stayHidden: true })).getSize();
        const viewport = await evaluate('({width:innerWidth,height:innerHeight,dpr:devicePixelRatio})');
        const native = window.getContentSize();
        dimensions = { requested:[width,height], native, physical, viewport };
        if (Math.abs(native[0] - width) <= 2 && Math.abs(native[1] - height) <= 2 &&
          Math.abs(viewport.width - native[0]) <= 1 && Math.abs(viewport.height - native[1]) <= 1 &&
          viewport.width === Math.round(physical.width / viewport.dpr) &&
          viewport.height === Math.round(physical.height / viewport.dpr)) return viewport.width;
        if (Date.now() > deadline) throw new Error(`Next-thread viewport did not resize to ${width}x${height}: ${await evaluate('JSON.stringify({inner:[innerWidth,innerHeight],zoom:devicePixelRatio})')}`);
        await new Promise(resolve => setTimeout(resolve, 20));
      } while (Date.now() < deadline);
      throw new Error(`Next-thread viewport did not settle: ${JSON.stringify(dimensions)}`);
    };
    const measure = () => evaluate(`(() => {
      const box = element => { const { x, y, width, height } = element.getBoundingClientRect(); return { x, y, width, height }; };
      const body = document.querySelector('.management-body');
      const action = document.querySelector('[aria-label="今すぐ作成"]');
      return { action: box(action), url: box(document.querySelector('[id$="-next-url"]')),
        current: box(document.querySelector('.next-live')), state: box(document.querySelector('.next-state-message')),
        scroll: body.scrollTop, height: body.scrollHeight, focus: document.activeElement === action ? 'create-action' : document.activeElement.id,
        overflow: body.scrollWidth > body.clientWidth || document.documentElement.scrollWidth > innerWidth };
    })()`);
    let count = 0;
    for (const width of [320, 334, 337, 341, 342, 345, 348, 349, 350, 355, 360, 365, 420, 480, 560, 760, 1200]) {
      await window.loadFile(process.argv[2]);
      await resize(width, width <= 560 ? 760 : 560);
      await evaluate("document.querySelector('.management-nav > button[data-page=\"settings\"]').click()");
      await evaluate("document.getElementById('settings-nextThread').click()");
      const autoLayout = () => evaluate(`(() => {
        const rect = element => { const { x, y, width, height } = element.getBoundingClientRect(); return { x, y, width, height }; };
        const body = document.querySelector('.management-body');
        return { toggle: rect(document.querySelector('[aria-label="次スレッド自動作成"]')),
          timing: rect(document.querySelector('.next-grid')), height: body.scrollHeight, scroll: body.scrollTop,
          overflow: body.scrollWidth > body.clientWidth };
      })()`);
      for (const enabled of [false, true]) {
        for (const createAtResponseNumber of [1, 10000]) {
          await evaluate(`window.boardNextThreadHarness.settings({ enabled: ${enabled}, createAtResponseNumber: ${createAtResponseNumber}, switchAtResponseNumber: 10000 })`);
          const actual = await autoLayout();
          await evaluate(`window.boardNextThreadHarness.settings({ enabled: ${!enabled}, createAtResponseNumber: ${createAtResponseNumber}, switchAtResponseNumber: 10000 })`);
          const autoBaseline = await autoLayout();
          await evaluate(`window.boardNextThreadHarness.settings({ enabled: ${enabled}, createAtResponseNumber: ${createAtResponseNumber}, switchAtResponseNumber: 10000 })`);
          const { toggle, ...layout } = actual;
          const { toggle: baselineToggle, ...baselineLayout } = autoBaseline;
          assert.deepEqual(layout, baselineLayout, `${width}/${enabled}/${createAtResponseNumber}: automatic setting shifted the inputs`);
          for (const key of ['x', 'y', 'width', 'height']) assert.ok(Math.abs(toggle[key] - baselineToggle[key]) < 1,
            `${width}/${enabled}/${createAtResponseNumber}: automatic setting shifted the switch ${key}`);
        }
      }
      await evaluate('window.boardNextThreadHarness.settings({})');
      await evaluate(`(() => {
        const action = document.querySelector('[aria-label="今すぐ作成"]');
        document.querySelector('[id$="-createAtResponseNumber"]').focus({preventScroll:true});
        const body = document.querySelector('.management-body');
        body.scrollTop += action.getBoundingClientRect().top - 240;
      })()`);
      const baseline = await measure();
      assert.equal(baseline.overflow, false, `${width}: initial overflow`);
      for (const state of [{ status: 'creating', message: '同名タイトルを確認して作成しています。' },
        { status: 'monitoring', maxResponseNumber: null, remainingResponses: null, message: null },
        { status: 'monitoring', maxResponseNumber: 10000, remainingResponses: 10000, message: null },
        { status: 'browserRequired', message: '認証が必要です。ブラウザで作成してURLを登録してください。'.repeat(30) },
        { status: 'uncertain', message: '作成結果を確認できません。'.repeat(30) },
        { status: 'created', nextThreadUrl: 'https://bbs.jpnkn.com/test/read.cgi/clarahas/456/',
          message: '認証要求のためアプリからの案内は省略しました。必要ならブラウザで案内してください。' },
        { status: 'manualReady', plannedTitle: '長い作成予定タイトル'.repeat(100), plannedBody: '長い本文です。\n'.repeat(1000), message: null },
        { status: 'manualReady', message: null }]) {
        await update(state, state.status === 'created' ? '作成済みURLを登録しました。' : '');
        assert.deepEqual(await measure(), baseline, `${width}/${state.status}: state shifted controls or focus`);
        assert.equal(await evaluate("document.querySelector('.next-recovery').open"), false, 'recovery must not auto-open');
        count++;
      }
      for (const url of [`https://bbs.jpnkn.com/test/read.cgi/${'longboard'.repeat(20)}/123/`, 'https://bbs.jpnkn.com/test/read.cgi/clarahas/123/']) {
        await evaluate(`window.boardNextThreadHarness.thread(${JSON.stringify(url)})`);
        assert.deepEqual(await measure(), baseline, `${width}: long current URL preserves controls and focus`);
        assert.equal(await evaluate('document.querySelector(".next-current-url").textContent'), url, 'current URL is never abbreviated');
        const textArea = await evaluate(`(() => { const e=document.querySelector('.next-current-url');return {height:e.clientHeight,line:parseFloat(getComputedStyle(e).lineHeight),width:e.clientWidth,contentWidth:e.scrollWidth}; })()`);
        assert.ok(textArea.height>=Math.floor(textArea.line)&&textArea.contentWidth<=textArea.width+1, `${width}: current URL keeps a readable line without horizontal scrollbar: ${JSON.stringify(textArea)}`);
      }
      // User-opened recovery can change height; subsequent asynchronous statuses must not.
      await evaluate("document.querySelector('.next-recovery summary').click()");
      await evaluate("document.querySelector('[id$=\"-resolved\"]').focus({preventScroll:true})");
      const expanded = await measure();
      await update({ status: 'browserRequired', message: 'ブラウザで認証して作成してください。'.repeat(30) });
      assert.deepEqual(await measure(), expanded, `${width}: browser recovery shifted controls`);
      if (process.argv[4] && [320, 560, 760].includes(width)) {
        await mkdir(process.argv[4], { recursive: true });
        await evaluate(`(() => { const body = document.querySelector('.management-body');
          body.scrollTop += document.querySelector('.next-live').getBoundingClientRect().top - 180; })()`);
        await evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
        await writeFile(join(process.argv[4], `board-state-${width}.png`), (await window.webContents.capturePage()).toPNG());
        await evaluate(`(() => { const body = document.querySelector('.management-body');
          body.scrollTop += document.querySelector('.next-recovery').getBoundingClientRect().top - 150; })()`);
        await evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
        await writeFile(join(process.argv[4], `board-recovery-${width}.png`), (await window.webContents.capturePage()).toPNG());
      }
      count++;
    }
    for (const theme of ['graphite', 'midnight', 'ocean', 'burgundy', 'pearl', 'ivory', 'sakura', 'lavender']) {
      for (const size of ['small', 'medium', 'large']) for (const width of [320, 420, 480, 560, 760, 900, 901, 1200]) {
        const actualWidth = await resize(width, width === 760 ? 560 : 760);
        await evaluate(`window.boardNextThreadHarness.appearance(${JSON.stringify(theme)},${JSON.stringify(size)});window.boardNextThreadHarness.settings({titleMode:'auto',bodyMode:'auto',announceCurrentThread:false});window.boardNextThreadHarness.update({status:'manualReady'})`);
        const layout = await evaluate(`(() => {
          const panel=document.querySelector('.next-thread-panel'),body=document.querySelector('.management-body');
          const a=panel.querySelector('.next-settings').getBoundingClientRect(),b=panel.querySelector('.next-planned').getBoundingClientRect();
          return {overflow:body.scrollWidth>body.clientWidth,sideBySide:Math.abs(a.top-b.top)<1,
            compact:innerWidth<901||panel.querySelector('.next-live').getBoundingClientRect().height<=112,
            clipped:[...panel.querySelectorAll('h3,label,summary,button')].filter(e=>e.checkVisibility()).some(e=>e.scrollWidth>e.clientWidth+1||e.scrollHeight>e.clientHeight+1)};
        })()`);
        assert.deepEqual(layout, { overflow:false, sideBySide:actualWidth>900, compact:true, clipped:false }, `${theme}/${size}/${width}: compact readable settings and preview`);
        if (process.argv[4] && ['ocean','pearl'].includes(theme) && size==='medium' && [320,1200].includes(width)) {
          await evaluate("document.querySelector('.next-recovery').open=false;document.querySelector('.management-body').scrollTop=0");
          await evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
          await writeFile(join(process.argv[4], `next-layout-${theme}-${width}.png`), (await window.webContents.capturePage()).toPNG());
        }
        count++;
      }
    }
    window.setSize(320,360);
    for (const size of ['small','medium','large']) for (const zoom of [1,1.25,1.5]) {
      window.webContents.setZoomFactor(zoom);
      await evaluate(`window.boardNextThreadHarness.appearance('ocean',${JSON.stringify(size)});window.boardNextThreadHarness.update({status:'creating'})`);
      await window.webContents.capturePage(undefined,{stayHidden:true});
      const baseline=await measure();
      assert.equal(baseline.overflow,false,`${size}/${zoom}: native minimum has no overflow`);
      assert.equal(await evaluate("document.querySelector('.management-body').clientHeight>0"),true,'native minimum keeps a scrollable body');
      await update({status:'browserRequired'});
      assert.deepEqual(await measure(),baseline,`${size}/${zoom}: native minimum status preserves operation positions`);
      count++;
    }
    console.log(`PASS: ${count} board next-thread drawing scenarios`);
    window.destroy(); app.quit();
  } catch (error) { console.error(error); window.destroy(); app.exit(1); }
});
