import assert from 'node:assert/strict';
import { app, BrowserWindow } from 'electron';
import { join } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';

app.disableHardwareAcceleration();
app.setPath('userData', join(process.argv[3], 'profile'));
app.whenReady().then(async () => {
  const window = new BrowserWindow({ show: false, webPreferences: { contextIsolation: true, nodeIntegration: false } });
  try {
    await window.loadFile(process.argv[2]);
    const evaluate = code => window.webContents.executeJavaScript(code);
    const settle = () => new Promise(resolve => setTimeout(resolve, 80));
    for (const width of [1000, 560, 320]) {
      window.setContentSize(width, 760);
      await evaluate('obsControlStatusHarness.reset()'); await settle();
      assert.equal(await evaluate("document.querySelector('.oc-footer-status')"), null);
      const measure = `(() => {
        const rect = node => { const r = node.getBoundingClientRect(); return [r.x, r.y, r.width, r.height]; };
        return { controls: [...document.querySelectorAll('.oc-master,.oc-operation,.oc-permissions,.oc-connection-details')].map(rect),
          height: document.querySelector('.oc-content').getBoundingClientRect().height,
          scroll: document.scrollingElement.scrollTop,
          mainScroll: document.querySelector('.management-shell').scrollTop,
          focus: document.activeElement.textContent,
          overflow: document.documentElement.scrollWidth > innerWidth };
      })()`;
      await evaluate("document.querySelector('.oc-operation-action').focus({preventScroll:true})");
      await evaluate("document.querySelector('.management-shell').scrollTop = 40; document.scrollingElement.scrollTop = 40");
      const before = await evaluate(measure);
      assert.equal(before.overflow, false);
      if (width === 320) assert.ok(before.scroll + before.mainScroll > 0, 'test starts scrolled');
      await evaluate("document.querySelector('.oc-operation-action').click()"); await settle();
      assert.ok(await evaluate("document.querySelector('.oc-operation-text').textContent.includes('操作を処理しています…')"));
      assert.deepEqual(await evaluate(measure), before, `${width}: pending position`);
      await evaluate(`obsControlStatusHarness.fail(${JSON.stringify('OBSの接続先を確認してください。'.repeat(30))})`); await settle();
      assert.ok(await evaluate("document.querySelector('.oc-operation-text').textContent.includes('OBSの接続先を確認してください。')"));
      assert.ok(await evaluate("document.querySelector('.oc-operation-text').textContent.includes('確認待ちはありません。')"));
      assert.equal(await evaluate("(()=>{const node=document.querySelector('.oc-operation-text');return node.scrollHeight>node.clientHeight && getComputedStyle(node).overflowY==='auto'})()"), true);
      assert.deepEqual(await evaluate(measure), before, `${width}: failure position`);
    }
    let checks = 0;
    await evaluate('obsControlStatusHarness.reset()'); await settle();
    const capture = process.argv[4];
    if (capture) await mkdir(capture, { recursive: true });
    for (const theme of ['graphite','midnight','ocean','burgundy','pearl','ivory','sakura','lavender']) {
      for (const size of ['small','medium','large']) for (const [width,height] of [[1000,760],[760,560],[601,760],[600,760],[560,760],[431,760],[430,760],[320,760],[205,360],[203,360]]) {
        window.setContentSize(width,height);
        await evaluate(`obsControlStatusHarness.display({connection:'connected',stream:'stopped',error:null},${JSON.stringify(theme)},${JSON.stringify(size)})`);
        await settle();
        const layout = await evaluate(`(() => {
          const voice=document.querySelector('[aria-label="音声の操作許可"]'),android=document.querySelector('[aria-label="Androidの操作許可"]');
          const v=voice.getBoundingClientRect(),a=android.getBoundingClientRect();
          return {width:innerWidth,overflow:document.documentElement.scrollWidth>innerWidth,
            columns:getComputedStyle(document.querySelector('.oc-permissions')).gridTemplateColumns.split(' ').length,
            overlap:v.x<a.right&&a.x<v.right&&v.y<a.bottom&&a.y<v.bottom,
            connectionOpen:document.querySelector('.oc-connection-details').open,
            phrasesOpen:document.querySelector('.oc-voice-details').open,
            clipped:[...document.querySelectorAll('.oc-note,.oc-live-top strong,summary')].some(n=>n.checkVisibility()&&n.scrollWidth>n.clientWidth+1)};
        })()`);
        if(layout.overflow) {
          const wide=await evaluate("[...document.querySelectorAll('.oc-content *')].filter(n=>n.checkVisibility()&&n.getBoundingClientRect().right>innerWidth).map(n=>({tag:n.tagName,class:n.className,width:n.getBoundingClientRect().width,text:n.textContent.slice(0,40)}))");
          assert.fail(`${theme}/${size}/${width} overflow: ${JSON.stringify(wide)}`);
        }
        assert.equal(layout.overlap,false,`${theme}/${size}/${width} permission overlap`);
        assert.equal(layout.columns,layout.width>600?2:1);
        assert.equal(layout.connectionOpen,false); assert.equal(layout.phrasesOpen,false);
        assert.equal(layout.clipped,false,`${theme}/${size}/${width} clipped`);
        if(capture&&['ocean','pearl'].includes(theme)&&size==='medium'&&[1000,320].includes(width)) {
          await writeFile(join(capture,`obs-${theme}-${width}.png`),(await window.webContents.capturePage()).toPNG());
        }
        checks++;
      }
    }
    await evaluate("document.querySelector('.oc-connection-details>summary').click();document.querySelector('.oc-voice-details>summary').click()");
    await settle();
    assert.equal(await evaluate("[...document.querySelectorAll('.oc-field input')].every(n=>n.checkVisibility())"),true);
    assert.equal(await evaluate('document.documentElement.scrollWidth>innerWidth'),false);
    console.log(`PASS: OBS status reuses existing area at 3 widths without position changes; ${checks} theme/size/width layouts`); app.exit(0);
  } catch (error) { console.error(error); app.exit(1); }
});
