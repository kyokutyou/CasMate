import {app,BrowserWindow} from 'electron';
import {join} from 'node:path';
import {verifyInitialSetupEntryUpdates} from './initial-setup-entry-checks.mjs';
app.disableHardwareAcceleration();
app.setPath('userData',join(process.argv[3],'profile'));
app.whenReady().then(async()=>{
  const window=new BrowserWindow({show:false,width:1040,height:820,webPreferences:{contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});
  window.setMenuBarVisibility(false);
  try {
    await window.loadFile(process.argv[2]);
    window.webContents.focus();
    await verifyInitialSetupEntryUpdates({evaluate:code=>window.webContents.executeJavaScript(code),resize:async(width,height)=>{
      window.webContents.setZoomFactor(1);window.setContentSize(width,height);
      // Windows can constrain a hidden window to the display work area.
      if(width>1100)window.webContents.setZoomFactor(window.getContentSize()[0]/width);
    }});
    console.log('PASS: entry result updates and C sample width');
  } catch(error){console.error(error);process.exitCode=1;}
  finally{window.destroy();app.quit();}
});
