import assert from 'node:assert/strict';

export async function verifyUiClarity({ evaluate, resize, capture, render }) {
  const settle = async () => {
    const rendered = evaluate('new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error("UI frames timed out")),3000);requestAnimationFrame(()=>requestAnimationFrame(()=>{clearTimeout(timer);resolve()}));})');
    if (render) await render();
    await rendered;
  };
  const ready = async condition => {
    const deadline = Date.now() + 5000;
    while (!await evaluate(condition)) {
      if (Date.now() > deadline) throw new Error('UI did not reach: ' + condition);
      await evaluate('new Promise(r=>setTimeout(r,30))');
    }
    await settle();
  };
  await ready('Boolean(window.boardManagementHarness || window.obsRegistrationHarness)');
  const kind = await evaluate('window.obsRegistrationHarness ? "registration" : document.querySelector(".comment-list-page") ? "comments" : "effects"');
  console.log('Clarity page',kind);
  const click = async selector => { await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`); await settle(); };
  const change = async (selector, value) => {
    await evaluate(`(()=>{const n=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(n,${JSON.stringify(value)});n.dispatchEvent(new Event('input',{bubbles:true}));n.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  };
  if (kind === 'effects') { await click('[data-page=settings]'); await click('#settings-textEffects'); await click('.effects-rule-actions > button.effects-link'); }
  if (kind === 'registration') { await click('[data-page=settings]'); await click('#settings-urls'); await evaluate('obsRegistrationHarness.update({multiple:true})'); await click('#obs-registration-entry-comments'); await ready('document.querySelector(".obs-registration-source-value select option[value=manual-second]")!==null');await evaluate('(()=>{const n=document.querySelector(".obs-registration-source-value select");n.value="manual-second";n.dispatchEvent(new Event("change",{bubbles:true}));})()'); }
  let count = 0;
  for (const theme of ['ocean', 'pearl']) {
    if (kind === 'registration') await evaluate(`obsRegistrationHarness.update({textSize:'large',theme:${JSON.stringify(theme)}})`);
    else await evaluate(`(()=>{const s=boardManagementHarness.snapshot();boardManagementHarness.updateSnapshot({settings:{...s.settings,application:{...s.settings.application,managementTheme:${JSON.stringify(theme)},managementTextSize:'large'}}});})()`);
    for (const [width, height] of [[1200,820],[760,560],[560,760],[320,760]]) {
      await resize(width,height);
      await ready('document.readyState==="complete"');
      if (kind !== 'comments') assert.equal(await evaluate('getComputedStyle(document.querySelector(".management-shell")).getPropertyValue("--studio-surface").trim()'),theme==='pearl'?'#ffffff':'#203640','actual theme variables');
      if (kind === 'effects') {
        assert.equal(await evaluate('document.querySelector(".effects-test").textContent.includes("OBSへテスト送信")'), true);
        await change('[aria-label="演出の色を選択"]','#abcdef');
        await change('[aria-label="演出の不透明度"]','25');
        await ready('boardManagementHarness.snapshot().settings.textEffects.rules[0].color==="#abcdef40"');
        await evaluate('document.querySelector(".effects-color-editor").scrollIntoView({block:"center"})');
        const geometry = () => evaluate(`(()=>{const a=document.querySelector('.effects-editor'),r=n=>{const b=n.getBoundingClientRect();return [b.x,b.y,b.width,b.height]};return {fields:[...a.querySelectorAll('input,select')].map(r),scroll:document.querySelector('.management-body').scrollTop,list:document.querySelector('.effects-rule-list').scrollTop}})()`);
        const before = await geometry();
        await change('[aria-label="演出の色を選択"]','#123456');
        await ready('boardManagementHarness.snapshot().settings.textEffects.rules[0].color==="#12345640"');
        assert.deepEqual(await geometry(),before,'color change preserves controls and scroll');
        const code = await evaluate('[...document.querySelectorAll(".effects-editor input")].find(n=>n.labels?.[0]?.textContent==="色（#RRGGBBAA）").id');
        await change('#'+code,'invalid');
        assert.equal(await evaluate('document.querySelector("[aria-label=演出の不透明度]").disabled'),true);
        assert.deepEqual(await geometry(),before,'invalid color preserves controls and scroll');
        await change('#'+code,'#12345640');
        await ready('!document.querySelector("[aria-label=演出の不透明度]").disabled');
      } else if (kind === 'comments') {
        assert.equal(await evaluate('document.querySelector("header").textContent.includes("アプリ接続済み")'),true);
        assert.equal(await evaluate('document.body.innerText.includes("LIVE")'),false);
        assert.equal(await evaluate('(()=>{const r=document.createRange();r.selectNodeContents(document.querySelector("header > span"));return r.getClientRects().length})()'),1,'connection label stays on one line');
        await evaluate('(()=>{const s=boardManagementHarness.snapshot();boardManagementHarness.updateSnapshot({sourceStatuses:{...s.sourceStatuses,youtube:{...s.sourceStatuses.youtube,state:"connected"}}});})()');
        await ready('document.body.innerText.includes("新着コメントを待っています。")');
        if (await evaluate('innerHeight>=500')) assert.equal(await evaluate('(()=>{const n=document.querySelector(".comment-stream");return n.scrollHeight>n.clientHeight+1})()'),false,'empty guidance fits without unnecessary scrolling');
      } else {
        assert.equal(await evaluate('document.querySelector(".obs-registration-destination").textContent.includes("現在の本番シーン")'),true);
        assert.equal(await evaluate('document.querySelector(".obs-registration-source-value select").textContent.includes("候補2")'),true);
        const rect = () => evaluate('(()=>{const r=document.querySelector("[data-action=register]").getBoundingClientRect();return [r.x,r.y,r.width,r.height]})()');
        const before = await rect();
        const checkingOperation = {id:'checking-operation',target:{kind:'overlay',overlay:'comments'},title:'コメント',collection:'配信用コレクション',sceneUuid:'program',sceneName:'',status:'running',phase:'checking',result:null,inputUuid:null,sceneItemId:null,errorCode:null,message:'OBSのソースと追加先を確認しています。'};
        await evaluate(`obsRegistrationHarness.update(${JSON.stringify({registration:{busy:true,lastOperation:checkingOperation,unfinishedOperations:[]}})})`);
        await settle();
        assert.equal(await evaluate('document.querySelector(".obs-registration-destination strong").textContent'), '確認中…', 'unresolved operation scene is explicit');
        assert.deepEqual(await rect(),before,'pending scene preserves action position');
        if (capture) await capture(`clarity-registration-pending-${theme}-${width}.png`);
        await evaluate(`obsRegistrationHarness.update(${JSON.stringify({registration:{busy:true,lastOperation:{...checkingOperation,sceneName:'現在の本番シーン',phase:'creatingInput'},unfinishedOperations:[]}})})`);
        await settle();
        assert.equal(await evaluate('document.querySelector(".obs-registration-destination strong").textContent'), '現在の本番シーン', 'resolved operation scene is shown');
        await evaluate('obsRegistrationHarness.update({registration:{busy:false,lastOperation:null,unfinishedOperations:[]}})');
        await settle();
        await evaluate('document.querySelector(".obs-registration-destination strong").textContent="長いシーン名".repeat(100)');
        assert.deepEqual(await rect(),before,'long scene name preserves action position');
        await evaluate('document.querySelector(".obs-registration-destination strong").textContent="現在の本番シーン"');
      }
      if (capture) await capture(`clarity-${kind}-${theme}-${width}.png`);
      if (kind === 'effects') {
        await evaluate('document.querySelector(".management-body").scrollTop=0;document.querySelector(".effects-rule-list").scrollTop=0');
        if (capture) await capture(`clarity-effects-actions-${theme}-${width}.png`);
      }
      const overflow=await evaluate(`(()=>{const nodes=[document.documentElement,...document.querySelectorAll('.management-body,.effects-editor,.effects-color-editor,.obs-registration-body')];return nodes.filter(n=>n.checkVisibility()&&n.scrollWidth>n.clientWidth+1).map(n=>({node:n.className||n.tagName,width:n.clientWidth,scroll:n.scrollWidth,children:[...n.children].map(c=>({class:c.className,width:c.getBoundingClientRect().width,scroll:c.scrollWidth}))}))})()`);
      assert.deepEqual(overflow,[],kind+' '+width+' has no horizontal overflow');
      count++;
    }
  }
  return count;
}
