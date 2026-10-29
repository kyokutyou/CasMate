import assert from 'node:assert/strict';

export async function verifyBoardManagement({ evaluate, resize, capture, browser = false }) {
  const settle = () => evaluate('new Promise(resolve => { const timer = setTimeout(resolve, 100); requestAnimationFrame(() => requestAnimationFrame(() => { clearTimeout(timer); resolve(); })); })');
  const waitFor = async expression => {
    const deadline = Date.now() + 3000;
    while (!await evaluate(expression)) {
      if (Date.now() >= deadline) throw new Error('Timed out: ' + expression);
      await evaluate('new Promise(resolve => setTimeout(resolve, 50))');
    }
  };
  await evaluate(`(${function install() {
    const visible = element => element.getClientRects().length > 0 && !element.closest('[hidden]');
    window.boardUi = {
      click(name, scope = 'body') {
        const button = [...document.querySelector(scope).querySelectorAll('button, summary')].filter(visible)
          .find(element => element.getAttribute('aria-label') === name || element.textContent.trim() === name);
        if (!button) throw new Error('Missing button: ' + name);
        button.click();
      },
      input(selector, value) {
        const input = document.querySelector(selector);
        const prototype = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        Object.getOwnPropertyDescriptor(prototype, 'value').set.call(input, value);
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
      },
      metrics(selector) {
        const input = document.querySelector(selector); const body = document.querySelector('.management-body');
        const rect = input.getBoundingClientRect();
        return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, scroll: body.scrollTop,
          bodyHeight: body.scrollHeight, focus: document.activeElement === input, overflow: body.scrollWidth > body.clientWidth };
      },
      aim(selector) {
        const input = document.querySelector(selector); const body = document.querySelector('.management-body');
        input.focus({ preventScroll: true }); body.scrollTop += input.getBoundingClientRect().y - 220;
      },
      toastOverlaps() {
        const toast = document.querySelector('.toast-region .banner'); if (!toast) return ['missing toast'];
        const a = toast.getBoundingClientRect();
        return [...document.querySelectorAll('.management-brand, .pc-status-button, .management-connection, .management-nav, .management-body')]
          .filter(element => element.checkVisibility()).filter(element => {
            const b = element.getBoundingClientRect();
            return Math.min(a.right, b.right) - Math.max(a.left, b.left) > .5 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > .5;
          }).map(element => element.className);
      },
    };
  }.toString()})()`);
  const click = (name, scope) => evaluate(`boardUi.click(${JSON.stringify(name)},${JSON.stringify(scope ?? 'body')})`);
  const input = (selector, value) => evaluate(`boardUi.input(${JSON.stringify(selector)},${JSON.stringify(value)})`);
  let count = 0;
  assert.equal(await evaluate("document.querySelectorAll('.home-source').length"), 3);
  assert.equal(await evaluate("document.getElementById('home-source-shitaraba').textContent.includes('jpnkn')"), true);
  assert.equal(await evaluate("document.getElementById('home-source-jpnkn') === null"), true);
  await evaluate("document.getElementById('home-source-shitaraba').click()"); await settle();
  assert.equal(await evaluate("document.activeElement.id"), 'source-shitaraba');
  assert.equal(await evaluate("document.querySelectorAll('.acquisition-source').length"), 3);
  assert.equal(await evaluate("document.querySelector('label[for=source-shitaraba]').textContent"), '掲示板スレッドURL（したらば／jpnkn）');
  assert.equal(await evaluate("document.querySelector('.acquisition-count').textContent"), '1件接続中'); count++;

  for (const [width, height] of browser ? [[760, 560]] : [[760, 560], [560, 760], [320, 560]]) {
    await resize(width, height);
    // Native bounds changes can reach the renderer after the resize call returns.
    // Compare notifications only after the requested CSS viewport is in effect.
    await waitFor(`innerWidth === ${width} && innerHeight === ${height}`);
    await settle();
    await evaluate("boardManagementHarness.updateSource({ state: 'connected', message: null }); boardUi.aim('#source-shitaraba')"); await settle();
    const before = await evaluate("boardUi.metrics('#source-shitaraba')");
    assert.equal(before.overflow, false, `${width}px acquisition overflow`);
    await evaluate(`boardManagementHarness.updateSource({ state: 'error', message: ${JSON.stringify('掲示板の取得を継続できません。接続先と掲示板の稼働状態を確認してください。'.repeat(6))} })`); await settle();
    assert.deepEqual(await evaluate("boardUi.metrics('#source-shitaraba')"), before, `${width}px error preserves field position`); count++;
    if (capture) await capture(`acquisition-${width}.png`);
    await click('jpnknを再接続'); await settle();
    const afterNotice = await evaluate("boardUi.metrics('#source-shitaraba')");
    assert.deepEqual({ ...afterNotice, focus: before.focus }, before, `${width}px reconnect toast preserves layout`);
    assert.equal(await evaluate("document.querySelector('.toast-message')?.textContent.includes('jpnknの再接続を要求しました。')"), true); count++;
    assert.deepEqual(await evaluate('boardUi.toastOverlaps()'), [], `${width}px toast overlaps`);
  }
  await input('#source-shitaraba', 'https://bbs.jpnkn.com/test/read.cgi/kyokutyou/1791459622/');
  await click('jpnknを再接続'); await settle();
  const sourceTrace = await evaluate('boardManagementHarness.trace()');
  assert.equal(sourceTrace.some(row => row.kind === 'source' && row.source === 'shitaraba' && row.action === 'reconnect'), true);
  assert.equal(sourceTrace.some(row => row.kind === 'save' && row.section === 'sources' && row.value.shitaraba.threadUrl.endsWith('/1791459622/')), true);
  assert.equal(sourceTrace.some(row => row.kind === 'source' && row.source === 'jpnkn'), false); count++;
  await click('← ホームに戻る'); await settle();
  assert.equal(await evaluate('document.activeElement.id'), 'home-source-shitaraba');
  await evaluate("document.getElementById('home-source-shitaraba').click()"); await settle();
  assert.equal(await evaluate("document.querySelector('#source-shitaraba').value.endsWith('/1791459622/')"), true);
  await click('← ホームに戻る'); await click('設定', '.management-nav'); await settle();
  await evaluate("document.getElementById('settings-aiListener').click()"); await settle();
  await click('参加先'); await settle();
  assert.equal(await evaluate("document.querySelectorAll('#ai-panel-participants .ai-service').length"), 4);
  assert.deepEqual(await evaluate("[...document.querySelectorAll('#ai-panel-participants h4')].map(node => node.textContent)"), ['YouTube Live', 'Twitch', 'したらば', 'jpnkn']);
  assert.equal(await evaluate("document.querySelector('#ai-panel-participants .ai-service:last-child [role=switch]').getAttribute('aria-checked')"), 'false');
  await click('jpnknに参加', '#ai-panel-participants'); await settle();
  assert.equal(await evaluate("document.querySelector('#ai-panel-participants .ai-service:last-child [role=switch]').getAttribute('aria-checked')"), 'true');
  assert.equal(await evaluate("document.querySelector('#ai-panel-participants .ai-service:nth-child(3) [role=switch]').getAttribute('aria-checked')"), 'false');
  const aiInput = '#ai-panel-participants .ai-service:last-child .ai-fields input';
  await input(aiInput, '確認用AI'); await settle();
  await click('← 設定に戻る'); await settle();
  assert.equal(await evaluate('document.activeElement.id'), 'settings-aiListener');
  await evaluate("document.getElementById('settings-aiListener').click()"); await settle();
  assert.equal(await evaluate(`document.querySelector(${JSON.stringify(aiInput)}).value`), '確認用AI');
  assert.equal(await evaluate("document.querySelector('#ai-panel-participants .ai-service:nth-child(3) .ai-fields input').value"), ''); count++;
  if (capture) {
    await evaluate(`boardUi.aim(${JSON.stringify(aiInput)})`); await settle();
    const position = await evaluate(`boardUi.metrics(${JSON.stringify(aiInput)})`);
    assert.equal(position.focus, true); assert.equal(position.overflow, false);
    await capture('ai-four-services.png');
  }
  await click('← 設定に戻る'); await settle();
  // Return the current URL to the original board thread before verifying recovery.
  await evaluate("document.getElementById('settings-sources').click()"); await settle();
  await input('#source-shitaraba', 'https://bbs.jpnkn.com/test/read.cgi/kyokutyou/1791458242/');
  await click('jpnknを再接続'); await settle();
  await click('← 設定に戻る'); await settle();
  await evaluate("document.getElementById('settings-nextThread').click()"); await settle();
  const originalTitle = await evaluate('boardManagementHarness.snapshot().settings.sources.shitaraba.nextThread.manualTitle');
  await input('[id$="-manualTitle"]','保存した編集値');
  await waitFor("boardManagementHarness.snapshot().settings.sources.shitaraba.nextThread.manualTitle==='保存した編集値'");
  await evaluate(`(()=>{const s=boardManagementHarness.snapshot();boardManagementHarness.updateSnapshot({settingsRevision:s.settingsRevision+1,settings:{...s.settings,sources:{...s.settings.sources,shitaraba:{...s.settings.sources.shitaraba,nextThread:{...s.settings.sources.shitaraba.nextThread,manualTitle:${JSON.stringify(originalTitle)}}}}}})})()`);await settle();
  assert.equal(await evaluate("document.querySelector('[id$=\"-manualTitle\"]').value"),originalTitle,'external updates never resurrect saved local text');
  const updateNextSettings = async value => {
    await evaluate(`(()=>{const s=boardManagementHarness.snapshot();s.settings.sources.shitaraba.nextThread=${JSON.stringify(value)};boardManagementHarness.updateSnapshot({settingsRevision:s.settingsRevision+1,settings:s.settings})})()`);await settle();
  };
  for (const [field, changed, fallback] of [
    ['manualTitle', { titleMode: 'auto' }, '[id$="-titleMode"]'],
    ['manualBody', { bodyMode: 'auto' }, '[id$="-bodyMode"]'],
    ['announcementTemplate', { announceCurrentThread: false }, '.next-announcement [role=switch]'],
  ]) {
    const original = await evaluate('boardManagementHarness.snapshot().settings.sources.shitaraba.nextThread');
    const visible = { ...original, titleMode: 'manual', bodyMode: 'manual', announceCurrentThread: true };
    await updateNextSettings(visible);
    await evaluate(`document.querySelector('[id$="-${field}"]').focus({preventScroll:true})`);await settle();
    await updateNextSettings({ ...visible, ...changed });
    assert.equal(await evaluate(`document.activeElement===document.querySelector(${JSON.stringify(fallback)})`),true,'external mode update preserves input focus: '+field);
    await updateNextSettings(original);
  }
  if (browser) {
    for (const width of [900,901,1200]) {
      await resize(width,760);await waitFor(`innerWidth===${width}`);await settle();
      assert.equal(await evaluate("(()=>{const a=document.querySelector('.next-settings').getBoundingClientRect(),b=document.querySelector('.next-planned').getBoundingClientRect();return Math.abs(a.top-b.top)<1})()"),width>900,'exact next-thread column breakpoint');
    }
    if (capture) await capture('next-two-columns.png');
    await resize(760,560);await waitFor('innerWidth===760');await settle();
  }
  const automaticState = "document.querySelector('.next-auto [role=switch]').getAttribute('aria-checked')";
  assert.equal(await evaluate(automaticState), 'true');
  await click('次スレッド自動作成');
  await waitFor("boardManagementHarness.snapshot().settings.sources.shitaraba.nextThread.enabled === false");
  assert.equal(await evaluate(automaticState), 'false');
  assert.equal(await evaluate("document.querySelector('.next-live').textContent.includes('自動作成はオフ')"), true);
  await click('次スレッド自動作成');
  await waitFor("boardManagementHarness.snapshot().settings.sources.shitaraba.nextThread.enabled === true");
  assert.equal(await evaluate(automaticState), 'true');
  await evaluate("(()=>{const select=document.querySelector('[id$=\"-titleMode\"]');select.value='auto';select.dispatchEvent(new Event('change',{bubbles:true}))})()");
  await waitFor("boardManagementHarness.snapshot().settings.sources.shitaraba.nextThread.titleMode === 'auto'");
  assert.equal(await evaluate("document.querySelector('[id$=\"-bodyMode\"]').value"), 'manual', 'title and body remain independent');
  assert.equal(await evaluate("document.querySelector('[id$=\"-manualTitle\"]')===null"), true, 'automatic title hides manual editor');
  await click('作成後の案内');
  assert.equal(await evaluate("document.querySelector('.next-announcement').open"), false);
  if (capture) await capture('next-automatic-help.png');
  await click('← 設定に戻る'); await settle();
  assert.equal(await evaluate('document.activeElement.id'), 'settings-nextThread'); count++;
  await evaluate("boardManagementHarness.browserRequired(); document.getElementById('settings-nextThread').click()"); await settle();
  assert.equal(await evaluate("document.querySelector('.next-announcement').open"), false, 'announcement details survive navigation');
  assert.equal(await evaluate("document.querySelector('.next-thread-panel h2').textContent"), '掲示板の次スレッド作成');
  assert.equal(await evaluate("document.querySelector('.next-create').disabled"), true);
  await click('ブラウザで作成・結果を確認'); await settle();
  assert.equal(await evaluate("[...document.querySelectorAll('.next-recovery button')].find(button => button.textContent === '未作成を確認').disabled"), true);
  await click('現行掲示板をブラウザで開く'); await settle();
  assert.equal((await evaluate('boardManagementHarness.trace()')).some(row => row.kind === 'browser' && row.value === 'https://bbs.jpnkn.com/kyokutyou/'), true);
  const resolved = '.next-recovery input';
  await input(resolved, 'https://bbs.jpnkn.com/test/read.cgi/other/1791459622/'); await settle();
  assert.equal(await evaluate("[...document.querySelectorAll('.next-recovery button')].find(button => button.textContent === '作成済みURLを登録').disabled"), true);
  for(const suffix of ['0/','0456/','456/not-a-thread','456/l0']){
    await input(resolved,`https://bbs.jpnkn.com/test/read.cgi/kyokutyou/${suffix}`);await settle();
    assert.equal(await evaluate("[...document.querySelectorAll('.next-recovery button')].find(button=>button.textContent==='作成済みURLを登録').getAttribute('aria-disabled')"),'true','invalid jpnkn URL is never registered');
  }
  await input(resolved, 'https://bbs.jpnkn.com/test/read.cgi/kyokutyou/1791459622/'); await settle();
  // Reconnect retains the ordinary 500ms autosave debounce; recovery waits for synchronization.
  await waitFor("[...document.querySelectorAll('.next-recovery button')].find(button => button.textContent === '作成済みURLを登録').disabled === false");
  if (capture) { await evaluate(`boardUi.aim(${JSON.stringify(resolved)})`); await settle(); await capture('next-browser-required.png'); }
  await click('作成済みURLを登録'); await settle();
  assert.equal(await evaluate("document.querySelector('.toast-message')?.textContent.includes('作成済みURLを登録しました。')"), true);
  assert.equal(await evaluate("document.querySelector('.next-state-message').textContent.includes('ブラウザで現行スレッドへ案内')"), true);
  const mutations = (await evaluate('boardManagementHarness.trace()')).filter(row => row.kind === 'mutate');
  assert.deepEqual(mutations, [{ kind: 'mutate', path: '/api/shitaraba/next-thread/resolve', body: {
    outcome: 'created', threadUrl: 'https://bbs.jpnkn.com/test/read.cgi/kyokutyou/1791459622/',
  } }]); count++;
  await evaluate("[...document.querySelectorAll('.next-url button')].find(b=>b.textContent==='ブラウザで開く').focus({preventScroll:true})");await settle();
  await evaluate("(()=>{const s=boardManagementHarness.snapshot();boardManagementHarness.updateSnapshot({shitarabaNextThread:{...s.shitarabaNextThread,status:'manualReady',nextThreadUrl:null,message:null}})})()");await settle();
  assert.equal(await evaluate("document.activeElement===[...document.querySelectorAll('.next-url button')].find(b=>b.textContent==='ブラウザで開く')"),true,'thread switch preserves browser action focus');
  assert.equal(await evaluate("document.activeElement.getAttribute('aria-disabled')"),'true','removed next URL disables the focused action');
  await click('← 設定に戻る'); await settle();
  assert.equal(await evaluate('document.activeElement.id'), 'settings-nextThread');
  return count;
}
