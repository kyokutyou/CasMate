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
    window.webContents.debugger.attach('1.3');
    const evaluate = code => window.webContents.executeJavaScript(code);
    const move = (x, y) => window.webContents.debugger.sendCommand('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
    // Hidden windows do not schedule animation frames; allow layout/anchor adjustment to finish.
    const settle = () => new Promise(resolve => setTimeout(resolve, 100));
    let count = 0;
    for (const [width, height] of [[760, 560], [560, 760], [320, 560]]) {
      window.setContentSize(width, height);
      await settle();
      for (const name of ['VOICEVOXの起動ファイルを指定', '話者一覧を更新']) {
        await move(5, 5);
        await evaluate(`document.querySelector('[role="switch"]').focus({preventScroll:true});
          document.querySelector('.management-body').scrollTop +=
            [...document.querySelectorAll('button')].find(b => b.textContent === ${JSON.stringify(name)}).getBoundingClientRect().y - 250;`);
        await settle();
        const measure = `(() => {
          const button = [...document.querySelectorAll('button')].find(b => b.textContent === ${JSON.stringify(name)});
          const rect = button.getBoundingClientRect(); const body = document.querySelector('.management-body');
          return { top: body.scrollTop, height: body.scrollHeight, x: rect.x + rect.width / 2,
            y: rect.y + rect.height / 2, focus: document.activeElement?.getAttribute('aria-label'), hover: button.matches(':hover') };
        })()`;
        const before = await evaluate(measure);
        await move(before.x, before.y);
        await settle();
        const after = await evaluate(measure);
        assert.equal(after.top, before.top, `${width}px ${name}: scroll position`);
        assert.equal(after.y, before.y, `${width}px ${name}: button position`);
        assert.equal(after.height, before.height, `${width}px ${name}: content height`);
        assert.equal(after.focus, before.focus, `${width}px ${name}: focus`);
        assert.equal(after.hover, true, `${width}px ${name}: pointer remains over button`);
        count++;
      }
    }
    console.log(`PASS: ${count} hover checks`);
    app.exit(0);
  } catch (error) {
    console.error(error);
    app.exit(1);
  }
});
