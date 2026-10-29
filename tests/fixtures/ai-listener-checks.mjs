import assert from 'node:assert/strict';

export async function verifyAiListener({evaluate,resize,settle,capture}) {
  await evaluate("document.querySelector('[data-page=settings]').click();document.getElementById('settings-aiListener').click()");await settle();
  let count=0;
  const geometry=()=>evaluate(`(()=>{const i=document.querySelector('#ai-panel-behavior input');const b=document.querySelector('.management-body'),r=i.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height,top:b.scrollTop,height:b.scrollHeight,focus:document.activeElement===i}})()`);
  for(const theme of ['ocean','pearl'])for(const size of ['small','medium','large'])for(const width of [320,420,560,699,701,760,1024]){
    await resize(width,width===760?560:760);
    await evaluate(`aiLayoutHarness.appearance('${theme}','${size}');aiLayoutHarness.update({})`);await settle();
    assert.equal(await evaluate("document.querySelector('.management-body').scrollWidth>document.querySelector('.management-body').clientWidth"),false,`${theme} ${size} ${width} overflow`);
    assert.deepEqual(await evaluate("[...document.querySelectorAll('.ai-settings button,.ai-settings h3,.ai-settings summary')].filter(e=>e.checkVisibility()&&(e.scrollWidth>e.clientWidth+1||e.scrollHeight>e.clientHeight+1)).map(e=>e.textContent)"),[],`${theme} ${size} ${width} readable controls`);
    assert.equal(await evaluate("document.querySelectorAll('#ai-panel-behavior .ai-timing-fields input').length"),3);
    await evaluate("document.querySelector('#ai-panel-behavior input').focus({preventScroll:true})");
    const before=await geometry();
    for(const [message,status,stage] of [['OBS接続・配信状態の確認待ちです。','paused','idle'],['OBS配信先への再接続待ちです。','paused','obs-check'],['OBS配信開始待ちです。','paused','idle'],['会話を聞いています。','running','speaking'],['保存先を確認してから再開してください。','attention','idle']]){
      await evaluate(`aiLayoutHarness.update({requested:true,status:'${status}',message:${JSON.stringify(message)},nextAt:123456,activity:{stage:'${stage}',startedAt:0,lastDurationsMs:{generating:123456789}}})`);await settle();
      assert.deepEqual(await geometry(),before,`${width} state preserves position and focus`);
      assert.equal(await evaluate("document.querySelector('.ai-runtime-primary button').textContent==='OBS設定を開く'"),message.includes('確認待ち')||message.includes('再接続待ち'));
    }
    await evaluate(`aiLayoutHarness.update({},${JSON.stringify('保存先を確認してください。'.repeat(30))},'設定を保存しました。')`);await settle();
    assert.deepEqual(await geometry(),before,'long error and toast preserve position');
    await evaluate("aiLayoutHarness.update({authorization:{source:'twitch',url:'https://example.com/authorize',code:'ABCD-EFGH',expiresAt:1893456000000}})");await settle();
    assert.deepEqual(await geometry(),before,'authorization preserves position and focus');
    assert.equal(await evaluate("Boolean(document.querySelector('.ai-runtime-message .ai-authorization a'))"),true,'authorization remains in reserved status area');
    await evaluate("document.querySelector('.ai-authorization a').focus({preventScroll:true})");
    assert.equal(await evaluate("document.activeElement===document.querySelector('.ai-authorization a')"),true,'authorization link accepts focus');
    await evaluate("aiLayoutHarness.update({})");await settle();
    assert.equal(await evaluate("document.activeElement===document.querySelector('.ai-runtime-message')"),true,'completed authorization returns focus to status');
    if(capture&&size==='medium'&&[320,1024].includes(width)){await evaluate('aiLayoutHarness.update({})');await settle();await capture(`ai-${theme}-${width}.png`);}
    count++;
  }
  await evaluate("aiLayoutHarness.update({});document.querySelector('#ai-panel-behavior .ai-details summary').click()");await settle();
  assert.equal(await evaluate("document.querySelector('#ai-panel-behavior .ai-details').open"),true);
  await evaluate("document.getElementById('ai-tab-connections').click()");await settle();
  await evaluate("(()=>{const e=document.querySelector('#ai-panel-connections input[type=password]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,'draft-key');e.dispatchEvent(new Event('input',{bubbles:true}))})()");await settle();
  await evaluate("document.getElementById('ai-tab-participants').click()");await settle();
  assert.equal(await evaluate("document.querySelectorAll('#ai-panel-participants .ai-service').length"),4);
  await evaluate("document.querySelectorAll('#ai-panel-participants details').forEach(e=>e.open=true)");await settle();
  assert.equal(await evaluate("document.querySelector('.management-body').scrollWidth>document.querySelector('.management-body').clientWidth"),false);
  await evaluate("document.getElementById('ai-tab-behavior').click();document.querySelector('.back-button').click();document.getElementById('settings-aiListener').click()");await settle();
  assert.equal(await evaluate("document.querySelector('#ai-panel-behavior .ai-details').open"),true,'disclosure survives navigation');
  await evaluate("document.getElementById('ai-tab-connections').click();document.querySelector('#ai-panel-connections details summary').click()");await settle();
  assert.equal(await evaluate("document.querySelector('#ai-panel-connections input[type=password]').value"),'draft-key','credential draft survives navigation');
  await evaluate("(()=>{const e=document.querySelector('#ai-panel-connections input[type=password]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,'');e.dispatchEvent(new Event('input',{bubbles:true}))})()");await settle();
  await evaluate("document.querySelector('.ai-api-test-button').click()");await settle();
  assert.equal(await evaluate("document.querySelector('.ai-api-test-status').textContent.includes('文章応答を確認しました')"),true,'API test interaction works');
  await evaluate("document.getElementById('ai-personas').click()");await settle();
  await evaluate("[...document.querySelectorAll('#ai-panel-personas button')].find(e=>e.textContent==='人格を追加').click()");await settle();
  for(const theme of ['ocean','pearl'])for(const size of ['medium','large'])for(const width of [320,560,760,900,1024]){
    await resize(width,760);await evaluate(`aiLayoutHarness.appearance('${theme}','${size}')`);await settle();
    for(const tab of ['behavior','participants','personas','visual','connections','memory']){
      await evaluate(`document.querySelector('[role=tab][aria-controls="ai-panel-${tab}"]').click()`);await settle();
      const layout=await evaluate(`(()=>{const p=document.getElementById('ai-panel-${tab}'),b=document.querySelector('.management-body');return {overflow:b.scrollWidth>b.clientWidth,clipped:[...p.querySelectorAll('button,h3,summary,label')].filter(e=>e.checkVisibility()&&(e.scrollWidth>e.clientWidth+1||e.scrollHeight>e.clientHeight+1)).map(e=>e.textContent)}})()`);
      assert.deepEqual(layout,{overflow:false,clipped:[]},`${theme} ${size} ${width} ${tab} fits`);
      if(width===1024){
        const aligned=await evaluate(`(()=>{const p=document.getElementById('ai-panel-${tab}');const box=e=>e.getBoundingClientRect();if('${tab}'==='behavior'){const m=p.querySelector('.ai-mode');return box(m.children[1]).x>box(m.children[0]).x+100}if('${tab}'==='connections'){const m=p.querySelector('.ai-credential-row');return box(m.children[1]).x>box(m.children[0]).x+100}if('${tab}'==='personas'){const m=p.querySelector('.ai-persona-editor');return box(m.querySelector(':scope > label')).width>box(m.querySelector('.ai-fields > label')).width*1.5}if('${tab}'==='visual')return p.querySelector('.ai-visual-actions').children.length===3;return true})()`);
        assert.equal(aligned,true,`${tab} follows mockup grouping`);
      }
      if(capture&&theme==='ocean'&&size==='medium'&&width===1024){await evaluate(`document.getElementById('ai-panel-${tab}').scrollIntoView({block:'start'})`);await settle();await capture(`ai-tab-${tab}.png`);}
    }
  }
  for(const width of [320,560,760,1024]){
    await resize(width,760);await evaluate("aiLayoutHarness.appearance('ocean','medium');aiLayoutHarness.settings({personas:[{id:'p',name:'相棒',personality:'',tone:'',firstPerson:'',topics:'',notes:''}],participants:{youtube:{enabled:false,personaId:''},twitch:{enabled:false,personaId:''},shitaraba:{enabled:false,personaId:''},jpnkn:{enabled:true,personaId:''}}});aiLayoutHarness.update({hasKey:true});document.getElementById('ai-tab-behavior').click();document.querySelector('.ai-latest').open=false;document.querySelector('.ai-duration-details').open=false");await settle();
    const calls=await evaluate('aiLayoutHarness.calls().length');
    assert.equal(await evaluate("document.querySelector('.ai-state').dataset.tone"),'warning','setup uses warning tone');
    assert.equal(await evaluate("document.querySelector('.ai-runtime-stage').textContent"),'設定を待っています','setup explains idle phase');
    await evaluate("document.querySelector('.ai-runtime-primary button').click()");await settle();
    assert.equal(await evaluate("document.activeElement===document.querySelector('#ai-panel-participants .ai-service:last-child select')"),true,'missing-persona action focuses actual selector');
    assert.equal(await evaluate('aiLayoutHarness.calls().length'),calls,'guide never starts or saves');
    await evaluate("document.getElementById('ai-tab-behavior').click();document.querySelector('#ai-panel-behavior input').focus({preventScroll:true})");await settle();
    const before=await geometry();
    for(const [status,reason,requested] of [['attention','共有記憶・発言ログ・投稿枠を保存できません。復旧後に再開してください。',true],['paused','OBS接続・配信状態の確認待ちです。',true],['running','会話を聞いています。',true],['stopped','停止中',false]]){
      await evaluate(`aiLayoutHarness.update({hasKey:true,status:'${status}',requested:${requested},message:${JSON.stringify(reason)}})`);await settle();assert.deepEqual(await geometry(),before,`${width} guided state preserves inputs`);
      assert.deepEqual(await evaluate("[...document.querySelectorAll('.ai-runtime button')].filter(e=>e.checkVisibility()&&(e.scrollWidth>e.clientWidth+1||e.scrollHeight>e.clientHeight+1)).map(e=>e.textContent)"),[],`${width} action labels fit`);
    }
    if(capture){await evaluate("document.querySelector('.ai-runtime').scrollIntoView({block:'start'})");await settle();await capture(`ai-guided-product-${width}.png`);}
  }
  for(const place of ['participants','latest']){
    await evaluate("aiLayoutHarness.settings({mode:'obs',personas:[{id:'p',name:'相棒',personality:'',tone:'',firstPerson:'',topics:'',notes:''}],participants:{youtube:{enabled:false,personaId:''},twitch:{enabled:false,personaId:''},shitaraba:{enabled:false,personaId:''},jpnkn:{enabled:true,personaId:'p'}}});aiLayoutHarness.update({hasKey:true,services:{youtube:{ready:false,message:'',account:null,latest:null},twitch:{ready:false,message:'',account:null,latest:null},shitaraba:{ready:false,message:'',account:null,latest:null},jpnkn:{ready:false,message:'投稿結果が不明です。',account:null,latest:null}}})");await settle();
    assert.equal(await evaluate("[...document.querySelectorAll('.ai-runtime-secondary button')].some(b=>b.textContent==='自動開始を止める')"),true,'OBS automatic start can be suppressed while stopped after failure');
    await evaluate(place==='participants'?"document.getElementById('ai-tab-participants').click()":"document.getElementById('ai-tab-behavior').click();document.querySelector('.ai-latest').open=true");await settle();
    const scope=place==='participants'?'#ai-panel-participants':'.ai-latest';
    await evaluate(`(()=>{const b=[...document.querySelectorAll('${scope} button')].find(b=>b.textContent==='jpnknを再開');b.focus();b.click()})()`);await settle();
    await evaluate("aiLayoutHarness.update({hasKey:true,services:{youtube:{ready:false,message:'',account:null,latest:null},twitch:{ready:false,message:'',account:null,latest:null},shitaraba:{ready:false,message:'',account:null,latest:null},jpnkn:{ready:true,message:'',account:null,latest:null}}})");await settle();
    assert.equal(await evaluate(place==='participants'?"document.activeElement===document.querySelector('#ai-panel-participants .ai-service:last-child select')":"document.activeElement===document.querySelector('.ai-latest-item:last-child')"),true,`${place} resume keeps focus in same service`);
  }
  for(const width of [320,1024]){
    await resize(width,760);
    await evaluate("document.getElementById('ai-tab-behavior').click();aiLayoutHarness.update({hasKey:true,services:{youtube:{ready:false,message:'',account:null,latest:null},twitch:{ready:false,message:'',account:null,latest:null},shitaraba:{ready:false,message:'',account:null,latest:null},jpnkn:{ready:false,message:'コメント取得を待っています。',account:null,latest:null}}})");await settle();
    assert.equal(await evaluate("document.querySelector('.ai-runtime-primary button').textContent"),'開始','AI can start its own comment acquisition');
    await evaluate("document.querySelector('.ai-runtime-primary button').click()");await settle();
    assert.equal(await evaluate("aiLayoutHarness.calls().at(-1)"),'/api/ai-listener/start','connection-wait start reaches runtime API');
  }
  await resize(320,760);
  await evaluate("aiLayoutHarness.settings({participants:{youtube:{enabled:false,personaId:''},twitch:{enabled:false,personaId:''},shitaraba:{enabled:false,personaId:''},jpnkn:{enabled:true,personaId:''}}});aiLayoutHarness.update({hasKey:true});document.querySelector('.ai-runtime-primary button').click()");await settle();
  assert.equal(await evaluate("document.activeElement===document.querySelector('.ai-persona-editor > label textarea')"),true,'persona guide returns to existing draft editor');
  return count;
}
