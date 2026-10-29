import { app, BrowserWindow } from 'electron';
import { join } from 'node:path';
import { writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { verifyApplicationSettings } from './application-settings-checks.mjs';
app.disableHardwareAcceleration();
app.setPath('userData',join(process.argv[3],'profile'));
app.whenReady().then(async()=>{
  const window=new BrowserWindow({show:false,width:1024,height:760,webPreferences:{contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});
  const requests=[];window.webContents.session.webRequest.onBeforeRequest((d,cb)=>{if(/^https?:/.test(d.url))requests.push(d.url);cb({cancel:/^https?:/.test(d.url)})});
  try {
    await window.loadFile(process.argv[2]);
    const evaluate=code=>window.webContents.executeJavaScript(code);
    const settle=()=>new Promise(resolve=>setTimeout(resolve,90));
    const count=await verifyApplicationSettings({evaluate,settle,resize:async(w,h)=>{window.setContentSize(w,h);await settle()},capture:async name=>{await evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');await writeFile(join(process.argv[4],name),(await window.webContents.capturePage()).toPNG())},pressKey:async key=>{window.webContents.sendInputEvent({type:'keyDown',keyCode:key});window.webContents.sendInputEvent({type:'char',keyCode:'\r'});window.webContents.sendInputEvent({type:'keyUp',keyCode:key})}});
    assert.deepEqual(requests,[]);console.log(`PASS: ${count} application settings checks`);app.exit(0);
  }catch(error){console.error(error);app.exit(1);}
});
