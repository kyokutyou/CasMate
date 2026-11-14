import assert from 'node:assert/strict';
import { app, BrowserWindow } from 'electron';
import { join } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';

app.disableHardwareAcceleration();
app.setPath('userData', join(process.argv[3], 'responsive-profile'));
app.whenReady().then(async () => {
  const createWindow = offscreen => new BrowserWindow({ show:false, width:1200, height:1100, useContentSize:true,
    webPreferences:{ contextIsolation:true, nodeIntegration:false, spellcheck:false, backgroundThrottling:false, offscreen } });
  let window = createWindow(true);
  const evaluate = source => window.webContents.executeJavaScript(source, true);
  window.webContents.on('console-message',event=>{if(event.level==='error')console.error(event.message);});
  const requests=[];
  window.webContents.session.webRequest.onCompleted(details=>requests.push({url:details.url,type:details.resourceType,status:details.statusCode}));
  window.webContents.session.webRequest.onErrorOccurred(details=>requests.push({url:details.url,type:details.resourceType,error:details.error}));
  const painted = () => evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
  window.webContents.session.webRequest.onBeforeSendHeaders({urls:['http://127.0.0.1/*','https://*/*']}, (details, callback) => {
    // Match production HTTPS Origin validation on the disposable HTTP server.
    if(details.url.startsWith('http://')) {
      for(const name of Object.keys(details.requestHeaders)) if(name.toLowerCase()==='origin') details.requestHeaders[name]=new URL(details.url).origin.replace('http:','https:');
      callback({requestHeaders:details.requestHeaders});
    } else callback({cancel:true});
  });
  try {
    await window.loadURL(process.argv[4]);
    await evaluate(`new Promise((resolve,reject)=>{const until=performance.now()+5000;const check=()=>{
      if(document.querySelector('#live-preview iframe'))resolve();
      else if(performance.now()>until)reject(Error('client did not initialize: '+JSON.stringify({meta:document.querySelector('meta[name="casmate-preview"]')?.outerHTML,body:document.body.textContent.slice(0,250),width:document.querySelector('#screen-section')?.clientWidth,hidden:document.hidden})));else setTimeout(check,20);
    };check();})`);
    const captures = join(process.cwd(), 'captures');
    await mkdir(captures, {recursive:true});
    for (const zoom of [1, 1.5]) {
    if(zoom!==1) {
      // Native zoom is checked in a fresh window, without device emulation history.
      const previous=window;window=createWindow(false);previous.destroy();await window.loadURL(process.argv[4]);
      window.webContents.setZoomFactor(zoom);
      assert.equal(window.webContents.getZoomFactor(),zoom);
    }
    for (const width of (zoom===1?[320,390,560,760,1200,1920]:[760,1200])) {
      const physicalWidth=Math.round(width*zoom);
      window.setContentSize(Math.max(400,physicalWidth),1100);
      if(zoom===1)window.webContents.enableDeviceEmulation({screenPosition:'desktop',screenSize:{width:physicalWidth,height:1100},viewSize:{width:physicalWidth,height:1100},deviceScaleFactor:1,scale:1});
      await painted();
      const expectedViewport=zoom===1?width:window.getContentSize()[0]/zoom;
      const checkLayout = async wide => {
        const result = await evaluate(`(()=>{
          const stage=document.querySelector('#live-preview').hidden?document.querySelector('#screen-stage'):document.querySelector('#live-preview');
          const notice=document.querySelector('.reaction-feedback'),caption=document.querySelector('.screen-caption');
          const image=stage.getBoundingClientRect(),box=notice.getBoundingClientRect();
          const range=document.createRange();range.selectNodeContents(caption.firstElementChild);
          return {viewport:innerWidth,scroll:document.documentElement.scrollWidth,overflow:document.documentElement.scrollWidth>innerWidth,
            overflowing:[...document.querySelectorAll('body *')].filter(n=>n.checkVisibility()&&n.getBoundingClientRect().right>innerWidth+1).map(n=>({tag:n.tagName,id:n.id,cls:n.className,right:n.getBoundingClientRect().right})),
            gap:image.top-box.bottom,rightGap:image.right-box.right,liveControls:!document.querySelector('#live-preview-controls').hidden,
            captionFits:range.getBoundingClientRect().bottom<=caption.getBoundingClientRect().bottom+1,
            below:document.querySelector('.location-actions').getBoundingClientRect().top>=range.getBoundingClientRect().bottom};
        })()`);
        assert.equal(result.overflow,false,JSON.stringify({width,zoom,wide,result}));
        assert.ok(Math.abs(result.viewport-expectedViewport)<2,`exercise the requested viewport and native zoom: ${JSON.stringify({width,zoom,wide,result})}`);
        assert.ok(result.gap>=0&&result.gap<(result.liveControls?80:20),`result stays above preview and its controls: ${JSON.stringify({width,zoom,wide,result})}`);
        assert.ok(Math.abs(result.rightGap-(wide?16:0))<1,'result tracks preview right edge');
        assert.equal(result.captionFits,true,`caption overflows at ${JSON.stringify({width,zoom,wide,result})}`);
        assert.equal(result.below,true,'caption never overlaps the next heading');
      };
      await checkLayout(false);
      const geometry = "[...document.querySelectorAll('#live-preview,#screen-stage,.point-toolbar button,.reaction-actions button,#character-reactions button')].filter(n=>n.checkVisibility()).map(n=>{const r=n.getBoundingClientRect();return [r.x,r.y,r.width,r.height];})";
      const before=await evaluate(geometry);
      for(const state of ['pending','success','error','unknown']) {
        await evaluate(`(()=>{document.querySelector('.reaction-feedback').dataset.state=${JSON.stringify(state)};
          document.querySelector('#status').textContent=${JSON.stringify(state==='error'?'送信できません：少し待ってください。'.repeat(30):state==='unknown'?'送信結果を確認できません。接続を確認してください。自動では再送しません。':state==='pending'?'送信中…':'ハートを送りました')};})()`);
        assert.deepEqual(await evaluate(geometry),before,'result states never move the preview or controls');
      }
      if(zoom===1&&[320,1200].includes(width)) {
        await painted();
        await writeFile(join(captures,`listener-${width}.png`),(await window.webContents.capturePage()).toPNG());
      }
      await evaluate("document.querySelector('#preview-width-toggle').click()");await painted();
      await checkLayout(true);
      await evaluate("document.querySelector('#preview-width-toggle').click()");await painted();
    }
    }
    window.webContents.focus();
    await evaluate("document.querySelector('#status').textContent='送信できません。'.repeat(100);document.querySelector('#status').focus()");
    await evaluate("document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'End',bubbles:true,cancelable:true}))");
    const scrolling=await evaluate("(()=>{const s=document.querySelector('#status');return {focused:document.activeElement.id,top:s.scrollTop,height:s.clientHeight,content:s.scrollHeight,hasFocus:document.hasFocus()};})()");
    assert.equal(scrolling.focused==='status'&&scrolling.top>0,true,`long results can be read with the keyboard: ${JSON.stringify(scrolling)}`);
    console.log('PASS: responsive listener feedback, captions, zoom and keyboard scrolling');
    window.destroy();app.exit(0);
  } catch(error) {console.error(error);console.error(JSON.stringify(requests));window.destroy();app.exit(1);}
});
