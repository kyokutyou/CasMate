import assert from 'node:assert/strict';
import { app, BrowserWindow } from 'electron';
import { join } from 'node:path';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
app.disableHardwareAcceleration();
app.setPath('userData', join(process.argv[3], 'profile'));
app.whenReady().then(async () => {
  const window = new BrowserWindow({ show: false, width: 1200, height: 820, useContentSize: true, webPreferences: { contextIsolation: true, nodeIntegration: false, spellcheck: false, backgroundThrottling: false } });
  window.webContents.on('console-message',details=>{if(details.level==='error')console.error(details.message);});
  const liveMode = new URL(process.argv[4]).searchParams.get('fixtureMode');
  if (liveMode) {
    try {
      const { verifyLivePreview } = await import('./listener-reactions-live-preview.mjs');
      await verifyLivePreview(window, process.argv[4], liveMode);
      console.log(`PASS: ${liveMode} preview layout`);
      window.destroy(); app.exit(0);
    } catch (error) { console.error(error); window.destroy(); app.exit(1); }
    return;
  }
  let stylesheets = 0, scripts = 0;
  window.webContents.session.webRequest.onBeforeRequest({ urls: ['http://127.0.0.1/*'] }, (details, callback) => {
    if (details.resourceType === 'stylesheet') { stylesheets++; callback({ cancel: true }); }
    else if (details.resourceType === 'script') { scripts++; setTimeout(() => callback({ cancel: true }), 1500); }
    else callback({});
  });
  try {
    await window.webContents.session.clearCache();
    await window.loadURL(process.argv[4]);
    const firstPaintBounds = new Map();
    for (const width of [1200, 320]) {
      window.setContentSize(width, 820);
      const result = await window.webContents.executeJavaScript(`new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve({
        radius:getComputedStyle(document.querySelector('.panel')).borderRadius,
        background:getComputedStyle(document.body).backgroundImage,
        color:getComputedStyle(document.documentElement).color,
        overflow:document.documentElement.scrollWidth>innerWidth,
        pending:document.querySelector('#screen-status').textContent,
        stageHeight:document.querySelector('#screen-stage').getBoundingClientRect().height,
        feedbackTop:document.querySelector('.reaction-feedback').getBoundingClientRect().top
      }))))`);
      assert.equal(result.radius, '20px', 'unstyled panel must never be the initial design');
      assert.match(result.background, /radial-gradient/u);
      assert.equal(result.color, 'rgb(245, 243, 255)');
      assert.equal(result.overflow, false);
      assert.equal(result.pending, '画像を取得しています…', 'client script has not initialized');
      firstPaintBounds.set(width, { stageHeight:result.stageHeight, feedbackTop:result.feedbackTop });
    }
    assert.equal(stylesheets, 0, 'design must not need a stylesheet round trip');
    assert.ok(scripts > 0, 'secondary script delay was exercised');
    window.webContents.session.webRequest.onBeforeRequest(null);
    // Emulate production HTTPS origins on the disposable loopback HTTP server.
    window.webContents.session.webRequest.onBeforeSendHeaders({urls:['http://127.0.0.1/*']},(details,callback)=>{
      for(const key of Object.keys(details.requestHeaders))if(key.toLowerCase()==='origin')details.requestHeaders[key]=new URL(details.url).origin.replace('http:','https:');
      callback({requestHeaders:details.requestHeaders});
    });
    await window.loadURL(process.argv[4]);
    for (const width of [1200, 320]) {
      window.setContentSize(width, 820);
      const bounds = await window.webContents.executeJavaScript(`new Promise((resolve,reject)=>{
        const until=performance.now()+4000;
        const measure=()=>{
          if(document.querySelector('#screen-status').textContent==='画像を取得しています…'){
            if(performance.now()>until)reject(new Error('initial frame response was not rendered'));
            else requestAnimationFrame(measure);
            return;
          }
          resolve({stageHeight:document.querySelector('#screen-stage').getBoundingClientRect().height,feedbackTop:document.querySelector('.reaction-feedback').getBoundingClientRect().top});
        };
        requestAnimationFrame(measure);
      })`);
      assert.deepEqual(firstPaintBounds.get(width), bounds, `the first image request must not move the controls at ${width}px`);
    }
    const hold=await window.webContents.executeJavaScript(`(async()=>{
      const button=document.querySelector('#cheer-hold'),hint=document.querySelector('#hold-hint'),before=hint.getBoundingClientRect().height;
      if(document.hidden)throw new Error('fixture must run in foreground visibility');
      const fetch=window.fetch,notice=document.querySelector('.reaction-feedback');
      const sent=[];let finishSecond;
      const accepted={ok:true,status:200,json:async()=>({message:'リアクションを受け付けました。'})};
      window.fetch=(url,options)=>{
        if(url!=='/react')return fetch(url,options);
        sent.push(JSON.parse(options.body));
        return sent.length===2?new Promise(resolve=>{finishSecond=()=>resolve(accepted);}):Promise.resolve(accepted);
      };
      button.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));
      button.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',repeat:true,bubbles:true,cancelable:true}));button.click();
      const until=performance.now()+5000;while(sent.length<2&&performance.now()<until)await new Promise(r=>setTimeout(r,20));
      const others=[...document.querySelectorAll('[data-kind]')];
      const running=button.getAttribute('aria-pressed')==='true',othersBlocked=others.every(b=>b.getAttribute('aria-disabled')==='true'),after=hint.getBoundingClientRect().height;
      for(const other of others)other.click();
      const continued={feedback:notice.dataset.state,hint:hint.textContent};
      finishSecond?.();
      button.dispatchEvent(new KeyboardEvent('keyup',{key:'Enter',bubbles:true,cancelable:true}));const count=sent.length;
      await new Promise(r=>setTimeout(r,1300));
      return {sent,count,running,others:othersBlocked,before,after,continued,stopped:button.getAttribute('aria-pressed')==='false',overflow:document.documentElement.scrollWidth>innerWidth};
    })()`);
    assert.equal(hold.count,2,'key repeat and generated click must not duplicate cheer requests');assert.equal(hold.sent.length,2,'release must prevent further requests');assert.ok(hold.sent.every(value=>JSON.stringify(value)==='{"kind":"cheer"}'));
    assert.equal(hold.running,true);assert.equal(hold.others,true);assert.equal(hold.stopped,true);assert.equal(hold.before,hold.after,'hold feedback must not move the controls');assert.equal(hold.overflow,false);
    const reactionButtonStyle = () => window.webContents.executeJavaScript(`(()=>{
      const button=document.querySelector('[data-kind=heart]');
      return {radius:getComputedStyle(button).borderRadius,iconMargin:getComputedStyle(button.firstElementChild).marginBottom,height:button.getBoundingClientRect().height};
    })()`);
    const waitingButtonStyle = await reactionButtonStyle();
    const jpeg=(await readFile(new URL('./obs-program-black.jpg',import.meta.url))).toString('base64');
    await window.webContents.executeJavaScript(`(()=>{
      window.previewOutcome='success';const previous=window.fetch;
      window.fetch=async(url,options)=>{
        if(url==='/frame')return {ok:true,status:200,json:async()=>({id:'layout',instance:'original',generation:1,canvasWidth:1920,canvasHeight:1080,capturedAt:Date.now(),validForMs:12000,url:'/layout.jpg'})};
        if(url==='/layout.jpg')return {ok:true,blob:async()=>new Blob([Uint8Array.from(atob('${jpeg}'),c=>c.charCodeAt(0))],{type:'image/jpeg'})};
        if(url==='/react') {if(window.previewOutcome==='unknown')throw new Error('offline');return {ok:window.previewOutcome==='success',status:window.previewOutcome==='success'?200:429,json:async()=>({message:'少し待ってください。'.repeat(18)})};}
        return previous(url,options);
      };return new Promise((resolve,reject)=>{const until=performance.now()+4000;const check=()=>document.querySelector('#screen-stage img')?resolve():performance.now()>until?reject(new Error('layout image unavailable')):setTimeout(check,20);check();});
    })()`);
    const displayedButtonStyle = await reactionButtonStyle();
    const focus = await window.webContents.executeJavaScript(`(async()=>{
      const button=document.querySelector('[data-kind=heart]'),previous=window.fetch;
      const accepted={ok:true,status:200,json:async()=>({message:'リアクションを受け付けました。'})};
      let sent=0,finish;
      window.fetch=(url,options)=>{
        if(url!=='/react')return previous(url,options);
        return ++sent===1?new Promise(resolve=>{finish=()=>resolve(accepted);}):Promise.resolve(accepted);
      };
      const tick=ms=>new Promise(resolve=>setTimeout(resolve,ms));
      const focused=()=>document.activeElement===button;
      try{
        button.focus();
        const before=focused();
        document.activeElement.click();
        await tick(25);
        const during=focused();
        button.click();
        const pendingSent=sent;
        finish();
        await tick(850);
        const after=focused();
        document.activeElement.click();
        await tick(850);
        return {before,during,after,pendingSent,sent};
      }finally{window.fetch=previous;}
    })()`);
    assert.deepEqual({style:displayedButtonStyle,focus},{
      style:waitingButtonStyle,
      focus:{before:true,during:true,after:true,pendingSent:1,sent:2}
    },'the first image must keep reaction button styles, and submission must keep keyboard focus');
    for(const width of [320,560,1040]){
      window.setContentSize(width,820);
      for(const [id,intent] of [['point-tool','look'],['question-tool','question'],['danger-tool','danger']]){
        const preview=await window.webContents.executeJavaScript(`(async()=>{
          const button=document.getElementById('${id}'),stage=document.querySelector('#screen-stage');button.click();
          const r=stage.getBoundingClientRect();stage.dispatchEvent(new MouseEvent('pointermove',{clientX:r.left+r.width*.6,clientY:r.top+r.height*.5}));
          await new Promise(resolve=>setTimeout(resolve,700));
          const marker=stage.querySelector('.marker-preview'),label=marker?.querySelector('.point-label'),box=label?.getBoundingClientRect();
          return {intent:marker?.dataset.intent,text:label?.textContent,inside:box&&box.left>=r.left&&box.right<=r.right,transparent:marker&&getComputedStyle(marker.querySelector('.point-dot')).backgroundColor,opacity:marker&&getComputedStyle(marker).opacity,animation:label&&getComputedStyle(label).animationName};
        })()`);
        assert.equal(preview.intent,intent);assert.equal(preview.inside,true);assert.equal(preview.transparent,'rgba(0, 0, 0, 0)');assert.equal(preview.opacity,'0.5');assert.equal(preview.animation,'none');
        const captures=fileURLToPath(new URL('../../tmp/listener-page-design/',import.meta.url));await mkdir(captures,{recursive:true});
        await writeFile(join(captures,`point-preview-${intent}-${width}.png`),(await window.webContents.capturePage()).toPNG());
        await window.webContents.executeJavaScript(`document.getElementById('${id}').click()`);
      }
      const arrowPreview=await window.webContents.executeJavaScript(`(async()=>{const b=document.querySelector('#arrow-tool'),s=document.querySelector('#screen-stage');b.click();const r=s.getBoundingClientRect();s.dispatchEvent(new MouseEvent('pointermove',{clientX:r.left+r.width*.65,clientY:r.top+r.height*.5}));await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));const n=s.querySelector('.arrow-preview'),l=n?.querySelector('.arrow-label'),box=l?.getBoundingClientRect();return {phase:n?.dataset.phase,text:l?.textContent,inside:box&&box.left>=r.left&&box.right<=r.right,overflow:document.documentElement.scrollWidth>innerWidth,hint:getComputedStyle(document.querySelector('#arrow-hint')).display};})()`);
      assert.deepEqual(arrowPreview,{phase:'preview',text:'こっち！',inside:true,overflow:false,hint:'block'});
      const arrowCaptures=fileURLToPath(new URL('../../tmp/listener-page-design/',import.meta.url));await writeFile(join(arrowCaptures,`arrow-preview-${width}.png`),(await window.webContents.capturePage()).toPNG());
      await window.webContents.executeJavaScript("document.querySelector('#arrow-tool').click()");
      if(width===1040){
        const timeout=await window.webContents.executeJavaScript(`(async()=>{const b=document.querySelector('#arrow-tool'),s=document.querySelector('#screen-stage'),hint=document.querySelector('#arrow-hint'),slot=document.querySelector('.tool-instructions'),nativeTimeout=window.setTimeout;const before=slot.getBoundingClientRect().height;let accelerated=false;window.setTimeout=(fn,ms,...args)=>nativeTimeout(fn,ms===10000?(accelerated=true,30):ms,...args);try{b.click();s.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));await new Promise(r=>nativeTimeout(r,80));return {accelerated,selected:b.getAttribute('aria-pressed'),visible:getComputedStyle(hint).display,text:hint.textContent,sameHeight:slot.getBoundingClientRect().height===before};}finally{window.setTimeout=nativeTimeout;}})()`);
        assert.equal(timeout.accelerated,true);assert.equal(timeout.selected,'false');assert.equal(timeout.visible,'block');assert.match(timeout.text,/時間切れ/u);assert.equal(timeout.sameHeight,true,'timeout feedback keeps the instruction slot fixed');
      }
      const layout=await window.webContents.executeJavaScript(`(async()=>{
        const pause=ms=>new Promise(r=>setTimeout(r,ms));await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
        const screen=document.querySelector('#screen-stage'),notice=document.querySelector('.reaction-feedback'),tools=document.querySelector('.point-toolbar');
        const initial={notice:notice.getBoundingClientRect().height,tools:tools.getBoundingClientRect().top,frameTop:screen.getBoundingClientRect().top,noticeBottom:notice.getBoundingClientRect().bottom,frameRight:screen.getBoundingClientRect().right,noticeRight:notice.getBoundingClientRect().right};
        document.querySelector('#point-tool').click();screen.dispatchEvent(new MouseEvent('click',{bubbles:true,clientX:screen.getBoundingClientRect().left+50,clientY:screen.getBoundingClientRect().top+30}));await pause(30);
        const success={text:document.querySelector('#status').textContent,state:notice.dataset.state,background:getComputedStyle(notice).backgroundColor,icon:notice.querySelector('.feedback-icon').textContent};
        await pause(850);window.previewOutcome='error';document.querySelector('[data-kind=heart]').click();await pause(30);
        const error={state:notice.dataset.state,scroll:document.querySelector('#status').scrollHeight>document.querySelector('#status').clientHeight,height:notice.getBoundingClientRect().height,tools:tools.getBoundingClientRect().top,frameTop:screen.getBoundingClientRect().top};
        await pause(850);window.previewOutcome='unknown';document.querySelector('[data-kind=clap]').click();await pause(30);
        const unknown={state:notice.dataset.state,text:document.querySelector('#status').textContent};window.previewOutcome='success';await pause(850);
        return {initial,success,error,unknown,overflow:document.documentElement.scrollWidth>innerWidth,helpClosed:!document.querySelector('.listener-help').open};
      })()`);
      assert.equal(layout.success.text,'場所を送りました');assert.equal(layout.success.state,'success');assert.equal(layout.success.icon,'✓');assert.equal(layout.error.state,'error');assert.equal(layout.unknown.state,'unknown');
      assert.ok(layout.initial.noticeBottom<=layout.initial.frameTop);assert.ok(layout.initial.frameTop-layout.initial.noticeBottom<20,'result belongs immediately above the image');
      assert.ok(Math.abs(layout.initial.noticeRight-layout.initial.frameRight)<1,'result aligns with the preview right edge');
      assert.equal(layout.error.frameTop,layout.initial.frameTop,'long results must not move the preview');
      assert.equal(layout.error.height,layout.initial.notice);assert.equal(layout.error.tools,layout.initial.tools,'long results must not move tools');assert.equal(layout.error.scroll,true);assert.equal(layout.overflow,false);assert.equal(layout.helpClosed,true);
      const captures=fileURLToPath(new URL('../../tmp/listener-page-design/',import.meta.url));await mkdir(captures,{recursive:true});await writeFile(join(captures,`listener-${width}.png`),(await window.webContents.capturePage()).toPNG());
      const expanded=await window.webContents.executeJavaScript(`(async()=>{
        const stage=document.querySelector('#screen-stage'),normal=stage.getBoundingClientRect().width;
        document.querySelector('#preview-width-toggle').click();
        await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
        const rect=stage.getBoundingClientRect();
        return {normal,width:rect.width,ratio:rect.width/rect.height,viewport:document.documentElement.clientWidth,scroll:document.documentElement.scrollWidth};
      })()`);
      assert.ok(expanded.width>expanded.normal && Math.abs(expanded.width-expanded.viewport)<1);
      assert.ok(expanded.scroll<=expanded.viewport);assert.ok(Math.abs(expanded.ratio-16/9)<.01);
      await writeFile(join(captures,`listener-wide-${width}.png`),(await window.webContents.capturePage()).toPNG());
      await window.webContents.executeJavaScript(`(async()=>{document.querySelector('#preview-width-toggle').click();await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));})()`);
    }
    window.setContentSize(320,820);
    const wide = await window.webContents.executeJavaScript(`(async()=>{
      const previous=window.fetch;
      window.fetch=async(url,options)=>{
        if(url==='/frame')return {ok:true,status:200,json:async()=>({id:'wide',instance:'original',generation:2,canvasWidth:3840,canvasHeight:540,capturedAt:Date.now(),validForMs:12000,url:'/wide.jpg'})};
        if(url==='/wide.jpg')return {ok:true,blob:async()=>new Blob(['<svg xmlns="http://www.w3.org/2000/svg" width="640" height="90"></svg>'],{type:'image/svg+xml'})};
        return previous(url,options);
      };
      const stage=document.querySelector('#screen-stage'),until=performance.now()+4000;
      while(stage.querySelector('img')?.naturalWidth!==640){if(performance.now()>until)throw new Error('wide image unavailable');await new Promise(r=>setTimeout(r,20));}
      const bounds=selector=>{const r=stage.querySelector(selector).getBoundingClientRect();return [r.top,r.height];};
      return {image:bounds('img'),points:bounds('.local-markers'),areas:bounds('.area-layer')};
    })()`);
    assert.ok(wide.image[1]<100,'the narrow layout exercises the former minimum height');
    assert.deepEqual(wide.points,wide.image,'point coordinates use the actual wide image bounds');
    assert.deepEqual(wide.areas,wide.image,'area coordinates use the actual wide image bounds');
    for (const width of [320, 560, 1040]) {
      window.setContentSize(width,820);
      const transition=await window.webContents.executeJavaScript(`(async()=>{
        const stage=document.querySelector('#screen-stage'),tools=document.querySelector('.point-toolbar');
        const previous=window.fetch;
        let unavailable=true;
        window.fetch=async(url,options)=>{
          if(url!=='/frame')return previous(url,options);
          if(unavailable)return {ok:false,status:503,headers:new Headers({'X-CasMate-Frame-State':'unavailable'})};
          const response=await previous(url,options),frame=await response.json();
          return {...response,json:async()=>({...frame,id:'recovered-${width}'})};
        };
        const bounds=()=>[stage.getBoundingClientRect().height,tools.getBoundingClientRect().top];
        const waitFor=async(hasImage)=>{
          const deadline=performance.now()+4000;
          while(!!stage.querySelector('img')!==hasImage){if(performance.now()>deadline)throw new Error('frame transition timeout');await new Promise(r=>setTimeout(r,20));}
        };
        try {
          const ready=bounds();await waitFor(false);const waiting=bounds();
          unavailable=false;await waitFor(true);return {ready,waiting,recovered:bounds()};
        } finally {window.fetch=previous;}
      })()`);
      assert.deepEqual(transition.waiting,transition.ready,`waiting must keep the image and tool layout at ${width}px`);
      assert.deepEqual(transition.recovered,transition.ready,`recovery must keep the image and tool layout at ${width}px`);
    }
    let newerRetirementPreserved;
    for (const [newGeneration,code,confirmedGeneration,keepImage,newInstance = 'original'] of [
      [3,undefined,undefined,true], [2,'FRAME_RETIRED',2,true], [2,'FRAME_RETIRED',undefined,false],
      [2,undefined,undefined,false], [3,'FRAME_RETIRED',2,true], [3,'FRAME_RETIRED',4,false],
      [1,'FRAME_RETIRED',4,true,'restarted'],
    ]) {
    const staleResponse=await window.webContents.executeJavaScript(`(async()=>{
      const stage=document.querySelector('#screen-stage'),notice=document.querySelector('.reaction-feedback');
      const previous=window.fetch;
      let changeScene=false,respond;
      window.fetch=async(url,options)=>{
        if(url==='/react')return new Promise(resolve=>{respond=resolve;});
        if(url==='/frame'&&changeScene)return {ok:true,status:200,json:async()=>({id:'replacement',instance:${JSON.stringify(newInstance)},generation:${newGeneration},canvasWidth:3840,canvasHeight:540,capturedAt:Date.now(),validForMs:12000,url:'/replacement.jpg'})};
        if(url==='/replacement.jpg')return {ok:true,blob:async()=>new Blob(['<svg xmlns="http://www.w3.org/2000/svg" width="320" height="45"></svg>'],{type:'image/svg+xml'})};
        return previous(url,options);
      };
      const waitFor=async(predicate)=>{
        const deadline=performance.now()+4000;
        while(!predicate()){if(performance.now()>deadline)throw new Error('reaction transition timeout');await new Promise(r=>setTimeout(r,20));}
      };
      try{
        const tool=document.querySelector('#point-tool');
        await waitFor(()=>!tool.disabled&&stage.querySelector('img')?.naturalWidth===640);
        tool.click();
        const {left,top,width,height}=stage.getBoundingClientRect();
        stage.dispatchEvent(new MouseEvent('click',{bubbles:true,clientX:left+width/2,clientY:top+height/2}));
        await waitFor(()=>respond);
        changeScene=true;
        await waitFor(()=>stage.querySelector('img')?.naturalWidth===320);
        const latest=stage.querySelector('img');
        respond({ok:false,status:409,json:async()=>({message:'画像が古くなりました。',code:${JSON.stringify(code)},instance:'original',generation:${JSON.stringify(confirmedGeneration)}})});
        await waitFor(()=>notice.dataset.state==='error');
        return {imagePreserved:stage.querySelector('img')===latest,message:document.querySelector('#status').textContent};
      }finally{window.fetch=previous;}
    })()`);
    assert.equal(staleResponse.message,'送信できません：画像が古くなりました。');
    if (confirmedGeneration === 4 && newInstance === 'original') newerRetirementPreserved = staleResponse.imagePreserved;
    else assert.equal(staleResponse.imagePreserved,keepImage,`delayed rejection: image source ${newInstance}, generation ${newGeneration}, response ${code} ${confirmedGeneration}`);
    }
    const downloading = await window.webContents.executeJavaScript(`(async()=>{
      const stage=document.querySelector('#screen-stage'),notice=document.querySelector('.reaction-feedback');
      const previous=window.fetch;
      let changeScene=false,respond,finish,downloads=0,aborts=0;
      const replacement={ok:true,blob:async()=>new Blob(['<svg xmlns="http://www.w3.org/2000/svg" width="320" height="45"></svg>'],{type:'image/svg+xml'})};
      window.fetch=async(url,options)=>{
        if(url==='/react')return new Promise(resolve=>{respond=resolve;});
        if(url==='/frame'&&changeScene)return {ok:true,status:200,json:async()=>({id:'downloading',instance:'original',generation:2,canvasWidth:3840,canvasHeight:540,capturedAt:Date.now(),validForMs:12000,url:'/downloading.jpg'})};
        if(url==='/downloading.jpg'){
          if(++downloads>1)return replacement;
          return new Promise((resolve,reject)=>{
            finish=()=>resolve(replacement);
            options.signal.addEventListener('abort',()=>{aborts++;reject(new Error('aborted'));},{once:true});
          });
        }
        return previous(url,options);
      };
      const waitFor=async(predicate)=>{
        const deadline=performance.now()+4000;
        while(!predicate()){if(performance.now()>deadline)throw new Error('pending image transition timeout');await new Promise(r=>setTimeout(r,20));}
      };
      try{
        const tool=document.querySelector('#point-tool');
        await waitFor(()=>!tool.disabled&&stage.querySelector('img')?.naturalWidth===640);
        tool.click();
        const {left,top,width,height}=stage.getBoundingClientRect();
        stage.dispatchEvent(new MouseEvent('click',{bubbles:true,clientX:left+width/2,clientY:top+height/2}));
        await waitFor(()=>respond);
        changeScene=true;
        await waitFor(()=>finish);
        respond({ok:false,status:409,json:async()=>({message:'画像が古くなりました。',code:'FRAME_RETIRED',instance:'original',generation:2})});
        await waitFor(()=>notice.dataset.state==='error');
        const retiredImageGone=stage.querySelector('img')?.naturalWidth!==640;
        finish();
        await waitFor(()=>stage.querySelector('img')?.naturalWidth===320);
        return {retiredImageGone,downloads,aborts};
      }finally{finish?.();window.fetch=previous;}
    })()`);
    assert.deepEqual({ ...downloading,newerRetirementPreserved },{retiredImageGone:true,downloads:1,aborts:0,newerRetirementPreserved:false},
      'a rejection must retire older images and preserve a verified replacement download');
    assert.equal(hold.continued.feedback,'success','a later cheer pulse must preserve the accepted feedback');
    assert.match(hold.continued.hint,/^応援中！/u);
    console.log('PASS: styled public HTML without secondary assets');
    window.destroy(); app.exit(0);
  } catch (error) { console.error(error); window.destroy(); app.exit(1); }
});
