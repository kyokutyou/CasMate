// Render and operate the two-page throwaway comparison without starting CasMate.
import { app, BrowserWindow, nativeTheme } from 'electron';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';

app.disableHardwareAcceleration();
app.setPath('userData', join(process.argv[3], 'profile'));
app.whenReady().then(async () => {
  const window = new BrowserWindow({ show: false, width: 736, height: 1500, webPreferences: { offscreen: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
  const errors=[];
  window.webContents.on('console-message', details => { if(details.level==='error')errors.push(details.message); });
  try {
    await mkdir(process.argv[4], { recursive: true });
    await window.loadFile(process.argv[2]);
    const evaluate=code=>window.webContents.executeJavaScript(code);
    const designIds=await evaluate("[...document.querySelectorAll('[data-phone]')].map(phone=>phone.dataset.phone)");
    const geometry=[];
    const connectionTransitions=[];
    const firstLaunchLayouts=[];
    const appearanceLayouts=[];
    for(const width of [320,400,736]) {
      window.setContentSize(width,1500);
      await new Promise(resolve=>setTimeout(resolve,80));
      for(const id of designIds) {
        await evaluate(`window.casmatePrototype.setScenario('unregistered')`);
        const initialBounds=await evaluate(`(() => {const phone=document.querySelector('[data-phone="${id}"]');const primary=phone.querySelector('.cm-onboarding [data-action="qr"]');return {overflow:document.documentElement.scrollWidth>innerWidth,phoneOverflow:phone.scrollWidth>phone.clientWidth+1,buttonHeight:primary.getBoundingClientRect().height,hasFunctionNavigation:Boolean(phone.querySelector('.cm-page-nav'))};})()`);
        assert.equal(initialBounds.overflow,false,`${width}: first launch outer overflow`);
        assert.equal(initialBounds.phoneOverflow,false,`${width}: first launch phone overflow`);
        assert.ok(initialBounds.buttonHeight>=60,`${width}: prominent QR target`);
        assert.equal(initialBounds.hasFunctionNavigation,false);
        firstLaunchLayouts.push({requestedWidth:width,...initialBounds});
        if(width===736) {
          await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
          await new Promise(resolve=>setTimeout(resolve,100));
          await writeFile(join(process.argv[4],`${id}-first-launch.png`),(await window.webContents.capturePage()).toPNG());
        }
        for(const action of ['qr-help','qr']) {
          await evaluate(`document.querySelector('[data-phone="${id}"] [data-action="${action}"]').click()`);
          assert.equal(await evaluate(`(() => {const sheet=document.querySelector('[data-phone="${id}"] .cm-sheet');return Boolean(sheet&&sheet.scrollWidth<=sheet.clientWidth+1);})()`),true,`${width}/${action}: initial registration dialog fits`);
          await evaluate(`document.querySelector('[data-phone="${id}"] [data-action="close"]').click()`);
        }
        await evaluate(`document.querySelector('[data-phone="${id}"] [data-action="qr"]').click();document.querySelector('[data-phone="${id}"] [data-action="qr-success"]').click()`);
        assert.deepEqual(await evaluate(`(() => {const s=window.casmatePrototype.getState('${id}');return {registered:s.registered,sending:s.sending,listening:s.listening,broadcast:s.broadcast,sheet:s.sheet};})()`),{registered:true,sending:false,listening:false,broadcast:'stopped',sheet:null});
        await evaluate(`(() => {for(const section of document.querySelectorAll('[data-design]'))section.hidden=section.dataset.design!==${JSON.stringify(id)};window.casmatePrototype.setScenario('running');})()`);
        for(const screen of ['camera','comments']) {
          await evaluate(`window.casmatePrototype.switchScreen('${id}','${screen}')`);
          const bounds=await evaluate(`(() => {const phone=document.querySelector('[data-phone="${id}"]');return {width:innerWidth,phoneHeight:phone.getBoundingClientRect().height,stageHeight:phone.closest('.cm-stage').getBoundingClientRect().height,overflow:document.documentElement.scrollWidth>innerWidth,phoneOverflow:phone.scrollWidth>phone.clientWidth+1,smallButtons:[...phone.querySelectorAll('button')].filter(x=>x.checkVisibility()).filter(x=>x.getBoundingClientRect().height<47).map(x=>x.textContent)};})()`);
          assert.equal(bounds.overflow,false,`${width}/${id}/${screen}: outer overflow`);
          assert.equal(bounds.phoneOverflow,false,`${width}/${id}/${screen}: phone overflow`);
          assert.deepEqual(bounds.smallButtons,[],`${width}/${id}/${screen}: touch target`);
          geometry.push({id,screen,requestedWidth:width,...bounds});
          const measurePositions=()=>evaluate(`(() => {const phone=document.querySelector('[data-phone="${id}"]');const selectors=['.cm-header','.cm-page-title','.cm-camera-stage','.cm-camera-actions','.cm-camera-dock','.cm-reader-state','.cm-reader-page','.cm-reader-dock','.cm-page-nav','.cm-homebar','[data-action="send"]','[data-action="read"]','[data-action="mic"]','[data-action="video"]','[data-action="obs"]'];return {phoneHeight:phone.getBoundingClientRect().height,controls:selectors.map(selector=>{const element=phone.querySelector(selector);if(!element)return null;const box=element.getBoundingClientRect();return {selector,x:box.x,y:box.y,width:box.width,height:box.height};}).filter(Boolean)};})()`);
          const connectedPositions=await measurePositions();
          await evaluate(`window.casmatePrototype.setScenario('offline');window.casmatePrototype.switchScreen('${id}','${screen}')`);
          const offlinePositions=await measurePositions();
          assert.deepEqual(offlinePositions,connectedPositions,`${width}/${id}/${screen}: disconnect must not move or resize preview and controls`);
          if(width===736) {
            await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
            await new Promise(resolve=>setTimeout(resolve,100));
            await writeFile(join(process.argv[4],`${id}-${screen}-offline.png`),(await window.webContents.capturePage()).toPNG());
          }
          await evaluate(`window.casmatePrototype.setScenario('running');window.casmatePrototype.switchScreen('${id}','${screen}')`);
          assert.deepEqual(await measurePositions(),connectedPositions,`${width}/${id}/${screen}: reconnect must preserve geometry`);
          connectionTransitions.push({requestedWidth:width,id,screen,connectedPositions,offlinePositions});
          if(screen==='comments') {
            const navBefore=await evaluate(`document.querySelector('[data-phone="${id}"] .cm-page-nav').getBoundingClientRect().y`);
            await evaluate(`document.querySelector('[data-phone="${id}"] [data-action="read"]').click()`);
            assert.equal(await evaluate(`Boolean(document.querySelector('[data-phone="${id}"] .cm-product-layer > .cm-notice'))`),false,`${width}/${id}: reading stop has no explanation row`);
            assert.equal(await evaluate(`document.querySelector('[data-phone="${id}"] .cm-page-nav').getBoundingClientRect().y`),navBefore,`${width}/${id}: reading stop keeps navigation in place`);
            if(width===736) {
              await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
              await new Promise(resolve=>setTimeout(resolve,100));
              await writeFile(join(process.argv[4],`${id}-comments-stopped.png`),(await window.webContents.capturePage()).toPNG());
            }
            await evaluate(`document.querySelector('[data-phone="${id}"] [data-action="read"]').click()`);
          }
          if(width===736) {
            await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
            await new Promise(resolve=>setTimeout(resolve,100));
            await writeFile(join(process.argv[4],`${id}-${screen}.png`),(await window.webContents.capturePage()).toPNG());
          }
          for(const action of screen==='camera'?['connection','settings','diagnostics']:['connection','settings']) {
            await evaluate(`document.querySelector('[data-phone="${id}"] [data-action="${action}"]').click()`);
            const modal=await evaluate(`(() => {const sheet=document.querySelector('[data-phone="${id}"] .cm-sheet');return {exists:Boolean(sheet),overflow:Boolean(sheet&&sheet.scrollWidth>sheet.clientWidth+1)};})()`);
            assert.equal(modal.exists,true,`${id}/${screen}/${action}: dialog exists`);
            assert.equal(modal.overflow,false,`${id}/${screen}/${action}: dialog overflow`);
            await evaluate(`document.querySelector('[data-phone="${id}"] .cm-sheet [data-action="close"]').click()`);
          }
        }
        await evaluate(`window.casmatePrototype.switchScreen('${id}','camera')`);
        window.webContents.focus();
        await new Promise(resolve=>setTimeout(resolve,60));
        await evaluate("window.flickEvents=[];for(const name of ['pointerdown','pointermove','pointerup','pointercancel'])document.addEventListener(name,event=>window.flickEvents.push({name,x:event.clientX,y:event.clientY,button:event.button,target:event.target.className}),{capture:true});");
        // Native browser input proves the desktop drag path through Pointer Events.
        const start=await evaluate(`(() => {const box=document.querySelector('[data-phone="${id}"] .cm-camera-stage').getBoundingClientRect();return {x:Math.round(box.left+box.width*.72),y:Math.round(box.top+box.height*.55)};})()`);
        window.webContents.sendInputEvent({type:'mouseDown',x:start.x,y:start.y,button:'left',clickCount:1});
        window.webContents.sendInputEvent({type:'mouseMove',x:start.x-90,y:start.y+2,movementX:-90,movementY:2});
        window.webContents.sendInputEvent({type:'mouseUp',x:start.x-90,y:start.y+2,button:'left',clickCount:1});
        await new Promise(resolve=>setTimeout(resolve,60));
        assert.equal(await evaluate(`window.casmatePrototype.getState('${id}').screen`),'comments',`${width}/${id}: actual mouse flick ${JSON.stringify(await evaluate('window.flickEvents'))}`);
        const returnStart=await evaluate(`(() => {const box=document.querySelector('[data-phone="${id}"] .cm-comment-list').getBoundingClientRect();return {x:Math.round(box.left+box.width*.3),y:Math.round(box.top+box.height*.5)};})()`);
        window.webContents.sendInputEvent({type:'mouseDown',x:returnStart.x,y:returnStart.y,button:'left',clickCount:1});
        window.webContents.sendInputEvent({type:'mouseMove',x:returnStart.x+90,y:returnStart.y+2,movementX:90,movementY:2});
        window.webContents.sendInputEvent({type:'mouseUp',x:returnStart.x+90,y:returnStart.y+2,button:'left',clickCount:1});
        await new Promise(resolve=>setTimeout(resolve,60));
        assert.equal(await evaluate(`window.casmatePrototype.getState('${id}').screen`),'camera',`${width}/${id}: actual return mouse flick`);
        if(id==='C') {
          await evaluate("document.querySelector('[data-phone=C] [data-action=tray]').click()");
          const tray=await evaluate("(() => {const el=document.querySelector('[data-phone=C] .cm-camera-tray');return {overflow:el.scrollWidth>el.clientWidth+1,buttons:[...el.querySelectorAll('button')].filter(x=>x.getBoundingClientRect().height<47).length};})()");
          assert.equal(tray.overflow,false);assert.equal(tray.buttons,0);
        }
      }
    }
    for(const width of [320,400,736])assert.equal(new Set(geometry.filter(item=>item.requestedWidth===width).map(item=>item.stageHeight)).size,1,`${width}: shared stage height`);
    nativeTheme.themeSource='dark';
    for(const width of [320,400,736]) {
      window.setContentSize(width,1500);
      for(const id of designIds)for(const screen of ['first-launch','camera','comments']) {
        await evaluate(`window.casmatePrototype.setScenario('${screen==='first-launch'?'unregistered':'running'}');${screen==='comments'?`window.casmatePrototype.switchScreen('${id}','comments');`:''}`);
        const measureTheme=()=>evaluate(`(() => {const phone=document.querySelector('[data-phone="${id}"]');const selectors=['.cm-header','.cm-onboarding','.cm-page-title','.cm-camera-stage','.cm-camera-actions','.cm-camera-dock','.cm-reader-page','.cm-reader-dock','.cm-page-nav'];return {background:getComputedStyle(phone).backgroundColor,text:getComputedStyle(phone).color,phoneHeight:phone.getBoundingClientRect().height,regions:selectors.map(selector=>{const node=phone.querySelector(selector);if(!node)return null;const box=node.getBoundingClientRect();return {selector,x:box.x,y:box.y,width:box.width,height:box.height};}).filter(Boolean),overflow:phone.scrollWidth>phone.clientWidth+1};})()`);
        const light=await measureTheme();
        assert.equal(light.background,'rgb(245, 247, 244)',`${width}/${screen}: explicit light palette overrides dark OS`);
        assert.equal(light.text,'rgb(29, 48, 41)');
        if(screen==='first-launch')await evaluate(`document.querySelector('[data-phone="${id}"] [data-action="theme-toggle"]').click()`);
        else await evaluate(`document.querySelector('[data-phone="${id}"] [data-action="settings"]').click();document.querySelector('[data-phone="${id}"] [data-action="theme-dark"]').click();document.querySelector('[data-phone="${id}"] [data-action="close"]').click()`);
        const dark=await measureTheme();
        assert.equal(dark.background,'rgb(21, 27, 25)',`${width}/${screen}: chosen dark palette applies`);
        assert.equal(dark.text,'rgb(233, 242, 236)',`${width}/${screen}: dark foreground remains readable`);
        assert.deepEqual(dark.regions,light.regions,`${width}/${screen}: theme does not move or resize controls`);
        assert.equal(dark.phoneHeight,light.phoneHeight);
        assert.equal(dark.overflow,false);
        appearanceLayouts.push({requestedWidth:width,id,screen,light,dark});
        if(width===736) {
          await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
          await new Promise(resolve=>setTimeout(resolve,100));
          await writeFile(join(process.argv[4],`${id}-${screen}-dark.png`),(await window.webContents.capturePage()).toPNG());
        }
        if(screen==='first-launch')await evaluate(`document.querySelector('[data-phone="${id}"] [data-action="theme-toggle"]').click()`);
        else await evaluate(`document.querySelector('[data-phone="${id}"] [data-action="settings"]').click();document.querySelector('[data-phone="${id}"] [data-action="theme-light"]').click();document.querySelector('[data-phone="${id}"] [data-action="close"]').click()`);
        assert.deepEqual(await measureTheme(),light,`${width}/${screen}: returning to light restores the accepted palette and layout`);
      }
    }
    assert.deepEqual(errors,[]);
    await writeFile(join(process.argv[4],'geometry.json'),JSON.stringify(geometry,null,2));
    await writeFile(join(process.argv[4],'connection-transitions.json'),JSON.stringify(connectionTransitions,null,2));
    await writeFile(join(process.argv[4],'first-launch-layouts.json'),JSON.stringify(firstLaunchLayouts,null,2));
    await writeFile(join(process.argv[4],'appearance-layouts.json'),JSON.stringify(appearanceLayouts,null,2));
    console.log(`PASS: ${appearanceLayouts.length*2} light/dark layouts and theme round trips; ${firstLaunchLayouts.length} first-launch layouts and QR flows; ${geometry.length} function layouts; ${connectionTransitions.length*2} connection transitions without layout movement; ${designIds.length*6} actual mouse flicks; shared stage height; settings/connection/diagnosis; 48px targets; no renderer errors.`);
    window.destroy();app.quit();
  } catch(error) {console.error(error);window.destroy();app.exit(1);}
});
