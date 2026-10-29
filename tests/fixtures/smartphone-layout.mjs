import { app, BrowserWindow } from 'electron';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { writeFile } from 'node:fs/promises';

app.disableHardwareAcceleration();
app.setPath('userData', join(process.argv[3], 'profile'));
app.whenReady().then(async () => {
  const window = new BrowserWindow({ show: false, width: 760, height: 760,
    webPreferences: { contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
  const network = process.argv[5];
  try {
    const evaluate = async code => {
      try { return await window.webContents.executeJavaScript(code); }
      catch (error) { console.error('Renderer evaluation failed:', code); throw error; }
    };
    const settle = () => new Promise(resolve => setTimeout(resolve, 90));
    const capture = async name => {
      await evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
      await writeFile(join(process.argv[4], name), (await window.webContents.capturePage()).toPNG());
    };
    const key = async (keyCode, modifiers = []) => {
      window.webContents.sendInputEvent({ type: 'keyDown', keyCode, modifiers });
      if (keyCode === 'Return') window.webContents.sendInputEvent({ type: 'char', keyCode: '\r', modifiers });
      window.webContents.sendInputEvent({ type: 'keyUp', keyCode, modifiers }); await settle();
    };
    const ready = async condition => {
      for (let attempt = 0; attempt < 40; attempt++) { if (await evaluate(condition)) return; await settle(); }
      throw new Error(`Renderer did not reach ${condition}`);
    };
    const measure = `(() => {
      const body = document.querySelector('.management-body');
      const input = document.querySelector('[aria-label="登録・制御のTCPポート"]');
      const qr = document.querySelector('.sp-qr-button');
      const rect = element => { const r = element.getBoundingClientRect(); return [r.x, r.y, r.width, r.height]; };
      return { input: rect(input), qr: rect(qr), guide: rect(document.querySelector('.sp-device-obs .sp-obs-guide-entry')), scroll: body.scrollTop, height: body.scrollHeight,
        focused: document.activeElement === input, overflow: body.scrollWidth > body.clientWidth };
    })()`;
    const update = async source => { await evaluate(`window.smartphoneHarness.update(${source})`); await settle(); };
    const checkResourceFlow = async (label, pane) => {
      const geometry = await evaluate(`(() => {
        const list = document.querySelector('#sp-direct-pane-${pane} .sp-direct-resources');
        const cards = [...list.querySelectorAll('.sp-direct-resource')];
        const bounds = list.getBoundingClientRect();
        return { cards: cards.length, focusedWindow: list.hasAttribute('tabindex'),
          overflow: document.querySelector('.management-body').scrollWidth > document.querySelector('.management-body').clientWidth,
          nestedScroll: [list, ...cards].some(element => ['auto', 'scroll'].includes(getComputedStyle(element).overflowY)),
          allCardsFit: cards.every(card => { const r = card.getBoundingClientRect(); return r.top >= bounds.top - .5 && r.bottom <= bounds.bottom + .5; }),
          addressesFit: cards.every(card => [...card.querySelectorAll('.sp-direct-resource-address')].every(address => {
            const text = document.createRange(); text.selectNodeContents(address);
            const r = text.getBoundingClientRect(); const slot = address.getBoundingClientRect();
            return r.left >= slot.left && r.right <= slot.right && r.bottom <= slot.bottom;
          })) };
      })()`);
      assert.ok(geometry.cards > 0, `${label} ${pane} communication cards`);
      assert.deepEqual({ ...geometry, cards: undefined }, { cards: undefined, focusedWindow: false, overflow: false,
        nestedScroll: false, allCardsFit: true, addressesFit: true }, `${label} ${pane} resources flow in the page`);
    };
    const changePort = async value => {
      await evaluate(`document.querySelector('[aria-label="登録・制御のTCPポート"]').select()`);
      await window.webContents.insertText(value);
      await ready('window.smartphoneHarness.pending()');
    };
    const checkDirectRoute = async (label, edit = true) => {
      if (network !== 'direct') return;
      const settings = await evaluate('JSON.stringify(window.smartphoneHarness.snapshot().view.settings)');
      await evaluate("document.getElementById('sp-direct-tab-router').focus({preventScroll:true})");
      await key('Home');
      assert.equal(await evaluate('document.activeElement.id'), 'sp-direct-tab-phone', `${label} route Home`);
      await key('End');
      assert.equal(await evaluate('document.activeElement.id'), 'sp-direct-tab-pc', `${label} route End`);
      await key('Left');
      assert.equal(await evaluate('document.activeElement.id'), 'sp-direct-tab-router', `${label} route ArrowLeft`);
      await key('Right');
      assert.equal(await evaluate('document.activeElement.id'), 'sp-direct-tab-pc', `${label} route ArrowRight`);
      assert.equal(await evaluate('JSON.stringify(window.smartphoneHarness.snapshot().view.settings)'), settings, `${label} route selection is read-only`);
      assert.equal(await evaluate('window.smartphoneHarness.pending()'), false, `${label} route selection does not save`);
      const icons = await evaluate(`Array.from(document.querySelectorAll('.sp-direct-route [role=tab]')).map(tab => {
        const icon = tab.querySelector('svg'); const r = icon?.getBoundingClientRect();
        return { present: Boolean(icon && icon.querySelector('path, rect, line, circle, polyline')),
          decorative: icon?.getAttribute('aria-hidden') === 'true', visible: Boolean(r && r.width > 0 && r.height > 0) };
      })`);
      assert.deepEqual(icons, Array.from({ length: 3 }, () => ({ present: true, decorative: true, visible: true })), `${label} drawn route icons`);
      const routeHelpBounds = await evaluate(`Array.from(document.querySelectorAll('.sp-direct-route [role=tab]')).map(tab => {
        const help = tab.querySelector('small'); const state = tab.querySelector('.sp-direct-node-state');
        const text = document.createRange(); text.selectNodeContents(help);
        return { id: tab.id, textBottom: text.getBoundingClientRect().bottom, stateTop: state.getBoundingClientRect().top };
      })`);
      for (const { id, textBottom, stateTop } of routeHelpBounds) {
        assert.ok(textBottom <= stateTop, `${label} ${id} help text overlaps status: ${textBottom} > ${stateTop}`);
      }
      await evaluate("document.getElementById('sp-direct-tab-router').click()"); await settle();
      if (edit) {
        const appearance = await evaluate(`(() => {
          const luminance = color => {
            const channels = color.match(/[\\d.]+/g).slice(0, 3).map(Number).map(value => value / 255)
              .map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
            return channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722;
          };
          const buttons = [...document.querySelectorAll('.sp-direct-route > button, .sp-direct-modes > button')];
          return { backgrounds: [...document.querySelectorAll('.sp-direct-route > button')].map(button => getComputedStyle(button).backgroundColor),
            contrasts: buttons.flatMap(button => {
              const background = luminance(getComputedStyle(button).backgroundColor);
              return [...button.querySelectorAll('strong, small, .sp-direct-node-state')].map(text => {
                const foreground = luminance(getComputedStyle(text).color);
                return (Math.max(background, foreground) + .05) / (Math.min(background, foreground) + .05);
              });
            }) };
        })()`);
        assert.notEqual(appearance.backgrounds[0], appearance.backgrounds[1], `${label} selected route appearance`);
        assert.equal(appearance.backgrounds[0], appearance.backgrounds[2], `${label} unselected route appearance`);
        assert.ok(appearance.contrasts.every(ratio => ratio >= 4.5), `${label} route/mode text contrast: ${appearance.contrasts}`);
        await evaluate("document.querySelector('.sp-direct-route').scrollIntoView({block:'start', behavior:'instant'})"); await settle();
        await capture(`${label}-route-auto.png`);
      }
      const method = "Array.from(document.querySelectorAll('.sp-direct-modes button')).find(button => button.textContent.includes('ルーターで手動設定'))";
      if (!await evaluate(`(${method}).getAttribute('aria-pressed') === 'true'`)) {
        await evaluate(`(${method}).click()`); await ready('window.smartphoneHarness.pending()');
        await evaluate('window.smartphoneHarness.complete()'); await settle();
      }
      const addressSelector = '[aria-label="共通TCP 候補1の公開IP"]';
      const portSelector = '[aria-label="共通TCP 候補1の公開ポート"]';
      await evaluate(`document.querySelector(${JSON.stringify(addressSelector)}).scrollIntoView({block:'center', behavior:'instant'});
        document.querySelector(${JSON.stringify(addressSelector)}).focus({preventScroll:true})`);
      await key('Tab');
      assert.equal(await evaluate('document.activeElement.getAttribute("aria-label")'), '共通TCP 候補1の公開ポート', `${label} candidate Tab`);
      await key('Tab', ['shift']);
      assert.equal(await evaluate('document.activeElement.getAttribute("aria-label")'), '共通TCP 候補1の公開IP', `${label} candidate Shift+Tab`);
      if (edit) {
        await evaluate(`window.directCandidateInput = document.querySelector(${JSON.stringify(addressSelector)}); window.directCandidateInput.select()`);
        await window.webContents.insertText('8.8.8.8');
        await evaluate(`window.directCandidatePort = document.querySelector(${JSON.stringify(portSelector)}); window.directCandidatePort.select()`); await window.webContents.insertText('23000');
        await evaluate("document.querySelector('.management-body').scrollTop += window.directCandidatePort.getBoundingClientRect().y - 200");
        const manualMeasure = `(() => {
          const body = document.querySelector('.management-body'); const input = document.querySelector(${JSON.stringify(portSelector)});
          const r = input.getBoundingClientRect(); return { rect: [r.x, r.y, r.width, r.height], focused: document.activeElement === input,
            height: body.scrollHeight, scroll: body.scrollTop, overflow: body.scrollWidth > body.clientWidth };
        })()`;
        const manualBefore = await evaluate(manualMeasure); assert.equal(manualBefore.overflow, false, `${label} manual overflow`);
        await ready('window.smartphoneHarness.pending()');
        assert.deepEqual(await evaluate(manualMeasure), manualBefore, `${label} manual processing`);
        await evaluate('window.smartphoneHarness.complete()'); await settle();
        assert.deepEqual(await evaluate(manualMeasure), manualBefore, `${label} manual saved focus and position`);
        assert.equal(await evaluate(`document.querySelector(${JSON.stringify(addressSelector)}) === window.directCandidateInput && document.activeElement === window.directCandidatePort`), true, `${label} candidate identity and focus after save`);
        assert.equal(await evaluate(`document.querySelector(${JSON.stringify(addressSelector)}).value`), '8.8.8.8', `${label} saved public IP`);
        await evaluate(`document.querySelector(${JSON.stringify(portSelector)}).select()`); await window.webContents.insertText('23001');
        await ready('window.smartphoneHarness.pending()'); await evaluate("window.smartphoneHarness.complete('手動接続先を保存できません。'.repeat(30))"); await settle();
        assert.deepEqual(await evaluate(manualMeasure), manualBefore, `${label} manual failure`);
        await evaluate(`document.querySelector(${JSON.stringify(portSelector)}).select()`); await window.webContents.insertText('23002');
        await ready('window.smartphoneHarness.pending()'); await evaluate('window.smartphoneHarness.complete()'); await settle();
      }
      const geometry = await evaluate(`(() => {
        const pane = document.getElementById('sp-direct-pane-router'); const body = document.querySelector('.management-body');
        const inputs = Array.from(pane.querySelectorAll('input, select')).filter(element => element.getBoundingClientRect().width > 0);
        return { overflow: body.scrollWidth > body.clientWidth,
          inputsFit: inputs.every(element => { const r = element.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth; }),
          publicAddressVisible: inputs.some(element => element.getAttribute('aria-label') === '共通TCP 候補1の公開IP') };
      })()`);
      assert.deepEqual(geometry, { overflow: false, inputsFit: true, publicAddressVisible: true }, `${label} manual router layout`);
      await capture(`${label}-route-manual.png`);
      await evaluate("document.getElementById('sp-direct-tab-phone').click()"); await settle();
      await checkResourceFlow(label, 'phone');
      await capture(`${label}-route-phone.png`);
      await evaluate("document.getElementById('sp-direct-tab-pc').click()"); await settle();
      await checkResourceFlow(label, 'pc');
      await capture(`${label}-route-pc.png`);
      await evaluate("document.querySelector('#sp-direct-pane-pc .sp-direct-resources').scrollIntoView({block:'start', behavior:'instant'})"); await settle();
      await capture(`${label}-route-pc-resources.png`);
    };
    const checkObsGuide = async (label, deviceId, name = 'スマホA') => {
      const selector = deviceId ? `#sp-obs-guide-entry-${deviceId}` : '.sp-device-obs .sp-obs-guide-entry';
      const entryId = await evaluate(`(() => { const entry = document.querySelector(${JSON.stringify(selector)}); entry.scrollIntoView({block:'center', behavior:'instant'}); entry.focus({preventScroll:true}); return entry.id; })()`);
      await settle();
      const scroll = await evaluate("document.querySelector('.management-body').scrollTop");
      await evaluate(`document.getElementById(${JSON.stringify(entryId)}).click()`);
      await ready("document.getElementById('sp-obs-guide-dialog').open");
      const geometry = await evaluate(`(() => {
        const dialog = document.getElementById('sp-obs-guide-dialog'); const body = dialog.querySelector('.sp-obs-guide-body');
        const header = dialog.querySelector('.sp-obs-guide-heading'); const close = header.querySelector('button');
        const r = dialog.getBoundingClientRect(); const c = close.getBoundingClientRect(); const h = header.getBoundingClientRect();
        return { fits: r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight,
          overflow: body.scrollWidth > body.clientWidth, closeVisible: c.top >= r.top && c.bottom <= h.bottom,
          focused: document.activeElement === close, steps: body.querySelectorAll('li').length };
      })()`);
      assert.deepEqual(geometry, { fits: true, overflow: false, closeVisible: true, focused: true, steps: 4 }, label);
      assert.equal(await evaluate("document.querySelector('.sp-obs-guide-target').textContent"), name);
      await key('Tab', ['shift']);
      assert.equal(await evaluate("document.activeElement.className"), 'sp-obs-guide-body', `${label} Shift+Tab`);
      await key('Tab'); assert.equal(await evaluate("document.activeElement.textContent"), '閉じる', `${label} Tab`);
      await capture(`${label}-obs-guide.png`);
      await key('Escape');
      assert.equal(await evaluate("document.getElementById('sp-obs-guide-dialog').open"), false);
      assert.equal(await evaluate("document.activeElement.id"), entryId);
      assert.equal(await evaluate("document.querySelector('.management-body').scrollTop"), scroll, `${label} closing scroll`);
    };
    const checkNetworkHint = async label => {
      const original = await evaluate('window.smartphoneHarness.snapshot()');
      const alternate = network === 'lan' ? 'direct' : 'lan';
      const labels = { lan: '家庭内LAN', tailscale: 'Tailscale', direct: '直接接続' };
      const networkIndex = { lan: 0, direct: 1, tailscale: 2 };
      const geometry = `(() => {
        const rect = selector => { const r = document.querySelector(selector).getBoundingClientRect(); return [r.x, r.y, r.width, r.height]; };
        const body = document.querySelector('.management-body');
        return { qr: rect('.sp-qr-button'), status: rect('.sp-connection-state'), states: rect('.sp-feature-states'),
          cards: [...document.querySelectorAll('.sp-network-choice')].map(card => ({
            background: getComputedStyle(card).backgroundColor, border: getComputedStyle(card).borderColor,
            display: getComputedStyle(card.querySelector('button')).backgroundColor,
            switchBackground: getComputedStyle(card.querySelector('.sp-network-switch')).backgroundColor,
          })),
          scroll: body.scrollTop, height: body.scrollHeight, focus: document.activeElement.getAttribute('aria-label'),
          overflow: body.scrollWidth > body.clientWidth };
      })()`;
      await evaluate(`document.querySelectorAll('.sp-network-choice > button')[${networkIndex[network]}].focus({preventScroll:true})`);
      const before = await evaluate(geometry);
      await update(`(() => { const value = window.smartphoneHarness.snapshot(); value.view.settings.activeNetwork = ${JSON.stringify(alternate)}; return value; })()`);
      assert.deepEqual(await evaluate(geometry), before, `${label} ON route update preserves controls, scroll and focus`);
      assert.equal(await evaluate("document.querySelector('.sp-connection-hint > span').textContent"), `${labels[alternate]}がONです。`);
      assert.equal(await evaluate("document.querySelector('.sp-active-network-link').getAttribute('aria-label')"), `${labels[alternate]}の設定を見る`);
      const fit = await evaluate(`(() => {
        const links = document.querySelector('.sp-active-network-link');
        const r = links.getBoundingClientRect(); const status = document.querySelector('.sp-connection-state').getBoundingClientRect();
        const buttons = [...document.querySelectorAll('.sp-network-choice > button')];
        const labelsFit = buttons.every(button => {
          const bounds = button.getBoundingClientRect();
          return [...button.querySelectorAll('strong, small')].every(text => {
            const r = text.getBoundingClientRect(); return r.left >= bounds.left && r.right <= bounds.right && r.bottom <= bounds.bottom;
          });
        });
        return { linkFits: r.left >= status.left && r.right <= status.right && r.bottom <= status.bottom,
          linkBackground: getComputedStyle(links).backgroundColor,
          labelsFit, displayLabels: document.querySelector('.sp-networks').textContent.includes('表示中'),
          selectedCount: buttons.filter(button => button.getAttribute('aria-pressed') === 'true').length };
      })()`);
      assert.deepEqual(fit, { linkFits: true, linkBackground: 'rgba(0, 0, 0, 0)', labelsFit: true, displayLabels: false, selectedCount: 1 }, `${label} compact route hint fits`);
      await capture(`${label}-route-mismatch.png`);
      await evaluate("document.querySelector('.sp-active-network-link').focus({preventScroll:true})");
      await update(`(() => { const value = window.smartphoneHarness.snapshot(); value.view.settings.activeNetwork = null; return value; })()`);
      assert.deepEqual(await evaluate(geometry), before, `${label} all OFF preserves layout`);
      assert.equal(await evaluate("document.querySelector('.sp-active-network-link') === null"), true);
      await update(`(() => { const value = window.smartphoneHarness.snapshot(); value.view.settings.activeNetwork = ${JSON.stringify(alternate)}; return value; })()`);
      await evaluate("document.querySelector('.sp-active-network-link').focus({preventScroll:true})");
      await key('Return');
      assert.equal(await evaluate(`document.querySelectorAll('.sp-network-choice > button')[${networkIndex[alternate]}].getAttribute('aria-pressed')`), 'true');
      assert.equal(await evaluate(`document.activeElement === document.querySelectorAll('.sp-network-choice > button')[${networkIndex[alternate]}]`), true);
      assert.equal(await evaluate('window.smartphoneHarness.pending()'), false, `${label} route link does not save`);
      assert.equal(await evaluate('window.smartphoneHarness.snapshot().view.settings.activeNetwork'), alternate);
      await evaluate(`document.querySelectorAll('.sp-network-choice > button')[${networkIndex[network]}].click()`);
      await update(JSON.stringify(original));
    };
    const cardColors = `(() => {
      const context = document.createElement('canvas').getContext('2d');
      const luminance = color => {
        context.fillStyle = color; context.fillRect(0, 0, 1, 1);
        const channels = [...context.getImageData(0, 0, 1, 1).data].slice(0, 3).map(value => value / 255)
          .map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
        return channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722;
      };
      const buttons = [...document.querySelectorAll('.sp-network-choice > button')];
      const selected = buttons.find(button => button.getAttribute('aria-pressed') === 'true');
      return { differentBackground: buttons.filter(button => button !== selected).every(button =>
          getComputedStyle(button).backgroundColor !== getComputedStyle(selected).backgroundColor),
        underline: getComputedStyle(selected).boxShadow.includes('inset') && getComputedStyle(selected).boxShadow.includes('-3px'),
        contrasts: buttons.flatMap(button => {
          const background = luminance(getComputedStyle(button).backgroundColor);
          return [...button.querySelectorAll('strong, small')].map(text => {
            const foreground = luminance(getComputedStyle(text).color);
            return (Math.max(background, foreground) + .05) / (Math.min(background, foreground) + .05);
          });
        }) };
    })()`;
    const checkCardColors = async label => {
      const appearance = await evaluate(cardColors);
      assert.equal(appearance.differentBackground, true, `${label} selected background differs`);
      assert.equal(appearance.underline, true, `${label} selected underline`);
      assert.ok(appearance.contrasts.every(ratio => ratio >= 4.5), `${label} text contrast: ${appearance.contrasts}`);
    };
    let count = 0;
    const checkComments = async width => {
      const originalStyle = await evaluate("document.querySelector('.management-shell').getAttribute('style')");
      const themes = await evaluate("window.smartphoneHarness.themes.filter(theme => ['pearl', 'ocean'].includes(theme.id))");
      for (const theme of themes) for (const size of ['medium', 'large']) {
        await evaluate(`{ const shell=document.querySelector('.management-shell');
          for(const [key,value] of Object.entries(${JSON.stringify(theme.style)})) { if(key.startsWith('--')) shell.style.setProperty(key,value); }
          shell.style.colorScheme=${JSON.stringify(theme.style.colorScheme)};
          for(const [key,value] of Object.entries(window.smartphoneHarness.textSizes[${JSON.stringify(size)}])) shell.style.setProperty(key,value);
          shell.dataset.managementTextSize=${JSON.stringify(size)};
           }`);
        await settle();
        const advanced = "document.querySelector('.sp-advanced')";
        assert.equal(await evaluate(`(${advanced}).open`), false, 'connection details start closed');
        if(theme.id==='ocean' && size==='medium') {
          await evaluate("document.querySelector('.sp-advanced > summary').focus({preventScroll:true})");
          await key('Return');
          assert.equal(await evaluate(`(${advanced}).open`),true,'Enter opens connection details');
          await key('Space');
          assert.equal(await evaluate(`(${advanced}).open`),false,'Space closes connection details');
        }
        const layout = await evaluate(`(() => {
          const section=document.querySelector('.sp-compact-settings');
          const columns=[...section.querySelectorAll('.sp-comments-column')].map(el=>el.getBoundingClientRect());
          const body=document.querySelector('.management-body');
          return { columns:columns.length, qualityVisible:document.querySelector('.sp-audio-quality input').getBoundingClientRect().height>0, obsVisible:document.getElementById('sp-obs-settings').getBoundingClientRect().height>0, speechAlwaysVisible:!document.querySelector('.sp-speech-summary').closest('details'),
            overflow:body.scrollWidth>body.clientWidth,
            clipped:[...section.querySelectorAll('p,code,button,.compact-feedback')].filter(el=>el.checkVisibility()).some(el=>el.scrollWidth>el.clientWidth+1 || el.scrollHeight>el.clientHeight+1),
            forbidden:/待ち \\d+件|破棄累計|いつでも利用|OBSの準備は不要|以下は現在ON|音声を開始/.test(section.textContent) };
        })()`);
        assert.equal(layout.overflow, false, `${width} ${size} comments overflow`);
        assert.equal(layout.clipped, false, `${width} ${size} comments clipping`);
        assert.equal(layout.forbidden, false, 'removed diagnostics and explanations');
        assert.equal(layout.columns, 1, `${width} browser remains in one column`);
        assert.equal(layout.qualityVisible && layout.obsVisible, true, 'audio quality and OBS action always visible');
        assert.equal(layout.speechAlwaysVisible, true, `${width} speech settings remain visible`);
        await evaluate(`{ const field=document.querySelector('.sp-audio-quality input'); field.focus({preventScroll:true});
          document.querySelector('.sp-compact-settings').scrollIntoView({block:'start'}); }`); await settle();
        const geometry = `(() => { const body=document.querySelector('.management-body'); const field=document.querySelector('.sp-audio-quality input');
          return { rect:[...document.querySelectorAll('.sp-compact-settings button,.sp-compact-settings input,.sp-audio-quality')].map(el=>{const r=el.getBoundingClientRect();return [r.x,r.y,r.width,r.height];}),
          height:body.scrollHeight,scroll:body.scrollTop,focus:document.activeElement===field }; })()`;
        const before=await evaluate(geometry);
        await update(`(() => { const value=window.smartphoneHarness.snapshot(); value.mobile.audioAvailable=false; value.mobile.clientCount=12; return value; })()`);
        assert.deepEqual(await evaluate(geometry),before,`${width} ${size} speech status preserves operation position`);
        await update(`(() => { const value=window.smartphoneHarness.snapshot(); value.mobile.audioAvailable=true; value.mobile.clientCount=3; return value; })()`);
        if(size==='medium' || width===320) await capture(`${width}-${theme.id}-${size}-comments.png`);
      }
      await evaluate(`{ const shell=document.querySelector('.management-shell'); shell.setAttribute('style',${JSON.stringify(originalStyle)}); shell.dataset.managementTextSize='medium';
         document.querySelector('.management-body').scrollTop=0; }`);
    };
    for (const [width, height] of [[320, 760], [420, 760], [480, 760], [560, 760], [760, 560]]) {
      window.setContentSize(width, height); window.webContents.setZoomFactor(1); await settle();
      await window.loadFile(process.argv[2], { query: { network } });
      await ready('Boolean(window.smartphoneHarness)');
      await evaluate("document.getElementById('home-smartphone').click()"); await settle();
      assert.equal(await evaluate("document.querySelector('.sp-advanced').open"), false, 'advanced settings start closed');
      assert.equal(await evaluate("[...document.querySelectorAll('.sp-network-switch [role=switch]')].filter(element => element.getBoundingClientRect().width > 0 && element.getBoundingClientRect().height > 0).length"), 3, `${width}px visible network switches`);
      assert.equal(await evaluate("document.querySelector('.management-body').scrollWidth > document.querySelector('.management-body').clientWidth"), false, `${width}px initial overflow`);
      await checkCardColors(`${width}px`);
      if (network === 'lan' && width === 760) {
        const themes = await evaluate('window.smartphoneHarness.themes');
        const originalStyle = await evaluate("document.querySelector('.management-shell').getAttribute('style')");
        for (const theme of themes) {
          await evaluate(`{ const shell = document.querySelector('.management-shell'); const style = ${JSON.stringify(theme.style)};
            for (const [key, value] of Object.entries(style)) { if (key.startsWith('--')) shell.style.setProperty(key, value); }
            shell.style.colorScheme = style.colorScheme; }`);
          await checkCardColors(theme.id);
          if (theme.id === 'pearl') await capture('760-pearl-cards.png');
        }
        await evaluate(`document.querySelector('.management-shell').setAttribute('style', ${JSON.stringify(originalStyle)})`);
      }
      await capture(`${width}.png`);
      await checkComments(width);
      // The hint is shared by all routes; exercise its geometry once per width.
      if (network === 'lan') await checkNetworkHint(`${width}`);
      await checkObsGuide(`${width}`);
      await evaluate("document.querySelector('.sp-advanced > summary').click()"); await settle();
      if (network === 'direct') {
        assert.equal(await evaluate("document.getElementById('sp-direct-tab-router').getAttribute('aria-selected')"), 'true', `${width}px initial router route`);
        await checkDirectRoute(`${width}`);
      }
      await evaluate(`{
        const input = document.querySelector('[aria-label="登録・制御のTCPポート"]'); input.focus({preventScroll:true});
        document.querySelector('.management-body').scrollTop += input.getBoundingClientRect().y - 200; }`);
      await settle();
      const before = await evaluate(measure);
      assert.equal(before.overflow, false, `${width}px settings overflow`); assert.ok(before.input[2] > 0 && before.focused, 'measure a visible focused input');
      await changePort('3101'); await settle();
      assert.deepEqual(await evaluate(measure), before, `${width}px processing shift`); count++;
      await evaluate('window.smartphoneHarness.complete()'); await settle();
      assert.deepEqual(await evaluate(measure), before, `${width}px success shift`); count++;
      await changePort('3102');
      await evaluate(`window.smartphoneHarness.complete(${'"設定を保存できません。接続先とポートを確認してください。"'}.repeat(20))`); await settle();
      assert.deepEqual(await evaluate(measure), before, `${width}px failure shift`); count++;
      await changePort('3103'); await evaluate('window.smartphoneHarness.complete()'); await settle();
      const fresh = `(() => { const value = window.smartphoneHarness.snapshot(); const profile = value.view.devices[0].profiles[${JSON.stringify(network)}];
        profile.preparation = { video: 'ready', obsControl: 'disabled' }; profile.receiver = { state: 'receiving', receivedBytes: 10000 }; profile.stale = false;
        profile.report = { status: 'sending', deviceId: value.view.devices[0].id }; return value; })()`;
      await update(fresh); assert.deepEqual(await evaluate(measure), before, `${width}px receiving shift`); count++;
      await update(`(() => { const value = window.smartphoneHarness.snapshot(); const profile = value.view.devices[0].profiles[${JSON.stringify(network)}];
        profile.stale = true; profile.receiver = { state: 'error', receivedBytes: 0 }; profile.preparation.video = 'error';
        value.view.networks[${JSON.stringify(network)}].warning = '映像の準備を確認してください。'.repeat(20); return value; })()`);
      assert.deepEqual(await evaluate(measure), before, `${width}px warning and stale shift`); count++;
      await update(`(() => { const value = window.smartphoneHarness.snapshot(); value.notice = { tone: 'success', message: '長い連続通知です。'.repeat(30) };
        if (${JSON.stringify(network)} === 'direct') { value.view.direct.entries = value.view.direct.entries.map(entry => ({ ...entry,
            address: null, publicPort: null, listener: false, firewall: false, prepared: false, method: 'unnecessary',
            expiresAt: 1791439200000, warning: '公開と期限の確認が必要です。'.repeat(20) }));
          value.view.direct.residual = [{ id: 'residual', kind: 'router', message: '残存設定の確認が必要です。'.repeat(20) }]; }
        return value; })()`);
      assert.deepEqual(await evaluate(measure), before, `${width}px long notification/resources shift`); count++;
      if (network === 'direct') {
        assert.equal(await evaluate("document.querySelector('#sp-direct-pane-pc .sp-direct-resource-warning').open"), false, `${width}px warnings do not auto-expand`);
        const warning = "document.querySelector('#sp-direct-pane-pc .sp-direct-resource-warning')";
        await evaluate(`(${warning}).querySelector('summary').click()`); await settle();
        const warningContent = await evaluate(`(${warning}).querySelector('p').textContent`);
        const controls = `(() => {
          const rect = selector => { const r = document.querySelector(selector).getBoundingClientRect(); return [r.x, r.y, r.width, r.height]; };
          return { retry: rect('#sp-direct-pane-pc button.sp-direct-icon-button'), maintenance: rect('.sp-direct-maintenance') };
        })()`;
        const expandedBefore = { page: await evaluate(measure), controls: await evaluate(controls) };
        for (const warningText of ['更新された要確認事項です。'.repeat(40), null]) {
          await update(`(() => { const value = window.smartphoneHarness.snapshot(); value.view.direct.entries[0].warning = ${JSON.stringify(warningText)}; return value; })()`);
          assert.deepEqual({ page: await evaluate(measure), controls: await evaluate(controls) }, expandedBefore, `${width}px expanded warning update/removal preserves controls`);
          assert.equal(await evaluate(`(${warning}).querySelector('p').textContent`), warningContent, `${width}px expanded warning keeps the displayed content`);
        }
        assert.equal(await evaluate(`(${warning}).querySelector('summary').textContent`), '要確認の内容なし');
        await evaluate(`(${warning}).querySelector('summary').focus({preventScroll:true})`);
        assert.equal(await evaluate(`document.activeElement === (${warning}).querySelector('summary')`), true, `${width}px warning summary focused`);
        await key('Return'); assert.equal(await evaluate(`(${warning}).open`), false, `${width}px keyboard collapses warning`);
        await key('Return'); assert.equal(await evaluate(`(${warning}).querySelector('p').textContent`), 'この通信の要確認事項はありません。', `${width}px reopening reads the latest warning`);
        await key('Return');
        await evaluate("document.querySelector('[aria-label=\"登録・制御のTCPポート\"]').focus({preventScroll:true})");
        await update(`(() => { const value = window.smartphoneHarness.snapshot(); const entry = value.view.direct.entries[0];
          value.view.direct.entries = Array.from({length: 12}, (_, i) => ({ ...entry, id: 'entry-' + i })); return value; })()`);
        const expanded = await evaluate(measure);
        assert.ok(expanded.height > before.height, `${width}px additional communications extend the page`);
        assert.deepEqual({ ...expanded, height: before.height }, before, `${width}px new communications preserve current input and scroll`);
        await checkResourceFlow(`${width}-many`, 'pc');
      }
      const beforeRemoval = await evaluate(measure);
      await update("{ notice: undefined }"); assert.deepEqual(await evaluate(measure), beforeRemoval, `${width}px notice removal shift`); count++;
      await evaluate("document.querySelector('.sp-device').scrollIntoView({block:'center', behavior:'instant'})"); await settle();
      await capture(`${width}-receiver.png`);
    }
    // Explicit navigation preserves expanded details, drafts, and the caller's focus.
    await evaluate("document.querySelector('.back-button').click()"); await settle();
    assert.equal(await evaluate('document.activeElement.id'), 'home-smartphone');
    await evaluate("document.getElementById('home-smartphone').click()"); await settle();
    assert.equal(await evaluate("document.querySelector('.sp-advanced').open"), true);
    assert.equal(await evaluate("document.querySelector('[aria-label=\"登録・制御のTCPポート\"]').value"), '3103');
    await evaluate("document.querySelector('.sp-qr-button').focus(); document.querySelector('.sp-qr-button').click()");
    await ready("document.querySelector('.sp-qr-dialog').open");
    await key('Tab'); assert.equal(await evaluate('document.activeElement.textContent'), 'QRを隠す');
    await key('Escape'); assert.equal(await evaluate("document.querySelector('.sp-qr-dialog').open"), false);
    assert.equal(await evaluate("document.activeElement === document.querySelector('.sp-qr-button')"), true);
    window.setSize(320, 360);
    for (const zoom of [1, 1.25]) {
      window.webContents.setZoomFactor(zoom); await settle();
      assert.equal(await evaluate("document.querySelector('.management-body').scrollWidth > document.querySelector('.management-body').clientWidth"), false, `native minimum/${zoom} overflow`);
      await checkObsGuide(`minimum-${zoom}`);
      await checkDirectRoute(`minimum-${zoom}`, false);
      await capture(`minimum-${zoom}.png`);
    }
    window.setContentSize(760, 560); window.webContents.setZoomFactor(1); await settle();
    const secondId = '22222222-2222-4222-8222-222222222222';
    await update(`(() => { const value = window.smartphoneHarness.snapshot(); value.view.devices.push({ ...value.view.devices[0], id: ${JSON.stringify(secondId)}, name: 'スマホB' }); return value; })()`);
    await checkObsGuide('second-device', secondId, 'スマホB');
    await evaluate(`document.getElementById('sp-obs-guide-entry-${secondId}').click()`);
    await ready("document.getElementById('sp-obs-guide-dialog').open");
    await update(`(() => { const value = window.smartphoneHarness.snapshot(); value.view.devices = value.view.devices.filter(device => device.id !== ${JSON.stringify(secondId)}); return value; })()`);
    assert.equal(await evaluate("document.getElementById('sp-obs-guide-dialog').open"), false, 'removed device guide closes');
    assert.equal(await evaluate("document.activeElement.textContent"), '登録済みのスマホ', 'removed device returns to list');
    await checkObsGuide('remaining-device');
    console.log(`PASS: ${count} smartphone state scenarios`);
    console.log('PASS: keyboard, return state, minimum and zoom'); app.exit(0);
  } catch (error) { console.error(error); app.exit(1); }
});
