import assert from 'node:assert/strict';

export async function verifyObsSourceCards({ evaluate, resize, capture, render }) {
  const settle = render ?? (() => evaluate(`new Promise((resolve,reject) => {
    const timer=setTimeout(()=>reject(new Error('OBS source cards did not render two frames')),3000);
    requestAnimationFrame(()=>requestAnimationFrame(()=>{clearTimeout(timer);resolve();}));
  })`));
  const click = async selector => { await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`); await settle(); };
  await click('.management-nav [data-page="settings"]');
  await click('#settings-urls');
  assert.equal(await evaluate('document.getElementById("editor-heading").textContent'), 'OBSにソースを追加');
  const overflow = `(() => {
    const panel = document.querySelector('.obs-urls-panel');
    return document.documentElement.scrollWidth > innerWidth || [...panel.querySelectorAll('article,code,button,summary,.obs-urls-preview,.obs-urls-actions')]
      .filter(node => node.checkVisibility()).some(node => node.scrollWidth > node.clientWidth + 1);
  })()`;
  let checks = 0;
  for (const theme of ['graphite', 'midnight', 'ocean', 'burgundy', 'pearl', 'ivory', 'sakura', 'lavender']) {
    for (const textSize of ['small', 'medium', 'large']) {
      await evaluate(`window.obsRegistrationHarness.update({textSize:${JSON.stringify(textSize)}}); document.querySelector('.management-shell').dataset.managementTheme=${JSON.stringify(theme)}`);
      for (const [width, height] of [[320,760],[499,760],[500,760],[501,760],[560,760],[639,760],[640,760],[641,760],[760,560],[1200,820]]) {
        await resize(width, height); await settle();
        assert.equal(await evaluate(overflow), false, `${theme}/${textSize}/${width} overflow`);
        const geometry = await evaluate(`(() => [...document.querySelectorAll('.obs-urls-row')].map(card=>{
          const r=card.getBoundingClientRect();const a=card.querySelector('.obs-urls-actions').getBoundingClientRect();
          return {x:r.x,y:r.y,height:r.height,bottom:a.bottom};
        }))()`);
        const cssWidth = await evaluate('innerWidth');
        if (cssWidth <= 500) assert.ok(geometry.every(card=>card.x===geometry[0].x),`${width}px single column`);
        else for (const [a,b] of [[geometry[0],geometry[1]],[geometry[2],geometry[3]]]) {
          assert.equal(a.y,b.y,`${width}px row alignment`);assert.ok(a.x<b.x,`${width}px two columns`);
          assert.equal(a.height,b.height,`${width}px equal row heights`);assert.equal(a.bottom,b.bottom,`${width}px bottom actions`);
        }
        for (let i = 0; i < 4; i++) {
          assert.equal(await evaluate("[...document.querySelectorAll('.obs-urls-row')].filter(node=>node.checkVisibility()).length"), 4);
          assert.equal(await evaluate(`document.querySelectorAll('.obs-urls-row')[${i}].getAttribute('aria-label')`),['コメント','音声認識','キャラクター','文字演出'][i]);
          assert.equal(await evaluate("document.querySelectorAll('.obs-urls-choice,.obs-urls-preview,.obs-urls-quiet,.obs-urls-modal,.obs-urls-running').length"), 0);
          checks++;
        }
        if (capture && theme === 'ocean' && textSize === 'medium' && [320,760,1200].includes(width)) await capture(`source-cards-${width}.png`);
      }
    }
  }
  assert.equal(await evaluate('window.obsRegistrationHarness.contexts()'), 0, 'viewing cards must not connect to OBS');
  assert.equal(await evaluate('window.obsRegistrationHarness.additions()'), 0, 'viewing cards must not register');
  await resize(760,560);
  await evaluate("window.obsRegistrationHarness.update({textSize:'medium'})"); await settle();
  await evaluate("document.querySelector('.obs-urls-guide').open=true; document.querySelector('.obs-urls-extras>details:last-child').open=true");
  assert.equal(await evaluate(overflow), false, 'expanded helpers fit');
  await click('.editor-heading-row .back-button'); await click('#settings-urls');
  assert.equal(await evaluate("[...document.querySelectorAll('.obs-urls-extras>details')].every(node=>node.open)"), true, 'disclosure state survives navigation');
  await evaluate(`window.copyRequests=[];Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText(url){window.copyRequests.push(url);return new Promise(resolve=>{window.finishCopy=resolve;});}}});document.getElementById('obs-registration-entry-comments').focus();`);
  const measure = `(() => {
    const panel=document.querySelector('.obs-urls-panel'); const body=document.querySelector('.management-body');
    return {boxes:[...panel.querySelectorAll('article,article button')].map(node=>{const r=node.getBoundingClientRect();return [r.x,r.y,r.width,r.height];}),scroll:body.scrollTop,height:body.scrollHeight,focus:document.activeElement.id};
  })()`;
  const before=await evaluate(measure);
  await click('.obs-urls-row:not([hidden]) .obs-urls-copy');
  await click('.obs-urls-row:not([hidden]) .obs-urls-copy');
  assert.equal(await evaluate('window.copyRequests.length'),1,'no duplicate copy');
  assert.deepEqual(await evaluate(measure),before,'pending copy preserves positions');
  await evaluate('window.finishCopy()'); await settle();
  assert.equal(await evaluate("document.querySelector('.toast-region').textContent.includes('コメントのURLをコピーしました。')"), true);
  assert.deepEqual(await evaluate(measure),before,'success toast preserves positions');
  await evaluate('window.obsRegistrationHarness.update({notice:undefined})'); await settle();
  assert.deepEqual(await evaluate(measure),before,'clearing toast preserves positions');
  assert.deepEqual(await evaluate('window.copyRequests'),['http://127.0.0.1:3000/overlay/comments']);
  return checks;
}
