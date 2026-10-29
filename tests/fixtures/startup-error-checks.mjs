import assert from 'node:assert/strict';

export async function verifyStartupError({ evaluate, resize, capture, render }) {
  const deadline = Date.now() + 5000;
  while (!await evaluate('Boolean(document.querySelector("main h1"))')) {
    if (Date.now() > deadline) throw new Error('Startup error did not render');
    await evaluate('new Promise(resolve => setTimeout(resolve, 30))');
  }
  let checks = 0;
  for (const width of [760, 560, 320]) {
    await resize(width, 760);
    for (const expanded of [false, true]) {
      await evaluate(`document.querySelector('main details').open=${expanded}`);
      const settled = evaluate('new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error("Startup frames timed out")),3000);requestAnimationFrame(()=>requestAnimationFrame(()=>{clearTimeout(timer);resolve()}));})');
      if (render) await render();
      await settled;
      if (capture) await capture(`startup-error-${width}-${expanded ? 'expanded' : 'closed'}.png`);
      const layout = await evaluate(`(() => {
        const action = document.querySelector('main button').getBoundingClientRect();
        const details = document.querySelector('main details');
        const error = details.querySelector('p');
        return { width: innerWidth, document: document.documentElement.scrollWidth,
          actionVisible: action.width > 0 && action.height > 0 && action.left >= 0 && action.right <= innerWidth,
          textComplete: error.textContent === JSON.parse(document.getElementById('startup-error').textContent) && (!details.open || error.checkVisibility()),
          textFits: !details.open || error.scrollWidth <= error.clientWidth + 1 };
      })()`);
      assert.ok(layout.document <= layout.width + 1 && layout.actionVisible && layout.textComplete && layout.textFits,
        `${width}/${expanded}: startup error fits ${JSON.stringify(layout)}`);
      checks++;
    }
  }
  return checks;
}
