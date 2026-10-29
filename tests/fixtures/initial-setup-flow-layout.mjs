import { app, BrowserWindow } from 'electron';
import { join } from 'node:path';
import { writeFile } from 'node:fs/promises';
import { verifyInitialSetupFlow } from './initial-setup-flow-checks.mjs';
app.disableHardwareAcceleration();app.setPath('userData',join(process.argv[3],'profile'));
app.whenReady().then(async()=>{
 const window=new BrowserWindow({show:false,width:1040,height:820,webPreferences:{contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});window.setMenuBarVisibility(false);
 try {await window.loadFile(process.argv[2]);window.webContents.focus();await verifyInitialSetupFlow({evaluate:code=>window.webContents.executeJavaScript(code),resize:async(w,h)=>{window.setContentSize(w,h);await new Promise(resolve=>setTimeout(resolve,150));},capture:async name=>{await writeFile(join(process.argv[4],name),(await window.webContents.capturePage()).toPNG());}});console.log('PASS: initial setup complete flow');}
 catch(error){console.error(error);process.exitCode=1;}finally{window.destroy();app.quit();}
});
