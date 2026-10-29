import { app, BrowserWindow } from 'electron';
import assert from 'node:assert/strict';
import { join } from 'node:path';

app.disableHardwareAcceleration();
app.setPath('userData', join(process.argv[3], 'profile'));
app.whenReady().then(async () => {
  const window = new BrowserWindow({ show: false, width: 760, height: 560,
    webPreferences: { contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
  try {
    await window.loadFile(process.argv[2]);
    const evaluate = code => window.webContents.executeJavaScript(code);
    const settle = () => new Promise(resolve => setTimeout(resolve, 100));
    let count = 0;
    for (const [width, height] of [[1000, 760], [560, 760], [320, 560]]) {
      window.setContentSize(width, height); await settle();
      await evaluate(`(() => { const input = document.querySelector('input[type="number"]'); input.focus({preventScroll:true});
        document.querySelector('.management-body').scrollTop += input.getBoundingClientRect().y - 200; })()`);
      await settle();
      const measure = `(() => { const input = document.querySelector('input[type="number"]'); const body = document.querySelector('.management-body');
        return { y: input.getBoundingClientRect().y, scroll: body.scrollTop, height: body.scrollHeight, focus: document.activeElement === input,
          overflow: body.scrollWidth > body.clientWidth }; })()`;
      const before = await evaluate(measure);
      assert.equal(before.overflow, false, `${width}px overflow`);
      for (const [message, used, deadline] of [
        ['OBS配信開始待ちです。', 0, '制限による待機なし'],
        ['OBS配信先への再接続待ちです。', 23, '13:00:30'],
        ['投稿上限による待機中です。会話は記憶しています。', 60, '14:00:00'],
        ['会話を聞いています。', 59, '制限による待機なし'],
      ]) {
        await evaluate(`document.querySelector('.ai-runtime-message .compact-feedback-content').textContent = ${JSON.stringify(message)};
          document.querySelector('.ai-budget p').textContent = '直近60分の投稿枠：${used} / 60件';
          document.querySelectorAll('.ai-budget p')[1].textContent = ${JSON.stringify('頻度制限の解除予定：' + deadline)};`);
        await settle(); assert.deepEqual(await evaluate(measure), before, `${width}px ${message}`); count++;
      }
      for (const stage of ['処理は停止中', '通常の発言待機', '配信者の発話待ち', '音声の認識待ち', '発話後の間を待っています', '新しい発話待ち',
        'OBSの配信状態を確認中', '画像入力を準備中', 'AIの発言を生成中', 'コメントを投稿中']) {
        await evaluate(`document.querySelector('.ai-runtime-stage').textContent = ${JSON.stringify(stage)};
          document.querySelector('.ai-runtime-next').textContent = '次の生成判定：23:59:59（投稿予約ではありません）';
          document.querySelector('.ai-runtime-durations').textContent = '直近の処理時間：OBS 123456.7秒・画像 123456.7秒・生成 123456.7秒・投稿 123456.7秒';`);
        await settle(); assert.deepEqual(await evaluate(measure), before, `${width}px ${stage}`); count++;
      }
    }
    await evaluate(`document.querySelector('#ai-panel-behavior').hidden = true; document.querySelector('#ai-panel-participants').hidden = false;`);
    await evaluate(`document.querySelectorAll('#ai-panel-participants details').forEach(e => e.open = true)`);
    for (const [width, height] of [[1000, 760], [760, 560], [560, 760], [320, 560]]) {
      window.setContentSize(width, height); await settle();
      assert.equal(await evaluate(`document.querySelectorAll('#ai-panel-participants .ai-service').length`), 4);
      await evaluate(`(() => { const input = document.querySelector('#ai-panel-participants .ai-service:last-child input:not([type=checkbox])'); input.focus({preventScroll:true});
        document.querySelector('.management-body').scrollTop += input.getBoundingClientRect().y - 200; })()`);
      await settle();
      const measure = `(() => { const input = document.querySelector('#ai-panel-participants .ai-service:last-child input:not([type=checkbox])'); const body = document.querySelector('.management-body');
        return { y: input.getBoundingClientRect().y, scroll: body.scrollTop, height: body.scrollHeight, focus: document.activeElement === input, overflow: body.scrollWidth > body.clientWidth }; })()`;
      const before = await evaluate(measure); assert.equal(before.overflow, false, `${width}px participants overflow`);
      for (const message of ['jpnknはブラウザで認証を確認してください。アプリから自動再送しません。確認後にこのサービスを再開してください。'.repeat(3), '投稿可能']) {
        await evaluate(`document.querySelector('#ai-panel-participants .ai-service:last-child .ai-service-status .compact-feedback-content').textContent = ${JSON.stringify(message)};
          document.querySelector('#ai-panel-participants .ai-service:last-child .ai-service-label').textContent = ${JSON.stringify(message === '投稿可能' ? '準備完了' : '確認が必要')};`);
        await settle(); assert.deepEqual(await evaluate(measure), before, `${width}px jpnkn status`); count++;
      }
    }
    console.log(`PASS: ${count} AI layout checks`); app.exit(0);
  } catch (error) { console.error(error); app.exit(1); }
});
