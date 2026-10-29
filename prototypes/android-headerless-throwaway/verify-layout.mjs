// Fictional UI only. Isolated Electron profile and working directory are required.
import { app, BrowserWindow } from 'electron';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
app.disableHardwareAcceleration();
app.setPath('userData',join(process.argv[3],'profile'));
app.whenReady().then(async()=>{
 const win=new BrowserWindow({show:false,width:736,height:1200,webPreferences:{offscreen:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});
 const run=code=>win.webContents.executeJavaScript(code);
 const pause=()=>new Promise(resolve=>setTimeout(resolve,65));
 const errors=[];win.webContents.on('console-message',detail=>{if(detail.level==='error')errors.push(detail.message);});
 const report=[];
 const measure=id=>`(()=>{const p=document.querySelector('[data-phone=${id}]'),m=p.querySelector('.hl-main'),dock=p.querySelector('.hl-dock');const r=n=>{const b=n.getBoundingClientRect();return [b.x,b.y,b.width,b.height];};return {viewport:innerWidth,outerOverflow:document.documentElement.scrollWidth>innerWidth+1,phoneOverflow:p.scrollWidth>p.clientWidth+1,body:r(m),footer:dock?r(dock):null,header:p.querySelector('header')!==null,small:[...p.querySelectorAll('button')].filter(b=>b.checkVisibility()).filter(b=>b.getBoundingClientRect().width<47||b.getBoundingClientRect().height<47).map(b=>b.textContent),outside:[...p.querySelectorAll('button')].filter(b=>b.checkVisibility()).filter(b=>b.getBoundingClientRect().left<p.getBoundingClientRect().left||b.getBoundingClientRect().right>p.getBoundingClientRect().right+1).map(b=>b.textContent)};})()`;
 try{
  await mkdir(process.argv[3],{recursive:true});await win.loadFile(process.argv[2]);
  for(const width of [320,400,736]){
   win.setContentSize(width,1200);await pause();
   for(const id of ['A','B','C']){
    await run(`for(const p of document.querySelectorAll('[data-design]'))p.hidden=p.dataset.design!=='${id}';`);
    for(const scale of [1,2])for(const appearance of ['light','dark'])for(const page of ['camera','comments']){
     await run(`window.casmateHeaderlessMock.setState({page:'${page}',scale:${scale},appearance:'${appearance}',connected:true,sending:true,listening:true,mute:false,video:true,broadcast:true});`);await pause();
     const baseline=await run(measure(id));const label=`${width}/${id}/${scale}/${appearance}/${page}`;
     assert.equal(baseline.outerOverflow,false,label+' outer overflow');assert.equal(baseline.phoneOverflow,false,label+' phone overflow');assert.equal(baseline.header,false,label+' no header');assert.deepEqual(baseline.small,[],label+' targets');assert.deepEqual(baseline.outside,[],label+' button bounds');assert.ok(baseline.body[3]>400,label+' reading area');
     await run('window.casmateHeaderlessMock.setState({connected:false});');assert.deepEqual(await run(measure(id)),baseline,label+' offline stability');
     await run('window.casmateHeaderlessMock.setState({connected:true});');
     if(page==='comments'){
      assert.equal(await run(`Boolean(document.querySelector('[data-phone=${id}] [data-action=send],[data-phone=${id}] [data-action=obs],[data-phone=${id}] [data-action=mic]'))`),false,label+' functional separation');
      if(id!=='C'){await run(`document.querySelector('[data-phone=${id}] [data-action=read]').click()`);assert.deepEqual(await run(measure(id)),baseline,label+' reading stability');}
     }
     await run(`document.querySelector('[data-phone=${id}] [data-action=menu]').click();`);
     for(const target of ['settings','connection','details']){
      await run(`document.querySelector('[data-phone=${id}] .hl-sheet [data-action=${target}]').click();`);
      assert.equal(await run(`(()=>{const s=document.querySelector('[data-phone=${id}] .hl-sheet');return s&&s.scrollWidth<=s.clientWidth+1;})()`),true,label+' sheet '+target);
      assert.equal(await run('document.activeElement.closest(".hl-sheet")!==null'),true,label+' dialog focus');
      await run(`document.querySelector('[data-phone=${id}] [data-action=close]').click();document.querySelector('[data-phone=${id}] [data-action=menu]').click();`);
     }
     if(page==='camera'){
      await run(`document.querySelector('[data-phone=${id}] .hl-sheet [data-action=obs]').click();`);assert.equal(await run('window.casmateHeaderlessMock.getState().broadcast'),true,label+' OBS waits');
      await run(`document.querySelector('[data-phone=${id}] [data-action=close]').click();`);
      if(id==='C')await run(`document.querySelector('[data-phone=${id}] [data-action=menu]').click();`);
      await run(`document.querySelector('[data-phone=${id}] [data-action=send]').click();`);assert.equal(await run('window.casmateHeaderlessMock.getState().sending'),true,label+' sender waits');
      await run(`document.querySelector('[data-phone=${id}] [data-action=confirm]').click();`);
      assert.deepEqual(await run('(({sending,broadcast,listening})=>({sending,broadcast,listening}))(window.casmateHeaderlessMock.getState())'),{sending:false,broadcast:true,listening:true},label+' sender isolation');
     }else await run(`document.querySelector('[data-phone=${id}] [data-action=close]').click();`);
     await run('window.casmateHeaderlessMock.setState({sending:true,listening:true});');await pause();
     if(width===736&&scale===1&&appearance==='light'||width===320&&scale===2&&appearance==='light')await writeFile(join(process.argv[3],`${id}-${page}-${width}-${scale}.png`),(await win.webContents.capturePage()).toPNG());
     report.push({id,page,scale,appearance,...baseline});
    }
   }
  }
  win.setContentSize(736,1200);await run(`for(const p of document.querySelectorAll('[data-design]'))p.hidden=p.dataset.design!=='B';window.casmateHeaderlessMock.setState({page:'camera',scale:1,appearance:'light'});`);await pause();
  const drag=async(dx,dy)=>{await run('window.getSelection()?.removeAllRanges()');const origin=await run(`(()=>{const r=document.querySelector('[data-phone=B] .hl-main').getBoundingClientRect();return {x:Math.round(r.x+r.width*.65),y:Math.round(r.y+200)};})()`);win.webContents.sendInputEvent({type:'mouseDown',...origin,button:'left',clickCount:1});win.webContents.sendInputEvent({type:'mouseMove',x:origin.x+dx,y:origin.y+dy});win.webContents.sendInputEvent({type:'mouseUp',x:origin.x+dx,y:origin.y+dy,button:'left',clickCount:1});await pause();};
  win.webContents.focus();await drag(-100,1);assert.equal(await run('window.casmateHeaderlessMock.getState().page'),'comments','native left flick');
  await drag(100,1);assert.equal(await run('window.casmateHeaderlessMock.getState().page'),'camera','native right flick');
  await drag(-3,80);assert.equal(await run('window.casmateHeaderlessMock.getState().page'),'camera','vertical gesture');
  assert.deepEqual(errors,[],'console errors');await writeFile(join(process.argv[3],'geometry.json'),JSON.stringify(report,null,2));
  console.log(`PASS: ${report.length} headerless layouts; stable offline/reading states, functional separation, dialogs, confirmations and native flick.`);win.close();app.exit(0);
 }catch(error){console.error(error);win.close();app.exit(1);}
});
