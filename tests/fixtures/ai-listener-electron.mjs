import { app, BrowserWindow } from 'electron';
import { join } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { verifyAiListener } from './ai-listener-checks.mjs';
app.disableHardwareAcceleration();
app.setPath('userData',join(process.argv[3],'profile'));
app.whenReady().then(async()=>{
  const window=new BrowserWindow({show:false,width:1024,height:760,webPreferences:{contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});
  const requests=[];window.webContents.session.webRequest.onBeforeRequest((d,cb)=>{if(/^https?:/.test(d.url))requests.push(d.url);cb({cancel:/^https?:/.test(d.url)})});
  try{
    await window.loadFile(process.argv[2]);
    window.webContents.focus();
    const evaluate=code=>window.webContents.executeJavaScript(code);
    const settle=()=>new Promise(resolve=>setTimeout(resolve,60));
    const resize=async(w,h)=>{window.setContentSize(w,h);await settle()};
    const count=await verifyAiListener({evaluate,resize,settle,capture:async name=>{await mkdir(process.argv[4],{recursive:true});await writeFile(join(process.argv[4],name),(await window.webContents.capturePage(undefined,{stayHidden:true,stayAwake:true})).toPNG())}});
    window.setSize(320,360);
    await evaluate("document.getElementById('ai-tab-behavior').click();aiLayoutHarness.update({requested:true,status:'paused',message:'OBS接続・配信状態の確認待ちです。'})");
    for(const zoom of [1,1.25,1.5]){window.webContents.setZoomFactor(zoom);await settle();const measurement=await evaluate("(()=>{const b=document.querySelector('.management-body');return {width:innerWidth,height:b.clientHeight,scroll:b.scrollWidth,client:b.clientWidth}})()");assert.ok(measurement.height>0&&measurement.scroll<=measurement.client,JSON.stringify({zoom,...measurement}));}
    assert.deepEqual(requests,[]);console.log(`PASS: ${count} AI listener UI scenarios`);app.exit(0);
  }catch(error){console.error(error);app.exit(1);}
});
