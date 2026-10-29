// Browser-only checks for the independent comparison. Never launches the product.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require(join(homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
const output = fileURLToPath(new URL('./screenshots/', import.meta.url));
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: 1200, height: 1600 }, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
try {
  await page.goto('http://127.0.0.1:5216/', { waitUntil: 'load' });
  await page.screenshot({ path: join(output, 'overview-comments.png'), fullPage: true });
  await page.getByRole('button', { name: '外配信', exact: true }).first().click();
  await page.screenshot({ path: join(output, 'overview-outdoor.png'), fullPage: true });
  const measurements=[];
  for (const width of [320, 398, 736, 1200]) {
    await page.setViewportSize({ width, height: 1200 });
    for (let index=0; index<8; index+=1) {
      for (const screen of ['comments','outdoor','connection','settings']) {
        await page.evaluate(({index,screen})=>{ window.casmateEight.openDesign(index); window.casmateEight.setScreen(screen); }, {index,screen});
        const geometry = await page.evaluate(()=>{
          const phone=document.querySelector('[data-detail-phone]');
          const small=[...phone.querySelectorAll('button,input,select')].filter(el=>el.checkVisibility() && !el.disabled).filter(el=>el.getBoundingClientRect().height<47.9).map(el=>({text:el.textContent,height:el.getBoundingClientRect().height}));
          return { width:innerWidth, outerOverflow:document.documentElement.scrollWidth>innerWidth+1, phoneOverflow:phone.scrollWidth>phone.clientWidth+1, small };
        });
        assert.equal(geometry.outerOverflow,false,`${width}/${index+1}/${screen}: horizontal page overflow`);
        assert.equal(geometry.phoneOverflow,false,`${width}/${index+1}/${screen}: phone overflow`);
        assert.deepEqual(geometry.small,[],`${width}/${index+1}/${screen}: effective touch targets at least48px`);
        measurements.push({index,screen,...geometry});
        if(width===736 && screen==='comments') await page.locator('[data-detail-phone]').screenshot({path:join(output,`concept-${index+1}-comments.png`)});
        if(width===736 && screen==='outdoor') await page.locator('[data-detail-phone]').screenshot({path:join(output,`concept-${index+1}-outdoor.png`)});
      }
      await page.evaluate(()=>window.casmateEight.setScreen('outdoor'));
      await page.locator('[data-detail-phone] [data-action=diagnostics]').click();
      const diagnostic=await page.locator('[data-detail-phone] [role=dialog]').evaluate(el=>el.scrollWidth>el.clientWidth+1);
      assert.equal(diagnostic,false,`${width}/${index+1}: diagnostic overflow`);
      await page.getByRole('button',{name:'閉じる',exact:true}).last().click();
    }
  }
  // Check text enlargement in the depicted device independently from the gallery.
  await page.setViewportSize({width:398,height:1200});
  for(let index=0;index<8;index+=1) {
    await page.evaluate(index=>{window.casmateEight.openDesign(index);window.casmateEight.setScreen('settings');},index);
    await page.locator('[data-detail-phone]').evaluate(el=>{
      for(const item of el.querySelectorAll('*')) {
        const size=parseFloat(getComputedStyle(item).fontSize);
        item.style.fontSize=`${size*1.3}px`;
      }
    });
    const overflow=await page.locator('[data-detail-phone]').evaluate(el=>el.scrollWidth>el.clientWidth+1);
    assert.equal(overflow,false,`concept${index+1}: 130% text horizontal overflow`);
  }
  assert.deepEqual(errors,[],'No browser script errors.');
  await writeFile(join(output,'layout-results.json'),JSON.stringify(measurements,null,2),'utf8');
  console.log('PASS: 8 × 4 screens at 320/398/736/1200px; 48px controls; diagnostic sheets; 130% settings text; screenshots.');
} finally {
  await browser.close();
}
