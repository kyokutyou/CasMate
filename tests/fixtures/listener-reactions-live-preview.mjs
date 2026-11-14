import assert from 'node:assert/strict';

export async function verifyLivePreview(window, pageUrl, mode) {
  const page = new URL(pageUrl);
  page.searchParams.set('fixture', 'local-only');
  const playerRequests = [];
  const localRequests = [];
  window.webContents.session.webRequest.onBeforeSendHeaders({ urls: ['http://127.0.0.1/*', 'https://*/*'] }, (details, callback) => {
    if (details.url.startsWith('http://')) {
      localRequests.push(new URL(details.url).pathname);
      // The disposable HTTP server expects the Origin used by the production HTTPS page.
      for (const name of Object.keys(details.requestHeaders)) {
        if (name.toLowerCase() === 'origin') details.requestHeaders[name] = page.origin.replace('http:', 'https:');
      }
      callback({ requestHeaders: details.requestHeaders });
      return;
    }
    if (details.resourceType === 'subFrame') {
      const referer = Object.entries(details.requestHeaders).find(([name]) => name.toLowerCase() === 'referer')?.[1];
      playerRequests.push({ url: details.url, referer });
    }
    callback({ cancel: true });
  });
  try {
    await window.loadURL(page.href);
    const execute = source => window.webContents.executeJavaScript(source);
    const wide = await execute(`(async () => {
      const until = performance.now() + 4000;
      let player;
      while (!(player = document.querySelector('#live-preview iframe'))) {
        if (performance.now() >= until) throw new Error('player did not initialize: ' + JSON.stringify({
          meta: document.querySelector('meta[name="casmate-preview"]')?.outerHTML,
          width: document.querySelector('#screen-section')?.clientWidth,
          controlsHidden: document.querySelector('#live-preview-controls')?.hidden,
        }));
        await new Promise(resolve => setTimeout(resolve, 20));
      }
      const { width, height } = player.getBoundingClientRect();
      return { width, height, stillHidden: document.querySelector('#still-preview').hidden };
    })()`);
    const twitch = mode === 'twitch';
    assert.ok(wide.width >= (twitch ? 400 : 200));
    assert.ok(wide.height >= (twitch ? 300 : 200));
    assert.equal(wide.stillHidden, true);
    assert.deepEqual(playerRequests, [{
      url: twitch
        ? `https://player.twitch.tv/?channel=casmate_live&parent=${page.hostname}&autoplay=true&muted=true`
        : 'https://www.youtube.com/embed/Ab1_CD-efgH?playsinline=1&autoplay=1&mute=1',
      referer: `${page.origin}/`,
    }]);

    const expanded = await execute(`(async () => {
      const player=document.querySelector('#live-preview iframe'), normal=player.getBoundingClientRect().width;
      document.querySelector('#preview-width-toggle').click();
      await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
      return {normal,width:player.getBoundingClientRect().width,viewport:document.documentElement.clientWidth,
        scrollWidth:document.documentElement.scrollWidth,same:player===document.querySelector('#live-preview iframe')};
    })()`);
    assert.ok(expanded.width>expanded.normal && Math.abs(expanded.width-expanded.viewport)<1,'wide preview must fill the usable browser width');
    assert.ok(expanded.scrollWidth<=expanded.viewport,'wide preview must not cause horizontal scrolling');
    assert.equal(expanded.same,true,'expanding must preserve the player');
    const overlay = await execute(`(async () => {
      const player = document.querySelector('#live-preview iframe'), stage = document.querySelector('#screen-stage');
      const toggle = document.querySelector('#player-controls-toggle'), point = document.querySelector('#point-tool');
      const waitFor = async predicate => {
        const until = performance.now() + 4000;
        while (!predicate()) {
          if (performance.now() >= until) throw new Error('live overlay did not become ready');
          await new Promise(resolve => setTimeout(resolve, 20));
        }
      };
      await waitFor(() => !point.disabled);
      const initial = { controls:toggle.getAttribute('aria-pressed'), events:getComputedStyle(player).pointerEvents,
        toggleVisible:!toggle.hidden, stageInPlayer:stage.parentElement.id === 'live-preview', image:!!stage.querySelector('img') };
      const send = async kind => {
        document.querySelector(kind === 'point' ? '#point-tool' : '#ellipse-tool').click();
        await new Promise(resolve => queueMicrotask(resolve));
        const controlState = { controls:toggle.getAttribute('aria-pressed'), events:getComputedStyle(player).pointerEvents,
          active:stage.dataset.active, top:document.elementFromPoint(stage.getBoundingClientRect().left + 10, stage.getBoundingClientRect().top + 10) === stage };
        const {left,top,width,height} = stage.getBoundingClientRect();
        if (kind === 'point') stage.dispatchEvent(new MouseEvent('click',{bubbles:true,clientX:left+width*.5,clientY:top+height*.5}));
        else {
          stage.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));
          stage.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true,cancelable:true}));
          stage.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true,cancelable:true}));
          stage.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));
        }
        const message = kind === 'point' ? '場所を送りました' : '範囲を送りました';
        await waitFor(() => document.querySelector('#status').textContent === message);
        const confirmation = !!stage.querySelector(kind === 'point' ? '.point-marker:not(.marker-pending,.marker-preview)' : '.range-marker:not(.range-pending,.range-preview)');
        await waitFor(() => !point.disabled);
        return {controlState,confirmation,controlsAfter:toggle.getAttribute('aria-pressed')};
      };
      const pointResult = await send('point'), areaResult = await send('area');
      toggle.click();
      return {initial,pointResult,areaResult,samePlayer:document.querySelector('#live-preview iframe') === player,
        restored:toggle.getAttribute('aria-pressed') === 'true' && getComputedStyle(player).pointerEvents === 'auto'};
    })()`);
    assert.deepEqual(overlay.initial, {controls:'true',events:'auto',toggleVisible:true,stageInPlayer:true,image:false});
    for (const result of [overlay.pointResult,overlay.areaResult]) {
      assert.deepEqual(result.controlState,{controls:'false',events:'none',active:'true',top:true},'the input surface must receive pointer input instead of the player');
      assert.equal(result.confirmation,true,'the accepted placement must render on the input surface');
      assert.equal(result.controlsAfter,'false','sending must keep player controls disabled');
    }
    assert.equal(overlay.samePlayer,true,'point and area input must preserve the same live player');
    assert.equal(overlay.restored,true,'the controls toggle must restore native player input');
    assert.ok(localRequests.includes('/frame'),'video-only input needs current frame metadata');
    assert.equal(localRequests.includes('/frame.jpg'),false,'video-only input must not download JPEG images');

    const beforeArrow=localRequests.filter(path=>path==='/react').length;
    const arrowRect=await execute(`(async()=>{const b=document.querySelector('#arrow-tool');if(b.disabled)throw Error('arrow tool unavailable');b.click();const s=document.querySelector('#screen-stage');s.scrollIntoView({block:'center'});await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));const r=s.getBoundingClientRect();return {x:r.left,y:r.top,width:r.width,height:r.height};})()`);
    const start={x:Math.round(arrowRect.x+arrowRect.width*.2),y:Math.round(arrowRect.y+arrowRect.height*.7)},end={x:Math.round(arrowRect.x+arrowRect.width*.8),y:Math.round(arrowRect.y+arrowRect.height*.3)};
    window.webContents.sendInputEvent({type:'mouseMove',...start});window.webContents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,...start});window.webContents.sendInputEvent({type:'mouseMove',...end});
    const ghost=await execute(`new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>{const n=document.querySelector('.arrow-preview');r({phase:n?.dataset.phase,label:n?.querySelector('.arrow-label')?.textContent});})))`);
    assert.deepEqual(ghost,{phase:'preview',label:'こっち！'});assert.equal(localRequests.filter(path=>path==='/react').length,beforeArrow,'drag preview must remain local');
    window.webContents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,...end});
    await execute(`new Promise((resolve,reject)=>{const until=performance.now()+5000;const check=()=>document.querySelector('#status').textContent==='矢印を送りました'&&!document.querySelector('#arrow-tool').disabled?resolve():performance.now()>until?reject(Error('arrow confirmation not received')):setTimeout(check,20);check();})`);
    assert.equal(localRequests.filter(path=>path==='/react').length,beforeArrow+1,'release must send exactly once');
    assert.equal(await execute("document.querySelector('#arrow-tool').getAttribute('aria-pressed')"),'false');

    const restored = await execute(`(async () => {
      const player=document.querySelector('#live-preview iframe');
      document.querySelector('#preview-width-toggle').click();
      await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
      return {width:player.getBoundingClientRect().width,same:player===document.querySelector('#live-preview iframe')};
    })()`);
    assert.equal(restored.same,true);assert.ok(Math.abs(restored.width-expanded.normal)<1,'normal preview width must be restored');

    const minimum = twitch ? 400 : 200;
    const fractional = await execute(`(async () => {
      const section = document.querySelector('#screen-section');
      const link = document.querySelector('#live-preview-link');
      const afterResize = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      document.querySelector('[data-preview-view="live"]').focus();
      section.style.width = '${minimum - 0.25}px';
      try {
        await afterResize();
        return {
          width:section.getBoundingClientRect().width, roundedWidth:section.clientWidth,
          stillVisible:!document.querySelector('#still-preview').hidden,
          player:!!document.querySelector('#live-preview iframe'),
          linkFocused:document.activeElement === link,
        };
      } finally { section.style.removeProperty('width'); }
    })()`);
    assert.ok(fractional.width < minimum && fractional.roundedWidth === minimum,
      'the fixture must cross the width limit only after rounding');
    assert.deepEqual({stillVisible:fractional.stillVisible,player:fractional.player,linkFocused:fractional.linkFocused},
      {stillVisible:true,player:false,linkFocused:true}, 'subpixel widths below the limit must use the still preview and keep keyboard focus');
    assert.equal(await execute(`(async () => {
      const until = performance.now() + 2000;
      while (!document.querySelector('#live-preview iframe') && performance.now() < until) {
        await new Promise(resolve => setTimeout(resolve, 20));
      }
      return !!document.querySelector('#live-preview iframe') && document.activeElement === document.querySelector('#live-preview-link');
    })()`), true, 'a stable width should restore the player without moving focus from the link');

    window.setContentSize(320, 820);
    const narrow = await execute(`(async () => {
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const player = document.querySelector('#live-preview iframe');
      const overflow = [...document.querySelectorAll('body *')].filter(element => element.getBoundingClientRect().right > innerWidth).map(element => ({
        node: element.nodeName, id: element.id, width: element.getBoundingClientRect().width,
      }));
      return { height: player?.getBoundingClientRect().height ?? null, stillHidden: document.querySelector('#still-preview').hidden,
        link: document.querySelector('#live-preview-link').href, width: innerWidth, scrollWidth: document.documentElement.scrollWidth, overflow };
    })()`);
    assert.ok(narrow.scrollWidth <= narrow.width, `narrow preview overflows: ${JSON.stringify(narrow)}`);
    if (twitch) {
      assert.equal(narrow.height, null);
      assert.equal(narrow.stillHidden, false);
      assert.equal(narrow.link, 'https://www.twitch.tv/casmate_live');
      const scrollbarCss = await window.webContents.insertCSS('html::-webkit-scrollbar{width:16px}.panel > :not(#screen-section){display:none}');
      const widths = await execute(`(() => {
        const root = document.documentElement;
        const body = getComputedStyle(document.body), panel = getComputedStyle(document.querySelector('.panel'));
        const insets = [body.paddingLeft,body.paddingRight,panel.paddingLeft,panel.paddingRight,panel.borderLeftWidth,panel.borderRightWidth]
          .reduce((total,value) => total + parseFloat(value),0);
        root.style.overflowY = 'scroll';
        const gutter = innerWidth - root.clientWidth;
        root.style.removeProperty('overflow-y');
        return { bare:400 + Math.ceil(insets), gutter };
      })()`);
      assert.ok(widths.gutter > 0, 'the fixture must exercise a scrollbar that consumes width');
      await execute(`(() => {
        window.previewMounts = 0;
        window.previewObserver = new MutationObserver(records => {
          for (const record of records) window.previewMounts += [...record.addedNodes].filter(node => node.nodeName === 'IFRAME').length;
        });
        window.previewObserver.observe(document.querySelector('#live-preview'),{childList:true});
      })()`);
      const boundary = widths.bare + Math.floor(widths.gutter / 2), samples = [];
      for (const height of [720,220,720,220,720]) {
        window.setContentSize(boundary,height);
        samples.push(await execute(`(async () => {
          await new Promise(r => setTimeout(r, 120));
          return { viewport:innerWidth, available:document.querySelector('#screen-section').clientWidth,
            scrolls:document.documentElement.scrollHeight > innerHeight, stillVisible:!document.querySelector('#still-preview').hidden };
        })()`));
      }
      const mounts = await execute('window.previewObserver.disconnect(); window.previewMounts');
      await window.webContents.removeInsertedCSS(scrollbarCss);
      assert.deepEqual(samples.map(sample=>sample.scrolls),[false,true,false,true,false]);
      assert.ok(samples.every(sample=>sample.viewport===samples[0].viewport));
      assert.ok(samples.every(sample=>sample.available===samples[0].available),'the preview width is independent of the scrollbar');
      assert.equal(mounts,0,`scrollbar appearance remounted the player: ${JSON.stringify(samples)}`);
      assert.ok(samples.every(sample=>sample.stillVisible),'the narrow fallback remains visible at the same viewport width');
    } else {
      assert.ok(narrow.height >= 200, 'the player must remain at least 200px tall at 320px');
      assert.equal(narrow.stillHidden, true);
      const letterbox = await execute(`(() => {
        const stage=document.querySelector('#screen-stage').getBoundingClientRect(),player=document.querySelector('#live-preview').getBoundingClientRect();
        return {ratio:stage.width/stage.height,center:(stage.top+stage.bottom)/2-(player.top+player.bottom)/2,gutter:stage.top-player.top};
      })()`);
      assert.ok(Math.abs(letterbox.ratio-16/9)<.01,'overlay coordinates must keep the OBS canvas ratio');
      assert.ok(Math.abs(letterbox.center)<1 && letterbox.gutter>10,'the overlay must exclude the player’s vertical letterbox margins');
      const switching = await execute(`(async () => {
        const player = document.querySelector('#live-preview iframe');
        const still = document.querySelector('#still-preview');
        document.querySelector('[data-preview-view="still"]').click();
        const until = performance.now() + 4000;
        while (document.querySelector('#point-tool').disabled) {
          if (performance.now() >= until) throw new Error('OBS still did not become available');
          await new Promise(resolve => setTimeout(resolve, 20));
        }
        const samePlayer = document.querySelector('#live-preview iframe') === player;
        return { samePlayer, playerRemoved: !player.isConnected, stillVisible: !still.hidden, image: !!still.querySelector('img') };
      })()`);
      assert.deepEqual(switching, { samePlayer: false, playerRemoved: true, stillVisible: true, image: true });
    }
  } finally {
    window.webContents.session.webRequest.onBeforeSendHeaders(null);
  }
}
