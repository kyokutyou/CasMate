// Local fictional comparison only; never load CasMate or registered user state.
import { app, BrowserWindow } from 'electron';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
app.disableHardwareAcceleration();
app.setPath('userData', join(process.argv[3], 'profile'));
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show:false, width:736, height:1200, webPreferences:{offscreen:true, contextIsolation:true, nodeIntegration:false, backgroundThrottling:false} });
  const errors=[];
  win.webContents.on('console-message', detail=>{if(detail.level==='error')errors.push(detail.message);});
  const run=code=>win.webContents.executeJavaScript(code);
  const pause=()=>new Promise(resolve=>setTimeout(resolve,70));
  const report=[];
  try {
    await mkdir(process.argv[3],{recursive:true});
    await win.loadFile(process.argv[2]);
    for(const width of [320,400,736]) {
      win.setContentSize(width,1200);
      await pause();
      for(const id of ['A','B','C','R']) {
        await run(`for(const panel of document.querySelectorAll('[data-design]'))panel.hidden=panel.dataset.design!=='${id}';`);
        for(const scale of [1,2])for(const appearance of ['light','dark'])for(const page of ['camera','comments']) {
          await run(`window.casmateCompactMock.setState({page:'${page}',scale:${scale},appearance:'${appearance}',connected:true,sending:true,listening:true,video:true,mute:false,broadcast:true});`);
          await pause();
          const bounds=await run(`(()=>{const p=document.querySelector('[data-phone="${id}"]'),h=p.querySelector('.qc-header'),f=p.querySelector('.qc-footer'),m=p.querySelector('.qc-main');return {width:innerWidth,outerOverflow:document.documentElement.scrollWidth>innerWidth+1,phoneOverflow:p.scrollWidth>p.clientWidth+1,headerOverflow:h.scrollWidth>h.clientWidth+1,footerOverflow:f.scrollWidth>f.clientWidth+1,bodyHeight:m.clientHeight,headerHeight:h.offsetHeight+(p.querySelector('.qc-page-heading')?.offsetHeight||0),footerHeight:f.offsetHeight,footerY:f.getBoundingClientRect().y,smallButtons:[...p.querySelectorAll('button')].filter(x=>x.checkVisibility()).filter(x=>x.getBoundingClientRect().height<47||x.getBoundingClientRect().width<47).map(x=>({text:x.textContent,w:x.getBoundingClientRect().width,h:x.getBoundingClientRect().height}))};})()`);
          assert.equal(bounds.outerOverflow,false,`${width}/${id}/${scale}/${page}: outer overflow`);
          assert.equal(bounds.phoneOverflow,false,`${width}/${id}/${scale}/${page}: phone overflow`);
          assert.equal(bounds.headerOverflow,false,`${width}/${id}/${scale}/${page}: header overflow`);
          assert.equal(bounds.footerOverflow,false,`${width}/${id}/${scale}/${page}: footer overflow`);
          assert.ok(bounds.bodyHeight>150,`${width}/${id}/${scale}/${page}: body area`);
          assert.deepEqual(bounds.smallButtons,[],`${width}/${id}/${scale}/${page}: touch targets`);
          await run('window.casmateCompactMock.setState({connected:false});');
          const offline=await run(`(()=>{const p=document.querySelector('[data-phone="${id}"]');return {h:p.querySelector('.qc-header').offsetHeight+(p.querySelector('.qc-page-heading')?.offsetHeight||0),f:p.querySelector('.qc-footer').offsetHeight,y:p.querySelector('.qc-footer').getBoundingClientRect().y};})()`);
          assert.equal(offline.h,bounds.headerHeight,`${width}/${id}/${scale}/${page}: offline header shift`);
          assert.equal(offline.f,bounds.footerHeight,`${width}/${id}/${scale}/${page}: offline footer shift`);
          assert.equal(offline.y,bounds.footerY,`${width}/${id}/${scale}/${page}: offline footer position`);
          await run('window.casmateCompactMock.setState({connected:true});');
          report.push({id,page,scale,appearance,...bounds});
          if(width===736&&scale===1&&appearance==='light'||width===320&&scale===2&&id==='A'&&appearance==='light') {
            await pause();
            await writeFile(join(process.argv[3],`${id}-${page}-${width}-${scale}.png`),(await win.webContents.capturePage()).toPNG());
          }
          for(const action of ['settings','connection',...(page==='camera'?['send','obs']:[])]) {
            await run(`document.querySelector('[data-phone="${id}"] [data-action="${action}"]').click();`);
            assert.equal(await run(`(()=>{const s=document.querySelector('[data-phone="${id}"] .qc-sheet');return Boolean(s&&s.scrollWidth<=s.clientWidth+1);})()`),true,`${width}/${id}/${scale}/${page}/${action}: dialog fits`);
            assert.equal(await run("document.activeElement.closest('.qc-sheet')!==null"),true,'dialog focus');
            await run(`document.querySelector('[data-phone="${id}"] [data-action="close"]').click();`);
          }
          if(page==='comments') {
            assert.equal(await run(`Boolean(document.querySelector('[data-phone="${id}"] [data-action="send"],[data-phone="${id}"] [data-action="obs"]'))`),false);
            await run(`document.querySelector('[data-phone="${id}"] [data-action="read"]').click();`);
            assert.equal(await run(`document.querySelector('[data-phone="${id}"] .qc-footer').getBoundingClientRect().y`),bounds.footerY,'read state keeps footer');
          } else assert.equal(await run(`Boolean(document.querySelector('[data-phone="${id}"] [data-action="read"]'))`),false);
        }
      }
    }
    win.setContentSize(736,1200);
    await run(`for(const p of document.querySelectorAll('[data-design]'))p.hidden=p.dataset.design!=='A';window.casmateCompactMock.setState({page:'camera',scale:1,appearance:'light',connected:true,sending:true,broadcast:true,listening:true});`);
    await pause();
    await run("document.querySelector('[data-phone=A] [data-action=send]').click()");
    assert.equal(await run('window.casmateCompactMock.getState().sending'),true,'stop waits for confirmation');
    await run("document.querySelector('[data-phone=A] [data-action=confirm]').click()");
    assert.deepEqual(await run('(({sending,broadcast,listening})=>({sending,broadcast,listening}))(window.casmateCompactMock.getState())'),{sending:false,broadcast:true,listening:true});
    await run("document.querySelector('[data-phone=A] [data-action=send]').click();document.querySelector('[data-phone=A] [data-action=connection]').click();document.querySelector('[data-phone=A] [data-action=qr]').click()");
    assert.equal(await run('window.casmateCompactMock.getState().dialog'),'qr');
    await run("document.querySelector('[data-phone=A] [data-action=close]').click()");
    win.webContents.focus();
    const origin=await run("(()=>{const r=document.querySelector('[data-phone=A] .qc-main').getBoundingClientRect();return {x:Math.round(r.x+r.width*.7),y:Math.round(r.y+150)};})()");
    win.webContents.sendInputEvent({type:'mouseDown',...origin,button:'left',clickCount:1});
    win.webContents.sendInputEvent({type:'mouseMove',x:origin.x-100,y:origin.y+2,movementX:-100,movementY:2});
    win.webContents.sendInputEvent({type:'mouseUp',x:origin.x-100,y:origin.y+2,button:'left',clickCount:1});
    await pause();
    assert.equal(await run('window.casmateCompactMock.getState().page'),'comments','actual browser flick');
    await run("window.casmateCompactMock.setState({page:'camera'});const e=document.querySelector('[data-phone=A] .qc-main');e.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,pointerId:9,button:0,clientX:200,clientY:200}));e.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,pointerId:9,clientX:202,clientY:270}));e.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,pointerId:9,clientX:90,clientY:270}));");
    assert.equal(await run('window.casmateCompactMock.getState().page'),'camera','vertical scroll cancels flick');
    assert.deepEqual(errors,[],'console errors');
    await writeFile(join(process.argv[3],'geometry.json'),JSON.stringify(report,null,2));
    console.log(`PASS: ${report.length} layouts; stable connection/read states, confirmations, dialogs, actual flick.`);
    win.close();app.exit(0);
  }catch(error){console.error(error);win.close();app.exit(1);}
});
