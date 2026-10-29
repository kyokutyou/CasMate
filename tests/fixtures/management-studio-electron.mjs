import { verifyCommentSpeechGuidance } from './comment-speech-guidance-checks.mjs';
import { verifyCommentSourceSave } from './comment-source-save-checks.mjs';
import { app, BrowserWindow, screen } from 'electron';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { verifyManagementStudio } from './management-studio-checks.mjs';
import { verifyManagementCommentScroll } from './management-comment-scroll-checks.mjs';
import { verifyAiSettings } from './ai-settings-checks.mjs';
import { verifySpeechRecognitionApply } from './speech-recognition-apply-checks.mjs';
import { verifyManagementLive } from './management-live-checks.mjs';
import { verifyManagementPageHeadings } from './management-page-heading-checks.mjs';
import { verifyManagementEditorIntros } from './management-editor-intro-checks.mjs';
import { verifyCompactFeedback } from './compact-feedback-checks.mjs';

app.disableHardwareAcceleration();
app.setPath('userData', join(process.argv[3], 'profile'));
app.whenReady().then(async () => {
  const window = new BrowserWindow({ show: false, minWidth: 320, minHeight: 360, width: 1200, height: 820,
    webPreferences: { contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
  window.setMenuBarVisibility(false);
  const requests = [];
  window.webContents.session.webRequest.onBeforeRequest((details, callback) => {
    if (/^https?:/i.test(details.url)) requests.push(details.url);
    callback({ cancel: /^https?:/i.test(details.url) });
  });
  try {
    const { createManagementWindowOpenHandler } = await import(pathToFileURL(join(process.argv[3], 'management-window-open.mjs')).href);
    const openedUrls = [];
    window.webContents.setWindowOpenHandler(createManagementWindowOpenHandler(url => openedUrls.push(url)));
    await window.loadFile(process.argv[2]);
    const evaluate = async code => {
      try { return await window.webContents.executeJavaScript(code); }
      catch (error) { throw new Error(`Renderer evaluation failed: ${code}`, { cause: error }); }
    };
    // Each fixture is an independent run even when Chromium persisted a prior zoom.
    window.webContents.setZoomFactor(1);
    const settle = async () => {
      const rendered = evaluate(`new Promise((resolve,reject) => {
        const timer=setTimeout(() => reject(new Error('Management window did not render two frames')),3000);
        requestAnimationFrame(() => requestAnimationFrame(() => { clearTimeout(timer); resolve(); }));
      })`);
      window.webContents.invalidate();
      await window.webContents.capturePage(undefined, { stayHidden: true });
      await rendered;
    };
    // Windows rounds native DIP bounds to physical pixels. At 125% scale,
    // setContentSize(1101, ...) can produce 1377 physical px => 1102 CSS px.
    // The captured surface / renderer DPR is the viewport oracle, including zoom.
    // Exact CSS breakpoint widths are exercised by the native-browser CDP fixture.
    const waitForViewport = async requested => {
      const deadline = Date.now() + 3000;
      let dimensions;
      do {
        await settle();
        const image = await window.webContents.capturePage(undefined, { stayHidden: true });
        const physical = image.getSize();
        const viewport = await evaluate('({ width:innerWidth, height:innerHeight, dpr:devicePixelRatio })');
        const expected = { width:Math.round(physical.width / viewport.dpr), height:Math.round(physical.height / viewport.dpr) };
        const nativeContent = window.getContentBounds();
        const nativeBounds = window.getBounds();
        const displayScale = screen.getDisplayMatching(nativeBounds).scaleFactor;
        const [width, height] = window.getContentSize();
        dimensions = { requested, viewport, expected, physical, nativeContent, nativeBounds, displayScale, factor:window.webContents.getZoomFactor() };
        const nativeSizeApplied = requested.contentWidth === undefined ||
          width === requested.contentWidth && height === requested.contentHeight;
        if (viewport.width === expected.width && viewport.height === expected.height &&
            nativeSizeApplied && width === Math.floor(physical.width / displayScale) && height === Math.floor(physical.height / displayScale) &&
            width === nativeContent.width && height === nativeContent.height &&
            nativeBounds.width >= width && nativeBounds.height >= height) return;
      } while (Date.now() < deadline);
      throw new Error(`Viewport did not match native rendered surface: ${JSON.stringify(dimensions)}`);
    };
    const resize = async (width, height) => { window.setContentSize(width, height); await waitForViewport({ contentWidth:width, contentHeight:height }); };
    const resizeMinimum = async () => {
      const minimum = window.getMinimumSize();
      if (minimum[0] !== 320 || minimum[1] !== 360) throw new Error(`Native minimum constraint changed: ${minimum}`);
      // Prove that the requested minimum is the native clamp, rather than
      // accepting a stale larger window whose surface is internally consistent.
      // This is only a proof baseline, not a layout acceptance size. It divides
      // evenly at every exercised zoom factor, avoiding fractional CSS viewports.
      await resize(1200,840);
      const large = window.getBounds();
      window.setSize(320, 360);
      await waitForViewport({ outerWidth:320, outerHeight:360 });
      const requested = window.getBounds();
      window.setSize(1, 1);
      await waitForViewport({ outerWidth:1, outerHeight:1 });
      const clamped = window.getBounds();
      if (requested.width >= large.width || requested.height >= large.height ||
          requested.width !== clamped.width || requested.height !== clamped.height) {
        throw new Error(`Requested minimum did not reach the native clamp: ${JSON.stringify({ minimum, large, requested, clamped })}`);
      }
      window.setSize(320, 360);
      await waitForViewport({ outerWidth:320, outerHeight:360 });
      const restored = window.getBounds();
      if (restored.width !== clamped.width || restored.height !== clamped.height) throw new Error('Native minimum changed when restoring the requested outer size');
    };
    await resize(1200,820);
    if (process.argv.includes('--minimum-viewport-only')) {
      for (const factor of [1,1.25,1.5]) {
        window.webContents.setZoomFactor(factor);
        await resizeMinimum();
      }
      if (requests.length) throw new Error('Unexpected external requests');
      console.log('PASS: 3 native minimum viewport checks; zero HTTP(S) requests'); app.exit(0); return;
    }
    if (process.argv.includes('--compact-feedback-only')) {
      const count = await verifyCompactFeedback({ evaluate,
        resize,
        capture: async name => { await new Promise(resolve => setTimeout(resolve, 120)); await mkdir(process.argv[4], { recursive: true }); await writeFile(join(process.argv[4], name), (await window.webContents.capturePage(undefined, { stayHidden: true })).toPNG()); },
      });
      if (requests.length) throw new Error('Unexpected external requests');
      console.log(`PASS: compact feedback ${count} layouts; zero HTTP(S) requests`); app.exit(0); return;
    }
    if (process.argv.includes('--source-save-only')) {
      const count = await verifyCommentSourceSave({ evaluate,
        resize,
        capture: async name => { await mkdir(process.argv[4], { recursive: true }); await writeFile(join(process.argv[4], name), (await window.webContents.capturePage(undefined, { stayHidden: true })).toPNG()); },
      });
      if (requests.length) throw new Error('Unexpected external requests');
      console.log(`PASS: ${count} comment source save checks; zero HTTP(S) requests`); app.exit(0); return;
    }
    if (process.argv.includes('--comment-speech-only') || process.argv.includes('--ai-settings-only') || process.argv.includes('--recognition-apply-only') || process.argv.includes('--live-only') || process.argv.includes('--page-headings-only') || process.argv.includes('--editor-intros-only')) {
      const speechOnly = process.argv.includes('--comment-speech-only');
      const introsOnly = process.argv.includes('--editor-intros-only');
      const headingsOnly = process.argv.includes('--page-headings-only');
      const recognitionOnly = process.argv.includes('--recognition-apply-only');
      const liveOnly = process.argv.includes('--live-only');
      const checks = await (speechOnly ? verifyCommentSpeechGuidance : introsOnly ? verifyManagementEditorIntros : headingsOnly ? verifyManagementPageHeadings : liveOnly ? verifyManagementLive : recognitionOnly ? verifySpeechRecognitionApply : verifyAiSettings)({ evaluate, resize, settle,
        setZoom: async factor => { window.webContents.setZoomFactor(factor); },
        resizeMinimum,
        pressKey: async (key, shift = false) => {
          window.webContents.focus();
          const modifiers = shift ? ['shift'] : [];
          window.webContents.sendInputEvent({ type:'keyDown', keyCode:key, modifiers });
          if (key === 'Enter') window.webContents.sendInputEvent({ type:'char', keyCode:'\r', modifiers });
          window.webContents.sendInputEvent({ type:'keyUp', keyCode:key, modifiers });
        },
        capture: process.argv[4] ? async name => {
          await mkdir(process.argv[4],{recursive:true});
          await window.webContents.capturePage(undefined,{stayHidden:true}); window.webContents.invalidate();
          await evaluate('new Promise(resolve=>{const timer=setTimeout(resolve,100);requestAnimationFrame(()=>requestAnimationFrame(()=>{clearTimeout(timer);resolve()}))})');
          await new Promise(resolve=>setTimeout(resolve,50));
          await writeFile(join(process.argv[4],name),(await window.webContents.capturePage(undefined,{stayHidden:true})).toPNG());
        } : undefined });
      if (requests.length) throw new Error('Unexpected external requests');
      console.log(`PASS: ${checks} ${speechOnly ? 'comment speech guidance' : introsOnly ? 'editor introduction' : headingsOnly ? 'page heading' : liveOnly ? 'live workspace' : recognitionOnly ? 'recognition apply' : 'AI settings'} checks; zero HTTP(S) requests`); app.exit(0); return;
    }
    if (process.argv.includes('--comment-scroll-only')) {
      window.webContents.debugger.attach('1.3');
      const checks = await verifyManagementCommentScroll({ evaluate,
        resize,
        wheel: async (x, y, deltaY) => {
          await window.webContents.capturePage(undefined, {stayHidden:true});
          window.webContents.invalidate();
          await evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
          await window.webContents.debugger.sendCommand('Input.dispatchMouseEvent', {type:'mouseWheel',x,y,deltaY,deltaX:0});
        },
        capture: process.argv[4] ? async name => {
          await mkdir(process.argv[4], {recursive:true});
          await writeFile(join(process.argv[4], name), (await window.webContents.capturePage(undefined, {stayHidden:true})).toPNG());
        } : undefined,
      });
      if (requests.length) throw new Error('Unexpected external requests');
      console.log(`PASS: ${checks} comment wheel scroll checks; zero HTTP(S) requests`); app.exit(0); return;
    }
    for (const size of ['small','medium','large']) for (const factor of [1, 1.25, 1.5]) {
      window.webContents.setZoomFactor(factor); await resizeMinimum();
      await evaluate(`(() => { const snapshot=boardManagementHarness.snapshot(); boardManagementHarness.updateSnapshot({settingsRevision:snapshot.settingsRevision+1,settings:{...snapshot.settings,application:{...snapshot.settings.application,managementTextSize:${JSON.stringify(size)}}}}); document.querySelector('[data-page="settings"]').click(); })()`);
      await new Promise(resolve => setTimeout(resolve, 80));
      const check=async location=>{
        const result=await evaluate(`(() => { const body=document.querySelector('.management-body'); return document.documentElement.scrollWidth<=innerWidth&&body.scrollWidth<=body.clientWidth&&[...document.querySelectorAll('.management-nav>button')].every(node=>{const box=node.getBoundingClientRect();return box.x>=0&&box.right<=innerWidth&&box.bottom<=innerHeight;}); })()`);
        if(!result)throw new Error(`Native minimum/${size}/zoom ${factor}/${location}: overflow ${await evaluate("JSON.stringify({inner:[innerWidth,innerHeight],document:document.documentElement.scrollWidth,body:[document.querySelector('.management-body').clientWidth,document.querySelector('.management-body').scrollWidth,document.querySelector('.management-body').clientHeight],nav:document.querySelector('.management-nav').getBoundingClientRect().bottom,wide:[...document.querySelectorAll('.management-body *')].filter(node=>node.checkVisibility()&&(node.getBoundingClientRect().right>document.querySelector('.management-body').clientWidth||node.scrollWidth>node.clientWidth+1)).slice(0,12).map(node=>[node.tagName,node.className,node.getBoundingClientRect().width,node.clientWidth,node.scrollWidth])})")}`);
      };
      for(const page of ['home','live','settings']){
        await evaluate(`document.querySelector('[data-page="${page}"]').click()`);await check(page);
      }
      const entries=await evaluate("[...document.querySelectorAll('.management-categories .management-entry')].map(entry=>entry.id)");
      for(const id of entries){
        await evaluate(`document.getElementById(${JSON.stringify(id)}).click()`);await check(id);
        if(id==='settings-nextThread'){
          const prior=await evaluate('boardManagementHarness.snapshot().shitarabaNextThread');
          const positions=[];
          for(const status of ['creating','browserRequired']){
            await evaluate(`boardManagementHarness.updateSnapshot({shitarabaNextThread:{...boardManagementHarness.snapshot().shitarabaNextThread,status:${JSON.stringify(status)}}})`);
            positions.push(await evaluate("(()=>{const state=document.querySelector('.next-status'),following=document.querySelector('.next-columns');return [state.getBoundingClientRect().height,following.getBoundingClientRect().top]})()"));
            await check(`${id}/${status}`);
          }
          if(positions[0].some((value,index)=>Math.abs(value-positions[1][index])>.01))throw new Error(`Native minimum/${size}/zoom ${factor}: next-thread status moved controls ${JSON.stringify(positions)}`);
          await evaluate(`boardManagementHarness.updateSnapshot({shitarabaNextThread:${JSON.stringify(prior)}})`);
        }
        await evaluate("document.querySelector('.back-button').click()");
      }
    }
    window.webContents.setZoomFactor(1);
    await evaluate(`(() => { const snapshot=boardManagementHarness.snapshot(); boardManagementHarness.updateSnapshot({settingsRevision:snapshot.settingsRevision+1,settings:{...snapshot.settings,application:{...snapshot.settings.application,managementTextSize:'medium'}}}); })()`);
    const count = await verifyManagementStudio({ evaluate, resize,
      pressRight: async () => { window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Right' }); window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Right' }); },
      capture: process.argv[4] ? async name => { await mkdir(process.argv[4], { recursive: true }); await window.webContents.capturePage(undefined, { stayHidden:true }); window.webContents.invalidate(); await evaluate('new Promise(resolve=>{const timer=setTimeout(resolve,100);requestAnimationFrame(()=>requestAnimationFrame(()=>{clearTimeout(timer);resolve()}))})'); await new Promise(resolve => setTimeout(resolve, 50)); await writeFile(join(process.argv[4], name), (await window.webContents.capturePage(undefined, { stayHidden: true })).toPNG()); } : undefined });
    await evaluate(`(() => {
      const snapshot = boardManagementHarness.snapshot(); const last = snapshot.comments.at(-1);
      boardManagementHarness.updateSnapshot({comments: [...snapshot.comments.slice(1), {...last, id:'external-link', sequence:last.sequence+1, content:[{type:'text',text:'https://example.com/comment'}]}]});
      document.querySelector('[data-page="live"]').click();
    })()`);
    if (openedUrls.length) throw new Error('A comment URL opened without a click');
    await window.webContents.executeJavaScript("document.querySelector('.studio-comment-stream a').click()", true);
    await new Promise(resolve => setTimeout(resolve, 100));
    if (JSON.stringify(openedUrls) !== JSON.stringify(['https://example.com/comment'])) throw new Error('Comment URL did not reach the default browser');
    if (BrowserWindow.getAllWindows().length !== 1) throw new Error('Comment URL created an app popup');
    if (requests.length) throw new Error('Unexpected external requests');
    console.log(`PASS: ${count} studio checks; native minimum and zoom; zero HTTP(S) requests; comment URL dispatched without popup`); app.exit(0);
  } catch (error) { console.error(error); app.exit(1); }
});
