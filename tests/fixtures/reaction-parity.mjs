import assert from 'node:assert/strict';
import { app, BrowserWindow } from 'electron';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
app.disableHardwareAcceleration();app.setPath('userData',join(process.argv[3],'profile'));
app.whenReady().then(async()=>{
  const make=(width,height,preload)=>{const window=new BrowserWindow({show:false,width,height,useContentSize:true,webPreferences:{preload,contextIsolation:true,nodeIntegration:false,sandbox:true,spellcheck:false,backgroundThrottling:false,offscreen:true}});window.webContents.on('console-message',details=>{if(details.level==='error')console.error(details.message);});return window;};
  const obs=make(960,540),desktop=make(640,360,process.argv[4]);let preview;
  const run=async(window,code)=>{
    try{return await window.webContents.executeJavaScript(code,true);}
    catch(error){throw new Error(`Renderer check failed: ${code.slice(0,100)}`,{cause:error});}
  };
  const frames=window=>run(window,'new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
  try{
    await Promise.all([obs.loadURL(pathToFileURL(process.argv[2]).href),desktop.loadURL(pathToFileURL(process.argv[2]).href)]);
    await Promise.all([frames(obs),frames(desktop)]);
    for(const kind of ['heart','clap']){
      const event={instance:'parity',sequence:kind==='heart'?1:2,kind,at:Date.now()-400,accepting:true,pointingEnabled:true,counts:{heart:1,clap:1,point:0},frameGeneration:0,frame:{id:'frame',canvasWidth:1920,canvasHeight:1080,width:640,height:360,generation:0,capturedAt:Date.now(),validForMs:12000,url:'/frame.jpg'}};
      await run(obs,`window.pushReaction(${JSON.stringify({...event,sequence:event.sequence-1})},'snapshot')`);
      await run(obs,`window.pushReaction(${JSON.stringify(event)})`);desktop.webContents.send('reaction-particles',event);
      await Promise.all([frames(obs),frames(desktop)]);
      const inspect=`(()=>{const nodes=[...document.querySelectorAll('.reaction-particle')];const ages=nodes.map(n=>n.getAnimations()[0]?.currentTime);const samples=nodes.map(n=>{const a=n.getAnimations()[0];a.pause();const values=[0,30,1000].map(time=>{a.currentTime=time;const r=n.getBoundingClientRect();return {width:r.width,height:r.height,opacity:getComputedStyle(n).opacity};});a.currentTime=900;return values;});return {ages,samples,items:nodes.map(n=>({text:n.textContent,left:n.style.left,font:parseFloat(getComputedStyle(n).fontSize)/innerWidth}))};})()`;
      const a=await run(obs,inspect),b=await run(desktop,inspect);
      for(const surface of [a,b]){for(const samples of surface.samples){assert.ok(Math.abs(samples[0].width-samples[2].width)<.02,'particle width must stay fixed from spawn to one second');assert.ok(Math.abs(samples[0].height-samples[2].height)<.02);assert.ok(Math.abs(samples[1].width-samples[2].width)<.02);}assert.equal(surface.samples[4][0].opacity,'0','delayed particle must not flash before its animation');assert.equal(surface.samples[4][1].opacity,'0');}
      assert.equal(a.items.length,5);assert.equal(b.items.length,5);assert.deepEqual(a.items.map(i=>i.left),b.items.map(i=>i.left));
      assert.ok([...a.ages,...b.ages].every(age=>age>=400&&age<1800),'seek to event time rather than starting over');
      for(let i=0;i<5;i++){assert.equal(a.items[i].text,b.items[i].text);assert.ok(Math.abs(a.items[i].font-b.items[i].font)<0.00001);}
      if(kind==='heart'){
        for(const window of [obs,desktop])await run(window,"document.documentElement.style.background='#142132';document.body.style.background='linear-gradient(150deg,#23495b,#181c31)'");
        await Promise.all([frames(obs),frames(desktop)]);
        const images=await Promise.all([obs.webContents.capturePage(),desktop.webContents.capturePage()]);
        await mkdir(process.argv[5],{recursive:true});await writeFile(join(process.argv[5],'obs.png'),images[0].toPNG());await writeFile(join(process.argv[5],'desktop.png'),images[1].toPNG());
        preview=make(1240,570);
        const html=`<!doctype html><meta charset="utf-8"><style>body{margin:0;padding:24px;background:#101725;color:#eff5ff;font:20px "Segoe UI","Yu Gothic UI",sans-serif}h1{font-size:24px;margin:0 0 20px}main{display:flex;gap:24px;align-items:flex-start}section{width:576px}h2{font-size:18px}img{width:100%;border:1px solid #4c687e;border-radius:12px}p{font-size:15px;color:#afc5dc}</style><h1>同じリアクションを、OBSとPCに表示</h1><main><section><h2>OBS側</h2><img src="${images[0].toDataURL()}"><p>配信画面全体を使う演出</p></section><section><h2>配信者のPC側</h2><img src="${images[1].toDataURL()}"><p>同じ位置・比率・動きをPCの表示範囲に合わせる</p></section></main>`;
        await preview.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent(html));await frames(preview);await writeFile(join(process.argv[5],'comparison.png'),(await preview.webContents.capturePage()).toPNG());
      }
      await run(obs,`window.pushReaction(${JSON.stringify({...event,accepting:false})},'snapshot')`);desktop.webContents.send('reaction-clear');await Promise.all([frames(obs),frames(desktop)]);
      assert.equal(await run(obs,"document.querySelectorAll('.reaction-particle').length"),0);assert.equal(await run(desktop,"document.querySelectorAll('.reaction-particle').length"),0);
    }
    desktop.webContents.send('reaction-marker',{x:.01,y:.1,canvasWidth:960,region:{x:.25,y:.25,width:.5,height:.5}});
    await frames(desktop);
    const point=await run(desktop,`(()=>{const layer=document.querySelector('.reaction-markers'),label=layer.querySelector('.point-label'),dot=layer.querySelector('.point-dot'),r=layer.getBoundingClientRect(),c=document.querySelector('.reaction-overlay').getBoundingClientRect();return {canvas:{x:c.x,y:c.y,width:c.width,height:c.height},x:r.x,y:r.y,width:r.width,height:r.height,below:label.classList.contains('below'),labelLeft:label.getBoundingClientRect().left,labelTop:label.getBoundingClientRect().top,dotTop:dot.getBoundingClientRect().top};})()`);
    const expected={x:point.canvas.x+point.canvas.width*.25,y:point.canvas.y+point.canvas.height*.25,width:point.canvas.width*.5,height:point.canvas.height*.5};
    for(const key of ['x','y','width','height'])assert.ok(Math.abs(point[key]-expected[key])<.02,'game layer '+key);
    assert.equal(point.below,true,'point label keeps game-local vertical placement');assert.ok(point.labelLeft>=point.x,'point label keeps game-local edge clamp');assert.ok(point.labelTop>point.dotTop);
    const pointColors = `(() => {
      const dot = getComputedStyle(document.querySelector('.point-dot'));
      const label = getComputedStyle(document.querySelector('.point-label-body'));
      return { fill: dot.backgroundColor, border: getComputedStyle(document.querySelector('.point-ring')).stroke, label: label.backgroundColor };
    })()`;
    const obsPoint = { instance: 'point-parity', sequence: 2, kind: 'point', at: Date.now(), accepting: true,
      frameGeneration: 0, frame: { canvasWidth: 1920 }, x: .5, y: .5 };
    await run(obs, `window.pushReaction(${JSON.stringify(obsPoint)})`);
    assert.deepEqual(await run(desktop, pointColors), {
      fill: 'rgba(0, 0, 0, 0)', border: 'rgb(9, 125, 156)', label: 'rgba(255, 255, 255, 0.78)',
    });
    assert.deepEqual(await run(obs, pointColors), {
      fill: 'rgba(0, 0, 0, 0)', border: 'rgb(9, 125, 156)', label: 'rgba(255, 255, 255, 0.78)',
    });
    desktop.webContents.send('reaction-clear');await frames(desktop);assert.equal(await run(desktop,"document.querySelectorAll('.point-marker').length"),0);
    for(const region of [{x:-.25,y:-.25,width:.5,height:.5},{x:.875,y:0,width:.5,height:.5}]){
      const x=region.x<0?.75:.125,y=.5;
      desktop.webContents.send('reaction-marker',{x,y,canvasWidth:960,region});await frames(desktop);
      const mapped=await run(desktop,`(()=>{const c=document.querySelector('.reaction-overlay').getBoundingClientRect(),d=document.querySelector('.point-dot').getBoundingClientRect();return {width:c.width,height:c.height,x:(d.left+d.width/2-c.left)/c.width,y:(d.top+d.height/2-c.top)/c.height};})()`);
      assert.ok(Math.abs(mapped.x-(region.x+x*region.width))*mapped.width<1,'overflow point x');
      assert.ok(Math.abs(mapped.y-(region.y+y*region.height))*mapped.height<1,'overflow point y');
      desktop.webContents.send('reaction-clear');await frames(desktop);
    }
    for(const shape of ['ellipse','rectangle']){
      const event={instance:'area-parity',sequence:2,kind:'area',shape,area:{x:.1,y:.2,width:.4,height:.5},at:Date.now(),accepting:true,pointingEnabled:true,counts:{heart:0,clap:0,point:0,area:1},frameGeneration:1,frame:{id:'area',canvasWidth:1920,canvasHeight:1080,generation:1}};
      await run(obs,`window.pushReaction(${JSON.stringify({...event,sequence:1})},'snapshot')`);
      await run(obs,`window.pushReaction(${JSON.stringify(event)})`);desktop.webContents.send('reaction-particles',{...event,clip:{x:.25,y:0,width:.5,height:1}});await Promise.all([frames(obs),frames(desktop)]);
      const inspect=`(()=>{const n=document.querySelector('.range-outline'),r=n.getBoundingClientRect(),c=document.querySelector('.reaction-overlay').getBoundingClientRect();return {tag:n.tagName,x:(r.x-c.x)/c.width,y:(r.y-c.y)/c.height,width:r.width/c.width,height:r.height/c.height,stroke:parseFloat(getComputedStyle(n).strokeWidth)/c.width,fill:getComputedStyle(n).fill,clip:document.querySelector('.range-marker').style.clipPath};})()`;
      const a=await run(obs,inspect),b=await run(desktop,inspect);
      for(const key of ['x','y','width','height','stroke'])assert.ok(Math.abs(a[key]-b[key])<.0001,'area parity '+key+' '+JSON.stringify({a,b}));
      assert.equal(a.fill,'none');assert.equal(b.clip,'inset(0% 25%)');assert.equal(a.tag,shape==='ellipse'?'ellipse':'rect');assert.ok(Math.abs(a.width-.4)<.001);assert.ok(Math.abs(a.stroke-4/1920)<.0001);
      desktop.webContents.send('reaction-clear');await run(obs,`window.pushReaction(${JSON.stringify({...event,accepting:false})},'snapshot')`);await Promise.all([frames(obs),frames(desktop)]);assert.equal(await run(desktop,"document.querySelectorAll('.range-marker').length"),0);
    }
    {
      const event={instance:'cheer-parity',sequence:2,kind:'cheer',at:Date.now()-400,accepting:true,pointingEnabled:true,counts:{heart:0,clap:0,point:0,cheer:1},frameGeneration:2,frame:{id:'cheer',canvasWidth:1920,canvasHeight:1080,generation:2}};
      await run(obs,`window.pushReaction(${JSON.stringify({...event,sequence:1})},'snapshot')`);
      await run(obs,`window.pushReaction(${JSON.stringify(event)})`);desktop.webContents.send('reaction-particles',event);
      await run(desktop,`new Promise((resolve,reject)=>{const until=performance.now()+1000;const check=()=>document.querySelector('.reaction-cheer')?resolve():performance.now()>until?reject(new Error('native cheer not received')):setTimeout(check,5);check();})`);
      await Promise.all([frames(obs),frames(desktop)]);
      const inspect=`(()=>{const n=document.querySelector('.reaction-cheer');if(!n)return {missing:true,html:document.body.innerHTML};const c=document.querySelector('.reaction-overlay').getBoundingClientRect(),a=n.getAnimations()[0];return {count:document.querySelectorAll('.reaction-cheer').length,text:n.textContent,left:n.style.left,font:parseFloat(n.style.fontSize)/c.width,frames:a.effect.getKeyframes().map(f=>({transform:f.transform,opacity:f.opacity})),duration:a.effect.getTiming().duration,background:getComputedStyle(n).backgroundColor,nowrap:getComputedStyle(n).whiteSpace};})()`;
      const a=await run(obs,inspect),b=await run(desktop,inspect);
      assert.equal(a.count,1,JSON.stringify(a));assert.equal(b.count,1,JSON.stringify(b));assert.equal(a.text,'がんばれ！');assert.equal(b.text,a.text);assert.equal(a.left,b.left);assert.ok(Math.abs(a.font-36/1920)<.0001);assert.ok(Math.abs(a.font-b.font)<.0001);
      assert.equal(a.duration,2100);assert.equal(b.duration,2100);assert.ok(!JSON.stringify(a.frames).includes('scale('));assert.equal(a.background,b.background);assert.equal(a.nowrap,'nowrap');
      for(const window of [obs,desktop])assert.ok(await run(window,"Number(getComputedStyle(document.querySelector('.reaction-cheer')).opacity)>0"),'cheer must actually be visible');
      const captures=await Promise.all([obs.webContents.capturePage(),desktop.webContents.capturePage()]);await writeFile(join(process.argv[5],'cheer-obs.png'),captures[0].toPNG());await writeFile(join(process.argv[5],'cheer-desktop.png'),captures[1].toPNG());
      desktop.webContents.send('reaction-clear');await run(obs,`window.pushReaction(${JSON.stringify({...event,accepting:false})},'snapshot')`);await Promise.all([frames(obs),frames(desktop)]);
      assert.equal(await run(obs,"document.querySelectorAll('.reaction-cheer').length"),0);assert.equal(await run(desktop,"document.querySelectorAll('.reaction-cheer').length"),0);
    }
    {
      const fixed=Date.now();
      for(const window of [obs,desktop])await run(window,`window.__originalClock=Date.now;Date.now=()=>${fixed};true`);
      let sequence=100;
      for(const age of [-1,-100,-101,3000,4000]){
        const event={instance:'clock-skew',sequence:sequence++,kind:'area',shape:'ellipse',area:{x:.3,y:.4,width:.2,height:.2},at:fixed-age,accepting:true,frameGeneration:100,frame:{canvasWidth:1920}};
        await run(obs,`window.pushReaction(${JSON.stringify(event)})`);desktop.webContents.send('reaction-particles',event);
        await Promise.all([frames(obs),frames(desktop)]);
        const expected=age>=-100&&age<4000?1:0;
        for(const window of [obs,desktop])assert.equal(await run(window,"document.querySelectorAll('.range-marker').length"),expected,'area clock boundary '+age);
        desktop.webContents.send('reaction-clear');
        await run(obs,`document.querySelectorAll('.range-marker').forEach(node=>node.remove());true`);
        await frames(desktop);
      }
      for(const window of [obs,desktop])await run(window,'Date.now=window.__originalClock;true');
    }
    {
      const fixed=Date.now();await run(obs,`window.__originalClock=Date.now;Date.now=()=>${fixed};true`);
      for(const skew of [1,100,101]){
        const event={instance:'point-clock',sequence:500+skew,kind:'point',x:.5,y:.5,at:fixed+skew,accepting:true,frameGeneration:101,frame:{canvasWidth:1920}};
        await run(obs,`window.pushReaction(${JSON.stringify(event)})`);await frames(obs);
        assert.equal(await run(obs,"document.querySelectorAll('.point-marker').length"),skew<=100?1:0,'OBS point clock tolerance '+skew);
        await run(obs,"document.querySelectorAll('.point-marker').forEach(node=>node.remove());true");
      }
      await run(obs,'Date.now=window.__originalClock;true');
    }
    {
      const fixed=Date.now();for(const window of [obs,desktop])await run(window,`window.__originalClock=Date.now;Date.now=()=>${fixed};true`);
      let sequence=1000;
      for(const kind of ['heart','clap','cheer']){
        const event={instance:'particle-clock',sequence:sequence++,kind,at:fixed+1,accepting:true,frameGeneration:102,frame:{canvasWidth:1920}};
        await run(obs,`window.pushReaction(${JSON.stringify(event)})`);desktop.webContents.send('reaction-particles',event);await Promise.all([frames(obs),frames(desktop)]);
        for(const window of [obs,desktop])assert.equal(await run(window,"document.querySelectorAll('.reaction-particle').length"),kind==='cheer'?1:5,'native clock tolerance '+kind);
        desktop.webContents.send('reaction-clear');await run(obs,"document.querySelectorAll('.reaction-particle').forEach(node=>node.remove());true");await frames(desktop);
      }
      for(const window of [obs,desktop])await run(window,'Date.now=window.__originalClock;true');
    }
    {
      let sequence=2000;
      for(const age of [1000,3500,4000]){
        const event={instance:'point-expiry',sequence:sequence++,kind:'point',x:.5,y:.5,at:Date.now()-age,accepting:true,frameGeneration:103,frame:{canvasWidth:1920}};
        await run(obs,`window.pushReaction(${JSON.stringify(event)})`);await frames(obs);
        assert.equal(await run(obs,"document.querySelectorAll('.point-marker').length"),age<4000?1:0,'OBS point positive delay '+age);
        if(age<4000){await new Promise(resolve=>setTimeout(resolve,4100-age));assert.equal(await run(obs,"document.querySelectorAll('.point-marker').length"),0,'OBS point must not restart its four-second lifetime');}
      }
    }
    for(const [index,intent] of ['look','question','danger'].entries()){
      const event={instance:'intent-parity',sequence:3000+index,kind:'point',intent,x:.4,y:.55,at:Date.now()-700,accepting:true,frameGeneration:119,frame:{canvasWidth:1920}};
      await run(obs,`window.pushReaction(${JSON.stringify(event)})`);
      desktop.webContents.send('reaction-marker',{x:event.x,y:event.y,intent,at:event.at,canvasWidth:1920,region:{x:0,y:0,width:1,height:1}});
      await Promise.all([frames(obs),frames(desktop)]);
      const inspect=`(()=>{const n=document.querySelector('.point-marker'),dot=n.querySelector('.point-dot'),label=n.querySelector('.point-label');for(const child of [dot,label])child.style.animation='none';const r=dot.getBoundingClientRect();return {x:(r.x+r.width/2)/innerWidth,y:(r.y+r.height/2)/innerHeight,width:r.width/innerWidth,label:label.textContent,fill:getComputedStyle(dot).backgroundColor,intent:n.dataset.intent};})()`;
      const a=await run(obs,inspect),b=await run(desktop,inspect);
      for(const key of ['x','y','width'])assert.ok(Math.abs(a[key]-b[key])<.001,'point intent parity '+key);
      assert.equal(a.intent,intent);assert.equal(a.label,b.label);assert.equal(a.fill,'rgba(0, 0, 0, 0)');assert.ok(Math.abs(a.x-.4)<.001);assert.ok(Math.abs(a.y-.55)<.001);
      await writeFile(join(process.argv[5],'point-'+intent+'-obs.png'),(await obs.webContents.capturePage()).toPNG());
      desktop.webContents.send('reaction-clear');await run(obs,"document.querySelectorAll('.point-marker').forEach(node=>node.remove());true");await frames(desktop);
    }
    for(const [index,[from,to]] of [[{x:.2,y:.7},{x:.8,y:.25}],[{x:.8,y:.25},{x:.2,y:.7}],[{x:.2,y:.5},{x:.75,y:.5}],[{x:.5,y:.8},{x:.5,y:.2}]].entries()){
      const event={instance:'arrow-parity',sequence:4000+index,kind:'arrow',from,to,at:Date.now()-1600,accepting:true,frameGeneration:120,frame:{canvasWidth:1920,canvasHeight:1080}};
      await run(obs,`window.pushReaction(${JSON.stringify(event)})`);desktop.webContents.send('reaction-particles',{...event,clip:{x:.1,y:.1,width:.8,height:.8}});
      await Promise.all([frames(obs),frames(desktop)]);
      const inspect=`(()=>{const n=document.querySelector('.arrow-marker'),c=n.querySelector('canvas'),r=c.getBoundingClientRect(),l=n.querySelector('.arrow-label'),lr=l.getBoundingClientRect(),ctx=c.getContext('2d'),pixels=ctx.getImageData(0,0,c.width,c.height).data;let x0=c.width,y0=c.height,x1=-1,y1=-1;for(let y=0;y<c.height;y++)for(let x=0;x<c.width;x++)if(pixels[(y*c.width+x)*4+3]>10){x0=Math.min(x0,x);x1=Math.max(x1,x);y0=Math.min(y0,y);y1=Math.max(y1,y);}return {bounds:[x0/c.width,y0/c.height,x1/c.width,y1/c.height],label:[lr.left/innerWidth,lr.top/innerHeight,lr.width/innerWidth,lr.height/innerHeight],text:l.textContent,opacity:getComputedStyle(l).opacity,phase:n.dataset.phase,age:Number(n.dataset.elapsed),clip:n.style.clipPath,canvas:[r.width/innerWidth,r.height/innerHeight],color:(()=>{let best=0,color=[];for(let i=0;i<pixels.length;i+=4)if(pixels[i+3]>best){best=pixels[i+3];color=[...pixels.slice(i,i+3)];}return color;})()};})()`;
      const a=await run(obs,inspect),b=await run(desktop,inspect);
      for(const key of ['bounds','label','canvas'])for(let i=0;i<a[key].length;i++)assert.ok(Math.abs(a[key][i]-b[key][i])<.004,'arrow parity '+key+': '+JSON.stringify({a,b}));
      for(const result of [a,b]){assert.equal(result.phase,'hold');assert.equal(result.text,'こっち！');assert.equal(result.opacity,'1');assert.ok(result.age>=1600&&result.age<3400);assert.deepEqual(result.color,[35,123,144]);assert.ok(result.bounds[2]>result.bounds[0]);}
      assert.equal(a.clip,'');assert.match(b.clip,/inset/);
      if(index===0){await writeFile(join(process.argv[5],'arrow-obs.png'),(await obs.webContents.capturePage()).toPNG());await writeFile(join(process.argv[5],'arrow-desktop.png'),(await desktop.webContents.capturePage()).toPNG());}
      desktop.webContents.send('reaction-clear');await run(obs,`window.pushReaction(${JSON.stringify({...event,accepting:false})},'snapshot')`);await Promise.all([frames(obs),frames(desktop)]);
      for(const window of [obs,desktop])assert.equal(await run(window,"document.querySelectorAll('.arrow-marker').length"),0);
    }
    {
      const event={instance:'arrow-delayed',sequence:1,kind:'arrow',from:{x:.2,y:.7},to:{x:.8,y:.25},at:Date.now()-3500,accepting:true,frameGeneration:121,frame:{canvasWidth:1920,canvasHeight:1080}};
      await run(obs,`window.pushReaction(${JSON.stringify(event)})`);desktop.webContents.send('reaction-particles',event);await Promise.all([frames(obs),frames(desktop)]);
      for(const window of [obs,desktop])assert.ok(await run(window,"Number(document.querySelector('.arrow-marker')?.dataset.elapsed)>=3500"),'delayed arrow must seek, never start over');
      await new Promise(resolve=>setTimeout(resolve,520));for(const window of [obs,desktop])assert.equal(await run(window,"document.querySelectorAll('.arrow-marker').length"),0);
    }
    for(const sticker of ['surprise','confused','agree','scared','safe','danger','thanks','cheers','rest']){
      const event={instance:'sticker-'+sticker,sequence:2,kind:'sticker',sticker,stickerPlacement:{x:.11,y:.14,width:.38,height:.38},at:Date.now()-700,accepting:true,pointingEnabled:true,counts:{heart:0,clap:0,point:0},frameGeneration:120,frame:null};
      await run(obs,`window.pushReaction(${JSON.stringify({...event,sequence:1})},'snapshot')`);
      await run(obs,`window.pushReaction(${JSON.stringify(event)})`);desktop.webContents.send('reaction-particles',event);
      for(const window of [obs,desktop])await run(window,`new Promise((resolve,reject)=>{const end=performance.now()+2200;function check(){const c=document.querySelector('.reaction-sticker');if(c&&c.width&&c.getContext('2d').getImageData(0,0,c.width,c.height).data.some((v,i)=>i%4===3&&v>0))return resolve();if(performance.now()>end)return reject(new Error('Sticker did not render: ${sticker}'));requestAnimationFrame(check);}check();})`);
      const inspect="(()=>{const c=document.querySelector('.reaction-sticker'),r=c.getBoundingClientRect();return {ratio:r.width/innerWidth,aspect:r.width/r.height,left:r.left/innerWidth,top:r.top/innerHeight,label:c.getAttribute('aria-label')};})()";
      const a=await run(obs,inspect),b=await run(desktop,inspect);assert.ok(Math.abs(a.ratio-b.ratio)<.002);assert.ok(Math.abs(a.aspect-736/414)<.02);assert.equal(a.label,b.label);assert.ok(Math.abs(a.left-b.left)<.002);assert.ok(Math.abs(a.top-b.top)<.002);assert.ok(Math.abs(a.left-.11)<.002);assert.ok(Math.abs(a.top-.14)<.002);
      await Promise.all([frames(obs),frames(desktop)]);
      await writeFile(join(process.argv[5],'sticker-'+sticker+'.png'),(await obs.webContents.capturePage()).toPNG());
      desktop.webContents.send('reaction-clear');await run(obs,`window.pushReaction(${JSON.stringify({...event,accepting:false})},'snapshot')`);await Promise.all([frames(obs),frames(desktop)]);
      assert.equal(await run(obs,"document.querySelectorAll('.reaction-sticker').length"),0);assert.equal(await run(desktop,"document.querySelectorAll('.reaction-sticker').length"),0);
    }
    console.log('PASS: OBS and desktop particle parity');
    preview?.destroy();obs.destroy();desktop.destroy();app.exit(0);
  }catch(error){console.error(error);preview?.destroy();obs.destroy();desktop.destroy();app.exit(1);}
});
