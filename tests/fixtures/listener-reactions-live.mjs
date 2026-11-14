// Explicit, read-only local OBS/Windows check. No publishing and no user settings writes.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { app, safeStorage } from 'electron';
const require=createRequire(import.meta.url), root=process.argv[2];
const {ObsControlController}=require(join(root,'dist-electron/main/obs/obs-control-controller.js'));
const {validateObsControlRecord}=require(join(root,'dist-electron/main/obs/obs-control-store.js'));
const {ReactionFrames}=require(join(root,'dist-electron/main/reactions/reaction-frames.js'));
const {ReactionController}=require(join(root,'dist-electron/main/reactions/reaction-controller.js'));
const {NativeReactionDesktop}=require(join(root,'dist-electron/main/reactions/reaction-desktop.js'));
const {defaultReactionSettings}=require(join(root,'dist-electron/shared/listener-reactions.js'));
app.setPath('userData',join(process.argv[3],'profile'));
app.whenReady().then(async()=>{
  let obs, controller, desktop, stage='credentials';
  try{
    if(process.argv.includes('--windows-only')) {
      desktop=new NativeReactionDesktop(join(root,'resources','reactions'),()=>{throw new Error('No rendering window');}); desktop.demand(true);
      const deadline=Date.now()+10000;while(desktop.inventory().observedAt===0){if(Date.now()>deadline)throw new Error('Windows tracking timed out');await new Promise(resolve=>setTimeout(resolve,100));}
      assert.ok(desktop.inventory().windows.length>0);await desktop.close();console.log('PASS: native Windows window tracking and owned helper shutdown');app.exit(0);return;
    }
    const bytes=await readFile(join(app.getPath('appData'),'CasMate','obs-control.protected'));
    const record=validateObsControlRecord(JSON.parse(safeStorage.decryptString(bytes)));
    record.settings={...record.settings,enabled:true,voiceEnabled:false,androidEnabled:false};
    stage='OBS connection';obs=new ObsControlController({store:{load:async()=>record,save:async()=>{throw new Error('Read-only fixture');}}});await obs.start();await obs.retry();
    const frames=new ReactionFrames(()=>obs.visualReader('background'));
    desktop=new NativeReactionDesktop(join(root,'resources','reactions'),()=>{throw new Error('This fixture never opens a rendering window');});
    controller=new ReactionController({load:async()=>defaultReactionSettings(),save:async()=>{throw new Error('Read-only fixture');}},frames,()=>obs.visualReader('background'),desktop);await controller.initialize();
    stage='OBS capture';await frames.tick();const frame=frames.metadata();assert.ok(frame,'OBS capture failed');assert.ok(Math.max(frame.width,frame.height)<=640);assert.ok(frames.get(frame.id).bytes.length<=2*1024*1024);
    stage='reaction acceptance';controller.setOnline(true);await controller.react({kind:'heart'});await controller.react({kind:'clap'});await controller.react({kind:'point',frameId:frame.id,x:.5,y:.5});
    stage='Windows tracking';controller.preview();const deadline=Date.now()+10000;while(desktop.inventory().observedAt===0){if(Date.now()>deadline)throw new Error('Windows tracking timed out');await new Promise(resolve=>setTimeout(resolve,100));}
    assert.ok(desktop.inventory().windows.length>0);
    const localFrameId=frames.metadata()?.id;
    controller.setOnline(false);assert.equal(controller.publicView().frame,null);assert.equal(frames.metadata()?.id,localFrameId);await controller.shutdown();controller=null;await obs.stop();obs=null;
    console.log(`PASS: live OBS ${frame.width}x${frame.height}, three reactions, Windows tracking and owned helper shutdown`);app.exit(0);
  }catch(error){console.error(`Local OBS/Windows check failed at ${stage}: ${error instanceof assert.AssertionError ? error.message : error?.name || 'Error'}`);await controller?.shutdown();if(!controller)await desktop?.close();await obs?.stop();app.exit(1);}
});
