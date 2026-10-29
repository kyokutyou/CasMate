import { app, BrowserWindow } from 'electron';
import { join } from 'node:path';
import { writeFile } from 'node:fs/promises';
import { verifyUiClarity } from './ui-clarity-checks.mjs';

app.disableHardwareAcceleration();
app.setPath('userData', join(process.argv[3], 'profile'));
app.whenReady().then(async () => {
  const window = new BrowserWindow({show:false,minWidth:320,minHeight:360,width:1200,height:820,webPreferences:{backgroundThrottling:false}});
  const requests=[];
  window.webContents.on('console-message', details => { if(details.level==='error') console.error(details.message); });
  window.webContents.on('render-process-gone', (_event, details) => console.error('Renderer gone', details));
  window.webContents.session.webRequest.onBeforeRequest((details,callback)=>{if(/^https?:/.test(details.url))requests.push(details.url);callback({cancel:/^https?:/.test(details.url)});});
  try {
    console.log('Loading',process.argv[2]);
    await window.loadFile(process.argv[2], process.argv[2].endsWith('comments.html') ? {query:{window:'independent'}} : {});
    console.log('Loaded');
    const verify = process.argv.includes('--startup-error-only') ? (await import('./startup-error-checks.mjs')).verifyStartupError : verifyUiClarity;
    const count=await verify({evaluate:code=>window.webContents.executeJavaScript(code),resize:async(width,height)=>{window.webContents.setZoomFactor(width===320?1.25:1);if(width===320)window.setSize(320,360);else window.setContentSize(width,height);},render:async()=>{window.webContents.invalidate();await window.webContents.capturePage(undefined,{stayHidden:true});},capture:async name=>{console.log('Capture',name);await window.webContents.capturePage(undefined,{stayHidden:true});await writeFile(join(process.argv[4],name),(await window.webContents.capturePage(undefined,{stayHidden:true})).toPNG());}});
    if(requests.length)throw new Error('Unexpected network request');
    console.log(`PASS: ${count} UI clarity scenarios; zero HTTP(S) requests`);
  } catch(error){console.error(error);process.exitCode=1;}finally{window.destroy();app.quit();}
});
