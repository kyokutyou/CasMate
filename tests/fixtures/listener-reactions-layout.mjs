import assert from 'node:assert/strict';
import { app, BrowserWindow } from 'electron';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
app.disableHardwareAcceleration();app.setPath('userData',join(process.argv[3],'profile'));
app.whenReady().then(async()=>{
  const window=new BrowserWindow({show:false,width:1200,height:820,useContentSize:true,webPreferences:{contextIsolation:true,nodeIntegration:false,backgroundThrottling:false,spellcheck:false}});
  const evaluate=code=>window.webContents.executeJavaScript(code,true);
  const frames=()=>evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
    const desktopState=state=>evaluate(`new Promise((resolve,reject)=>{
      window.reactionDesktopState(${JSON.stringify(state)});
      const deadline=performance.now()+3000;
      const check=()=>{if(document.querySelector('.reaction-resume-panel').dataset.state===${JSON.stringify(state==='scene'?'paused':state)})resolve();else if(performance.now()>deadline)reject(new Error('desktop state timeout'));else requestAnimationFrame(check);};
      check();
    })`);
  try{
    await window.loadURL(pathToFileURL(process.argv[2]).href);
    await evaluate("document.querySelector('[data-page=settings]').click();document.getElementById('settings-listenerReactions').click()");await frames();
    for(const theme of ['ocean','pearl']) for(const text of ['medium','large']) for(const [width,height] of [[320,760],[420,760],[480,760],[560,760],[760,560],[1200,820]]){
      await evaluate(`window.reactionLayoutUpdate(${JSON.stringify(theme)},${JSON.stringify(text)})`);window.setContentSize(width,height);await frames();
      assert.equal(await evaluate('document.documentElement.scrollWidth>innerWidth'),false,`page overflow ${width}`);
      const overflowing=await evaluate(`(() => {
        const panel=document.querySelector('.reaction-settings');
        if(panel.scrollWidth<=panel.clientWidth+1)return [];
        const right=panel.getBoundingClientRect().right;
        return ['panel',...Array.from(panel.querySelectorAll('*')).filter(node=>node.getBoundingClientRect().right>right+1).map(node=>node.className||node.tagName)];
      })()`);
      assert.deepEqual(overflowing,[],`panel overflow ${width} ${theme} ${text}`);
    }
    await evaluate("window.reactionLayoutUpdate('ocean','medium')");await frames();
    const geometry="[...document.querySelectorAll('.reaction-settings button,.reaction-settings input,.reaction-settings select')].filter(n=>n.checkVisibility()).map(n=>{const r=n.getBoundingClientRect();return [r.x,r.y,r.width,r.height]})";
    await evaluate("window.publishButton=[...document.querySelectorAll('button')].find(n=>n.textContent==='リスナーページを公開');window.publishButton.focus()");await frames();
    await evaluate("document.querySelector('.reaction-publication details').open=true");await frames();
    const before=await evaluate(geometry);await evaluate('window.publishButton.click()');await frames();await frames();
    assert.deepEqual(await evaluate(geometry),before,'publication feedback moves controls');
    assert.equal(await evaluate("document.activeElement===window.publishButton"),true,'focus retained');
    assert.equal(await evaluate("document.querySelector('.reaction-url-slot a').textContent"),'https://aaaaaaaaaaaaaaaaaaaaaaaaaa.srv.us/','share link is available without opening QR');
    assert.equal(await evaluate("getComputedStyle(document.querySelector('.reaction-range-border')).borderTopColor"),'rgb(255, 77, 79)');
    const markers=await evaluate('window.reactionMarkerComparison()');
    const actualFrames=await evaluate('window.reactionMarkerFrames()');
    const approvedFrames=JSON.parse(await readFile(new URL('./reaction-point-sample-reference.json',import.meta.url),'utf8'));
    assert.equal(actualFrames.length,approvedFrames.length);
    for(let i=0;i<approvedFrames.length;i++){
      const actual=actualFrames[i],expected=approvedFrames[i];
      for(const key of ['fade','radius','progress','stroke','waveOpacity'])assert.ok(Math.abs(actual[key]-expected[key])<.000001,`approved sample ${expected.intent} ${expected.age}ms ${key}`);
      assert.equal(actual.clusterTransform,expected.clusterTransform,'approved label entrance');assert.equal(actual.bubbleTransform,expected.bubbleTransform,'approved label bounce');
    }
    for(const marker of markers){assert.ok(Math.abs(marker.font/marker.width-(14*1920/736)/marker.canvas)<.0002,'marker font ratio');assert.ok(Math.abs(marker.dot/marker.width-(50*1920/736)/marker.canvas)<.0002,'marker dot ratio');assert.ok(Math.abs(marker.label/marker.font-markers[0].label/markers[0].font)<.02,'listener/OBS/desktop label ratio');}
    await evaluate('window.reactionRangePreview()');
    await evaluate(`new Promise((resolve,reject)=>{const deadline=performance.now()+5000;const check=()=>{if(document.querySelector('.reaction-range-preview img'))resolve();else if(performance.now()>deadline)reject(new Error('preview image timeout'));else requestAnimationFrame(check);};check();})`);
    await desktopState('showing');
    const restarted = await evaluate(`(async()=>{
      const image=()=>document.querySelector('.reaction-range-preview img');
      const nativeDecode=HTMLImageElement.prototype.decode;
      let release;
      HTMLImageElement.prototype.decode=function(){
        if (!release) return new Promise(resolve=>{release=resolve;});
        return nativeDecode.call(this);
      };
      const waitFor=async (condition,message)=>{
        const deadline=performance.now()+2500;
        while(!condition()){if(performance.now()>deadline)throw new Error(message);await new Promise(r=>requestAnimationFrame(r));}
      };
      try {
        await waitFor(()=>release,'old decode did not start');
        const oldUrl=image()?.src;
        window.reactionRangePreview(1);
        [...document.querySelectorAll('button')].find(n=>n.textContent==='PC表示を停止').click();
        await waitFor(()=>image()?.complete&&image().naturalWidth===640&&image().src!==oldUrl,'new preview waited for the obsolete decode');
        const replacement=image().src;
        release();
        await new Promise(r=>requestAnimationFrame(r));
        return image()?.src===replacement;
      } finally { release?.(); HTMLImageElement.prototype.decode=nativeDecode; }
    })()`);
    assert.equal(restarted,true,'old decode never replaces the new preview');
    await evaluate('window.reactionRangePreview()');
    for(const width of [320,1200]){
      window.setContentSize(width,820);await frames();
      await evaluate("document.querySelector('.reaction-range-preview').scrollIntoView({block:'center'})");await frames();
      const rect=await evaluate("(()=>{const r=document.querySelector('.reaction-range-preview').getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};})()");
      const start={x:Math.round(rect.x+rect.width*.2),y:Math.round(rect.y+rect.height*.2)},end={x:Math.round(rect.x+rect.width*.7),y:Math.round(rect.y+rect.height*.8)};
      window.webContents.sendInputEvent({type:'mouseMove',...start});window.webContents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,...start});window.webContents.sendInputEvent({type:'mouseMove',...end});await frames();
      const border=await evaluate("(()=>{const r=document.querySelector('.reaction-range-border').getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};})()");
      assert.ok(Math.abs(border.x-start.x)<2&&Math.abs(border.y-start.y)<2,'red preview follows the pressed pointer');
      assert.ok(Math.abs(border.width-(end.x-start.x))<2&&Math.abs(border.height-(end.y-start.y))<2,'red preview has the dragged size before release');
      if(process.argv[4]){await mkdir(process.argv[4],{recursive:true});await writeFile(join(process.argv[4],`drag-${width}.png`),(await window.webContents.capturePage()).toPNG());}
      window.webContents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,...end});await frames();
    }
    for(const width of [320,1200]){
      window.setContentSize(width,820);await frames();
      await evaluate("document.querySelector('button[aria-controls=reaction-preview-tools]').click(); document.querySelector('.reaction-preview-viewport').scrollIntoView({block:'center'})");await frames();
      const preview=await evaluate(`(() => {
        const viewport=document.querySelector('.reaction-preview-viewport'), image=viewport.firstElementChild;
        const bounds=viewport.getBoundingClientRect();
        return { x:Math.round(bounds.left+60), y:Math.round(bounds.top+60), width:image.offsetWidth, visible:viewport.clientWidth, scroll:viewport.scrollLeft };
      })()`);
      assert.ok(preview.width >= preview.visible * 1.45,'preview zoom increases the image width');
      const border=await evaluate("document.querySelector('.reaction-range-border').getAttribute('style')");
      await evaluate("document.querySelector('#reaction-preview-tools button').click()");
      window.webContents.sendInputEvent({type:'mouseMove',x:preview.x,y:preview.y});
      window.webContents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,x:preview.x,y:preview.y});
      window.webContents.sendInputEvent({type:'mouseMove',x:preview.x-30,y:preview.y});
      window.webContents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,x:preview.x-30,y:preview.y});await frames();
      assert.ok(await evaluate("document.querySelector('.reaction-preview-viewport').scrollLeft") > preview.scroll,'pan moves the image');
      assert.equal(await evaluate("document.querySelector('.reaction-range-border').getAttribute('style')"),border,'pan preserves the range');
      assert.equal(await evaluate("document.querySelector('.reaction-settings').scrollWidth>document.querySelector('.reaction-settings').clientWidth+1"),false,'zoom does not overflow the panel');
      if(process.argv[4])await writeFile(join(process.argv[4],`zoom-${width}.png`),(await window.webContents.capturePage()).toPNG());
      await evaluate("document.querySelector('button[aria-controls=reaction-preview-tools]').click()");await frames();
    }
    for(const width of [320,1200]){
      window.setContentSize(width,820);await frames();
      await desktopState('stopped');
      await evaluate("document.querySelector('.reaction-resume-panel').scrollIntoView({block:'center'});document.querySelector('.reaction-resume-panel button').focus()");await frames();
      const before=await evaluate(geometry),scroll=await evaluate('document.scrollingElement.scrollTop');
      const markStyle=()=>evaluate("(()=>{const style=getComputedStyle(document.querySelector('.reaction-state-mark'));return [style.backgroundColor,style.borderRadius];})()");
      const idle=await markStyle();
      assert.equal(idle[1],'2px');
      await desktopState('showing');await frames();
      const showing=await markStyle();
      assert.notEqual(showing[0],idle[0]);
      assert.equal(showing[1],'50%');
      assert.deepEqual(await evaluate(geometry),before,'showing must not move controls');
      await desktopState('scene');await frames();
      assert.deepEqual(await evaluate(geometry),before,'scene waiting must not move controls');
      assert.equal(await evaluate('document.scrollingElement.scrollTop'),scroll,'scene waiting keeps scrolling');
      assert.equal(await evaluate("document.activeElement===document.querySelector('.reaction-resume-panel button')"),true,'scene waiting keeps focus');
      await desktopState('confirmation');await frames();
      assert.deepEqual(await evaluate(geometry),before,'confirmation must not move controls');assert.equal(await evaluate('document.scrollingElement.scrollTop'),scroll,'confirmation keeps scrolling');
      assert.equal(await evaluate("document.activeElement===document.querySelector('.reaction-resume-panel button')"),true,'confirmation keeps focus');
      assert.equal(await evaluate('document.documentElement.scrollWidth>innerWidth'),false,'confirmation fits narrow screen');
      if(process.argv[4])await writeFile(join(process.argv[4],`resume-${width}.png`),(await window.webContents.capturePage()).toPNG());
    }
    const previewStatus = '#reaction-preview-save-status';
    const waitForPreviewStatus = text => evaluate(`new Promise((resolve,reject)=>{
      const deadline=performance.now()+5000;
      const check=()=>{if(document.querySelector('${previewStatus}').textContent.includes(${JSON.stringify(text)}))resolve();
        else if(performance.now()>deadline)reject(new Error('preview status timeout'));else requestAnimationFrame(check);};
      check();
    })`);
    const selectPreview = mode => evaluate(`(() => {
      const select=document.querySelector('.reaction-publication select');
      select.value=${JSON.stringify(mode)};
      select.dispatchEvent(new Event('change',{bubbles:true}));
    })()`);
    const inputPreview = value => evaluate(`(() => {
      const input=document.querySelector('.reaction-publication input[inputmode=url]');
      const setValue=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;
      input.focus();
      setValue.call(input,${JSON.stringify(value)});
      input.dispatchEvent(new Event('input',{bubbles:true}));
    })()`);
    await selectPreview('youtube');
    await inputPreview('invalid');
    await waitForPreviewStatus('配信URL・LIVE ID・@ハンドルを入力してください');
    for (const width of [320,1200]) {
      window.setContentSize(width,820);
      await evaluate("window.reactionLayoutUpdate('pearl','large')");await frames();
      const before = await evaluate(geometry);
      await inputPreview('https://www.youtube.com/live/abcdefghijk');
      await waitForPreviewStatus('保存中です');
      assert.deepEqual(await evaluate(geometry),before,'preview save progress must not move controls');
      await evaluate("window.reactionFinishPreviewSave('映像設定の保存に失敗しました。'.repeat(12))");
      await waitForPreviewStatus('保存に失敗しました');
      assert.deepEqual(await evaluate(geometry),before,'preview save error must not move controls');
      assert.equal(await evaluate("document.activeElement===document.querySelector('.reaction-publication input[inputmode=url]')"),true,'preview save retains focus');
      assert.equal(await evaluate('document.documentElement.scrollWidth>innerWidth'),false,'preview setting fits narrow screen');
      await inputPreview('invalid');
      await waitForPreviewStatus('配信URL・LIVE ID・@ハンドルを入力してください');
    }
    await inputPreview('https://www.youtube.com/live/abcdefghijk');
    await waitForPreviewStatus('保存中です');
    await evaluate('window.reactionFinishPreviewSave()');
    await waitForPreviewStatus('未入力の場合');
    if(process.argv[4]){await mkdir(process.argv[4],{recursive:true});await writeFile(join(process.argv[4],'management.png'),(await window.webContents.capturePage()).toPNG());}
    console.log('PASS: reactions layouts and stable action feedback');window.destroy();app.exit(0);
  }catch(error){console.error(error);window.destroy();app.exit(1);}
});
