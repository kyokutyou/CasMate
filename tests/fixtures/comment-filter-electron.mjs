import { app, BrowserWindow } from 'electron';
import { join } from 'node:path';
import { writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { verifyCommentFilter } from './comment-filter-checks.mjs';
app.disableHardwareAcceleration();
app.setPath('userData',join(process.argv[3],'profile'));
app.whenReady().then(async()=>{
  const window=new BrowserWindow({show:false,width:1024,height:760,webPreferences:{contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});
  const requests=[];window.webContents.session.webRequest.onBeforeRequest((d,cb)=>{if(/^https?:/.test(d.url))requests.push(d.url);cb({cancel:/^https?:/.test(d.url)})});
  try {
    await window.loadFile(process.argv[2]);
    const evaluate=code=>window.webContents.executeJavaScript(code);
    const settle=()=>new Promise(resolve=>setTimeout(resolve,90));
    const resize=async(w,h)=>{
      window.setContentSize(w,h);
      const deadline=Date.now()+5000;
      while(await evaluate('innerWidth')!==w){if(Date.now()>deadline)throw new Error('Viewport did not resize');await new Promise(r=>setTimeout(r,20))}
      await settle();
    };
    const count=await verifyCommentFilter({evaluate,settle,resize,capture:async name=>{await evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');await writeFile(join(process.argv[4],name),(await window.webContents.capturePage()).toPNG())},pressKey:async key=>{window.webContents.sendInputEvent({type:'keyDown',keyCode:key});window.webContents.sendInputEvent({type:'char',keyCode:'\r'});window.webContents.sendInputEvent({type:'keyUp',keyCode:key})}});
    window.setSize(320,360);
    for(const zoom of [1,1.25,1.5]) {
      window.webContents.setZoomFactor(zoom);await settle();
      assert.equal(await evaluate("(()=>{const b=document.querySelector('.management-body');return b.clientHeight>0&&b.scrollWidth<=b.clientWidth})()"),true,'minimum window and zoom fit');
    }
    assert.deepEqual(requests,[]);console.log(`PASS: ${count} comment filter checks`);app.exit(0);
  }catch(error){console.error(error);app.exit(1);}
});
