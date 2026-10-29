import { app, BrowserWindow } from 'electron';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { writeFile } from 'node:fs/promises';
import { verifyObsRegistrationStatus } from './obs-registration-status-checks.mjs';
import { verifyObsSourceCards } from './obs-source-cards-checks.mjs';

app.disableHardwareAcceleration();
app.setPath('userData', join(process.argv[3], 'profile'));
app.whenReady().then(async () => {
  const window = new BrowserWindow({ show: false, width: 760, height: 760,
    webPreferences: { contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
  try {
    const loadFixture = async (...args) => {
      await window.loadFile(...args);
      if (!window.webContents.debugger.isAttached()) window.webContents.debugger.attach('1.3');
      await window.webContents.debugger.sendCommand('Emulation.setFocusEmulationEnabled', { enabled: true });
    };
    const evaluate = async source => {
      try { return await window.webContents.executeJavaScript(source); }
      catch (error) { throw new Error('Renderer script failed: ' + source, { cause: error }); }
    };
    const settle = () => new Promise(resolve => setTimeout(resolve, 70));
    const ready = async condition => {
      for (let attempt = 0; attempt < 45; attempt++) { if (await evaluate(condition)) return; await settle(); }
      throw new Error('Renderer did not reach ' + condition);
    };
    const capture = async label => {
      // A hidden window can return its previous compositor frame on the first capture.
      await window.webContents.capturePage();
      window.webContents.invalidate();
      await evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
      await settle();
      await writeFile(join(process.argv[4], label + '.png'), (await window.webContents.capturePage()).toPNG());
    };
    if (process.argv.includes('--source-cards-only')) {
      await loadFixture(process.argv[2]);
      await ready('Boolean(window.obsRegistrationHarness)');
      const checks = await verifyObsSourceCards({ evaluate, capture: name => capture(name.replace(/\.png$/, '')),
        render: async () => {
          const rendered = evaluate(`new Promise((resolve,reject) => {
            const timer=setTimeout(()=>reject(new Error('OBS source cards did not render two frames')),3000);
            requestAnimationFrame(()=>requestAnimationFrame(()=>{clearTimeout(timer);resolve();}));
          })`);
          window.webContents.invalidate();
          await window.webContents.capturePage(undefined, { stayHidden: true });
          await rendered;
        },
        resize: async (width, height) => { window.setContentSize(width, height); } });
      console.log(`PASS: ${checks} OBS source cards checks`);
      return;
    }
    if (process.argv.includes('--registration-status-only')) {
      await loadFixture(process.argv[2]);
      await ready('Boolean(window.obsRegistrationHarness)');
      const checks = await verifyObsRegistrationStatus({ evaluate, capture: name => capture(name.replace(/\.png$/, '')),
        resize: async (width, height) => { window.setContentSize(width, height); } });
      console.log(`PASS: ${checks} OBS registration status checks`);
      return;
    }
    const key = async (keyCode, modifiers = []) => { window.webContents.sendInputEvent({ type: 'keyDown', keyCode, modifiers }); window.webContents.sendInputEvent({ type: 'keyUp', keyCode, modifiers }); await settle(); };
    const measure = `(() => {
      const dialog = document.getElementById('obs-source-registration-dialog'); const body = dialog.querySelector('.obs-registration-body');
      const rect = element => { const r = element.getBoundingClientRect(); return [r.x, r.y, r.width, r.height]; };
      return { dialog: rect(dialog), input: rect(body.querySelector('.obs-registration-source-value')), status: rect(body.querySelector('[role=status]')),
        add: rect(dialog.querySelector('[data-action=register]')), bodyHeight: body.scrollHeight, bodyTop: body.scrollTop,
        pageHeight: document.querySelector('.management-body').scrollHeight, pageTop: document.querySelector('.management-body').scrollTop,
        focus: document.activeElement === dialog.querySelector('[data-action=register]') };
    })()`;
    const geometry = `(() => {
      const dialog = document.getElementById('obs-source-registration-dialog'); const r = dialog.getBoundingClientRect();
      const body = dialog.querySelector('.obs-registration-body'); const close = dialog.querySelector('.obs-registration-heading button').getBoundingClientRect();
      const actions = dialog.querySelector('.obs-registration-actions'); const footer = actions.getBoundingClientRect();
      return { fits: r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight,
        overflow: body.scrollWidth > body.clientWidth, close: close.top >= r.top && close.bottom <= r.bottom,
        footer: footer.height > 0 && footer.height <= body.clientHeight && actions.scrollHeight === actions.clientHeight };
    })()`;
    const selectMetrics = `(() => [...document.querySelectorAll('#obs-source-registration-dialog select')].filter(element => !element.hidden && (!element.closest('details') || element.closest('details').open)).map(element => {
      const style = getComputedStyle(element); const rect = element.getBoundingClientRect();
      const canvas = document.createElement('canvas'); const context = canvas.getContext('2d');
      context.font = style.fontSize + ' ' + style.fontFamily;
      const text = context.measureText(element.selectedOptions[0]?.textContent || '登録設定・gyp');
      return { label: element.labels[0]?.childNodes[0].textContent || document.getElementById(element.getAttribute('aria-labelledby'))?.textContent, height: rect.height, fontSize: parseFloat(style.fontSize),
        contentHeight: rect.height - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom) - parseFloat(style.borderTopWidth) - parseFloat(style.borderBottomWidth),
        lineHeight: Number.isFinite(parseFloat(style.lineHeight)) ? parseFloat(style.lineHeight) : text.fontBoundingBoxAscent + text.fontBoundingBoxDescent,
        inkHeight: text.actualBoundingBoxAscent + text.actualBoundingBoxDescent };
    }))()`;
    const checkSelects = async (label, count = 0) => {
      const values = await evaluate(selectMetrics); assert.equal(values.length, count, label + ' select count');
      const expectedFont=await evaluate("parseFloat(getComputedStyle(document.querySelector('.management-shell')).getPropertyValue('--management-font-body'))");
      for (const value of values) {
        assert.ok(value.height >= expectedFont*1.5+21.9, `${label} ${value.label} height scales with management text`);
        assert.equal(value.fontSize, expectedFont, `${label} ${value.label} management font size`);
        assert.ok(value.contentHeight >= Math.max(value.lineHeight, value.inkHeight) + 4,
          `${label} ${value.label} text needs room: ${JSON.stringify(value)}`);
      }
    };
    if (process.argv.includes('--disconnected-metrics-only')) {
      let checks = 0;
      for (const width of [320, 420, 480, 560, 760]) {
        window.setContentSize(width, width === 760 ? 560 : 760);
        await loadFixture(process.argv[2], { query: { disconnected: 'true' } });
        await ready('Boolean(window.obsRegistrationHarness)');
        await evaluate("document.querySelector('.management-nav button:nth-child(2)').click(); document.getElementById('settings-urls').click()");
        for (const textSize of ['small', 'medium', 'large']) {
          await evaluate(`window.obsRegistrationHarness.update({textSize:${JSON.stringify(textSize)}})`);
          for (const target of ['comments', 'speech', 'character', 'effects']) {
            await evaluate(`document.getElementById('obs-registration-entry-${target}').click()`);
            await ready("document.querySelector('.obs-registration-status').textContent.includes('OBSに接続していません')");
            const metrics = await evaluate(`(() => {
              const status = document.querySelector('.obs-registration-status');
              const button = document.querySelector('[data-action=register]');
              return { scroll: status.scrollHeight > status.clientHeight, buttonVisible: button.textContent==='OBS接続を設定' && button.getAttribute('aria-disabled')==='false', text: status.textContent };
            })()`);
            if (metrics.scroll) await capture(`disconnected-${width}-${textSize}-${target}`);
            assert.equal(metrics.scroll, false, `${width}/${textSize}/${target}: disconnected guidance must not need a small scrollbar`);
            assert.equal(metrics.buttonVisible, true, 'connection settings button must be fully visible');
            if (width === 560 && textSize === 'medium' && target === 'speech') await capture('disconnected-fixed');
            await key('Escape'); checks++;
          }
        }
      }
      console.log(`PASS: ${checks} disconnected OBS guidance scenarios`);
      return;
    }
    if (process.argv.includes('--recovery-metrics-only')) {
      const recoveryMeasure = `(() => {
        const slot = document.querySelector('.obs-registration-recovery-slot:not([hidden])');
        const list = slot.querySelector('.obs-registration-recovery-list');
        const body = document.querySelector('.management-body');
        const rect = element => { const r = element.getBoundingClientRect(); return [r.x, r.y, r.width, r.height]; };
        return { slot: rect(slot), list: rect(list), bodyHeight: body.scrollHeight, bodyTop: body.scrollTop,
          controls: [...body.querySelectorAll('button')].filter(element => !element.closest('.obs-registration-recovery-slot') && element.getClientRects().length).map(rect),
          focused: document.activeElement === list };
      })()`;
      let checks = 0;
      const sizes = [[320, 760], [420, 760], [480, 760], [560, 760], [760, 560]];
      const configurations = [
        ...sizes.map(([width, height]) => ({ width, height, zoom: 1, outer: false })),
        ...[1, 1.25, 1.5].map(zoom => ({ width: 320, height: 360, zoom, outer: true })),
      ];
      for (const { width, height, zoom, outer } of configurations) {
        if (outer) window.setSize(width, height); else window.setContentSize(width, height);
        await loadFixture(process.argv[2]); window.webContents.setZoomFactor(zoom);
        await ready('Boolean(window.obsRegistrationHarness)');
        for (const owner of ['urls', 'smartphone']) {
          await evaluate(`document.querySelector('.management-nav button:first-child').click(); document.getElementById('home-${owner}').click()`);
          for (const textSize of ['small', 'medium', 'large']) {
            const label = `${outer ? 'outer' : 'content'} ${width}x${height} zoom ${zoom} ${owner} ${textSize}`;
            const target = owner === 'urls' ? { kind: 'overlay', overlay: 'comments' } : { kind: 'smartphone', deviceId: 'visual-phone' };
            const warning = { key: 'recovery-1', target, title: 'OBS登録', message: 'OBSで設定と初期配置の確認が必要です。'.repeat(20) + '終端文字' };
            await evaluate(`window.obsRegistrationHarness.update({textSize:${JSON.stringify(textSize)},recoveries:[]})`);
            assert.equal(await evaluate("document.querySelector('.obs-registration-recovery-slot:not([hidden])')===null"), true, label + ' empty recovery has no region or heading');
            await evaluate(`(() => { window.obsRegistrationHarness.update({recoveries:[${JSON.stringify(warning)}]});
              const slot = document.querySelector('.obs-registration-recovery-slot:not([hidden])');
              slot.scrollIntoView({block:'center'}); slot.querySelector('.obs-registration-recovery-list').focus({preventScroll:true}); })()`);
            await settle();
            const initial = await evaluate(recoveryMeasure);
            assert.equal(initial.focused, true, label + ' keyboard scroll region focused');
            for (const warnings of [[warning], [warning, { ...warning, key: 'recovery-2' }, { ...warning, key: 'recovery-3' }]]) {
              await evaluate(`window.obsRegistrationHarness.update({recoveries:${JSON.stringify(warnings)}})`);
              await settle();
              assert.deepEqual(await evaluate(recoveryMeasure), initial, label + ' warning updates preserve slot, controls, body scroll and focus');
              const visibility = await evaluate(`(() => {
                const slot = document.querySelector('.obs-registration-recovery-slot:not([hidden])');
                const list = slot.querySelector('.obs-registration-recovery-list');
                list.scrollTop = list.scrollHeight;
                const last = list.lastElementChild.querySelector('button');
                const range = document.createRange(); const text = last.firstChild;
                range.setStart(text, Math.max(0, text.length - 8)); range.setEnd(text, text.length);
                const tail = range.getBoundingClientRect(); const s = slot.getBoundingClientRect();
                const l = list.getBoundingClientRect(); const h = slot.querySelector('h3').getBoundingClientRect();
                return { contained: l.bottom <= s.bottom + 1 && l.top >= h.bottom,
                  tailVisible: tail.top >= l.top - 1 && tail.bottom <= Math.min(l.bottom, s.bottom) + 1,
                  scrollable: list.scrollHeight > list.clientHeight, horizontalOverflow: list.scrollWidth > list.clientWidth,
                  headingFont: parseFloat(getComputedStyle(slot.querySelector('h3')).fontSize) };
              })()`);
              assert.deepEqual(visibility, { contained: true, tailVisible: true, scrollable: true, horizontalOverflow: false,
                headingFont: { small: 17, medium: 19, large: 21 }[textSize] }, label + ' warning tail can be read at scroll bottom');
              if (textSize === 'large' && warnings.length === 3 && zoom === 1 && [320, 760].includes(width) && !outer) await capture(`recovery-${owner}-${textSize}-${width}`);
              // Reset only the inner list; asynchronous warning changes must not scroll the editor.
              await evaluate("document.querySelector('.obs-registration-recovery-slot:not([hidden]) .obs-registration-recovery-list').scrollTop = 0");
            }
            await evaluate('window.obsRegistrationHarness.update({recoveries:[]})');
            assert.equal(await evaluate("document.querySelector('.obs-registration-recovery-slot:not([hidden])')===null"), true, label + ' resolved recovery is hidden');
            assert.equal(await evaluate("document.activeElement.id==='editor-heading'"), true, label + ' removed focus returns to editor heading');
            checks++;
          }
        }
      }
      console.log(`PASS: ${checks} OBS recovery text-size/scroll/stability scenarios`);
      return;
    }
    if (process.argv.includes('--select-metrics-only')) {
      const scale = Number(app.commandLine.getSwitchValue('force-device-scale-factor'));
      let checks = 0;
      for (const zoom of [1, 1.25, 1.5, 2]) {
        for (const [width, height] of [[320, 760], [560, 760], [760, 560]]) {
          // Keep the same CSS viewport while testing native device scaling and page zoom independently.
          window.setContentSize(Math.round(width * zoom), Math.round(height * zoom));
          await loadFixture(process.argv[2]); window.webContents.setZoomFactor(zoom);
          await ready('Boolean(window.obsRegistrationHarness)');
          await evaluate("document.querySelector('.management-nav button:nth-child(2)').click(); document.getElementById('settings-urls').click(); window.obsRegistrationHarness.update({multiple:true}); document.getElementById('obs-registration-entry-comments').click()");
          await ready("Boolean(document.querySelector('select[id$=\"-input\"] option[value=\"visual-source\"]'))");
          await evaluate("const input = document.querySelector('select[id$=\"-input\"]'); input.value = 'visual-source'; input.dispatchEvent(new Event('change',{bubbles:true}))");
          await ready("document.querySelector('[data-action=register]')?.getAttribute('aria-disabled') === 'false'");
          assert.ok(Math.abs(await evaluate('devicePixelRatio') - scale * zoom) < 0.01, 'device scale and page zoom applied');
          assert.deepEqual(await evaluate(geometry), { fits: true, overflow: false, close: true, footer: true }, `${scale} scale ${zoom} zoom ${width}px modal`);
          await checkSelects(`${scale} scale ${zoom} zoom ${width}px before add`, 1);
          await evaluate("document.querySelector('[data-action=register]').focus({preventScroll:true})");
          const initial = await evaluate(measure);
          await evaluate("document.querySelector('[data-action=register]').click()"); await ready('window.obsRegistrationHarness.pending()');
          await evaluate("window.obsRegistrationHarness.complete('succeeded')");
          await ready("document.querySelector('.obs-registration-source-value')?.dataset.inputUuid === 'visual-source'");
          assert.deepEqual(await evaluate(measure), initial, 'scaled success preserves layout and focus');
          await checkSelects(`${scale} scale ${zoom} zoom ${width}px after add`, 1);
          if (width === 560 && [1.25, 2].includes(zoom)) await capture(`select-scale-${scale}-zoom-${zoom}`);
          checks++;
        }
      }
      console.log(`PASS: ${checks} OBS select text/zoom scenarios at device scale ${scale}`);
      return;
    }
    let scenarios = 0;
    for (const [width, height] of [[320, 760], [560, 760], [760, 560]]) {
      window.setContentSize(width, height); await loadFixture(process.argv[2]);
      await ready('Boolean(window.obsRegistrationHarness)');
      await evaluate("document.querySelector('.management-nav button:nth-child(2)').click(); document.getElementById('settings-urls').click()"); await settle();
      assert.equal(await evaluate("document.querySelector('.management-body').scrollWidth > document.querySelector('.management-body').clientWidth"), false, `${width}px entry overflow`);
      assert.equal(await evaluate("document.querySelectorAll('.obs-urls-row .obs-urls-add').length"), 4);
      await capture(`${width}-entries`);
      for (const target of ['comments', 'speech', 'character', 'effects']) {
        await evaluate(`document.getElementById('obs-registration-entry-${target}').scrollIntoView({block:'center'}); document.getElementById('obs-registration-entry-${target}').focus({preventScroll:true}); document.getElementById('obs-registration-entry-${target}').click()`);
          await ready("document.querySelector('[data-action=register]')?.getAttribute('aria-disabled') === 'false'");
        assert.deepEqual(await evaluate(geometry), { fits: true, overflow: false, close: true, footer: true }, `${width}px ${target} modal`);
        assert.equal(await evaluate(`(() => {const body = document.querySelector('.obs-registration-body').getBoundingClientRect(); const actions = document.querySelector('.obs-registration-actions').getBoundingClientRect(); return actions.top >= body.top && actions.bottom <= body.bottom;})()`), true, `${width}px ${target} primary controls initially visible`);
        await checkSelects(`${width}px ${target}`);
        await key('Escape');
        assert.equal(await evaluate('document.activeElement.id'), 'obs-registration-entry-' + target); scenarios++;
      }
      await evaluate("document.getElementById('obs-registration-entry-comments').click()");
          await ready("document.querySelector('[data-action=register]')?.getAttribute('aria-disabled') === 'false'");
      await evaluate("document.querySelector('[data-action=register]').focus({preventScroll:true})");
      const initial = await evaluate(measure);
      const initialContexts = await evaluate('window.obsRegistrationHarness.contexts()');
      await evaluate("document.querySelector('[data-action=register]').click()"); await ready('window.obsRegistrationHarness.pending()');
      assert.deepEqual(await evaluate(measure), initial, `${width}px executing positions/focus`); scenarios++;
      await capture(`${width}-running`);
      await evaluate("window.obsRegistrationHarness.complete('succeeded')"); await settle();
      await ready("document.querySelector('.obs-registration-source-value')?.dataset.inputUuid === 'visual-source'");
      assert.equal(await evaluate('window.obsRegistrationHarness.contexts()'), initialContexts + 2, 'context refreshed after completion');
      assert.deepEqual(await evaluate(measure), initial, `${width}px success positions/focus`); scenarios++;
      await checkSelects(`${width}px registered source`);
      await capture(`${width}-refreshed`);
      await evaluate("window.obsRegistrationHarness.update({notice:undefined})"); await settle();
      assert.deepEqual(await evaluate(measure), initial, `${width}px clear toast positions/focus`); scenarios++;
      await evaluate("window.obsRegistrationHarness.update({removedFromScene:true,contextRevision:1})");
      await ready("document.querySelector('.obs-test-status')?.textContent.includes('対象のシーンに追加されていません')");
      assert.equal(await evaluate("document.querySelector('[data-action=register]').textContent"), 'OBSに追加', 'past success is not current confirmation');
      assert.equal(await evaluate("document.querySelector('.obs-registration-status').textContent.includes('登録設定を確認済み')"), false, 'current confirmation cleared');
      assert.deepEqual(await evaluate(measure), initial, `${width}px deletion positions/focus`); scenarios++;
      await capture(`${width}-deleted`);
      await evaluate("document.querySelector('[data-action=register]').click()"); await ready('window.obsRegistrationHarness.pending()');
      await evaluate("window.obsRegistrationHarness.update({removedFromScene:false}); window.obsRegistrationHarness.complete('succeeded')"); await settle();
      await ready("document.querySelector('[data-action=test]')?.getAttribute('aria-disabled') === 'false'");
      await evaluate("document.querySelector('[data-action=test]').focus({preventScroll:true})");
      const beforeTest = await evaluate(measure);
      await evaluate("document.querySelector('[data-action=test]').click()");
      await ready("document.querySelector('.obs-test-status')?.textContent.includes('テスト表示を送信しました')");
      assert.deepEqual(await evaluate(measure), beforeTest, `${width}px test sending positions/scroll`);
      assert.equal(await evaluate("document.activeElement === document.querySelector('[data-action=test]')"), true, 'test focus remains');
      await evaluate("document.querySelector('[data-action=test]').click()");
      await ready("document.querySelector('[data-action=test]')?.getAttribute('aria-disabled') === 'false'");
      assert.deepEqual(await evaluate(measure), beforeTest, `${width}px test stopped positions/scroll`);
      await capture(`${width}-display-test`);
      await evaluate("document.querySelector('.obs-registration-details summary').click(); document.querySelector('[data-action=register]').scrollIntoView({block:'nearest'}); document.querySelector('[data-action=register]').focus({preventScroll:true})");
      const beforeIncomplete = await evaluate(measure);
      await evaluate("document.querySelector('[data-action=register]').click()"); await ready('window.obsRegistrationHarness.pending()');
      await evaluate("window.obsRegistrationHarness.complete('incomplete','OBSで設定と初期配置の確認が必要です。'.repeat(35))"); await settle();
      const afterIncomplete = await evaluate(measure);
      const recoveryHeight = await evaluate("document.querySelector('.obs-registration-recovery-slot:not([hidden])').offsetHeight");
      assert.equal(afterIncomplete.pageHeight, beforeIncomplete.pageHeight + recoveryHeight, 'first warning adds only the trailing recovery region');
      assert.deepEqual({ ...afterIncomplete, pageHeight: beforeIncomplete.pageHeight }, beforeIncomplete, `${width}px incomplete long positions/focus with details open`); scenarios++;
      await capture(`${width}-incomplete`);
      const submitted = await evaluate('window.obsRegistrationHarness.additions()');
      await key('Escape'); await evaluate("document.querySelector('.management-nav button:first-child').click(); document.getElementById('management-warning-entry').click()"); await settle();
      await evaluate("document.querySelector('#management-warning-dialog .management-warnings button').click()");
      await ready("document.getElementById('obs-source-registration-dialog').open");
      assert.equal(await evaluate('window.obsRegistrationHarness.additions()'), submitted, 'warning entry does not re-send');
      assert.deepEqual(await evaluate(geometry), { fits: true, overflow: false, close: true, footer: true }, `${width}px recovery modal`); scenarios++;
      await key('Tab', ['shift']);
      assert.equal(await evaluate("document.activeElement === document.querySelector('.obs-registration-manual summary')"), true, 'Shift+Tab trap');
      await key('Tab'); assert.equal(await evaluate("document.activeElement.getAttribute('aria-label')"), '閉じる', 'Tab trap');
      await key('Escape'); assert.equal(await evaluate('document.activeElement.id'), 'management-warning-entry');
      await evaluate("window.obsRegistrationHarness.update({registration:{busy:false,lastOperation:null,unfinishedOperations:[]},notice:undefined,long:true}); document.getElementById('obs-registration-entry-comments').click()");
          await ready("document.querySelector('[data-action=register]')?.getAttribute('aria-disabled') === 'false'");
      assert.deepEqual(await evaluate(geometry), { fits: true, overflow: false, close: true, footer: true }, `${width}px long target modal`);
      await capture(`${width}-long`); await key('Escape');
      await evaluate("window.obsRegistrationHarness.update({multiple:true,long:false,contextRevision:1}); document.getElementById('obs-registration-entry-comments').click()");
      await ready("Boolean(document.querySelector('select[id$=\"-input\"] option[value=\"visual-source\"]'))");
      // Keep the renderer page active without showing a window, so Chromium emits native focusin/focusout.
      window.webContents.focus();
      await ready('document.hasFocus()');
      assert.equal(await evaluate('document.hasFocus()'), true, 'renderer has native focus');
      await evaluate("const input = document.querySelector('select[id$=\"-input\"]'); input.value = 'visual-source'; input.dispatchEvent(new Event('change',{bubbles:true})); input.focus({preventScroll:true})");
      await checkSelects(`${width}px multiple candidates`, 1);
      assert.deepEqual(await evaluate(`(() => {const input = document.querySelector('select[id$="-input"]'); return { focused:document.activeElement===input,hidden:input.hidden,disabled:input.disabled,value:input.value };})()`), { focused:true,hidden:false,disabled:false,value:'visual-source' }, 'candidate select focused before refresh');
      const beforeUnique = await evaluate(measure);
      await evaluate("window.obsRegistrationHarness.update({multiple:false,contextRevision:2})");
      await ready("document.querySelector('select[id$=\"-input\"]')?.options.length === 2");
      assert.deepEqual(await evaluate(measure), beforeUnique, 'candidate refresh retains source position and focus');
      assert.equal(await evaluate("document.activeElement === document.querySelector('select[id$=\"-input\"]')"), true, 'focused select stays');
      await key('Tab'); await checkSelects(`${width}px unique read-only source`); scenarios++;
      await key('Escape');
      await evaluate("document.querySelector('.management-nav button:first-child').click(); document.getElementById('home-smartphone').click(); window.obsRegistrationHarness.update({phoneOff:true,long:true})"); await settle();
      await evaluate("document.querySelector('.sp-obs-guide-entry').click()");
      await ready("document.getElementById('obs-source-registration-dialog').open");
      await ready("document.querySelector('[data-action=register]').getAttribute('aria-disabled') === 'false'");
      assert.equal(await evaluate(`(() => {
        const heading=document.querySelector('.obs-registration-heading h2');
        const title=heading.getBoundingClientRect(); const close=document.querySelector('.obs-registration-heading button').getBoundingClientRect();
        return heading.textContent.includes('A'.repeat(64)) && heading.scrollWidth<=heading.clientWidth+1 && title.right<=close.left;
      })()`), true, `${width}px long ASCII phone title wraps before close control`);
      await evaluate("document.querySelector('.obs-registration-manual summary').click()"); await settle();
      assert.deepEqual(await evaluate(geometry), { fits: true, overflow: false, close: true, footer: true }, `${width}px phone manual modal`);
      assert.equal(await evaluate("document.querySelector('[data-action=register]').getAttribute('aria-disabled')"), 'false');
      assert.equal(await evaluate("document.querySelector('.obs-registration-manual').textContent.includes('「mpegts」')"), true);
      await evaluate("const body = document.querySelector('.obs-registration-body'); body.scrollTop = body.scrollHeight"); await settle();
      await capture(`${width}-phone-manual`); await key('Escape'); scenarios++;
    }
    console.log(`PASS: ${scenarios} OBS registration layout/state scenarios`);
    console.log('PASS: four entries, manual phone fallback, recovery and keyboard');
  } catch (error) {
    console.error(error);
    console.error(await window.webContents.executeJavaScript(`JSON.stringify({focus:document.activeElement.id,editor:document.getElementById('editor-heading')?.textContent,dialog:document.getElementById('obs-source-registration-dialog').open,recovery:[...document.querySelectorAll('.obs-registration-focus-target')].map(value=>({id:value.id,hidden:Boolean(value.closest('[hidden]')),rect:value.getBoundingClientRect().toJSON()}))})`));
    await writeFile(join(process.argv[4], 'failure.png'), (await window.webContents.capturePage()).toPNG());
    process.exitCode = 1;
  }
  finally { window.destroy(); app.quit(); }
});
